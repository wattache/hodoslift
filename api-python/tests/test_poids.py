"""LE SUIVI DE POIDS PAR SEMAINE (29/09) — le Google Sheet de Maxence, dans l'app.

Ce que ces specs gardent :
  1. Les semaines de sept jours partent du DÉPART posé, la moyenne des pesées et
     l'écart depuis le départ — kg et % — se calculent ICI, pas au front.
  2. Sans départ, la première semaine pesée sert de référence, et l'écran
     saura qu'il n'y a pas de départ (`depart: None`).
  3. La cible est la pesée de la PROCHAINE compétition où l'athlète est inscrit
     avec une catégorie fermée ; le théorique est la droite du départ à la
     cible, bornée à la cible.
  4. Le départ se pose par l'athlète ou son coach, jamais dans le futur.
"""
from datetime import date, timedelta

from sqlalchemy import text

from app.suivi.metier_poids import semaines, theorique_le
from tests.conftest import A1 as _A1

_AUTH = {"Authorization": "Bearer x"}
AUJOURDHUI = date.today()


def _peser(conn, jour: date, kg: float) -> None:
    conn.execute(text("INSERT INTO daily_logs (athlete_id, log_date, weight_kg) VALUES (CAST(:a AS uuid), :d, :kg)"),
                 {"a": _A1, "d": jour, "kg": kg})


def _competition(conn, *, dans_jours: int, categorie: str | None = "-94", genre: str = "M") -> None:
    jour = AUJOURDHUI + timedelta(days=dans_jours)
    cid = conn.execute(text(
        "INSERT INTO competitions (name, start_date, end_date, created_by) "
        "VALUES ('Open', :d, :d, 'coach-1') RETURNING id"), {"d": jour}).scalar()
    conn.execute(text(
        "INSERT INTO competition_participants (competition_id, athlete_id, name, gender, weight_category) "
        "VALUES (:c, CAST(:a AS uuid), 'A', CAST(:g AS gender), :cat)"),
        {"c": cid, "a": _A1, "g": genre, "cat": categorie})


# --------------------------------------------------------------------------- #
# LE CALCUL, PUR
# --------------------------------------------------------------------------- #

def test_les_semaines_partent_du_depart_et_les_ecarts_se_comptent_depuis_lui():
    """Le bloc du Sheet : départ 98 kg le 07/09, sept pesées la première semaine,
    quatre la deuxième. MUTATION QUI ROUGIT : compter l'écart depuis la semaine
    précédente au lieu du départ — S2 donnerait −0,52 au lieu de −1,85."""
    depart = {"kg": 98.0, "date": date(2026, 9, 7)}
    pesees = [(date(2026, 9, 7 + i), kg) for i, kg in enumerate([98, 97.9, 97.1, 96.3, 96.2, 95.5, 95.7])]
    pesees += [(date(2026, 9, 17), 95.9), (date(2026, 9, 18), 96.1), (date(2026, 9, 19), 96.6), (date(2026, 9, 20), 96.0)]
    r = semaines(pesees, depart=depart, cible=None, aujourdhui=date(2026, 9, 20))
    assert r["reference"] == 98.0
    s1, s2 = r["semaines"]
    assert (s1["numero"], s1["du"], s1["au"], s1["jours"]) == (1, date(2026, 9, 7), date(2026, 9, 13), 7)
    assert s1["moyenne"] == 96.67
    assert (s1["ecartKg"], s1["ecartPct"]) == (-1.33, -1.36)
    assert (s2["jours"], s2["moyenne"], s2["ecartKg"], s2["ecartPct"]) == (4, 96.15, -1.85, -1.89)
    assert s1["theorique"] is None and s2["theorique"] is None


def test_une_semaine_sans_pesee_reste_dans_le_tableau_vide():
    depart = {"kg": 100.0, "date": date(2026, 9, 1)}
    r = semaines([(date(2026, 9, 16), 99.0)], depart=depart, cible=None, aujourdhui=date(2026, 9, 16))
    assert [s["moyenne"] for s in r["semaines"]] == [None, None, 99.0]
    assert [s["ecartKg"] for s in r["semaines"]] == [None, None, -1.0]


def test_sans_depart_la_premiere_semaine_pesee_est_la_reference():
    pesees = [(date(2026, 9, 7), 98.0), (date(2026, 9, 8), 97.0), (date(2026, 9, 14), 96.0)]
    r = semaines(pesees, depart=None, cible=None, aujourdhui=date(2026, 9, 14))
    assert r["reference"] == 97.5
    assert [s["ecartKg"] for s in r["semaines"]] == [0.0, -1.5]


def test_le_theorique_est_la_droite_du_depart_a_la_cible_bornee_a_la_cible():
    """MUTATION QUI ROUGIT : ne pas borner — après la pesée, la droite continue de descendre."""
    depart = {"kg": 100.0, "date": date(2026, 9, 1)}
    cible = {"kg": 93.0, "date": date(2026, 9, 29), "competition": "Open", "categorie": "-93"}
    assert theorique_le(date(2026, 9, 15), depart, cible) == 96.5
    assert theorique_le(date(2026, 9, 29), depart, cible) == 93.0
    assert theorique_le(date(2026, 10, 20), depart, cible) == 93.0
    assert theorique_le(date(2026, 8, 20), depart, cible) == 100.0
    # Une cible antérieure au départ ne trace rien.
    assert theorique_le(date(2026, 9, 15), depart, {**cible, "date": date(2026, 8, 1)}) is None


def test_le_theorique_se_lit_au_dernier_jour_de_la_semaine_et_aujourdhui_pour_celle_en_cours():
    depart = {"kg": 100.0, "date": date(2026, 9, 1)}
    cible = {"kg": 93.0, "date": date(2026, 9, 29), "competition": "Open", "categorie": "-93"}
    r = semaines([(date(2026, 9, 7), 98.0), (date(2026, 9, 10), 97.0)], depart=depart, cible=cible, aujourdhui=date(2026, 9, 10))
    s1, s2 = r["semaines"]
    assert s1["theorique"] == 98.5      # le 7/09 : 6 jours sur 28
    assert s2["theorique"] == 97.75     # le 10/09, pas le 14 : la semaine n'est pas finie
    assert s2["ecartTheorique"] == -0.75


def test_vers_la_cible_ce_qui_reste_et_le_chemin_fait():
    """Le chiffre qu'on veut voir BAISSER (William, 29/09). MUTATION QUI ROUGIT :
    compter le chemin depuis la semaine précédente — S2 donnerait 14 % au lieu
    de 43 %."""
    depart = {"kg": 100.0, "date": date(2026, 9, 1)}
    cible = {"kg": 93.0, "date": date(2026, 9, 29), "competition": "Open", "categorie": "-93"}
    r = semaines([(date(2026, 9, 2), 98.0), (date(2026, 9, 9), 97.0)], depart=depart, cible=cible, aujourdhui=date(2026, 9, 9))
    s1, s2 = r["semaines"]
    assert (s1["resteKg"], s1["cheminPct"]) == (5.0, 28.6)
    assert (s2["resteKg"], s2["cheminPct"]) == (4.0, 42.9)
    # Sans cible : rien vers quoi aller.
    sans = semaines([(date(2026, 9, 2), 98.0)], depart=depart, cible=None, aujourdhui=date(2026, 9, 9))
    assert (sans["semaines"][0]["resteKg"], sans["semaines"][0]["cheminPct"]) == (None, None)
    # Déjà sous la cible au départ : le reste se lit (négatif), le chemin n'a pas de sens.
    leger = semaines([(date(2026, 9, 2), 92.0)], depart={"kg": 92.5, "date": date(2026, 9, 1)}, cible=cible, aujourdhui=date(2026, 9, 9))
    assert (leger["semaines"][0]["resteKg"], leger["semaines"][0]["cheminPct"]) == (-1.0, None)


# --------------------------------------------------------------------------- #
# LA ROUTE, SUR LA VRAIE BASE
# --------------------------------------------------------------------------- #

def test_le_depart_se_pose_par_l_athlete_et_se_relit(auth_as, sql):
    c = auth_as(uid="uid-1")
    r = c.put("/athletes/a1/poids/depart", json={"kg": 98, "date": "2026-09-07"}, headers=_AUTH)
    assert r.status_code == 200, r.text
    assert sql.execute(text("SELECT poids_depart_kg, poids_depart_le FROM athletes WHERE legacy_id = 'a1'")).first() == (98, date(2026, 9, 7))
    lu = c.get("/athletes/a1/poids/semaines", headers=_AUTH).json()
    assert lu["depart"] == {"kg": 98.0, "date": "2026-09-07"}
    assert lu["reference"] == 98.0

    assert c.delete("/athletes/a1/poids/depart", headers=_AUTH).status_code == 200
    assert c.get("/athletes/a1/poids/semaines", headers=_AUTH).json()["depart"] is None


def test_le_coach_peut_poser_le_depart_mais_pas_un_inconnu(auth_as, sql):
    assert auth_as(uid="coach-1").put("/athletes/a1/poids/depart", json={"kg": 98, "date": "2026-09-07"}, headers=_AUTH).status_code == 200
    assert auth_as(uid="quelqu-un").put("/athletes/a1/poids/depart", json={"kg": 98, "date": "2026-09-07"}, headers=_AUTH).status_code == 403


def test_un_depart_dans_le_futur_est_refuse(auth_as, sql):
    demain = (AUJOURDHUI + timedelta(days=1)).isoformat()
    r = auth_as(uid="uid-1").put("/athletes/a1/poids/depart", json={"kg": 98, "date": demain}, headers=_AUTH)
    assert r.status_code == 422
    assert r.json()["code"] == "date_future"


def test_les_semaines_se_lisent_avec_la_cible_de_la_prochaine_competition(auth_as, sql):
    """Le chemin réel : pesées en base, départ posé, inscription à une compétition
    dans 28 jours en −93. La cible vient de la catégorie, pas d'une saisie."""
    depart_le = AUJOURDHUI - timedelta(days=13)
    for i, kg in enumerate([100, 99.5, 99, 98.5, 98, 97.5, 97]):
        _peser(sql, depart_le + timedelta(days=i), kg)
    _peser(sql, depart_le + timedelta(days=7), 96.5)
    _competition(sql, dans_jours=28, categorie="-94")
    # Une compétition PASSÉE ne vise plus rien, même avec une catégorie.
    _competition(sql, dans_jours=-10, categorie="-87")
    c = auth_as(uid="coach-1")
    assert c.put("/athletes/a1/poids/depart", json={"kg": 100, "date": depart_le.isoformat()}, headers=_AUTH).status_code == 200

    lu = c.get("/athletes/a1/poids/semaines", headers=_AUTH).json()
    assert lu["cible"] == {"kg": 94.0, "date": (AUJOURDHUI + timedelta(days=28)).isoformat(), "competition": "Open", "categorie": "-94"}
    assert len(lu["semaines"]) == 2
    s1, s2 = lu["semaines"]
    assert (s1["jours"], s1["moyenne"], s1["ecartKg"], s1["ecartPct"]) == (7, 98.5, -1.5, -1.5)
    assert (s2["jours"], s2["moyenne"], s2["ecartKg"]) == (1, 96.5, -3.5)
    assert s1["theorique"] is not None and s1["theorique"] < 100


def test_une_categorie_ouverte_ne_vise_rien(auth_as, sql):
    _competition(sql, dans_jours=10, categorie="+101")
    c = auth_as(uid="coach-1")
    assert c.get("/athletes/a1/poids/semaines", headers=_AUTH).json()["cible"] is None


def test_un_athlete_inconnu_rend_404(auth_as, sql):
    assert auth_as(uid="coach-1").get("/athletes/inconnu/poids/semaines", headers=_AUTH).status_code == 404
