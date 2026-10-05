"""Disponibilité des coachs sur une compétition (FRE-22).

Le point qui mérite d'être verrouillé : `pending` est une VALEUR, pas une
absence. Le GET renvoie la matrice COMPLÈTE coach × jour, y compris pour un
coach qui n'a jamais rien déclaré — sinon « jamais vu » et « ligne perdue »
seraient indistinguables, et on ne saurait pas qui relancer.

⚠️ CE FICHIER EST LE CAS D'ÉCOLE DE FRE-80. Il fabriquait sa propre
`competition_coach_availability` — et c'est PRÉCISÉMENT pour ça qu'il ne pouvait
pas voir que la table manquait à `docs/postgres-schema.sql`. Conséquence : le bac
à sable e2e, construit depuis ce fichier, ne l'avait pas, la route y répondait
500 `UndefinedTable`, et elle était INTESTABLE contre la vraie pile. Un test vert
sur un stub, une route morte sur le harnais : le pire des deux mondes.

Il tourne désormais sur le vrai Postgres, et la route a en plus ses specs e2e
réelles (`eitri/e2e-reel/disponibilites.spec.ts`).
"""

import pytest
from sqlalchemy import text

_AUTH = {"Authorization": "Bearer x"}


# `competitions.id` est un uuid en production, pas un entier de séquence.
C1 = "c1c1c1c1-0000-4000-8000-000000000001"


@pytest.fixture
def sql(pg):
    pg.execute(text("INSERT INTO users (uid, email, display_name) VALUES "
                    "('coach-1', 'a@x.fr', 'Aubin'), ('coach-2', 'w@x.fr', 'Willi')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1'), ('coach-2')"))
    # Compétition sur DEUX jours : c'est tout l'intérêt du découpage.
    # `created_by` est NOT NULL et FK vers `coaches` — le stub l'ignorait.
    pg.execute(text("INSERT INTO competitions (id, legacy_id, name, start_date, end_date, created_by) "
                    "VALUES (CAST(:c AS uuid), 'c1', 'FNSL', '2026-10-31', '2026-11-01', 'coach-1')"),
               {"c": C1})
    return pg


def test_matrice_complete_avant_toute_declaration(auth_as, sql):
    """Rien n'a été déclaré : la matrice existe quand même, entièrement en
    `pending`. C'est elle qui dit qui reste à relancer."""
    client = auth_as(uid="coach-1")
    rows = client.get("/competitions/c1/availability", headers=_AUTH).json()
    assert len(rows) == 4                       # 2 coachs × 2 jours
    assert {r["status"] for r in rows} == {"pending"}
    assert {r["day"] for r in rows} == {"2026-10-31", "2026-11-01"}
    assert {r["coachName"] for r in rows} == {"Aubin", "Willi"}


def test_declaration_par_jour(auth_as, sql):
    client = auth_as(uid="coach-1")
    r = client.put("/competitions/c1/availability", headers=_AUTH,
                   json={"coachUid": "coach-1", "day": "2026-10-31", "status": "available"})
    assert r.status_code == 200

    rows = client.get("/competitions/c1/availability", headers=_AUTH).json()
    par_jour = {(x["coachUid"], x["day"]): x["status"] for x in rows}
    assert par_jour[("coach-1", "2026-10-31")] == "available"
    # L'AUTRE jour du même coach reste à répondre : la dispo est par jour.
    assert par_jour[("coach-1", "2026-11-01")] == "pending"


def test_declaration_idempotente(auth_as, sql):
    client = auth_as(uid="coach-1")
    body = {"coachUid": "coach-2", "day": "2026-11-01", "status": "unavailable"}
    for _ in range(3):
        assert client.put("/competitions/c1/availability", headers=_AUTH, json=body).status_code == 200
    rows = client.get("/competitions/c1/availability", headers=_AUTH).json()
    assert sum(1 for x in rows if x["coachUid"] == "coach-2" and x["day"] == "2026-11-01") == 1


def test_revenir_a_pending(auth_as, sql):
    """`pending` doit être ré-assignable : un coach qui se rétracte n'est pas
    « indisponible », il n'a plus répondu."""
    client = auth_as(uid="coach-1")
    for st in ("available", "pending"):
        client.put("/competitions/c1/availability", headers=_AUTH,
                   json={"coachUid": "coach-1", "day": "2026-10-31", "status": st})
    rows = client.get("/competitions/c1/availability", headers=_AUTH).json()
    assert next(x for x in rows if x["coachUid"] == "coach-1"
                and x["day"] == "2026-10-31")["status"] == "pending"


def test_jour_hors_competition_refuse(auth_as, sql):
    client = auth_as(uid="coach-1")
    r = client.put("/competitions/c1/availability", headers=_AUTH,
                   json={"coachUid": "coach-1", "day": "2026-12-25", "status": "available"})
    assert r.status_code == 400


def test_coach_inconnu_refuse(auth_as, sql):
    client = auth_as(uid="coach-1")
    r = client.put("/competitions/c1/availability", headers=_AUTH,
                   json={"coachUid": "inconnu", "day": "2026-10-31", "status": "available"})
    assert r.status_code == 400


def test_statut_hors_vocabulaire_refuse(auth_as, sql):
    client = auth_as(uid="coach-1")
    r = client.put("/competitions/c1/availability", headers=_AUTH,
                   json={"coachUid": "coach-1", "day": "2026-10-31", "status": "peut-être"})
    assert r.status_code == 422


def test_non_coach_ne_declare_pas(auth_as, sql):
    client = auth_as(uid="athlete-1")
    r = client.put("/competitions/c1/availability", headers=_AUTH,
                   json={"coachUid": "coach-1", "day": "2026-10-31", "status": "available"})
    assert r.status_code == 403


def test_competition_inconnue(auth_as, sql):
    client = auth_as(uid="coach-1")
    assert client.get("/competitions/zzz/availability", headers=_AUTH).status_code == 404


# --------------------------------------------------------------------------- #
# FRE-25 — « à quelles compétitions va CE coach ? », la question du calendrier
# --------------------------------------------------------------------------- #

def _url(uid: str) -> str:
    return f"/competitions/coach-availability?coachUid={uid}"


def test_dispos_vides_avant_toute_declaration(auth_as, sql):
    """Contrairement au GET par compétition, PAS de matrice complétée ici :
    « il n'a rien dit » se lit très bien comme une absence de ligne."""
    assert auth_as(uid="coach-1").get(_url("coach-1"), headers=_AUTH).json() == []


def test_dispos_dun_AUTRE_coach_sont_lisibles(auth_as, sql):
    """LE POINT DU TICKET : un calendrier décrit l'athlète qu'on REGARDE, pas
    celui qui regarde. William consultant le planning d'Aubin doit voir les
    plateaux d'Aubin — sinon la fonctionnalité ne sert que si chacun se connecte
    pour se regarder lui-même."""
    c1 = auth_as(uid="coach-1")
    c1.put("/competitions/c1/availability", headers=_AUTH,
           json={"coachUid": "coach-2", "day": "2026-10-31", "status": "available"})

    vu_par_un_autre = c1.get(_url("coach-2"), headers=_AUTH).json()
    assert vu_par_un_autre == [
        {"competitionId": "c1", "day": "2026-10-31", "status": "available"}
    ]


def test_chaque_coach_a_bien_les_siennes(auth_as, sql):
    c1 = auth_as(uid="coach-1")
    c1.put("/competitions/c1/availability", headers=_AUTH,
           json={"coachUid": "coach-1", "day": "2026-10-31", "status": "available"})
    c1.put("/competitions/c1/availability", headers=_AUTH,
           json={"coachUid": "coach-2", "day": "2026-11-01", "status": "available"})

    assert [r["day"] for r in c1.get(_url("coach-1"), headers=_AUTH).json()] == ["2026-10-31"]
    assert [r["day"] for r in c1.get(_url("coach-2"), headers=_AUTH).json()] == ["2026-11-01"]


def test_dispos_portent_le_statut_pas_seulement_les_jours_retenus(auth_as, sql):
    """Le calendrier n'affichera que les `available` — mais c'est LUI qui
    filtre. Renvoyer le statut laisse la porte ouverte à un rappel « tu n'as pas
    répondu » sans toucher au contrat."""
    c = auth_as(uid="coach-1")
    c.put("/competitions/c1/availability", headers=_AUTH,
          json={"coachUid": "coach-1", "day": "2026-10-31", "status": "available"})
    c.put("/competitions/c1/availability", headers=_AUTH,
          json={"coachUid": "coach-1", "day": "2026-11-01", "status": "unavailable"})

    rows = c.get(_url("coach-1"), headers=_AUTH).json()
    assert {r["day"]: r["status"] for r in rows} == {
        "2026-10-31": "available", "2026-11-01": "unavailable"
    }


def test_dispos_renvoient_le_legacy_id_de_la_competition(auth_as, sql):
    """C'est `legacy_id` que le front manipule partout (URL de fiche, jointure
    avec GET /competitions) — renvoyer la clé interne rendrait la réponse
    inexploitable sans un aller-retour de plus."""
    c = auth_as(uid="coach-1")
    c.put("/competitions/c1/availability", headers=_AUTH,
          json={"coachUid": "coach-1", "day": "2026-10-31", "status": "available"})
    assert c.get(_url("coach-1"), headers=_AUTH).json()[0]["competitionId"] == "c1"


def test_coach_availability_nest_pas_pris_pour_un_comp_id(auth_as, sql):
    """`/coach-availability` ne doit pas être capté par `/{comp_id}` : la route à
    un seul segment est déclarée exprès pour éviter cette collision."""
    r = auth_as(uid="coach-1").get(_url("coach-1"), headers=_AUTH)
    assert r.status_code == 200          # et non 404 « compétition introuvable »


def test_coach_uid_est_obligatoire(auth_as, sql):
    """Pas de repli implicite sur le porteur du jeton : c'est ce repli qui avait
    produit le défaut d'origine (on affichait les plateaux du COACH CONNECTÉ
    dans le calendrier de quelqu'un d'autre)."""
    r = auth_as(uid="coach-1").get("/competitions/coach-availability", headers=_AUTH)
    assert r.status_code == 422


# --------------------------------------------------------------------------- #
# LES CLÉS DE SORTIE, figées AVANT le `response_model` (FRE-70, vague 4)
#
# ⚠️ DEUX ROUTES, DEUX FORMES, ET C'EST VOULU. Celle par compétition rend une
# MATRICE COMPLÈTE coach × jour, comblée à `pending` — elle répond à « qui reste
# à relancer ? », question qui exige les trous. Celle par coach ne rend que les
# lignes RÉELLEMENT déclarées — « il n'a rien dit » s'y lit comme une absence.
# Leur donner un modèle commun effacerait cette différence.
# --------------------------------------------------------------------------- #


def test_la_matrice_par_competition_porte_TOUS_ses_champs(auth_as, sql):
    ligne = auth_as(uid="coach-1").get(
        "/competitions/c1/availability", headers=_AUTH).json()[0]
    assert set(ligne) == {"coachUid", "coachName", "day", "status"}
    # `coachName` est un COALESCE (nom affiché, à défaut l'email, à défaut l'uid) :
    # jamais nul, donc jamais un champ que l'affichage doive défendre.
    assert ligne["coachName"]


def test_les_dispos_par_coach_portent_TOUS_leurs_champs(auth_as, sql):
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1/availability",
               json={"coachUid": "coach-1", "day": "2026-10-31", "status": "available"},
               headers=_AUTH)
    ligne = client.get(_url("coach-1"), headers=_AUTH).json()[0]

    # `competitionId` ET NON `coachUid` : on sait déjà de quel coach il s'agit,
    # c'est le paramètre — ce qu'on apprend, c'est OÙ il va.
    assert set(ligne) == {"competitionId", "day", "status"}
    assert ligne["competitionId"] == "c1"
