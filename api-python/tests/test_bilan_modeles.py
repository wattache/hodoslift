"""La COMPOSITION des modèles de bilan — `docs/bilan-kine.md` §6.

⚠️ DEUX CHOSES À GARDER ICI, et elles ne se ressemblent pas :

  1. QUI COMPOSE. Seule la kiné — ni le coach, ni l'admin, ni l'athlète. Décider
     quels tests cliniques existent, sous quel protocole et quelle charge, est un
     acte de praticien. C'est la garde la plus facile à élargir par mégarde en
     ajoutant une route « juste pour dépanner ».

  2. CE QUE LA SUPPRESSION NE DOIT PAS EMPORTER. La base survivrait à tout
     (`SET NULL`, `CASCADE`) — mais des résultats d'athlètes cesseraient d'être
     rattachables, donc comparables, sans que rien ne le signale. D'où trois
     refus qui disent « archive plutôt que supprimer ».
"""

import pytest
from sqlalchemy import text

_AUTH = {"Authorization": "Bearer x"}


@pytest.fixture
def roles(pg):
    """Une kiné, un coach, un admin, un quidam — et un athlète pour les bilans."""
    pg.execute(text("INSERT INTO users (uid, email, is_admin) VALUES "
                    "('kine-1','k@x.fr',false), ('coach-1','c@x.fr',false), "
                    "('admin-1','ad@x.fr',true), ('quidam','q@x.fr',false)"))
    pg.execute(text("INSERT INTO kines (uid) VALUES ('kine-1')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1')"))
    pg.execute(text(
        "INSERT INTO athletes (id, legacy_id, coach_uid, kine_uid, first_name) "
        "VALUES (gen_random_uuid(),'a1','coach-1','kine-1','A')"))
    return pg


def _modele(client, nom="Bilan complet", **corps) -> dict:
    r = client.post("/bilan-modeles", headers=_AUTH, json={"nom": nom, **corps})
    assert r.status_code == 201, r.text[:300]
    return r.json()


def _rubrique(client, mid, libelle="Mobilité") -> dict:
    r = client.post(f"/bilan-modeles/{mid}/rubriques", headers=_AUTH,
                    json={"libelle": libelle})
    assert r.status_code == 201, r.text[:300]
    return r.json()["rubriques"][-1]


def _test(client, mid, rid, libelle="Grip", **corps) -> dict:
    r = client.post(f"/bilan-modeles/{mid}/rubriques/{rid}/tests", headers=_AUTH,
                    json={"libelle": libelle, **corps})
    assert r.status_code == 201, r.text[:300]
    return r.json()


# --------------------------------------------------------------------------- #
# QUI COMPOSE — la garde
# --------------------------------------------------------------------------- #

_OPERATIONS = [
    ("get", "/bilan-modeles", None),
    ("post", "/bilan-modeles", {"nom": "X"}),
]


@pytest.mark.parametrize("uid", ["coach-1", "admin-1", "quidam"])
@pytest.mark.parametrize("i", range(len(_OPERATIONS)))
def test_SEULE_LA_KINÉ_compose(auth_as, roles, uid, i):
    """⚠️ NI LE COACH, NI L'ADMIN. Le coach est exclu pour la même raison que du
    bilan lui-même : ce n'est pas de la donnée d'entraînement. L'admin l'est parce
    qu'administrer des comptes n'est pas exercer — s'il faut dépanner un jour, ça
    se fera en donnant le rôle, pas en élargissant la garde.

    ⚠️ LA LECTURE EST GARDÉE AUSSI. Un catalogue de protocoles kiné n'a pas à être
    lisible par n'importe quel compte authentifié ; l'athlète, lui, voit les
    modèles disponibles par sa propre route, sous sa propre autorisation."""
    methode, url, corps = _OPERATIONS[i]
    client = auth_as(uid=uid)
    r = getattr(client, methode)(url, headers=_AUTH, **({"json": corps} if corps else {}))
    assert r.status_code == 403, f"{methode.upper()} {url} laisse passer {uid}"
    assert r.json()["code"] == "reserve_aux_kines"


def test_la_KINÉ_compose(auth_as, roles):
    assert auth_as(uid="kine-1").get("/bilan-modeles", headers=_AUTH).status_code == 200


# --------------------------------------------------------------------------- #
# Composer
# --------------------------------------------------------------------------- #

def test_un_modèle_se_compose_de_bout_en_bout(auth_as, roles):
    client = auth_as(uid="kine-1")
    m = _modele(client, "Cycliste", description="Bilan court, bas du corps")
    assert set(m) == {"id", "nom", "description", "archive", "nbTests", "rubriques"}
    assert m["nbTests"] == 0 and m["rubriques"] == []

    r = _rubrique(client, m["id"], "Hanches")
    t = _test(client, m["id"], r["id"], "Hanche — rotation interne",
              mesure="reps", bilateral=True, chargeKg=5, materiel="élastique",
              vues=["face"], cible="20 reps", protocole="Assis, bassin fixe")

    assert set(t) == {"id", "libelle", "protocole", "mesure", "bilateral", "chargeKg",
                      "materiel", "vues", "cible", "ordre", "retire",
                    # Les images de démonstration (FRE-99), en LISTE ordonnée :
                    # un mouvement se montre en deux ou trois photos. Chacune
                    # porte une URL SIGNÉE — le seau est privé — qui vaut `None`
                    # dans les tests, où aucune clé Scaleway n'est configurée :
                    # rien ne doit partir sur le réseau depuis une suite.
                    "medias"}
    assert t["mesure"] == "reps" and t["bilateral"] is True
    assert t["chargeKg"] == 5 and t["vues"] == ["face"] and t["retire"] is False

    lu = client.get(f"/bilan-modeles/{m['id']}", headers=_AUTH).json()
    assert lu["nbTests"] == 1
    assert lu["rubriques"][0]["tests"][0]["libelle"] == "Hanche — rotation interne"


def test_les_DÉFAUTS_d_un_test_sont_sobres(auth_as, roles):
    """Un test créé sans rien d'autre qu'un libellé est un test de mobilité : pas
    de mesure, pas de côté. C'est le cas le plus fréquent (15 sur 32)."""
    client = auth_as(uid="kine-1")
    m = _modele(client)
    t = _test(client, m["id"], _rubrique(client, m["id"])["id"], "Cervicale — rotation")
    assert t["mesure"] == "aucune" and t["bilateral"] is False
    assert t["chargeKg"] is None and t["vues"] == []


def test_les_rubriques_et_tests_s_ajoutent_À_LA_FIN(auth_as, roles):
    """L'ordre se règle ensuite ; une insertion qui bouscule l'existant surprend
    plus qu'elle ne sert."""
    client = auth_as(uid="kine-1")
    m = _modele(client)
    a = _rubrique(client, m["id"], "A")
    b = _rubrique(client, m["id"], "B")
    assert (a["ordre"], b["ordre"]) == (0, 1)

    rid = a["id"]
    assert _test(client, m["id"], rid, "T1")["ordre"] == 0
    assert _test(client, m["id"], rid, "T2")["ordre"] == 1


def test_l_ORDRE_se_corrige(auth_as, roles):
    client = auth_as(uid="kine-1")
    m = _modele(client)
    _rubrique(client, m["id"], "A")
    b = _rubrique(client, m["id"], "B")
    lu = client.patch(f"/bilan-modeles/{m['id']}/rubriques/{b['id']}", headers=_AUTH,
                      json={"ordre": -1}).json()
    assert [r["libelle"] for r in lu["rubriques"]] == ["B", "A"]


def test_une_rubrique_d_un_AUTRE_modèle_est_introuvable(auth_as, roles):
    """⚠️ L'APPARTENANCE EST VÉRIFIÉE, PAS SEULEMENT L'EXISTENCE. Sans ça, une
    rubrique s'éditerait depuis n'importe quel modèle par son seul identifiant."""
    client = auth_as(uid="kine-1")
    m1, m2 = _modele(client, "M1"), _modele(client, "M2")
    r2 = _rubrique(client, m2["id"], "chez M2")
    rep = client.patch(f"/bilan-modeles/{m1['id']}/rubriques/{r2['id']}", headers=_AUTH,
                       json={"libelle": "détournée"})
    assert rep.status_code == 404 and rep.json()["code"] == "rubrique_introuvable"


# --------------------------------------------------------------------------- #
# Dupliquer — la voie normale (§6)
# --------------------------------------------------------------------------- #

def test_DUPLIQUER_recopie_rubriques_et_tests(auth_as, roles):
    """⚠️ LA VOIE NORMALE. Le bilan du cycliste naît du bilan complet, puis on
    élague : personne ne recompose 32 tests à la main, et une page blanche devant
    32 protocoles est un travail qu'on ne commence pas."""
    client = auth_as(uid="kine-1")
    source = _modele(client, "Bilan complet")
    r = _rubrique(client, source["id"], "Activation")
    _test(client, source["id"], r["id"], "Grip", mesure="secondes",
          bilateral=True, chargeKg=15, materiel="disque")

    copie = client.post("/bilan-modeles", headers=_AUTH, json={
        "nom": "Cycliste", "dupliquerDe": source["id"]}).json()

    assert copie["nom"] == "Cycliste" and copie["nbTests"] == 1
    copie_test = copie["rubriques"][0]["tests"][0]
    assert copie_test["libelle"] == "Grip" and copie_test["chargeKg"] == 15
    assert copie_test["materiel"] == "disque" and copie_test["bilateral"] is True
    assert copie_test["id"] != _test  # une nouvelle identité, pas un partage


def test_dupliquer_NE_RECOPIE_PAS_les_tests_retirés(auth_as, roles):
    """Dupliquer part de ce que le modèle contient AUJOURD'HUI, pas de son
    historique — sinon chaque copie ressusciterait ce qu'on avait écarté."""
    client = auth_as(uid="kine-1")
    source = _modele(client, "Source")
    r = _rubrique(client, source["id"])
    vif = _test(client, source["id"], r["id"], "Vif")
    mort = _test(client, source["id"], r["id"], "Retiré")
    client.patch(f"/bilan-modeles/{source['id']}/tests/{mort['id']}", headers=_AUTH,
                 json={"retire": True})

    copie = client.post("/bilan-modeles", headers=_AUTH, json={
        "nom": "Copie", "dupliquerDe": source["id"]}).json()
    assert [t["libelle"] for t in copie["rubriques"][0]["tests"]] == ["Vif"]
    assert vif["libelle"] == "Vif"


def test_dupliquer_un_modèle_INCONNU_rend_404(auth_as, roles):
    r = auth_as(uid="kine-1").post("/bilan-modeles", headers=_AUTH, json={
        "nom": "X", "dupliquerDe": "11111111-2222-3333-4444-555555555555"})
    assert r.status_code == 404 and r.json()["code"] == "modele_introuvable"


# --------------------------------------------------------------------------- #
# Retirer, archiver, supprimer — ce qui protège l'historique
# --------------------------------------------------------------------------- #

def test_le_RETRAIT_DOUX_sort_le_test_du_catalogue_sans_l_effacer(auth_as, roles):
    """`retire` fait disparaître le test des futurs bilans ; il reste visible pour
    la kiné, qui doit pouvoir le réactiver."""
    client = auth_as(uid="kine-1")
    m = _modele(client)
    t = _test(client, m["id"], _rubrique(client, m["id"])["id"], "Grip")

    retire = client.patch(f"/bilan-modeles/{m['id']}/tests/{t['id']}", headers=_AUTH,
                          json={"retire": True}).json()
    assert retire["retire"] is True

    lu = client.get(f"/bilan-modeles/{m['id']}", headers=_AUTH).json()
    assert lu["nbTests"] == 0, "un test retiré compte encore au catalogue"
    assert len(lu["rubriques"][0]["tests"]) == 1, "la kiné ne le voit plus"


def test_un_test_UTILISÉ_ne_se_supprime_pas(auth_as, roles):
    """⚠️ LA BASE SURVIVRAIT (`SET NULL`), MAIS LES RÉSULTATS CESSERAIENT D'ÊTRE
    RATTACHABLES — donc comparables, sans que personne ne le voie. Le retrait doux
    fait ce qu'on veut vraiment."""
    client = auth_as(uid="kine-1")
    m = _modele(client)
    t = _test(client, m["id"], _rubrique(client, m["id"])["id"], "Grip")
    client.post("/athletes/a1/bilans", headers=_AUTH,
                json={"date": "2026-08-21", "modeleId": m["id"]})

    r = client.delete(f"/bilan-modeles/{m['id']}/tests/{t['id']}", headers=_AUTH)
    assert r.status_code == 409 and r.json()["code"] == "test_utilise"


def test_un_test_JAMAIS_PASSÉ_se_supprime(auth_as, roles):
    """Le pendant : une erreur de saisie s'efface, elle n'encombre pas le modèle."""
    client = auth_as(uid="kine-1")
    m = _modele(client)
    t = _test(client, m["id"], _rubrique(client, m["id"])["id"], "Erreur de frappe")
    assert client.delete(f"/bilan-modeles/{m['id']}/tests/{t['id']}",
                         headers=_AUTH).status_code == 204


def test_un_modèle_UTILISÉ_ne_se_supprime_pas(auth_as, roles):
    client = auth_as(uid="kine-1")
    m = _modele(client)
    _test(client, m["id"], _rubrique(client, m["id"])["id"], "Grip")
    client.post("/athletes/a1/bilans", headers=_AUTH,
                json={"date": "2026-08-21", "modeleId": m["id"]})

    r = client.delete(f"/bilan-modeles/{m['id']}", headers=_AUTH)
    assert r.status_code == 409 and r.json()["code"] == "modele_utilise"
    assert "1 bilan" in r.json()["detail"]


def test_une_rubrique_NON_VIDE_ne_se_supprime_pas(auth_as, roles):
    """⚠️ LE CASCADE DE LA BASE EMPORTERAIT LES TESTS EN SILENCE — et avec eux le
    lien de résultats déjà enregistrés. Retirer les tests d'abord est un geste
    explicite ; leur disparition par ricochet ne l'est pas."""
    client = auth_as(uid="kine-1")
    m = _modele(client)
    r = _rubrique(client, m["id"])
    _test(client, m["id"], r["id"], "Grip")

    rep = client.delete(f"/bilan-modeles/{m['id']}/rubriques/{r['id']}", headers=_AUTH)
    assert rep.status_code == 409 and rep.json()["code"] == "rubrique_non_vide"


def test_ARCHIVER_est_la_voie_pour_retirer_un_modèle(auth_as, roles):
    """Le catalogue de la kiné garde les archivés — elle doit pouvoir les
    désarchiver ; la liste proposée à l'athlète, elle, ne les montre plus."""
    client = auth_as(uid="kine-1")
    m = _modele(client)
    lu = client.patch(f"/bilan-modeles/{m['id']}", headers=_AUTH,
                      json={"archive": True}).json()
    assert lu["archive"] is True
    assert [x["id"] for x in client.get("/bilan-modeles", headers=_AUTH).json()] == [m["id"]]


def test_un_modèle_INUTILISÉ_se_supprime(auth_as, roles):
    client = auth_as(uid="kine-1")
    m = _modele(client)
    assert client.delete(f"/bilan-modeles/{m['id']}", headers=_AUTH).status_code == 204
    assert client.get("/bilan-modeles", headers=_AUTH).json() == []
