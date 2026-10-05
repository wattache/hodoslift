"""Génère la paire VAPID des notifications push — UNE fois, puis dans l'environnement.

    uv run python -m scripts.generer_cles_vapid

Imprime deux valeurs : `VAPID_PRIVATE_KEY` (un SECRET, à ranger comme
`DB_PASSWORD` — jamais dans un dépôt) et `VAPID_PUBLIC_KEY` (donnée au
navigateur, pas un secret). Changer la paire invalide tous les abonnements
existants : les navigateurs devront se réabonner.
"""
import base64

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid


def _b64(octets: bytes) -> str:
    return base64.urlsafe_b64encode(octets).rstrip(b"=").decode()


def main() -> None:
    vapid = Vapid()
    vapid.generate_keys()
    privee = _b64(vapid.private_key.private_numbers().private_value.to_bytes(32, "big"))
    publique = _b64(vapid.public_key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
    print(f"VAPID_PRIVATE_KEY={privee}")
    print(f"VAPID_PUBLIC_KEY={publique}")


if __name__ == "__main__":
    main()
