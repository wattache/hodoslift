"""brokkr vérifie un jeton Firebase sans aucun identifiant Google.

Hors de Cloud Run, il n'y a ni compte de service ni identifiants par défaut
(ADC). Le SDK doit pourtant construire son service d'auth : sans cela, chaque
vérification lève `DefaultCredentialsError`, que `auth.py` rend en 401.

Le test tourne dans un SOUS-PROCESSUS à l'environnement vidé : `conftest.py`
neutralise `firebase_admin.initialize_app` dans ce processus-ci, et le poste peut
porter des identifiants (`GOOGLE_APPLICATION_CREDENTIALS`, `~/.config/gcloud`)
qui rendraient le test vert pour la mauvaise raison. Aucun appel réseau : on
s'arrête à la construction du client, là où l'ADC était exigé.
"""

import os
import subprocess
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent

SCRIPT = """
import firebase_admin
from firebase_admin import auth
import app.socle.firebase_admin_app  # l'initialisation de l'application
auth._get_client(firebase_admin.get_app())
print("client construit")
"""


def test_le_service_d_auth_se_construit_sans_identifiants_google(tmp_path):
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(("GOOGLE_", "CLOUDSDK_", "GCLOUD_", "FIREBASE_"))}
    env["HOME"] = str(tmp_path)          # pas de ~/.config/gcloud
    env["PROJECT_ID"] = "french-forge-600"
    r = subprocess.run([sys.executable, "-c", SCRIPT], cwd=RACINE, env=env,
                       capture_output=True, text=True, timeout=60)
    # MUTATION QUI ROUGIT : `initialize_app(options=…)` sans identifiants
    # anonymes — DefaultCredentialsError, et plus personne ne se connecte.
    assert r.returncode == 0, r.stderr[-800:]
    assert "client construit" in r.stdout
