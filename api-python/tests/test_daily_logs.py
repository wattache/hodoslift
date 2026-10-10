"""Forme du jour — BASCULÉE sur Postgres (2026-07-22).

L'autorisation lit le doc athlète (mock `store` : linkedUserId/coachId) ; la
DONNÉE est en SQL.

⚠️ PORTÉ SUR LE VRAI POSTGRES (fixture `pg`) le 2026-08-18. Ce fichier tournait
sur un schéma SQLite recopié à la main, ce qui a cessé d'être une simplification
le jour où `daily_logs` a gagné une colonne `jsonb` : SQLite ne connaît ni le
type, ni `CAST(… AS jsonb)`, ni `'{}'::jsonb`. Le fichier qui teste l'écriture
aurait été le dernier à voir arriver la forme réellement écrite — exactement ce
qui était arrivé à `test_authz.py` avec `kine_uid`.

Les assertions n'ont pas bougé, seul le dispositif change. Le schéma vient
maintenant de `docs/postgres-schema.sql`, donc sa dérive rougit ici.
"""


from sqlalchemy import text

from tests.conftest import A1 as _A1


def _row(conn, date="2026-01-15"):
    return conn.execute(
        text("SELECT weight_kg, sleep_hours, water_liters, calories FROM daily_logs "
             "WHERE athlete_id = CAST(:a AS uuid) AND log_date = :d"),
        {"a": _A1, "d": date},
    ).first()


_AUTH = {"Authorization": "Bearer x"}


# --------------------------------------------------------------------------- #
# PATCH — écriture Postgres
# --------------------------------------------------------------------------- #


def test_patch_ecrit_postgres(auth_as, sql):
    client = auth_as(uid="uid-1")
    r = client.patch("/athletes/a1/daily-logs/2026-01-15", json={"sleep": 8, "weight": 80}, headers=_AUTH)
    assert r.status_code == 200
    assert r.json() == {"ok": True, "written": ["sleep", "weight"]}
    assert _row(sql) == (80, 8, None, None)


def test_patch_merge_preserve_les_autres_champs(auth_as, sql):
    client = auth_as(uid="uid-1")
    client.patch("/athletes/a1/daily-logs/2026-01-15", json={"weight": 80}, headers=_AUTH)
    client.patch("/athletes/a1/daily-logs/2026-01-15", json={"sleep": 7}, headers=_AUTH)
    # sleep ajouté SANS écraser weight (COALESCE merge, comme set(merge=True)).
    assert _row(sql) == (80, 7, None, None)


def test_patch_calories_seules(auth_as, sql):
    client = auth_as(uid="uid-1")
    r = client.patch("/athletes/a1/daily-logs/2026-01-15", json={"calories": 2500}, headers=_AUTH)
    assert r.status_code == 200
    assert r.json() == {"ok": True, "written": ["calories"]}
    assert _row(sql) == (None, None, None, 2500)


def test_patch_calories_merge_croise(auth_as, sql):
    client = auth_as(uid="uid-1")
    # patcher weight puis calories : ni l'un ni l'autre n'efface le voisin (COALESCE)
    client.patch("/athletes/a1/daily-logs/2026-01-15", json={"weight": 80}, headers=_AUTH)
    client.patch("/athletes/a1/daily-logs/2026-01-15", json={"calories": 2100}, headers=_AUTH)
    assert _row(sql) == (80, None, None, 2100)
    # et re-patcher weight n'efface pas les calories
    client.patch("/athletes/a1/daily-logs/2026-01-15", json={"weight": 81}, headers=_AUTH)
    assert _row(sql) == (81, None, None, 2100)


def test_patch_calories_hors_borne_haute_422(auth_as, sql):
    client = auth_as(uid="uid-1")
    r = client.patch("/athletes/a1/daily-logs/2026-01-15", json={"calories": 20001}, headers=_AUTH)
    assert r.status_code == 422
    assert _row(sql) is None


def test_patch_calories_negatif_422(auth_as, sql):
    client = auth_as(uid="uid-1")
    r = client.patch("/athletes/a1/daily-logs/2026-01-15", json={"calories": -1}, headers=_AUTH)
    assert r.status_code == 422
    assert _row(sql) is None


def test_patch_champ_wellness_inconnu(auth_as, sql):
    """Les anciens champs wellness (stress/soreness/form/note) ont été retirés du
    schéma : ils sont désormais rejetés comme champ inconnu (extra="forbid"), pas
    par un garde-fou « non stocké en SQL ». 422, aucune écriture."""
    client = auth_as(uid="uid-1")
    r = client.patch("/athletes/a1/daily-logs/2026-01-15", json={"form": 8}, headers=_AUTH)
    assert r.status_code == 422
    assert _row(sql) is None


def test_patch_athlete_absent_de_sql_404(auth_as, sql):
    # Athlète connu de Firestore (authz OK) mais pas chargé en SQL → 404, jamais silencieux.
    client = auth_as(uid="uid-1")
    r = client.patch("/athletes/ghost/daily-logs/2026-01-15", json={"weight": 80}, headers=_AUTH)
    assert r.status_code == 404


def test_patch_champ_inconnu(auth_as, sql):
    client = auth_as(uid="uid-1")
    r = client.patch("/athletes/a1/daily-logs/2026-01-15", json={"foo": 1}, headers=_AUTH)
    assert r.status_code == 422  # extra="forbid"


def test_patch_body_vide(auth_as, sql):
    client = auth_as(uid="uid-1")
    r = client.patch("/athletes/a1/daily-logs/2026-01-15", json={}, headers=_AUTH)
    assert r.status_code == 422


def test_patch_weight_hors_bornes(auth_as, sql):
    client = auth_as(uid="uid-1")
    r = client.patch("/athletes/a1/daily-logs/2026-01-15", json={"weight": 600}, headers=_AUTH)
    assert r.status_code == 422


def test_patch_date_mal_formee_calendaire(auth_as, sql):
    client = auth_as(uid="uid-1")
    r = client.patch("/athletes/a1/daily-logs/2026-13-40", json={"sleep": 8}, headers=_AUTH)
    assert r.status_code == 422


def test_patch_date_mal_formee_non_zero_paddee(auth_as, sql):
    client = auth_as(uid="uid-1")
    r = client.patch("/athletes/a1/daily-logs/2026-1-1", json={"sleep": 8}, headers=_AUTH)
    assert r.status_code == 422


def test_patch_owner_seul_ecrit(auth_as, sql):
    # Le coach ne peut PAS écrire la forme du jour (mode "owner").
    client = auth_as(uid="coach-1")
    r = client.patch("/athletes/a1/daily-logs/2026-01-15", json={"weight": 80}, headers=_AUTH)
    assert r.status_code == 403
    assert _row(sql) is None


def test_patch_utilisateur_non_autorise(auth_as, sql):
    client = auth_as(uid="intrus")
    r = client.patch("/athletes/a1/daily-logs/2026-01-15", json={"sleep": 8}, headers=_AUTH)
    assert r.status_code == 403
    assert _row(sql) is None


def test_patch_athlete_inexistant(auth_as, pg):
    # ⚠️ `pg` et non `sql` : la base de test VIDE, sans la fiche a1. Sans fixture
    # de base, l'authz interroge le moteur de `.env` — la production.
    client = auth_as(uid="uid-1")
    r = client.patch("/athletes/a1/daily-logs/2026-01-15", json={"sleep": 8}, headers=_AUTH)
    assert r.status_code == 404


# --------------------------------------------------------------------------- #
# GET — lecture Postgres
# --------------------------------------------------------------------------- #


def _seed_logs(conn):
    # Colonnes explicites (robuste aux ajouts de colonne). Le 10/01 porte des calories.
    cols = "(athlete_id, log_date, weight_kg, sleep_hours, water_liters, calories)"
    for valeurs in ("'2026-01-10', 72, 8, 2, 2200",
                    "'2026-01-11', 73, NULL, NULL, NULL",
                    "'2025-12-01', 70, 7, 1, NULL"):
        conn.execute(text(
            f"INSERT INTO daily_logs {cols} VALUES (CAST(:a AS uuid), {valeurs})"), {"a": _A1})


def test_get_lit_la_plage(auth_as, sql):
    _seed_logs(sql)
    client = auth_as(uid="uid-1")
    r = client.get("/athletes/a1/daily-logs?from=2026-01-01&to=2026-01-31", headers=_AUTH)
    assert r.status_code == 200
    assert r.json() == {
        "2026-01-10": {"weight": 72, "sleep": 8, "water": 2, "calories": 2200},
        "2026-01-11": {"weight": 73},  # champs NULL omis (dont calories)
    }
    # le log de décembre est hors plage → absent


def test_get_coach_autorise(auth_as, sql):
    _seed_logs(sql)
    client = auth_as(uid="coach-1")
    r = client.get("/athletes/a1/daily-logs?from=2026-01-01&to=2026-01-31", headers=_AUTH)
    assert r.status_code == 200
    assert set(r.json()) == {"2026-01-10", "2026-01-11"}


def test_get_intrus_refuse(auth_as, sql):
    client = auth_as(uid="intrus")
    r = client.get("/athletes/a1/daily-logs?from=2026-01-01&to=2026-01-31", headers=_AUTH)
    assert r.status_code == 403


def test_get_from_apres_to_422(auth_as, sql):
    client = auth_as(uid="uid-1")
    r = client.get("/athletes/a1/daily-logs?from=2026-02-01&to=2026-01-01", headers=_AUTH)
    assert r.status_code == 422


def test_get_sans_plage_defaut_30j(auth_as, sql):
    # Sans from/to : ne plante pas, renvoie un dict (30 derniers jours).
    client = auth_as(uid="uid-1")
    r = client.get("/athletes/a1/daily-logs", headers=_AUTH)
    assert r.status_code == 200
    assert isinstance(r.json(), dict)


# --------------------------------------------------------------------------- #
# LE BLOC KINÉ N'EST NI AU CONTRAT, NI EN BASE (FRE-195)
#
# Il a porté le suivi des douleurs en objet LIBRE tant que le questionnaire se
# cherchait. Il ne se cherche plus : une douleur a une zone, une intensité, un
# commentaire — et une IDENTITÉ, qui manquait ici. Elle vit dans `douleurs` /
# `douleur_logs` (`test_douleurs.py`), avec ses clés étrangères.
# --------------------------------------------------------------------------- #

def test_le_bloc_kine_est_REFUSÉ(auth_as, sql):
    """⚠️ LA SECONDE FAÇON D'ÉCRIRE LA MÊME CHOSE DOIT ÊTRE IMPOSSIBLE, pas
    seulement inutilisée. Le laisser au contrat offrirait un chemin d'écriture
    que plus aucun écran ne lit : une douleur déclarée là n'apparaîtrait ni dans
    l'onglet Douleurs, ni dans la file du staff. C'est la règle dupliquée que ce
    dépôt interdit, et `extra="forbid"` la rend inexprimable."""
    client = auth_as(uid="uid-1")
    r = client.patch("/athletes/a1/daily-logs/2026-01-15",
                     json={"kine": {"douleurs": "genou droit", "intensite": 6}},
                     headers=_AUTH)

    assert r.status_code == 422
    # Et rien n'a été écrit au passage : le refus est total, pas partiel.
    assert _row(sql) is None


def test_la_COLONNE_du_bloc_kine_n_existe_plus(sql):
    """⚠️ LE CONTRAT NE SUFFISAIT PAS, il fallait retirer la colonne.

    Vide mais présente, elle restait une seconde façon d'écrire une douleur : un
    script, un `INSERT` de reprise, une route rajoutée par distraction, et la
    donnée atterrissait là où aucun écran ne la lit. Rendre la chose IMPOSSIBLE
    vaut mieux que la garder par une règle — c'est ce que ce dépôt a appris de
    `''` contre `NULL`."""
    presentes = sql.execute(text(
        "SELECT count(*) FROM information_schema.columns "
        "WHERE table_name = 'daily_logs' "
        "AND column_name IN ('kine', 'kine_modifie_le')")).scalar()
    assert presentes == 0



# --------------------------------------------------------------------------- #
# LA PHASE DU CYCLE — un fait du jour, déclaré par l'athlète seule (FRE-173)
# --------------------------------------------------------------------------- #

def _cycle(conn, date="2026-01-15"):
    return conn.execute(
        text("SELECT cycle_phase FROM daily_logs WHERE athlete_id = CAST(:a AS uuid) AND log_date = :d"),
        {"a": _A1, "d": date},
    ).scalar()


def test_cycle_declare_par_l_athlete_lu_par_son_coach(auth_as, sql):
    """Critères 1 et 4 : la phase est en base, le coach la lit ; un jour sans
    phase ne porte pas la clé — et ne vaut donc pas `menstruation`."""
    client = auth_as(uid="uid-1")
    r = client.patch("/athletes/a1/daily-logs/2026-01-15", json={"cycle": "luteal"}, headers=_AUTH)
    assert r.status_code == 200 and r.json()["written"] == ["cycle"]
    assert _cycle(sql) == "luteal"
    client.patch("/athletes/a1/daily-logs/2026-01-16", json={"weight": 70}, headers=_AUTH)

    coach = auth_as(uid="coach-1")
    r = coach.get("/athletes/a1/daily-logs?from=2026-01-15&to=2026-01-16", headers=_AUTH)
    assert r.json() == {"2026-01-15": {"cycle": "luteal"}, "2026-01-16": {"weight": 70}}


def test_cycle_le_COACH_ne_l_ecrit_pas(auth_as, sql):
    """Critère 2 — LE GAIN QUI N'EST PAS ERGONOMIQUE. Le calendrier laissait le
    staff déclarer les règles d'une athlète (`owner_or_staff`) ; ici, `owner`."""
    client = auth_as(uid="coach-1")
    r = client.patch("/athletes/a1/daily-logs/2026-01-15", json={"cycle": "luteal"}, headers=_AUTH)
    assert r.status_code == 403
    assert _cycle(sql) is None


def test_cycle_n_est_PAS_un_signalement(auth_as, sql):
    """Critère 3 : la phase est une COLONNE, hors des signalements. Rangée avec
    eux, chaque déclaration de règles remplirait l'écran « qui va mal ? »."""
    athlete = auth_as(uid="uid-1")
    athlete.patch("/athletes/a1/daily-logs/2026-01-15", json={"cycle": "menstruation"}, headers=_AUTH)
    coach = auth_as(uid="coach-1")
    r = coach.get("/athletes/signalements?jours=365", headers=_AUTH)
    assert r.status_code == 200
    assert r.json() == []


def test_cycle_se_remplace_et_s_efface(auth_as, sql):
    """Fourni remplace, `null` fourni efface, absent ne
    touche pas — une phase déclarée par erreur doit pouvoir partir."""
    client = auth_as(uid="uid-1")
    client.patch("/athletes/a1/daily-logs/2026-01-15", json={"cycle": "follicular"}, headers=_AUTH)
    client.patch("/athletes/a1/daily-logs/2026-01-15", json={"weight": 71}, headers=_AUTH)
    assert _cycle(sql) == "follicular"                    # absent : intact
    client.patch("/athletes/a1/daily-logs/2026-01-15", json={"cycle": "ovulation"}, headers=_AUTH)
    assert _cycle(sql) == "ovulation"                     # fourni : remplacé
    r = client.patch("/athletes/a1/daily-logs/2026-01-15", json={"cycle": None}, headers=_AUTH)
    assert r.status_code == 200 and _cycle(sql) is None   # null fourni : effacé
    assert _row(sql)[0] == 71                             # et le poids est resté


def test_cycle_hors_vocabulaire_422(auth_as, sql):
    client = auth_as(uid="uid-1")
    r = client.patch("/athletes/a1/daily-logs/2026-01-15", json={"cycle": "pleine lune"}, headers=_AUTH)
    assert r.status_code == 422
    assert _cycle(sql) is None
