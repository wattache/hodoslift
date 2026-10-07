"""Téléversement vers le bucket de médias PUBLICS (FRE-30).

brokkr téléverse LUI-MÊME plutôt que de délivrer une URL signée V4 : signer sur
Cloud Run (ADC sans clé privée) exigerait `roles/iam.serviceAccountTokenCreator`
sur soi-même et l'API IAM SignBlob. Une seule liaison suffit ainsi :
`roles/storage.objectAdmin` sur le bucket public pour la SA `brokkr` (nidavellir).

⚠️ `objectAdmin` et NON `objectCreator`, qui autorise la création mais pas le
REMPLACEMENT. L'objet est à chemin fixe (`<slug>/profil.png`) : la première photo
passerait, et toutes les suivantes tomberaient en 403.

L'import de google-cloud-storage est PARESSEUX : ni l'app ni les tests ne le
chargent au démarrage, et les tests monkeypatchent `upload_public_media`.
"""

from app.socle.config import settings


def upload_public_media(object_path: str, data: bytes, content_type: str) -> None:
    """Écrit `data` dans gs://<public_media_bucket>/<object_path>.

    Cache d'un jour : ces images ne changent qu'exceptionnellement.
    """
    from google.cloud import storage  # import paresseux — cf. en-tête du module

    client = storage.Client(project=settings.project_id)
    blob = client.bucket(settings.public_media_bucket).blob(object_path)
    blob.cache_control = "public, max-age=86400"
    blob.upload_from_string(data, content_type=content_type)
