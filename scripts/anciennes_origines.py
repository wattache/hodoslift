"""QUI PASSE ENCORE PAR LES ANCIENNES ADRESSES (FRE-146).

Le site d'hébergement porte trois adresses pour le même déploiement ; seule
`trainer.french-forge.com` doit survivre. Depuis le 09/09 l'app rapatrie
d'elle-même, mais quelqu'un qui n'a pas rouvert l'app n'est pas rapatrié — et
« plus personne » ne se décrète pas, ça se mesure.

⚠️ LA MESURE VIT DANS LES LOGS DE REQUÊTES CLOUD RUN, pas dans ceux de brokkr :
le journal applicatif n'a ni `Origin` ni `Referer`. Le `referer` dit d'où vient
l'appel, et le chemin (`/programs/{id}`, `/athletes/{id}`) dit pour QUI — c'est
ainsi que les sept personnes du 09/09 ont été nommées. Les noms viennent de la
production, en LECTURE SEULE.

Le compte de service brokkr n'a pas le droit de lire les logs : on passe par un
compte utilisateur (`gcloud auth list`, variable `GCLOUD_COMPTE`).

Usage : make anciennes-origines [JOURS=7]
"""

import collections
import json
import os
import subprocess
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
COMPTE = os.environ.get("GCLOUD_COMPTE", "attachew974@gmail.com")
PROJET = "french-forge-600"
FILTRE = 'resource.type="cloud_run_revision" AND httpRequest.referer:"french-forge-600"'
IGNORES = {"me", "mine", "suivis", "link", "signalements"}


def appareil(ua: str) -> str:
    for marque, nom in (("iPhone", "iPhone"), ("Android", "Android"),
                        ("Macintosh", "Mac"), ("Windows", "Windows")):
        if marque in ua:
            return nom
    return "autre"


def lire_les_logs(jours: int) -> list[dict]:
    sortie = subprocess.run(
        ["gcloud", "logging", "read", FILTRE, f"--account={COMPTE}", f"--project={PROJET}",
         f"--freshness={jours}d", "--limit=20000", "--format=json"],
        capture_output=True, text=True, check=True).stdout
    return json.loads(sortie or "[]")


def qui(url: str) -> tuple[str, str] | None:
    chemin = url.split("//", 1)[-1].split("/", 1)[-1]
    parts = chemin.split("?")[0].split("/")
    if len(parts) >= 2 and parts[0] in ("programs", "athletes") and parts[1] not in IGNORES:
        return parts[0], parts[1]
    return None


def noms(programmes: set[str], athletes: set[str]) -> dict[tuple[str, str], str]:
    """id → « Prénom Nom (coach X) », depuis la production, lecture seule."""
    env = RACINE / "brokkr" / ".env"
    if not env.exists():
        return {}
    import psycopg  # celui du venv de brokkr
    url = next((l.split("=", 1)[1].strip().strip('"') for l in env.read_text().splitlines()
                if l.startswith("DATABASE_URL=")), "")
    if not url:
        return {}
    url = url.replace("postgresql+psycopg://", "postgresql://")
    res: dict[tuple[str, str], str] = {}
    with psycopg.connect(url) as c:
        c.read_only = True
        for pid, nom, coach in c.execute(
                "SELECT p.id, btrim(a.first_name||' '||a.last_name), coalesce(u.display_name, u.email) "
                "FROM programs p JOIN athletes a ON a.id = p.athlete_id "
                "JOIN users u ON u.uid = p.coach_uid WHERE p.id = ANY(%s)", [list(programmes)]):
            res[("programs", pid)] = f"{nom} (coach {coach})"
        for aid, nom, coach in c.execute(
                "SELECT a.legacy_id, btrim(a.first_name||' '||a.last_name), coalesce(u.display_name, u.email) "
                "FROM athletes a JOIN users u ON u.uid = a.coach_uid WHERE a.legacy_id = ANY(%s)",
                [list(athletes)]):
            res[("athletes", aid)] = f"{nom} (coach {coach})"
    return res


def main(argv: list[str]) -> int:
    jours = int(argv[1]) if len(argv) > 1 else 7
    entrees = lire_les_logs(jours)
    par_jour: collections.Counter = collections.Counter()
    par_qui: dict[tuple, dict] = collections.defaultdict(lambda: {"req": 0, "dernier": ""})
    for e in entrees:
        h = e.get("httpRequest", {})
        jour = e["timestamp"][:10]
        hote = h.get("referer", "").split("/")[2].replace("french-forge-600.", "")
        app = appareil(h.get("userAgent", ""))
        par_jour[(jour, hote, app)] += 1
        cle = qui(h.get("requestUrl", ""))
        if cle:
            v = par_qui[(cle, app)]
            v["req"] += 1
            v["dernier"] = max(v["dernier"], jour)

    if not entrees:
        print(f"· rien depuis les anciennes adresses sur {jours} jour(s) — on peut fermer.")
        return 0
    print(f"== requêtes par jour, adresse, appareil ({jours} jours)")
    for (jour, hote, app), n in sorted(par_jour.items()):
        print(f"  {jour}  {hote:<16} {app:<8} {n:>6}")

    libelles = noms({k[0][1] for k in par_qui if k[0][0] == "programs"},
                    {k[0][1] for k in par_qui if k[0][0] == "athletes"})
    # ⚠️ UN Mac QUI TOUCHE BEAUCOUP D'ATHLÈTES EST LE COACH : la fiche visitée
    # n'est pas la personne connectée. On l'agrège par personne quand même — c'est
    # le lecteur qui reconnaît son coach à la colonne « appareil ».
    par_personne: dict[tuple[str, str], dict] = collections.defaultdict(lambda: {"req": 0, "dernier": ""})
    for (cle, app), v in par_qui.items():
        p = par_personne[(libelles.get(cle, f"{cle[0]}/{cle[1]}"), app)]
        p["req"] += v["req"]
        p["dernier"] = max(p["dernier"], v["dernier"])
    print("== qui, appareil, dernier jour, requêtes")
    for (personne, app), v in sorted(par_personne.items(), key=lambda kv: (kv[1]["dernier"], kv[0]), reverse=True):
        print(f"  {v['dernier']}  {app:<8} {v['req']:>5}  {personne}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
