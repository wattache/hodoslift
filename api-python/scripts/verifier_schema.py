"""`docs/postgres-schema.sql` décrit-il encore la VRAIE base ? (FRE-80, FRE-133, FRE-154)

⚠️ POURQUOI CE SCRIPT PLUTÔT QU'UN `pg_dump --schema-only` DIFFÉ. Le fichier de
référence n'est pas un dump : il est écrit à la main, ordonné par domaine, et la
moitié de sa valeur tient dans ses commentaires — pourquoi le score n'est pas
stocké, pourquoi `pending` est un état et pas une absence. Diffé contre un dump,
il rougirait à chaque ligne pour des raisons de mise en forme, et on apprendrait
à ignorer le signal.

On compare donc CATALOGUE À CATALOGUE : un Postgres jetable est bâti DEPUIS le
fichier, et son catalogue est comparé à celui de la vraie base — tables, vues et
leur définition, enums et leurs valeurs, colonnes avec type, nullité et défaut,
contraintes, index. Deux catalogues produits par le même moteur : plus rien à
interpréter. Sans Docker, on retombe sur une lecture du fichier par motif
régulier, qui ne voit que les NOMS — et le script le dit, et `--strict` le refuse.

⚠️ ET C'EST UN SCRIPT, PAS UN TEST. Il lui faut `DATABASE_URL` vers la
production ; pytest doit tourner sans identifiants. Le complément qui, LUI, court
partout est `tests/test_schema_reference.py` : il vérifie que toute table
interrogée par le code est déclarée dans le fichier — c'est ce qui aurait attrapé
`competition_coach_availability` tout seul.

À jouer avant tout déploiement qui touche au schéma — et `make deploy` le joue :

    make schema-verifier            # vert si Docker manque, en le disant
    make schema-verifier STRICT=1   # refuse de conclure sans Docker (code 2)

⚠️ CE QUE CE SCRIPT A APPRIS À SES DÉPENS (FRE-154) : un vérificateur qui sort 0
pour la mauvaise raison est PIRE que pas de vérificateur, parce qu'il rassure. Il
a crié au loup trois fois sur un schéma juste (CHECK sur deux lignes, `REFERENCES`
en continuation, `ALTER TABLE ADD COLUMN`), et il est sorti vert une fois sur un
fichier CASSÉ — en annonçant « Docker indisponible ». Les deux sens sont fermés :
un fichier illisible est un échec (1), l'absence de Docker est un mode dégradé
nommé (0, ou 2 en `--strict`), et ils ne se confondent plus.
"""

import argparse
import re
import sys
import pathlib

# Lancé depuis `scripts/` par `make` : la racine n'est pas sur le chemin
# d'import, contrairement à pytest qui l'y met (cf. `exporter_openapi.py`).
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from sqlalchemy import create_engine, text  # noqa: E402

from app.socle.db import _resolve_url  # noqa: E402

RACINE = pathlib.Path(__file__).resolve().parent.parent
REFERENCE = RACINE / "docs" / "postgres-schema.sql"

# L'image du Postgres jetable. ⚠️ MÊME MAJEURE QUE NEON (`nidavellir/neon.tf`,
# `pg_version`) : le déparsage des contraintes et des vues change d'une majeure
# à l'autre, et deux catalogues de versions différentes divergeraient sur la
# forme sans que rien ne diverge sur le fond.
IMAGE_POSTGRES = "postgres:16"


class SchemaIllisible(Exception):
    """Le fichier de référence ne s'exécute pas sur un Postgres neuf.

    ⚠️ CE N'EST PAS « DOCKER INDISPONIBLE », et la distinction est tout l'objet
    de FRE-154 : la première version rangeait les deux sous le même `except`, et
    un fichier CASSÉ faisait dire « Docker indisponible » puis sortir 0. Le seul
    filet était la fixture `pg` de pytest, qui charge le même fichier — c'est
    dire qu'un `make schema-verifier` joué seul avant un déploiement annonçait
    `[schéma] OK` sur un fichier que pytest aurait refusé."""


# --------------------------------------------------------------------------- #
# LA LECTURE DU FICHIER PAR MOTIF — le mode DÉGRADÉ, sans Docker
#
# ⚠️ CE N'EST PLUS LE CHEMIN PRINCIPAL. Quand Docker est là, les colonnes sont
#    comparées catalogue à catalogue comme le reste, et cet extracteur ne sert
#    pas. Il reste pour le poste sans Docker, et il ne voit que des NOMS.
#
# ⚠️ IL A INVENTÉ DES COLONNES TROIS FOIS, et la quatrième forme était pire : un
#    faux NÉGATIF. Le motif `(.*?)\n\);` qui délimitait un bloc sautait au `\n);`
#    SUIVANT du fichier dès que le bloc se fermait autrement — `);` indenté,
#    `) ;`, `) PARTITION BY …;` — et absorbait les colonnes des tables d'après.
#    Une colonne retirée du bloc de `t1` était alors masquée dès que la table
#    avalée déclarait un homonyme : `id`, `created_at`, `athlete_id`, `position`.
#    Le bloc est désormais délimité par la parenthèse qui le FERME, comptée.
#
#    Et la règle de déclaration est inversée : une ligne à profondeur zéro n'est
#    une colonne que si elle SUIT une virgule ou l'ouverture du bloc. La liste
#    `_MOT_CLE` d'avant nommait des mots-clés de CONTRAINTE de table ; le défaut
#    était une continuation de définition de COLONNE (`DEFAULT …`, `ON DELETE …`,
#    `GENERATED …`), qu'elle ne pouvait pas couvrir.
# --------------------------------------------------------------------------- #

_MOT_CLE = ("PRIMARY", "FOREIGN", "UNIQUE", "CHECK", "CONSTRAINT", "EXCLUDE",
            "LIKE", "REFERENCES")


def _sans_commentaires(sql: str) -> str:
    """Retire les commentaires `/* … */` et `-- …`. Seul `--` était filtré ; un
    bloc `/* cette colonne … */` faisait inventer `/*` et `cette`."""
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.S)
    return "\n".join(ligne.split("--", 1)[0] for ligne in sql.splitlines())


def _bloc_create_table(schema: str, table: str) -> str | None:
    """Le corps du `CREATE TABLE table (…)`, délimité par la PARENTHÈSE qui le
    ferme — comptée, pas devinée par un `\\n);` qui peut être celui d'après."""
    debut = re.search(r"CREATE TABLE (?:IF NOT EXISTS\s+)?" + re.escape(table) + r"\s*\(",
                      schema, re.I)
    if not debut:
        return None
    profondeur, i = 1, debut.end()
    while i < len(schema) and profondeur:
        profondeur += {"(": 1, ")": -1}.get(schema[i], 0)
        i += 1
    return schema[debut.end():i - 1] if not profondeur else None


def _colonnes_ajoutees(schema: str, table: str) -> set[str]:
    """Les colonnes qu'un `ALTER TABLE … ADD COLUMN` ajoute plus bas dans le
    fichier — y compris plusieurs dans le même ordre (`ADD COLUMN a, ADD COLUMN b`),
    que la première version ne lisait qu'à moitié."""
    colonnes: set[str] = set()
    for ordre in re.finditer(
            r"ALTER\s+TABLE\s+(?:ONLY\s+)?" + re.escape(table) + r"\s+(.*?);",
            schema, re.I | re.S):
        for m in re.finditer(r"ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?[\"']?(\w+)",
                             ordre.group(1), re.I):
            colonnes.add(m.group(1).lower())
    return colonnes


def _colonnes_declarees(schema: str, table: str) -> set[str]:
    """Les colonnes que le fichier déclare pour une table : celles du
    `CREATE TABLE`, et celles qu'un `ALTER TABLE … ADD COLUMN` lui ajoute."""
    schema = _sans_commentaires(schema)
    bloc = _bloc_create_table(schema, table)
    if bloc is None:
        return set()
    colonnes = _colonnes_ajoutees(schema, table)
    profondeur = 0
    # ⚠️ UNE DÉCLARATION SUIT UNE VIRGULE OU L'OUVERTURE, et rien d'autre. C'est
    # ce qui rend `DEFAULT now()` ou `ON DELETE CASCADE` en continuation
    # inoffensifs sans avoir à les énumérer.
    attend_une_declaration = True
    for ligne in bloc.splitlines():
        nue = ligne.strip()
        if not nue:
            continue
        if attend_une_declaration and profondeur == 0 \
                and not nue.upper().startswith(_MOT_CLE):
            # Plusieurs colonnes sur une ligne : chacune après une virgule.
            for morceau in nue.split(","):
                # ⚠️ LA PROFONDEUR SE TESTE AVANT D'AJOUTER, pas après : le second
                # morceau d'un `CHECK (x IN ('a', 'b'))` sur deux lignes est
                # `'b'))` — une virgule DANS une parenthèse, pas une colonne.
                if profondeur:
                    break
                mot = morceau.strip().split()
                if mot and not mot[0].upper().startswith(_MOT_CLE):
                    colonnes.add(mot[0].strip('"').lower())
                profondeur += morceau.count("(") - morceau.count(")")
            profondeur = 0 if profondeur < 0 else profondeur
        else:
            profondeur += ligne.count("(") - ligne.count(")")
        attend_une_declaration = profondeur == 0 and nue.rstrip().endswith(",")
    return colonnes


# --------------------------------------------------------------------------- #
# LE CATALOGUE — comparé CATALOGUE À CATALOGUE (FRE-133, élargi par FRE-154)
#
# ⚠️ PAS PAR ANALYSE DU FICHIER, ET C'EST LE CŒUR DU PROCÉDÉ. Une contrainte
#    s'écrit de dix façons — en ligne dans le `CREATE TABLE`, par `ALTER TABLE
#    ADD CONSTRAINT`, avec ou sans nom — et Postgres la NORMALISE ensuite. La
#    lire au motif régulier, c'est réécrire un analyseur SQL, et se tromper.
#
# ⚠️ ON COMPARE LES DÉFINITIONS, PAS LES NOMS. Un `CHECK` écrit en ligne reçoit
#    un nom AUTO-GÉNÉRÉ (`table_colonne_check`), et rien ne garantit qu'il soit
#    le même dans une base bâtie par la SÉRIE de migrations et dans une base
#    bâtie par le FICHIER. Comparer les noms produirait des écarts qui n'en sont
#    pas — et un vérificateur qui crie au loup finit ignoré.
#
# ⚠️ CE QUE FRE-154 A AJOUTÉ, parce que le contrôle « profond » ne le voyait
#    pas : les COLONNES avec leur type, leur nullité et leur défaut (en PG ≤ 17
#    un `NOT NULL` n'est pas dans `pg_constraint`), les VALEURS des enums (seuls
#    les noms étaient comparés), et la DÉFINITION des vues (le barème du RIS est
#    une vue — sa formule est du métier). Un `text` devenu `integer` ou une
#    valeur d'enum ajoutée en prod sortaient verts.
# --------------------------------------------------------------------------- #

# ⚠️ CE QUI APPARTIENT À UNE EXTENSION N'EST PAS NOTRE SCHÉMA (FRE-157).
#
# Activer `pg_stat_statements` a créé deux VUES dans `public`, et le
# vérificateur les a aussitôt comptées comme un écart : « existe en base, ABSENT
# du fichier ». Il aurait donc fallu recopier dans le fichier de référence des
# objets que Postgres crée et détruit avec l'extension — et les tenir à jour à
# chaque montée de version.
#
# `pg_depend` avec `deptype = 'e'` marque exactement ces objets : ceux dont la
# vie est liée à une extension. On les écarte partout où on lit le catalogue.
#
# ⚠️ ET ÇA NE MASQUE RIEN DE CE QUI NOUS APPARTIENT : `pgcrypto` est activée
# depuis toujours et n'avait jamais rien fait apparaître ici, parce qu'elle
# n'expose que des fonctions. La première extension à poser une VUE a suffi à
# rendre le vérificateur rouge sur un schéma parfaitement sain — c'est-à-dire à
# le rendre ignorable, ce qu'il ne doit jamais devenir.
_SANS_EXTENSION = """
    AND NOT EXISTS (SELECT 1 FROM pg_depend d
                     WHERE d.objid = {oid} AND d.deptype = 'e')
"""

_CONTRAINTES = text("""
    SELECT conrelid::regclass::text AS objet, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
     WHERE connamespace = 'public'::regnamespace AND conrelid <> 0
       AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.objid = pg_constraint.oid AND d.deptype = 'e')
""")

# ⚠️ LE NOM DE L'INDEX EST RETIRÉ de sa définition, pour la raison ci-dessus :
#    `training_sets_nom_idx` contre `training_sets_categorie_exercise_idx` décrit
#    le MÊME index si la définition qui suit est la même.
_INDEX = text(r"""
    SELECT tablename AS objet,
           regexp_replace(indexdef, '^CREATE (UNIQUE )?INDEX \S+ ON',
                          'CREATE \1INDEX ON') AS definition
      FROM pg_indexes i
      JOIN pg_class c ON c.relname = i.indexname
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = i.schemaname
     WHERE i.schemaname = 'public'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.objid = c.oid AND d.deptype = 'e')
""")

# `udt_name` et non `data_type` : ce dernier rend `USER-DEFINED` pour un enum et
# `ARRAY` pour un tableau, effaçant justement ce qu'on veut comparer.
_COLONNES = text("""
    SELECT table_name AS objet,
           column_name || ' ' || udt_name
           || CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END
           || coalesce(' DEFAULT ' || column_default, '') AS definition
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN (
             SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind = 'r'
                AND NOT EXISTS (SELECT 1 FROM pg_depend d
                                 WHERE d.objid = c.oid AND d.deptype = 'e'))
""")

_ENUMS = text("""
    SELECT t.typname AS objet,
           string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS definition
      FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.objid = t.oid AND d.deptype = 'e')
     GROUP BY t.typname
""")

_VUES = text("""
    SELECT c.relname AS objet, pg_get_viewdef(c.oid, true) AS definition
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'v'
""" + _SANS_EXTENSION.format(oid="c.oid"))

# ⚠️ LES FONCTIONS ET LES TRIGGERS AUSSI (19/09). Ils manquaient : FRE-176 avait
#    trouvé un bac à sable sans `ff_series_tenues` que rien n'avait vu, et le
#    premier trigger du projet (`ff_pose_la_structure`, une bibliothèque par
#    structure) porte une garantie — la structure de chaque ligne — qu'une base
#    qui l'aurait perdu laisserait fuir en silence.
#
#    La FONCTION se compare par sa SIGNATURE, pas par son corps : le texte d'un
#    corps dépend de qui l'a écrit (fichier, migration, `CREATE OR REPLACE`
#    successifs) et rendrait ce contrôle rouge sur une base saine — donc
#    ignorable. Son absence, elle, se voit. Le TRIGGER se compare en entier : sa
#    définition est normalisée par Postgres.
_FONCTIONS = text("""
    SELECT 'fonctions' AS objet,
           p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS definition
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
""" + _SANS_EXTENSION.format(oid="p.oid"))

_TRIGGERS = text("""
    SELECT t.tgrelid::regclass::text AS objet, pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t
     WHERE NOT t.tgisinternal
       AND t.tgrelid IN (SELECT c.oid FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace)
""")

GENRES = ("colonne", "enum", "vue", "contrainte", "index", "fonction", "trigger")
_REQUETES = {"colonne": _COLONNES, "enum": _ENUMS, "vue": _VUES,
             "contrainte": _CONTRAINTES, "index": _INDEX,
             "fonction": _FONCTIONS, "trigger": _TRIGGERS}


def _catalogue(conn) -> dict[str, dict[str, set[str]]]:
    """Tout ce qu'on compare, par genre puis par objet."""
    sortie: dict[str, dict[str, set[str]]] = {g: {} for g in GENRES}
    for genre, requete in _REQUETES.items():
        for objet, definition in conn.execute(requete).all():
            sortie[genre].setdefault(objet, set()).add(definition)
    return sortie


def _catalogue_du_fichier(schema: str):
    """Le catalogue qu'un Postgres NEUF produit à partir du fichier de référence.

    Rend `None` si Docker (ou testcontainers) n'est pas là — mode dégradé, que
    `main` nomme et que `--strict` refuse. Lève `SchemaIllisible` si le fichier
    ne s'exécute pas : ça, ce n'est jamais un mode dégradé, c'est un échec."""
    try:
        from testcontainers.community.postgres import PostgresContainer
    except ImportError:
        return None
    try:
        conteneur = PostgresContainer(IMAGE_POSTGRES, driver="psycopg")
        conteneur.start()
    except Exception:  # noqa: BLE001 — Docker absent, image indisponible…
        return None
    try:
        moteur = create_engine(conteneur.get_connection_url())
        try:
            with moteur.begin() as conn:
                # Curseur BRUT : le fichier porte des `%` dans ses commentaires,
                # que psycopg lirait sinon comme des placeholders (cf. conftest).
                conn.connection.driver_connection.execute(schema)
        except Exception as e:  # noqa: BLE001 — on veut le message, pas le type
            raise SchemaIllisible(str(e).strip().splitlines()[0]) from e
        with moteur.connect() as conn:
            catalogue = _catalogue(conn)
        moteur.dispose()
        return catalogue
    finally:
        conteneur.stop()


def _comparer_catalogues(reel: dict, profond: dict, ecarts: list[str],
                         objets_communs: set[str]) -> None:
    """Les écarts entre les deux catalogues, genre par genre.

    Un objet absent d'un côté est DÉJÀ signalé par la comparaison des noms :
    on ne compare ici que ceux qui existent des deux côtés, pour ne pas répéter
    la même nouvelle sous cinq formes."""
    for genre in GENRES:
        for objet in sorted(set(reel[genre]) | set(profond[genre])):
            if objet not in objets_communs:
                continue
            en_base, au_fichier = reel[genre].get(objet, set()), profond[genre].get(objet, set())
            for d in sorted(en_base - au_fichier):
                ecarts.append(f"{objet} : {genre} en base, ABSENTE du fichier — {d}")
            for d in sorted(au_fichier - en_base):
                ecarts.append(f"{objet} : {genre} du fichier, ABSENTE de la base — {d}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--strict", action="store_true",
                        help="refuse de conclure sans Docker (code 2) : pour le "
                             "geste d'avant déploiement, où « vérifié à moitié » "
                             "ne vaut pas « vérifié »")
    args = parser.parse_args(argv)

    # ⚠️ LA MÊME RÉSOLUTION QUE L'APPLICATION, pas un `os.environ` à part.
    #
    # La première version lisait `os.environ["DATABASE_URL"]` — que le Makefile
    # n'exporte pas et que `.env` n'alimente qu'à travers pydantic. `make
    # schema-verifier` échouait donc TOUJOURS, sur « DATABASE_URL absente », et
    # les deux commits qui l'annonçaient « au vert contre Neon » ne l'étaient que
    # parce que la variable avait été exportée à la main.
    #
    # C'est l'argument de ce script retourné contre lui : une vérification qui
    # échoue pour la mauvaise raison finit ignorée. Relevé par la revue du 22/08.
    try:
        url = _resolve_url()
    except Exception as e:  # noqa: BLE001 — on veut le message, pas la trace
        print(f"⛔ base introuvable : {e}")
        return 1
    schema = REFERENCE.read_text(encoding="utf-8")

    with create_engine(url).connect() as c:
        # ⚠️ « HORS EXTENSION » ICI AUSSI, et c'est l'endroit qui avait rougi :
        # activer `pg_stat_statements` a fait apparaître deux VUES que le fichier
        # de référence n'a évidemment pas. Ce ne sont pas les nôtres — Postgres
        # les crée et les détruit avec l'extension (cf. `_SANS_EXTENSION`).
        def _hors_extension(requete: str) -> set[str]:
            return {r[0] for r in c.execute(text(requete)).all()}

        tables = _hors_extension("""
            SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relkind = 'r'
               AND NOT EXISTS (SELECT 1 FROM pg_depend d
                                WHERE d.objid = c.oid AND d.deptype = 'e')""")
        vues = _hors_extension("""
            SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relkind = 'v'
               AND NOT EXISTS (SELECT 1 FROM pg_depend d
                                WHERE d.objid = c.oid AND d.deptype = 'e')""")
        enums = _hors_extension("""
            SELECT typname FROM pg_type t WHERE t.typtype = 'e'
               AND NOT EXISTS (SELECT 1 FROM pg_depend d
                                WHERE d.objid = t.oid AND d.deptype = 'e')""")
        colonnes: dict[str, set[str]] = {}
        for t, col in c.execute(text(
            "SELECT table_name, column_name FROM information_schema.columns "
            "WHERE table_schema = 'public'")).all():
            colonnes.setdefault(t, set()).add(col.lower())

    tables_ref = {m.lower() for m in re.findall(
        r"CREATE TABLE (?:IF NOT EXISTS\s+)?(\w+)", schema, re.I)}
    vues_ref = {m.lower() for m in re.findall(
        r"CREATE (?:OR REPLACE )?VIEW\s+(\w+)", schema, re.I)}
    enums_ref = {m.lower() for m in re.findall(
        r"CREATE TYPE\s+(\w+)\s+AS ENUM", schema, re.I)}

    ecarts: list[str] = []

    def comparer(quoi: str, reel: set[str], declare: set[str]) -> None:
        for nom in sorted(reel - declare):
            ecarts.append(f"{quoi} « {nom} » existe en base, ABSENT du fichier")
        for nom in sorted(declare - reel):
            ecarts.append(f"{quoi} « {nom} » déclaré dans le fichier, ABSENT de la base")

    comparer("table", tables, tables_ref)
    comparer("vue", vues, vues_ref)
    comparer("enum", enums, enums_ref)

    # LE CATALOGUE, contre un Postgres bâti depuis le fichier.
    try:
        profond = _catalogue_du_fichier(schema)
    except SchemaIllisible as e:
        print(f"[schéma] ÉCHEC — le fichier de référence NE S'EXÉCUTE PAS sur un "
              f"Postgres neuf :\n\n   {e}\n")
        print("  Ce n'est pas « Docker indisponible » : le fichier est cassé, et")
        print("  pytest le refuserait de la même façon. Rien n'a été comparé.")
        return 1

    if profond is None:
        # Mode dégradé : les colonnes par lecture du fichier, rien d'autre.
        for t in sorted(tables & tables_ref):
            declarees = _colonnes_declarees(schema, t)
            if not declarees:  # bloc illisible : le signaler plutôt que le taire
                ecarts.append(f"table « {t} » : bloc CREATE TABLE introuvable dans le fichier")
                continue
            reelles = colonnes.get(t, set())
            for col in sorted(reelles - declarees):
                ecarts.append(f"{t}.{col} existe en base, ABSENTE du fichier")
            for col in sorted(declarees - reelles):
                ecarts.append(f"{t}.{col} déclarée dans le fichier, ABSENTE de la base")
    else:
        with create_engine(url).connect() as c:
            reel = _catalogue(c)
        _comparer_catalogues(reel, profond, ecarts, (tables & tables_ref) | (vues & vues_ref)
                             | (enums & enums_ref))

    if ecarts:
        print(f"[schéma] ÉCHEC — {len(ecarts)} écart(s) entre le fichier et la base :\n")
        for e in ecarts:
            print(f"   · {e}")
        print("\n  Le fichier n'est pas de la doc : pytest le charge, et le bac à sable")
        print("  e2e en est construit. Un écart ici, c'est un harnais qui ment.")
        return 1

    if profond is None:
        print(f"[schéma] noms seulement — {len(tables)} tables, {len(vues)} vue(s), "
              f"{len(enums)} enums, colonnes par nom : concordants.")
        print("⚠️  Docker indisponible : types, défauts, valeurs d'enum, définitions de")
        print("    vues, contraintes, index, fonctions et triggers NON vérifiés. Ce n'est pas un OK.")
        if args.strict:
            print("    `--strict` : on ne conclut pas sur une vérification à moitié faite.")
            return 2
        return 0

    print(f"[schéma] OK — {len(tables)} tables, {len(vues)} vue(s), {len(enums)} enums ; "
          "colonnes, types, défauts, valeurs d'enum, vues, contraintes, index, fonctions et triggers : "
          "le fichier décrit bien la base.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
