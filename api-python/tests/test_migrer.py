"""LE LANCEUR DE MIGRATIONS — ce qu'il refuse, surtout (FRE-133).

⚠️ CE QUI EST ÉPROUVÉ ICI N'EST PAS « ÇA MARCHE », C'EST « ÇA NE DÉTRUIT PAS ».
Un lanceur qui se trompe rejoue des migrations déjà passées : au mieux inutile,
au pire destructeur — les lots de renommage de FRE-11 ne sont pas idempotents
au-delà de leur garde.
"""

import pathlib
import re

import pytest
from sqlalchemy import text

from scripts.migrer import AMORCE, deja_appliquees, fichiers_du_depot


def test_l_ordre_est_celui_du_NOM():
    """⚠️ ET PAS CELUI DU SYSTÈME DE FICHIERS. Les migrations sont préfixées d'une
    date : `glob` seul rendrait l'ordre du répertoire, qui dépend de l'ordre
    d'écriture sur le disque. Une migration jouée avant celle dont elle dépend
    échoue — ou pire, réussit sur un schéma à moitié formé."""
    noms = fichiers_du_depot()
    assert noms == sorted(noms)
    assert noms, "le dossier des migrations ne peut pas être vide"


def test_l_amorce_existe_bel_et_bien():
    """Le message d'erreur du lanceur envoie vers ce fichier : s'il était renommé,
    le seul chemin de sortie deviendrait une impasse."""
    assert (pathlib.Path(__file__).parent.parent / "docs" / "migrations" / AMORCE).exists()


def test_une_base_SANS_la_table_ne_declare_rien_applique(pg):
    """⚠️ TABLE ABSENTE = BASE D'AVANT LE MÉCANISME, PAS UNE ERREUR. C'est le cas
    de toute base qui n'a pas reçu l'amorce — dont le bac à sable, qui est
    justement celle qu'on veut rattraper. Lever ici obligerait l'appelant à
    connaître l'état avant de poser la question."""
    pg.execute(text("DROP TABLE IF EXISTS schema_migrations"))
    assert deja_appliquees(pg) == set()


def test_ce_qui_est_enregistre_se_relit(pg):
    pg.execute(text(
        "CREATE TABLE IF NOT EXISTS schema_migrations ("
        "  fichier text PRIMARY KEY, applique_le timestamptz NOT NULL DEFAULT now())"))
    pg.execute(text("INSERT INTO schema_migrations (fichier) VALUES ('a.sql'), ('b.sql') "
                    "ON CONFLICT DO NOTHING"))
    assert {"a.sql", "b.sql"} <= deja_appliquees(pg)


def test_CHAQUE_migration_est_declaree_quelque_part():
    """⚠️ UN FICHIER QUI OUBLIE SA LIGNE RESTE « EN ATTENTE » POUR TOUJOURS, et
    serait donc rejoué sur la production au premier `--apply`. Le lanceur ne
    rattrape rien de lui-même — c'est délibéré (voir `scripts/migrer`) — donc la
    seule garde possible est ici.

    Deux façons LÉGITIMES d'être déclaré, et pas une seule :
      · être dans le RATTRAPAGE de l'amorce — les 45 fichiers déjà passés à la
        main, qu'on déclare appliqués sans les rejouer ;
      · porter son PROPRE `INSERT INTO schema_migrations`, ce que fait toute
        migration écrite depuis. Une migration neuve n'a rien à faire dans le
        rattrapage : l'y mettre la déclarerait appliquée sur une base qui ne l'a
        jamais reçue, ce qui est le défaut exact qu'on veut empêcher.

    ⚠️ LA VERSION D'AVANT NE CONNAISSAIT QUE LA PREMIÈRE, et poussait donc vers
    la faute. Elle avait pourtant sa raison d'être : première rédaction du
    rattrapage tapée de mémoire, SEIZE noms inventés sur 45 et dix-neuf fichiers
    réels oubliés. Ce qu'elle gardait est conservé — c'est le `or` ci-dessous."""
    dossier = pathlib.Path(__file__).parent.parent / "docs" / "migrations"
    amorce = (dossier / AMORCE).read_text()
    manquantes = [
        n for n in fichiers_du_depot()
        if f"'{n}'" not in amorce and f"'{n}'" not in (dossier / n).read_text()
    ]
    assert not manquantes, (
        "ces migrations ne sont déclarées nulle part — ajoute-leur leur "
        f"`INSERT INTO schema_migrations` avant leur `COMMIT` : {manquantes}")


# --------------------------------------------------------------------------- #
# LE VÉRIFICATEUR DE SCHÉMA VOIT LES CONTRAINTES ET LES INDEX (FRE-133)
#
# ⚠️ CE QU'IL NE VOYAIT PAS : 59 clés étrangères, 34 CHECK et 21 UNIQUE. FRE-105
# et FRE-110 ont livré le même jour deux migrations FAUSSES sur des CHECK, et le
# fichier de référence est resté vert. Il ne comparait que tables, vues, enums et
# colonnes.
# --------------------------------------------------------------------------- #

from scripts.verifier_schema import _catalogue  # noqa: E402


def test_le_catalogue_rend_les_contraintes_et_les_index(pg):
    """Le socle : ce que le vérificateur lit des deux côtés."""
    cat = _catalogue(pg)
    assert cat["contrainte"], "aucune contrainte lue — la requête ne rend rien"
    assert cat["index"], "aucun index lu"
    # Une contrainte connue, dont le libellé est stable : le CHECK de la
    # bibliothèque, celui-là même que FRE-147 a manipulé.
    defs = cat["contrainte"].get("library_entries", set())
    assert any("competition" in d for d in defs), defs


def test_le_catalogue_voit_ce_que_le_controle_profond_ne_voyait_pas(pg):
    """⚠️ FRE-154 : `NOT NULL`, les TYPES, les DÉFAUTS, les VALEURS d'un enum et
    la DÉFINITION d'une vue sortaient verts. En PG ≤ 17 un `NOT NULL` n'est pas
    dans `pg_constraint`, et seuls les NOMS des enums étaient comparés. Un `text`
    devenu `integer`, ou une valeur ajoutée à `event_type` en prod, ne se voyait
    nulle part."""
    cat = _catalogue(pg)
    colonnes = cat["colonne"].get("athletes", set())
    assert any(d.startswith("coach_uid text NOT NULL") for d in colonnes), colonnes
    assert any(d.startswith("archive_le timestamptz") and "NOT NULL" not in d
               for d in colonnes), colonnes
    assert any("id uuid NOT NULL DEFAULT gen_random_uuid()" == d for d in colonnes), colonnes
    # Les VALEURS de l'enum, dans l'ordre — pas seulement son nom.
    assert cat["enum"].get("event_type") == {"competition,vacation,travel,rest,other"}
    # La vue du barème : sa formule est du métier, elle se compare.
    assert any("total_bareme_kg" in d for d in cat["vue"].get("competition_scores", set()))


def test_un_fichier_de_reference_CASSE_est_un_echec_pas_docker_indisponible():
    """⚠️ LE FAUX VERT DE FRE-154. Le même `except Exception` enveloppait
    l'absence de Docker ET l'exécution du fichier : un schéma cassé faisait dire
    « Docker indisponible » puis sortir 0 — `[schéma] OK` sur un fichier que
    pytest aurait refusé. Ce test spinne un vrai conteneur, exprès : c'est le
    chemin réel, et c'est là que le mensonge se produisait."""
    from scripts.verifier_schema import SchemaIllisible, _catalogue_du_fichier
    with pytest.raises(SchemaIllisible):
        _catalogue_du_fichier("CREATE TABLE t (id uuid); CECI NEST PAS DU SQL;")


def test_une_colonne_dont_le_type_change_est_vue(pg):
    """La mutation : un type qui bouge change la définition comparée."""
    # `age integer` servait ici jusqu'à FRE-168, qui l'a retirée ; `email` n'a
    # pas de CHECK qui refuserait le changement de type.
    avant = {d for d in _catalogue(pg)["colonne"]["athletes"] if d.startswith("email ")}
    pg.execute(text("ALTER TABLE athletes ALTER COLUMN email TYPE varchar(200)"))
    apres = {d for d in _catalogue(pg)["colonne"]["athletes"] if d.startswith("email ")}
    assert avant != apres


def test_le_NOM_de_l_index_ne_compte_pas(pg):
    """⚠️ ET C'EST DÉLIBÉRÉ. Un `CHECK` écrit en ligne reçoit un nom AUTO-GÉNÉRÉ,
    et rien ne garantit qu'il soit le même dans une base bâtie par la SÉRIE de
    migrations et dans une base bâtie par le FICHIER. Comparer les noms
    produirait des écarts qui n'en sont pas — et un vérificateur qui crie au loup
    finit ignoré, ce que ce script sait déjà trois fois.

    On le prouve en RENOMMANT un index : sa définition ne doit pas bouger."""
    pg.execute(text("CREATE INDEX un_nom_quelconque ON athletes (coach_uid)"))
    avant = {d for d in _catalogue(pg)["index"].get("athletes", set())
             if "coach_uid" in d}
    pg.execute(text("ALTER INDEX un_nom_quelconque RENAME TO un_tout_autre_nom"))
    apres = {d for d in _catalogue(pg)["index"].get("athletes", set())
             if "coach_uid" in d}
    assert avant == apres, "le nom de l'index a fui dans la définition comparée"


# --------------------------------------------------------------------------- #
# UNE MIGRATION QUI CRÉE UNE TABLE POSE SON `GRANT` (FRE-151)
# --------------------------------------------------------------------------- #

#: Les privilèges du rôle applicatif sont accordés TABLE PAR TABLE
#: (`nidavellir/sql/brokkr_app.sql`), et non par `ON ALL TABLES` avec des
#: privilèges par défaut — décision de William, 09/09 : le droit se lit dans un
#: fichier plutôt qu'en interrogeant la base.
#:
#: ⚠️ LE PRIX EN EST CETTE SPEC. Une table créée sans son `GRANT` ne casse RIEN
#: au déploiement : elle est simplement invisible à l'application, et le défaut
#: sort au premier appel de la route concernée — en 500, découvert par un coach,
#: des semaines après le commit qui l'a causé. C'est la famille exacte des
#: défauts que ce dépôt paie le plus cher, et une consigne ne la garde pas.
#:
#: Les migrations d'AVANT cette date sont hors sujet : le rôle n'existait pas.
#: C'est le même procédé que le rattrapage de l'amorce — on ne réécrit pas
#: l'histoire, on borne ce qui s'applique à partir d'ici.
_DEPUIS_LE_ROLE_APPLICATIF = "2026-09-09"


def test_une_migration_qui_CREE_une_table_pose_son_GRANT():
    """⚠️ ET LA TABLE VISÉE DOIT ÊTRE LA BONNE. Un `GRANT` sur une autre table du
    même fichier passerait un contrôle qui ne chercherait que le mot
    « brokkr_app » : on exige donc le nom de CHAQUE table créée."""
    dossier = pathlib.Path(__file__).parent.parent / "docs" / "migrations"
    manquants: list[str] = []
    for nom in fichiers_du_depot():
        if nom < _DEPUIS_LE_ROLE_APPLICATIF:
            continue
        texte = (dossier / nom).read_text(encoding="utf-8")
        creees = re.findall(
            r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)",
            texte, re.IGNORECASE)
        for table in creees:
            grant = re.search(
                rf"GRANT[^;]*\b{re.escape(table)}\b[^;]*brokkr_app", texte,
                re.IGNORECASE | re.DOTALL)
            if not grant:
                manquants.append(f"{nom} → {table}")
    assert not manquants, (
        "ces tables naîtraient INVISIBLES à l'application — ajoute leur "
        "`GRANT SELECT, INSERT, UPDATE, DELETE ON <table> TO brokkr_app;` dans "
        "la migration, ET dans `nidavellir/sql/brokkr_app.sql` qui est la liste "
        f"de référence : {manquants}")


def test_ce_qui_appartient_a_une_EXTENSION_n_est_pas_notre_schema(pg):
    """⚠️ LE FAUX POSITIF DU 09/09 (FRE-157). Activer `pg_stat_statements` a créé
    deux VUES dans `public`, et le vérificateur les a comptées comme un écart :
    « existe en base, ABSENT du fichier ». Le déploiement s'est arrêté sur un
    schéma parfaitement sain.

    Recopier ces objets dans le fichier de référence aurait été le mauvais
    remède : Postgres les crée et les détruit avec l'extension, et leur forme
    change d'une version à l'autre. `pg_depend` les désigne exactement.

    ⚠️ `pgcrypto` EST ACTIVÉE DEPUIS TOUJOURS et n'avait jamais rien fait
    apparaître ici — elle n'expose que des fonctions. La première extension à
    poser une VUE a suffi à rendre le vérificateur rouge, c'est-à-dire à le
    rendre ignorable."""
    from scripts.verifier_schema import _catalogue

    avant = set(_catalogue(pg)["vue"])
    pg.execute(text("CREATE EXTENSION IF NOT EXISTS pg_stat_statements"))
    vues_ajoutees = {r[0] for r in pg.execute(text(
        "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname = 'public' AND c.relkind = 'v' "
        "  AND EXISTS (SELECT 1 FROM pg_depend d "
        "               WHERE d.objid = c.oid AND d.deptype = 'e')"))}
    assert vues_ajoutees, "l'extension n'a posé aucune vue : la spec ne prouverait rien"
    assert set(_catalogue(pg)["vue"]) == avant, (
        f"le catalogue a gobé des objets d'extension : {vues_ajoutees}")


def test_une_migration_ORPHELINE_arrete_tout_avant_d_ecrire(pg, monkeypatch, capsys):
    """FRE-176 — ⚠️ UN FICHIER RENOMMÉ APRÈS AVOIR ÉTÉ JOUÉ. Sa ligne reste sous
    l'ancien nom, et le nouveau paraît « en attente » : `--apply` le REJOUERAIT.
    Le 18/09, le bac à sable portait le lot 5 sous deux noms ; le script
    l'affichait et rendait 0. Il rend 1, en lecture comme en `--apply`, et
    n'ouvre même pas la connexion d'écriture."""
    import contextlib
    import scripts.migrer as migrer

    class MoteurDuTest:
        def connect(self):
            return contextlib.nullcontext(pg)

        def execution_options(self, **_):
            raise AssertionError("une écriture a été tentée malgré l'orpheline")

    monkeypatch.setattr(migrer, "get_engine", lambda: MoteurDuTest())
    monkeypatch.setattr(migrer, "verifier_cible", lambda **_: None)
    monkeypatch.setattr(migrer, "url_effective", lambda: "postgresql://test")
    pg.execute(text(
        "CREATE TABLE IF NOT EXISTS schema_migrations ("
        "  fichier text PRIMARY KEY, applique_le timestamptz NOT NULL DEFAULT now())"))
    # Tout le dépôt est appliqué, SAUF le dernier fichier — joué sous un autre nom.
    *jouees, renomme = fichiers_du_depot()
    for f in jouees + ["2000-01-01_ancien_nom_de_" + renomme]:
        pg.execute(text("INSERT INTO schema_migrations (fichier) VALUES (:f) ON CONFLICT DO NOTHING"),
                   {"f": f})

    for argv in (["migrer"], ["migrer", "--apply"]):
        monkeypatch.setattr("sys.argv", argv)
        assert migrer.main() == 1, argv
        assert "2000-01-01_ancien_nom_de_" in capsys.readouterr().out
