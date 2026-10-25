"""Où en est l'athlète sur un objectif de bloc (FRE-254) — la règle, sans base."""
from app.entrainement.avancement_objectifs import avancement


def ligne(semaine, charge, series=4, reps=4, name="SQUAT", variant=None, format=None, tempo=None):
    return {"semaine": semaine, "charge": charge, "series": series, "reps": reps, "name": name,
            "variant": variant or [], "format": format, "tempo": tempo}


def objectif(**k):
    base = {"exercise": "SQUAT", "variant": "", "format": "", "tempo": "", "sets": "4", "reps": "4",
            "weight_min": "90", "weight_max": "", "atteint_le": None}
    return {**base, **k}


def test_en_route_depuis_la_premiere_semaine_mesuree():
    """La jauge part de S1 (80), pas de zéro : 85 sur 80 → 90, c'est la moitié du chemin.
    MUTATION QUI ROUGIT : une jauge calculée depuis zéro (0,94)."""
    a = avancement(objectif(), [ligne(1, 80), ligne(2, 85), ligne(3, 82.5)])
    assert a == {"etat": "en_route", "fait": 85.0, "semaine": 2, "depart": 80.0, "reste": 5.0, "jauge": 0.5}


def test_le_schema_doit_couvrir_celui_de_l_objectif():
    """Un 4×2 lourd ne dit rien d'un 4×4. MUTATION QUI ROUGIT : ignorer les reps."""
    a = avancement(objectif(), [ligne(1, 80), ligne(2, 100, reps=2)])
    assert a["fait"] == 80.0


def test_la_variante_et_le_format_distinguent_deux_objectifs_du_meme_mouvement():
    o = objectif(exercise="PULL UP", variant="", format="CLUSTER", sets="3", reps="2", weight_min="10")
    lignes = [ligne(1, 7.5, 3, 2, "PULL UP", format="CLUSTER"), ligne(2, 12, 3, 2, "PULL UP", ["NEUTRAL"], "CLUSTER"),
              ligne(2, 15, 3, 2, "PULL UP")]
    assert avancement(o, lignes)["fait"] == 7.5


def test_une_fourchette_se_rejoint_par_sa_borne_basse():
    """1,25 fait pour 1,25–2,5 : dans la cible. Sous la borne basse : en route."""
    o = objectif(exercise="CHIN UP", sets="3", reps="3", weight_min="1,25", weight_max="2,5")
    assert avancement(o, [ligne(1, 1.25, 3, 3, "CHIN UP")])["etat"] == "dans_la_cible"
    assert avancement(o, [ligne(1, 0, 3, 3, "CHIN UP")])["etat"] == "en_route"


def test_rien_n_est_invente():
    """Sans ligne comparable : sans mesure, aucune jauge. Sans charge visée : sans cible.
    La coche prime sur tout."""
    assert avancement(objectif(), []) == {"etat": "sans_mesure", "fait": None, "semaine": None,
                                         "depart": None, "reste": None, "jauge": None}
    assert avancement(objectif(weight_min="", weight_max=""), [ligne(1, 80)])["etat"] == "sans_cible"
    assert avancement(objectif(atteint_le="2026-10-18"), [])["etat"] == "atteint"
