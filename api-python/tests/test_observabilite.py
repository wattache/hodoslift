"""Ce qui part chez Sentry — et surtout ce qui n'en part pas.

⚠️ CES SPECS PROTÈGENT UNE FRONTIÈRE EXTERNE. Tout ce qui traverse `before_send`
quitte l'infrastructure et atterrit chez un tiers. Une régression ici ne casse
aucun écran et ne fait échouer aucun test métier : elle fuite, en silence.

L'organisation Sentry est dans l'UE, ce qui règle le transfert. Ça ne règle pas
l'hébergement de données de santé — Sentry n'est pas certifié HDS. D'où la règle
tenue ici : rien de sensible ne doit y arriver, la localisation n'étant qu'une
ceinture de plus.
"""

import pytest
from fastapi import HTTPException

from app.socle.observabilite import _est_un_incident, _masquer, _nettoyer


def _evenement(message: str) -> dict:
    return {"message": message, "exception": {"values": [{"value": message}]}}


# --------------------------------------------------------------------------- #
# CE QUI N'EST PAS UN INCIDENT
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("statut", [400, 401, 403, 404, 409, 422])
def test_un_4xx_n_est_PAS_un_incident(statut):
    """⚠️ Un 4xx est le fonctionnement NORMAL de l'autorisation et de la
    validation — de loin les erreurs les plus fréquentes. Les envoyer noierait le
    signal et brûlerait le quota pour des événements dont personne n'a rien à
    faire."""
    assert _est_un_incident(HTTPException(statut, "peu importe")) is False


@pytest.mark.parametrize("statut", [500, 502, 503])
def test_un_5xx_EST_un_incident(statut):
    """Là, c'est brokkr qui a échoué. C'est exactement ce qu'on veut voir."""
    assert _est_un_incident(HTTPException(statut, "boum")) is True


def test_une_exception_INATTENDUE_est_un_incident():
    """Le cas nominal : ce qui n'a pas été prévu du tout."""
    assert _est_un_incident(ZeroDivisionError("division par zéro")) is True


def test_un_evenement_de_4xx_est_JETÉ_avant_l_envoi():
    indice = {"exc_info": (HTTPException, HTTPException(404, "athlète introuvable"), None)}
    assert _nettoyer(_evenement("athlète introuvable"), indice) is None


# --------------------------------------------------------------------------- #
# CE QUI DOIT ÊTRE MASQUÉ
# --------------------------------------------------------------------------- #


def test_le_contenu_entre_guillemets_est_masqué():
    """Les messages de brokkr mettent en avant la valeur fautive — un nom de
    mouvement, une catégorie de poids. C'est utile à qui débogue en local, ça n'a
    rien à faire chez un tiers."""
    assert "SQUAT" not in _masquer("mouvement « SQUAT » : doit être un lift de compétition")


def test_le_genre_d_un_participant_est_masqué():
    assert "F" not in _masquer("catégorie « -63 » invalide pour le genre F").replace("«…»", "")


def test_une_date_de_passage_est_masquée():
    assert "2026-03-01" not in _masquer("2026-03-01 n'est pas un jour de cette compétition")


def test_un_identifiant_d_athlète_est_masqué_DANS_l_url():
    masqué = _masquer("GET /athletes/4UsjDzSJkaLS1fMBk5ck/daily-logs")
    assert "4UsjDzSJkaLS1fMBk5ck" not in masqué
    assert "/athletes/{id}/daily-logs" in masqué


def test_l_identifiant_masqué_garde_le_REGROUPEMENT_intact():
    """⚠️ LA RAISON DU JETON STABLE, et pas d'un masquage aléatoire. Sentry
    regroupe les événements par leur texte : si chaque athlète produisait son
    propre identifiant, une panne unique ressemblerait à cinquante-huit erreurs
    distinctes, et aucune alerte de seuil ne se déclencherait."""
    a = _masquer("GET /athletes/4UsjDzSJkaLS1fMBk5ck/daily-logs")
    b = _masquer("GET /athletes/yNSrYedFmXbQYGooNcec/daily-logs")
    assert a == b


def test_les_fils_d_ariane_sont_masqués_AUSSI():
    """⚠️ LE PIÈGE DISCRET. Les fils d'Ariane rejouent les requêtes qui ont
    précédé l'incident : masquer le seul message laisserait passer les mêmes
    identifiants une ligne plus bas."""
    evenement = {
        "message": "boum",
        "breadcrumbs": {"values": [
            {"message": "GET /athletes/4UsjDzSJkaLS1fMBk5ck/tracking"},
        ]},
    }
    nettoyé = _nettoyer(evenement, {"exc_info": (RuntimeError, RuntimeError("boum"), None)})
    assert "4UsjDzSJkaLS1fMBk5ck" not in nettoyé["breadcrumbs"]["values"][0]["message"]


def test_l_url_de_la_requête_est_masquée():
    evenement = {"message": "boum",
                 "request": {"url": "https://api/athletes/4UsjDzSJkaLS1fMBk5ck/prs"}}
    nettoyé = _nettoyer(evenement, {"exc_info": (RuntimeError, RuntimeError("boum"), None)})
    assert "4UsjDzSJkaLS1fMBk5ck" not in nettoyé["request"]["url"]


# --------------------------------------------------------------------------- #
# L'INTERRUPTEUR
# --------------------------------------------------------------------------- #


def test_sans_DSN_rien_n_est_branché(monkeypatch, caplog):
    """⚠️ CE QUI GARDE LES TESTS ET LE HARNAIS E2E MUETS. Sans cette porte, chaque
    campagne locale enverrait ses erreurs en production Sentry — et le quota
    partirait en bruit de développement."""
    import app.socle.observabilite as obs

    monkeypatch.setattr(obs.settings, "sentry_dsn", "")
    with caplog.at_level("INFO"):
        obs.installer()
    assert "non configuré" in caplog.text


def test_l_evenement_porte_le_requestId_pour_retrouver_le_LOG():
    """⚠️ SANS CE FIL, LE MASQUAGE SERAIT UNE PERTE SÈCHE.

    Les valeurs retirées avant l'envoi ne sont pas détruites : elles restent dans
    Cloud Logging, à l'intérieur de GCP. Mais y revenir suppose de savoir QUELLE
    ligne lire. Ce jeton est celui que `logging_config` pose sur chacune — une
    alerte Sentry devient donc une requête `jsonPayload.requestId="…"`.

    Le cas qui l'a motivé : « catégorie « -63 » invalide pour le genre F ». Si la
    cause est une ligne manquante du référentiel, savoir laquelle est exactement
    ce qu'il faut, et le code seul ne le dit pas."""
    from app.socle.logging_config import request_id_var

    jeton = request_id_var.set("abc-123")
    try:
        nettoyé = _nettoyer(_evenement("boum"),
                            {"exc_info": (RuntimeError, RuntimeError("boum"), None)})
    finally:
        request_id_var.reset(jeton)

    assert nettoyé["tags"]["requestId"] == "abc-123"


def test_la_version_deployee_prefere_le_SHA_a_la_revision(monkeypatch):
    """⚠️ SANS VERSION, PAS DE « DEPUIS QUAND ? ». L'image est taguée `:latest` et
    `pyproject` dit `0.1.0` depuis toujours : rien ne distinguait deux
    déploiements, donc Sentry ne pouvait ni situer une erreur dans le temps ni
    détecter une régression.

    Le SHA d'abord parce qu'il mène au COMMIT ; `K_REVISION`, que Cloud Run pose
    tout seul, est le repli — moins parlant, mais il change à chaque déploiement."""
    from app.socle.config import settings

    monkeypatch.setattr(settings, "git_sha", "a1b2c3d")
    monkeypatch.setattr(settings, "k_revision", "brokkr-00042-xyz")
    assert settings.version_deployee == "a1b2c3d"

    monkeypatch.setattr(settings, "git_sha", "")
    assert settings.version_deployee == "brokkr-00042-xyz"

    monkeypatch.setattr(settings, "k_revision", "")
    assert settings.version_deployee is None
