from fastapi.testclient import TestClient

from app.main import app


def test_whoami_sans_header():
    client = TestClient(app)
    response = client.get("/whoami")
    assert response.status_code == 401


def test_whoami_token_valide(monkeypatch):
    monkeypatch.setattr(
        "app.socle.auth.firebase_auth.verify_id_token",
        lambda token: {"uid": "u1", "email": "a@b.c"},
    )
    client = TestClient(app)
    response = client.get("/whoami", headers={"Authorization": "Bearer x"})
    assert response.status_code == 200
    assert response.json() == {"uid": "u1", "email": "a@b.c"}


def test_whoami_token_invalide(monkeypatch):
    def _raise(token):
        raise Exception("invalid")

    monkeypatch.setattr("app.socle.auth.firebase_auth.verify_id_token", _raise)
    client = TestClient(app)
    response = client.get("/whoami", headers={"Authorization": "Bearer x"})
    assert response.status_code == 401