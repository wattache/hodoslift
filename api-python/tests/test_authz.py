"""Autorisation athlète/programme — les dépendances appelées HORS HTTP.

On appelle `require_athlete_access` / `require_program_access` directement en
passant les claims : ce fichier teste la RÉSOLUTION et ses verdicts (403/404),
pas le câblage FastAPI — celui-ci est couvert par la grille rôle × route de
`test_role_kine.py`.

⚠️ PORTÉ SUR LE VRAI POSTGRES (fixture `pg`) le 2026-08-17. Il tournait sur un
schéma SQLite recopié à la main :

    CREATE TABLE athletes (id, legacy_id, coach_uid, user_uid)

— quatre colonnes sur seize, sans une seule clé étrangère. Ce stub a cessé
d'être une simplification le jour où `athletes` a gagné `kine_uid` : le fichier
qui teste l'autorisation aurait été le DERNIER à voir arriver une colonne
d'autorisation. Les assertions n'ont pas bougé d'un caractère, seul le dispositif
change — c'est le critère de non-régression de FRE-52.
"""

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.socle.authz import require_athlete_access, require_program_access

# uuid fixe : `athletes.id` est un vrai uuid en Postgres, plus la chaîne 'ua1'.
_A1 = "aaaaaaaa-1111-1111-1111-111111111111"


@pytest.fixture
def sql(pg):
    """athlète a1 : géré par coach-1, lié à uid-1, suivi par kine-1."""
    pg.execute(text(
        "INSERT INTO users (uid, email) VALUES "
        "('coach-1','c@x.fr'), ('uid-1','a@x.fr'), ('kine-1','k@x.fr'), ('intrus','i@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1')"))
    pg.execute(text("INSERT INTO kines (uid) VALUES ('kine-1')"))
    pg.execute(text(
        "INSERT INTO athletes (id, legacy_id, coach_uid, user_uid, kine_uid) "
        "VALUES (CAST(:id AS uuid), 'a1', 'coach-1', 'uid-1', 'kine-1')"), {"id": _A1})
    # programme p1 : coach-1, pointe l'athlète a1 (par son uuid interne).
    pg.execute(text(
        "INSERT INTO programs (id, coach_uid, athlete_id) "
        "VALUES ('p1', 'coach-1', CAST(:id AS uuid))"), {"id": _A1})
    return pg


def _claims(uid):
    return {"uid": uid, "email": f"{uid}@x.com"}


# --------------------------------------------------------------------------- #
# Athlète — owner / staff / owner_or_staff
#
# ⚠️ IL N'Y A PLUS DE MODE « coach » : sur l'athlète qu'il suit, le kiné a
# exactement les droits du coach (2026-08-18), fiche comprise. C'était l'inverse
# sous FRE-52, où le rôle kiné n'ouvrait que la lecture du programme.
#
# ⚠️ LE RÔLE, LUI, DÉCIDE TOUJOURS DE TOUT — mais de QUELS athlètes, pas de QUOI.
# C'est le lien `athletes.kine_uid` qui ouvre, et un kiné en règle n'a rien sur un
# athlète qu'il ne suit pas. C'est ce que prouve `test_un_kine_ETRANGER…`.
# --------------------------------------------------------------------------- #


def test_owner_autorise_le_lie(sql):
    access = require_athlete_access("owner")(athlete_id="a1", claims=_claims("uid-1"))
    assert access.athlete_id == "a1"


def test_owner_refuse_autre(sql):
    with pytest.raises(HTTPException) as exc:
        require_athlete_access("owner")(athlete_id="a1", claims=_claims("intrus"))
    assert exc.value.status_code == 403


def test_owner_ignore_le_coach(sql):
    # coach-1 gère a1 mais n'en est pas l'athlète lié → owner refuse.
    with pytest.raises(HTTPException) as exc:
        require_athlete_access("owner")(athlete_id="a1", claims=_claims("coach-1"))
    assert exc.value.status_code == 403


def test_staff_autorise_le_coach_gerant(sql):
    access = require_athlete_access("staff")(athlete_id="a1", claims=_claims("coach-1"))
    assert access.athlete_id == "a1"


def test_staff_refuse_le_lie(sql):
    """L'athlète n'est pas son propre staff : ces routes-là programment."""
    with pytest.raises(HTTPException) as exc:
        require_athlete_access("staff")(athlete_id="a1", claims=_claims("uid-1"))
    assert exc.value.status_code == 403


def test_owner_or_staff_autorise_les_deux(sql):
    assert require_athlete_access("owner_or_staff")(athlete_id="a1", claims=_claims("uid-1")).athlete_id == "a1"
    assert require_athlete_access("owner_or_staff")(athlete_id="a1", claims=_claims("coach-1")).athlete_id == "a1"


def test_owner_or_staff_refuse_tiers(sql):
    with pytest.raises(HTTPException) as exc:
        require_athlete_access("owner_or_staff")(athlete_id="a1", claims=_claims("intrus"))
    assert exc.value.status_code == 403


@pytest.mark.parametrize("mode", ["owner", "staff", "owner_or_staff"])
def test_athlete_absent_404(sql, mode):
    with pytest.raises(HTTPException) as exc:
        require_athlete_access(mode)(athlete_id="absent", claims=_claims("uid-1"))
    assert exc.value.status_code == 404


# ⚠️ `test_athlete_dict_forme_firestore` VIVAIT ICI, ET SON OBJET A DISPARU AVEC
# `AthleteAccess.athlete` (FRE-143). Il figeait la forme d'un dictionnaire aux
# clés façon-Firestore — `{"coachId": …, "linkedUserId": …}` — que le commentaire
# de `authz.py` reconnaissait lui-même n'être lu par personne, et qu'on gardait
# « par sécurité ».
#
# C'est le motif inverse d'un test utile : il ne protégeait aucun consommateur,
# il empêchait de retirer l'attribut. Un test qui n'a pour effet que de rendre du
# code mort irretirable est un COÛT, pas un filet. Les deux sont partis ensemble.
#
# Ce que les rôles, eux, promettent est vérifié plus bas, et abondamment.


@pytest.mark.parametrize("mode", ["staff", "owner_or_staff"])
def test_le_kine_entre_par_les_modes_STAFF(sql, mode):
    """Les PR, objectifs, journal et événements de l'athlète suivi. Sans eux, les
    onglets Suivi et Calendrier seraient vides pour le kiné alors qu'il écrit la
    prog — un « pareil que le coach » à moitié livré."""
    assert require_athlete_access(mode)(
        athlete_id="a1", claims=_claims("kine-1")).athlete_id == "a1"


def test_la_FICHE_de_l_athlete_aussi(sql):
    """Y COMPRIS l'identité de l'athlète — nom, email, photo, 1RM. C'est le seul
    endroit qu'on avait d'abord gardé au coach, et la distinction est retombée :
    deux régimes à retenir pour une frontière que l'usage n'a pas réclamée."""
    assert require_athlete_access("staff")(
        athlete_id="a1", claims=_claims("kine-1")).athlete_id == "a1"


def test_le_kine_n_est_pas_pour_autant_l_ATHLETE(sql):
    """`owner` reste ce qu'il dit : la personne elle-même. Le kiné soigne
    l'athlète, il ne l'EST pas — et la nuance porte, parce que `owner` garde des
    routes que même le coach n'a pas."""
    with pytest.raises(HTTPException) as exc:
        require_athlete_access("owner")(athlete_id="a1", claims=_claims("kine-1"))
    assert exc.value.status_code == 403


# --------------------------------------------------------------------------- #
# Programme — coach / coach_or_athlete / coach_or_athlete_or_kine
# --------------------------------------------------------------------------- #


def test_program_coach_autorise(sql):
    access = require_program_access("coach")(program_id="p1", claims=_claims("coach-1"))
    assert access.program_id == "p1"


def test_program_coach_refuse_tiers(sql):
    with pytest.raises(HTTPException) as exc:
        require_program_access("coach")(program_id="p1", claims=_claims("intrus"))
    assert exc.value.status_code == 403


def test_program_coach_refuse_athlete_lie_en_mode_coach(sql):
    # l'athlète lié n'a PAS accès en mode coach.
    with pytest.raises(HTTPException) as exc:
        require_program_access("coach")(program_id="p1", claims=_claims("uid-1"))
    assert exc.value.status_code == 403


def test_program_coach_or_athlete_autorise_les_deux(sql):
    assert require_program_access("coach_or_athlete")(program_id="p1", claims=_claims("coach-1")).program_id == "p1"
    # athlète lié (via programs.athlete_id → athletes.user_uid)
    assert require_program_access("coach_or_athlete")(program_id="p1", claims=_claims("uid-1")).program_id == "p1"


def test_program_coach_or_athlete_refuse_tiers(sql):
    with pytest.raises(HTTPException) as exc:
        require_program_access("coach_or_athlete")(program_id="p1", claims=_claims("intrus"))
    assert exc.value.status_code == 403


@pytest.mark.parametrize("mode", ["coach", "coach_or_athlete", "coach_or_athlete_or_kine"])
def test_program_absent_404(sql, mode):
    with pytest.raises(HTTPException) as exc:
        require_program_access(mode)(program_id="absent", claims=_claims("coach-1"))
    assert exc.value.status_code == 404


# ⚠️ `test_program_dict_forme_firestore` A SUIVI `ProgramAccess.program`
# (FRE-143), pour la même raison que son jumeau plus haut.
#
# Il portait pourtant une vraie observation, qui mérite de survivre au test :
# `athleteId` y était un objet `UUID` et non une chaîne, parce que `athletes.id`
# est un uuid Postgres que psycopg rend tel quel. L'ancien dispositif SQLite le
# montrait en `str`, si bien qu'un consommateur qui aurait comparé cette valeur
# à un id venu de l'URL aurait réussi en test et échoué en production.
#
# La leçon vaut toujours pour tout ce qui sort de la base — elle est simplement
# rangée là où elle sert, dans `conftest.py`, plutôt que gardée en vie par un
# test qui vérifiait un attribut que personne ne lisait.


# --------------------------------------------------------------------------- #
# Le rôle kiné dans la résolution (FRE-52)
# --------------------------------------------------------------------------- #


def test_le_kine_passe_TOUS_les_modes_de_l_athlete_qu_il_suit(sql):
    """Le kiné programme comme le coach sur l'athlète qu'il suit (2026-08-18) :
    les trois modes doivent le laisser entrer.

    ⚠️ CE TEST DISAIT L'INVERSE — « le kiné obtient la lecture et RIEN d'autre ».
    C'était la position de FRE-52, prudente parce qu'aucun droit d'écriture
    n'avait alors été décidé. Il l'a été depuis, et l'ouverture tient en UNE
    ligne : le tableau `_MODES`. Aucune route n'a bougé, ce que le module
    promettait justement dans son en-tête."""
    for mode in ("coach", "coach_or_athlete", "coach_or_athlete_or_kine"):
        access = require_program_access(mode)(program_id="p1", claims=_claims("kine-1"))
        assert access.roles == frozenset({"kine"}), mode


def test_le_kine_de_l_athlete_est_autorise_en_lecture(sql):
    access = require_program_access("coach_or_athlete_or_kine")(
        program_id="p1", claims=_claims("kine-1"))
    assert access.program_id == "p1"


def test_un_kine_declare_mais_ETRANGER_est_refuse(sql):
    """Être kiné ne suffit pas — il faut être LE kiné de CET athlète. C'est la
    différence entre un rôle global et un lien nominatif, et c'est tout l'intérêt
    de `athletes.kine_uid` : `kine-2` est un kiné en règle, il ne suit
    simplement pas a1."""
    sql.execute(text("INSERT INTO users (uid, email) VALUES ('kine-2','k2@x.fr')"))
    sql.execute(text("INSERT INTO kines (uid) VALUES ('kine-2')"))
    with pytest.raises(HTTPException) as exc:
        require_program_access("coach_or_athlete_or_kine")(
            program_id="p1", claims=_claims("kine-2"))
    assert exc.value.status_code == 403


def test_les_roles_sont_exposes_a_la_route(sql):
    """`roles` est le SEUL canal par lequel un rôle sort de la résolution — le
    périmètre par champ le consomme, et FRE-53 fera de même."""
    for uid, attendu in (("coach-1", {"coach"}), ("uid-1", {"athlete"}), ("kine-1", {"kine"})):
        access = require_program_access("coach_or_athlete_or_kine")(
            program_id="p1", claims=_claims(uid))
        assert access.roles == frozenset(attendu), uid


def test_un_meme_uid_peut_porter_DEUX_roles(sql):
    """Un athlète qui est aussi son propre kiné (ou un coach qui suit son athlète)
    porte les deux rôles à la fois. `roles` est un ENSEMBLE pour ça : le
    périmètre par champ doit pouvoir en faire l'union, pas s'arrêter au premier."""
    # La FK exige que coach-1 soit un kiné DÉCLARÉ avant de pouvoir être désigné.
    sql.execute(text("INSERT INTO kines (uid) VALUES ('coach-1')"))
    sql.execute(text("UPDATE athletes SET kine_uid = 'coach-1' WHERE legacy_id = 'a1'"))
    access = require_program_access("coach_or_athlete_or_kine")(
        program_id="p1", claims=_claims("coach-1"))
    assert access.roles == frozenset({"coach", "kine"})


def test_un_athlete_sans_kine_ne_donne_le_role_a_personne(sql):
    """`kine_uid IS NULL` est l'état de tous les athlètes au déploiement. Une
    comparaison mal écrite (NULL == NULL, ou un `in` sur une liste vide) donnerait
    le rôle kiné à quelqu'un — ici, à personne."""
    sql.execute(text("UPDATE athletes SET kine_uid = NULL WHERE legacy_id = 'a1'"))
    with pytest.raises(HTTPException) as exc:
        require_program_access("coach_or_athlete_or_kine")(
            program_id="p1", claims=_claims("kine-1"))
    assert exc.value.status_code == 403
    # …et le coach, lui, n'a rien perdu.
    access = require_program_access("coach_or_athlete_or_kine")(
        program_id="p1", claims=_claims("coach-1"))
    assert access.roles == frozenset({"coach"})


def test_un_meme_uid_peut_etre_COACH_ET_ATHLETE(sql):
    """⚠️ LE CAS LE PLUS COURANT EN PRODUCTION, ET AUCUN HARNAIS NE LE
    CONSTRUISAIT (FRE-142). Mesuré sur Neon : les 4 coachs sont athlètes. Le seed
    e2e réel sépare `e2e-coach` et `e2e-athlete-user` ; le test ci-dessus
    combine coach et kiné. William est coach ET athlète de son propre programme,
    et toute règle branchée sur le rôle lui passait au vert sans être éprouvée —
    FRE-118 et FRE-127 ont chacune laissé passer un défaut par là.

    `roles` doit porter LES DEUX : le périmètre par champ en fait l'union."""
    sql.execute(text("UPDATE athletes SET user_uid = 'coach-1' WHERE legacy_id = 'a1'"))
    access = require_program_access("coach_or_athlete_or_kine")(
        program_id="p1", claims=_claims("coach-1"))
    assert access.roles == frozenset({"coach", "athlete"})
