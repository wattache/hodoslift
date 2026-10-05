"""L'accès support d'un admin à un athlète (FRE-202) — contre un VRAI Postgres.

Ce que ces specs gardent, par ordre d'importance :
  1. qu'un accès support n'ouvre QUE son athlète, et seulement tant qu'il court —
     c'est un accès à des données de santé ;
  2. qu'elle ouvre ce que le coach ET le kiné ouvrent, bilans compris ;
  3. qu'il ne s'ouvre qu'à un admin, et à lui-même.
"""

import pytest
from sqlalchemy import text

_AUTH = {"Authorization": "Bearer x"}


@pytest.fixture
def monde(pg):
    """William est admin, coach AILLEURS. Aubin coache Sofiane et Léo ; Thomas est
    le kiné de Sofiane. Rien ne lie William à Sofiane — c'est tout le sujet."""
    pg.execute(text(
        "INSERT INTO users (uid, email, is_admin) VALUES "
        "('william','w@x.fr',true), ('aubin','a@x.fr',false), ('thomas','t@x.fr',false), "
        "('sofiane','s@x.fr',false)"))
    pg.execute(text("INSERT INTO coaches (uid, structure) VALUES ('william','elgustolift'), ('aubin','french-forge')"))
    pg.execute(text("INSERT INTO kines (uid, structure) VALUES ('thomas','french-forge')"))
    pg.execute(text(
        "INSERT INTO athletes (id, legacy_id, first_name, coach_uid, user_uid, kine_uid, structure) VALUES "
        "('aaaaaaaa-0000-0000-0000-000000000001','sofiane','Sofiane','aubin','sofiane','thomas','french-forge'), "
        "('aaaaaaaa-0000-0000-0000-000000000002','leo','Léo','aubin',NULL,NULL,'french-forge')"))
    pg.execute(text(
        "INSERT INTO programs (id, coach_uid, athlete_id) VALUES "
        "('p-sofiane','aubin','aaaaaaaa-0000-0000-0000-000000000001'), "
        "('p-leo','aubin','aaaaaaaa-0000-0000-0000-000000000002')"))
    return pg


def _statuts(c, athlete="sofiane", programme="p-sofiane"):
    """Ce que l'appelant peut lire : le programme (coach), les bilans (kiné, le
    plus fermé au coach), les notes de suivi (kiné seul)."""
    return (c.get(f"/programs/{programme}/structure", headers=_AUTH).status_code,
            c.get(f"/athletes/{athlete}/bilans", headers=_AUTH).status_code,
            c.get(f"/athletes/{athlete}/notes-kine", headers=_AUTH).status_code)


def test_sans_acces_support_l_admin_n_ouvre_rien(auth_as, monde):
    """Le point de départ : être admin ne donne aucun droit sur une fiche."""
    assert _statuts(auth_as(uid="william")) == (403, 403, 403)


def test_l_acces_support_ouvre_ce_que_le_coach_ET_le_kine_ouvrent(auth_as, monde):
    """Le programme comme le coach, les bilans et les notes comme le kiné.

    MUTATION QUI ROUGIT : ne compter l'accès support que dans `est_staff` — les
    notes de suivi (mode `kine`) restent fermées."""
    c = auth_as(uid="william")
    r = c.post("/athletes/sofiane/support", json={}, headers=_AUTH)
    assert r.status_code == 200, r.text[:300]
    assert r.json()["supportJusquAu"]
    assert _statuts(c) == (200, 200, 200)


def test_l_acces_support_n_ouvre_QUE_son_athlete(auth_as, monde):
    """Léo a le même coach que Sofiane : l'accès support à Sofiane ne l'ouvre pas.

    MUTATION QUI ROUGIT : oublier `s.athlete_id` dans le fragment — tout accès
    support ouvre tout."""
    c = auth_as(uid="william")
    c.post("/athletes/sofiane/support", json={}, headers=_AUTH)
    assert c.get("/programs/p-leo/structure", headers=_AUTH).status_code == 403


def test_ferme_il_ne_donne_plus_rien(auth_as, monde):
    c = auth_as(uid="william")
    c.post("/athletes/sofiane/support", json={}, headers=_AUTH)
    assert c.delete("/athletes/sofiane/support", headers=_AUTH).status_code == 200
    assert _statuts(c) == (403, 403, 403)


def test_expire_il_ne_donne_plus_rien(auth_as, monde):
    """L'expiration, sans geste : la fin est passée, l'accès tombe.

    MUTATION QUI ROUGIT : retirer `s.fin > clock_timestamp()` du fragment — l'accès
    ne s'éteint jamais."""
    c = auth_as(uid="william")
    c.post("/athletes/sofiane/support", json={}, headers=_AUTH)
    monde.execute(text("UPDATE acces_support SET debut = now() - interval '2 days', fin = now() - interval '1 day'"))
    assert _statuts(c) == (403, 403, 403)


def test_l_athlete_ouvert_entre_dans_mine_avec_sa_fin(auth_as, monde):
    """C'est ce qui le fait entrer dans le sélecteur, et ce qui dit au front ce
    que l'admin peut y faire."""
    c = auth_as(uid="william")
    assert c.get("/athletes/mine", headers=_AUTH).json() == []
    c.post("/athletes/sofiane/support", json={"heures": 2}, headers=_AUTH)
    [fiche] = c.get("/athletes/mine", headers=_AUTH).json()
    assert fiche["id"] == "sofiane" and fiche["supportJusquAu"]
    c.delete("/athletes/sofiane/support", headers=_AUTH)
    assert c.get("/athletes/mine", headers=_AUTH).json() == []


def test_ouvert_deux_fois_il_se_PROLONGE(auth_as, monde):
    c = auth_as(uid="william")
    c.post("/athletes/sofiane/support", json={"heures": 1}, headers=_AUTH)
    c.post("/athletes/sofiane/support", json={"heures": 48}, headers=_AUTH)
    assert monde.execute(text("SELECT count(*) FROM acces_support")).scalar() == 1
    assert monde.execute(text("SELECT fin > now() + interval '47 hours' FROM acces_support")).scalar()


def test_un_coach_non_admin_ne_s_ouvre_pas_d_acces_support(auth_as, monde):
    r = auth_as(uid="aubin").post("/athletes/leo/support", json={}, headers=_AUTH)
    assert (r.status_code, r.json()["code"]) == (403, "reserve_aux_admins")


def test_la_duree_est_bornee_a_une_semaine(auth_as, monde):
    r = auth_as(uid="william").post("/athletes/sofiane/support", json={"heures": 169}, headers=_AUTH)
    assert r.status_code == 422


def test_une_fiche_inconnue_est_introuvable(auth_as, monde):
    assert auth_as(uid="william").post("/athletes/personne/support", json={}, headers=_AUTH).status_code == 404
