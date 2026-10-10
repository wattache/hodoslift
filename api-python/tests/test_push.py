"""LES NOTIFICATIONS PUSH — « me prévenir quand mon coach génère une semaine » (28/09).

Ce que ces specs gardent :
  1. L'abonnement de l'appelant s'enregistre et se retire, par navigateur.
  2. Générer une semaine PRÉVIENT l'athlète du programme — et personne d'autre,
     et jamais l'auteur lui-même (le coach-athlète qui se programme).
  3. Un effet, pas l'acte : un service de push qui refuse ne fait pas échouer la
     génération, et un endpoint parti (410) est retiré.
  4. Sans clés VAPID, rien ne part et rien ne casse.
"""
import json
import pytest
from fastapi.testclient import TestClient
from pywebpush import WebPushException
from sqlalchemy import text

from app.main import app
from app.notifications import metier_push
from app.socle.auth import verify_token
from app.socle.config import settings
from tests.test_generation_semaine import _base, _generer, _poser_la_base, _principe, monde  # noqa: F401

_AUTH = {"Authorization": "Bearer x"}
_ENDPOINT = "https://push.example.test/abonnement/1"
_ABONNEMENT = {"endpoint": _ENDPOINT, "keys": {"p256dh": "clef-p256dh", "auth": "clef-auth"}}


def _client(uid: str) -> TestClient:
    app.dependency_overrides[verify_token] = lambda: {"uid": uid, "email": f"{uid}@x.fr"}
    return TestClient(app)


def _abonnements(pg, uid: str) -> list[str]:
    return [r[0] for r in pg.execute(text("SELECT endpoint FROM push_subscriptions WHERE uid = :u"), {"u": uid})]


@pytest.fixture
def vapid(monkeypatch):
    """Des clés posées, et un envoi capturé — jamais de réseau ici."""
    monkeypatch.setattr(settings, "vapid_private_key", "privee")
    monkeypatch.setattr(settings, "vapid_public_key", "publique")
    envois: list[dict] = []
    monkeypatch.setattr(metier_push, "_envoyer", lambda **kw: envois.append(kw))
    return envois


# --------------------------------------------------------------------------- #
# L'ABONNEMENT
# --------------------------------------------------------------------------- #

def test_s_abonner_puis_se_retirer(pg):
    c = _client("laura")
    assert c.post("/users/me/push", json=_ABONNEMENT, headers=_AUTH).status_code == 200
    assert _abonnements(pg, "laura") == [_ENDPOINT]
    # Idempotent : le même navigateur qui se réabonne ne crée pas de doublon.
    assert c.post("/users/me/push", json=_ABONNEMENT, headers=_AUTH).status_code == 200
    assert _abonnements(pg, "laura") == [_ENDPOINT]

    assert c.post("/users/me/push/retrait", json={"endpoint": _ENDPOINT}, headers=_AUTH).status_code == 200
    assert _abonnements(pg, "laura") == []


def test_le_meme_appareil_sous_un_autre_compte_change_de_main(pg):
    _client("laura").post("/users/me/push", json=_ABONNEMENT, headers=_AUTH)
    _client("nico").post("/users/me/push", json=_ABONNEMENT, headers=_AUTH)
    assert _abonnements(pg, "laura") == []
    assert _abonnements(pg, "nico") == [_ENDPOINT]


def test_un_abonnement_sans_cles_est_refuse(pg):
    r = _client("laura").post("/users/me/push", json={"endpoint": _ENDPOINT, "keys": {"p256dh": "x"}}, headers=_AUTH)
    assert r.status_code == 422


def test_la_cle_publique_est_nulle_sans_configuration(pg, monkeypatch):
    monkeypatch.setattr(settings, "vapid_public_key", "")
    assert _client("laura").get("/push/vapid", headers=_AUTH).json() == {"clePublique": None}
    monkeypatch.setattr(settings, "vapid_public_key", "publique")
    assert _client("laura").get("/push/vapid", headers=_AUTH).json() == {"clePublique": "publique"}


# --------------------------------------------------------------------------- #
# LA GÉNÉRATION PRÉVIENT L'ATHLÈTE
# --------------------------------------------------------------------------- #

def _lier_un_compte(pg, uid: str) -> None:
    pg.execute(text("INSERT INTO users (uid, email) VALUES (:u, :e) ON CONFLICT (uid) DO NOTHING"), {"u": uid, "e": f"{uid}@x.fr"})
    pg.execute(text("UPDATE athletes SET user_uid = :u WHERE id = '11111111-1111-1111-1111-111111111111'"), {"u": uid})


def test_generer_une_semaine_previent_l_athlete_du_programme(monde, vapid):
    """MUTATION QUI ROUGIT : retirer l'appel à `notifier_nouvelle_semaine` de
    `generate_week` — la semaine se génère, personne n'est prévenu."""
    _lier_un_compte(monde["pg"], "laura")
    _client("laura").post("/users/me/push", json=_ABONNEMENT, headers=_AUTH)
    _poser_la_base(monde, _base(principles=[_principe("SQUAT", 1)]))

    assert _generer(monde).status_code == 201
    assert len(vapid) == 1
    assert vapid[0]["subscription_info"]["endpoint"] == _ENDPOINT
    assert vapid[0]["vapid_private_key"] == "privee"
    assert "semaine 1" in vapid[0]["data"]


def test_l_athlete_est_prevenu_dans_sa_langue(monde, vapid):
    """FRE-228 : la langue choisie dans l'app (`preferences.langue`) est celle du
    push. MUTATION QUI ROUGIT : envoyer le français à tout le monde."""
    _lier_un_compte(monde["pg"], "laura")
    monde["pg"].execute(text("UPDATE users SET preferences = '{\"langue\": \"pl\"}' WHERE uid = 'laura'"))
    _client("laura").post("/users/me/push", json=_ABONNEMENT, headers=_AUTH)
    _poser_la_base(monde, _base(principles=[_principe("SQUAT", 1)]))

    assert _generer(monde).status_code == 201
    assert json.loads(vapid[0]["data"]) == {"titre": "Nowy tydzień", "corps": "Twój trener właśnie przygotował tydzień 1.", "url": "/training"}


def test_la_semaine_suivante_previent_aussi_avec_son_numero(monde, vapid):
    _lier_un_compte(monde["pg"], "laura")
    _client("laura").post("/users/me/push", json=_ABONNEMENT, headers=_AUTH)
    _poser_la_base(monde, _base(principles=[_principe("SQUAT", 1)]))
    assert _generer(monde).status_code == 201
    r = _client("coach-1").post(f"/programs/p1/blocks/{monde['bloc']}/next-week", headers=_AUTH)
    assert r.status_code == 201, r.text[:200]
    assert [e["data"] for e in vapid][-1].count("semaine 2") == 1


def test_le_coach_athlete_qui_se_programme_n_est_pas_prevenu(monde, vapid):
    """Le rôle combiné : William est coach ET athlète. Générer SA semaine ne le
    notifie pas de ce qu'il vient de faire."""
    _lier_un_compte(monde["pg"], "coach-1")
    _client("coach-1").post("/users/me/push", json=_ABONNEMENT, headers=_AUTH)
    _poser_la_base(monde, _base(principles=[_principe("SQUAT", 1)]))
    assert _generer(monde).status_code == 201
    assert vapid == []


def test_un_athlete_sans_compte_ou_sans_abonnement_ne_recoit_rien_et_rien_ne_casse(monde, vapid):
    _poser_la_base(monde, _base(principles=[_principe("SQUAT", 1)]))
    assert _generer(monde).status_code == 201
    assert vapid == []


# --------------------------------------------------------------------------- #
# UN EFFET, PAS L'ACTE
# --------------------------------------------------------------------------- #

class _Reponse:
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code


def test_un_service_de_push_qui_refuse_ne_fait_pas_echouer_la_generation(monde, monkeypatch):
    monkeypatch.setattr(settings, "vapid_private_key", "privee")
    monkeypatch.setattr(settings, "vapid_public_key", "publique")

    def refuse(**kw):
        raise WebPushException("boom", response=_Reponse(500))
    monkeypatch.setattr(metier_push, "_envoyer", refuse)
    _lier_un_compte(monde["pg"], "laura")
    _client("laura").post("/users/me/push", json=_ABONNEMENT, headers=_AUTH)
    _poser_la_base(monde, _base(principles=[_principe("SQUAT", 1)]))

    assert _generer(monde).status_code == 201
    # L'abonnement reste : un 500 n'est pas un endpoint parti.
    assert _abonnements(monde["pg"], "laura") == [_ENDPOINT]


def test_un_endpoint_parti_est_retire(monde, monkeypatch):
    """MUTATION QUI ROUGIT : ne pas distinguer 410 des autres refus."""
    monkeypatch.setattr(settings, "vapid_private_key", "privee")
    monkeypatch.setattr(settings, "vapid_public_key", "publique")

    def parti(**kw):
        raise WebPushException("gone", response=_Reponse(410))
    monkeypatch.setattr(metier_push, "_envoyer", parti)
    _lier_un_compte(monde["pg"], "laura")
    _client("laura").post("/users/me/push", json=_ABONNEMENT, headers=_AUTH)
    _poser_la_base(monde, _base(principles=[_principe("SQUAT", 1)]))

    assert _generer(monde).status_code == 201
    assert _abonnements(monde["pg"], "laura") == []


def test_sans_cles_vapid_rien_ne_part(monde, monkeypatch):
    monkeypatch.setattr(settings, "vapid_private_key", "")
    monkeypatch.setattr(settings, "vapid_public_key", "")
    envois: list[dict] = []
    monkeypatch.setattr(metier_push, "_envoyer", lambda **kw: envois.append(kw))
    _lier_un_compte(monde["pg"], "laura")
    _client("laura").post("/users/me/push", json=_ABONNEMENT, headers=_AUTH)
    _poser_la_base(monde, _base(principles=[_principe("SQUAT", 1)]))

    assert _generer(monde).status_code == 201
    assert envois == []
