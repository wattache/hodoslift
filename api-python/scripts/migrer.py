"""CE QUI RESTE À APPLIQUER SUR CETTE BASE — et, sur demande, l'appliquer (FRE-133).

⚠️ CE SCRIPT EXISTE PARCE QUE RIEN NE SAVAIT. Trois lignées de schéma coexistent :
la production (les fichiers passés à la main par `psql`), `docs/postgres-schema.sql`
(écrit APRÈS coup, et c'est lui que pytest exécute), et le bac à sable du harnais
réel (un `pg_restore` de prod, jamais rejoué avec les migrations).

Le coût est MESURÉ, pas théorique. Le 07/09, deux fonctions de FRE-136 manquaient
au bac à sable : une spec du harnais réel a rendu 500, et il a fallu appliquer la
migration à la main pour comprendre. Le 06/09, 34 specs échouaient sur un
`archive_le` absent. À chaque fois le diagnostic a coûté plus cher que le
correctif.

⚠️ IL N'INVENTE RIEN, IL COMPARE. Le dossier `docs/migrations/` d'un côté, la
table `schema_migrations` de l'autre. Ce n'est pas un cadre de migration : il n'y
a ni ordre calculé, ni retour en arrière, ni fichier généré. La chronologie est
le NOM du fichier, comme elle l'a toujours été.

⚠️ ET CHAQUE FICHIER S'ENREGISTRE LUI-MÊME. Ce script ne pose PAS la ligne dans
`schema_migrations` : c'est le fichier qui la porte, avant son `COMMIT`, donc
dans SA transaction. Un script qui enregistrerait de l'extérieur pourrait marquer
« appliqué » une migration à moitié passée — exactement le cas qu'on veut rendre
impossible. Corollaire : un fichier qui oublie sa ligne restera éternellement
« en attente », et le script le DIT plutôt que de le rattraper en silence.

USAGE
    uv run python -m scripts.migrer                    # ce qui manque, sans rien faire
    uv run python -m scripts.migrer --apply            # bac à sable / base locale
    uv run python -m scripts.migrer --apply --production   # Neon, mot écrit à la main
"""

from __future__ import annotations

import argparse
import pathlib
import sys

from sqlalchemy import text

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.socle.db import get_engine  # noqa: E402
from scripts._cible import declarer_production, url_effective, verifier_cible  # noqa: E402

MIGRATIONS = pathlib.Path(__file__).resolve().parent.parent / "docs" / "migrations"

# L'amorce : elle crée `schema_migrations` et déclare appliqué tout ce qui
# précède. À jouer à la main, une fois par base.
AMORCE = "2026-09-08_les_migrations_savent_ce_qui_est_applique.sql"


def fichiers_du_depot() -> list[str]:
    """Les migrations du dépôt, dans l'ordre de leur NOM.

    ⚠️ L'ORDRE EST CELUI DU NOM, et c'est ce qu'il a toujours été : les fichiers
    sont préfixés d'une date. Trier autrement — par date de création, par ordre
    de `glob` — donnerait un ordre qui dépend du système de fichiers."""
    return sorted(f.name for f in MIGRATIONS.glob("*.sql"))


def deja_appliquees(conn) -> set[str]:
    """⚠️ TABLE ABSENTE = BASE D'AVANT LE MÉCANISME, pas une erreur. C'est le cas
    de toute base qui n'a pas encore reçu la migration qui crée la table — dont
    le bac à sable, qui est justement celle qu'on veut rattraper."""
    existe = conn.execute(text(
        "SELECT to_regclass('public.schema_migrations') IS NOT NULL")).scalar()
    if not existe:
        return set()
    return {r[0] for r in conn.execute(text("SELECT fichier FROM schema_migrations"))}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true",
                        help="applique les migrations manquantes (défaut : ne fait rien)")
    declarer_production(parser)
    args = parser.parse_args()

    # ⚠️ `url_effective()` ANNONCE LA CIBLE, IL NE S'Y CONNECTE PAS. Il rend
    # `str(engine.url)`, où SQLAlchemy MASQUE le mot de passe par `***` : s'en
    # servir pour bâtir un engine donne « password authentication failed » quel
    # que soit le vrai mot de passe, et on cherche du côté de la base. Le moteur
    # de l'application est déjà configuré — on l'emprunte.
    verifier_cible(ecriture=args.apply, production=args.production, url=url_effective())

    moteur = get_engine()
    with moteur.connect() as conn:
        amorcee = conn.execute(text(
            "SELECT to_regclass('public.schema_migrations') IS NOT NULL")).scalar()
        appliquees = deja_appliquees(conn)

    # ⚠️ SANS LA TABLE, TOUT A L'AIR EN ATTENTE — Y COMPRIS CE QUI EST DÉJÀ LÀ.
    #
    # Une base d'avant le mécanisme (la production, le bac à sable) porte déjà
    # l'immense majorité de ces migrations : les REJOUER serait au mieux inutile,
    # au pire destructeur — les lots de renommage de FRE-11 ne sont pas
    # idempotents au-delà de leur garde, et un `--apply` enthousiaste rejouerait
    # 46 fichiers dans l'ordre du nom.
    #
    # L'amorce doit donc passer À LA MAIN, une fois par base : elle crée la table
    # ET déclare appliqué ce qui l'est. Après quoi ce script n'a plus que le vrai
    # reliquat à proposer.
    if not amorcee and args.apply:
        print("⛔ `schema_migrations` n'existe pas sur cette base.\n")
        print("   Tout paraîtrait « en attente », y compris ce qui est déjà là.")
        print("   Joue d'abord l'amorce, qui crée la table et rattrape l'existant :\n")
        print("       psql \"$DATABASE_URL\" -v ON_ERROR_STOP=1 \\")
        print(f"            -f docs/migrations/{AMORCE}\n")
        # ⚠️ L'AMORCE DÉCLARE, ELLE NE VÉRIFIE PAS (FRE-154). Elle écrit
        # « appliqué » pour les 45 migrations d'avant elle, SANS regarder si la
        # base les porte. Jouée sur une base réellement en retard, elle
        # enregistrerait une intention pour un fait — et c'est exactement le
        # bac à sable, qui avait quatre migrations de retard : ce n'est pas la
        # table qui l'a dit, c'est le vérificateur de schéma.
        print("   ⚠️  MAIS SEULEMENT SI `make schema-verifier STRICT=1` EST VERT sur")
        print("      cette base : l'amorce déclare appliqué tout ce qui la précède,")
        print("      sans le vérifier. Sur une base en retard, elle mentirait.")
        return 1

    attendues = fichiers_du_depot()
    manquantes = [f for f in attendues if f not in appliquees]

    # ⚠️ CE QUI EST EN BASE MAIS PLUS DANS LE DÉPÔT ARRÊTE TOUT (FRE-176). Un
    # fichier renommé après avoir été joué laisse une ligne orpheline — et son
    # NOUVEAU nom paraît « en attente » : `--apply` le rejouerait. Le 18/09, le
    # bac à sable portait le lot 5 sous deux noms, le 16 (joué pendant les
    # essais) et le 17 (le fichier commité) ; le script l'affichait, sans
    # s'arrêter, et personne ne l'a lu. On refuse donc, AVANT toute écriture.
    orphelines = sorted(appliquees - set(attendues))

    print(f"dépôt : {len(attendues)} migration(s) · base : {len(appliquees)} appliquée(s)")
    if orphelines:
        print("\n⛔ en base mais absentes du dépôt (renommées ?) :")
        for f in orphelines:
            print(f"    {f}")
        print("\n   Retrouver le fichier sous son nom actuel (`git log --follow`), vérifier")
        print("   que la base le porte bien, puis corriger la LIGNE dans `schema_migrations`")
        print("   — renommer, ou retirer si le nouveau nom y est déjà. Rien n'est joué.")
        return 1

    if not manquantes:
        print("\n✅ rien à appliquer.")
        return 0

    print(f"\n{len(manquantes)} migration(s) EN ATTENTE, dans l'ordre :")
    for f in manquantes:
        print(f"    {f}")

    if not args.apply:
        print("\n(lecture seule — ajouter --apply pour les jouer)")
        return 1

    # ⚠️ UNE CONNEXION EN AUTOCOMMIT, ET C'EST LE FICHIER QUI OUVRE SA
    # TRANSACTION. Envelopper ici en ouvrirait une SECONDE par-dessus le `BEGIN`
    # du fichier : Postgres avertit, et le `COMMIT` du fichier validerait la
    # transaction extérieure au mauvais moment. L'atomicité appartient au
    # fichier, ce qui est aussi ce qui rend sa ligne d'enregistrement honnête.
    moteur_auto = moteur.execution_options(isolation_level="AUTOCOMMIT")
    for nom in manquantes:
        sql = (MIGRATIONS / nom).read_text()
        print(f"\n▶ {nom}")
        try:
            with moteur_auto.connect() as conn:
                # ⚠️ LES BORNES DE L'APPLICATION NE VALENT PAS ICI (FRE-135).
                # `app/socle/db.py` pose `statement_timeout=15s` et `lock_timeout=5s`
                # sur CHAQUE connexion, migrations comprises puisqu'on emprunte
                # son engine. C'est juste pour une requête d'écran, et faux pour
                # une reprise : un `UPDATE` sur quinze mille lignes ou un `ALTER
                # TABLE` qui attend un verrou dépassent ces bornes sans rien
                # avoir d'anormal, et se feraient couper AU MILIEU — dans leur
                # transaction, donc annulés, mais avec un message qui n'a rien à
                # voir avec la cause.
                #
                # `SET` simple et non `SET LOCAL` : on est en AUTOCOMMIT, il n'y
                # a pas de transaction extérieure à laquelle se limiter, et la
                # portée est de toute façon celle de cette connexion-ci.
                conn.execute(text("SET statement_timeout = 0"))
                conn.execute(text("SET lock_timeout = 0"))
                conn.execute(text(sql))
        except Exception as exc:  # noqa: BLE001 — on veut le message, pas le type
            print(f"⛔ ÉCHEC sur {nom} :\n{exc}")
            print("\nLes suivantes ne sont PAS jouées : l'ordre est une dépendance.")
            return 1

    # ⚠️ ON RELIT LA BASE PLUTÔT QUE DE SE CROIRE. Un fichier qui aurait oublié sa
    # ligne d'enregistrement serait rejoué à chaque exécution — mieux vaut le
    # savoir tout de suite que de découvrir la boucle dans six mois.
    with moteur.connect() as conn:
        reste = [f for f in fichiers_du_depot() if f not in deja_appliquees(conn)]
    if reste:
        print("\n⚠️  jouées, mais toujours déclarées en attente — il leur manque "
              "leur `INSERT INTO schema_migrations` :")
        for f in reste:
            print(f"    {f}")
        return 1

    print(f"\n✅ {len(manquantes)} migration(s) appliquée(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
