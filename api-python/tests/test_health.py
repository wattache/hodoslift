from fastapi.testclient import TestClient

from app.socle.config import settings
from app.main import app


def test_health_ok():
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    # `version` est `None` ici : rien n'injecte `GIT_SHA` hors conteneur, et
    # c'est la réponse honnête — mieux qu'un `"dev"` inventé, qu'on finirait par
    # lire un jour en production sans savoir d'où il sort.
    assert response.json() == {"status": "ok", "service": "brokkr", "version": None}


def test_health_dit_la_version_deployee(monkeypatch):
    """La sonde qui rend `make deploy` vérifiable — cf. la cible `verifier`.

    Sans ce champ, RIEN ne distingue deux déploiements : l'image était taguée
    `:latest` et `/health` répondait la même chose avant et après. Le 16/08, un
    `make deploy` sans `make build` a servi une image périmée sans que personne
    puisse le constater autrement qu'en lisant le code exécuté.
    """
    monkeypatch.setattr(settings, "git_sha", "abc1234")

    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json()["version"] == "abc1234"


def test_health_retombe_sur_la_revision_cloud_run(monkeypatch):
    """À défaut de SHA, la révision Cloud Run — moins parlante, mais elle change
    à chaque déploiement, donc elle distingue encore deux versions."""
    monkeypatch.setattr(settings, "git_sha", "")
    monkeypatch.setattr(settings, "k_revision", "brokkr-00042-abc")

    assert TestClient(app).get("/health").json()["version"] == "brokkr-00042-abc"
