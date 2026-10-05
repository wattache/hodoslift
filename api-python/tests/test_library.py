"""Bibliothèque d'exercices — modèle UNIFIÉ Postgres (2026-07-23).

⚠️ SUR LE VRAI POSTGRES (FRE-80). Le stub SQLite redéclarait `library_entries` à
sa façon — `id INTEGER` là où la production a un `uuid`, `supports TEXT` là où
elle a un `text[]`, et une `category` en texte libre là où elle porte un enum.
Il ne pouvait donc, par construction, jamais contredire le schéma réel : c'est
ce mécanisme qui a laissé `docs/postgres-schema.sql` diverger sans que rien ne
rougisse. Le commentaire d'origine le disait à demi-mot — « SQL réel vérifié à
part contre Neon », c'est-à-dire par un humain, une fois.

La fixture `pg` monte un Postgres 16, LA version de Neon, dont le schéma est
appliqué depuis le fichier de référence.
"""

import pytest
from sqlalchemy import text

from tests.conftest import semer_un_membre


@pytest.fixture
def sql(pg):
    return pg


_AUTH = {"Authorization": "Bearer x"}


def _coach(conn, uid="coach-1"):
    semer_un_membre(conn, uid)


def _seed(conn, category, name, competition=False, created_by="coach-1"):
    """⚠️ `created_by` EST UNE FK vers `coaches` en production — le stub SQLite ne
    la déclarait pas. On sème donc le coach au passage, comme le fait la route."""
    semer_un_membre(conn, created_by)
    return conn.execute(
        text("INSERT INTO library_entries (category, name, competition, created_by) "
             "VALUES (CAST(:cat AS library_category), :name, :comp, :by) RETURNING id"),
        {"cat": category, "name": name, "comp": competition, "by": created_by},
    ).scalar()


def _row(conn, entry_id):
    return conn.execute(
        text("SELECT category, name, competition FROM library_entries WHERE id = :id"),
        {"id": entry_id},
    ).first()


# --------------------------------------------------------------------------- #
# GET /library
# --------------------------------------------------------------------------- #


def test_get_groupe_par_categorie(auth_as, sql):
    _seed(sql, "exercices", "SQUAT", competition=True)
    _seed(sql, "exercices", "ROWING", competition=False)
    _seed(sql, "formats", "EMOM")
    _seed(sql, "tempos", "3-1-3")
    _coach(sql)  # la lecture exige d'appartenir au club (22/08)
    client = auth_as(uid="coach-1")
    r = client.get("/library", headers=_AUTH)
    assert r.status_code == 200
    body = r.json()
    # groupé, ordonné par name ; competition SEULEMENT pour les exercices
    assert body["exercices"] == [
        {"id": body["exercices"][0]["id"], "name": "ROWING", "competition": False},
        {"id": body["exercices"][1]["id"], "name": "SQUAT", "competition": True},
    ]
    assert body["formats"] == [{"id": body["formats"][0]["id"], "name": "EMOM"}]
    assert body["tempos"] == [{"id": body["tempos"][0]["id"], "name": "3-1-3"}]
    assert body["variantes"] == [] and body["assistances"] == []
    # pas de champ competition sur un terme
    assert "competition" not in body["formats"][0]


def test_get_lisible_par_un_MEMBRE_non_coach(auth_as, sql):
    """L'athlète lit la biblio — elle alimente ses propres listes déroulantes.
    C'est la moitié à ne pas casser en resserrant la garde : « membre », pas
    « staff »."""
    _seed(sql, "exercices", "SQUAT", competition=True)
    semer_un_membre(sql, "athlete-x", "athletes")
    r = auth_as(uid="athlete-x").get("/library", headers=_AUTH)
    assert r.status_code == 200
    assert [e["name"] for e in r.json()["exercices"]] == ["SQUAT"]


def test_get_refusé_à_un_compte_SANS_LIEN_avec_le_club(auth_as, sql):
    """⚠️ 230 ENTRÉES SERVIES À TOUT COMPTE GOOGLE, jusqu'au 22/08. Firebase
    n'impose aucun domaine : `verify_token` prouvait qu'une personne existe chez
    Google, pas qu'elle a le moindre rapport avec ce club. Ce n'est pas de la
    donnée personnelle — c'est le référentiel construit par les coachs, et la
    porte d'à côté (l'annuaire) était déjà fermée."""
    _seed(sql, "exercices", "SQUAT", competition=True)
    r = auth_as(uid="inconnu-du-club").get("/library", headers=_AUTH)
    assert r.status_code == 403
    assert r.json()["code"] == "reserve_aux_membres"


# --------------------------------------------------------------------------- #
# POST /library/entries
# --------------------------------------------------------------------------- #


def test_post_create(auth_as, sql):
    _coach(sql)
    client = auth_as(uid="coach-1")
    r = client.post("/library/entries", json={"category": "exercices", "name": "SQUAT", "competition": True}, headers=_AUTH)
    assert r.status_code == 200
    new_id = r.json()["id"]
    assert _row(sql, new_id) == ("exercices", "SQUAT", 1)


def test_post_trim_name(auth_as, sql):
    _coach(sql)
    client = auth_as(uid="coach-1")
    r = client.post("/library/entries", json={"category": "formats", "name": "  EMOM  "}, headers=_AUTH)
    assert r.status_code == 200
    assert _row(sql, r.json()["id"])[1] == "EMOM"


def test_post_defaut_competition_false(auth_as, sql):
    _coach(sql)
    client = auth_as(uid="coach-1")
    r = client.post("/library/entries", json={"category": "exercices", "name": "ROWING"}, headers=_AUTH)
    assert _row(sql, r.json()["id"]) == ("exercices", "ROWING", 0)


def test_post_doublon_409(auth_as, sql):
    _coach(sql)
    _seed(sql, "exercices", "SQUAT")
    client = auth_as(uid="coach-1")
    r = client.post("/library/entries", json={"category": "exercices", "name": "SQUAT"}, headers=_AUTH)
    assert r.status_code == 409
    # pas de doublon créé
    assert sql.execute(text("SELECT count(*) FROM library_entries WHERE name='SQUAT'")).scalar() == 1


def test_post_meme_nom_categorie_differente_ok(auth_as, sql):
    """(category, name) est la clé : même nom dans deux catégories = OK."""
    _coach(sql)
    _seed(sql, "exercices", "PONT")
    client = auth_as(uid="coach-1")
    r = client.post("/library/entries", json={"category": "variantes", "name": "PONT"}, headers=_AUTH)
    assert r.status_code == 200


def test_post_competition_sur_non_exercice_422(auth_as, sql):
    _coach(sql)
    client = auth_as(uid="coach-1")
    r = client.post("/library/entries", json={"category": "formats", "name": "X", "competition": True}, headers=_AUTH)
    assert r.status_code == 422
    assert sql.execute(text("SELECT count(*) FROM library_entries")).scalar() == 0


def test_post_non_coach_403(auth_as, sql):
    client = auth_as(uid="pas-coach")  # aucun doc users
    r = client.post("/library/entries", json={"category": "exercices", "name": "SQUAT"}, headers=_AUTH)
    assert r.status_code == 403
    assert sql.execute(text("SELECT count(*) FROM library_entries")).scalar() == 0


# --------------------------------------------------------------------------- #
# PATCH /library/entries/{id}
# --------------------------------------------------------------------------- #


def test_patch_rename(auth_as, sql):
    _coach(sql)
    eid = _seed(sql, "exercices", "SQAT")  # faute de frappe
    client = auth_as(uid="coach-1")
    r = client.patch(f"/library/entries/{eid}", json={"name": "SQUAT"}, headers=_AUTH)
    assert r.status_code == 200
    assert _row(sql, eid) == ("exercices", "SQUAT", 0)


def test_patch_toggle_competition(auth_as, sql):
    _coach(sql)
    eid = _seed(sql, "exercices", "SQUAT", competition=False)
    client = auth_as(uid="coach-1")
    r = client.patch(f"/library/entries/{eid}", json={"competition": True}, headers=_AUTH)
    assert r.status_code == 200
    assert _row(sql, eid)[2] == 1
    # et on peut le retirer
    client.patch(f"/library/entries/{eid}", json={"competition": False}, headers=_AUTH)
    assert _row(sql, eid)[2] == 0


def test_patch_rename_preserve_competition(auth_as, sql):
    _coach(sql)
    eid = _seed(sql, "exercices", "SQAT", competition=True)
    client = auth_as(uid="coach-1")
    client.patch(f"/library/entries/{eid}", json={"name": "SQUAT"}, headers=_AUTH)
    assert _row(sql, eid) == ("exercices", "SQUAT", 1)  # competition inchangé


def test_patch_404(auth_as, sql):
    _coach(sql)
    client = auth_as(uid="coach-1")
    r = client.patch("/library/entries/99999", json={"name": "X"}, headers=_AUTH)
    assert r.status_code == 404


def test_patch_rename_collision_409(auth_as, sql):
    _coach(sql)
    _seed(sql, "exercices", "SQUAT")
    eid = _seed(sql, "exercices", "ROWING")
    client = auth_as(uid="coach-1")
    r = client.patch(f"/library/entries/{eid}", json={"name": "SQUAT"}, headers=_AUTH)
    assert r.status_code == 409
    assert _row(sql, eid)[1] == "ROWING"  # inchangé


def test_patch_rename_vers_soi_meme_ok(auth_as, sql):
    """Renommer vers le même nom (ex. re-flaguer) ne doit pas se voir comme collision."""
    _coach(sql)
    eid = _seed(sql, "exercices", "SQUAT")
    client = auth_as(uid="coach-1")
    r = client.patch(f"/library/entries/{eid}", json={"name": "SQUAT", "competition": True}, headers=_AUTH)
    assert r.status_code == 200
    assert _row(sql, eid) == ("exercices", "SQUAT", 1)


def test_patch_competition_sur_non_exercice_422(auth_as, sql):
    _coach(sql)
    eid = _seed(sql, "formats", "EMOM")
    client = auth_as(uid="coach-1")
    r = client.patch(f"/library/entries/{eid}", json={"competition": True}, headers=_AUTH)
    assert r.status_code == 422
    assert _row(sql, eid)[2] == 0


def test_patch_vide_422(auth_as, sql):
    _coach(sql)
    eid = _seed(sql, "exercices", "SQUAT")
    client = auth_as(uid="coach-1")
    r = client.patch(f"/library/entries/{eid}", json={}, headers=_AUTH)
    assert r.status_code == 422


def test_patch_non_coach_403(auth_as, sql):
    eid = _seed(sql, "exercices", "SQUAT")
    client = auth_as(uid="pas-coach")
    r = client.patch(f"/library/entries/{eid}", json={"name": "HACK"}, headers=_AUTH)
    assert r.status_code == 403
    assert _row(sql, eid)[1] == "SQUAT"  # inchangé


# --------------------------------------------------------------------------- #
# Validation `supports` (pure, sans DB) — nettoyage {MU,PU,DIP,SQ}
# --------------------------------------------------------------------------- #

from pydantic import ValidationError  # noqa: E402

from app.bibliotheque.schemas_library import LibraryEntryCreate  # noqa: E402


def test_supports_normalise_la_casse_les_espaces_et_les_doublons():
    """La normalisation ne PERD rien : `" pu "` et `"PU"` désignent le même
    groupe, et le client n'a pas à connaître la casse attendue."""
    m = LibraryEntryCreate(category="exercices", name="ROWING", supports=[" pu ", "SQ", "PU"])
    assert m.supports == ["PU", "SQ"]      # majuscules, dédupliqué, ordre stable


def test_un_groupe_INCONNU_est_REFUSE_et_non_ecarte():
    """⚠️ CETTE SPEC DISAIT L'INVERSE JUSQU'AU 09/09 : elle passait
    `["pu", "SQ", "bogus", "PU"]` et attendait `["PU", "SQ"]`. Elle gravait donc
    une TRONCATURE SILENCIEUSE — le seul vocabulaire clos du projet à en faire
    une. Tous les autres (`kind`, `reps_unit`, `group_kind`, `increment_unit`,
    `event_type`) refusent, en 422.

    Écarter n'est pas tolérer : c'est écrire autre chose que ce qui a été
    demandé, et l'annoncer comme un succès. Un client qui envoie deux groupes en
    voit un en base, et rien ne le lui dit — la même famille que le `PUT /base`
    qui répondait 200 sans écrire la ligne (FRE-144, le même jour).

    ⚠️ ET LA BASE LE DIT AUSSI depuis
    `2026-09-09_les_supports_ont_un_vocabulaire_clos.sql` : le contrat ferme la
    porte du client, le CHECK ferme celle des autres écrivains."""
    with pytest.raises(ValidationError, match="bogus"):
        LibraryEntryCreate(category="exercices", name="ROWING",
                           supports=["pu", "SQ", "bogus", "PU"])


def test_un_supports_VIDE_traverse_jusqu_a_la_BASE(auth_as, sql):
    """⚠️ LES TROIS SPECS QUI SUIVENT PASSENT PAR HTTP, PAS PAR LE MODÈLE SEUL —
    et c'est la seule façon de les voir rouges (FRE-185). La faute ne vit pas
    dans Pydantic : `[]` traversait le contrat, et c'est le CHECK
    `library_entries_supports` qui levait, en 500.

    La base a tranché le 09/09 (FRE-157) : le tableau vide n'existe pas, les
    cinq entrées qui en portaient un ont été reprises en NULL. Le contrat doit
    dire la même chose — `[]` est une ABSENCE, pas une valeur."""
    _coach(sql)
    client = auth_as(uid="coach-1")
    r = client.post("/library/entries",
                    json={"category": "exercices", "name": "ROWING", "supports": []},
                    headers=_AUTH)
    assert r.status_code == 200, r.text
    # ⚠️ ON LIT LA BASE, PAS LA RÉPONSE : la création ne rend que l'`id`, donc
    # « supports absent de la réponse » serait vrai quoi qu'il arrive.
    pose = sql.execute(text("SELECT supports FROM library_entries WHERE id = CAST(:i AS uuid)"),
                       {"i": r.json()["id"]}).scalar()
    assert pose is None, f"le vide a été écrit comme une valeur : {pose!r}"


def test_un_supports_VIDE_en_PATCH_VIDE_vraiment(auth_as, sql):
    """⚠️ ET « VIDER » DOIT RESTER POSSIBLE. C'est le piège de la correction :
    normaliser `[]` en `None` dans le modèle suffirait à faire taire le 500, au
    prix d'une régression MUETTE — le routeur lit `payload.supports is not None`
    pour distinguer « non fourni » de « fourni », donc vider serait devenu
    garder, sans un mot.

    C'est `model_fields_set` qui tranche, comme pour les objectifs techniques
    (FRE-186) : la présence de la CLÉ, pas la valeur."""
    _coach(sql)
    eid = _seed(sql, "exercices", "ROWING")
    client = auth_as(uid="coach-1")
    client.patch(f"/library/entries/{eid}", json={"supports": ["PU"]}, headers=_AUTH)

    r = client.patch(f"/library/entries/{eid}", json={"supports": []}, headers=_AUTH)
    assert r.status_code == 200, r.text
    reste = sql.execute(text("SELECT supports FROM library_entries WHERE id = CAST(:i AS uuid)"),
                        {"i": eid}).scalar()
    assert reste is None, f"le vidage n'a pas eu lieu : {reste!r}"


def test_un_PATCH_qui_OMET_supports_les_GARDE(auth_as, sql):
    """Le complément, sans lequel la spec ci-dessus pourrait passer en effaçant
    tout : un champ qu'on ne nomme pas ne bouge pas."""
    _coach(sql)
    eid = _seed(sql, "exercices", "ROWING")
    client = auth_as(uid="coach-1")
    client.patch(f"/library/entries/{eid}", json={"supports": ["PU", "SQ"]}, headers=_AUTH)

    r = client.patch(f"/library/entries/{eid}", json={"name": "ROWING BAR"}, headers=_AUTH)
    assert r.status_code == 200, r.text
    garde = sql.execute(text("SELECT supports FROM library_entries WHERE id = CAST(:i AS uuid)"),
                        {"i": eid}).scalar()
    assert list(garde or []) == ["PU", "SQ"]


def test_un_name_NUL_est_refuse(auth_as, sql):
    """⚠️ L'AUTRE MOITIÉ DE FRE-185. Un `name` à `null` passait le contrat, puis
    le routeur lisait `payload.name if payload.name is not None else existing`
    — donc il GARDAIT l'ancien nom et répondait 200. Le client demandait quelque
    chose, le serveur ne faisait rien, et personne ne le lui disait.

    La colonne est `NOT NULL` : « effacer le nom » n'existe pas. Un champ qu'on
    ne veut pas changer s'OMET."""
    _coach(sql)
    eid = _seed(sql, "exercices", "ROWING")
    r = auth_as(uid="coach-1").patch(f"/library/entries/{eid}",
                                     json={"name": None}, headers=_AUTH)
    assert r.status_code == 422, r.text


def test_un_competition_NUL_est_refuse(auth_as, sql):
    """Même règle : le drapeau est vrai ou faux, jamais nul."""
    _coach(sql)
    eid = _seed(sql, "exercices", "ROWING", competition=True)
    r = auth_as(uid="coach-1").patch(f"/library/entries/{eid}",
                                     json={"competition": None}, headers=_AUTH)
    assert r.status_code == 422, r.text


def test_un_supports_NUL_VIDE_bien_l_entree(auth_as, sql):
    """⚠️ L'ASYMÉTRIE EST VOULUE, ET C'EST POUR ÇA QU'ELLE A SA SPEC.

    `supports` est le seul des trois à accepter `null`, parce que c'est le seul
    dont l'absence EST une valeur légitime : « cette entrée ne soutient rien ».
    La colonne est nullable, `[]` et `null` y disent la même chose. Refuser
    `null` ici enlèverait le seul moyen de vider."""
    _coach(sql)
    eid = _seed(sql, "exercices", "ROWING")
    client = auth_as(uid="coach-1")
    client.patch(f"/library/entries/{eid}", json={"supports": ["PU"]}, headers=_AUTH)

    r = client.patch(f"/library/entries/{eid}", json={"supports": None}, headers=_AUTH)
    assert r.status_code == 200, r.text
    reste = sql.execute(text("SELECT supports FROM library_entries WHERE id = CAST(:i AS uuid)"),
                        {"i": eid}).scalar()
    assert reste is None


def test_supports_absent_reste_none():
    m = LibraryEntryCreate(category="exercices", name="ROWING")
    assert m.supports is None


# --------------------------------------------------------------------------- #
# LES CLÉS DE SORTIE, figées AVANT le `response_model` (FRE-70, vague 4)
# --------------------------------------------------------------------------- #


def test_la_bibliotheque_porte_les_CINQ_categories_meme_vides(auth_as, sql):
    """⚠️ LES CINQ CLÉS SONT TOUJOURS LÀ, même sans une seule entrée. Le front
    lit `library.tempos` sans le tester ; une catégorie absente lui donnerait
    `undefined` là où il attend une liste."""
    _seed(sql, "exercices", "SQUAT", competition=True)
    _coach(sql)
    body = auth_as(uid="coach-1").get("/library", headers=_AUTH).json()

    assert set(body) == {"exercices", "variantes", "assistances", "tempos", "formats"}
    assert all(isinstance(v, list) for v in body.values())


def test_le_modele_couvre_TOUTES_les_categories_du_routeur():
    """⚠️ LE GARDE-FOU DU JOUR OÙ UNE CATÉGORIE S'AJOUTE. Le modèle nomme ses cinq
    champs, ce qui est plus précis qu'un dictionnaire libre — mais un
    `response_model` FILTRE : une sixième catégorie ajoutée à l'enum et à
    `_CATEGORIES` sortirait du routeur et serait jetée en silence.

    Comparer les deux ensembles ici fait échouer le test à l'ajout, donc oblige à
    toucher le modèle en même temps."""
    from app.bibliotheque.routes_library import _CATEGORIES
    from app.bibliotheque.schemas_library import BibliothequeLue

    assert set(BibliothequeLue.model_fields) == set(_CATEGORIES)


def test_une_entree_omet_ce_qui_ne_la_concerne_pas(auth_as, sql):
    """`competition` n'existe que sur les exercices, `supports` que s'il y en a.

    ⚠️ Le cas `supports` PEUPLÉ n'est pas vérifiable ici : la colonne du stub est
    du TEXT, pas un tableau (cf. le commentaire du schéma). Il l'est contre les
    vraies données par `scripts/verifier_competitions_contrat.py`."""
    _seed(sql, "exercices", "SQUAT", competition=True)
    _seed(sql, "tempos", "3-1-3")
    _coach(sql)
    body = auth_as(uid="coach-1").get("/library", headers=_AUTH).json()

    assert set(body["exercices"][0]) == {"id", "name", "competition"}
    assert set(body["tempos"][0]) == {"id", "name"}


def test_un_groupe_inconnu_donne_un_422_par_la_ROUTE(auth_as, sql):
    """⚠️ ET LE CLIENT LE VOIT. La spec ci-dessus éprouve le modèle ; celle-ci
    éprouve ce qui arrive au bout du fil — un 422, comme tous les autres
    vocabulaires clos, plutôt qu'un 200 sur une écriture amputée.

    On vérifie AUSSI qu'aucune entrée n'est créée : un refus rendu après coup ne
    vaudrait rien, il faudrait nettoyer derrière lui."""
    _coach(sql)
    r = auth_as(uid="coach-1").post(
        "/library/entries",
        json={"category": "exercices", "name": "ROWING", "supports": ["MU", "EPAULE"]},
        headers=_AUTH)
    assert r.status_code == 422
    # ⚠️ ET LE CODE, PAS SEULEMENT LE STATUT (FRE-157). Le front branche son
    # message dessus, pas sur le 422 : les specs de compétition du même lot
    # l'assertent déjà, celle-ci ne le faisait pas.
    assert r.json()["code"] == "corps_invalide"
    assert sql.execute(text("SELECT count(*) FROM library_entries")).scalar() == 0


def test_la_BASE_refuse_aussi_un_groupe_inconnu(sql):
    """⚠️ LE CONTRAT FERME LA PORTE DU CLIENT, LE `CHECK` FERME CELLE DES AUTRES
    (FRE-140). Un `UPDATE` à la main, une reprise, un futur appelant : rien de
    tout ça ne passe par Pydantic. La contrainte est la seule garde qui vaut pour
    tous, et la spec ci-dessus resterait verte si elle sautait."""
    from sqlalchemy.exc import IntegrityError

    _coach(sql)
    eid = _seed(sql, "exercices", "ROWING")
    with pytest.raises(IntegrityError):
        with sql.begin_nested():
            sql.execute(text("UPDATE library_entries SET supports = ARRAY['MU','EPAULE'] "
                             "WHERE id = :id"), {"id": eid})

    # Et le vocabulaire complet passe, lui — sinon on aurait fermé trop fort.
    sql.execute(text("UPDATE library_entries SET supports = ARRAY['MU','PU','DIP','SQ'] "
                     "WHERE id = :id"), {"id": eid})


def test_un_tableau_de_supports_VIDE_est_refuse_par_la_BASE(sql):
    """⚠️ LE VIDE ET LE NUL, ENCORE (FRE-157). `[]` était accepté — un tableau
    vide est sous-ensemble de n'importe quel autre, donc le `<@` de FRE-140 le
    laissait passer — et se relisait comme un NULL, parce qu'en Python un tableau
    vide est faux (`app/bibliotheque/routes_library.py`, `if supports:`).

    « Renseigné, aucun groupe » n'était exprimable ni à l'écriture (le front omet
    la clé quand la sélection est vide) ni à l'écran. On supprime la distinction
    au lieu de la faire vivre dans trois couches : la lecture cesse alors de
    mentir sans qu'on y touche."""
    from sqlalchemy.exc import IntegrityError

    _coach(sql)
    sql.execute(text(
        "INSERT INTO library_entries (category, name, supports) "
        "VALUES ('exercices', 'AVEC SUPPORTS', ARRAY['MU'])"))
    with pytest.raises(IntegrityError):
        sql.execute(text(
            "UPDATE library_entries SET supports = ARRAY[]::text[] "
            "WHERE name = 'AVEC SUPPORTS'"))


def test_un_support_ABSENT_reste_possible(sql):
    """Le pendant : NULL demeure l'état « non renseigné », et c'est celui de 215
    entrées sur 244. Une contrainte qui l'aurait emporté aurait cassé la
    bibliothèque entière."""
    _coach(sql)
    sql.execute(text(
        "INSERT INTO library_entries (category, name) VALUES ('exercices', 'SANS SUPPORTS')"))
    assert sql.execute(text(
        "SELECT supports FROM library_entries WHERE name = 'SANS SUPPORTS'")).scalar() is None
