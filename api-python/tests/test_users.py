"""Identité / users / rôles — contre un VRAI Postgres.

⚠️ PORTÉ depuis SQLite le 2026-08-17 (FRE-52). Le stub déclarait `users`,
`coaches` et un `athletes` à quatre colonnes, et il fallait un
`PRAGMA foreign_keys=ON` pour que les FK existent du tout — c'est-à-dire que le
409 du démote, qui EST le comportement testé, ne tenait qu'à une ligne de
configuration du test. Sur Postgres les FK ne s'activent pas, elles sont là.

Le port a aussi révélé ce que le stub cachait : `athletes.coach_uid` est NOT
NULL, et les tests inséraient des athlètes sans coach.

Les rôles COACH et KINÉ sont testés côte à côte, et c'est délibéré : ils sont la
même chose (une ligne dans une table d'extension de `users`), toute divergence
entre les deux routes serait un piège pour FRE-64.
"""

import pytest
from sqlalchemy import text

from app.socle.authz import is_admin, is_coach

_AUTH = {"Authorization": "Bearer x"}
# uuid fixe : `athletes.id` est un vrai uuid, plus un INTEGER de stub.
_A1 = "aaaaaaaa-1111-1111-1111-111111111111"


@pytest.fixture
def sql(pg):
    return pg


def _user(conn, uid, email=None, is_admin_=False):
    conn.execute(
        text("INSERT INTO users (uid, email, is_admin) VALUES (:u, :e, :a)"),
        {"u": uid, "e": email or f"{uid}@x.com", "a": is_admin_},
    )


def _make_coach(conn, uid):
    _user(conn, uid)
    conn.execute(text("INSERT INTO coaches (uid) VALUES (:u)"), {"u": uid})


def _make_kine(conn, uid):
    _user(conn, uid)
    conn.execute(text("INSERT INTO kines (uid) VALUES (:u)"), {"u": uid})


def _athlete(conn, legacy, coach_uid, user_uid=None, kine_uid=None, athlete_id=_A1):
    """⚠️ `coach_uid` est NOT NULL en vrai — un athlète a toujours un coach. Le
    stub SQLite l'ignorait, et les tests semaient des athlètes sans personne."""
    conn.execute(text(
        "INSERT INTO athletes (id, legacy_id, coach_uid, user_uid, kine_uid) "
        "VALUES (CAST(:i AS uuid), :l, :c, :u, :k)"),
        {"i": athlete_id, "l": legacy, "c": coach_uid, "u": user_uid, "k": kine_uid})


def _compte(conn, table, uid) -> int:
    return conn.execute(
        text(f"SELECT count(*) FROM {table} WHERE uid = :u"), {"u": uid}).scalar()


# --------------------------------------------------------------------------- #
# is_coach / is_admin depuis Postgres
# --------------------------------------------------------------------------- #


def test_is_coach_postgres(sql):
    _make_coach(sql, "c1")
    _user(sql, "u1")
    assert is_coach("c1") is True
    assert is_coach("u1") is False  # user sans ligne coaches
    assert is_coach("inconnu") is False


def test_is_admin_postgres(sql):
    _user(sql, "boss", is_admin_=True)
    _user(sql, "lambda", is_admin_=False)
    assert is_admin("boss") is True
    assert is_admin("lambda") is False
    assert is_admin("inconnu") is False  # pas de ligne → False


# --------------------------------------------------------------------------- #
# GET /users/me — get-or-create
# --------------------------------------------------------------------------- #


def test_me_cree_la_ligne_au_premier_appel(auth_as, sql):
    r = auth_as(uid="newbie", email="Neo@X.com").get("/users/me", headers=_AUTH)
    assert r.status_code == 200
    assert r.json() == {
        "uid": "newbie", "email": "neo@x.com", "displayName": "neo",  # préfixe email
        "isCoach": False, "isKine": False, "isAdmin": False, "athleteId": None,
        # Aucun réglage encore : les défauts de l'app.
        "preferences": {"progression": None},
        # Aucune structure : ni rôle, ni fiche, ni admin (FRE-13).
        "structures": [],
    }
    assert _compte(sql, "users", "newbie") == 1


def test_me_ne_clobbe_pas_la_ligne_existante(auth_as, sql):
    sql.execute(text(
        "INSERT INTO users (uid, email, display_name, is_admin) "
        "VALUES ('boss', 'boss@x.com', 'Le Boss', true)"))
    r = auth_as(uid="boss", email="autre@x.com").get("/users/me", headers=_AUTH)
    # renvoie la ligne EXISTANTE (display_name/is_admin/email intacts), pas le token
    assert r.json()["displayName"] == "Le Boss"
    assert r.json()["isAdmin"] is True
    assert r.json()["email"] == "boss@x.com"


def test_me_survit_a_un_NOUVEL_uid_sur_un_email_DEJA_connu(auth_as, sql):
    """⚠️ LE 500 DE FRE-77, sur la toute première route que le front appelle.

    `_UPSERT_ME_SQL` fait `ON CONFLICT (uid) DO NOTHING` — la clé PRIMAIRE. Face
    à `users_email_key`, un uid neuf portant un email déjà présent partait donc
    en UniqueViolation → IntegrityError → 500, et la personne lisait « Serveur
    injoignable » : un message qui annonce un incident passager alors que la
    panne était PERMANENTE pour elle.

    Le déclencheur est celui de FRE-76 — compte Google recréé, second compte,
    autre fournisseur. Les deux défauts se produisent dans la même seconde :
    celui-ci si l'uid est neuf pour brokkr, l'autre s'il a déjà sa ligne.

    L'unicité a été retirée (migration `2026-08-22_users_email_sans_unicite.sql`)
    plutôt que contournée : aucune requête ne lit `users` par email, `uid` est la
    clé, et Firebase autorise lui-même deux comptes à partager une adresse."""
    sql.execute(text(
        "INSERT INTO users (uid, email, display_name) "
        "VALUES ('kevin-v1', 'kevin@x.com', 'Kévin')"))

    r = auth_as(uid="kevin-v2", email="kevin@x.com").get("/users/me", headers=_AUTH)

    assert r.status_code == 200, r.text
    assert r.json()["uid"] == "kevin-v2"
    # Les deux lignes coexistent — c'est l'état que Firebase produit, la base
    # n'a pas à le refuser.
    assert _compte(sql, "users", "kevin-v1") == 1
    assert _compte(sql, "users", "kevin-v2") == 1


def test_deux_comptes_SANS_EMAIL_coexistent(auth_as, sql):
    """Le même défaut par l'autre bout : le routeur écrit `''` quand le jeton n'a
    pas d'adresse, et `''` collisionnait avec lui-même. Deux comptes sans email
    suffisaient — sans qu'aucune adresse ne soit vraiment en double."""
    for uid in ("anonyme-1", "anonyme-2"):
        r = auth_as(uid=uid, email="").get("/users/me", headers=_AUTH)
        assert r.status_code == 200, r.text
        assert r.json()["email"] == ""


def test_me_isCoach_et_athleteId_derives(auth_as, sql):
    _make_coach(sql, "coach-athlete")
    # cet uid est AUSSI un athlète lié (et son propre coach — le cas existe).
    _athlete(sql, "ath-9", coach_uid="coach-athlete", user_uid="coach-athlete")
    r = auth_as(uid="coach-athlete", email="ca@x.com").get("/users/me", headers=_AUTH)
    body = r.json()
    assert body["isCoach"] is True  # via coaches
    assert body["athleteId"] == "ath-9"  # dérivé de athletes.user_uid


def test_me_athleteId_null_si_pas_athlete(auth_as, sql):
    r = auth_as(uid="pur-user", email="p@x.com").get("/users/me", headers=_AUTH)
    assert r.json()["athleteId"] is None


def test_me_isKine_derive_de_la_table(auth_as, sql):
    """`isKine` est DÉRIVÉ, jamais stocké sur `users` : un booléen recopié finit
    par diverger du lien réel — c'est pour ça que `is_coach` a quitté `users`."""
    _make_kine(sql, "kine-1")
    r = auth_as(uid="kine-1", email="k@x.com").get("/users/me", headers=_AUTH)
    assert r.json()["isKine"] is True
    assert r.json()["isCoach"] is False      # les deux rôles sont indépendants


# --------------------------------------------------------------------------- #
# PUT /users/{uid}/coach — promote / demote
# --------------------------------------------------------------------------- #


def test_promote_coach(auth_as, sql):
    _user(sql, "admin", is_admin_=True)
    _user(sql, "target")
    r = auth_as(uid="admin").put("/users/target/coach", json={"isCoach": True}, headers=_AUTH)
    assert r.status_code == 200
    assert r.json() == {"ok": True, "isCoach": True}
    assert _compte(sql, "coaches", "target") == 1


def test_promote_idempotent(auth_as, sql):
    _user(sql, "admin", is_admin_=True)
    _make_coach(sql, "target")  # déjà coach
    r = auth_as(uid="admin").put("/users/target/coach", json={"isCoach": True}, headers=_AUTH)
    assert r.status_code == 200  # ON CONFLICT DO NOTHING


def test_demote_coach(auth_as, sql):
    _user(sql, "admin", is_admin_=True)
    _make_coach(sql, "target")  # coach sans athlète géré
    r = auth_as(uid="admin").put("/users/target/coach", json={"isCoach": False}, headers=_AUTH)
    assert r.status_code == 200
    assert r.json() == {"ok": True, "isCoach": False}
    assert _compte(sql, "coaches", "target") == 0


def test_demote_coach_avec_athlete_409(auth_as, sql):
    _user(sql, "admin", is_admin_=True)
    _make_coach(sql, "busy-coach")
    _athlete(sql, "a1", coach_uid="busy-coach")   # gère encore un athlète → RESTRICT
    r = auth_as(uid="admin").put("/users/busy-coach/coach", json={"isCoach": False}, headers=_AUTH)
    assert r.status_code == 409
    assert _compte(sql, "coaches", "busy-coach") == 1   # toujours coach (rollback)


def test_coach_uid_inconnu_404(auth_as, sql):
    _user(sql, "admin", is_admin_=True)
    r = auth_as(uid="admin").put("/users/fantome/coach", json={"isCoach": True}, headers=_AUTH)
    assert r.status_code == 404


def test_coach_set_non_admin_403(auth_as, sql):
    _user(sql, "pas-admin")  # is_admin=false
    _user(sql, "target")
    r = auth_as(uid="pas-admin").put("/users/target/coach", json={"isCoach": True}, headers=_AUTH)
    assert r.status_code == 403


# --------------------------------------------------------------------------- #
# PUT /users/{uid}/kine — le JUMEAU (FRE-52)
#
# Les mêmes cas que pour le coach, un par un. Ce n'est pas de la duplication de
# confort : ces deux routes doivent rester interchangeables dans leur forme, et
# c'est ce tableau-là qui le prouvera le jour où l'une des deux dérivera.
# --------------------------------------------------------------------------- #


def test_promote_kine(auth_as, sql):
    _user(sql, "admin", is_admin_=True)
    _user(sql, "target")
    r = auth_as(uid="admin").put("/users/target/kine", json={"isKine": True}, headers=_AUTH)
    assert r.status_code == 200
    assert r.json() == {"ok": True, "isKine": True}
    assert _compte(sql, "kines", "target") == 1


def test_promote_kine_idempotent(auth_as, sql):
    _user(sql, "admin", is_admin_=True)
    _make_kine(sql, "target")  # déjà kiné
    r = auth_as(uid="admin").put("/users/target/kine", json={"isKine": True}, headers=_AUTH)
    assert r.status_code == 200
    assert _compte(sql, "kines", "target") == 1


def test_demote_kine(auth_as, sql):
    _user(sql, "admin", is_admin_=True)
    _make_kine(sql, "target")  # kiné sans athlète suivi
    r = auth_as(uid="admin").put("/users/target/kine", json={"isKine": False}, headers=_AUTH)
    assert r.status_code == 200
    assert r.json() == {"ok": True, "isKine": False}
    assert _compte(sql, "kines", "target") == 0


def test_demote_kine_qui_suit_encore_409(auth_as, sql):
    """LE cas qui justifie le RESTRICT. Sans lui, rétrograder un kiné détacherait
    ses suivis en silence : l'athlète perdrait son kiné sans que personne ne
    l'ait décidé, et le 200 rendu affirmerait le contraire."""
    _user(sql, "admin", is_admin_=True)
    _make_coach(sql, "coach-1")
    _make_kine(sql, "busy-kine")
    _athlete(sql, "a1", coach_uid="coach-1", kine_uid="busy-kine")
    r = auth_as(uid="admin").put("/users/busy-kine/kine", json={"isKine": False}, headers=_AUTH)
    assert r.status_code == 409
    # toujours kiné (rollback) ET l'athlète a toujours son suivi : le refus n'a
    # rien détaché au passage.
    assert _compte(sql, "kines", "busy-kine") == 1
    assert sql.execute(text(
        "SELECT kine_uid FROM athletes WHERE legacy_id = 'a1'")).scalar() == "busy-kine"


def test_kine_uid_inconnu_404(auth_as, sql):
    _user(sql, "admin", is_admin_=True)
    r = auth_as(uid="admin").put("/users/fantome/kine", json={"isKine": True}, headers=_AUTH)
    assert r.status_code == 404
    assert _compte(sql, "kines", "fantome") == 0


def test_kine_set_non_admin_403(auth_as, sql):
    """Poser un rôle est un geste d'ADMIN. Un coach ne se fabrique pas un kiné —
    il choisit parmi ceux qui sont déclarés."""
    _make_coach(sql, "coach-1")      # coach, mais pas admin
    _user(sql, "target")
    r = auth_as(uid="coach-1").put("/users/target/kine", json={"isKine": True}, headers=_AUTH)
    assert r.status_code == 403
    assert _compte(sql, "kines", "target") == 0


def test_kine_set_refuse_un_champ_inconnu(auth_as, sql):
    """Contrat NEUF : `extra="forbid"` dès le premier jour."""
    _user(sql, "admin", is_admin_=True)
    _user(sql, "target")
    r = auth_as(uid="admin").put(
        "/users/target/kine", json={"isKine": True, "role": "kine"}, headers=_AUTH)
    assert r.status_code == 422
    assert _compte(sql, "kines", "target") == 0


def test_les_deux_roles_sont_independants(auth_as, sql):
    """Un même utilisateur peut être coach ET kiné, et rétrograder l'un ne touche
    pas l'autre. Deux tables, deux lignes — un `role` scalaire sur `users` aurait
    forcé à choisir."""
    _user(sql, "admin", is_admin_=True)
    _user(sql, "les-deux")
    c = auth_as(uid="admin")
    c.put("/users/les-deux/coach", json={"isCoach": True}, headers=_AUTH)
    c.put("/users/les-deux/kine", json={"isKine": True}, headers=_AUTH)
    assert (_compte(sql, "coaches", "les-deux"), _compte(sql, "kines", "les-deux")) == (1, 1)

    c.put("/users/les-deux/kine", json={"isKine": False}, headers=_AUTH)
    assert (_compte(sql, "coaches", "les-deux"), _compte(sql, "kines", "les-deux")) == (1, 0)


# --------------------------------------------------------------------------- #
# GET /users — annuaire admin
# --------------------------------------------------------------------------- #


def test_list_users_admin(auth_as, sql):
    _user(sql, "admin", email="admin@x.com", is_admin_=True)
    _make_coach(sql, "coach-1")  # user + coaches
    _user(sql, "lambda", email="lambda@x.com")
    r = auth_as(uid="admin").get("/users", headers=_AUTH)
    assert r.status_code == 200
    by_uid = {u["uid"]: u for u in r.json()}
    assert by_uid["coach-1"]["isCoach"] is True  # dérivé de coaches
    assert by_uid["lambda"]["isCoach"] is False
    assert by_uid["admin"]["isAdmin"] is True
    assert by_uid["lambda"]["isAdmin"] is False


def test_list_users_rend_isKine(auth_as, sql):
    """Une route qui POSE un rôle sans qu'aucune lecture ne le rende est une
    écriture à l'aveugle : l'admin ne peut ni vérifier ce qu'il a fait, ni savoir
    à qui il l'a fait."""
    _user(sql, "admin", email="admin@x.com", is_admin_=True)
    _make_kine(sql, "kine-1")
    _make_coach(sql, "coach-1")
    by_uid = {u["uid"]: u for u in auth_as(uid="admin").get("/users", headers=_AUTH).json()}
    assert by_uid["kine-1"]["isKine"] is True
    assert by_uid["coach-1"]["isKine"] is False
    assert by_uid["kine-1"]["isCoach"] is False


def test_aller_retour_du_role_kine(auth_as, sql):
    """L'ALLER-RETOUR D'ÉCHO, dès le premier jour de la route : ce que l'annuaire
    rend doit pouvoir être réécrit tel quel. C'est l'invariant que toute la
    famille de défauts de FRE-12 violait — l'écriture qui refuse ce que sa propre
    lecture vient de rendre."""
    _user(sql, "admin", email="admin@x.com", is_admin_=True)
    _make_kine(sql, "kine-1")
    c = auth_as(uid="admin")
    lu = {u["uid"]: u for u in c.get("/users", headers=_AUTH).json()}["kine-1"]

    r = c.put(f"/users/{lu['uid']}/kine", json={"isKine": lu["isKine"]}, headers=_AUTH)
    assert r.status_code == 200, r.text
    # …et l'écho n'a rien changé : réécrire ce qu'on a lu est un no-op.
    relu = {u["uid"]: u for u in c.get("/users", headers=_AUTH).json()}["kine-1"]
    assert relu == lu


def test_list_users_non_admin_403(auth_as, sql):
    _make_coach(sql, "coach-1")  # coach mais pas admin
    r = auth_as(uid="coach-1").get("/users", headers=_AUTH)
    assert r.status_code == 403


# --------------------------------------------------------------------------- #
# LES CLÉS DE SORTIE, figées AVANT les `response_model` (FRE-70)
#
# ⚠️ Un modèle de sortie FILTRE la réponse : un champ qu'il ne déclare pas
# disparaît sans erreur ni journal. Aucune autre spec de ce fichier ne le verrait
# — elles affirment `isCoach`, `uid`, jamais l'ensemble.
# --------------------------------------------------------------------------- #


def test_me_porte_TOUS_ses_champs(auth_as, sql):
    body = auth_as(uid="u1").get("/users/me", headers=_AUTH).json()
    assert set(body) == {"uid", "email", "displayName", "isCoach", "isKine",
                         "isAdmin", "athleteId", "structures", "preferences"}


def test_l_annuaire_des_comptes_porte_TOUS_ses_champs(auth_as, sql):
    _user(sql, "boss", "boss@x.fr", is_admin_=True)
    body = auth_as(uid="boss").get("/users", headers=_AUTH).json()
    assert body, "l'annuaire est vide : ce test ne prouverait rien"
    assert set(body[0]) == {"uid", "email", "displayName", "isCoach", "isKine", "isAdmin",
                            "coachStructure", "kineStructure", "athleteStructures"}


# --------------------------------------------------------------------------- #
# CE QUI RETIENT UN COACH — FRE-24
#
# ⚠️ LE MESSAGE ACCUSAIT LA MAUVAISE CONTRAINTE. Il parlait d'athlètes et de
# programmes alors que QUATRE tables retiennent un coach. Le cas réel du 11/08 :
# un ancien compte coachait 0 athlète et 0 programme, et le message envoyait donc
# chercher là où il n'y avait rien — le vrai blocage était 38 entrées de
# bibliothèque et 1 compétition dont il était l'auteur.
# --------------------------------------------------------------------------- #


def _entree_biblio(conn, nom, auteur):
    conn.execute(
        text("INSERT INTO library_entries (category, name, created_by) "
             # ⚠️ IDEMPOTENT : `conftest` sème un référentiel minimal (FRE-123),
             # et ce test ajoute ses propres entrées par-dessus.
             "VALUES ('exercices', :n, :u) "
             "ON CONFLICT (structure, category, name) DO UPDATE SET created_by = EXCLUDED.created_by"),
        {"n": nom, "u": auteur})


def _competition(conn, legacy, auteur):
    conn.execute(
        text("INSERT INTO competitions (legacy_id, name, start_date, end_date, "
             "max_attempts, created_by) "
             "VALUES (:l, 'Open', '2026-03-01', '2026-03-01', 3, :u) ON CONFLICT DO NOTHING"),
        {"l": legacy, "u": auteur})


def test_le_409_NOMME_ce_qui_retient_meme_sans_aucun_athlete(auth_as, sql):
    """L'ESPRIT DU CAS DU 11/08 : le coach ne gère personne, et c'est ce qu'il a
    CRÉÉ qui le retient. Le message doit le dire plutôt que d'envoyer chercher du
    côté des athlètes, où il n'y a rien."""
    _user(sql, "admin", is_admin_=True)
    _make_coach(sql, "ancien")
    _competition(sql, "open-1", "ancien")

    r = auth_as(uid="admin").put("/users/ancien/coach", json={"isCoach": False}, headers=_AUTH)
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert "1 compétition" in detail
    # …et surtout, il n'envoie PAS chercher des athlètes qui n'existent pas.
    assert "athlète" not in detail


def test_les_entrees_de_bibliotheque_ne_RETIENNENT_PLUS(auth_as, sql):
    """⚠️ LE CAS EXACT DU 11/08, ET IL DOIT MAINTENANT PASSER. Un compte retenu
    par ses seules entrées de bibliothèque se rétrograde.

    Depuis la refonte, toute entrée est PARTAGÉE : `created_by` n'est plus qu'une
    trace d'auteur, écrite et jamais lue. Une trace d'audit que personne ne
    consulte n'a pas à empêcher un départ — et quatre coachs étaient retenus par
    ce seul lien, l'un d'eux par 81 entrées.

    ⚠️ CE TEST NE PROUVAIT RIEN AVANT LA MIGRATION DU 20/08, et c'est ce qui rend
    l'histoire intéressante : `docs/postgres-schema.sql` déclarait déjà
    `SET NULL`, la production était en `NO ACTION`. Les tests validaient donc un
    monde plus permissif que le vrai."""
    _user(sql, "admin", is_admin_=True)
    _make_coach(sql, "auteur")
    _entree_biblio(sql, "TIRAGE MENTON", "auteur")
    _entree_biblio(sql, "ROWING BUSTE", "auteur")

    r = auth_as(uid="admin").put("/users/auteur/coach", json={"isCoach": False}, headers=_AUTH)
    assert r.status_code == 200
    assert _compte(sql, "coaches", "auteur") == 0
    # Les entrées survivent, orphelines — c'est ce que `SET NULL` veut dire.
    assert sql.execute(text("SELECT count(*) FROM library_entries "
                            "WHERE name IN ('TIRAGE MENTON', 'ROWING BUSTE')")).scalar_one() == 2


def test_le_409_enumere_TOUT_ce_qui_retient(auth_as, sql):
    """⚠️ POURQUOI UN PRÉ-CONTRÔLE PLUTÔT QUE L'`IntegrityError` : Postgres
    n'annonce que la PREMIÈRE contrainte rencontrée. Compter permet de tout dire
    d'un coup, donc de ne faire qu'un aller-retour à l'utilisateur au lieu de
    quatre."""
    _user(sql, "admin", is_admin_=True)
    _make_coach(sql, "charge")
    _athlete(sql, _A1, coach_uid="charge")
    _competition(sql, "open-2", "charge")

    detail = auth_as(uid="admin").put(
        "/users/charge/coach", json={"isCoach": False}, headers=_AUTH).json()["detail"]
    assert "1 athlète" in detail and "1 compétition" in detail


def test_le_message_ACCORDE_ses_libellés(auth_as, sql):
    """« 1 athlètes » se lit comme une machine, et ce message est montré à un
    coach. Le pluriel n'est pas un détail quand c'est la seule phrase qu'il aura
    pour comprendre ce qui bloque."""
    _user(sql, "admin", is_admin_=True)
    _make_coach(sql, "un-seul")
    _athlete(sql, _A1, coach_uid="un-seul")

    detail = auth_as(uid="admin").put(
        "/users/un-seul/coach", json={"isCoach": False}, headers=_AUTH).json()["detail"]
    assert "1 athlète " in detail and "athlètes" not in detail


def test_le_code_ne_ment_PLUS_sur_la_cause(auth_as, sql):
    """⚠️ LE VOCABULAIRE AVAIT HÉRITÉ DU MENSONGE. Le code s'appelait
    `coach_a_des_athletes` : quand le vrai blocage était ailleurs, il était aussi
    faux que le texte — et un front qui branche dessus aurait proposé la mauvaise
    suite. Un seul code large, honnête, et le détail qui énumère."""
    _user(sql, "admin", is_admin_=True)
    _make_coach(sql, "compet-only")
    _competition(sql, "open-3", "compet-only")

    assert auth_as(uid="admin").put(
        "/users/compet-only/coach", json={"isCoach": False},
        headers=_AUTH).json()["code"] == "coach_encore_reference"


# --------------------------------------------------------------------------- #
# PATCH /users/me/preferences — les réglages d'affichage suivent la personne
# --------------------------------------------------------------------------- #


def test_une_preference_se_pose_et_se_relit_sur_me(auth_as, sql):
    c = auth_as(uid="laura", email="laura@x.com")
    r = c.patch("/users/me/preferences", json={"progression": "chiffres"}, headers=_AUTH)
    assert r.status_code == 200
    assert r.json() == {"progression": "chiffres"}
    assert c.get("/users/me", headers=_AUTH).json()["preferences"] == {"progression": "chiffres"}


def test_une_ancienne_forme_en_base_ne_casse_pas_la_lecture(auth_as, sql):
    """⚠️ La préférence a d'abord été posée PAR MODE (`{"athlete": …, "coach": …}`)
    avant de devenir un seul rendu (28/09). Une ligne qui porte encore l'ancienne
    forme se lit comme « pas de préférence », et la prochaine écriture la remplace."""
    sql.execute(text("INSERT INTO users (uid, email, preferences) VALUES ('nico', 'n@x.com', "
                     "CAST(:p AS jsonb))"), {"p": '{"progression": {"athlete": "chiffres", "coach": "courbe"}}'})
    c = auth_as(uid="nico", email="n@x.com")
    assert c.get("/users/me", headers=_AUTH).json()["preferences"] == {"progression": None}
    assert c.patch("/users/me/preferences", json={"progression": "courbe"}, headers=_AUTH).json() == {"progression": "courbe"}


def test_un_rendu_inconnu_est_refuse(auth_as, sql):
    r = auth_as(uid="laura", email="laura@x.com").patch(
        "/users/me/preferences", json={"progression": "camembert"}, headers=_AUTH)
    assert r.status_code == 422
