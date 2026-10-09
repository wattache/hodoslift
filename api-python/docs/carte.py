"""La carte de brokkr : le schéma Postgres par domaine, en une page.

Lue depuis UNE BASE, jamais depuis le fichier SQL : un Postgres jetable (Docker)
est chargé avec `docs/postgres-schema.sql`, et la carte sort de son catalogue —
tables, colonnes, clés étrangères, et ce que chaque vue lit (`pg_depend`). Un
parseur de SQL maison aurait sa propre idée du schéma ; le catalogue n'en a
qu'une. `make carte` l'écrit dans `docs/carte-de-brokkr.html`, à ouvrir tel quel.

Le dessin se calcule à l'ouverture (elkjs, depuis un CDN) : la page ne porte
que la donnée.
"""
import json, pathlib, subprocess, sys, time

ICI = pathlib.Path(__file__).parent
SCHEMA = ICI / "postgres-schema.sql"
SORTIE = ICI / "carte-de-brokkr.html"
CONTENEUR = "brokkr-carte"
IMAGE = "postgres:16"

_EXTRACTION = """
SELECT json_build_object(
  'tables', (SELECT json_agg(json_build_object('name', c.relname, 'kind', c.relkind,
      'cols', (SELECT json_agg(json_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
                'pk', EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype='p' AND a.attnum = ANY(k.conkey)),
                'fk', (SELECT confrelid::regclass::text FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype='f' AND a.attnum = ANY(k.conkey) LIMIT 1),
                'null', NOT a.attnotnull) ORDER BY a.attnum)
               FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)) ORDER BY c.relname)
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','v')),
  'fks', (SELECT json_agg(json_build_object('from', conrelid::regclass::text, 'to', confrelid::regclass::text,
             'col', (SELECT string_agg(a.attname, ',') FROM pg_attribute a WHERE a.attrelid = conrelid AND a.attnum = ANY(conkey))))
          FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace),
  'deps', (SELECT json_agg(DISTINCT jsonb_build_object('view', v.relname, 'reads', t.relname))
           FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid JOIN pg_class v ON v.oid = r.ev_class
           JOIN pg_class t ON t.oid = d.refobjid
           WHERE v.relkind='v' AND t.relkind IN ('r','v') AND t.oid <> v.oid AND v.relnamespace='public'::regnamespace),
  'version', (SELECT current_setting('server_version_num')::int / 10000)
);
"""


def _docker(*args, entree=None, muet=False):
    return subprocess.run(["docker", *args], input=entree, text=True, check=True,
                          capture_output=muet or entree is not None).stdout


def extraire() -> dict:
    """Charge le schéma dans un Postgres jetable, lit son catalogue, l'efface."""
    subprocess.run(["docker", "rm", "-f", CONTENEUR], capture_output=True)
    _docker("run", "-d", "--name", CONTENEUR, "-e", "POSTGRES_PASSWORD=x", "-e", "POSTGRES_DB=carte", IMAGE, muet=True)
    try:
        for _ in range(60):
            if subprocess.run(["docker", "exec", CONTENEUR, "pg_isready", "-U", "postgres", "-q"]).returncode == 0:
                break
            time.sleep(0.5)
        else:
            sys.exit("le Postgres jetable ne répond pas")
        _docker("exec", "-i", CONTENEUR, "psql", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "carte",
                entree=SCHEMA.read_text(encoding="utf-8"))
        brut = _docker("exec", "-i", CONTENEUR, "psql", "-tA", "-U", "postgres", "-d", "carte", entree=_EXTRACTION)
        return json.loads(brut)
    finally:
        subprocess.run(["docker", "rm", "-f", CONTENEUR], capture_output=True)


def _git(*args) -> str:
    try:
        return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


d = extraire()

DOMAINES = [
    ("identite", "Identité", "Qui est qui, et qui suit qui.",
     ["users", "coaches", "kines", "athletes", "structures", "acces_support", "programs",
      "coach_profiles", "push_subscriptions"]),
    ("entrainement", "Entraînement", "L'arbre programmé : macro → bloc → semaine → séance → ligne, et la trame d'un bloc.",
     ["programs", "training_macros", "training_blocks", "training_weeks", "training_sessions",
      "training_exercises", "training_base_principles", "training_base_accessories",
      "block_objectives", "library_entries"]),
    ("suivi", "Suivi", "Ce que l'athlète note, et ce que le staff en lit.",
     ["daily_logs", "douleurs", "douleur_logs", "signalement_vu", "training_sets",
      "athlete_prs", "athlete_goals", "objectifs_techniques", "calendar_events"]),
    ("competitions", "Compétitions", "Une épreuve, ses mouvements, ses participants et leurs essais.",
     ["competitions", "competition_movements", "competition_participants", "competition_attempts",
      "competition_flights", "competition_flight_categories", "competition_coach_availability",
      "competition_editors", "weight_categories", "norep_reasons"]),
    ("kine", "Kiné", "Les bilans, leurs modèles, les notes de suivi.",
     ["bilans", "bilan_modeles", "bilan_rubriques", "bilan_tests", "bilan_resultats",
      "bilan_resultat_medias", "bilan_test_medias", "bilan_medias_demo", "kine_notes"]),
]

tables = {t["name"]: t for t in d["tables"]}
domaine_de = {}
for cle, _, _, noms in DOMAINES:
    for n in noms:
        domaine_de.setdefault(n, cle)
vues = {n for n, t in tables.items() if t["kind"] == "v"}
lit = {}
for x in d["deps"]:
    lit.setdefault(x["view"], []).append(x["reads"])
def domaine(n, repli):
    if n in domaine_de:
        return domaine_de[n]
    for s_ in lit.get(n, []):
        if s_ in domaine_de:
            return domaine_de[s_]
    return repli

layouts = []
for cle, titre, sous, noms in DOMAINES:
    noms = [n for n in noms if n in tables]
    dedans = set(noms)
    # les vues qui lisent au moins une table du domaine entrent avec lui
    for v, sources in lit.items():
        if dedans & set(sources) or (set(sources) & {u for u in vues if u in dedans}):
            dedans.add(v)
    # fermeture : une vue qui lit une vue du domaine
    for v, sources in lit.items():
        if set(sources) & dedans and v in vues:
            dedans.add(v)
    # les tables d'un autre domaine que l'on référence : présentes, repliées
    fantomes = set()
    for f in d["fks"]:
        if f["from"] in dedans and f["to"] not in dedans:
            fantomes.add(f["to"])
    for v in dedans & vues:
        for s in lit.get(v, []):
            if s not in dedans:
                fantomes.add(s)
    fantomes -= {"schema_migrations"}
    noeuds = []
    for n in sorted(dedans | fantomes, key=lambda n: (n in fantomes, n in vues, n)):
        t = tables[n]
        noeuds.append({"name": n, "vue": n in vues, "fantome": n in fantomes, "domaine": domaine(n, cle),
                       "cols": [{"name": c["name"], "type": c["type"], "pk": c["pk"],
                                 "fk": c["fk"], "null": c["null"]} for c in t["cols"]]})
    aretes = [{"from": f["from"], "to": f["to"], "col": f["col"], "kind": "fk"}
              for f in d["fks"] if f["from"] in dedans | fantomes and f["to"] in dedans | fantomes
              and (f["from"] in dedans or f["to"] in dedans)]
    for v in sorted(dedans & vues):
        for s in lit.get(v, []):
            if s in dedans | fantomes:
                aretes.append({"from": v, "to": s, "col": "", "kind": "lit"})
    layouts.append({"cle": cle, "titre": titre, "sous": sous, "noeuds": noeuds, "aretes": aretes,
                    "tables": len(dedans - vues), "vues": len(dedans & vues)})

nb_tables = len([t for t in tables.values() if t["kind"] == "r" and t["name"] != "schema_migrations"])
nb_vues = len(vues)
donnees = json.dumps(layouts, ensure_ascii=False, separators=(",", ":"))
branche = _git("rev-parse", "--abbrev-ref", "HEAD") or "?"
derniere = max(f.name[:10] for f in (ICI / "migrations").glob("*.sql"))
etat = f"branche <code>{branche}</code>, schéma au {derniere[8:10]}/{derniere[5:7]}/{derniere[:4]} (dernière migration)"

html = """<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Carte de brokkr</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
/* Une page-document : un bandeau, cinq onglets, un dessin par domaine, lisible en entier sans manipulation. */
:root {
  --bg: #f6f5f1; --fg: #1d1c1a; --muted: #6b6760; --ligne: #d8d4cb;
  --table: #ffffff; --table-tete: #2d2a26; --table-tete-fg: #f6f5f1;
  --vue: #eef3ec; --vue-tete: #3e6b4a; --vue-tete-fg: #f6f5f1; --vue-bord: #7fa58a;
  --fantome: #ecebe6; --fantome-fg: #7a766e;
  --fk: #8a8479; --lit: #3e6b4a; --accent: #b4552d;
  --d-identite: #2f6fdb; --d-entrainement: #7c3aed; --d-suivi: #0f8f85; --d-competitions: #e3662a; --d-kine: #d9377a;
  --display: "IBM Plex Sans", system-ui, sans-serif; --mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #1b1a18; --fg: #ecebe6; --muted: #a39e94; --ligne: #3a3834;
  --table: #262522; --table-tete: #ecebe6; --table-tete-fg: #1b1a18;
  --vue: #212a23; --vue-tete: #7fb08c; --vue-tete-fg: #121613; --vue-bord: #4f7a5b;
  --fantome: #22211f; --fantome-fg: #8d887f;
  --fk: #8d887f; --lit: #7fb08c; --accent: #e07a4f; color-scheme: dark;
  --d-identite: #6b9cff; --d-entrainement: #ad8cff; --d-suivi: #3fc2b5; --d-competitions: #ff9a5c; --d-kine: #ff7fb0 } }
:root[data-theme="dark"] {
  --bg: #1b1a18; --fg: #ecebe6; --muted: #a39e94; --ligne: #3a3834;
  --table: #262522; --table-tete: #ecebe6; --table-tete-fg: #1b1a18;
  --vue: #212a23; --vue-tete: #7fb08c; --vue-tete-fg: #121613; --vue-bord: #4f7a5b;
  --fantome: #22211f; --fantome-fg: #8d887f;
  --fk: #8d887f; --lit: #7fb08c; --accent: #e07a4f; color-scheme: dark;
  --d-identite: #6b9cff; --d-entrainement: #ad8cff; --d-suivi: #3fc2b5; --d-competitions: #ff9a5c; --d-kine: #ff7fb0 }
body { background: var(--bg); color: var(--fg); font-family: var(--display); font-size: 15px; line-height: 1.5; margin: 0; }
.page { padding-inline: 20px; padding-block: 28px 48px; max-width: 1500px; margin: 0 auto; }
header { display: grid; grid-template-columns: 1fr auto; gap: 8px 24px; align-items: start; }
header .titre { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.badge { font: 500 0.72rem var(--mono); color: var(--muted); border: 1px solid var(--ligne); border-radius: 999px; padding: 2px 8px; letter-spacing: .02em; }
.recherche { position: relative; grid-column: 2; grid-row: 1 / span 3; align-self: start; min-width: 0; width: min(100%, 320px); }
.recherche input { width: 100%; box-sizing: border-box; font: 400 0.9rem var(--display); color: var(--fg); background: var(--table); border: 1px solid var(--ligne); border-radius: 8px; padding: 8px 64px 8px 12px; }
.recherche input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.recherche kbd { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); font: 500 0.7rem var(--mono); color: var(--muted); border: 1px solid var(--ligne); border-radius: 5px; padding: 1px 6px; pointer-events: none; }
.recherche ul { position: absolute; z-index: 5; left: 0; right: 0; top: calc(100% + 4px); margin: 0; padding: 4px; list-style: none; background: var(--table); border: 1px solid var(--ligne); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.12); max-height: 320px; overflow: auto; }
.recherche li { display: flex; align-items: baseline; gap: 8px; padding: 6px 8px; border-radius: 5px; cursor: pointer; font-size: 0.85rem; }
.recherche li i { width: 8px; height: 8px; border-radius: 50%; background: var(--c); flex: none; align-self: center; }
.recherche li b { font: 500 0.85rem var(--mono); }
.recherche li small { color: var(--muted); margin-left: auto; white-space: nowrap; }
.recherche li[aria-selected="true"], .recherche li:hover { background: color-mix(in srgb, var(--accent) 12%, var(--table)); }
@media (max-width: 720px) { header { grid-template-columns: 1fr; } .recherche { grid-column: 1; grid-row: auto; width: 100%; } }
header h1 { font-size: 1.6rem; font-weight: 600; margin: 0 0 4px; letter-spacing: -0.01em; text-wrap: balance; }
header p { margin: 0; color: var(--muted); max-width: 65ch; }
header .chiffres { font-family: var(--mono); font-size: 0.85rem; color: var(--muted); margin-top: 6px; font-variant-numeric: tabular-nums; }
nav { display: flex; flex-wrap: wrap; gap: 6px; margin: 22px 0 14px; border-bottom: 1px solid var(--ligne); padding-bottom: 10px; }
nav button { font: 500 0.9rem var(--display); color: var(--muted); background: none; border: 1px solid transparent; border-radius: 999px; padding: 5px 12px; cursor: pointer; }
nav button:hover { color: var(--fg); }
nav button[aria-selected="true"] { color: var(--fg); border-color: var(--ligne); background: var(--table); }
nav button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
section[hidden] { display: none; }
.entete { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 18px; margin-bottom: 10px; }
.entete h2 { margin: 0; font-size: 1.15rem; font-weight: 600; }
.entete p { margin: 0; color: var(--muted); }
.entete .n { font-family: var(--mono); font-size: 0.8rem; color: var(--muted); margin-left: auto; font-variant-numeric: tabular-nums; }
.zoom { display: inline-flex; align-items: center; gap: 2px; border: 1px solid var(--ligne); border-radius: 999px; padding: 2px; }
.zoom button, .entete > button { font: 500 0.8rem var(--display); color: var(--muted); background: none; border: 0; border-radius: 999px; padding: 3px 9px; cursor: pointer; }
.zoom button:hover, .entete > button:hover { color: var(--fg); }
.zoom button:focus-visible, .entete > button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.zoom output { font: 500 0.78rem var(--mono); color: var(--fg); min-width: 4ch; text-align: center; font-variant-numeric: tabular-nums; }
.entete > button { border: 1px solid var(--ligne); }
.legende { display: flex; flex-wrap: wrap; gap: 4px 18px; font-size: 0.8rem; color: var(--muted); margin-bottom: 10px; }
.legende span::before { content: ""; display: inline-block; width: 22px; height: 0; border-top: 2px solid var(--fk); vertical-align: middle; margin-right: 6px; }
.legende .l-lit::before { border-top-style: dashed; }
.legende .l-table::before { width: 12px; height: 12px; border: 1px solid var(--fg); background: var(--table); border-radius: 2px; }
.legende .l-vue::before { width: 12px; height: 12px; border: 1px dashed var(--fg); background: var(--table); border-radius: 2px; }
.legende .l-fantome::before { width: 12px; height: 12px; border: 1px dotted var(--muted); background: var(--table); border-radius: 2px; opacity: .7; }
/* Un canevas : le dessin entier tient dans la fenêtre à l'ouverture ; la molette
   le déplace, ⌘/Ctrl + molette (ou le pincement) le zoome, la souris le tire. */
.dessin { position: relative; overflow: hidden; border: 1px solid var(--ligne); border-radius: 8px; background: var(--table); height: clamp(420px, calc(100vh - 250px), 960px); touch-action: none; cursor: grab; }
.dessin.tire { cursor: grabbing; }
.dessin svg { display: block; font-family: var(--mono); font-size: 11.5px; width: 100%; height: 100%; }
.grille { fill: url(#grille); }
.point { fill: var(--ligne); }
.trouve rect.boite-table, .trouve rect.boite-vue, .trouve rect.boite-fantome { stroke-width: 3; filter: drop-shadow(0 0 6px var(--c)); }
.plus { cursor: pointer; text-decoration: underline dotted; }
.repliable { cursor: pointer; } .repliable:hover path { filter: brightness(1.08); }
.chevron { font-size: 11px; } .tete-table .chevron { fill: #fff; opacity: .85; } .tete-vue .chevron { fill: var(--c); }
.plus:hover { fill: var(--fg); }
.etiquette-type { fill: var(--t-bg); }
.type { fill: var(--t-fg); font-size: 10px; }
.t-uuid { --t-fg: #0e7a6f; --t-bg: color-mix(in srgb, #0e7a6f 12%, var(--table)); }
.t-text { --t-fg: var(--muted); --t-bg: color-mix(in srgb, var(--muted) 10%, var(--table)); }
.t-nombre { --t-fg: #1d5fb8; --t-bg: color-mix(in srgb, #1d5fb8 10%, var(--table)); }
.t-temps { --t-fg: #5b6b9a; --t-bg: color-mix(in srgb, #5b6b9a 12%, var(--table)); }
.t-bool { --t-fg: #7a3fc4; --t-bg: color-mix(in srgb, #7a3fc4 10%, var(--table)); }
.t-json { --t-fg: #c25a1b; --t-bg: color-mix(in srgb, #c25a1b 12%, var(--table)); }
.t-enum { --t-fg: #a1346e; --t-bg: color-mix(in srgb, #a1346e 10%, var(--table)); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .t-uuid { --t-fg: #5fd3c4 } :root:not([data-theme="light"]) .t-nombre { --t-fg: #8db6ff } :root:not([data-theme="light"]) .t-temps { --t-fg: #a7b4dc } :root:not([data-theme="light"]) .t-bool { --t-fg: #c9a2ff } :root:not([data-theme="light"]) .t-json { --t-fg: #ffa36b } :root:not([data-theme="light"]) .t-enum { --t-fg: #ff8fc6 } }
:root[data-theme="dark"] .t-uuid { --t-fg: #5fd3c4 } :root[data-theme="dark"] .t-nombre { --t-fg: #8db6ff } :root[data-theme="dark"] .t-temps { --t-fg: #a7b4dc } :root[data-theme="dark"] .t-bool { --t-fg: #c9a2ff } :root[data-theme="dark"] .t-json { --t-fg: #ffa36b } :root[data-theme="dark"] .t-enum { --t-fg: #ff8fc6 }
.tete { font-family: var(--display); font-weight: 600; font-size: 12.5px; }
.col { fill: var(--fg); }
.col.pk { font-weight: 500; }
.type { fill: var(--muted); font-size: 10.5px; }
.plus { fill: var(--muted); font-style: italic; font-family: var(--display); font-size: 11px; }
.fantome-nom { font-family: var(--display); font-weight: 500; font-size: 12px; }
/* `--c` est posé sur chaque boîte et chaque flèche : la couleur de son domaine. */
.arete-fk { fill: none; stroke: var(--c); stroke-width: 1.5; stroke-opacity: .85; stroke-linejoin: round; }
.arete-lit { fill: none; stroke: var(--c); stroke-width: 1.6; stroke-dasharray: 5 4; stroke-linejoin: round; }
.pointe { fill: var(--c); }
.boite-table { fill: var(--table); stroke: var(--c); stroke-width: 1.2; }
.boite-vue { fill: color-mix(in srgb, var(--c) 10%, var(--table)); stroke: var(--c); stroke-width: 1.2; stroke-dasharray: 6 3; }
.boite-fantome { fill: color-mix(in srgb, var(--c) 7%, var(--table)); stroke: var(--c); stroke-opacity: .6; stroke-dasharray: 3 3; }
.fantome-nom { fill: var(--c); }
.tete-table { fill: var(--c); } .tete-table text { fill: #fff; }
.tete-vue { fill: color-mix(in srgb, var(--c) 22%, var(--table)); } .tete-vue text { fill: var(--c); }
nav button i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: var(--c); margin-right: 7px; vertical-align: 0; }
.legende .l-fk::before { border-top-color: var(--fg); } .legende .l-lit::before { border-top-color: var(--fg); }
.sep { stroke: var(--ligne); }
footer { margin-top: 24px; color: var(--muted); font-size: 0.85rem; max-width: 80ch; display: flex; gap: 10px; align-items: flex-start; border: 1px solid var(--ligne); border-radius: 8px; padding: 10px 14px; background: var(--table); }
footer .i { flex: none; width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid var(--muted); font: 600 11px/15px var(--display); text-align: center; margin-top: 2px; }
footer code { font-family: var(--mono); font-size: 0.85em; }
@media (prefers-reduced-motion: no-preference) { nav button { transition: color .15s, background .15s; } }
body { margin: 0; }
</style>
</head>
<body>
<div class="page">
<header>
  <div class="titre"><h1>Carte de brokkr</h1><span class="badge">Postgres __PG__</span></div>
  <div class="recherche"><input id="recherche" type="search" placeholder="Une table, une vue, une colonne…" autocomplete="off" aria-label="Rechercher"><kbd>⌘K</kbd><ul id="resultats" role="listbox" hidden></ul></div>
  <p>Le schéma Postgres, un domaine à la fois : les tables, leurs clés étrangères, et ce que chaque vue lit. Extrait de la base, pas dessiné à la main.</p>
  <div class="chiffres">__NB_TABLES__ tables · __NB_VUES__ vues · __ETAT__</div>
</header>
<nav role="tablist" id="onglets"></nav>
<div id="sections"></div>
<footer><span class="i">i</span><span>Une table grisée en pointillés appartient à un autre domaine ; elle n'est là que parce qu'on la référence. Les colonnes affichées : les clés, puis les premières ; le reste est compté. Les vues sont en vert, et un trait vert pointillé va de la vue à ce qu'elle lit. Cliquer l'en-tête d'une table la déplie ou la replie.</span></footer>
</div>
<script src="https://cdn.jsdelivr.net/npm/elkjs@0.9.3/lib/elk.bundled.js"></script>
<script>
const LAYOUTS = __DONNEES__;
const NS = "http://www.w3.org/2000/svg";
const L = 232, TETE = 26, LIGNE = 17, PAD = 8, MAX_COLS = 9;
const elk = new ELK();

function el(nom, attrs, parent) {
  const e = document.createElementNS(NS, nom);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function colonnesVisibles(n) {
  if (n.fantome) return [];
  if (n.deplie) return n.cols;
  const cles = n.cols.filter(c => c.pk || c.fk);
  const autres = n.cols.filter(c => !c.pk && !c.fk);
  const vis = cles.concat(autres).slice(0, MAX_COLS);
  return n.cols.filter(c => vis.includes(c));
}
function hauteur(n) {
  if (n.fantome) return TETE + 6;
  const vis = colonnesVisibles(n).length;
  const reste = n.cols.length - vis;
  return TETE + vis * LIGNE + (reste > 0 ? LIGNE : 0) + PAD;
}
function typeCourt(t) {
  return t.replace("timestamp with time zone", "timestamptz").replace("character varying", "varchar")
          .replace("double precision", "float8");
}
function familleType(t) {
  if (t.startsWith("uuid")) return "uuid";
  if (/^(text|character|varchar)/.test(t)) return "text";
  if (/^(integer|bigint|smallint|numeric|double|real|bigserial|serial)/.test(t)) return "nombre";
  if (/^(date|timestamp|time)/.test(t)) return "temps";
  if (t.startsWith("boolean")) return "bool";
  if (t.startsWith("json")) return "json";
  return "enum";
}
// Les PORTS. Ce qui est RÉFÉRENCÉ est à gauche (`users` en tête), ce qui en
// dépend à droite : une clé étrangère sort à GAUCHE de sa ligne et revient
// vers la clé primaire, qui reçoit à DROITE de la sienne ; une vue et ce
// qu'elle lit se parlent par l'en-tête. ELK route autour des boîtes, à
// angle droit.
function ports(n, largeur) {
  const liste = [{ id: `${n.name}.tete.e`, x: largeur, y: TETE / 2 }, { id: `${n.name}.tete.w`, x: 0, y: TETE / 2 }];
  let y = TETE + 13 - 4;
  for (const c of colonnesVisibles(n)) {
    if (c.fk) liste.push({ id: `${n.name}.${c.name}.w`, x: 0, y });
    if (c.pk) liste.push({ id: `${n.name}.pk.e`, x: largeur, y });
    y += LIGNE;
  }
  return liste.map(p => ({ ...p, width: 1, height: 1 }));
}
async function dessiner(layout, conteneur) {
  const largeurDe = n => n.fantome ? 170 : L;
  const noms = new Map(layout.noeuds.map(n => [n.name, n]));
  const portsDe = new Map(layout.noeuds.map(n => [n.name, new Set(ports(n, largeurDe(n)).map(p => p.id))]));
  const graphe = {
    id: "g",
    layoutOptions: {
      "elk.algorithm": "layered", "elk.direction": "LEFT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": "96", "elk.spacing.nodeNode": "40",
      "elk.spacing.edgeNode": "28", "elk.spacing.edgeEdge": "14",
      "elk.layered.spacing.edgeNodeBetweenLayers": "32", "elk.layered.spacing.edgeEdgeBetweenLayers": "14",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.padding": "[top=16,left=16,bottom=16,right=16]",
    },
    children: layout.noeuds.map(n => ({
      id: n.name, width: largeurDe(n), height: hauteur(n),
      layoutOptions: { "elk.portConstraints": "FIXED_POS" },
      ports: ports(n, largeurDe(n)),
    })),
    edges: layout.aretes.map((a, i) => {
      const pf = portsDe.get(a.from), pt = portsDe.get(a.to);
      const source = a.kind === "fk" && pf.has(`${a.from}.${a.col.split(",")[0]}.w`) ? `${a.from}.${a.col.split(",")[0]}.w` : `${a.from}.tete.w`;
      const cible = a.kind === "fk" && pt.has(`${a.to}.pk.e`) ? `${a.to}.pk.e` : `${a.to}.tete.e`;
      return { id: "e" + i, sources: [source], targets: [cible], kind: a.kind };
    }),
  };
  const r = await elk.layout(graphe);
  conteneur.replaceChildren();
  const svg = el("svg", { role: "img" }, conteneur);
  const defs = el("defs", {}, svg);
  const motif = el("pattern", { id: `grille-${layout.cle}`, width: 22, height: 22, patternUnits: "userSpaceOnUse" }, defs);
  el("circle", { cx: 1, cy: 1, r: 1, class: "point" }, motif);
  el("rect", { width: "100%", height: "100%", fill: `url(#grille-${layout.cle})` }, svg);
  const monde = el("g", { class: "monde" }, svg);
  layout.taille = { w: Math.ceil(r.width), h: Math.ceil(r.height) };
  layout.positions = new Map(r.children.map(c => [c.id, c]));
  for (const dom of new Set(layout.noeuds.map(n => n.domaine))) {
    const m = el("marker", { id: `p-${layout.cle}-${dom}`, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse", style: `--c: var(--d-${dom})` }, defs);
    el("path", { d: "M0,0 L10,5 L0,10 z", class: "pointe" }, m);
  }
  // arêtes d'abord, sous les boîtes ; les coins sont arrondis d'un rayon fixe
  const genre = new Map(graphe.edges.map(e => [e.id, e.kind]));
  const origine = new Map(graphe.edges.map(e => [e.id, noms.get(e.sources[0].split(".")[0]).domaine]));
  for (const e of r.edges || []) {
    const dom = origine.get(e.id);
    for (const s of e.sections || []) {
      const pts = [s.startPoint, ...(s.bendPoints || []), s.endPoint];
      el("path", { d: arrondi(pts, 6), class: `arete-${genre.get(e.id)}`, style: `--c: var(--d-${dom})`,
                   "marker-end": `url(#p-${layout.cle}-${dom})` }, monde);
    }
  }
  for (const c of r.children) {
    const n = noms.get(c.id);
    const grp = el("g", { transform: `translate(${c.x},${c.y})`, style: `--c: var(--d-${n.domaine})`, "data-nom": n.name }, monde);
    if (n.fantome) {
      el("rect", { width: c.width, height: c.height, rx: 4, class: "boite-fantome" }, grp);
      const t = el("text", { x: c.width / 2, y: c.height / 2 + 4, "text-anchor": "middle", class: "fantome-nom" }, grp);
      t.textContent = n.name;
      continue;
    }
    el("rect", { width: c.width, height: c.height, rx: 4, class: n.vue ? "boite-vue" : "boite-table" }, grp);
    // L'en-tête se clique : il déplie ou replie la table. Un chevron le dit.
    const repliable = n.cols.length > MAX_COLS;
    const tete = el("g", { class: (n.vue ? "tete-vue" : "tete-table") + (repliable ? " repliable" : ""),
                            role: repliable ? "button" : null, tabindex: repliable ? 0 : null }, grp);
    for (const k of ["role", "tabindex"]) if (tete.getAttribute(k) === "null") tete.removeAttribute(k);
    el("path", { d: `M0,4 a4,4 0 0 1 4,-4 h${c.width - 8} a4,4 0 0 1 4,4 v${TETE - 4} h-${c.width} z` }, tete);
    const tt = el("text", { x: 10, y: 17, class: "tete" }, tete);
    tt.textContent = (n.vue ? "vue · " : "") + n.name;
    if (repliable) {
      const ch = el("text", { x: c.width - 10, y: 17, "text-anchor": "end", class: "chevron" }, tete);
      ch.textContent = n.deplie ? "▴" : "▾";
      const basculer = () => { n.deplie = !n.deplie; dessiner(layout, conteneur).then(() => vue(layout).centrer(n.name)); };
      tete.addEventListener("click", basculer);
      tete.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); basculer(); } });
    }
    const vis = colonnesVisibles(n);
    let cy = TETE + 13;
    for (const col of vis) {
      const prefixe = col.pk ? "⚿ " : (col.fk ? "→ " : "  ");
      const nom = el("text", { x: 8, y: cy, class: "col" + (col.pk ? " pk" : "") }, grp);
      nom.textContent = prefixe + col.name;
      const libelle = typeCourt(col.type) + (col.null ? "?" : "");
      const larg = libelle.length * 6.1 + 8;
      const badge = el("g", { class: "t-" + familleType(col.type) }, grp);
      el("rect", { x: c.width - 8 - larg, y: cy - 10, width: larg, height: 13, rx: 3, class: "etiquette-type" }, badge);
      const ty = el("text", { x: c.width - 12, y: cy, "text-anchor": "end", class: "type" }, badge);
      ty.textContent = libelle;
      cy += LIGNE;
    }
    const reste = n.cols.length - vis.length;
    if (reste > 0) {
      const t = el("text", { x: 8, y: cy, class: "plus", role: "button", tabindex: 0 }, grp);
      t.textContent = `… ${reste} autre${reste > 1 ? "s" : ""} colonne${reste > 1 ? "s" : ""}`;
      const deplier = () => { n.deplie = true; dessiner(layout, conteneur).then(() => vue(layout).ajuster()); };
      t.addEventListener("click", deplier);
      t.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); deplier(); } });
    }
  }
  vue(layout).brancher(conteneur, svg, monde);
}
// Le canevas : une transformation (translation, échelle) sur le groupe `monde`.
const VUES = new Map();
function vue(layout) {
  if (VUES.has(layout.cle)) return VUES.get(layout.cle);
  const v = { k: 1, tx: 0, ty: 0, conteneur: null, monde: null, sortie: null };
  v.appliquer = () => {
    if (v.monde) v.monde.setAttribute("transform", `translate(${v.tx},${v.ty}) scale(${v.k})`);
    if (v.sortie) v.sortie.value = Math.round(v.k * 100) + " %";
  };
  v.ajuster = () => {
    const b = v.conteneur.getBoundingClientRect();
    if (!b.width) return;
    v.k = Math.min(1.25, (b.width - 24) / layout.taille.w, (b.height - 24) / layout.taille.h);
    v.tx = (b.width - layout.taille.w * v.k) / 2; v.ty = (b.height - layout.taille.h * v.k) / 2;
    v.appliquer();
  };
  v.zoomer = (facteur, cx, cy) => {
    const b = v.conteneur.getBoundingClientRect();
    cx = cx ?? b.width / 2; cy = cy ?? b.height / 2;
    const k2 = Math.max(0.15, Math.min(4, v.k * facteur));
    v.tx = cx - (cx - v.tx) * (k2 / v.k); v.ty = cy - (cy - v.ty) * (k2 / v.k); v.k = k2;
    v.appliquer();
  };
  v.reel = () => { const b = v.conteneur.getBoundingClientRect(); v.zoomer(1 / v.k, b.width / 2, b.height / 2); };
  v.centrer = nom => {
    const c = layout.positions.get(nom); if (!c) return;
    const b = v.conteneur.getBoundingClientRect();
    v.k = Math.max(v.k, 0.9);
    v.tx = b.width / 2 - (c.x + c.width / 2) * v.k; v.ty = b.height / 2 - (c.y + c.height / 2) * v.k;
    v.appliquer();
    const g = v.monde.querySelector(`[data-nom="${nom}"]`);
    if (g) { g.classList.add("trouve"); setTimeout(() => g.classList.remove("trouve"), 2200); }
  };
  v.brancher = (conteneur, svg, monde) => {
    v.conteneur = conteneur; v.monde = monde;
    v.sortie = conteneur.parentElement.querySelector(".zoom output");
    if (!conteneur.dataset.branche) {
      conteneur.dataset.branche = "1";
      conteneur.addEventListener("wheel", ev => {
        ev.preventDefault();
        const b = conteneur.getBoundingClientRect();
        if (ev.ctrlKey || ev.metaKey) v.zoomer(Math.exp(-ev.deltaY * 0.01), ev.clientX - b.left, ev.clientY - b.top);
        else { v.tx -= ev.deltaX; v.ty -= ev.deltaY; v.appliquer(); }
      }, { passive: false });
      let tire = null;
      conteneur.addEventListener("pointerdown", ev => { if (ev.button !== 0 || ev.target.closest(".repliable, .plus")) return; tire = { x: ev.clientX, y: ev.clientY, tx: v.tx, ty: v.ty }; conteneur.setPointerCapture(ev.pointerId); conteneur.classList.add("tire"); });
      conteneur.addEventListener("pointermove", ev => { if (!tire) return; v.tx = tire.tx + ev.clientX - tire.x; v.ty = tire.ty + ev.clientY - tire.y; v.appliquer(); });
      const lacher = () => { tire = null; conteneur.classList.remove("tire"); };
      conteneur.addEventListener("pointerup", lacher); conteneur.addEventListener("pointercancel", lacher);
      for (const b of conteneur.parentElement.querySelectorAll("[data-z]")) b.addEventListener("click", () => {
        const z = b.dataset.z;
        if (z === "+") v.zoomer(1.25); else if (z === "-") v.zoomer(0.8); else if (z === "1") v.reel(); else v.ajuster();
      });
    }
    v.appliquer();
  };
  VUES.set(layout.cle, v);
  return v;
}
function arrondi(pts, r) {
  if (pts.length < 3) return `M${pts[0].x},${pts[0].y} L${pts[1].x},${pts[1].y}`;
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const d1 = Math.hypot(b.x - a.x, b.y - a.y), d2 = Math.hypot(c.x - b.x, c.y - b.y);
    const k = Math.min(r, d1 / 2, d2 / 2);
    const p1 = { x: b.x - (b.x - a.x) / d1 * k, y: b.y - (b.y - a.y) / d1 * k };
    const p2 = { x: b.x + (c.x - b.x) / d2 * k, y: b.y + (c.y - b.y) / d2 * k };
    d += ` L${p1.x},${p1.y} Q${b.x},${b.y} ${p2.x},${p2.y}`;
  }
  const f = pts[pts.length - 1];
  return d + ` L${f.x},${f.y}`;
}
const nav = document.getElementById("onglets"), sections = document.getElementById("sections");
const boutons = {};
(async () => {
  for (const l of LAYOUTS) {
    const b = document.createElement("button");
    b.type = "button"; b.role = "tab"; b.id = "tab-" + l.cle;
    b.innerHTML = `<i style="--c: var(--d-${l.cle})"></i>${l.titre}`;
    b.setAttribute("aria-controls", "s-" + l.cle);
    b.addEventListener("click", () => montrer(l.cle, true));
    nav.appendChild(b); boutons[l.cle] = b;
    const s = document.createElement("section");
    s.id = "s-" + l.cle; s.setAttribute("role", "tabpanel"); s.hidden = true;
    s.innerHTML = `<div class="entete"><h2>${l.titre}</h2><p>${l.sous}</p><span class="n">${l.tables} tables · ${l.vues} vue${l.vues > 1 ? "s" : ""}</span><span class="zoom"><button type="button" data-z="-" aria-label="Zoom arrière">−</button><output>100 %</output><button type="button" data-z="+" aria-label="Zoom avant">+</button></span><button type="button" data-z="1">Taille réelle</button><button type="button" data-z="fit">Ajuster</button><button type="button" class="colonnes" aria-pressed="false">Toutes les colonnes</button></div>
      <div class="legende"><span class="l-table">table</span><span class="l-vue">vue</span><span class="l-fantome">d'un autre domaine</span><span class="l-fk">clé étrangère</span><span class="l-lit">la vue lit</span></div>
      <div class="dessin"></div>`;
    sections.appendChild(s);
    s.querySelector(".colonnes").addEventListener("click", ev => {
      const tout = ev.currentTarget.getAttribute("aria-pressed") !== "true";
      for (const n of l.noeuds) n.deplie = tout;
      ev.currentTarget.setAttribute("aria-pressed", tout ? "true" : "false");
      ev.currentTarget.textContent = tout ? "Replier les colonnes" : "Toutes les colonnes";
      dessiner(l, s.querySelector(".dessin")).then(() => vue(l).ajuster());
    });
  }
  const depart = (location.hash || "").slice(1);
  montrer(LAYOUTS.some(l => l.cle === depart) ? depart : LAYOUTS[0].cle, false);
  for (const l of LAYOUTS) { await dessiner(l, document.querySelector(`#s-${l.cle} .dessin`)); if (!l.hidden) vue(l).ajuster(); }
  // un dessin calculé caché n'a pas de taille : on l'ajuste à l'affichage
  for (const l of LAYOUTS) if (!vue(l).k || !document.getElementById("s-" + l.cle).hidden) vue(l).ajuster();
  recherche();
})();
const AJUSTES = new Set();
function montrer(cle, pousser) {
  for (const l of LAYOUTS) {
    const actif = l.cle === cle;
    document.getElementById("s-" + l.cle).hidden = !actif;
    boutons[l.cle].setAttribute("aria-selected", actif ? "true" : "false");
    if (actif && l.taille && !AJUSTES.has(cle)) { AJUSTES.add(cle); vue(l).ajuster(); }
  }
  if (pousser) { try { history.replaceState(null, "", "#" + cle); } catch (e) {} }
}
// La recherche : une table, une vue, une colonne → l'onglet de son domaine, centré dessus.
function recherche() {
  const champ = document.getElementById("recherche"), liste = document.getElementById("resultats");
  const index = [];
  for (const l of LAYOUTS) for (const n of l.noeuds) {
    if (n.fantome || n.domaine !== l.cle && !n.vue) continue;
    if (index.some(e => e.nom === n.name && !e.col)) continue;
    index.push({ nom: n.name, col: null, vue: n.vue, dom: n.domaine, cle: l.cle, noeud: n });
    for (const c of n.cols) index.push({ nom: n.name, col: c.name, vue: n.vue, dom: n.domaine, cle: l.cle, noeud: n });
  }
  let courant = -1, trouves = [];
  const fermer = () => { liste.hidden = true; liste.replaceChildren(); courant = -1; };
  const aller = e => {
    fermer(); champ.value = e.col ? `${e.nom}.${e.col}` : e.nom; montrer(e.cle, true);
    const l = LAYOUTS.find(x => x.cle === e.cle);
    if (e.col && !e.noeud.deplie && !colonnesVisibles(e.noeud).some(c => c.name === e.col)) {
      e.noeud.deplie = true;
      dessiner(l, document.querySelector(`#s-${l.cle} .dessin`)).then(() => vue(l).centrer(e.nom));
    } else vue(l).centrer(e.nom);
  };
  const rendre = () => {
    liste.replaceChildren();
    trouves.forEach((e, i) => {
      const li = document.createElement("li"); li.setAttribute("role", "option"); li.setAttribute("aria-selected", i === courant ? "true" : "false");
      li.innerHTML = `<i style="--c: var(--d-${e.dom})"></i><b>${e.nom}${e.col ? "." + e.col : ""}</b><small>${e.col ? "colonne" : (e.vue ? "vue" : "table")}</small>`;
      li.addEventListener("mousedown", ev => { ev.preventDefault(); aller(e); });
      liste.appendChild(li);
    });
    liste.hidden = trouves.length === 0;
  };
  champ.addEventListener("input", () => {
    const q = champ.value.trim().toLowerCase();
    if (!q) { fermer(); return; }
    const score = e => (e.col ? e.col : e.nom).toLowerCase().startsWith(q) ? 0 : ((e.col ? `${e.nom}.${e.col}` : e.nom).toLowerCase().includes(q) ? 1 : 9);
    trouves = index.filter(e => score(e) < 9).sort((a, b) => score(a) - score(b) || (a.col ? 1 : 0) - (b.col ? 1 : 0)).slice(0, 10);
    courant = trouves.length ? 0 : -1; rendre();
  });
  champ.addEventListener("keydown", ev => {
    if (ev.key === "ArrowDown") { courant = Math.min(trouves.length - 1, courant + 1); rendre(); ev.preventDefault(); }
    else if (ev.key === "ArrowUp") { courant = Math.max(0, courant - 1); rendre(); ev.preventDefault(); }
    else if (ev.key === "Enter" && courant >= 0) { aller(trouves[courant]); ev.preventDefault(); }
    else if (ev.key === "Escape") { fermer(); champ.blur(); }
  });
  champ.addEventListener("blur", () => setTimeout(fermer, 120));
  document.addEventListener("keydown", ev => { if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") { ev.preventDefault(); champ.focus(); champ.select(); } });
}
</script>
</body>
</html>
"""
html = html.replace("__DONNEES__", donnees).replace("__ETAT__", etat).replace("__PG__", str(d["version"])).replace("__NB_TABLES__", str(nb_tables)).replace("__NB_VUES__", str(nb_vues))
SORTIE.write_text(html, encoding="utf-8")
print(f"[carte] {SORTIE.relative_to(ICI.parent)} — {nb_tables} tables, {nb_vues} vues, "
      + ", ".join(f"{l['titre']} {l['tables']}+{l['vues']}" for l in layouts))
