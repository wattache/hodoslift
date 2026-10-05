"""Le rangement de `app/` par domaine tient-il ? (FRE-184)

Deux règles, lues dans les imports : le socle n'importe aucun domaine, et un
routeur n'est importé que par `main.py`. Sans elles le paquet de domaine n'est
qu'un dossier : la dépendance à l'envers revient par un import anodin.
"""

import ast
import pathlib

_APP = pathlib.Path(__file__).resolve().parent.parent / "app"


def _imports():
    """(fichier, module importé) pour chaque import intra-app."""
    for f in sorted(_APP.rglob("*.py")):
        for n in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
            if isinstance(n, ast.ImportFrom) and n.module and n.module.startswith("app"):
                for a in n.names:
                    yield f.relative_to(_APP), f"{n.module}.{a.name}"


def test_le_dispositif_voit_les_imports():
    assert len(list(_imports())) >= 100


def test_le_socle_n_importe_aucun_domaine():
    fautifs = [(str(f), m) for f, m in _imports()
               if f.parts[0] == "socle" and not m.startswith("app.socle.")]
    assert fautifs == []


def test_un_routeur_n_est_importe_que_par_main():
    fautifs = [(str(f), m) for f, m in _imports()
               if ".routes_" in m and str(f) != "main.py"]
    assert fautifs == []


def _routeurs_avec_metier():
    return sorted(f for f in _APP.glob("*/routes_*.py")
                  if f.with_name(f.name.replace("routes_", "metier_")).exists())


def test_le_dispositif_voit_les_routeurs_scindes():
    assert len(_routeurs_avec_metier()) >= 7


def test_un_routeur_qui_a_un_metier_n_execute_pas_de_sql():
    """Sinon la scission ne vaut rien : la requête revient dans le gestionnaire
    au premier correctif pressé. Ni `.execute(…)`, ni `text(…)`."""
    fautifs = []
    for f in _routeurs_avec_metier():
        for n in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
            if isinstance(n, ast.Call) and (getattr(n.func, "attr", "") == "execute"
                                            or getattr(n.func, "id", "") == "text"):
                fautifs.append(f"{f.relative_to(_APP)}:{n.lineno}")
    assert fautifs == []
