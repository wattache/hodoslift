"""Vérification de l'ID token Firebase.

Le client envoie son ID token Firebase dans l'en-tête
`Authorization: Bearer <token>`. On le valide via l'Admin SDK et on renvoie
les claims décodés (dont `uid` et `email`).
"""

from fastapi import Depends, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from firebase_admin import auth as firebase_auth

from app.socle import firebase_admin_app  # noqa: F401 — garantit l'initialisation de l'app Admin
from app.socle.erreurs import ErreurMetier

_bearer = HTTPBearer(auto_error=True)


def verify_token(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    """Dépendance FastAPI : renvoie les claims du token, ou 401."""
    try:
        return firebase_auth.verify_id_token(credentials.credentials)
    except Exception:
        raise ErreurMetier("token_invalide", 
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalide ou expiré",
        )
