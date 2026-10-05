"""LE HARNAIS SE GARDE LUI-MÊME (FRE-142).

⚠️ QUINZE FICHIERS POSAIENT `app.dependency_overrides[verify_token]` DANS LEUR
PROPRE `_client()` SANS JAMAIS LE RETIRER. Le suivant héritait donc d'un faux
jeton — et `test_auth.py::test_whoami_sans_header`, qui attend un 401 sur un
`TestClient` nu, ne passait que parce que `test_athletes.py` (via `auth_as`, qui
nettoie) tombe alphabétiquement entre `test_aller_retour` et `test_auth`.

Mesuré le 09/09 : `pytest tests/test_aller_retour.py tests/test_auth.py` →
3 rouges. La suite entière était verte par ORDRE, pas par construction.

Même famille que le `monkeypatch` inerte de FRE-60 : un motif recopié de fichier
en fichier parce qu'il ressemblait à un rouage nécessaire. La garde vit dans
`conftest.py` (`_overrides_propres`, `autouse`) ; ce fichier prouve qu'elle
tient, par ORDRE DE DÉFINITION — la première spec salit, la seconde constate.
"""

from fastapi.testclient import TestClient

from app.socle.auth import verify_token
from app.main import app


def test_a_une_spec_qui_pose_un_override_et_ne_le_retire_pas():
    """Le geste exact des quinze fichiers : poser, ne pas retirer."""
    app.dependency_overrides[verify_token] = lambda: {"uid": "fantome"}
    assert TestClient(app).get("/users/me").status_code != 401


def test_b_la_spec_suivante_ne_le_voit_plus():
    """⚠️ SANS LA GARDE, CE TEST EST ROUGE : il hérite du fantôme d'au-dessus.
    C'est le seul qui prouve quelque chose — le premier est son décor."""
    assert app.dependency_overrides == {}
    assert TestClient(app).get("/users/me").status_code == 401
