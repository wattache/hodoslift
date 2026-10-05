"""Supprime un athlète — et TOUT ce que Postgres emporte avec lui, compté avant.

⚠️ IRRÉVERSIBLE au-delà du PITR Neon (6 h) et des dumps horaires (90 j). À
n'utiliser que sur demande explicite, et après avoir lu le récapitulatif du
dry-run.

⚠️ RÉÉCRIT LE 22/08 (FRE-89). La version précédente supprimait encore un arbre
d'entraînement « côté Firestore » — un magasin figé depuis le 20/08 — et son
dry-run comptait CINQ tables, alors que la cascade en traverse quatorze :
l'arbre entier (`training_macros` → … → `training_sets`), les objectifs de bloc,
les bilans et leurs résultats n'y figuraient pas. Le récapitulatif SOUS-ESTIMAIT
ce qui part, sur le seul geste du projet où ça compte.

CE QUE FAIT LA BASE, ET QUE CE SCRIPT NE REFAIT PAS. Depuis FRE-12, tout vit en
Postgres et tout part par `ON DELETE CASCADE` depuis `athletes` — un seul
`DELETE`, une seule transaction. Ce script ne décide donc rien : il LIT la
cascade dans `pg_constraint` et la parcourt pour compter, table par table, ce que
le `DELETE` emportera. Une table ajoutée demain au schéma sera comptée sans
qu'on ait à y penser — c'est la différence avec une liste écrite à la main, qui
est exactement ce qui mentait.

CE QUI SURVIT, volontairement (`ON DELETE SET NULL`) : `competition_participants`
— la participation et ses essais restent, avec le nom en texte. Les résultats
d'une compétition passée ne se réécrivent pas parce qu'un athlète quitte le club.
Le script le dit aussi, pour que le récapitulatif soit complet dans les deux sens.

`users` n'est PAS dans la cascade (elle va d'`athletes` vers SES données, pas
vers le compte) : `--with-user` pour supprimer aussi la ligne du compte lié.
Firebase Auth n'est jamais touché — quelqu'un qui s'y connecterait verrait « ton
coach ne t'a pas enregistré », sans accès à rien.

Dry-run par défaut. `--commit` pour appliquer — et `--production` en plus si la
base n'est pas locale (cf. `scripts/_cible.py`).

Usage :
    uv run python -m scripts.delete_athlete <legacy_id> [<legacy_id>…]   # dry-run
    uv run python -m scripts.delete_athlete <legacy_id> --commit          # bac à sable
    uv run python -m scripts.delete_athlete <legacy_id> --commit --production
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field

from sqlalchemy import text

from app.socle.db import get_session
from scripts._cible import declarer_production, verifier_cible

# Ce que `pg_constraint.confdeltype` encode.
_CASCADE, _SET_NULL = "c", "n"

_FK_SQL = text(
    """
    SELECT c.conrelid::regclass::text AS enfant,
           a.attname                  AS colonne,
           c.confdeltype              AS action
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f'
      AND c.confrelid = CAST(:parent AS regclass)
      AND array_length(c.conkey, 1) = 1
    ORDER BY 1
    """
)

_PK_SQL = text(
    """
    SELECT a.attname
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
    WHERE i.indrelid = CAST(:table AS regclass) AND i.indisprimary
    """
)


@dataclass
class Branche:
    """Une table atteinte par la cascade, et ce qu'elle y perd."""

    table: str
    lignes: int
    profondeur: int
    enfants: list[Branche] = field(default_factory=list)


def _cle_primaire(session, table: str) -> str | None:
    """La colonne de clé primaire — `None` si elle est composite (on ne descend
    pas plus bas : aucune table à clé composite n'a d'enfant dans ce schéma)."""
    cles = [r[0] for r in session.execute(_PK_SQL, {"table": table}).all()]
    return cles[0] if len(cles) == 1 else None


def parcourir(session, table: str, ids_sql: str, params: dict,
              profondeur: int = 0) -> tuple[list[Branche], dict[str, int]]:
    """Descend la cascade depuis `table`, dont les lignes visées sont `ids_sql`.

    Rend les branches CASCADE (comptées récursivement) et, à part, les tables
    en SET NULL avec le nombre de lignes qui perdront leur référence."""
    branches: list[Branche] = []
    preserves: dict[str, int] = {}
    for fk in session.execute(_FK_SQL, {"parent": table}).mappings().all():
        enfant, colonne = fk["enfant"], fk["colonne"]
        n = session.execute(
            text(f"SELECT count(*) FROM {enfant} WHERE {colonne} IN ({ids_sql})"), params,
        ).scalar()
        if fk["action"] == _SET_NULL:
            if n:
                preserves[enfant] = preserves.get(enfant, 0) + n
            continue
        if fk["action"] != _CASCADE or not n:
            continue
        branche = Branche(enfant, n, profondeur + 1)
        pk = _cle_primaire(session, enfant)
        if pk:
            sous, sous_preserves = parcourir(
                session, enfant,
                f"SELECT {pk} FROM {enfant} WHERE {colonne} IN ({ids_sql})", params,
                profondeur + 1,
            )
            branche.enfants = sous
            for t, k in sous_preserves.items():
                preserves[t] = preserves.get(t, 0) + k
        branches.append(branche)
    return branches, preserves


def _afficher(branches: list[Branche]) -> int:
    total = 0
    for b in branches:
        print(f"       {'  ' * (b.profondeur - 1)}{b.table:28} {b.lignes}")
        total += b.lignes + _afficher(b.enfants)
    return total


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("legacy_ids", nargs="+", help="legacy_id de l'athlète (segment d'URL)")
    ap.add_argument("--commit", action="store_true", help="supprime réellement")
    ap.add_argument("--with-user", action="store_true",
                    help="supprime AUSSI la ligne `users` du compte lié")
    declarer_production(ap)
    args = ap.parse_args(argv)
    verifier_cible(ecriture=args.commit, production=args.production)

    cibles = []
    with get_session() as session:
        for legacy in args.legacy_ids:
            row = session.execute(text(
                "SELECT id, legacy_id, first_name, last_name, email, user_uid "
                "FROM athletes WHERE legacy_id = :l"), {"l": legacy}).mappings().first()
            if row is None:
                sys.exit(f"athlète introuvable : {legacy}")

            branches, preserves = parcourir(
                session, "athletes", "SELECT id FROM athletes WHERE id = :a", {"a": row["id"]},
            )
            print(f"\n═══ « {row['first_name']} {row['last_name']} »")
            print(f"    legacy={row['legacy_id']}  email={row['email'] or '—'}  "
                  f"compte lié={row['user_uid'] or 'AUCUN'}")
            print("    SUPPRIMÉ en cascade (lu dans pg_constraint, pas dans une liste) :")
            total = _afficher(branches)
            print(f"       {'TOTAL':28} {total} ligne(s), hors la fiche elle-même")
            for table, n in preserves.items():
                print(f"    PRÉSERVÉ : {n} ligne(s) de {table} (référence → NULL, contenu gardé)")

            user = None
            if row["user_uid"]:
                user = session.execute(text(
                    "SELECT email, display_name FROM users WHERE uid = :u"),
                    {"u": row["user_uid"]}).mappings().first()
                if user and args.with_user:
                    print(f"    COMPTE users SUPPRIMÉ : {row['user_uid']} "
                          f"({user['email']}) « {user['display_name']} »")
                elif user:
                    print(f"    ⚠️  compte users CONSERVÉ : {row['user_uid']} ({user['email']}) "
                          "— ajouter --with-user pour le supprimer aussi")
            cibles.append((row, total))

    if not args.commit:
        perdu = sum(t for _, t in cibles)
        print(f"\n🔍 DRY-RUN — rien supprimé. {perdu} ligne(s) partiraient. "
              "Relancer avec --commit.")
        return 0

    # UNE transaction pour tout : la cascade fait le travail, le script ne fait
    # que nommer la fiche. Tout ou rien, y compris sur plusieurs athlètes.
    with get_session() as session:
        for row, total in cibles:
            session.execute(text("DELETE FROM athletes WHERE id = :a"), {"a": row["id"]})
            if args.with_user and row["user_uid"]:
                session.execute(text("DELETE FROM users WHERE uid = :u"), {"u": row["user_uid"]})
            print(f"✅ « {row['first_name']} {row['last_name']} » supprimé ({total} ligne(s)).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
