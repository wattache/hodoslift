"""Le 1RM ESTIMÉ d'une série, déduit de sa charge, de ses reps et de son RPE.

C'est LE moteur, pour la carte 1RM comme pour la progression du Tracker : la
table de Tuchscherer (RTS) vit ici, une fois. Le front ne calcule aucun 1RM.

⚠️ Le résultat est en charge TOTALE : sur un mouvement au poids du corps, c'est
à l'appelant de rendre le LEST (`total - pdc`), l'unité de `weight_kg` et du
1RM de programmation.
"""

from datetime import date

# La table RTS est une DIAGONALE : `reps` à `rpe` vaut `reps + (10 - rpe)` reps
# à RPE 10, et ce total avance d'un demi-point par demi-RPE. Une liste suffit,
# indexée par `2 × (reps - 1 + 10 - rpe)` : la grille classique (RPE 6 à 10,
# 1 à 10 reps) s'en déduit sans la recopier ligne à ligne.
_POURCENTAGES = (
    100.0, 97.8, 95.5, 93.9, 92.2, 90.7, 89.2, 87.8, 86.3, 85.0, 83.7, 82.4,
    81.1, 79.9, 78.6, 77.4, 76.2, 75.1, 73.9, 72.3, 70.7, 69.4, 68.0, 66.7,
    65.3, 64.0, 62.6,
)
RPE_MIN = 6.0
REPS_MAX = 10

# Les mouvements où la charge saisie est un LEST : le poids du corps s'ajoute
# avant d'estimer, et se retire après. Les graphies sont celles de la
# bibliothèque, comme `_ONE_RM_KEYS` (clé étrangère de FRE-123).
AU_POIDS_DU_CORPS = frozenset({"MUSCLE UP", "PULL UP", "CHIN UP", "DIPS", "DIP"})


def pourcentage(rpe: float, reps: float) -> float | None:
    """Rend la part du 1RM que vaut `reps` à `rpe`, `None` hors table.

    Le RPE est arrondi au demi-point le plus proche (la moyenne par série porte
    déjà des demis). En dessous de 6, ou au-delà de 10 reps, la table ne dit plus
    rien d'utile : on ne devine pas.
    """
    if rpe is None or reps is None:
        return None
    r = round(rpe * 2) / 2
    n = int(reps)
    if n != reps or n < 1 or n > REPS_MAX or r < RPE_MIN or r > 10:
        return None
    i = int(round(2 * (n - 1 + 10 - r)))
    return _POURCENTAGES[i] if i < len(_POURCENTAGES) else None


def e1rm_total(total_kg: float, reps: float, rpe: float) -> float | None:
    """Le 1RM estimé (charge TOTALE) d'une série de `reps` à `total_kg` ressentie `rpe`."""
    pct = pourcentage(rpe, reps)
    if pct is None or total_kg is None or total_kg <= 0:
        return None
    return total_kg / (pct / 100)


def au_poids_du_corps(exercise: str) -> bool:
    return exercise.strip().upper() in AU_POIDS_DU_CORPS


def pdc_le(pesees: list[tuple[date, float]], jour: date) -> float | None:
    """La dernière pesée connue au `jour`, `None` s'il n'y en a aucune avant.

    `pesees` est triée par date. Pas de repli sur une pesée POSTÉRIEURE : un
    poids qu'on n'avait pas encore ne sert pas à estimer ce qu'on soulevait.
    """
    poids = None
    for d, kg in pesees:
        if d > jour:
            break
        poids = kg
    return poids
