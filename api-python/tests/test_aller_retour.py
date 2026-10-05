"""RÉÉCRIRE CE QUE LA LECTURE VIENT DE RENDRE — le test qui manquait.

Tous les défauts de FRE-12, sans exception, appartiennent à une seule famille :
**l'écriture refuse, jette ou casse sur ce que sa propre lecture rend**. Un
`variant: null` que le front ne sait pas afficher, une date `''` refusée par un
motif, un `weightLocked` booléen comparé à une chaîne, un `athlete` que la
création ignore alors que la lecture le rend.

Chacun a été corrigé par un test SPÉCIFIQUE, ce qui n'empêche pas le suivant. Le
correctif du 15/08 au soir — servir `''` au lieu de `null` sur les dates de bloc —
a d'ailleurs REINTRODUIT la famille : `s1StartDate: ''` échouait alors sur le
motif de date, et la BASE des 54 blocs (sur 125) sans date de S1 n'était plus
enregistrable.

Ce fichier teste donc l'INVARIANT plutôt que ses instances : à chaque niveau, on
lit l'arbre et on renvoie au serveur exactement ce qu'il vient de nous donner.
Un aller-retour qui échoue est un contrat qui se contredit, quelle que soit la
raison.

⚠️ Le cas qui compte est celui où TOUT EST VIDE. Une fixture aux champs remplis
ne prouve rien : c'est l'absence de valeur — `''`, None, liste vide — qui met les
contrats en défaut, et c'est l'état le plus courant dans la vraie donnée.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.socle.auth import verify_token
from app.socle.perimetre import CHAMPS_REALISE
from app.main import app
from tests.chargeur_arbre import Arbre, load
from tests.fixtures_training import arbre_de_test

_AUTH = {"Authorization": "Bearer x"}


@pytest.fixture
def client(pg):
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('coach-1','a@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1')"))
    pg.execute(text(
        "INSERT INTO athletes (id, coach_uid, first_name, last_name) VALUES "
        "('11111111-1111-1111-1111-111111111111','coach-1','A','Un')"))
    pg.execute(text("INSERT INTO programs (id, coach_uid, athlete_id) VALUES "
                    "('p1','coach-1','11111111-1111-1111-1111-111111111111')"))
    load(pg, Arbre(macros=arbre_de_test("p1")))
    app.dependency_overrides[verify_token] = lambda: {"uid": "coach-1"}
    return TestClient(app)


@pytest.fixture
def vide(pg):
    """L'arbre DÉPOUILLÉ : ni nom, ni date, nulle part.

    C'est l'état que la vraie donnée porte le plus souvent — 54 blocs sur 125
    n'ont pas de date de S1, 13 seulement portent un nom — et celui qu'aucune
    fixture « réaliste » ne reproduit."""
    pg.execute(text("UPDATE training_macros SET name = NULL"))
    pg.execute(text("UPDATE training_blocks SET name = NULL, start_date = NULL, "
                    "end_date = NULL, s1_start_date = NULL, s1_end_date = NULL"))
    pg.execute(text("UPDATE training_weeks SET name = NULL, start_date = NULL, end_date = NULL"))
    # `training_sessions.name` est NOT NULL : le vide y est la chaîne vide, ce qui
    # est justement la valeur qu'un contrat trop strict refusait de relire.
    # `training_sessions.name` est NOT NULL : le vide y est la chaîne vide, ce qui
    # est justement la valeur qu'un contrat trop strict refusait de relire.
    pg.execute(text("UPDATE training_sessions SET name = '', session_date = NULL, "
                    "form_of_the_day = NULL"))
    # LES VOCABULAIRES AUSSI. Les oublier ici était l'angle mort de ce fichier :
    # la fixture leur laissait des valeurs valides, et le test passait au vert
    # pendant que 1 226 lignes réelles échouaient (516 sans `reps_unit`, 710 sans
    # `increment_unit`). Un test « sur tout ce qui est vide » doit vider TOUT.
    pg.execute(text("UPDATE training_exercises SET reps_unit = NULL, "
                    "increment_unit = NULL, kind = NULL, tier = NULL"))
    pg.execute(text("UPDATE training_base_principles SET reps_unit = NULL, "
                    "increment_unit = NULL, kind = NULL"))
    pg.execute(text("UPDATE training_base_accessories SET reps_unit = NULL, "
                    "increment_unit = NULL, kind = NULL"))
    return pg


def _arbre(client) -> dict:
    r = client.get("/programs/p1/training", headers=_AUTH)
    assert r.status_code == 200
    return r.json()["macros"][0]


def _garder(objet: dict, cles: tuple[str, ...]) -> dict:
    """Les seuls champs que le contrat d'écriture déclare — le reste (id,
    numéros, enfants) n'est pas à réécrire."""
    return {k: objet[k] for k in cles if k in objet}


def _echo(client, methode: str, url: str, corps: dict):
    r = getattr(client, methode)(f"/programs/p1{url}", headers=_AUTH, json=corps)
    assert r.status_code == 200, (
        f"{methode.upper()} {url} refuse l'écho de sa propre lecture "
        f"({r.status_code}) : {r.text[:300]}")


# --------------------------------------------------------------------------- #
# L'aller-retour, niveau par niveau, sur un arbre DÉPOUILLÉ
# --------------------------------------------------------------------------- #

def test_macro(client, vide):
    macro = _arbre(client)
    _echo(client, "patch", f"/macros/{macro['id']}",
          _garder(macro, ("name", "trainingFrequency", "coachNotes")))


def test_bloc(client, vide):
    bloc = _arbre(client)["blocks"][0]
    _echo(client, "patch", f"/blocks/{bloc['id']}",
          _garder(bloc, ("name", "startDate", "endDate")))


def test_semaine(client, vide):
    semaine = _arbre(client)["blocks"][0]["weeks"][0]
    _echo(client, "patch", f"/weeks/{semaine['id']}",
          _garder(semaine, ("name", "hidden", "startDate", "endDate")))


def test_seance(client, vide):
    seance = _arbre(client)["blocks"][0]["weeks"][0]["sessions"][0]
    # ⚠️ `formOfTheDay` EST DANS L'ÉCHO, et il n'y était pas.
    #
    # Ce test l'écartait sans dire pourquoi, et `verifier_contrats.py` faisait le
    # même oubli — si bien que le dernier champ à violer l'invariant était
    # invisible pour ses deux gardiens. La règle qu'on en tire : **un champ
    # dépouillé d'un écho doit l'être avec une raison écrite**, sinon c'est un
    # trou qu'on se cache à soi-même.
    _echo(client, "patch", f"/sessions/{seance['id']}",
          _garder(seance, ("name", "sessionDate", "formOfTheDay")))


def test_ligne_d_exercice(client, vide):
    semaine = _arbre(client)["blocks"][0]["weeks"][0]
    ligne = semaine["sessions"][0]["exercises"][0]
    _echo(client, "patch", f"/exercises/{ligne['id']}",
          {k: v for k, v in ligne.items() if k != "id"})


def test_base_du_bloc(client, vide):
    """LE cas qui a cassé : la trame d'un bloc sans date de S1.

    L'éditeur de BASE renvoie la base telle qu'il l'a lue ; servir `''` sur les
    dates la rendait non enregistrable sur 54 blocs."""
    bloc = _arbre(client)["blocks"][0]
    _echo(client, "put", f"/blocks/{bloc['id']}/base", {"base": bloc["base"]})


def test_base_avec_la_re_datation_des_semaines(client, vide):
    """La BASE part TOUJOURS avec `weekDates` depuis l'éditeur : régler S1 décale
    tout le bloc. Les dates y sont vides elles aussi."""
    bloc = _arbre(client)["blocks"][0]
    _echo(client, "put", f"/blocks/{bloc['id']}/base", {
        "base": bloc["base"],
        "weekDates": [{"weekId": w["id"], "startDate": w["startDate"],
                       "endDate": w["endDate"]} for w in bloc["weeks"]],
    })


def test_objectifs_du_bloc(client, vide):
    bloc = _arbre(client)["blocks"][0]
    client.put(f"/programs/p1/blocks/{bloc['id']}/objectives", headers=_AUTH,
               json={"objectives": [{"exercise": "SQUAT"}], "version": bloc["objectivesVersion"]})
    relu = _arbre(client)["blocks"][0]
    _echo(client, "put", f"/blocks/{bloc['id']}/objectives",
          {"objectives": [{k: v for k, v in o.items() if k != "id"} for o in relu["objectives"]],
           "version": relu["objectivesVersion"]})


def test_contenu_d_une_semaine(client, vide):
    """L'écho du contenu : séances et lignes telles que la lecture les rend.

    ⚠️ SUR UNE SEMAINE NEUVE ET VIDE (FRE-84). `PUT …/content` ne remplit plus
    qu'une semaine sans séance : c'est son seul usage réel — un bloc naît avec sa
    semaine 1 vide, la génération la remplit. Le test visait jusqu'ici la semaine
    déjà peuplée du décor, donc un chemin que la production n'emprunte pas."""
    modele = _arbre(client)["blocks"][0]["weeks"][0]
    bloc = _arbre(client)["blocks"][0]["id"]
    neuve = client.post(f"/programs/p1/blocks/{bloc}/weeks", headers=_AUTH,
                        json={"sessions": []}).json()["ids"]["week"]
    _echo(client, "put", f"/weeks/{neuve}/content",
          {"athlete": modele["athlete"], "sessions": modele["sessions"]})


def test_creer_une_semaine_a_partir_de_l_echo_d_une_autre(client, vide):
    """Le geste « ajouter une semaine » : le front copie la précédente et
    l'envoie. Ce qu'il envoie vient donc, encore une fois, de la lecture."""
    bloc = _arbre(client)["blocks"][0]
    modele = bloc["weeks"][0]
    r = client.post(f"/programs/p1/blocks/{bloc['id']}/weeks", headers=_AUTH, json={
        "athlete": modele["athlete"], "sessions": modele["sessions"],
        "name": modele["name"], "startDate": modele["startDate"],
        "endDate": modele["endDate"], "hidden": modele["hidden"],
    })
    assert r.status_code == 201, r.text


# --------------------------------------------------------------------------- #
# L'AUTRE MOITIÉ DE L'INVARIANT — ce qui est ÉCRIT doit se RELIRE
#
# Les tests ci-dessus vérifient que l'écriture ACCEPTE ce que la lecture rend :
# pas de 422. C'est nécessaire et insuffisant — une écriture peut accepter un
# champ puis le jeter, sans erreur ni journal.
#
# C'est exactement ce qui est arrivé le 17/08 : `_creer_bloc` acceptait la BASE
# entière et n'en écrivait que la configuration, laissant tomber les principes
# et les accessoires. Aucun 422, donc aucun test rouge, et un coach qui
# dupliquait un macro retrouvait une trame vide — après un délai, le temps que
# le refetch remplace son clone optimiste.
#
# On boucle donc dans l'autre sens : on ÉCRIT quelque chose de riche, on RELIT,
# et on exige l'égalité champ par champ. Un chemin de création qui perd une
# information est un chemin qui ment.
# --------------------------------------------------------------------------- #

_BASE_RICHE = {
    "daySplit": [{"day": "J1", "tiers": {"SQUAT": 1}},
                 {"day": "J4", "tiers": {"PULL UP": 2}}],
    "selectedPrincipaux": ["SQUAT", "PULL UP"],
    "granularity": {"SQUAT": "2,5"},
    "principles": [
        {"name": "SQUAT", "tier": 1, "variant": ["HIGH BAR"], "sets": "5",
         "reps": "5", "repsUnit": "count", "weight": "100", "aimedRPE": "8"},
        {"name": "PULL UP", "tier": 2, "variant": [], "sets": "4", "reps": "6"},
    ],
    "accessories": [
        {"name": "LEG RAISE", "day": "J1", "variant": [], "sets": "3", "reps": "12"},
    ],
}

_SEANCES_RICHES = [{
    "name": "Lundi",
    "formOfTheDay": 4,
    "exercises": [
        {"name": "SQUAT", "variant": ["PAUSE"], "tier": 1, "sets": "5", "reps": "3",
         "repsUnit": "count", "weight": "120", "aimedRPE": "8", "feltRPE": "8.5",
         "repsDone": "3", "weightDone": "122.5", "coachNote": "monte doucement"},
    ],
}]


def _perdus(envoye, relu, chemin="", ignorer=frozenset()):
    """Ce que l'écriture a laissé tomber. Rend une liste de reproches lisibles
    plutôt qu'un booléen : sur une structure imbriquée, savoir QUEL champ manque
    est tout l'intérêt.

    ⚠️ `ignorer` EXISTE POUR UNE SEULE EXCEPTION, et elle mérite d'être nommée :
    le RÉALISÉ ne se crée pas. Une charge réelle vit là où elle a été saisie et ne
    se duplique jamais avec la semaine (décision du 21/08) — donc la création la
    laisse tomber EXPRÈS, et l'invariant de ce fichier ne s'applique pas à elle.

    Aucune autre exception ne doit s'ajouter ici sans la même justification :
    « l'écriture accepte ce que sa lecture rend » est la règle, et chaque trou
    qu'on y perce est un endroit où le contrat peut se remettre à mentir."""
    manques = []
    if isinstance(envoye, dict):
        for cle, attendu in envoye.items():
            if cle in ignorer:
                continue
            if cle not in relu:
                manques.append(f"{chemin}.{cle} ABSENT")
            else:
                manques += _perdus(attendu, relu[cle], f"{chemin}.{cle}", ignorer)
    elif isinstance(envoye, list):
        if len(relu) != len(envoye):
            manques.append(f"{chemin} : {len(envoye)} envoyé(s), {len(relu)} relu(s)")
        else:
            for i, attendu in enumerate(envoye):
                manques += _perdus(attendu, relu[i], f"{chemin}[{i}]", ignorer)
    elif envoye != relu:
        manques.append(f"{chemin} : envoyé {envoye!r}, relu {relu!r}")
    return manques


def _creer(client, url: str, corps: dict) -> dict:
    r = client.post(f"/programs/p1{url}", headers=_AUTH, json=corps)
    assert r.status_code == 201, f"POST {url} → {r.status_code} : {r.text[:300]}"
    return r.json()["ids"]


def test_creer_un_macro_conserve_TOUTE_la_base(client):
    ids = _creer(client, "/macros", {"block": {"base": _BASE_RICHE, "week": {"name": "S1"}}})
    relu = next(b for m in client.get("/programs/p1/training", headers=_AUTH).json()["macros"]
                for b in m["blocks"] if b["id"] == ids["block"])
    assert _perdus(_BASE_RICHE, relu["base"], "base") == []


def test_creer_un_bloc_conserve_TOUTE_la_base(client):
    macro = _arbre(client)["id"]
    ids = _creer(client, f"/macros/{macro}/blocks", {"base": _BASE_RICHE})
    relu = next(b for m in client.get("/programs/p1/training", headers=_AUTH).json()["macros"]
                for b in m["blocks"] if b["id"] == ids["block"])
    assert _perdus(_BASE_RICHE, relu["base"], "base") == []


def test_creer_une_semaine_conserve_TOUT_son_contenu(client):
    """…TOUT, SAUF LE RÉALISÉ — et c'est la seule exception de ce fichier.

    Une charge réelle vit là où elle a été saisie et ne se duplique jamais avec la
    semaine (21/08). La création la laisse donc tomber EXPRÈS : ce qu'on crée n'a
    été fait par personne. L'assertion du bas le vérifie, pour que l'exception
    soit prouvée et pas seulement contournée."""
    bloc = _arbre(client)["blocks"][0]["id"]
    ids = _creer(client, f"/blocks/{bloc}/weeks", {"name": "Neuve", "sessions": _SEANCES_RICHES})
    relu = next(w for m in client.get("/programs/p1/training", headers=_AUTH).json()["macros"]
                for b in m["blocks"] for w in b["weeks"] if w["id"] == ids["week"])
    assert _perdus(_SEANCES_RICHES, relu["sessions"], "sessions", CHAMPS_REALISE) == []
    assert not any(relu["sessions"][0]["exercises"][0][c] for c in CHAMPS_REALISE), \
        "du réalisé a survécu à la création"


def test_remplacer_le_contenu_d_une_semaine_le_conserve(client):
    """Ce qui est ENVOYÉ doit se relire — l'invariant du fichier, sur le chemin
    le plus destructeur : les séances sont supprimées puis recréées.

    ⚠️ CE TEST A PORTÉ UNE SECONDE MOITIÉ, retirée le 2026-08-18. La semaine relue
    contenait alors AUSSI ce qu'on n'avait pas envoyé — les lignes `rehab` du
    kiné, que le serveur mettait de côté avant le remplacement et réinjectait
    après. Cette préservation n'existe plus : le kiné programme comme le coach, et
    un remplacement en bloc remplace tout, comme pour n'importe quelle ligne."""
    bloc = _arbre(client)["blocks"][0]["id"]
    # ⚠️ UNE SEMAINE VIDE, désormais le seul état que cette route accepte
    # (FRE-84) : elle détruisait les séances pour les recréer sans le réalisé.
    semaine = client.post(f"/programs/p1/blocks/{bloc}/weeks", headers=_AUTH,
                          json={"sessions": []}).json()["ids"]["week"]

    r = client.put(f"/programs/p1/weeks/{semaine}/content", headers=_AUTH,
                   json={"sessions": _SEANCES_RICHES})
    assert r.status_code == 200, r.text[:300]

    relu = next(w for m in client.get("/programs/p1/training", headers=_AUTH).json()["macros"]
                for b in m["blocks"] for w in b["weeks"] if w["id"] == semaine)
    # Même exception qu'à la création, et pour la même raison : ce chemin DÉTRUIT
    # les séances puis les recrée. Ce qui en sort est neuf, donc non réalisé.
    assert _perdus(_SEANCES_RICHES, relu["sessions"], "sessions", CHAMPS_REALISE) == []
    assert not any(relu["sessions"][0]["exercises"][0][c] for c in CHAMPS_REALISE), \
        "du réalisé a survécu au remplacement"


def test_remplacer_la_base_la_conserve(client):
    bloc = _arbre(client)["blocks"][0]["id"]
    r = client.put(f"/programs/p1/blocks/{bloc}/base", headers=_AUTH, json={"base": _BASE_RICHE})
    assert r.status_code == 200, r.text[:300]
    relu = next(b for m in client.get("/programs/p1/training", headers=_AUTH).json()["macros"]
                for b in m["blocks"] if b["id"] == bloc)
    assert _perdus(_BASE_RICHE, relu["base"], "base") == []
