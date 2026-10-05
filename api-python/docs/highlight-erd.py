#!/usr/bin/env python3
"""Surligne, dans le SVG SchemaSpy, les tables touchées par une itération.
Usage : python3 highlight-erd.py new:coaches mod:users,athletes,programs ...
  new: (vert)   = tables ajoutées
  mod: (ambre)  = tables modifiées
Écrit <input>.highlight.svg à côté du SVG source.
"""
import sys, re
import os
# chemin relatif au script : brokkr/docs → ../../schema-erd (dossier généré, hors git)
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "..", "..", "schema-erd", "diagrams", "summary", "relationships.real.large.svg")
COLORS = {"new": "#86efac", "mod": "#fde68a"}   # vert / ambre
targets = {}
for arg in sys.argv[1:]:
    kind, names = arg.split(":", 1)
    for n in names.split(","):
        if n: targets[n.strip()] = COLORS[kind]

svg = open(SRC).read()
done = []
for table, color in targets.items():
    # dans le groupe de CETTE table, recolorer le 1er polygone d'en-tête (#f5f5f5)
    pat = re.compile(r'(<title>' + re.escape(table) + r'</title>.*?<polygon fill=")#f5f5f5(")', re.S)
    svg, n = pat.subn(r'\g<1>' + color + r'\g<2>', svg, count=1)
    done.append(f"{table}{'✓' if n else '✗(introuvable)'}")

# petite légende en haut à gauche
legend = ('<g><rect x="8" y="8" width="200" height="46" fill="white" stroke="#999"/>'
          '<rect x="14" y="15" width="14" height="12" fill="#86efac"/><text x="34" y="25" font-size="11">table ajoutée</text>'
          '<rect x="14" y="33" width="14" height="12" fill="#fde68a"/><text x="34" y="43" font-size="11">table modifiée</text></g>')
svg = svg.replace("</svg>", legend + "</svg>", 1)

out = SRC.replace(".svg", ".highlight.svg")
open(out, "w").write(svg)
print("surligné :", ", ".join(done))
print("→", out)
