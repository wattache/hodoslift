"""Les codes d'erreur déclarés disent-ils la VÉRITÉ ? (FRE-38)

⚠️ TOUT L'ENJEU DU TICKET TIENT ICI, et il le dit lui-même : « documenter un 409
sur une route qui n'en lève pas est pire que le silence — on aurait un contrat
faux, ce qui est exactement le reproche fait à l'existant ».

Écrire `responses={...}` est facile ; le garder vrai ne l'est pas. Une liste
recopiée à la main dérive dès la première exception ajoutée, et personne ne s'en
aperçoit — rien ne compare les deux moitiés.

Ces specs sont ce qui les compare. `app/socle/erreurs.py` relève les codes réellement
atteignables en lisant les sources (corps, appels, dépendances) ; ici on confronte
ce relevé à ce que chaque route ANNONCE dans son décorateur.

Concrètement : ajouter un `raise HTTPException(409, …)` sans le documenter fait
échouer ces tests, et documenter un code qu'on ne lève plus aussi.
"""

import ast
import pathlib

import pytest

from app.socle.erreurs import CODE_VALIDATION_FASTAPI, CODES, _DESCRIPTIONS, codes_atteignables

# Un routeur est un `routes_*.py` dans le paquet de son domaine.
_APP = pathlib.Path(__file__).resolve().parent.parent / "app"
_ROUTEURS = sorted(_APP.glob("*/routes_*.py"))
_VERBES = {"get", "post", "put", "patch", "delete"}


def _routes():
    """(fichier, verbe, chemin, nom du gestionnaire, codes déclarés)."""
    for f in _ROUTEURS:
        arbre = ast.parse(f.read_text(encoding="utf-8"))
        for n in ast.walk(arbre):
            if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for d in n.decorator_list:
                if not (isinstance(d, ast.Call) and getattr(d.func, "attr", "") in _VERBES):
                    continue
                declares: set[int] = set()
                for kw in d.keywords:
                    if kw.arg == "responses" and isinstance(kw.value, ast.Call):
                        declares = {a.value for a in kw.value.args if isinstance(a, ast.Constant)}
                chemin = d.args[0].value if d.args else ""
                yield f.stem.removeprefix("routes_"), d.func.attr.upper(), chemin or "/", n.name, declares


_TOUTES = list(_routes())


def test_le_dispositif_voit_bien_toutes_les_routes():
    """Garde-fou du garde-fou : si l'extraction cassait, les specs suivantes
    passeraient en ne vérifiant RIEN. Elles seraient vertes et inutiles."""
    assert len(_TOUTES) >= 60, f"seulement {len(_TOUTES)} routes vues — l'extraction a cassé"


@pytest.mark.parametrize(
    ("module", "verbe", "chemin", "gestionnaire", "declares"),
    _TOUTES,
    ids=[f"{m}:{v} {c}" for m, v, c, _, _ in _TOUTES],
)
def test_une_route_declare_EXACTEMENT_les_codes_qu_elle_peut_rendre(
    module, verbe, chemin, gestionnaire, declares
):
    """⚠️ ÉGALITÉ, ET NON INCLUSION, dans les deux sens.

    Un code levé mais NON déclaré, c'est le défaut que le ticket décrit : le front
    le découvre en production. Un code déclaré mais JAMAIS levé est l'autre moitié
    du même problème — un contrat qui promet des cas imaginaires n'est pas plus
    fiable qu'un contrat muet, et il pousse le front à écrire des branches mortes.

    `422` est exclu de la comparaison : FastAPI l'ajoute lui-même aux routes qui
    valident un corps ou des paramètres, donc il est déjà dans le schéma sans
    qu'on le déclare."""
    attendus = {c for c in codes_atteignables(gestionnaire) if c != CODE_VALIDATION_FASTAPI}
    assert declares == attendus, (
        f"{verbe} {chemin} ({module}) — déclarés {sorted(declares) or 'aucun'}, "
        f"atteignables {sorted(attendus) or 'aucun'}"
    )


def test_tout_code_declare_a_une_description():
    """Sans description, la ligne n'apprend rien à qui lit le schéma — et
    `erreurs()` refuse déjà de construire une réponse muette."""
    for _, _, _, _, declares in _TOUTES:
        for code in declares:
            assert code in _DESCRIPTIONS, f"code {code} sans description"


def test_une_route_qui_ne_peut_PAS_echouer_ne_declare_rien():
    """`/health` est la seule dans ce cas, et c'est ce qui la définit : elle
    répond sans toucher à rien. Lui coller un 401 par symétrie mentirait."""
    sante = [d for m, v, c, _, d in _TOUTES if m == "health" and c == "/health"]
    assert sante == [set()], "『/health』 ne lève aucune exception : elle ne doit rien déclarer"


def test_aucun_code_DECLARE_n_est_mort():
    """⚠️ UN MOT QUE LE SERVEUR NE DIRA JAMAIS EST UN CONTRAT FAUX.

    `CODES` est le vocabulaire clos : le front peut s'appuyer dessus pour
    distinguer deux refus. Un code qui n'est plus levé y reste pourtant sans
    bruit — c'est arrivé deux fois, `suppression_reservee_au_createur` (FRE-85)
    et `trop_d_objectifs` (FRE-124), retirés à la main parce que quelqu'un s'en
    est souvenu.

    Ce test remplace la mémoire : chaque code déclaré doit apparaître ailleurs
    que dans sa propre déclaration.

    ⚠️ RECHERCHE TEXTUELLE, ET C'EST ASSUMÉ. Les codes sont levés de plusieurs
    façons — `ErreurMetier("x", …)`, une table de correspondance dans les
    gestionnaires, une constante. Un AST qui ne verrait que le premier cas
    déclarerait morts des codes bien vivants, et ce test crierait au loup
    jusqu'à ce qu'on l'ignore."""
    racine = pathlib.Path(__file__).resolve().parent.parent / "app"

    # Le bloc `CODES` lui-même est retiré : sa présence prouverait n'importe quoi.
    erreurs_py = (racine / "socle" / "erreurs.py").read_text(encoding="utf-8")
    debut = erreurs_py.index("CODES: dict[str, str] = {")
    fin = erreurs_py.index("\n}", debut)
    sources = erreurs_py[:debut] + erreurs_py[fin:]
    for f in racine.rglob("*.py"):
        if f.name != "erreurs.py":
            sources += f.read_text(encoding="utf-8")

    morts = [c for c in CODES if f'"{c}"' not in sources and f"'{c}'" not in sources]
    assert morts == [], (
        f"codes déclarés que rien ne lève : {sorted(morts)}. "
        "Les retirer de CODES — un mot du vocabulaire que le serveur ne dira "
        "jamais est un contrat faux."
    )
