"""La progression d'un mouvement, semaine par semaine, et le travail refait.

Ce que le Tracker ne peut pas tirer des agrégats SQL : le 1RM ESTIMÉ de chaque
série (`rm_estime`), l'intensité en % du meilleur, et les travaux refaits à
l'identique où seul le RPE change. Calculé ICI, pas dans la vue — la fusion du
17/08 a retiré du front ce qu'il recalculait depuis l'arbre.

⚠️ `None` partout où la mesure n'existe pas, jamais `0` : c'est ce qui coupe la
courbe sur un trou et dessine la fenêtre « pas d'estimation ».
"""

from collections import OrderedDict, defaultdict
from datetime import date, timedelta
from typing import Literal

from app.suivi import rm_estime

Raison = Literal["variantes", "sans_rpe", "reps", "sans_pesee", "sans_charge"]

# La FORME DE COMPÉTITION : aucune variante qui change le geste (COMP et FREE
# disent « rien de spécial »), ni tempo, ni format. C'est sur elle seule que le
# 1RM s'estime — un tempo DS ou un NO DIPS n'annonce pas un maximum.
_NEUTRES = frozenset({"COMP", "FREE"})


def _f(v) -> float | None:
    return float(v) if v is not None else None


def forme_de_competition(variantes: list[str], tempo: str | None, fmt: str | None) -> bool:
    return (all(v.strip().upper() in _NEUTRES for v in variantes)
            and not (tempo or "").strip() and not (fmt or "").strip())


def _lundi(jour: date) -> date:
    return jour - timedelta(days=jour.weekday())


def _serie(ligne, *, pdc_du_jour: float | None, au_pdc: bool) -> dict:
    """Une ligne de `LIGNES_SQL`, lue une fois : total, e1 et pourquoi pas."""
    reps = _f(ligne.reps)
    rpe = _f(ligne.felt_rpe)
    lest = _f(ligne.charge_kg)
    if lest is None and (ligne.bodyweight or au_pdc):
        lest = 0.0
    competition = forme_de_competition(list(ligne.variantes or []), ligne.tempo_cle, ligne.format_cle)
    e1 = None
    raison: Raison | None = None
    total = None
    if not competition:
        raison = "variantes"
    elif rpe is None:
        raison = "sans_rpe"
    elif au_pdc and pdc_du_jour is None:
        raison = "sans_pesee"
    elif lest is None:
        raison = "sans_charge"
    else:
        total = lest + (pdc_du_jour or 0.0)
        e1_total = rm_estime.e1rm_total(total, reps, rpe)
        if e1_total is None:
            raison = "reps"
        else:
            e1 = e1_total - (pdc_du_jour or 0.0)
    return {
        "jour": ligne.session_date, "sets": _f(ligne.sets) or 0.0, "reps": reps,
        "lest": lest, "total": total, "rpe": rpe, "competition": competition,
        "variantes": [v for v in (ligne.variantes or []) if v.strip().upper() not in _NEUTRES],
        "tempo": ligne.tempo_cle or None, "format": ligne.format_cle or None,
        "e1": e1, "raison": raison,
    }


# L'ordre des raisons quand une semaine n'a pas d'estimation : la plus
# parlante d'abord. « Pas de pesée » prime sur tout — c'est la seule que
# l'athlète corrige lui-même ; « reps » ne se dit que si tout le reste y était.
_PRIORITE: tuple[Raison, ...] = ("sans_pesee", "sans_rpe", "sans_charge", "reps", "variantes")


def semaines(lignes, *, pesees: list[tuple[date, float]], exercise: str) -> dict[date, dict]:
    """Par lundi : `e1Kg` (le meilleur de la semaine, en LEST), `intensite`, `e1Raison`.

    L'intensité est la charge totale MOYENNE des séries de compétition (pondérée
    par les reps), en % du meilleur 1RM estimé de toute la période — un bloc à
    87 % n'a pas la même intention qu'un bloc à 79 %.
    """
    au_pdc = rm_estime.au_poids_du_corps(exercise)
    par_semaine: "OrderedDict[date, list[dict]]" = OrderedDict()
    for ligne in lignes:
        pdc = rm_estime.pdc_le(pesees, ligne.session_date) if au_pdc else 0.0
        par_semaine.setdefault(_lundi(ligne.session_date), []).append(
            _serie(ligne, pdc_du_jour=pdc, au_pdc=au_pdc))

    meilleur = max((s["e1"] for xs in par_semaine.values() for s in xs if s["e1"] is not None),
                   default=None)
    resultat: dict[date, dict] = {}
    for lundi, xs in par_semaine.items():
        e1s = [s["e1"] for s in xs if s["e1"] is not None]
        comp = [s for s in xs if s["competition"] and s["total"] is not None and s["reps"]]
        intensite = None
        if e1s and meilleur and comp:
            pdc = rm_estime.pdc_le(pesees, xs[0]["jour"]) if au_pdc else 0.0
            poids = sum(s["sets"] * s["reps"] for s in comp)
            if poids > 0 and (meilleur + (pdc or 0.0)) > 0:
                moyenne = sum(s["sets"] * s["reps"] * s["total"] for s in comp) / poids
                intensite = round(100 * moyenne / (meilleur + (pdc or 0.0)), 1)
        raison = None
        if not e1s:
            raisons = {s["raison"] for s in xs if s["raison"]}
            raison = next((r for r in _PRIORITE if r in raisons), None)
        resultat[lundi] = {
            "e1Kg": round(max(e1s), 1) if e1s else None,
            "intensite": intensite,
            "e1Raison": raison,
        }
    return resultat


def refaits(lignes, *, exercise: str) -> list[dict]:
    """Les travaux refaits à l'identique — même forme, séries, reps, lest — où
    seul le RPE a changé. Du plus grand progrès (RPE en baisse) au plus grand recul.

    Un travail n'est « refait » qu'à deux dates distinctes avec un RPE chaque fois.
    """
    au_pdc = rm_estime.au_poids_du_corps(exercise)
    groupes: dict[tuple, list[tuple[date, float]]] = defaultdict(list)
    formes: dict[tuple, dict] = {}
    for ligne in lignes:
        s = _serie(ligne, pdc_du_jour=None, au_pdc=au_pdc)
        if s["rpe"] is None or not s["reps"] or s["lest"] is None:
            continue
        cle = (s["competition"], tuple(s["variantes"]), s["tempo"], s["format"],
               s["sets"], s["reps"], s["lest"])
        groupes[cle].append((s["jour"], s["rpe"]))
        formes.setdefault(cle, s)
    resultat = []
    for cle, pts in groupes.items():
        pts.sort()
        if len(pts) < 2 or pts[0][0] == pts[-1][0]:
            continue
        s = formes[cle]
        resultat.append({
            "competition": s["competition"], "variant": s["variantes"],
            "tempo": s["tempo"], "format": s["format"],
            "sets": s["sets"], "reps": s["reps"], "lestKg": s["lest"],
            "points": [{"date": d.isoformat(), "rpe": r} for d, r in pts],
            "delta": round(pts[-1][1] - pts[0][1], 1),
        })
    resultat.sort(key=lambda r: (r["delta"], -len(r["points"]), r["points"][0]["date"]))
    return resultat
