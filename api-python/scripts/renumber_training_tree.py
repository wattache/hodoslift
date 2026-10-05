"""Recompacte les numéros de macro, de bloc et de semaine sur l'EXISTANT.

CONSTAT (2026-08-17). Le bloc 3 de « ROAD TO 100 » porte quatre semaines
numérotées 2, 2, 3, 4 : pas de S1, et deux S2. Les noms saisis par le coach
(« Semaine 1 », « Semaine 2 », « Semaine 3 ») sont donc décalés d'un cran par
rapport aux badges, et une semaine reste sans nom.

L'ANOMALIE VIENT DE FIRESTORE, PAS DE LA BASCULE. Sur le bac à sable (photo
d'AVANT la migration), un seul bloc sur 125 a des numéros en double — celui-ci —
et c'est aussi le seul dont la numérotation ne part pas de 1. L'ETL de FRE-12 l'a
transportée fidèlement ; il n'y a pas de régression à chercher de ce côté.

CE QUE ÇA CASSE, ET QUI N'EST PAS COSMÉTIQUE
  * L'ORDRE DES SEMAINES EST DÉCIDÉ AU HASARD. `_SEMAINES` ordonne par
    `number, legacy_id` : à numéro égal, le départage se fait sur un uuid —
    stable, mais sans rapport avec l'intention du coach.
  * LE TRACKING PEUT PERDRE DES SÉANCES. Il compte
    `count(DISTINCT (week_number, session_index))` : deux semaines de même numéro
    fusionnent. Mesuré sur ce bloc, 15 séances comptées au lieu de 20.
    ⚠️ Défaut LATENT et non actif à ce jour : la semaine en double n'a pas de
    `start_date`, ses séances ont donc `session_date` NULL et sont écartées par
    le `WHERE session_date IS NOT NULL`. Il se déclenche dès qu'un doublon porte
    une date.

CE SCRIPT NE TRAITE QUE LE PASSÉ. La cause est fermée en amont depuis FRE-12 :
`delete_macro`, `delete_block` et `delete_week` recompactent désormais dans la
transaction de la suppression (cf. `_recompacter`, app/entrainement/routes_training_structure.py).
Ce script est le rattrapage de ce qui a été écrit avant.

⚠️ IL NE TOUCHE PAS AUX NOMS. Le coach a saisi « Semaine 1 / 2 / 3 » à la main ;
les recaler sur les numéros serait écrire à sa place. Une fois les numéros
contigus, c'est à lui de renommer s'il le souhaite.

⚠️ IL RÉÉCRIT DES LIBELLÉS D'HISTORIQUE. `training_sets.week_number` en dérive et
le Tracking groupe dessus : un bloc réparé verra ses semaines re-libellées dans
les vues analytiques. Le prochain rebuild de la projection en tiendra compte tout
seul — il n'y a rien à faire de plus, mais il faut le savoir avant de lancer.

Sécurité (data-safety) :
- DRY-RUN PAR DÉFAUT : n'écrit rien sans `--commit`, et rend compte AVANT.
- PORTÉE PAR PARENT, jamais globale. Les numéros sont recomptés par
  `PARTITION BY` sur le parent : un id Firestore n'est pas unique entre
  programmes (un programme a été dupliqué AVEC les ids de ses documents), et le
  numéro d'une semaine n'a de sens que dans SON bloc.
- NE RÉORDONNE PAS. Le tri est `number, legacy_id`, exactement celui des lectures
  (`app/entrainement/training_tree.py`) : le script ferme les trous, il ne rebat pas les
  cartes. Ce que le coach voyait, il le revoit — aux numéros près.
- CHIRURGICAL : seule la colonne `number` est écrite, et seulement sur les lignes
  qui bougent réellement (`WHERE number <> rang`).
- IDEMPOTENT : relancé, il ne trouve plus rien. Vérifié après écriture.
- UNE TRANSACTION : tout ou rien, les trois niveaux compris.

Usage :
    uv run python -m scripts.renumber_training_tree                    # dry-run
    uv run python -m scripts.renumber_training_tree --program abc123   # un seul
    uv run python -m scripts.renumber_training_tree --commit
"""

import argparse
from dataclasses import dataclass

from sqlalchemy import text

from app.socle.db import get_session
from scripts._cible import declarer_production, verifier_cible

# Contexte lisible dans le compte rendu, commun aux trois niveaux : à qui
# appartient l'arbre qu'on s'apprête à renuméroter.
_ATHLETE = "coalesce(nullif(trim(a.first_name || ' ' || a.last_name), ''), '?')"

# Un SELECT par niveau, tous de la même FORME : (id, number, rang, parent,
# athlete, contexte). `rang` est le numéro que la ligne DEVRAIT porter.
#
# ⚠️ `PARTITION BY` sur le parent — c'est là que se joue la portée. Un
# `row_number()` global renumÉroterait les semaines de tous les blocs à la suite.
_LECTURE = {
    "macro": f"""
        SELECT m.id, m.number,
               row_number() OVER (PARTITION BY m.program_id
                                  ORDER BY m.number, m.legacy_id) AS rang,
               m.program_id AS parent, {_ATHLETE} AS athlete,
               'programme ' || p.id AS contexte
        FROM training_macros m
        JOIN programs p ON p.id = m.program_id
        LEFT JOIN athletes a ON a.id = p.athlete_id
        WHERE (CAST(:program AS text) IS NULL OR m.program_id = :program)
        ORDER BY m.program_id, m.number, m.legacy_id
    """,
    "bloc": f"""
        SELECT b.id, b.number,
               row_number() OVER (PARTITION BY b.macro_id
                                  ORDER BY b.number, b.legacy_id) AS rang,
               b.macro_id::text AS parent, {_ATHLETE} AS athlete,
               'programme ' || p.id || ' — macro ' || m.number AS contexte
        FROM training_blocks b
        JOIN training_macros m ON m.id = b.macro_id
        JOIN programs p ON p.id = m.program_id
        LEFT JOIN athletes a ON a.id = p.athlete_id
        WHERE (CAST(:program AS text) IS NULL OR m.program_id = :program)
        ORDER BY b.macro_id, b.number, b.legacy_id
    """,
    "semaine": f"""
        SELECT w.id, w.number,
               row_number() OVER (PARTITION BY w.block_id
                                  ORDER BY w.number, w.legacy_id) AS rang,
               w.block_id::text AS parent, {_ATHLETE} AS athlete,
               'programme ' || p.id || ' — macro ' || m.number || ' / bloc ' || b.number
                 || coalesce(' « ' || b.name || ' »', '') AS contexte
        FROM training_weeks w
        JOIN training_blocks b ON b.id = w.block_id
        JOIN training_macros m ON m.id = b.macro_id
        JOIN programs p ON p.id = m.program_id
        LEFT JOIN athletes a ON a.id = p.athlete_id
        WHERE (CAST(:program AS text) IS NULL OR m.program_id = :program)
        ORDER BY w.block_id, w.number, w.legacy_id
    """,
}

# Table, colonne de parent, et restriction au programme demandé. La restriction
# passe par le PARENT et non par une jointure dans l'UPDATE : tous les enfants
# d'un parent appartiennent au même programme, filtrer les parents suffit donc,
# et la fenêtre reste calculée sur la partition ENTIÈRE.
_ECRITURE = {
    "macro": ("training_macros", "program_id",
              "(CAST(:program AS text) IS NULL OR program_id = :program)"),
    "bloc": ("training_blocks", "macro_id",
             "(CAST(:program AS text) IS NULL OR macro_id IN "
             "(SELECT id FROM training_macros WHERE program_id = :program))"),
    "semaine": ("training_weeks", "block_id",
                "(CAST(:program AS text) IS NULL OR block_id IN "
                "(SELECT b.id FROM training_blocks b "
                " JOIN training_macros m ON m.id = b.macro_id "
                " WHERE m.program_id = :program))"),
}

NIVEAUX = ("macro", "bloc", "semaine")


@dataclass
class Groupe:
    """Un PARENT dont les enfants ne sont pas numérotés 1..n — l'unité du compte
    rendu. On rend compte par parent et non par ligne : « 2, 2, 3, 4 → 1, 2, 3, 4 »
    se lit, « la semaine e3f9… passe de 2 à 1 » quatre fois de suite, non."""

    niveau: str
    athlete: str
    contexte: str
    avant: list[int]
    apres: list[int]

    @property
    def bouge(self) -> int:
        return sum(1 for a, b in zip(self.avant, self.apres) if a != b)

    @property
    def doublons(self) -> bool:
        return len(set(self.avant)) != len(self.avant)


def analyser(conn, program: str | None = None) -> list[Groupe]:
    """Les parents à renuméroter, tous niveaux confondus. Ne lit rien d'autre que
    ce que l'UPDATE écrira — c'est la même fenêtre, calculée deux fois."""
    groupes: list[Groupe] = []
    for niveau in NIVEAUX:
        lignes = conn.execute(text(_LECTURE[niveau]), {"program": program}).mappings().all()
        par_parent: dict[str, list] = {}
        for ligne in lignes:
            par_parent.setdefault(str(ligne["parent"]), []).append(ligne)
        for enfants in par_parent.values():
            avant = [e["number"] for e in enfants]
            apres = [e["rang"] for e in enfants]
            if avant != apres:
                groupes.append(Groupe(niveau=niveau, athlete=enfants[0]["athlete"],
                                      contexte=enfants[0]["contexte"],
                                      avant=avant, apres=apres))
    return groupes


def appliquer(conn, program: str | None = None) -> dict[str, int]:
    """Recompacte, par niveau. Rend le nombre de LIGNES écrites par niveau."""
    ecrites = {}
    for niveau in NIVEAUX:
        table, parent_col, restriction = _ECRITURE[niveau]
        resultat = conn.execute(text(
            f"UPDATE {table} t SET number = r.rang FROM ("
            f"  SELECT id, row_number() OVER (PARTITION BY {parent_col} "
            f"                                ORDER BY number, legacy_id) AS rang "
            f"  FROM {table} WHERE {restriction}) r "
            f"WHERE t.id = r.id AND t.number <> r.rang"), {"program": program})
        ecrites[niveau] = resultat.rowcount
    return ecrites


def _suite(numeros: list[int]) -> str:
    return ", ".join(str(n) for n in numeros)


def rendre_compte(groupes: list[Groupe]) -> None:
    for niveau in NIVEAUX:
        du_niveau = [g for g in groupes if g.niveau == niveau]
        if not du_niveau:
            continue
        print(f"\n=== {niveau.upper()} — {len(du_niveau)} parent(s) ===")
        for g in du_niveau:
            marque = "  ⚠️ DOUBLONS" if g.doublons else ""
            print(f"  {g.athlete[:24]:26} {g.contexte}{marque}")
            print(f"      {_suite(g.avant)}  →  {_suite(g.apres)}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--commit", action="store_true", help="écrit réellement (sinon dry-run)")
    ap.add_argument("--program", default=None,
                    help="restreint à un seul programme (id) — pour une 1re passe prudente")
    declarer_production(ap)
    args = ap.parse_args(argv)
    # Écrire hors d'une base locale exige --production (FRE-89) ; le dry-run, non.
    verifier_cible(ecriture=args.commit, production=args.production)

    with get_session() as conn:
        groupes = analyser(conn, args.program)
        if not groupes:
            print("✅ Rien à faire : tous les numéros sont déjà contigus à partir de 1.")
            return 0

        rendre_compte(groupes)
        lignes = sum(g.bouge for g in groupes)
        doublons = sum(1 for g in groupes if g.doublons)
        print(f"\n{len(groupes)} parent(s), {lignes} ligne(s) à renuméroter "
              f"— dont {doublons} parent(s) portant des DOUBLONS.")

        # Les deux conséquences à connaître AVANT de décider, donc affichées en
        # dry-run aussi — c'est là qu'on décide.
        print("\n⚠️ `training_sets.week_number` en dérive et le Tracking groupe dessus : "
              "les semaines renumérotées seront re-libellées dans les vues\n"
              "   analytiques au prochain rebuild de la projection.")
        print("⚠️ Les NOMS ne sont PAS touchés : « Semaine 2 » pourra porter le badge 1. "
              "C'est au coach de renommer s'il le souhaite.")

        if not args.commit:
            print("\n🔍 DRY-RUN — rien écrit. Relancer avec --commit.")
            return 0

        ecrites = appliquer(conn, args.program)
        print("\n✅ Écrit : " + ", ".join(f"{n} {niveau}(s)" for niveau, n in ecrites.items()))

        # Idempotence VÉRIFIÉE, pas supposée : on relit dans la MÊME transaction.
        # Un reliquat signalerait un tri instable — le genre de défaut qui ne se
        # voit qu'en relançant, c'est-à-dire une fois écrit.
        #
        # `RuntimeError` et non `SystemExit` : `get_session` intercepte
        # `Exception` pour annuler la transaction, et `SystemExit` hérite de
        # `BaseException` — il passerait à côté du filet.
        reste = analyser(conn, args.program)
        if reste:
            raise RuntimeError(
                f"{len(reste)} parent(s) encore hors séquence APRÈS écriture : tri "
                "instable, transaction annulée")
        print("   contrôle : plus aucun parent hors séquence.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
