"""Où en est l'athlète sur un objectif de bloc (FRE-254) — la règle, sans base."""
from app.entrainement.avancement_objectifs import avancement


def ligne(semaine, charge, name="SQUAT", tier=1, variant=None, format=None, tempo=None):
    return {"semaine": semaine, "charge": charge, "name": name, "tier": tier,
            "variant": variant or [], "format": format, "tempo": tempo}


def objectif(**k):
    base = {"exercise": "SQUAT", "variant": "", "format": "", "tempo": "", "sets": "4", "reps": "4",
            "weight_min": "90", "weight_max": "", "atteint_le": None, "source": "principe", "tier": 1}
    return {**base, **k}


def test_en_route_depuis_la_premiere_semaine_mesuree():
    """La jauge part de S1 (80), pas de zéro : 85 sur 80 → 90, c'est la moitié du chemin.
    MUTATION QUI ROUGIT : une jauge calculée depuis zéro (0,94)."""
    a = avancement(objectif(), [ligne(1, 80), ligne(2, 85), ligne(3, 82.5)])
    assert a == {"etat": "en_route", "fait": 85.0, "semaine": 2, "depart": 80.0, "reste": 5.0, "jauge": 0.5}


def test_seul_le_principe_de_l_objectif_compte_son_tier_et_sa_forme():
    """Mouvement, variantes, format, tempo, TIER : un squat tier 2 ou en tempo 310
    n'est pas le principe de l'objectif. Séries et reps n'y entrent pas : elles
    progressent. MUTATIONS QUI ROUGISSENT : ignorer le tier ; ignorer le tempo."""
    lignes = [ligne(1, 80), ligne(2, 100, tier=2), ligne(2, 95, tempo="310"), ligne(3, 87.5)]
    assert avancement(objectif(), lignes)["fait"] == 87.5


def test_un_renfo_n_a_pas_de_tier():
    o = objectif(exercise="HIP THRUST", source="renfo", tier=None, weight_min="120")
    lignes = [ligne(1, 100, "HIP THRUST", tier=None), ligne(1, 140, "HIP THRUST", tier=1)]
    assert avancement(o, lignes)["fait"] == 100.0


def test_une_fourchette_se_rejoint_par_sa_borne_basse():
    o = objectif(exercise="CHIN UP", weight_min="1,25", weight_max="2,5")
    assert avancement(o, [ligne(1, 1.25, "CHIN UP")])["etat"] == "dans_la_cible"
    assert avancement(o, [ligne(1, 0, "CHIN UP")])["etat"] == "en_route"


def test_rien_n_est_invente():
    """Non lié : sans ligne. Lié sans série faite : sans mesure. Sans charge
    visée : sans cible. La coche prime sur tout."""
    assert avancement(objectif(source=None, tier=None), [ligne(1, 85)])["etat"] == "sans_ligne"
    assert avancement(objectif(), []) == {"etat": "sans_mesure", "fait": None, "semaine": None,
                                         "depart": None, "reste": None, "jauge": None}
    assert avancement(objectif(weight_min="", weight_max=""), [ligne(1, 80)])["etat"] == "sans_cible"
    assert avancement(objectif(atteint_le="2026-10-18"), [])["etat"] == "atteint"
