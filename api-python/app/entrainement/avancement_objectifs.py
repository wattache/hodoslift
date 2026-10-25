"""Où en est l'athlète sur chaque objectif de bloc (FRE-254).

Un objectif se pose depuis UNE LIGNE DE LA BASE de son bloc (William, 25/10) —
un principe et son tier, ou un renfo — et en garde l'identité : mouvement,
variantes, format, tempo, tier. « Où j'en suis » = la meilleure charge RÉALISÉE
par les lignes de semaine du bloc qui ont cette identité. Ni séries, ni reps, ni
charge n'y entrent : elles progressent d'une semaine à l'autre.

C'est un objectif DE BLOC : ni un objectif d'athlète, ni un record. Le départ de
la jauge est la charge de la première semaine mesurée.

⚠️ RIEN N'EST INVENTÉ : non lié à une ligne (posé avant la règle), `sans_ligne` ;
sans série réalisée, `sans_mesure` (jamais une jauge à zéro) ; sans charge visée,
`sans_cible` — c'est là que la coche reste le seul signal.
"""
from __future__ import annotations

import re

from sqlalchemy import text

from app.entrainement.records import TRACE_ARBRE

# Les lignes réalisées du programme, réduites à ce que l'appariement lit. Une
# ligne sans charge lisible (`ff_charge` NULL : poids du corps écrit en lettres)
# ne mesure rien et n'est pas lue.
_LIGNES = f"""
    SELECT w.block_id::text AS bloc, w.number AS semaine, x.name, x.variant, x.format, x.tempo, x.tier,
           coalesce(ff_charge(nullif(btrim(x.weight_done), '')), ff_charge(x.weight)) AS charge
    FROM training_exercises x
    JOIN training_sessions s ON s.id = x.session_id
    JOIN training_weeks w ON w.id = s.week_id
    {{portee}}
      AND {TRACE_ARBRE}
      AND coalesce(ff_charge(nullif(btrim(x.weight_done), '')), ff_charge(x.weight)) IS NOT NULL
"""


def lignes_realisees(conn, *, program_id: str | None = None, block_id: str | None = None) -> dict[str, list[dict]]:
    """Les lignes réalisées, groupées par bloc — sur un programme, ou un seul bloc."""
    if block_id is not None:
        portee, p = "WHERE w.block_id = CAST(:bid AS uuid)", {"bid": block_id}
    else:
        portee = ("JOIN training_blocks b ON b.id = w.block_id "
                  "JOIN training_macros m ON m.id = b.macro_id WHERE m.program_id = :pid")
        p = {"pid": program_id}
    par_bloc: dict[str, list[dict]] = {}
    for r in conn.execute(text(_LIGNES.format(portee=portee)), p).mappings():
        par_bloc.setdefault(r["bloc"], []).append(dict(r))
    return par_bloc


def _cle(v) -> str:
    return (v or "").strip().lower()


def _variantes(v) -> str:
    """Une variante d'objectif (« CHEST + DS ») ou une liste de ligne, sans ordre ni casse."""
    morceaux = v if isinstance(v, (list, tuple)) else re.split(r"\s*\+\s*", v or "")
    return "+".join(sorted(_cle(m) for m in morceaux if _cle(m)))


def _nombre(v) -> float | None:
    try:
        n = float(str(v).replace(",", ".").strip())
    except (TypeError, ValueError):
        return None
    return n


def avancement(objectif: dict, lignes: list[dict]) -> dict:
    """L'avancement d'UN objectif, contre les lignes réalisées de SON bloc.

    `objectif` porte les colonnes de `block_objectives`. Rend `etat` parmi
    `atteint`, `dans_la_cible`, `en_route`, `sans_ligne`, `sans_mesure`, `sans_cible`, et les
    nombres qui le justifient (`fait`, `semaine`, `depart`, `reste`, `jauge`)."""
    bas, haut = _nombre(objectif.get("weight_min")), _nombre(objectif.get("weight_max"))
    # Une fourchette se rejoint par sa borne BASSE : sous elle on est en route,
    # au-dessus on est dans la cible.
    cible_basse = bas if bas is not None else haut

    lie = objectif.get("source") in ("principe", "renfo")
    tier = objectif.get("tier") if objectif.get("source") == "principe" else None
    comparables = [
        l for l in lignes
        if lie
        and _cle(l["name"]) == _cle(objectif.get("exercise"))
        and _variantes(l["variant"] or []) == _variantes(objectif.get("variant"))
        and _cle(l["format"]) == _cle(objectif.get("format"))
        and _cle(l["tempo"]) == _cle(objectif.get("tempo"))
        and l["tier"] == tier
    ]
    fait = semaine = depart = None
    if comparables:
        meilleure = max(comparables, key=lambda l: (float(l["charge"]), -l["semaine"]))
        fait, semaine = float(meilleure["charge"]), meilleure["semaine"]
        premiere = min(l["semaine"] for l in comparables)
        depart = min(float(l["charge"]) for l in comparables if l["semaine"] == premiere)

    sortie = {"fait": fait, "semaine": semaine, "depart": depart, "reste": None, "jauge": None}
    if objectif.get("atteint_le"):
        return {**sortie, "etat": "atteint", "jauge": 1.0}
    if cible_basse is None:
        return {**sortie, "etat": "sans_cible"}
    if not lie:
        return {**sortie, "etat": "sans_ligne"}
    if fait is None:
        return {**sortie, "etat": "sans_mesure"}
    if fait >= cible_basse:
        return {**sortie, "etat": "dans_la_cible", "reste": 0.0, "jauge": 1.0}
    etendue = cible_basse - depart
    jauge = (fait - depart) / etendue if etendue > 0 else 0.0
    return {**sortie, "etat": "en_route", "reste": round(cible_basse - fait, 2),
            "jauge": round(min(max(jauge, 0.0), 1.0), 3)}
