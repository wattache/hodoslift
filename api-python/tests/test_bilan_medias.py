"""LE TÉLÉVERSEMENT DES MÉDIAS DE DÉMONSTRATION (FRE-99, lot B).

⚠️ AUCUN OCTET NE PART SUR LE RÉSEAU : `mediatheque.televerser` et
`url_signee` sont remplacés. Une suite de tests qui parlerait à Scaleway serait
lente, dépendante d'une clé, et déposerait de vrais objets dans un vrai seau —
trois raisons de ne pas le faire, dont la dernière est la pire.

Ce que ces tests gardent tient en trois points, et le premier est le seul qui
protège vraiment quelque chose :

  · le format est reconnu AUX OCTETS, pas à l'extension ni au Content-Type ;
  · le chemin est FABRIQUÉ par le serveur, jamais reçu du client ;
  · la lecture rend une URL signée, jamais le chemin — le seau est privé.
"""

import io

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.kine import mediatheque
from app.socle.auth import verify_token
from app.main import app

_AUTH = {"Authorization": "Bearer x"}
_PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64
_JPEG = b"\xff\xd8\xff" + b"0" * 64


@pytest.fixture
def monde(pg):
    pg.execute(text("INSERT INTO users (uid, email) VALUES "
                    "('kine-1','k@x.fr'), ('coach-1','c@x.fr')"))
    pg.execute(text("INSERT INTO kines (uid) VALUES ('kine-1')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1')"))
    return pg


@pytest.fixture
def stockage(monkeypatch):
    """Le seau, en mémoire. Rend ce qui a été écrit, pour que les tests puissent
    vérifier le CHEMIN et le type MIME sans réseau."""
    ecrits: dict[str, tuple[bytes, str]] = {}
    monkeypatch.setattr(mediatheque, "televerser",
                        lambda chemin, data, mime: ecrits.__setitem__(chemin, (data, mime)))
    monkeypatch.setattr(mediatheque, "url_signee",
                        lambda chemin, duree=0: f"https://signee.test/{chemin}?sig=x")
    return ecrits


def _client(uid: str) -> TestClient:
    app.dependency_overrides[verify_token] = lambda: {"uid": uid}
    return TestClient(app)


def _envoyer(client, contenu: bytes, nom: str = "photo.png"):
    return client.post("/bilan-medias-demo", headers=_AUTH,
                       files={"file": (nom, io.BytesIO(contenu), "image/png")})


# --------------------------------------------------------------------------- #
# Le dépôt
# --------------------------------------------------------------------------- #

def test_une_image_est_deposee_et_relue(monde, stockage):
    r = _envoyer(_client("kine-1"), _PNG)
    assert r.status_code == 201, r.text[:300]
    corps = r.json()

    assert corps["type"] == "image"
    assert corps["creePar"] == "kine-1"
    # ⚠️ UNE URL SIGNÉE, ET PAS LE CHEMIN. Publier le chemin figerait l'hébergeur
    # dans le contrat, alors que tout FRE-99 consiste à pouvoir en changer.
    assert corps["url"].startswith("https://signee.test/")
    assert "chemin" not in corps

    catalogue = _client("kine-1").get("/bilan-medias-demo", headers=_AUTH).json()
    assert [m["id"] for m in catalogue] == [corps["id"]]


def test_le_CHEMIN_est_fabrique_par_le_serveur(monde, stockage):
    """⚠️ LE NOM DU FICHIER ENVOYÉ N'A AUCUNE INFLUENCE, et c'est ce qui empêche
    un client d'écraser l'objet d'un autre test. Un chemin reçu serait un chemin
    choisi : « demo/../../autre.png » ou simplement le même nom deux fois."""
    _envoyer(_client("kine-1"), _PNG, nom="../../../etc/passwd")

    (chemin,) = stockage.keys()
    assert chemin.startswith("demo/")
    assert chemin.endswith(".png")
    assert "passwd" not in chemin and ".." not in chemin


def test_le_format_est_reconnu_aux_OCTETS(monde, stockage):
    """⚠️ NI L'EXTENSION NI LE `Content-Type` NE PROUVENT RIEN : les deux viennent
    du client. Ici le fichier s'annonce `.png` avec `image/png`, et ses octets
    disent JPEG — c'est eux qui décident, jusqu'au type MIME stocké."""
    r = _envoyer(_client("kine-1"), _JPEG, nom="photo.png")
    assert r.status_code == 201

    (chemin, (_, mime)) = next(iter(stockage.items()))
    assert chemin.endswith(".jpg")
    assert mime == "image/jpeg"


def test_un_fichier_qui_n_est_pas_une_image_est_refuse(monde, stockage):
    """Un exécutable renommé `.png` passerait l'extension et le Content-Type.
    C'est précisément pourquoi brokkr téléverse lui-même : une URL d'upload
    signée aurait laissé ce fichier atteindre le seau, et on l'aurait découvert
    après."""
    r = _envoyer(_client("kine-1"), b"MZ\x90\x00" + b"0" * 64)
    assert r.status_code == 415
    assert r.json()["code"] == "media_format_refuse"
    assert stockage == {}, "un fichier refusé ne doit RIEN écrire"


def test_une_image_trop_lourde_est_refusee(monde, stockage):
    r = _envoyer(_client("kine-1"), _PNG + b"0" * (5 * 1024 * 1024))
    assert r.status_code == 413
    assert r.json()["code"] == "media_trop_lourd"
    assert stockage == {}


# --------------------------------------------------------------------------- #
# ⚠️ QUI PEUT DÉPOSER
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("uid", ["coach-1", "inconnu"])
def test_seule_la_kine_depose_et_liste(monde, stockage, uid):
    """Composer un bilan est un acte de praticien, et une photo de démonstration
    fait partie de la composition — même règle que le catalogue des modèles.

    ⚠️ LE COACH EST DEHORS ICI ALORS QU'IL EST DEDANS PARTOUT AILLEURS dans
    l'entraînement. C'est la frontière posée le 21/08 pour le domaine kiné, et
    elle vaut aussi pour ce qui n'est pas sensible : ce n'est pas la sensibilité
    de la photo qui décide, c'est à qui appartient le geste de composer."""
    c = _client(uid)
    assert c.get("/bilan-medias-demo", headers=_AUTH).status_code == 403
    assert _envoyer(c, _PNG).status_code == 403
    assert stockage == {}


# --------------------------------------------------------------------------- #
# Le rattachement à un test
# --------------------------------------------------------------------------- #

def test_un_media_se_rattache_a_un_test_et_s_en_detache(monde, stockage):
    """⚠️ LE RATTACHEMENT PASSE PAR L'IDENTITÉ DU MÉDIA, jamais par un chemin
    fourni par le client — sans quoi il pourrait désigner n'importe quel objet du
    seau. Et `None` DÉTACHE : c'est le geste « retirer l'image », qui ne doit pas
    se confondre avec « supprimer le média »."""
    monde.execute(text(
        "INSERT INTO bilan_modeles (id, nom) VALUES "
        "('11111111-1111-1111-1111-111111111111','Bilan complet')"))
    monde.execute(text(
        "INSERT INTO bilan_rubriques (id, modele_id, libelle, ordre) VALUES "
        "('22222222-2222-2222-2222-222222222222',"
        "'11111111-1111-1111-1111-111111111111','Tests généraux',1)"))
    c = _client("kine-1")
    media = _envoyer(c, _PNG).json()
    test = c.post("/bilan-modeles/11111111-1111-1111-1111-111111111111"
                  "/rubriques/22222222-2222-2222-2222-222222222222/tests",
                  headers=_AUTH, json={"libelle": "Squat overhead"}).json()
    assert test["medias"] == []

    url = ("/bilan-modeles/11111111-1111-1111-1111-111111111111"
           f"/tests/{test['id']}")
    second = _envoyer(c, _JPEG).json()

    # ⚠️ DEUX IMAGES, ET L'ORDRE EST CELUI QU'ON A ENVOYÉ. Le formulaire papier
    # montrait déjà un mouvement en plusieurs photos — départ, passage, arrivée —
    # et « arrivée, départ » ne raconte pas la même chose.
    rattache = c.patch(url, headers=_AUTH,
                       json={"mediaIds": [media["id"], second["id"]]}).json()
    assert [m["id"] for m in rattache["medias"]] == [media["id"], second["id"]]
    # ⚠️ ET LES URL SIGNÉES SUIVENT, sans second appel : le front affiche les
    # images dès la réponse du PATCH. Signer étant un calcul local, ça ne coûte
    # rien.
    assert all(m["url"].startswith("https://signee.test/") for m in rattache["medias"])

    # Réordonner passe par la même liste — pas de route dédiée.
    inverse = c.patch(url, headers=_AUTH,
                      json={"mediaIds": [second["id"], media["id"]]}).json()
    assert [m["id"] for m in inverse["medias"]] == [second["id"], media["id"]]

    # ⚠️ UN PATCH QUI NE PARLE PAS DES IMAGES N'Y TOUCHE PAS. « Absent » n'est pas
    # « vide » : sans cette distinction, renommer un test effacerait ses photos.
    renomme = c.patch(url, headers=_AUTH, json={"libelle": "Squat OH"}).json()
    assert len(renomme["medias"]) == 2

    detache = c.patch(url, headers=_AUTH, json={"mediaIds": []}).json()
    assert detache["medias"] == []

    # Les médias, eux, existent toujours : détacher n'est pas supprimer.
    assert len(c.get("/bilan-medias-demo", headers=_AUTH).json()) == 2


def test_sans_stockage_configure_le_catalogue_repond_QUAND_MEME(monde, monkeypatch):
    """⚠️ UNE IMAGE MANQUANTE EST UN DÉSAGRÉMENT, UN CATALOGUE INACCESSIBLE EST
    UNE PANNE. Le jour où la clé Scaleway expirera (FRE-104), la kiné doit
    pouvoir continuer à composer ses modèles — sans les vignettes. Laisser
    remonter l'erreur ferait tomber la lecture du modèle ENTIER pour une
    vignette."""
    monde.execute(text(
        "INSERT INTO bilan_medias_demo (chemin, cree_par) VALUES ('demo/x.png','kine-1')"))
    monkeypatch.setattr(mediatheque, "url_signee", _indisponible)

    catalogue = _client("kine-1").get("/bilan-medias-demo", headers=_AUTH)
    assert catalogue.status_code == 200
    assert catalogue.json()[0]["url"] is None


def _indisponible(*_a, **_k):
    raise mediatheque.MediathequeIndisponible("pas de clé")
