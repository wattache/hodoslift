"""L'oracle de la bibliothèque : brokkr (REST) et sindri (Connect) disent-ils la même chose ?

Tant que le domaine a deux serveurs, rien d'autre ne le prouve : pytest ne parle
pas Connect, les specs Playwright ne lisent que l'écran. Ici on lit les deux
serveurs avec les mêmes comptes de l'émulateur, on ramène les deux réponses à
une même forme, et on diffe. Joué au démarrage du harnais réel, il l'arrête si
les deux divergent.

    uv run python scripts/oracle_bibliotheque.py http://127.0.0.1:8082 http://127.0.0.1:8083 127.0.0.1:9099

Ce qu'il ramène à une forme commune : la réponse REST omet `competition` hors
exercices et `supports` quand il n'y en a pas ; la réponse Connect (JSON proto)
omet les valeurs par défaut et nomme les groupes par l'enum (`GROUPE_MU`).
"""

import json
import sys
import urllib.error
import urllib.parse
import urllib.request

CATEGORIES = ("exercices", "variantes", "assistances", "tempos", "formats")
GROUPES = {"GROUPE_MU": "MU", "GROUPE_PU": "PU", "GROUPE_DIP": "DIP", "GROUPE_SQ": "SQ"}
# Les mêmes comptes que `eitri/e2e-reel/aides.ts` : l'émulateur les rattache
# aux uid semés (`e2e-coach`, `e2e-athlete-user`) par leur `provider_data`.
COACH = {"sub": "e2e-coach-google", "email": "e2e@french-forge.test"}
ATHLETE = {"sub": "e2e-athlete-user-google", "email": "athlete-e2e@french-forge.test"}
ETRANGER = {"sub": "oracle-etranger-google", "email": "etranger-oracle@french-forge.test"}


def jeton(emulateur: str, compte: dict) -> str:
    corps = json.dumps({
        "postBody": f"id_token={urllib.parse.quote(json.dumps(compte))}&providerId=google.com",
        "requestUri": "http://localhost",
        "returnSecureToken": True,
    }).encode()
    req = urllib.request.Request(
        f"http://{emulateur}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake",
        data=corps, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)["idToken"]


def appeler(req: urllib.request.Request) -> tuple[int, dict]:
    """Le statut et le corps JSON ; un corps illisible vaut `{}` — c'est un écart, pas une panne."""
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            brut, statut = r.read(), r.status
    except urllib.error.HTTPError as e:
        brut, statut = e.read(), e.code
    try:
        return statut, json.loads(brut or b"{}")
    except json.JSONDecodeError:
        return statut, {}


def rest(url: str, token: str, structure: str | None) -> tuple[int, dict]:
    q = f"?structure={urllib.parse.quote(structure)}" if structure else ""
    return appeler(urllib.request.Request(f"{url}/library{q}", headers={"Authorization": f"Bearer {token}"}))


def connect(url: str, token: str, structure: str | None) -> tuple[int, dict]:
    corps = json.dumps({"structure": structure} if structure else {}).encode()
    return appeler(urllib.request.Request(
        f"{url}/hodos.bibliotheque.v1.BibliothequeService/LireBibliotheque", data=corps,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}, method="POST"))


def forme_rest(corps: dict) -> dict:
    return {cat: sorted(corps.get(cat, []), key=lambda e: e["id"]) for cat in CATEGORIES}


def forme_connect(corps: dict) -> dict:
    out = {}
    for cat in CATEGORIES:
        entrees = []
        for e in corps.get(cat, []):
            entree = {"id": e["id"], "name": e["name"]}
            if cat == "exercices":
                entree["competition"] = bool(e.get("competition", False))
            if e.get("supports"):
                entree["supports"] = [GROUPES[g] for g in e["supports"]]
            entrees.append(entree)
        out[cat] = sorted(entrees, key=lambda e: e["id"])
    return out


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage : oracle_bibliotheque.py <URL brokkr> <URL sindri> <hôte:port émulateur>")
        return 2
    brokkr, sindri, emulateur = argv
    ecarts: list[str] = []

    # 1. Les lectures qui réussissent : la même bibliothèque, entrée par entrée.
    for nom, compte, structure in (("coach", COACH, None), ("coach, structure nommée", COACH, "french-forge"),
                                   ("athlète (membre, pas coach)", ATHLETE, None)):
        t = jeton(emulateur, compte)
        sr, cr = rest(brokkr, t, structure)
        sc, cc = connect(sindri, t, structure)
        if sr != 200 or sc != 200:
            ecarts.append(f"{nom} : brokkr {sr}, sindri {sc} — les deux devraient lire")
            continue
        a, b = forme_rest(cr), forme_connect(cc)
        for cat in CATEGORIES:
            if a[cat] != b[cat]:
                manque = [e["id"] for e in a[cat] if e not in b[cat]][:3]
                trop = [e["id"] for e in b[cat] if e not in a[cat]][:3]
                ecarts.append(f"{nom} / {cat} : {len(a[cat])} chez brokkr, {len(b[cat])} chez sindri "
                              f"(absents chez sindri {manque}, en trop {trop})")
        print(f"· {nom} : {sum(len(a[c]) for c in CATEGORIES)} entrées identiques des deux côtés")

    # 2. Les refus : la même grille. Le statut HTTP de Connect suit son code.
    t = jeton(emulateur, COACH)
    sr, cr = rest(brokkr, t, "structure-inconnue-oracle")
    sc, cc = connect(sindri, t, "structure-inconnue-oracle")
    if (sr, cr.get("code")) != (404, "structure_inconnue") or (sc, cc.get("code")) != (404, "not_found"):
        ecarts.append(f"structure inconnue : brokkr {sr}/{cr.get('code')}, sindri {sc}/{cc.get('code')}")
    t = jeton(emulateur, ETRANGER)
    sr, cr = rest(brokkr, t, None)
    sc, cc = connect(sindri, t, None)
    if (sr, cr.get("code")) != (403, "reserve_aux_membres") or (sc, cc.get("code")) != (403, "permission_denied"):
        ecarts.append(f"compte sans lien : brokkr {sr}/{cr.get('code')}, sindri {sc}/{cc.get('code')}")
    sc, cc = appeler(urllib.request.Request(
        f"{sindri}/hodos.bibliotheque.v1.BibliothequeService/LireBibliotheque", data=b"{}",
        headers={"Content-Type": "application/json"}, method="POST"))
    if (sc, cc.get("code")) != (401, "unauthenticated"):
        ecarts.append(f"sans jeton : sindri {sc}/{cc.get('code')}, attendu 401/unauthenticated")

    if ecarts:
        print("\n[oracle] ÉCHEC — brokkr et sindri ne disent pas la même chose :")
        for e in ecarts:
            print(f"   · {e}")
        return 1
    print("[oracle] OK — la bibliothèque est la même chez brokkr et chez sindri, refus compris")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
