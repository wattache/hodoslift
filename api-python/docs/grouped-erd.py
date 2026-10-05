#!/usr/bin/env python3
"""Génère un ERD Graphviz GROUPÉ par domaine (clusters colorés) depuis le schéma."""
import re, sys

sql = open("postgres-schema.sql").read()

# domaine -> (label, bord, fond cluster, fond noeud, tables)
DOMAINS = [
 ("Identité",            "#2563eb","#eff6ff","#bfdbfe",
    ["users","coaches","athletes","athlete_prs","athlete_goals"]),
 ("Mouvements & biblio", "#16a34a","#f0fdf4","#bbf7d0",
    ["movements","movement_supports","coach_movements","library_terms"]),
 ("Programme",           "#7c3aed","#faf5ff","#e9d5ff",
    ["programs"]),
 ("Suivi & calendrier",  "#0d9488","#ecfeff","#99f6e4",
    ["daily_logs","calendar_events"]),
 ("Compétitions",        "#ea580c","#fff7ed","#fed7aa",
    ["competitions","competition_movements","competition_editors",
     "competition_participants","competition_attempts","competition_flights",
     "competition_flight_categories","weight_categories","norep_reasons"]),
]
node_fill = {t:f for _,_,_,f,ts in DOMAINS for t in ts}

# extraire les FK : table courante -> table référencée
edges=[]
for m in re.finditer(r'CREATE TABLE (\w+) \((.*?)\n\);', sql, re.S):
    tbl, body = m.group(1), m.group(2)
    for r in re.finditer(r'REFERENCES\s+(\w+)\s*\(', body):
        tgt=r.group(1)
        if tgt!=tbl: edges.append((tbl,tgt))
edges=sorted(set(edges))

out=['digraph schema {',
     '  rankdir=LR; splines=spline; nodesep=0.35; ranksep=1.0; pad=0.4;',
     '  graph [fontname="Helvetica"]; edge [color="#94a3b8"];',
     '  node [shape=box style="filled,rounded" fontname="Helvetica" fontsize=11 penwidth=1.4];']
for label,border,clusterbg,fill,tables in DOMAINS:
    key=re.sub(r'\W','',label)
    out.append(f'  subgraph cluster_{key} {{')
    out.append(f'    label="{label}"; labeljust="l"; fontsize=15; fontcolor="{border}";')
    out.append(f'    style="rounded"; color="{border}"; bgcolor="{clusterbg}"; penwidth=2.2; margin=16;')
    for t in tables:
        out.append(f'    {t} [fillcolor="{fill}" color="{border}"];')
    out.append('  }')
for a,b in edges:
    out.append(f'  {a} -> {b};')
out.append('}')
open("grouped-erd.dot","w").write("\n".join(out))
print(f"{sum(len(t) for *_,t in DOMAINS)} tables, {len(edges)} FK, {len(DOMAINS)} domaines")
