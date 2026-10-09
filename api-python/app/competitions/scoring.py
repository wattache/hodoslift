"""La projection P/R/O d'un participant de compétition, et le barème du RIS.

Le SCORE n'est pas ici : il est une colonne de la vue `competition_scores`,
comme le total du barème. Il n'est JAMAIS lu du body ni stocké : le serveur le
lit de la vue à chaque lecture. La projection P/R/O (FRE-203) se calcule ici.

RIS : ce module ne porte que le BARÈME. Le total auquel il s'applique vient de
la vue `competition_scores`.
"""

import math


TIERS = ("pessimistic", "realistic", "optimistic")


def compute_projection(movements: list[dict]) -> dict[str, float]:
    """Les totaux vers lesquels l'athlète se dirige, pour chacune des trois hypothèses.

    Par mouvement et par hypothèse : la meilleure réussite jusqu'ici, ou la plus
    haute charge PRÉVUE parmi les essais pas encore tentés, si elle est plus
    lourde. Un essai à venir sans plan reprend le dernier plan de l'hypothèse ;
    un essai qui n'a qu'une charge annoncée la porte pour les trois. Un
    mouvement dont tous les essais sont passés ne compte plus que sa réussite.

    Avant le premier essai, c'est le plan ; à la fin, les trois totaux égalent
    le score. Servi à la lecture, comme le score, et jamais accepté en entrée.
    """
    totaux = dict.fromkeys(TIERS, 0.0)
    for mov in movements:
        reussi = max((a.get("weight") or 0.0 for a in mov.get("attempts", []) if a.get("result") == "rep"),
                     default=0.0)
        herite = dict.fromkeys(TIERS, 0.0)
        prevu = dict.fromkeys(TIERS, 0.0)
        for att in mov.get("attempts", []):
            plan = att.get("weights") or {}
            propre = {t: plan.get(t) or 0.0 for t in TIERS}
            if not any(propre.values()) and (att.get("weight") or 0.0) > 0:
                propre = dict.fromkeys(TIERS, att["weight"])
            for t in TIERS:
                if propre[t] > 0:
                    herite[t] = propre[t]
            if not att.get("result"):
                for t in TIERS:
                    prevu[t] = max(prevu[t], herite[t])
        for t in TIERS:
            totaux[t] += max(reussi, prevu[t])
    return totaux


# --------------------------------------------------------------------------- #
# LE RIS — Relative Index for Streetlifting (FRE-92)
# --------------------------------------------------------------------------- #
#
# ⚠️ Calculé ICI, pas dans le navigateur : les constantes du barème n'existent
# qu'en UN exemplaire, et changent à un seul endroit quand la fédération en
# publie un nouveau.
#
# ⚠️ Le RIS vaut pour UN POIDS DONNÉ : c'est un instantané (total, poids de
# corps) obtenus ENSEMBLE. Prendre trois kilos ne produit pas un nouveau RIS — il
# faut refaire ses 1RM à ce poids-là. Ne jamais le recalculer avec un poids
# courant et des 1RM anciens : une pesée ferait bouger un score qui ne correspond
# à aucune performance.
#
# ⚠️ Le TOTAL du barème n'est pas ici, il est dans la vue `competition_scores` :
# quatre places, dont une disputée entre le pull up et le chin up — une règle
# d'AGRÉGATION, tenue en SQL à un seul endroit.

# Constantes du barème, par genre. Une courbe logistique : plus le corps est
# lourd, plus le dénominateur est haut, donc plus le même total « vaut » peu.
_BAREME: dict[str, dict[str, float]] = {
    "M": {"A": 338.0, "K": 549.0, "B": 0.11354, "V": 74.777, "Q": 0.53096},
    "F": {"A": 164.0, "K": 270.0, "B": 0.13776, "V": 57.855, "Q": 0.37089},
}


def compute_ris(total: float | None, bodyweight: float | None,
                gender: str | None) -> float | None:
    """Le RIS, ou `None` si une entrée manque — jamais zéro.

    ⚠️ `None`, pas `0.0` : une entrée manquante est un athlète qu'on ne sait pas
    classer. Zéro le ferait apparaître dernier d'un classement auquel il ne
    participe pas.
    """
    if gender not in _BAREME:
        return None
    if not bodyweight or bodyweight <= 0 or not total or total <= 0:
        return None
    p = _BAREME[gender]
    denom = p["A"] + (p["K"] - p["A"]) / (1 + p["Q"] * math.exp(-p["B"] * (bodyweight - p["V"])))
    if denom <= 0:
        return None
    return (total * 100) / denom
