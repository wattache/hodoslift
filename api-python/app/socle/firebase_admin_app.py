"""Initialisation du Firebase Admin SDK (singleton), sans identité Google.

⚠️ Importé pour son EFFET DE BORD : sans l'app Admin, `verify_id_token` ne peut
pas vérifier un jeton. `auth.py` l'importe pour cela seulement — supprimer ce
module emporte l'authentification.

⚠️ AUCUNE IDENTITÉ, ET C'EST CE QUI REND BROKKR DÉPLOYABLE HORS DE GCP.
`verify_id_token` (sans `check_revoked`) valide une signature contre les clés
PUBLIQUES de Google : il n'appelle aucune API autorisée. Mais le SDK construit
au démarrage du service d'auth un client HTTP authentifié, et cherche pour lui
les identifiants par défaut (ADC). Sans eux — partout ailleurs que sur Cloud
Run —, chaque vérification lève `DefaultCredentialsError`, que `auth.py` rend en
401 : plus personne ne se connecte. D'où des identifiants ANONYMES, qui suffisent
à tout ce que brokkr demande au SDK.

⚠️ Si brokkr appelle un jour une API Admin AUTORISÉE (créer, supprimer, révoquer
un compte), elle échouera ici : il lui faudra une vraie identité, et ce module
devra la recevoir.
"""

import firebase_admin
from firebase_admin import credentials
from google.auth.credentials import AnonymousCredentials

from app.socle.config import settings


class _SansIdentite(credentials.Base):
    """Des identifiants qui n'en sont pas : aucun appel autorisé ne passe."""

    def get_credential(self) -> AnonymousCredentials:
        return AnonymousCredentials()


if not firebase_admin._apps:
    firebase_admin.initialize_app(_SansIdentite(), options={"projectId": settings.project_id})
