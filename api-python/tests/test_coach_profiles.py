"""Profil public d'un coach (FRE-30).

PREMIER fichier porté sur un VRAI Postgres (fixture `pg` : conteneur postgres:16,
schéma créé depuis `docs/postgres-schema.sql`, transaction annulée par test). Les
autres fichiers restent sur SQLite et basculeront quand on y touchera.

Ce que le port a changé ici, et pourquoi il valait la peine :

  - `one_rm` (jsonb) et `langues` (text[]) sont désormais VÉRIFIÉS. Sur SQLite ils
    ne l'étaient pas : les deux colonnes y étaient du TEXT, le rendu réel était
    annoté « PG-only → vérifié à part contre Neon », et `langues` demandait un
    adaptateur sqlite3 (list → JSON) pour que le bind d'une liste Python passe.
    L'adaptateur a disparu ; psycopg rend une `list` et un `dict`, on l'affirme.

  - Les COACHS sont maintenant semés avec les `users` dont ils dépendent
    (`coaches.uid REFERENCES users(uid)`). Le schéma de test SQLite déclarait
    `coaches (uid TEXT PRIMARY KEY)` sans la FK — le même genre de stub que celui
    qui avait échappé à la suite sur la FK d'identité.

L'upload reste monkeypatché (aucun accès GCS).
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app

_AUTH = {"Authorization": "Bearer x"}
_PNG = b"\x89PNG\r\n\x1a\n" + b"le-reste-du-fichier"


@pytest.fixture
def db(pg):
    """Les deux coachs des tests — ET les `users` sans lesquels `coaches` ne prend
    pas la ligne. Rend la Connection du test : on sème et on vérifie dessus, dans
    la transaction que la fixture `pg` annulera."""
    pg.execute(
        text("INSERT INTO users (uid, email) VALUES ('coach-1', 'c1@ff.fr'), ('coach-2', 'c2@ff.fr')")
    )
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1'), ('coach-2')"))
    return pg


def _seed_profile(conn, coach_uid="coach-1", slug="aubin", **cols):
    conn.execute(
        text(
            "INSERT INTO coach_profiles "
            "(coach_uid, slug, accroche, bio, instagram, photo_url, one_rm, langues) "
            "VALUES (:u, :s, :a, :b, :i, :p, :o, :l)"
        ),
        {"u": coach_uid, "s": slug, "a": cols.get("accroche"), "b": cols.get("bio"),
         "i": cols.get("instagram"), "p": cols.get("photo_url"), "o": cols.get("one_rm"),
         "l": cols.get("langues")},
    )


def _val(conn, coach_uid, col):
    return conn.execute(
        text(f"SELECT {col} FROM coach_profiles WHERE coach_uid = :u"), {"u": coach_uid}
    ).scalar()


# --------------------------------------------------------------------------- #
# GET public — SANS authentification
# --------------------------------------------------------------------------- #


def test_get_public_sans_auth(db):
    _seed_profile(db, slug="aubin", accroche="King of Pull", bio="Beau gosse",
                  instagram="https://insta/x")
    # TestClient SANS override d'auth et SANS header : prouve que la route est publique.
    r = TestClient(app).get("/coach-profiles/aubin")
    assert r.status_code == 200
    body = r.json()
    assert body == {
        "slug": "aubin", "accroche": "King of Pull", "bio": "Beau gosse",
        "instagram": "https://insta/x", "photoUrl": None, "oneRm": None, "langues": None,
    }
    # aucune fuite de l'identifiant interne du coach
    assert "coachUid" not in body and "coach_uid" not in body


def test_get_slug_inconnu_404(db):
    assert TestClient(app).get("/coach-profiles/inconnu").status_code == 404


# --------------------------------------------------------------------------- #
# GET /me — lecture AUTHENTIFIÉE de son propre profil (écran d'édition)
# --------------------------------------------------------------------------- #


def test_get_me_renvoie_son_profil(auth_as, db):
    _seed_profile(db, coach_uid="coach-1", slug="aubin", accroche="King of Pull",
                  bio="Beau gosse", instagram="https://insta/x")
    r = auth_as(uid="coach-1").get("/coach-profiles/me", headers=_AUTH)
    assert r.status_code == 200
    assert r.json() == {
        "slug": "aubin", "accroche": "King of Pull", "bio": "Beau gosse",
        "instagram": "https://insta/x", "photoUrl": None, "oneRm": None, "langues": None,
    }


def test_get_me_404_sans_profil(auth_as, db):
    """404 = « pas encore de page », état NORMAL côté front (formulaire de création)."""
    assert auth_as(uid="coach-1").get("/coach-profiles/me", headers=_AUTH).status_code == 404


def test_get_me_non_coach_403(auth_as, db):
    assert auth_as(uid="intrus").get("/coach-profiles/me", headers=_AUTH).status_code == 403


def test_get_me_ne_lit_que_le_sien(auth_as, db):
    _seed_profile(db, coach_uid="coach-2", slug="maxime", bio="celui de l'autre")
    # coach-1 n'a pas de profil : il obtient 404, jamais celui de coach-2.
    assert auth_as(uid="coach-1").get("/coach-profiles/me", headers=_AUTH).status_code == 404


def test_get_me_n_est_pas_capte_par_la_route_slug(auth_as, db):
    """`/me` est déclarée AVANT `/{slug}` : sans cet ordre, un profil au slug littéral
    « me » serait servi à n'importe quel coach connecté."""
    _seed_profile(db, coach_uid="coach-2", slug="me", bio="piege")
    assert auth_as(uid="coach-1").get("/coach-profiles/me", headers=_AUTH).status_code == 404


def test_get_me_meme_forme_que_la_route_publique(auth_as, db):
    """Les deux GET typés par la MÊME interface côté front : mêmes clés, même casse."""
    _seed_profile(db, coach_uid="coach-1", slug="aubin", accroche="a", bio="b",
                  instagram="i", photo_url="https://p/x.png")
    public = TestClient(app).get("/coach-profiles/aubin").json()
    mine = auth_as(uid="coach-1").get("/coach-profiles/me", headers=_AUTH).json()
    assert mine == public


# --------------------------------------------------------------------------- #
# PATCH — upsert du PROPRE profil (identité, pas rôle)
# --------------------------------------------------------------------------- #


def test_patch_cree_le_profil(auth_as, db):
    r = auth_as(uid="coach-1").patch(
        "/coach-profiles/me", json={"slug": "aubin", "bio": "Beau gosse de Signes"}, headers=_AUTH
    )
    assert r.status_code == 200
    assert r.json() == {"ok": True, "slug": "aubin"}
    assert _val(db, "coach-1", "bio") == "Beau gosse de Signes"


def test_patch_met_a_jour_champ(auth_as, db):
    _seed_profile(db, slug="aubin", bio="ancienne")
    r = auth_as(uid="coach-1").patch("/coach-profiles/me", json={"bio": "nouvelle"}, headers=_AUTH)
    assert r.status_code == 200
    assert _val(db, "coach-1", "bio") == "nouvelle"


def test_patch_slug_requis_a_la_creation_422(auth_as, db):
    r = auth_as(uid="coach-1").patch("/coach-profiles/me", json={"bio": "x"}, headers=_AUTH)
    assert r.status_code == 422
    assert db.execute(text("SELECT count(*) FROM coach_profiles")).scalar() == 0


def test_patch_slug_immuable_409(auth_as, db):
    _seed_profile(db, slug="aubin")
    r = auth_as(uid="coach-1").patch("/coach-profiles/me", json={"slug": "autre"}, headers=_AUTH)
    assert r.status_code == 409
    assert _val(db, "coach-1", "slug") == "aubin"


def test_patch_slug_identique_ne_casse_pas(auth_as, db):
    _seed_profile(db, slug="aubin", bio="x")
    r = auth_as(uid="coach-1").patch(
        "/coach-profiles/me", json={"slug": "aubin", "bio": "y"}, headers=_AUTH
    )
    assert r.status_code == 200
    assert _val(db, "coach-1", "bio") == "y"


def test_patch_slug_deja_pris_409(auth_as, db):
    _seed_profile(db, coach_uid="coach-2", slug="aubin")
    r = auth_as(uid="coach-1").patch("/coach-profiles/me", json={"slug": "aubin"}, headers=_AUTH)
    assert r.status_code == 409


def test_patch_non_coach_403(auth_as, db):
    r = auth_as(uid="intrus").patch("/coach-profiles/me", json={"slug": "x"}, headers=_AUTH)
    assert r.status_code == 403


def test_patch_champ_inconnu_422(auth_as, db):
    """one_rm/photo_url ne sont pas patchables : glissés dans le corps → 422 (tout
    le payload tombe, extra='forbid')."""
    r = auth_as(uid="coach-1").patch(
        "/coach-profiles/me", json={"slug": "aubin", "one_rm": {"squat": 200}}, headers=_AUTH
    )
    assert r.status_code == 422


def test_patch_slug_invalide_422(auth_as, db):
    r = auth_as(uid="coach-1").patch("/coach-profiles/me", json={"slug": "Bad Slug!"}, headers=_AUTH)
    assert r.status_code == 422


def test_patch_n_affecte_que_son_profil(auth_as, db):
    _seed_profile(db, coach_uid="coach-1", slug="aubin", bio="a1")
    _seed_profile(db, coach_uid="coach-2", slug="maxime", bio="a2")
    auth_as(uid="coach-1").patch("/coach-profiles/me", json={"bio": "modifie"}, headers=_AUTH)
    assert _val(db, "coach-2", "bio") == "a2"  # celui de l'autre coach intact


# --------------------------------------------------------------------------- #
# langues — codes ISO 639-1, NORMALISÉS à l'entrée, sans énumération figée
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "saisi, attendu",
    [
        (["FR", "fr"], ["fr"]),                    # doublon de casse écarté
        ([" EN ", "fr", "EN"], ["en", "fr"]),      # trim + dédoublonnage, ORDRE gardé
        (["fr", "", "  "], ["fr"]),                # entrées vides écartées
        ([], None),                                # liste vide = non renseigné
        (["", "   "], None),                       # vidée par le nettoyage = idem
        (["tr", "ar"], ["tr", "ar"]),              # aucune énumération figée : tout code passe
        (None, None),                              # null explicite = effacement, pas une erreur
    ],
)
def test_langues_normalisation(saisi, attendu):
    """Normalisation vérifiée sur le SCHÉMA (sans base) : c'est là qu'elle vit."""
    from app.personnes.schemas_coach_profile import CoachProfilePatch

    assert CoachProfilePatch(langues=saisi).langues == attendu


def test_patch_ecrit_les_langues_normalisees(auth_as, db):
    """Le bind d'une `list` Python dans un text[] et sa relecture en `list` : c'est
    exactement ce que SQLite ne pouvait pas montrer (adaptateur JSON de contournement)."""
    r = auth_as(uid="coach-1").patch(
        "/coach-profiles/me", json={"slug": "aubin", "langues": ["FR", "fr", " EN "]},
        headers=_AUTH,
    )
    assert r.status_code == 200
    assert _val(db, "coach-1", "langues") == ["fr", "en"]


def test_patch_langues_sur_profil_existant(auth_as, db):
    _seed_profile(db, slug="aubin", langues=["fr"])
    r = auth_as(uid="coach-1").patch(
        "/coach-profiles/me", json={"langues": ["fr", "PL"]}, headers=_AUTH
    )
    assert r.status_code == 200
    assert _val(db, "coach-1", "langues") == ["fr", "pl"]


def test_patch_langues_vides_effacent_en_null(auth_as, db):
    """Liste vide → NULL, pas un tableau vide : la vitrine n'affiche alors aucune
    section « Langues » (elle teste la présence de la valeur)."""
    _seed_profile(db, slug="aubin", langues=["fr", "en"])
    r = auth_as(uid="coach-1").patch("/coach-profiles/me", json={"langues": []}, headers=_AUTH)
    assert r.status_code == 200
    assert _val(db, "coach-1", "langues") is None


def test_patch_sans_langues_ne_les_touche_pas(auth_as, db):
    """`exclude_unset` : un PATCH qui ne mentionne pas `langues` ne les efface pas."""
    _seed_profile(db, slug="aubin", langues=["fr"])
    auth_as(uid="coach-1").patch("/coach-profiles/me", json={"bio": "x"}, headers=_AUTH)
    assert _val(db, "coach-1", "langues") == ["fr"]


def test_patch_trop_de_langues_422(auth_as, db):
    r = auth_as(uid="coach-1").patch(
        "/coach-profiles/me",
        json={"slug": "aubin", "langues": [f"l{i}" for i in range(21)]},
        headers=_AUTH,
    )
    assert r.status_code == 422


def test_langues_dans_les_deux_lectures(auth_as, db):
    """Le champ sort des DEUX GET, sous le même nom — ils partagent `_payload`.
    Le rendu est une LISTE JSON, pas la chaîne que rendait le stockage SQLite."""
    _seed_profile(db, coach_uid="coach-1", slug="aubin", langues=["fr"])
    public = TestClient(app).get("/coach-profiles/aubin").json()
    mine = auth_as(uid="coach-1").get("/coach-profiles/me", headers=_AUTH).json()
    assert public["langues"] == ["fr"]
    assert "langues" in public and public == mine


# --------------------------------------------------------------------------- #
# Upload photo — brokkr téléverse (storage monkeypatché)
# --------------------------------------------------------------------------- #


def test_upload_photo(auth_as, db, monkeypatch):
    _seed_profile(db, coach_uid="coach-1", slug="aubin")
    monkeypatch.setattr("app.socle.config.settings.scaleway_bucket_public", "french-forge-coachs-public")
    calls = {}
    monkeypatch.setattr(
        "app.personnes.storage.upload_public_media",
        lambda path, data, ct: calls.update(path=path, ct=ct, size=len(data)),
    )
    r = auth_as(uid="coach-1").post(
        "/coach-profiles/me/photo",
        files={"file": ("profil.png", _PNG, "image/png")},
        headers=_AUTH,
    )
    assert r.status_code == 200
    assert calls["path"] == "aubin/profil.png"  # PAS de préfixe 'coachs/'
    assert calls["ct"] == "image/png"
    url = r.json()["photoUrl"]
    # Le seau PUBLIC de Scaleway, celui que le site vitrine lit aussi.
    assert url == "https://french-forge-coachs-public.s3.fr-par.scw.cloud/aubin/profil.png"
    assert _val(db, "coach-1", "photo_url") == url


def test_upload_sans_profil_404(auth_as, db, monkeypatch):
    called = []
    monkeypatch.setattr("app.personnes.storage.upload_public_media", lambda *a: called.append(a))
    r = auth_as(uid="coach-1").post(
        "/coach-profiles/me/photo", files={"file": ("profil.png", _PNG, "image/png")}, headers=_AUTH
    )
    assert r.status_code == 404
    assert called == []  # rien téléversé sans profil


def test_upload_non_png_415(auth_as, db, monkeypatch):
    _seed_profile(db, coach_uid="coach-1", slug="aubin")
    called = []
    monkeypatch.setattr("app.personnes.storage.upload_public_media", lambda *a: called.append(a))
    r = auth_as(uid="coach-1").post(
        "/coach-profiles/me/photo",
        files={"file": ("x.jpg", b"\xff\xd8\xff pas un png", "image/jpeg")},
        headers=_AUTH,
    )
    assert r.status_code == 415
    assert called == []  # signature vérifiée AVANT tout upload


def test_upload_trop_lourd_413(auth_as, db, monkeypatch):
    _seed_profile(db, coach_uid="coach-1", slug="aubin")
    called = []
    monkeypatch.setattr("app.personnes.storage.upload_public_media", lambda *a: called.append(a))
    # Plafond abaissé pour ne pas fabriquer 5 Mo dans un test.
    monkeypatch.setattr("app.personnes.routes_coach_profiles._MAX_PHOTO_BYTES", 4)
    r = auth_as(uid="coach-1").post(
        "/coach-profiles/me/photo",
        files={"file": ("profil.png", _PNG, "image/png")},  # PNG valide mais > 4 octets
        headers=_AUTH,
    )
    assert r.status_code == 413
    assert called == []


def test_upload_taille_verifiee_avant_le_contenu(auth_as, db, monkeypatch):
    """La borne de taille passe AVANT la lecture (UploadFile.size) : un fichier à la
    fois trop lourd ET non-PNG sort en 413, pas en 415 — donc sans être lu."""
    _seed_profile(db, coach_uid="coach-1", slug="aubin")
    monkeypatch.setattr("app.personnes.storage.upload_public_media", lambda *a: None)
    monkeypatch.setattr("app.personnes.routes_coach_profiles._MAX_PHOTO_BYTES", 4)
    r = auth_as(uid="coach-1").post(
        "/coach-profiles/me/photo",
        files={"file": ("x.jpg", b"\xff\xd8\xff pas un png", "image/jpeg")},
        headers=_AUTH,
    )
    assert r.status_code == 413


def test_upload_non_coach_403(auth_as, db, monkeypatch):
    monkeypatch.setattr("app.personnes.storage.upload_public_media", lambda *a: None)
    r = auth_as(uid="intrus").post(
        "/coach-profiles/me/photo", files={"file": ("profil.png", _PNG, "image/png")}, headers=_AUTH
    )
    assert r.status_code == 403


# --------------------------------------------------------------------------- #
# Projection des 1RM (greffée sur l'ETL analytics)
# --------------------------------------------------------------------------- #


def test_refresh_coach_one_rm_projette(db):
    from app.socle.db import get_session
    from scripts.etl_training_sets import refresh_coach_one_rm

    _seed_profile(db, coach_uid="coach-1", slug="aubin")
    db.execute(text(
        "INSERT INTO athletes (coach_uid, user_uid, current_one_rm) "
        "VALUES ('coach-1', 'coach-1', '{\"squat\": 227.5}')"
    ))
    with get_session() as s:
        assert refresh_coach_one_rm(s) == 1
    # jsonb → dict côté psycopg : le rendu que SQLite ne pouvait pas montrer.
    assert _val(db, "coach-1", "one_rm") == {"squat": 227.5}


def test_refresh_coach_sans_athlete_lie_inchange(db):
    from app.socle.db import get_session
    from scripts.etl_training_sets import refresh_coach_one_rm

    _seed_profile(db, coach_uid="coach-1", slug="aubin", one_rm=None)
    with get_session() as s:
        refresh_coach_one_rm(s)  # aucun athlète lié → aucune ligne touchée
    assert _val(db, "coach-1", "one_rm") is None


def test_get_public_porte_un_cache_court(db):
    """Sans cache, une page coach qui prend en story envoie chaque visite sur
    Cloud Run. 60 s reste indiscernable de l'instantané pour le coach qui publie."""
    _seed_profile(db, slug="aubin")
    r = TestClient(app).get("/coach-profiles/aubin")
    assert r.headers["cache-control"] == "public, max-age=60, stale-while-revalidate=300"


def test_le_404_public_n_est_pas_mis_en_cache(db):
    """Un profil qui vient d'être créé serait sinon annoncé introuvable une minute."""
    r = TestClient(app).get("/coach-profiles/personne")
    assert r.status_code == 404
    assert "cache-control" not in {k.lower() for k in r.headers}


def test_me_n_est_JAMAIS_cachee_publiquement(db, auth_as):
    """LE piège à ne pas reproduire : `public` sur une route authentifiée autorise
    un cache partagé à resservir le profil d'un coach à un AUTRE coach."""
    _seed_profile(db, coach_uid="coach-1", slug="aubin")
    r = auth_as(uid="coach-1").get("/coach-profiles/me", headers=_AUTH)
    assert r.status_code == 200
    assert "public" not in r.headers.get("cache-control", "")


# --------------------------------------------------------------------------- #
# LES 1RM ARRIVENT SUR LA PAGE PUBLIQUE TOUT DE SUITE, pas la nuit suivante
# --------------------------------------------------------------------------- #

def _seed_athlete_coach(conn, legacy="a1", coach_uid="coach-1", user_uid="coach-1", orm="{}"):
    """Un coach EST un athlète : c'est `athletes.user_uid` qui fait le lien avec
    `coach_profiles.coach_uid`, et c'est par là que ses 1RM se projettent."""
    conn.execute(text(
        "INSERT INTO athletes (legacy_id, first_name, coach_uid, user_uid, current_one_rm) "
        "VALUES (:l, 'Max', :c, :u, CAST(:o AS jsonb))"),
        {"l": legacy, "c": coach_uid, "u": user_uid, "o": orm})


def test_saisir_ses_1RM_met_a_jour_sa_page_publique_IMMEDIATEMENT(auth_as, db):
    """Signalé en production le 17/08 : Maxime Nowak avait ses cinq mouvements
    dans l'app et sa page publique affichait des zéros.

    `coach_profiles.one_rm` est une COPIE de `athletes.current_one_rm`, et cette
    redondance est délibérée — la route publique ne joint JAMAIS `athletes`,
    c'est le garde-fou contre une fuite sur un endpoint sans authentification.

    Mais la copie ne se faisait QUE la nuit (job `training-analytics-refresh`),
    au motif qu'un 1RM bouge deux fois par an. C'est faux au moment qui compte :
    quand un coach les renseigne pour la PREMIÈRE fois, il regarde sa page dans
    la foulée. On projette donc aussi à l'écriture."""
    _seed_profile(db, coach_uid="coach-1", slug="max", one_rm="{}")
    _seed_athlete_coach(db, user_uid="coach-1")

    r = auth_as(uid="coach-1").patch("/athletes/a1/profile", headers=_AUTH,
                                     json={"currentOneRM": {"squat": 190, "pullUp": 55}})
    assert r.status_code == 200

    public = TestClient(app).get("/coach-profiles/max").json()
    assert public["oneRm"]["squat"] == 190
    assert public["oneRm"]["pullUp"] == 55


def test_la_projection_ne_touche_QUE_le_coach_concerne(auth_as, db):
    """Sans le `AND a.legacy_id = :legacy`, l'`UPDATE … FROM` n'a plus de borne :
    il écrirait les 1RM du premier athlète venu dans TOUS les profils coach.
    C'est le genre de requête dont la version fausse passe tous les tests d'un
    seul profil."""
    _seed_profile(db, coach_uid="coach-1", slug="max", one_rm="{}")
    _seed_profile(db, coach_uid="coach-2", slug="autre", one_rm='{"squat": 100}')
    _seed_athlete_coach(db, user_uid="coach-1")

    auth_as(uid="coach-1").patch("/athletes/a1/profile", headers=_AUTH,
                                 json={"currentOneRM": {"squat": 190}})

    assert TestClient(app).get("/coach-profiles/autre").json()["oneRm"]["squat"] == 100


def test_un_athlete_qui_n_est_pas_coach_ne_projette_rien(auth_as, db):
    """La majorité des athlètes ne sont pas coachs : ils n'ont pas de ligne dans
    `coach_profiles`, et l'écriture de leurs 1RM ne doit RIEN toucher — ni lever."""
    _seed_profile(db, coach_uid="coach-1", slug="max", one_rm='{"squat": 100}')
    _seed_athlete_coach(db, legacy="a2", coach_uid="coach-1", user_uid=None)

    r = auth_as(uid="coach-1").patch("/athletes/a2/profile", headers=_AUTH,
                                     json={"currentOneRM": {"squat": 190}})
    assert r.status_code == 200
    assert TestClient(app).get("/coach-profiles/max").json()["oneRm"]["squat"] == 100
