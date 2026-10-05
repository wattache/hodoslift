"""Recopie les médias publics des coachs du seau GCS vers le seau public Scaleway.

api-python téléverse désormais dans le seau Scaleway, et le site vitrine y lit
(`web/landing/build-coachs.mjs`). Ce qui existait avant (photos de profil,
photos de témoignages) est dans le seau GCS : sans cette recopie, le site
vitrine afficherait des images absentes.

    cd api-python && uv run python ../scripts/copier_les_photos_vers_scaleway.py               # à blanc
    cd api-python && uv run python ../scripts/copier_les_photos_vers_scaleway.py --appliquer   # écrit

⚠️ À BLANC PAR DÉFAUT : sans `--appliquer`, rien n'est écrit, la liste seule
s'affiche. Le seau GCS n'est que LU, sans identifiant : il est public.

⚠️ AUCUN OBJET N'EST ÉCRASÉ : un objet déjà présent chez Scaleway (une photo
téléversée depuis la bascule) est plus récent que celui de GCS, et il est gardé.

Les clés de l'application `brokkr` viennent de `terraform output`, jamais d'une
copie à la main.
"""

import json
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

SEAU_GCS = "french-forge-600-public-media"
INFRA = Path(__file__).resolve().parent.parent / "infra"


def objets_gcs() -> list[tuple[str, str]]:
    """(nom, type) de chaque objet du seau public, page par page."""
    objets, page = [], ""
    while True:
        url = f"https://storage.googleapis.com/storage/v1/b/{SEAU_GCS}/o?fields=items(name,contentType),nextPageToken"
        if page:
            url += f"&pageToken={urllib.parse.quote(page)}"
        with urllib.request.urlopen(url, timeout=30) as r:
            d = json.load(r)
        # Les noms en `/` sont des marqueurs de dossier de la console GCS, pas des médias.
        objets += [(o["name"], o.get("contentType", "application/octet-stream"))
                   for o in d.get("items", []) if not o["name"].endswith("/")]
        page = d.get("nextPageToken", "")
        if not page:
            return objets


def sortie(nom: str, forme: str = "-raw") -> str:
    """Une sortie Terraform ; `-json` pour celles qui ne sont pas des chaînes."""
    return subprocess.run(["terraform", f"-chdir={INFRA}", "output", forme, nom],
                          capture_output=True, text=True, check=True).stdout


def main(argv: list[str]) -> int:
    appliquer = "--appliquer" in argv
    objets = objets_gcs()
    print(f"· {len(objets)} objet(s) dans gs://{SEAU_GCS}")

    import boto3  # l'environnement d'api-python le porte déjà (médiathèque)
    seaux = json.loads(sortie("scaleway_buckets", "-json"))
    seau = seaux["coachs_public"]
    s3 = boto3.client("s3", endpoint_url="https://s3.fr-par.scw.cloud", region_name="fr-par",
                      aws_access_key_id=sortie("scaleway_brokkr_access_key"),
                      aws_secret_access_key=sortie("scaleway_brokkr_secret_key"))
    deja = {o["Key"] for page in s3.get_paginator("list_objects_v2").paginate(Bucket=seau) for o in page.get("Contents", [])}

    a_copier = [(n, t) for n, t in objets if n not in deja]
    for n, _ in objets:
        print(f"  {'garde' if n in deja else 'copie'} {n}")
    if not appliquer:
        print(f"(à blanc) {len(a_copier)} à copier vers {seau} — relancer avec --appliquer")
        return 0
    for n, t in a_copier:
        with urllib.request.urlopen(f"https://storage.googleapis.com/{SEAU_GCS}/{urllib.parse.quote(n)}", timeout=60) as r:
            s3.put_object(Bucket=seau, Key=n, Body=r.read(), ContentType=t, ACL="public-read",
                          CacheControl="public, max-age=86400")
    absents = [n for n, _ in objets if n not in {o["Key"] for page in s3.get_paginator("list_objects_v2").paginate(Bucket=seau) for o in page.get("Contents", [])}]
    if absents:
        print(f"⛔ {len(absents)} objet(s) toujours absents chez Scaleway : {absents[:5]}")
        return 1
    print(f"[photos] OK — {len(a_copier)} copiés, les {len(objets)} objets sont chez Scaleway")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
