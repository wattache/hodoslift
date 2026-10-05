"""Sème le premier modèle de bilan — « Bilan complet », 32 tests.

Le contenu vient de `app/kine/semis_bilan.py` ; la spec de `docs/bilan-kine.md`.

    uv run python -m scripts.semer_modele_bilan            # dry-run
    uv run python -m scripts.semer_modele_bilan --apply    # écrit, en UNE transaction

⚠️ REFUSE DE SEMER DEUX FOIS, et ce n'est pas de la prudence de principe. Une
fois semé, le modèle appartient à la KINÉ : elle y ajoute des tests, en retire,
renomme des rubriques. Re-semer écraserait ce travail sans que rien ne le
signale — et les bilans déjà passés continueraient de pointer des tests dont le
libellé aurait changé sous eux. La garde regarde le nom du modèle : s'il existe,
le script s'arrête et dit quoi faire.

⚠️ ET IL N'Y A RIEN À REPRENDRE DE L'ANCIEN. Les tables du 21/08 matin n'ont
jamais porté de ligne (le front n'existait pas), donc aucun bilan n'est à
migrer : ce script crée, il ne convertit pas.
"""

import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from sqlalchemy import text  # noqa: E402

from app.socle.db import get_session  # noqa: E402
from scripts._cible import declarer_production, verifier_cible  # noqa: E402
from app.kine.semis_bilan import (  # noqa: E402
    MODELE_DESCRIPTION, MODELE_NOM, RUBRIQUES, TESTS,
)

_EXISTE_SQL = text("SELECT id FROM bilan_modeles WHERE nom = :nom")

_MODELE_SQL = text(
    "INSERT INTO bilan_modeles (nom, description) VALUES (:nom, :desc) RETURNING id"
)

_RUBRIQUE_SQL = text(
    "INSERT INTO bilan_rubriques (modele_id, libelle, ordre) "
    "VALUES (:mid, :libelle, :ordre) RETURNING id"
)

_TEST_SQL = text(
    """
    INSERT INTO bilan_tests
        (rubrique_id, libelle, protocole, mesure, bilateral, charge_kg,
         materiel, vues, cible, ordre)
    VALUES
        (:rid, :libelle, :protocole, :mesure, :bilateral, :charge,
         :materiel, :vues, :cible, :ordre)
    """
)


def semer(session) -> tuple[str, int]:
    """Crée le modèle, ses rubriques et ses tests. Rend (id, nombre de tests)."""
    modele_id = session.execute(
        _MODELE_SQL, {"nom": MODELE_NOM, "desc": MODELE_DESCRIPTION}
    ).scalar()

    total = 0
    for ordre_rubrique, (famille, libelle) in enumerate(RUBRIQUES):
        rubrique_id = session.execute(_RUBRIQUE_SQL, {
            "mid": modele_id, "libelle": libelle, "ordre": ordre_rubrique,
        }).scalar()

        # L'ordre des tests DANS la rubrique suit celui du semis, qui est celui
        # dans lequel la kiné les fait passer.
        for ordre_test, epreuve in enumerate(t for t in TESTS if t.famille == famille):
            session.execute(_TEST_SQL, {
                "rid": rubrique_id,
                "libelle": epreuve.libelle,
                "protocole": epreuve.protocole,
                # `None` en Python devient `'aucune'` en base : la colonne dit
                # explicitement qu'il n'y a rien à saisir, plutôt que de laisser
                # un NULL que chaque lecteur interpréterait à sa façon.
                "mesure": epreuve.mesure or "aucune",
                "bilateral": epreuve.bilateral,
                "charge": epreuve.charge_kg,
                "materiel": epreuve.materiel,
                "vues": list(epreuve.vues),
                "cible": epreuve.cible,
                "ordre": ordre_test,
            })
            total += 1

    return str(modele_id), total


def main() -> None:
    parser = argparse.ArgumentParser(description="Sème le premier modèle de bilan.")
    parser.add_argument("--apply", action="store_true",
                        help="écrit réellement (défaut : dry-run).")
    declarer_production(parser)
    args = parser.parse_args()
    verifier_cible(ecriture=args.apply, production=args.production)

    with get_session() as session:
        existant = session.execute(_EXISTE_SQL, {"nom": MODELE_NOM}).scalar()
        if existant is not None:
            print(f"✗ « {MODELE_NOM} » existe déjà ({existant}).")
            print("  Rien n'est fait : ce modèle appartient désormais à la kiné,")
            print("  et le re-semer écraserait ses retouches. Pour repartir de zéro,")
            print("  supprimer le modèle depuis l'application, puis relancer.")
            raise SystemExit(1)

        par_famille = {f: sum(1 for t in TESTS if t.famille == f) for f, _ in RUBRIQUES}
        print(f"Modèle : « {MODELE_NOM} »")
        for famille, libelle in RUBRIQUES:
            print(f"  · {libelle} — {par_famille[famille]} tests")
        print(f"  = {len(TESTS)} tests au total")

        if not args.apply:
            print("\n(dry-run — relancer avec --apply pour écrire)")
            return

        modele_id, total = semer(session)

    print(f"\n✓ semé : {modele_id} — {total} tests")


if __name__ == "__main__":
    main()
