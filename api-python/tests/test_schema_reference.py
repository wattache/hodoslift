"""Le schéma de référence décrit-il encore ce que le code interroge ? (FRE-80)

⚠️ CE FICHIER EXISTE PARCE QU'UN FICHIER A MENTI SANS QUE RIEN NE LE VOIE.
`docs/postgres-schema.sql` n'est pas de la documentation : c'est ce que pytest
charge, et ce dont le bac à sable e2e est construit. Il avait divergé de Neon sur
deux points — `competition_coach_availability` (11 lignes en production, une
route qui l'interroge) absente, et deux colonnes `athletes` retirées le 20/08 qui
y traînaient encore.

Le coût n'était pas théorique : sur le bac à sable, la route de disponibilité
répondait 500 `UndefinedTable`, donc elle était INTESTABLE en e2e réel. Et son
test unitaire passait — parce qu'il fabriquait sa propre mini-table. Un harnais
qui ment coûte plus cher qu'un harnais absent.

⚠️ CE QUE CETTE SPEC PEUT, ET CE QU'ELLE NE PEUT PAS. Elle tourne SANS
identifiants, donc partout : elle compare le code au fichier. Elle aurait attrapé
la table manquante, qui est le défaut coûteux.

Elle ne voit en revanche que le SQL passé en littéral à `text(...)` — pas celui
assemblé en f-string (`training_tree.py`, `_COMMON_COLS`). C'est un PLANCHER,
pas un plafond : ce qu'elle affirme est vrai, ce qu'elle tait ne l'est pas
forcément. Une variante « toute table déclarée est-elle lue ? » a été écrite puis
JETÉE pour cette raison — elle signalait trois tables parfaitement utilisées,
mesurant les angles morts de l'extracteur plutôt que l'état du code.

Et elle ne peut pas voir une colonne que Neon a perdue et que le fichier garde :
ça demande la vraie base, c'est `make schema-verifier`, à jouer avant tout
déploiement qui touche au schéma.
"""

import pathlib
import re

RACINE = pathlib.Path(__file__).resolve().parent.parent
SCHEMA = (RACINE / "docs" / "postgres-schema.sql").read_text(encoding="utf-8")

# Les littéraux SQL du code : tout ce qui est passé à `text(...)`. On ne lit PAS
# les fichiers ligne à ligne — un commentaire français contenant « pour » ou
# « construit » ressemble à s'y méprendre à un `FROM <table>`.
_TEXT_SQL = re.compile(r'text\(\s*(?:"""(.*?)"""|"((?:[^"\\]|\\.)*)")', re.S)
# Les fragments assemblés en f-string (`_COMMON_COLS`) restent dans le même
# fichier : on prend aussi les chaînes triples nues qui contiennent du SQL.
_MOTS_SQL = re.compile(r'\b(?:FROM|JOIN|INTO|UPDATE)\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)', re.I)
_CTE = re.compile(r'\b(\w+)\s+AS\s*\(', re.I)
# `DO UPDATE SET` fait capturer « set » par le motif ci-dessus : le mot suivant
# `UPDATE` n'y est pas une table. Plutôt que de complexifier la regex, on écarte
# les mots-clés — la liste est courte et se lit.
_MOTS_CLES = {"set", "and", "or", "select", "values", "where", "only", "lateral"}


def _sql_du_code() -> str:
    morceaux = []
    for fichier in sorted((RACINE / "app").rglob("*.py")):
        source = fichier.read_text(encoding="utf-8")
        for triple, simple in _TEXT_SQL.findall(source):
            morceaux.append(triple or simple)
    return "\n".join(morceaux)


def _tables_declarees() -> set[str]:
    return {m.lower() for m in re.findall(r'CREATE (?:TABLE|VIEW)\s+(?:IF NOT EXISTS\s+)?(\w+)',
                                          SCHEMA, re.I)}


def test_toute_table_interrogee_par_le_code_est_DECLAREE_dans_le_schema():
    """⚠️ LA SPEC QUI AURAIT ATTRAPÉ FRE-80 TOUTE SEULE.

    Une table que le code interroge et que le fichier ignore, c'est un bac à
    sable amputé — et une route qu'aucun test réel ne peut atteindre. Le décalage
    ne se voit nulle part ailleurs : les tests unitaires qui fabriquent leur
    propre schéma passent, et la production, elle, a bien la table."""
    sql = _sql_du_code()
    # Les CTE sont des noms locaux à une requête (`WITH avant AS (…)`), pas des
    # tables : les compter ferait rougir la spec sur du SQL parfaitement sain.
    ctes = {m.lower() for m in _CTE.findall(sql)}
    interrogees = {m.lower() for m in _MOTS_SQL.findall(sql)} - ctes - _MOTS_CLES
    declarees = _tables_declarees()

    manquantes = sorted(interrogees - declarees)
    assert not manquantes, (
        "ces tables sont interrogées par le code mais ABSENTES de "
        f"docs/postgres-schema.sql : {', '.join(manquantes)}.\n"
        "Le bac à sable e2e est construit depuis ce fichier — sans elles, les "
        "routes concernées y répondent 500 UndefinedTable."
    )


# --------------------------------------------------------------------------- #
# L'EXTRACTEUR DE COLONNES — celui de `scripts/verifier_schema.py` (FRE-143)
# --------------------------------------------------------------------------- #

def test_les_colonnes_ajoutees_par_alter_table_sont_vues():
    """⚠️ `make schema-verifier` A ÉTÉ ROUGE SUR UN SCHÉMA JUSTE, et personne ne
    l'a vu passer au rouge : il annonçait sept colonnes `categorie` « absentes du
    fichier » alors qu'elles y sont, posées par `ALTER TABLE … ADD COLUMN` en fin
    de fichier avec les clés étrangères qu'elles servent (FRE-123).

    C'est la troisième forme SQL que cet extracteur ne savait pas lire, après les
    `CHECK` sur deux lignes et `REFERENCES` en continuation. Les deux premières
    ont été corrigées sans spec, et la troisième est arrivée. Celle-ci ferme la
    famille : un vérificateur qu'on lance et qui rougit toujours cesse d'être
    lancé, et il est censé tourner avant chaque déploiement qui touche au schéma.
    """
    from scripts.verifier_schema import _colonnes_declarees

    schema = (RACINE / "docs" / "postgres-schema.sql").read_text(encoding="utf-8")

    for table in ("training_exercises", "training_sets", "athlete_prs",
                  "athlete_goals", "block_objectives",
                  "training_base_principles", "training_base_accessories"):
        colonnes = _colonnes_declarees(schema, table)
        assert "categorie" in colonnes, (
            f"{table}.categorie est posée par ALTER TABLE dans le fichier, "
            "et l'extracteur ne la voit pas — le vérificateur rougira à tort."
        )
        # Le bloc CREATE TABLE doit continuer d'être lu, lui aussi.
        assert "id" in colonnes, f"{table} : l'extracteur a perdu le CREATE TABLE"


def test_l_extracteur_n_invente_pas_de_colonne():
    """Le pendant du test ci-dessus : on ne corrige pas un faux négatif en
    ouvrant la porte aux faux positifs. `objectifs_techniques` porte à la fois
    une clé étrangère composite sur deux lignes et un CHECK — les deux formes qui
    ont déjà fait inventer des colonnes à cet extracteur."""
    from scripts.verifier_schema import _colonnes_declarees

    schema = (RACINE / "docs" / "postgres-schema.sql").read_text(encoding="utf-8")
    colonnes = _colonnes_declarees(schema, "objectifs_techniques")

    assert "references" not in colonnes  # continuation de FOREIGN KEY
    assert "check" not in colonnes
    assert "foreign" not in colonnes
    assert {"id", "athlete_id", "mouvement", "texte", "cree_par"} <= colonnes


# ⚠️ LES SEPT FORMES LATENTES (FRE-154). Aucune n'est dans le fichier de
# référence aujourd'hui — ce sont les pièges de la même famille que les trois
# déjà payés, éprouvés sur un schéma FABRIQUÉ pour les contenir tous. Le pire
# est le bloc qui DÉBORDE : un faux négatif, qui masque une colonne disparue.
_SCHEMA_PIEGE = """
CREATE TABLE t1 (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    /* un commentaire bloc, que seul `--` filtrait */
    "order" integer,
    a integer, b integer,
    cree_le timestamptz NOT NULL
        DEFAULT now(),
    parent uuid REFERENCES t0(id)
        ON DELETE CASCADE,
    total integer GENERATED ALWAYS AS (a + b) STORED,
    ressenti text CHECK (ressenti IN ('ras', 'douleur',
                                      'gene'))
  );
CREATE TABLE t2 (
    id uuid PRIMARY KEY,
    colonne_de_t2 text
) PARTITION BY LIST (id);
ALTER TABLE t1 ADD COLUMN x text, ADD COLUMN y text;
"""


def test_l_extracteur_ne_deborde_pas_sur_la_table_suivante():
    """⚠️ LE FAUX NÉGATIF. `(.*?)\\n\\);` sautait au `\\n);` SUIVANT du fichier dès
    que le bloc se fermait autrement (`);` indenté ici), et absorbait les
    colonnes de `t2`. Une colonne retirée de `t1` était alors masquée dès que la
    table avalée déclarait un homonyme — `id`, `created_at`, `athlete_id`."""
    from scripts.verifier_schema import _colonnes_declarees
    assert "colonne_de_t2" not in _colonnes_declarees(_SCHEMA_PIEGE, "t1")
    assert ")" not in _colonnes_declarees(_SCHEMA_PIEGE, "t1")
    # Et `t2`, fermée par `) PARTITION BY …;`, se lit quand même.
    assert _colonnes_declarees(_SCHEMA_PIEGE, "t2") == {"id", "colonne_de_t2"}


def test_l_extracteur_lit_les_formes_qui_le_piegeaient():
    from scripts.verifier_schema import _colonnes_declarees
    colonnes = _colonnes_declarees(_SCHEMA_PIEGE, "t1")
    # Ce qu'il doit voir : chaque colonne, y compris les deux sur une ligne, la
    # citée, et les deux ajoutées par un seul ALTER TABLE.
    assert {"id", "order", "a", "b", "cree_le", "parent", "total", "ressenti",
            "x", "y"} <= colonnes
    # Ce qu'il ne doit PAS inventer : une continuation n'est pas une colonne.
    assert not {"default", "on", "generated", "/*", "un", "'douleur'", "'gene'))"} & colonnes
