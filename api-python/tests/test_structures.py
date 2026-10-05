"""Les STRUCTURES (FRE-13) : French Forge et SCAPPULIFT.

⚠️ UNE SPEC DE CLOISONNEMENT À UNE SEULE STRUCTURE EST VERTE PAR CONSTRUCTION.
Chaque test ici pose les DEUX, et prouve qu'on ne voit PAS l'autre — pas
seulement qu'on voit la sienne.

Le monde est celui de la production, réduit à ses cas :
  · Nico     — coach SCAPPULIFT, ET athlète French Forge (coaché par Aubin) ;
  · Aubin    — coach French Forge ;
  · William  — admin des deux, coach et kiné French Forge ;
  · Thomas   — kiné French Forge ; Kenza — kiné SCAPPULIFT ;
  · Léo      — athlète SCAPPULIFT, coaché par Nico.
"""

import pytest
from sqlalchemy import text

_AUTH = {"Authorization": "Bearer x"}

# ⚠️ `auth_as` REMPLACE LE JETON POUR TOUTE L'APP, pas pour le client rendu : un
# client gardé dans une variable agit sous le DERNIER compte créé. D'où un client
# neuf à chaque appel — la première version de ce fichier faisait écrire « Aubin »
# sous le jeton de Nico, et la spec rougissait pour une raison fausse.
_FF, _SC = "french-forge", "scappulift"


@pytest.fixture
def monde(pg):
    pg.execute(text(
        "INSERT INTO users (uid, email, is_admin) VALUES "
        "('nico','n@x.fr',false), ('aubin','a@x.fr',false), ('william','w@x.fr',true), "
        "('thomas','t@x.fr',false), ('kenza','k@x.fr',false), ('leo','l@x.fr',false), "
        "('passant','p@x.fr',false)"))
    pg.execute(text(
        "INSERT INTO coaches (uid, structure) VALUES "
        "('nico','scappulift'), ('aubin','french-forge'), ('william','french-forge')"))
    pg.execute(text(
        "INSERT INTO kines (uid, structure) VALUES ('thomas','french-forge'), ('kenza','scappulift'), "
        "('william','french-forge')"))
    pg.execute(text(
        "INSERT INTO athletes (legacy_id, first_name, coach_uid, user_uid, structure) VALUES "
        "('fiche-nico', 'Nico', 'aubin', 'nico', 'french-forge'), "
        "('fiche-leo',  'Léo',  'nico',  'leo',  'scappulift')"))
    # Les compétitions valident leurs mouvements contre la bibliothèque — celle
    # de LEUR structure (19/09) : « SQUAT » existe dans chacune.
    pg.execute(text(
        "INSERT INTO library_entries (structure, category, name, competition) "
        "SELECT slug, 'exercices', 'SQUAT', true FROM structures ON CONFLICT DO NOTHING"))
    return pg


def _me(auth_as, uid):
    return auth_as(uid=uid).get("/users/me", headers=_AUTH).json()


# --------------------------------------------------------------------------- #
# Où est chacun, et à quel titre
# --------------------------------------------------------------------------- #


def test_nico_est_coach_chez_scappulift_et_athlete_chez_french_forge(auth_as, monde):
    """Le cas qui décide du modèle : deux structures, deux rôles, UN compte. Le
    front choisit une entrée ; c'est brokkr qui dit ce qu'il y est."""
    assert _me(auth_as, "nico")["structures"] == [
        {"slug": _FF, "nom": "French Forge", "isCoach": False, "isKine": False, "athleteId": "fiche-nico"},
        {"slug": _SC, "nom": "SCAPPULIFT", "isCoach": True, "isKine": False, "athleteId": None},
    ]


def test_l_admin_voit_TOUTES_les_structures_avec_ses_VRAIS_roles(auth_as, monde):
    """Admin de la plateforme : il voit SCAPPULIFT, mais n'y coache pas."""
    s = {e["slug"]: e for e in _me(auth_as, "william")["structures"]}
    assert set(s) == {_FF, _SC, "elgustolift"}
    assert (s[_FF]["isCoach"], s[_FF]["isKine"]) == (True, True)
    assert (s[_SC]["isCoach"], s[_SC]["isKine"]) == (False, False)


def test_un_compte_sans_lien_n_a_aucune_structure(auth_as, monde):
    assert _me(auth_as, "passant")["structures"] == []


# --------------------------------------------------------------------------- #
# Ce qui s'écrit dans une structure
# --------------------------------------------------------------------------- #


def test_la_fiche_nait_dans_la_structure_du_coach(auth_as, monde):
    """⚠️ LE DÉFAUT DE LA COLONNE EST FRENCH FORGE : une fiche créée par Nico qui
    ne dirait pas sa structure tomberait chez French Forge sans un mot."""
    r = auth_as(uid="nico").post("/athletes", json={"firstName": "Zoé", "email": "z@x.fr"}, headers=_AUTH)
    assert r.status_code == 200
    assert monde.execute(text("SELECT structure FROM athletes WHERE legacy_id = :l"),
                         {"l": r.json()["id"]}).scalar() == _SC


def test_l_admin_promeut_un_coach_DANS_une_structure_et_la_relit(auth_as, monde):
    admin = auth_as(uid="william")  # seul client de ce test : pas de piège
    r = admin.put("/users/passant/coach", json={"isCoach": True, "structure": _SC}, headers=_AUTH)
    assert r.status_code == 200
    lu = {u["uid"]: u for u in admin.get("/users", headers=_AUTH).json()}
    assert (lu["passant"]["coachStructure"], lu["aubin"]["coachStructure"]) == (_SC, _FF)
    # Et où chacun est ATHLÈTE : Léo chez SCAPPULIFT, le passant nulle part.
    assert (lu["leo"]["athleteStructures"], lu["passant"]["athleteStructures"]) == ([_SC], [])
    # Une structure inconnue est refusée AVANT d'écrire — pas un 409 « encore référencé ».
    r = admin.put("/users/passant/kine", json={"isKine": True, "structure": "nulle-part"}, headers=_AUTH)
    assert (r.status_code, r.json()["code"]) == (404, "structure_inconnue")
    assert monde.execute(text("SELECT count(*) FROM kines WHERE uid = 'passant'")).scalar() == 0


def test_un_coach_ne_change_pas_de_structure_en_y_laissant_ses_athletes(auth_as, monde):
    """Nommer une AUTRE structure déplace le coach (modèle A) — mais pas ses
    fiches, que l'invariant `fiche_dans_la_structure_de_son_coach` aurait vues
    orphelines. Même refus que la rétrogradation : c'est la même chose pour la
    structure qu'il quitte. Le renommer dans la SIENNE reste sans effet, et sans refus."""
    admin = auth_as(uid="william")
    r = admin.put("/users/nico/coach", json={"isCoach": True, "structure": _FF}, headers=_AUTH)
    assert (r.status_code, r.json()["code"]) == (409, "coach_encore_reference")
    assert monde.execute(text("SELECT structure FROM coaches WHERE uid = 'nico'")).scalar() == _SC
    assert admin.put("/users/nico/coach", json={"isCoach": True, "structure": _SC}, headers=_AUTH).status_code == 200


def test_un_athlete_ne_se_reaffecte_pas_a_un_coach_d_une_autre_structure(auth_as, monde):
    """Léo (SCAPPULIFT) confié à Aubin (French Forge) : sa fiche resterait
    SCAPPULIFT sous un coach French Forge — invisible de la liste de l'un comme
    de l'autre. Refusé, et rien n'est écrit."""
    r = auth_as(uid="william").patch("/athletes/fiche-leo/coach", json={"coachUid": "aubin"}, headers=_AUTH)
    assert (r.status_code, r.json()["code"]) == (409, "coach_d_une_autre_structure")
    assert monde.execute(text("SELECT coach_uid FROM athletes WHERE legacy_id = 'fiche-leo'")).scalar() == "nico"


# --------------------------------------------------------------------------- #
# Ce qu'on regarde dans une structure
# --------------------------------------------------------------------------- #


def test_mes_athletes_se_bornent_a_la_structure_choisie(auth_as, monde):
    """Nico chez SCAPPULIFT : les fiches qu'il coache. Chez French Forge : la
    sienne. Sans structure : les deux (un front d'avant les structures)."""
    ids = lambda q: sorted(a["id"] for a in auth_as(uid="nico").get(f"/athletes/mine{q}", headers=_AUTH).json())
    assert ids(f"?structure={_SC}") == ["fiche-leo"]
    assert ids(f"?structure={_FF}") == ["fiche-nico"]
    assert ids("") == ["fiche-leo", "fiche-nico"]


def test_un_kine_voit_la_structure_de_l_athlete_qu_il_suit(auth_as, monde):
    """Thomas (French Forge) suit Léo (SCAPPULIFT). Le lien croisé est permis
    (`PATCH /athletes/{id}/kine`) : il faut qu'il MÈNE quelque part — SCAPPULIFT
    entre dans ses structures, et « mes suivis » y montre Léo. Sans ça, une
    écriture permise n'était lisible nulle part (une demi-règle)."""
    monde.execute(text("UPDATE athletes SET kine_uid = 'thomas' WHERE legacy_id = 'fiche-leo'"))
    assert {s["slug"]: s["isKine"] for s in _me(auth_as, "thomas")["structures"]} == {_FF: True, _SC: True}
    suivis = auth_as(uid="thomas").get(f"/athletes/suivis?structure={_SC}", headers=_AUTH).json()
    assert [a["id"] for a in suivis] == ["fiche-leo"]
    # Kenza, kiné SCAPPULIFT sans lien French Forge, n'y entre pas pour autant.
    assert [s["slug"] for s in _me(auth_as, "kenza")["structures"]] == [_SC]


def test_le_coach_ne_se_voit_proposer_que_les_kines_de_sa_structure(auth_as, monde):
    noms = lambda uid: sorted(k["uid"] for k in auth_as(uid=uid).get("/kines", headers=_AUTH).json())
    assert noms("nico") == ["kenza"]
    assert noms("aubin") == ["thomas", "william"]
    assert noms("william") == ["kenza", "thomas", "william"]  # l'admin


# --------------------------------------------------------------------------- #
# Les compétitions
# --------------------------------------------------------------------------- #


def _compet(client, comp_id, participants=(), q=""):
    return client.put(f"/competitions/{comp_id}{q}", headers=_AUTH, json={
        "name": comp_id, "startDate": "2026-11-07", "endDate": "2026-11-08",
        "movementNames": ["SQUAT"], "participants": list(participants)})


def test_une_competition_nait_dans_la_structure_de_son_createur(auth_as, monde):
    assert _compet(auth_as(uid="nico"), "open-scappulift").status_code == 200
    assert monde.execute(text(
        "SELECT structure FROM competitions WHERE legacy_id = 'open-scappulift'")).scalar() == _SC


def test_l_admin_cree_une_competition_dans_la_structure_qu_il_regarde(auth_as, monde):
    """William coache chez French Forge. Depuis la vue SCAPPULIFT, la compétition
    qu'il crée est SCAPPULIFT — pas rangée chez lui, donc invisible de la vue où
    il vient de la créer, et fermée aux coachs SCAPPULIFT. Sans structure (un
    front d'avant), elle naît là où il coache. Un coach n'écrit que dans la sienne."""
    assert _compet(auth_as(uid="william"), "open-sc", q=f"?structure={_SC}").status_code == 200
    assert _compet(auth_as(uid="william"), "open-ff").status_code == 200
    assert dict(monde.execute(text(
        "SELECT legacy_id, structure FROM competitions")).all()) == {"open-sc": _SC, "open-ff": _FF}
    r = _compet(auth_as(uid="aubin"), "autre-sc", q=f"?structure={_SC}")
    assert (r.status_code, r.json()["code"]) == (403, "reserve_aux_coachs")
    assert monde.execute(text("SELECT count(*) FROM competitions")).scalar() == 2


def test_une_competition_d_une_autre_structure_n_existe_pas_pour_ses_coachs(auth_as, monde):
    """Aubin (French Forge) ne voit pas le meet de SCAPPULIFT, ne peut ni
    l'éditer ni le supprimer — 404, pas 403 : un 403 dirait qu'il existe."""
    _compet(auth_as(uid="nico"), "open-scappulift")
    _compet(auth_as(uid="aubin"), "open-ff")
    ids = lambda uid, q="": sorted(c["id"] for c in auth_as(uid=uid).get(f"/competitions{q}", headers=_AUTH).json())
    assert ids("aubin") == ["open-ff"]
    assert ids("nico") == ["open-scappulift"]
    assert _compet(auth_as(uid="aubin"), "open-scappulift").status_code == 404
    assert auth_as(uid="aubin").delete("/competitions/open-scappulift", headers=_AUTH).status_code == 404
    assert auth_as(uid="aubin").get("/competitions/open-scappulift/availability", headers=_AUTH).status_code == 404
    assert monde.execute(text("SELECT name FROM competitions WHERE legacy_id = 'open-scappulift'")).scalar() == "open-scappulift"
    # L'admin voit les deux ; `?structure=` borne la VUE.
    assert ids("william") == ["open-ff", "open-scappulift"]
    assert ids("william", f"?structure={_SC}") == ["open-scappulift"]


def test_nico_voit_le_meet_french_forge_ou_sa_fiche_concourt(auth_as, monde):
    """Coach SCAPPULIFT, mais athlète French Forge inscrit : il le voit — et
    seulement celui-là, pas les autres meets French Forge."""
    _compet(auth_as(uid="aubin"), "open-ff", [{"name": "Nico", "uid": "nico"}])
    _compet(auth_as(uid="aubin"), "autre-ff")
    assert [c["id"] for c in auth_as(uid="nico").get("/competitions", headers=_AUTH).json()] == ["open-ff"]
    assert auth_as(uid="nico").get("/competitions/open-ff/availability", headers=_AUTH).status_code == 200


def test_la_matrice_de_dispo_ne_montre_que_les_coachs_de_sa_structure(auth_as, monde):
    _compet(auth_as(uid="aubin"), "open-ff")
    coachs = {l["coachUid"] for l in auth_as(uid="aubin").get(
        "/competitions/open-ff/availability", headers=_AUTH).json()}
    assert coachs == {"aubin", "william"}
    # Et on n'y déclare pas un coach d'ailleurs.
    r = auth_as(uid="aubin").put("/competitions/open-ff/availability", headers=_AUTH,
                                  json={"coachUid": "nico", "day": "2026-11-07", "status": "available"})
    assert r.status_code == 400


def test_les_dispos_d_un_coach_ne_montrent_pas_les_meets_d_une_autre_structure(auth_as, monde):
    """Le coach est un PARAMÈTRE libre de la route : sans borne, Aubin lisait les
    meets SCAPPULIFT à travers les disponibilités de Nico."""
    _compet(auth_as(uid="nico"), "open-scappulift")
    assert auth_as(uid="nico").put("/competitions/open-scappulift/availability", headers=_AUTH, json={
        "coachUid": "nico", "day": "2026-11-07", "status": "available"}).status_code == 200
    lire = lambda uid: [d["competitionId"] for d in auth_as(uid=uid).get(
        "/competitions/coach-availability?coachUid=nico", headers=_AUTH).json()]
    assert lire("nico") == ["open-scappulift"]
    assert lire("aubin") == []


def test_un_athlete_de_la_structure_lit_la_matrice_pas_celui_d_une_autre(auth_as, monde):
    """La matrice est lisible par tout MEMBRE de la structure — un athlète
    compris, même non inscrit. Léo (athlète SCAPPULIFT) ne lit pas celle d'un
    meet French Forge ; Nico, par sa fiche French Forge, la lit."""
    _compet(auth_as(uid="aubin"), "open-ff")
    assert auth_as(uid="nico").get("/competitions/open-ff/availability", headers=_AUTH).status_code == 200
    assert auth_as(uid="leo").get("/competitions/open-ff/availability", headers=_AUTH).status_code == 404



def test_le_meet_partage_se_lit_par_ses_participants(auth_as, monde):
    """FRE-13, le cas réel du 18/09 : Xhibition IV est French Forge, mais des
    athlètes de William (ElGustoLift) y concourent. Leur coach voit le meet et
    figure dans sa matrice ; un coach sans athlète inscrit, non."""
    monde.execute(text("INSERT INTO users (uid, email) VALUES ('gusto','g@x.fr')"))
    monde.execute(text("INSERT INTO coaches (uid, structure) VALUES ('gusto','elgustolift')"))
    monde.execute(text("INSERT INTO athletes (legacy_id, first_name, coach_uid, user_uid, structure) "
                       "VALUES ('fiche-groce','Groce','gusto',NULL,'elgustolift')"))
    monde.execute(text("INSERT INTO users (uid, email) VALUES ('groce','gr@x.fr')"))
    monde.execute(text("UPDATE athletes SET user_uid = 'groce' WHERE legacy_id = 'fiche-groce'"))
    _compet(auth_as(uid="aubin"), "xhibition", [{"name": "Groce", "uid": "groce"}])
    _compet(auth_as(uid="aubin"), "autre-ff")

    assert [c["id"] for c in auth_as(uid="gusto").get("/competitions", headers=_AUTH).json()] == ["xhibition"]
    coachs = {l["coachUid"] for l in auth_as(uid="gusto").get(
        "/competitions/xhibition/availability", headers=_AUTH).json()}
    assert coachs == {"aubin", "william", "gusto"}
    assert auth_as(uid="gusto").put("/competitions/xhibition/availability", headers=_AUTH, json={
        "coachUid": "gusto", "day": "2026-11-07", "status": "available"}).status_code == 200
    # Nico (SCAPPULIFT) n'a personne à Xhibition : ni la liste, ni la matrice.
    assert "gusto" in coachs and "nico" not in coachs



# --------------------------------------------------------------------------- #
# Une bibliothèque par structure (19/09)
# --------------------------------------------------------------------------- #


def _noms(auth_as, uid, q=""):
    r = auth_as(uid=uid).get(f"/library{q}", headers=_AUTH)
    return r.status_code, sorted(e["name"] for e in r.json().get("exercices", [])) if r.status_code == 200 else None


def test_chaque_structure_lit_la_sienne_et_pas_celle_des_autres(auth_as, monde):
    monde.execute(text("INSERT INTO library_entries (structure, category, name) "
                       "VALUES ('scappulift', 'exercices', 'MUSCLE UP BARRE')"))
    assert "MUSCLE UP BARRE" in _noms(auth_as, "nico", f"?structure={_SC}")[1]
    assert "MUSCLE UP BARRE" not in _noms(auth_as, "nico", f"?structure={_FF}")[1]
    # Léo n'est que de SCAPPULIFT : la bibliothèque French Forge n'existe pas
    # pour lui — 404, comme une compétition d'ailleurs, pas « compte sans lien ».
    r = auth_as(uid="leo").get(f"/library?structure={_FF}", headers=_AUTH)
    assert (r.status_code, r.json()["code"]) == (404, "structure_inconnue")


def test_un_coach_ecrit_dans_la_bibliotheque_de_SA_structure(auth_as, monde):
    """Une entrée créée par Nico est SCAPPULIFT — le DEFAULT de la colonne est
    French Forge, et c'est précisément ce qu'il ne faut pas qu'il fasse."""
    r = auth_as(uid="nico").post("/library/entries", headers=_AUTH,
                                  json={"category": "exercices", "name": "LEVER"})
    assert r.status_code == 200
    assert monde.execute(text("SELECT structure FROM library_entries WHERE CAST(id AS text) = :i"),
                         {"i": r.json()["id"]}).scalar() == _SC
    # Écrire dans la bibliothèque d'une autre structure : refusé.
    r = auth_as(uid="nico").post(f"/library/entries?structure={_FF}", headers=_AUTH,
                                  json={"category": "exercices", "name": "LEVER"})
    assert r.status_code == 403


def test_un_renommage_ne_se_propage_qu_aux_lignes_de_SA_structure(auth_as, monde):
    """⚠️ LA PROMESSE DE LA CLÉ À TROIS COLONNES. Aubin renomme « SQUAT » chez
    French Forge : le record de Nico (French Forge) suit, celui de Léo
    (SCAPPULIFT) garde « SQUAT » — sa bibliothèque n'a pas bougé. Les records
    sont insérés SANS structure : c'est le trigger qui la pose, depuis l'athlète."""
    for fiche in ("fiche-nico", "fiche-leo"):
        monde.execute(text("INSERT INTO athlete_prs (athlete_id, movement, reps, weight_kg) "
                           "SELECT id, 'SQUAT', 1, 100 FROM athletes WHERE legacy_id = :f"), {"f": fiche})
    squat_ff = monde.execute(text("SELECT CAST(id AS text) FROM library_entries "
                                  "WHERE structure = 'french-forge' AND name = 'SQUAT'")).scalar()
    # Nico ne renomme pas l'entrée French Forge : elle n'existe pas pour lui.
    assert auth_as(uid="nico").patch(f"/library/entries/{squat_ff}", headers=_AUTH,
                                     json={"name": "BACK SQUAT"}).status_code == 404
    assert auth_as(uid="aubin").patch(f"/library/entries/{squat_ff}", headers=_AUTH,
                                      json={"name": "BACK SQUAT"}).status_code == 200
    records = dict(monde.execute(text(
        "SELECT a.legacy_id, p.movement FROM athlete_prs p JOIN athletes a ON a.id = p.athlete_id")).all())
    assert records == {"fiche-nico": "BACK SQUAT", "fiche-leo": "SQUAT"}


def test_une_ligne_ne_nomme_que_la_bibliotheque_de_sa_structure(monde):
    """Un nom qui n'existe QUE chez French Forge est refusé sur une fiche
    SCAPPULIFT : la ligne porte la structure de son athlète, et la clé la suit."""
    import pytest
    from sqlalchemy.exc import IntegrityError
    monde.execute(text("INSERT INTO library_entries (structure, category, name, competition) "
                       "VALUES ('french-forge', 'exercices', 'ZERCHER', true)"))
    monde.execute(text("INSERT INTO athlete_prs (athlete_id, movement, reps, weight_kg) "
                       "SELECT id, 'ZERCHER', 1, 100 FROM athletes WHERE legacy_id = 'fiche-nico'"))
    with pytest.raises(IntegrityError, match="_mouvement_fkey"):
        with monde.begin_nested():
            monde.execute(text("INSERT INTO athlete_prs (athlete_id, movement, reps, weight_kg) "
                               "SELECT id, 'ZERCHER', 1, 100 FROM athletes WHERE legacy_id = 'fiche-leo'"))


# --------------------------------------------------------------------------- #
# L'ÉCRAN ADMIN LIT DES LISTES BORNÉES PAR LE SERVEUR (FRE-190)
# --------------------------------------------------------------------------- #

def test_l_annuaire_des_fiches_rend_TOUTES_celles_de_la_structure_sans_programme_ni_mesure(auth_as, monde):
    """L'écran Admin y réaffecte un coach : il lui faut toutes les fiches. Mais
    seulement ce qu'il affiche — ni programme ni mesure, qu'aucun droit ne lui
    ouvre sur une fiche qu'il ne coache pas.

    MUTATION QUI ROUGIT : servir le modèle de `/mine` — `programId` et
    `currentOneRM` reviennent."""
    r = auth_as(uid="william").get("/athletes/annuaire?structure=french-forge", headers=_AUTH)
    assert r.status_code == 200, r.text[:300]
    [fiche] = r.json()
    # `supportJusquAu` n'est pas un champ de la fiche : c'est l'accès support en
    # cours de l'admin qui lit, et l'écran Admin s'en sert pour son bouton (FRE-202).
    assert fiche == {"id": "fiche-nico", "firstName": "Nico", "lastName": "", "email": None,
                     "linkedUserId": "nico", "coachId": "aubin", "kineUid": None,
                     "supportJusquAu": None}


def test_l_annuaire_des_fiches_est_reserve_a_l_admin(auth_as, monde):
    assert auth_as(uid="aubin").get("/athletes/annuaire", headers=_AUTH).status_code == 403


def test_l_admin_coach_ne_recoit_sur_mine_que_ce_qu_il_coache(auth_as, monde):
    """William est admin ET coach chez French Forge, sans athlète : sa liste est
    vide, là où l'ancienne branche admin lui rendait toutes les fiches."""
    r = auth_as(uid="william").get("/athletes/mine?structure=french-forge", headers=_AUTH)
    assert r.status_code == 200 and r.json() == []



def test_TOUT_coach_du_plateau_voit_TOUS_les_athletes_inscriptibles(auth_as, monde):
    """Sur un plateau, tous les coachs gèrent tous les inscrits (William, 24/09).
    William coache chez French Forge sans y avoir d'athlète : il voit pourtant
    Nico, qu'Aubin coache — et Aubin aussi, et les deux voient la même liste.

    MUTATION QUI ROUGIT : borner la requête à `coach_uid = appelant` — William
    ne voit plus personne."""
    _compet(auth_as(uid="aubin"), "open-ff")
    for coach in ("william", "aubin"):
        r = auth_as(uid=coach).get("/competitions/open-ff/athletes", headers=_AUTH)
        assert r.status_code == 200, r.text[:300]
        assert r.json() == [{"id": "fiche-nico", "firstName": "Nico", "lastName": "",
                             "linkedUserId": "nico", "weight": None, "gender": None}]


def test_les_inscriptibles_sont_ceux_de_la_structure_de_la_competition(auth_as, monde):
    """Léo est chez SCAPPULIFT : il n'est pas proposé sur le meet French Forge, et
    un coach French Forge ne lit pas la liste du meet SCAPPULIFT (404)."""
    _compet(auth_as(uid="aubin"), "open-ff")
    _compet(auth_as(uid="nico"), "open-sc")
    ids = [a["id"] for a in auth_as(uid="aubin").get("/competitions/open-ff/athletes", headers=_AUTH).json()]
    assert ids == ["fiche-nico"]
    assert auth_as(uid="aubin").get("/competitions/open-sc/athletes", headers=_AUTH).status_code == 404


def test_un_athlete_ne_lit_pas_la_liste_des_inscriptibles(auth_as, monde):
    _compet(auth_as(uid="aubin"), "open-ff")
    r = auth_as(uid="leo").get("/competitions/open-ff/athletes", headers=_AUTH)
    assert (r.status_code, r.json()["code"]) == (403, "reserve_aux_coachs")
