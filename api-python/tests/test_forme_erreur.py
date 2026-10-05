"""Toute erreur sort-elle sous la MÊME forme, avec un code ? (FRE-40)

⚠️ CE QUE CES SPECS PROTÈGENT : la promesse « une seule forme ». Elle ne vaut que
si elle est TOTALE — il suffit d'un chemin d'erreur non couvert pour que le front
retombe sur « je ne sais pas ce qui s'est passé », et ce chemin-là ne se voit pas
en lisant le code, parce qu'il vient du framework.

Trois sources d'erreur coexistent, et chacune a son gestionnaire :

* ce que le code lève (`HTTPException` / `ErreurMetier`) ;
* ce que Pydantic refuse à l'ENTRÉE (`RequestValidationError`) — c'est
  l'avertissement du ticket : « la forme change pour toutes les erreurs, y
  compris les 422 de validation que le front lit peut-être déjà » ;
* ce que Starlette lève AVANT d'atteindre une route — 404 de routage, 405.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.socle.auth import verify_token
from app.socle.erreurs import CODES, Erreur
from app.main import app
from tests.conftest import semer_un_membre

_AUTH = {"Authorization": "Bearer x"}
_FORME = {"code", "detail", "status"}


class _Explosif:
    """Un objet dont la moindre lecture lève. Sert à provoquer, DEPUIS LE CORPS
    d'une route, l'exception imprévue que le filet doit attraper."""

    message = "boum"

    def __getattr__(self, nom: str):  # noqa: ANN204
        raise RuntimeError(_Explosif.message)


def _client(uid: str | None = None) -> TestClient:
    if uid:
        app.dependency_overrides[verify_token] = lambda: {"uid": uid}
    else:
        app.dependency_overrides.pop(verify_token, None)
    return TestClient(app)


def test_une_route_inconnue_rend_la_forme_unique():
    """⚠️ LE 404 DE ROUTAGE NE PASSE PAR AUCUN GESTIONNAIRE DE ROUTE. Il est levé
    par Starlette avant, et serait donc resté sous l'ancienne forme si seul
    `HTTPException` avait été traité."""
    r = _client().get("/cette-route-nexiste-pas")
    assert r.status_code == 404
    assert _FORME <= set(r.json())
    assert Erreur.model_validate(r.json())
    # ⚠️ ET LE CODE DIT LA VÉRITÉ (FRE-79). Il répondait `athlete_introuvable` —
    # le défaut par statut — sur une URL qui n'a jamais concerné un athlète. Un
    # front qui branche sur le code affichait donc « athlète introuvable » à
    # quelqu'un qui s'était trompé d'adresse.
    assert r.json()["code"] == "route_introuvable"


def test_un_appel_sans_jeton_rend_la_forme_unique():
    r = _client().get("/users/me")
    assert r.status_code == 401
    assert r.json()["code"] == "token_invalide"


def test_un_corps_invalide_rend_la_forme_unique_ET_le_detail_des_champs():
    """⚠️ LA VALIDATION DE PYDANTIC A SON PROPRE CODE, distinct des 422 métier :
    ce n'est pas une règle du domaine qui refuse, c'est la FORME du corps. Les
    confondre ferait afficher « date invalide » pour un champ mal orthographié.

    Et son `detail` est une CHAÎNE lisible, là où FastAPI rendait un tableau —
    `api/client.ts` devait réconcilier les deux formes à la main. La structure
    n'est pas perdue pour autant : elle passe dans `champs`."""
    # ⚠️ UNE ROUTE DONT LA VALIDATION SE DÉCLENCHE SEULE. La plupart résolvent
    # d'abord une dépendance d'autorisation, qui rend 403 ou 404 AVANT que le
    # corps ne soit lu — on testerait alors l'autre gestionnaire sans le savoir.
    r = _client("coach-1").patch("/competitions/c1", headers=_AUTH,
                                 json={"maxAttempts": "pas un nombre"})
    assert r.status_code == 422
    corps = r.json()
    assert corps["code"] == "corps_invalide"
    assert isinstance(corps["detail"], str) and corps["detail"]
    assert corps["champs"] and {"champ", "motif"} <= set(corps["champs"][0])
    assert Erreur.model_validate(corps)


def test_le_detail_n_est_JAMAIS_une_structure():
    """La raison d'être du point précédent, isolée : quelle que soit la source,
    `detail` se lit et s'affiche sans être démonté."""
    for reponse in (_client().get("/cette-route-nexiste-pas"),
                    _client().get("/users/me"),
                    _client("coach-1").patch("/competitions/c1", headers=_AUTH,
                                             json={"maxAttempts": "zut"})):
        assert isinstance(reponse.json()["detail"], str)


@pytest.mark.parametrize("code", sorted(CODES))
def test_chaque_code_a_une_description(code):
    """Un code sans description n'apprend rien à qui lit le schéma — et c'est le
    schéma qui devient la référence du front."""
    assert CODES[code].strip(), f"{code} n'est pas décrit"


def test_le_vocabulaire_des_codes_est_CLOS():
    """⚠️ C'EST CE QUI REND LA CHAÎNE VÉRIFIABLE DE BOUT EN BOUT. Le `Literal` part
    dans l'OpenAPI, `openapi-typescript` en fait une union, et le front ne peut
    plus tester un code qui n'existe pas — ni en oublier un.

    `ErreurMetier` refuse d'ailleurs de se construire sur un code hors liste :
    l'écart se voit à la levée, pas à l'affichage."""
    from app.socle.erreurs import ErreurMetier

    assert set(Erreur.model_fields["code"].annotation.__args__) == set(CODES)
    with pytest.raises(ValueError, match="inconnu"):
        ErreurMetier("code_qui_n_existe_pas", 404, "peu importe")


def test_les_SIX_conflits_ont_des_codes_DISTINCTS():
    """Le cas qui motive le ticket. Six règles métier différentes partageaient un
    seul 409, donc le front ne pouvait proposer aucune suite adaptée — « réassigne
    tes athlètes » et « choisis un autre slug » lui arrivaient identiques."""
    conflits = {"coach_encore_reference", "kine_a_des_athletes", "slug_deja_pris",
                "slug_immuable", "entree_deja_existante", "dernier_bloc"}
    assert conflits <= set(CODES)
    assert len({CODES[c] for c in conflits}) == 6, "deux conflits partagent une description"


def test_un_identifiant_de_CHEMIN_invalide_a_son_propre_code(pg):
    """⚠️ LA PRÉCISION QUE FRE-39 NE DEVAIT PAS COÛTER.

    La contrainte sur les identifiants de chemin vit désormais dans la signature
    (`IdentifiantDeChemin`), donc c'est FastAPI qui refuse — avant le corps du
    gestionnaire, et en la publiant dans le schéma. Le gain est réel : la règle ne
    s'oublie plus sur une route neuve, et l'OpenAPI ne promet plus un `string`
    libre là où seul un motif passe.

    Mais le validateur maison qu'elle remplace portait `identifiant_invalide`, un
    code nommé. Laisser la validation FastAPI tout ranger sous `corps_invalide`
    aurait fait perdre cette distinction — or « cette URL ne peut désigner
    personne » et « ce que tu envoies ne convient pas » sont deux choses
    différentes pour qui appelle.

    Le gestionnaire regarde donc d'où vient l'échec avant de le nommer.

    ⚠️ ET IL LUI FAUT UN MEMBRE DEPUIS FRE-141. `GET /{comp_id}/availability` est
    passée en `require_membre` : sans coach semé, la garde répond 403 AVANT que
    FastAPI n'ait à valider le motif du chemin, et cette spec éprouverait
    l'autorisation au lieu de la forme de l'erreur. Le décor dit maintenant ce
    dont elle a besoin."""
    semer_un_membre(pg, "coach-1")
    client = _client("coach-1")
    chemin = client.get("/competitions/il$egal/availability", headers=_AUTH)
    corps = client.patch("/competitions/c1", headers=_AUTH, json={"maxAttempts": "zut"})

    assert chemin.status_code == corps.status_code == 422
    assert chemin.json()["code"] == "identifiant_invalide"
    assert corps.json()["code"] == "corps_invalide"
    # Et le motif attendu figure dans le détail : de quoi corriger sans deviner.
    assert "pattern" in chemin.json()["detail"]


def test_la_contrainte_de_chemin_est_PUBLIÉE_dans_le_schéma():
    """Le second reproche de FRE-39, et le plus durable : la règle était
    invisible. Une contrainte que le schéma n'annonce pas oblige le client à la
    découvrir par un refus."""
    from app.socle.erreurs import MOTIF_IDENTIFIANT
    from app.main import app

    schema = app.openapi()["paths"]["/competitions/{comp_id}/availability"]["get"]
    parametre = next(p for p in schema["parameters"] if p["name"] == "comp_id")
    assert parametre["schema"]["pattern"] == MOTIF_IDENTIFIANT


# --------------------------------------------------------------------------- #
# LE FILET — ce qui ÉCHAPPE au code (FRE-79)
# --------------------------------------------------------------------------- #

def test_un_VERBE_non_autorisé_a_son_propre_code():
    """Le pendant du 404 de routage : l'adresse existe, pas le verbe. Répondait
    `corps_invalide`, alors qu'aucun corps n'est en cause."""
    r = _client().delete("/health")
    assert r.status_code == 405
    assert r.json()["code"] == "methode_non_autorisee"
    assert Erreur.model_validate(r.json())


def test_une_exception_IMPRÉVUE_rend_la_forme_unique(monkeypatch):
    """⚠️ LE TROU QUE FRE-40 AVAIT LAISSÉ. Il posait la forme sur ce que le code
    LÈVE ; rien ne couvrait ce qui lui ÉCHAPPE. Une exception non-HTTP sortait en
    500 texte brut, SANS en-tête CORS — donc, vue du navigateur, indistinguable
    d'une coupure réseau. Le front accusait la connexion pour une panne du
    serveur, ce que FRE-23 avait déjà corrigé une fois."""
    # ⚠️ ON CASSE CE QUE LA ROUTE APPELLE, PAS LA ROUTE. FastAPI capture la
    # fonction du gestionnaire à l'ENREGISTREMENT : la remplacer dans le module
    # après coup ne change rien, et le test passerait au vert sans rien prouver.
    monkeypatch.setattr(_Explosif, "message", "quelque chose d'imprévu")
    monkeypatch.setattr("app.socle.routes_health.settings", _Explosif())
    # `raise_server_exceptions=False` : sans lui, TestClient relaie l'exception
    # au lieu de laisser le gestionnaire répondre — on testerait le client.
    client = TestClient(app, raise_server_exceptions=False)
    r = client.get("/health", headers={"Origin": "https://trainer.french-forge.com"})

    assert r.status_code == 500
    assert r.json()["code"] == "erreur_interne"
    assert Erreur.model_validate(r.json())
    # ⚠️ L'EN-TÊTE CORS EST LE SUJET, PAS LE CORPS. Un gestionnaire
    # `exception_handler(Exception)` s'exécute dans le `ServerErrorMiddleware` de
    # Starlette, À L'EXTÉRIEUR de `CORSMiddleware` : sa réponse ne le traverse
    # jamais. La première version de ce filet rendait donc un JSON impeccable
    # que le navigateur refusait de lire — et `save-error` accusait toujours la
    # connexion. Un 500 au contrat sans cet en-tête n'a rien corrigé.
    assert r.headers.get("access-control-allow-origin") == "https://trainer.french-forge.com"


@pytest.mark.parametrize("ancienne", [
    "https://french-forge-600.web.app",
    "https://french-forge-600.firebaseapp.com",
    "https://french-forge-trainer-rewrite.web.app",
    "https://french-forge-trainer-rewrite.firebaseapp.com",
])
def test_une_ANCIENNE_ADRESSE_n_est_plus_une_origine(ancienne):
    """FRE-146, fermé le 13/09 : une seule origine de production. Le navigateur
    ne lit une réponse que si elle nomme son origine ; la bonne adresse l'obtient,
    les anciennes non — au pré-vol comme à la requête.
    MUTATION QUI ROUGIT : remettre une des quatre dans `allowed_origins`."""
    client = TestClient(app)
    pre_vol = {"Origin": ancienne, "Access-Control-Request-Method": "GET"}
    assert "access-control-allow-origin" not in client.options("/health", headers=pre_vol).headers
    assert "access-control-allow-origin" not in client.get("/health", headers={"Origin": ancienne}).headers
    bonne = {"Origin": "https://trainer.french-forge.com", "Access-Control-Request-Method": "GET"}
    assert client.options("/health", headers=bonne).headers.get("access-control-allow-origin") \
        == "https://trainer.french-forge.com"


def test_le_détail_d_une_exception_imprévue_NE_SORT_PAS(monkeypatch):
    """⚠️ UN MESSAGE D'EXCEPTION PORTE PARFOIS LA DONNÉE. Un poids, une note du
    kiné, un fragment de requête : la trace complète va dans les logs, où elle est
    protégée, jamais dans une réponse HTTP."""
    monkeypatch.setattr(_Explosif, "message", "poids de l'athlète : 87.5 kg")
    monkeypatch.setattr("app.socle.routes_health.settings", _Explosif())
    r = TestClient(app, raise_server_exceptions=False).get("/health")

    assert "87.5" not in r.text and "athlète" not in r.json()["detail"]


def test_un_UUID_de_chemin_mal_formé_est_refusé_AVANT_le_SQL(pg):
    """⚠️ « VALIDÉS PAR LEUR CAST SQL » ÉTAIT UN VŒU. `abc` passe le motif des
    identifiants hérités de Firestore, puis `CAST('abc' AS uuid)` lève une
    `DataError` — 500 au lieu d'un refus lisible.

    La contrainte revient dans la SIGNATURE (FRE-39) : le refus redevient un 422
    `identifiant_invalide`, par le gestionnaire de validation déjà en place."""
    # ⚠️ L'ATHLÈTE DOIT EXISTER, sinon la dépendance d'accès rend 404 AVANT que
    # la validation ne parle — et la spec passerait pour la mauvaise raison.
    pg.execute(text("INSERT INTO users (uid, email) VALUES "
                    "('uid-1','a@x.fr'), ('coach-1','c@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1')"))
    pg.execute(text(
        "INSERT INTO athletes (id, legacy_id, coach_uid, user_uid, first_name) "
        "VALUES (gen_random_uuid(), 'a1', 'coach-1', 'uid-1', 'A')"))

    r = _client("uid-1").get("/athletes/a1/bilans/pas-un-uuid")
    assert r.status_code == 422, r.text[:200]
    assert r.json()["code"] == "identifiant_invalide"


def test_le_format_UUID_est_PUBLIÉ_dans_le_schéma():
    """Le corollaire de FRE-39 : l'OpenAPI annonçait un `string` libre là où seul
    un uuid passe. Le front génère ses types depuis ce fichier."""
    chemin = app.openapi()["paths"]["/athletes/{athlete_id}/bilans/{bilan_id}"]["get"]
    bilan = next(p for p in chemin["parameters"] if p["name"] == "bilan_id")
    assert "pattern" in bilan["schema"], bilan["schema"]
    assert "0-9a-fA-F" in bilan["schema"]["pattern"]
