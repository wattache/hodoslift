"""Fixture d'arbre d'entraînement — des FORMES réelles, des valeurs inventées.

Recensée sur les 9 902 lignes chargées le 2026-08-14, puis REGÉNÉRÉE. Aucune
donnée d'athlète réelle n'entre dans le dépôt : dans un milieu aussi petit, un
poids de corps croisé avec un record de compétition désigne une personne. Les
noms, les charges et les dates ci-dessous sont inventés ; seules les FORMES sont
vraies.

POURQUOI PARTIR DU RÉEL. La production contient des cas qu'on n'inventerait pas :
des reps en fourchette (1 138 lignes), des RPE non numériques (483), des charges
« PDC » (8), une granularité écrite à la virgule (4 blocs), des séances sans
identifiant (57). Une fixture écrite d'imagination ne couvre que ce à quoi on a
déjà pensé.

ET POURQUOI NE PAS S'Y ARRÊTER. La production ne contient AUCUNE ligne à
plusieurs variantes ni marquée warmup/rehab : les deux fonctionnalités attendent
sur leurs branches (FRE-33, FRE-10). Un générateur fidèle au réel serait donc
aveugle exactement là où le code bouge. Ces cas sont ajoutés à la main, et
signalés comme tels.

Il y a 387 signatures distinctes dans la vraie donnée : on ne les couvre pas
toutes, et ça n'aurait pas de sens. On couvre les DIMENSIONS (chaque champ
optionnel présent au moins une fois) et les PIÈGES.

⚠️ C'est une FONCTION, pas une constante : `load()` consomme l'arbre en le
vidant (`pop`), donc deux tests qui partageraient le même objet verraient le
second recevoir une coquille.
"""


def _prescription(**surcharges) -> dict:
    """Le socle d'une ligne, tous champs à None — on ne surcharge que l'utile."""
    base = {
        "variant": None, "format": None, "cluster_mode": None, "cluster_rest": None,
        "tempo": None, "sets": "3", "reps": "8", "reps_unit": "count", "weight": "60",
        "weight_locked": False, "assistance": None, "aimed_rpe": "7", "rest": "120",
        "coach_note": None, "increment": None, "increment_unit": "kg",
    }
    return {**base, **surcharges}


def _exercice(position: int, name: str, **surcharges) -> dict:
    realise = {
        "reps_done": None, "weight_done": None, "rest_actual": None, "felt_rpe": None,
        "felt_rpe_by_set": None, "athlete_feedback": None, "link": None,
        "group_id": None, "kind": None, "tier": None,
    }
    return {"position": position, "name": name, **realise, **_prescription(), **surcharges}


def arbre_de_test(program_id: str = "prog-test") -> list[dict]:
    """Un programme complet, dans la forme que produit `extract()`."""
    return [{
        "program_id": program_id,
        "legacy_id": "macro-1",
        "number": 1,
        "name": "Prépa test",
        "training_frequency": 4,
        "coach_notes": "Montée en charge",
        "blocs": [
            {
                "legacy_id": "bloc-1",
                "number": 1,
                "name": "Accumulation",
                "start_date": "2026-01-05", "end_date": "2026-02-01",
                "day_split": [{"day": "J1", "tiers": {"SQUAT": 1, "PULL UP": 2}}],
                "selected_principals": ["PULL UP", "SQUAT"],
                # PIÈGE RÉEL : la virgule ET le point cohabitent dans la même base.
                "granularity": {"SQUAT": "2,5", "MUSCLE UP": "0.5"},
                "s1_start_date": "2026-01-05", "s1_end_date": "2026-01-11",
                "principes": [
                    {"position": 0, "name": "SQUAT", "tier": 1,
                     **_prescription(variant=["COMP"], sets="5", reps="5", weight="100")},
                    {"position": 1, "name": "PULL UP", "tier": 2,
                     **_prescription(tempo="30X0", increment="2.5")},
                ],
                "accessoires": [
                    # Bi-set défini DANS la base : deux lignes, un même groupe.
                    {"position": 0, "name": "CURL BICEPS", "day": "J1",
                     "group_id": "biset-base-1", **_prescription(weight="12")},
                    {"position": 1, "name": "EXTENSION TRICEPS", "day": "J1",
                     "group_id": "biset-base-1", **_prescription(weight="8")},
                ],
                "semaines": [
                    {
                        "legacy_id": "sem-1", "number": 1, "name": None, "hidden": False,
                        "start_date": "2026-01-05", "end_date": "2026-01-11",
                        "athlete_weight_kg": 72.5, "athlete_height_cm": 178.0,
                        "seances": [
                            {
                                "legacy_id": "seance-1", "position": 0, "name": "Lundi — Bas",
                                "session_date": "2026-01-05", "form_of_the_day": 4,
                                "exercices": [
                                    # — formes RÉELLES, relevées en production —
                                    _exercice(0, "SQUAT", variant=["COMP"], tier=1, sets="5",
                                              reps="5", weight="100", weight_locked=True,
                                              felt_rpe="8", felt_rpe_by_set=["7.5", "8", "8"]),
                                    # RPE non numérique : 483 lignes réelles en portent un.
                                    _exercice(1, "PULL UP", tier=2, reps="8/10",
                                              felt_rpe="Sub5", reps_done="7"),
                                    # Charge au poids du corps : 8 lignes réelles.
                                    _exercice(2, "DIPS", weight="PDC", aimed_rpe=None),
                                    # Bi-set : deux lignes consécutives, même groupe.
                                    _exercice(3, "CURL BICEPS", group_id="biset-s1", weight="12"),
                                    _exercice(4, "EXTENSION TRICEPS", group_id="biset-s1", weight="8"),
                                    # Isométrie : la durée vit dans `reps`, unité `sec`.
                                    _exercice(5, "CHINESE PLANK", reps="60", reps_unit="sec",
                                              weight="20"),

                                    # — cas ABSENTS de la production, ajoutés à la main —
                                    # FRE-33 : plusieurs variantes cumulées.
                                    _exercice(6, "SQUAT", variant=["HIGH BAR", "PAUSE"], tier=1),
                                    # FRE-10 : la nature de la ligne.
                                    _exercice(7, "BAND PULL APART", kind="warmup", weight=None),
                                    _exercice(8, "STRAIGHT LEG RAISE", kind="rehab", weight=None),
                                    # Groupe à TROIS membres : le réel plafonne à deux.
                                    _exercice(9, "FACE PULL", group_id="triset-1"),
                                    _exercice(10, "REVERSE FLY", group_id="triset-1"),
                                    _exercice(11, "SHRUG", group_id="triset-1"),
                                ],
                            },
                        ],
                    },
                    # Semaine SANS séance : 3 cas réels. Une semaine créée puis
                    # laissée vide reste une semaine.
                    {
                        "legacy_id": "sem-2", "number": 2, "name": "Décharge", "hidden": True,
                        "start_date": None, "end_date": None,
                        "athlete_weight_kg": None, "athlete_height_cm": None,
                        "seances": [],
                    },
                ],
            },
            # Bloc SANS BASE : 14 cas réels. Un bloc dont les semaines ont été
            # écrites à la main n'a jamais eu de modèle.
            {
                "legacy_id": "bloc-2", "number": 2, "name": None,
                "start_date": None, "end_date": None,
                "day_split": None, "selected_principals": None, "granularity": None,
                "s1_start_date": None, "s1_end_date": None,
                "principes": [], "accessoires": [], "semaines": [],
            },
        ],
    }]


# Ce que l'arbre ci-dessus contient, pour que les tests l'affirment plutôt que
# de le recompter — un décompte recalculé dans le test ne prouverait rien.
COMPTES = {
    "macros": 1, "blocs": 2, "semaines": 2, "seances": 1,
    "exercices": 12, "principes": 2, "accessoires": 2,
}
