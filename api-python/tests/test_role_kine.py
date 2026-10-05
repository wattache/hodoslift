"""Le rôle KINÉ, de bout en bout — la grille rôle × route (FRE-52).

CE QUE CE FICHIER PROUVE. Le kiné d'un athlète LIT tout son programme et n'écrit
RIEN. Dit autrement : FRE-52 ajoute exactement une case verte à la matrice
d'autorisation, et pas une de plus. C'est la seule façon de le montrer — une
route ouverte se remarque, une route ouverte PAR ACCIDENT ne se remarque que si
quelqu'un a écrit la ligne du tableau qui dit qu'elle devait rester fermée.

CINQ PRINCIPAUX, dont deux qui se ressemblent et n'ont rien à voir :
  * `kine`           — le kiné DE cet athlète (athletes.kine_uid) ;
  * `kine_etranger`  — un kiné en règle, déclaré dans `kines`, qui suit
    quelqu'un d'AUTRE. C'est le principal qui compte : si le code testait « est
    kiné » au lieu de « est LE kiné de cet athlète », lui seul le révélerait.

PAS D'ASSERTION CREUSE. Chaque case vérifie DEUX choses : le code de retour, et
l'EFFET — un 200 doit avoir écrit LA VALEUR ENVOYÉE, un refus doit n'avoir rien
touché. Un tableau qui ne regarderait que les codes passerait au vert avec une
route qui refuse après avoir écrit, ou qui accepte sans rien faire. C'est la
leçon de `formOfTheDay` (revue FRE-12) : un test qui écarte ce qu'il devrait
regarder est un trou qu'on s'est caché — et la première version de ce fichier
est tombée dedans, en écrivant 4 sur une séance qui portait déjà 4.

DEUX ÉTAGES DE REFUS, et la distinction se voit à la mutation. Ouvrir le mode
`coach_or_athlete` au kiné ne fait tomber QU'UNE case de ce tableau — celle de
`patch_exercise`. Partout ailleurs la matrice de périmètre par champ tient la
ligne toute seule (le kiné n'a aucun champ déclaré). C'est une défense en
profondeur qui fonctionne, et c'est aussi la mesure de ce qui manque : le grain
de la LIGNE n'a pas encore de matrice. FRE-53 aura à en poser une.

CONVENTION DES REFUS, et elle est à deux étages :
  * 403 au niveau du PROGRAMME — le principal n'a pas de rôle qui ouvre cette
    route. Vaut pour le kiné étranger comme pour un coach étranger ou un
    inconnu : c'est la règle existante, on ne lui fait pas d'exception ;
  * 404 au niveau de l'OBJET — l'objet visé appartient à un autre programme.
    Là on ne confirme pas l'existence (`_verifier`, FRE-43).
"""

from datetime import date as date_cls, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.socle.auth import verify_token
from app.main import app
from tests.chargeur_arbre import Arbre, load
from tests.fixtures_training import arbre_de_test

_AUTH = {"Authorization": "Bearer x"}

_A1 = "aaaaaaaa-1111-1111-1111-111111111111"
_A2 = "aaaaaaaa-2222-2222-2222-222222222222"


@pytest.fixture
def monde(pg):
    """Deux programmes complets, et les cinq principaux de la grille.

    p1 : coach-1, athlète ath-1, suivi par kine-1.
    p2 : coach-2, athlète ath-2, suivi par kine-2 — c'est LUI le « kiné étranger »
    vu depuis p1, et il est un kiné parfaitement déclaré."""
    pg.execute(text("INSERT INTO users (uid, email) VALUES "
                    "('coach-1','c1@x.fr'), ('coach-2','c2@x.fr'), "
                    "('ath-1','a1@x.fr'), ('ath-2','a2@x.fr'), "
                    "('kine-1','k1@x.fr'), ('kine-2','k2@x.fr'), ('inconnu','i@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1'), ('coach-2')"))
    pg.execute(text("INSERT INTO kines (uid) VALUES ('kine-1'), ('kine-2')"))
    pg.execute(text(
        # ⚠️ `legacy_id` EST POSÉ, comme le fait `create_athlete` : sans lui la
        # fixture décrivait un athlète qui ne peut pas exister par l'API, et
        # `athleteId` sortait à NULL. Le `response_model` de `/signalements`
        # (FRE-70) l'a révélé du premier coup — c'est exactement ce qu'on lui
        # demande. La colonne reste nullable au schéma : invariant réel, non
        # garanti, à durcir un jour.
        "INSERT INTO athletes (id, legacy_id, coach_uid, first_name, last_name, user_uid, kine_uid) VALUES "
        "(CAST(:a1 AS uuid),'ath-a','coach-1','A','Un','ath-1','kine-1'),"
        "(CAST(:a2 AS uuid),'ath-b','coach-2','B','Deux','ath-2','kine-2')"), {"a1": _A1, "a2": _A2})
    pg.execute(text(
        "INSERT INTO programs (id, coach_uid, athlete_id) VALUES "
        "('p1','coach-1',CAST(:a1 AS uuid)), ('p2','coach-2',CAST(:a2 AS uuid))"),
        {"a1": _A1, "a2": _A2})
    load(pg, Arbre(macros=arbre_de_test("p1")))
    load(pg, Arbre(macros=arbre_de_test("p2")))
    return pg


def _client(uid: str) -> TestClient:
    app.dependency_overrides[verify_token] = lambda: {"uid": uid}
    return TestClient(app)


def _ids(conn, program_id: str = "p1") -> dict:
    """Un objet de chaque niveau, dans le programme demandé."""
    q = {
        "macro": "SELECT m.id FROM training_macros m WHERE m.program_id = :p ORDER BY m.number",
        "bloc": ("SELECT b.id FROM training_blocks b JOIN training_macros m ON m.id = b.macro_id "
                 "WHERE m.program_id = :p ORDER BY b.number"),
        "semaine": ("SELECT w.id FROM training_weeks w JOIN training_blocks b ON b.id = w.block_id "
                    "JOIN training_macros m ON m.id = b.macro_id WHERE m.program_id = :p "
                    "ORDER BY w.number"),
        "seance": ("SELECT s.id FROM training_sessions s JOIN training_weeks w ON w.id = s.week_id "
                   "JOIN training_blocks b ON b.id = w.block_id "
                   "JOIN training_macros m ON m.id = b.macro_id WHERE m.program_id = :p "
                   "ORDER BY s.position"),
        "exercice": ("SELECT e.id FROM training_exercises e "
                     "JOIN training_sessions s ON s.id = e.session_id "
                     "JOIN training_weeks w ON w.id = s.week_id "
                     "JOIN training_blocks b ON b.id = w.block_id "
                     "JOIN training_macros m ON m.id = b.macro_id WHERE m.program_id = :p "
                     "ORDER BY e.position"),
    }
    return {k: str(conn.execute(text(f"{sql} LIMIT 1"), {"p": program_id}).scalar())
            for k, sql in q.items()}


# --------------------------------------------------------------------------- #
# LA GRILLE
#
# Chaque route porte son TÉMOIN : la requête qui rend la valeur que l'écriture
# changerait. C'est lui qui distingue « refusé » de « refusé après coup ».
# --------------------------------------------------------------------------- #

# ⚠️ LA COLONNE QUI COMPTE EST DÉSORMAIS `kine_etranger`. Depuis que le kiné
# PROGRAMME comme le coach sur l'athlète qu'il suit (2026-08-18), sa colonne à lui
# ressemble à celle du coach — et c'est le kiné d'un AUTRE athlète qui prouve que
# le droit vient bien du LIEN `athletes.kine_uid`, et pas du fait d'être kiné.
# Sans elle, ce tableau dirait seulement « les kinés écrivent », ce qui est faux.
_ROLES = ("coach", "athlete", "kine", "kine_etranger", "inconnu")
_UID = {"coach": "coach-1", "athlete": "ath-1", "kine": "kine-1",
        "kine_etranger": "kine-2", "inconnu": "inconnu"}

# (nom, méthode, chemin, corps, témoin SQL, niveau, valeur attendue après écriture,
#  {rôle: code attendu})
#
# Le témoin rend du TEXTE (`::text`) : une seule forme à comparer quel que soit le
# type de la colonne, et pas de Decimal ni de date qui se compare mal.
#
# ⚠️ `attendu_apres` plutôt qu'un simple « ça a changé ». La première version
# comparait avant/après, et la case « forme du jour » est passée au vert en
# écrivant 4 sur une séance qui portait DÉJÀ 4 : la route aurait pu ne rien faire,
# le test n'aurait rien vu. On affirme donc la valeur écrite — et on refuse de
# construire un cas où elle égale la valeur de départ (cf. le garde-fou dans le
# test, qui fait tomber la case plutôt que de la laisser mentir).
_ROUTES = [
    (
        "macro : renommer",
        "patch", "/programs/p1/macros/{macro}", {"name": "VOLÉ"},
        "SELECT name::text FROM training_macros WHERE id = CAST(:id AS uuid)", "macro", "VOLÉ",
        {"coach": 200, "athlete": 403, "kine": 200, "kine_etranger": 403, "inconnu": 403},
    ),
    (
        "bloc : renommer",
        "patch", "/programs/p1/blocks/{bloc}", {"name": "VOLÉ"},
        "SELECT name::text FROM training_blocks WHERE id = CAST(:id AS uuid)", "bloc", "VOLÉ",
        {"coach": 200, "athlete": 403, "kine": 200, "kine_etranger": 403, "inconnu": 403},
    ),
    (
        "semaine : renommer (champ COACH)",
        "patch", "/programs/p1/weeks/{semaine}", {"name": "VOLÉ"},
        "SELECT name::text FROM training_weeks WHERE id = CAST(:id AS uuid)", "semaine", "VOLÉ",
        # 403 pour l'athlète par le PÉRIMÈTRE PAR CHAMP (il a bien accès à la
        # route), 403 pour les étrangers par le MODE. Même code, deux étages.
        {"coach": 200, "athlete": 403, "kine": 200, "kine_etranger": 403, "inconnu": 403},
    ),
    (
        "semaine : son poids (champ ATHLÈTE)",
        "patch", "/programs/p1/weeks/{semaine}", {"athleteWeightKg": 77.5},
        "SELECT athlete_weight_kg::text FROM training_weeks WHERE id = CAST(:id AS uuid)",
        "semaine", "77.5",
        # Le poids de la semaine est un champ que l'ATHLÈTE saisit, et que le
        # STAFF peut corriger — le coach le pouvait déjà, le kiné le peut aussi.
        # Ce n'est pas « le kiné est le patient », c'est « le kiné programme ».
        {"coach": 200, "athlete": 200, "kine": 200, "kine_etranger": 403, "inconnu": 403},
    ),
    (
        "séance : forme du jour (champ ATHLÈTE)",
        # 2 et non 4 : la fixture pose DÉJÀ 4 sur cette séance (cf. le garde-fou).
        "patch", "/programs/p1/sessions/{seance}", {"formOfTheDay": 2},
        "SELECT form_of_the_day::text FROM training_sessions WHERE id = CAST(:id AS uuid)",
        "seance", "2",
        {"coach": 200, "athlete": 200, "kine": 200, "kine_etranger": 403, "inconnu": 403},
    ),
    (
        "ligne : la charge",
        "patch", "/programs/p1/exercises/{exercice}", {"weight": "999"},
        "SELECT weight::text FROM training_exercises WHERE id = CAST(:id AS uuid)",
        "exercice", "999",
        # ⚠️ L'athlète est passé de 200 à 403 avec FRE-53, et c'était le but.
        # FRE-52 avait ÉPINGLÉ ce trou sans le corriger : `patch_exercise` était
        # `coach_or_athlete` sans matrice par champ, donc l'athlète pouvait
        # écrire la charge PRESCRITE. Il ne le pouvait que côté serveur —
        # l'interface ne lui offre que le réalisé — mais « aucun écran ne le
        # fait » n'est pas une autorisation. `weight` est de la prescription.
        {"coach": 200, "athlete": 403, "kine": 200, "kine_etranger": 403, "inconnu": 403},
    ),
    (
        "semaine : supprimer",
        "delete", "/programs/p1/weeks/{semaine}", None,
        "SELECT count(*)::text FROM training_weeks WHERE id = CAST(:id AS uuid)",
        "semaine", "0",
        {"coach": 200, "athlete": 403, "kine": 200, "kine_etranger": 403, "inconnu": 403},
    ),
]


@pytest.mark.parametrize("route", _ROUTES, ids=[r[0] for r in _ROUTES])
@pytest.mark.parametrize("role", _ROLES)
def test_grille_ecriture(monde, role, route):
    """Une case du tableau : le code attendu, ET l'effet attendu.

    Un 200 doit avoir écrit LA VALEUR ENVOYÉE (sinon la route accepte sans rien
    faire) ; tout refus doit laisser le témoin intact (sinon elle écrit puis
    refuse). Les deux moitiés comptent — un tableau qui ne lirait que les codes
    passerait au vert sur l'une comme sur l'autre."""
    nom, methode, chemin, corps, temoin_sql, niveau, attendu_apres, attendus = route
    ids = _ids(monde)
    avant = monde.execute(text(temoin_sql), {"id": ids[niveau]}).scalar()
    # Le cas serait CREUX : écrire la valeur déjà en place ne prouverait rien.
    # On fait tomber la case plutôt que de la laisser passer pour de mauvaises
    # raisons — c'est exactement comme ça que « forme du jour » a menti.
    assert avant != attendu_apres, (
        f"{nom} : la fixture porte déjà {attendu_apres!r}, ce cas ne prouverait rien")

    r = getattr(_client(_UID[role]), methode)(
        chemin.format(**ids), headers=_AUTH, **({"json": corps} if corps else {}))
    assert r.status_code == attendus[role], f"{nom} / {role} → {r.status_code} : {r.text[:200]}"

    apres = monde.execute(text(temoin_sql), {"id": ids[niveau]}).scalar()
    if attendus[role] == 200:
        assert apres == attendu_apres, f"{nom} / {role} : 200 rendu, mais la donnée n'a pas suivi"
    else:
        assert apres == avant, f"{nom} / {role} : refusé ({r.status_code}) mais la donnée a bougé"


@pytest.mark.parametrize("role,attendu", [
    ("coach", 200), ("athlete", 200), ("kine", 200),
    ("kine_etranger", 403), ("inconnu", 403),
])
def test_grille_lecture(monde, role, attendu):
    """LA case que FRE-52 ajoute : le kiné de l'athlète lit le programme entier.

    Et il le lit ENTIER, pas filtré — c'est le reste de la semaine (les charges,
    le volume, les jours de squat) qui dit s'il peut charger une épaule le
    lendemain. Un accès restreint au rehab produirait un avis pris à l'aveugle.

    On vérifie donc le CONTENU et pas seulement le 200 : un arbre vide passerait
    une assertion sur le code de retour."""
    r = _client(_UID[role]).get("/programs/p1/training", headers=_AUTH)
    assert r.status_code == attendu
    if attendu != 200:
        assert "macros" not in r.text        # rien ne fuit dans le corps du refus
        return
    macros = r.json()["macros"]
    assert macros and macros[0]["blocks"][0]["weeks"][0]["sessions"][0]["exercises"], \
        "l'arbre rendu est creux — un 200 ne prouve rien tout seul"


# --------------------------------------------------------------------------- #
# L'étage du dessous : l'OBJET étranger (404, et non 403)
# --------------------------------------------------------------------------- #


def test_le_kine_ne_lit_pas_le_programme_d_un_AUTRE_athlete(monde):
    """`kine-1` suit ath-1 et personne d'autre. Sur p2 il est un kiné étranger,
    et c'est le principal qui distingue « est kiné » de « est LE kiné de cet
    athlète » — la seule chose qui rende `athletes.kine_uid` utile."""
    assert _client("kine-1").get("/programs/p2/training", headers=_AUTH).status_code == 403


def test_un_objet_d_un_AUTRE_programme_reste_introuvable_pour_le_kine(monde):
    """404 ICI, et non 403 : `require_program_access` laisse passer (kine-1 EST
    le kiné de p1), mais l'objet visé appartient à p2 — `_verifier` ne confirme
    pas son existence. Les deux étages de refus sont distincts et le restent."""
    cible = _ids(monde, "p2")["macro"]
    avant = monde.execute(text(
        "SELECT name FROM training_macros WHERE id = CAST(:i AS uuid)"), {"i": cible}).scalar()
    r = _client("kine-1").patch(f"/programs/p1/macros/{cible}",
                                json={"name": "VOLÉ"}, headers=_AUTH)
    # 403 : le kiné n'a de toute façon pas le mode d'écriture. L'important est
    # que rien ne bouge — et que le 404 d'objet reste celui du coach, testé
    # juste en dessous.
    # 404 et non 403 : le kiné ATTEINT bien ce programme (il suit cet athlète),
    # c'est l'OBJET visé qui appartient à un autre. `_verifier` ne confirme pas
    # l'existence de ce qu'on n'a pas le droit de voir. L'isolation est donc plus
    # stricte qu'avant, pas moins : le refus ne dit même plus que l'objet existe.
    assert r.status_code == 404
    assert monde.execute(text(
        "SELECT name FROM training_macros WHERE id = CAST(:i AS uuid)"),
        {"i": cible}).scalar() == avant


def test_le_404_d_objet_etranger_n_a_pas_bouge(monde):
    """Garde-fou de non-régression : la convention 404 du niveau OBJET est celle
    de FRE-43, et l'arrivée d'un troisième rôle ne l'a pas déplacée."""
    cible = _ids(monde, "p2")["macro"]
    r = _client("coach-1").patch(f"/programs/p1/macros/{cible}",
                                 json={"name": "VOLÉ"}, headers=_AUTH)
    assert r.status_code == 404


# --------------------------------------------------------------------------- #
# Ce que le lien vaut, et ce qu'il ne vaut pas
# --------------------------------------------------------------------------- #


def test_detacher_le_kine_lui_RETIRE_la_lecture(monde):
    """Le droit suit le LIEN, pas le rôle. Un suivi qui se termine ferme l'accès
    au programme dans la foulée — sans quoi « détacher » ne voudrait rien dire."""
    c = _client("kine-1")
    assert c.get("/programs/p1/training", headers=_AUTH).status_code == 200
    monde.execute(text("UPDATE athletes SET kine_uid = NULL WHERE id = CAST(:a AS uuid)"),
                  {"a": _A1})
    assert c.get("/programs/p1/training", headers=_AUTH).status_code == 403


def test_le_role_seul_ne_donne_rien(monde):
    """`kine-2` est un kiné déclaré, et il ne peut RIEN sur p1 — ni lire, ni
    écrire. Être kiné n'est pas un laissez-passer : c'est la contrepartie de la
    décision « le lien est nominatif »."""
    c = _client("kine-2")
    assert c.get("/programs/p1/training", headers=_AUTH).status_code == 403
    ids = _ids(monde)
    assert c.patch(f"/programs/p1/weeks/{ids['semaine']}",
                   json={"name": "X"}, headers=_AUTH).status_code == 403


def test_le_kine_n_atteint_pas_les_ressources_ATHLETE(monde):
    """FRE-52 ouvre le PROGRAMME, pas la personne. Les PR, objectifs, journal et
    événements passent par `require_athlete_access`, qui ne connaît pas le kiné —
    et ce test est là pour que l'élargir devienne une décision, pas un effet de
    bord. (Le contraire se défend ; il n'a simplement pas été décidé.)"""
    c = _client("kine-1")
    for chemin in ("/athletes/a1/prs", "/athletes/a1/goals", "/athletes/a1/daily-logs"):
        r = c.get(chemin, headers=_AUTH)
        assert r.status_code in (403, 404), f"{chemin} → {r.status_code}"


# --------------------------------------------------------------------------- #
# L'ENTRÉE DU KINÉ (FRE-65) : le répertoire des kinés, et « mes athlètes »
# --------------------------------------------------------------------------- #

def test_le_repertoire_des_kines_est_reserve_aux_coachs(monde):
    """`GET /kines` nourrit le sélecteur « Suivi kiné » du coach — personne
    d'autre n'en a l'usage, personne d'autre ne l'obtient. L'admin passe par
    l'annuaire (`GET /users`), qui rend déjà `isKine`."""
    r = _client("coach-1").get("/kines", headers=_AUTH)
    assert r.status_code == 200
    assert {k["uid"] for k in r.json()} == {"kine-1", "kine-2"}
    for uid in ("kine-1", "ath-1", "inconnu"):
        assert _client(uid).get("/kines", headers=_AUTH).status_code == 403


def test_le_repertoire_des_kines_porte_TOUS_ses_champs(monde):
    """Figé AVANT le `response_model` (FRE-70) : un champ non déclaré
    disparaîtrait de la réponse sans erreur ni journal."""
    k = _client("coach-1").get("/kines", headers=_AUTH).json()[0]
    assert set(k) == {"uid", "displayName", "email"}


def test_mes_athletes_suivis_filtre_par_le_LIEN(monde):
    """`GET /athletes/suivis` : le lien `kine_uid` est la seule vérité (FRE-64).

    Pas de garde de rôle — un appelant qui n'est le kiné de personne reçoit une
    liste VIDE, pas un refus, exactement comme « mes athlètes » du coach filtre
    sur `coach_uid`. Et le kiné de p2 ne voit QUE le sien : c'est le principal
    qui compte, celui qui distinguerait « est kiné » de « est LE kiné »."""
    lu = _client("kine-1").get("/athletes/suivis", headers=_AUTH).json()
    assert [a["firstName"] for a in lu] == ["A"]
    assert lu[0]["programId"] == "p1"          # c'est par lui que le front navigue
    assert "email" not in lu[0] and "linkedUserId" not in lu[0]   # pas de PII de compte
    assert [a["firstName"] for a in
            _client("kine-2").get("/athletes/suivis", headers=_AUTH).json()] == ["B"]
    for uid in ("coach-1", "ath-1", "inconnu"):
        assert _client(uid).get("/athletes/suivis", headers=_AUTH).json() == []


# --------------------------------------------------------------------------- #
# LE TABLEAU DES SIGNALEMENTS — « qui va mal en ce moment ? »
# --------------------------------------------------------------------------- #


def _signaler(conn, athlete_uuid: str, jours: int, nom: str,
              zone: str = "knees:droite", intensite: int = 7) -> None:
    """Sème une douleur notée il y a `jours` jours, en SQL — l'API la réserve à
    l'athlète lui-même, et ce qu'on mesure ici est la LECTURE du staff.

    ⚠️ LA ZONE EST UNIQUE PAR ATHLÈTE TANT QU'ELLE VIT : deux appels sur la même
    zone notent la MÊME douleur deux jours différents, ce qui est le modèle."""
    douleur = conn.execute(text(
        "INSERT INTO douleurs (athlete_id, nom, zone) "
        "VALUES (CAST(:a AS uuid), :n, :z) "
        "ON CONFLICT (athlete_id, zone) WHERE fin IS NULL DO UPDATE SET nom = EXCLUDED.nom "
        "RETURNING id"), {"a": athlete_uuid, "n": nom, "z": zone}).scalar()
    conn.execute(text(
        "INSERT INTO douleur_logs (douleur_id, log_date, intensite) "
        "VALUES (:d, current_date - CAST(:j AS int), :i) "
        "ON CONFLICT (douleur_id, log_date) DO UPDATE SET intensite = EXCLUDED.intensite"),
        {"d": douleur, "j": jours, "i": intensite})


def test_le_staff_voit_les_signalements_de_SES_athletes(monde):
    """Le kiné l'a demandé, le coach l'obtient aussi : ils ont le même besoin sur
    leurs propres athlètes, et une route kiné-seule aurait été redemandée en
    coach la semaine d'après."""
    _signaler(monde, _A1, 1, 'Genou')
    _signaler(monde, _A2, 1, 'Épaule', zone='deltoids:gauche')

    for uid in ("kine-1", "coach-1"):
        lu = _client(uid).get("/athletes/signalements", headers=_AUTH).json()
        assert [s["firstName"] for s in lu] == ["A"], uid
        # ⚠️ LA LISTE DU JOUR, typée depuis FRE-195 : le questionnaire libre a
        # laissé place à une douleur qui a un nom, une zone et une intensité.
        assert [d["zone"] for d in lu[0]["douleurs"]] == ["knees:droite"]
        assert lu[0]["douleurs"][0]["intensite"] == 7
        assert lu[0]["programId"] == "p1"   # c'est par lui que le front navigue


def test_le_signalement_porte_TOUS_ses_champs(monde):
    """⚠️ LE GARDE-FOU DU `response_model` (FRE-70). Déclarer un modèle de sortie
    FILTRE la réponse : un champ absent du modèle disparaît en silence, sans
    erreur ni journal — le front reçoit `undefined` et l'écran se vide.

    Les autres specs de ce fichier n'affirment qu'un ou deux champs chacune ;
    aucune ne verrait un oubli. Celle-ci fige l'ensemble EXACT, clés comprises.
    C'est la même mécanique que le défaut `_creer_bloc` du 17/08 — une écriture
    manquante qui ne se voyait qu'au refetch."""
    _signaler(monde, _A1, 1, 'Genou')

    lu = _client("kine-1").get("/athletes/signalements", headers=_AUTH).json()
    assert len(lu) == 1
    assert set(lu[0]) == {"athleteId", "firstName", "lastName", "douleurs",
                          "programId", "date"}
    # ⚠️ L'ENSEMBLE EXACT VAUT AUSSI POUR LA DOULEUR : c'est là que vivent
    # désormais les champs qu'un `response_model` peut faire disparaître.
    assert set(lu[0]["douleurs"][0]) == {"id", "nom", "zone", "intensite",
                                         "commentaire", "logs", "recurrente"}
    douleur = lu[0]["douleurs"][0]
    assert (douleur["nom"], douleur["zone"], douleur["intensite"]) == ("Genou", "knees:droite", 7)
    # ⚠️ NOTÉE UNE FOIS N'EST PAS RÉCURRENTE : le compte fait foi, pas un drapeau.
    assert (douleur["logs"], douleur["recurrente"]) == (1, False)
    assert {k: v for k, v in lu[0].items() if k != "douleurs"} == {
        "athleteId": "ath-a", "firstName": "A", "lastName": "Un",
        "programId": "p1",
        "date": (date_cls.today() - timedelta(days=1)).isoformat(),
    }


def test_il_ne_voit_PAS_ceux_des_autres(monde):
    """Le principal, et le seul qui distingue « est kiné » de « est LE kiné » :
    kine-2 est un kiné parfaitement déclaré, il ne suit simplement pas A."""
    _signaler(monde, _A1, 1, 'Genou')

    assert _client("kine-2").get("/athletes/signalements", headers=_AUTH).json() == []
    for uid in ("ath-1", "inconnu"):
        # Liste VIDE et pas 403 : le LIEN est la vérité, pas un rôle global.
        r = _client(uid).get("/athletes/signalements", headers=_AUTH)
        assert r.status_code == 200 and r.json() == [], uid


def test_une_journee_SANS_signalement_ne_remplit_pas_le_tableau(monde):
    """⚠️ LE PIÈGE. `daily_logs` porte aussi le poids, le sommeil, l'eau et les
    calories. Sans le `kine IS NOT NULL`, une pesée quotidienne ferait une ligne
    par jour — et l'écran qui doit dire « qui va mal » dirait « tout le monde
    s'est pesé »."""
    monde.execute(text(
        "INSERT INTO daily_logs (athlete_id, log_date, weight_kg) "
        "VALUES (CAST(:a AS uuid), current_date, 72)"), {"a": _A1})

    assert _client("kine-1").get("/athletes/signalements", headers=_AUTH).json() == []


def test_le_plus_RECENT_en_premier_et_la_fenetre_se_regle(monde):
    """Décroissant : on cherche l'état d'aujourd'hui, pas celui d'il y a un mois."""
    _signaler(monde, _A1, 0, 'aujourd hui', zone='knees:droite')
    _signaler(monde, _A1, 5, 'il y a 5 jours', zone='deltoids:gauche')
    _signaler(monde, _A1, 90, 'il y a 3 mois', zone='chest:gauche')

    lu = _client("kine-1").get("/athletes/signalements", headers=_AUTH).json()
    assert [s["douleurs"][0]["nom"] for s in lu] == ["aujourd hui", "il y a 5 jours"]

    large = _client("kine-1").get("/athletes/signalements?jours=120", headers=_AUTH).json()
    assert len(large) == 3
    # La borne est INCLUSIVE des deux côtés : `jours=1` doit rendre aujourd'hui.
    assert len(_client("kine-1").get(
        "/athletes/signalements?jours=1", headers=_AUTH).json()) == 1
