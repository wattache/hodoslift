"""Lecture et administration des athlètes — contre un VRAI Postgres.

  - GET   /athletes            : annuaire, SANS email/linkedUserId/kineUid (PII),
    tout authentifié ;
  - GET   /athletes/mine       : coach_uid=uid OU user_uid=uid, admin compris, AVEC PII ;
  - PATCH /athletes/{id}/coach : réassignation (admin, cross-store Firestore) ;
  - PATCH /athletes/{id}/kine  : affectation du kiné (FRE-52), coach de l'athlète.

⚠️ PORTÉ depuis SQLite le 2026-08-17 (FRE-52). Le stub recopiait `athletes` en
quatorze colonnes sans une seule clé étrangère, `current_one_rm` y était du TEXT
là où la prod porte du jsonb, et l'en-tête reconnaissait que « le SQL réel [était]
vérifié à part en lecture contre Neon ». Cette vérification manuelle est ce que le
conteneur remplace.

Ce que le stub cachait, et que le port a rendu visible : `athletes.coach_uid` est
NOT NULL et référence `coaches(uid)` — les tests semaient des athlètes chez des
coachs qui n'existaient pas.
"""

import json

import pytest
from sqlalchemy import text

_AUTH = {"Authorization": "Bearer x"}

# Les tests désignent les athlètes par des noms lisibles ; `athletes.id` est un
# vrai uuid en Postgres (le stub acceptait la chaîne 'uuid-a1'). On traduit ici
# plutôt qu'à chaque appel, pour que les tests restent lisibles.
_UUIDS = {
    "uuid-a1": "aaaaaaaa-0000-0000-0000-000000000001",
    "uuid-a2": "aaaaaaaa-0000-0000-0000-000000000002",
    "uuid-a3": "aaaaaaaa-0000-0000-0000-000000000003",
}


@pytest.fixture
def sql(pg):
    """Les deux coachs de référence — et les `users` dont la FK `coaches` dépend.
    Presque tous les tests en ont besoin : un athlète a TOUJOURS un coach."""
    pg.execute(text("INSERT INTO users (uid, email) VALUES "
                    "('coach-1','c1@x.com'), ('coach-2','c2@x.com')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1'), ('coach-2')"))
    return pg


def _user(conn, uid, email=None):
    conn.execute(
        text("INSERT INTO users (uid, email) VALUES (:u, :e) ON CONFLICT (uid) DO NOTHING"),
        {"u": uid, "e": email or f"{uid}@x.com"})


def _admin(conn, uid):
    # is_admin lit Postgres (users.is_admin).
    conn.execute(
        text("INSERT INTO users (uid, email, is_admin) VALUES (:u, :u, true) "
             "ON CONFLICT (uid) DO UPDATE SET is_admin = true"),
        {"u": uid})


def _make_kine(conn, uid):
    _user(conn, uid)
    conn.execute(text("INSERT INTO kines (uid) VALUES (:u) ON CONFLICT DO NOTHING"), {"u": uid})


def _seed_athlete(conn, uuid, legacy, **cols):
    """⚠️ `user_uid` est une FK vers `users` : on crée le stub au passage, comme
    le fait `POST /athletes/link` en production."""
    user_uid = cols.get("user_uid")
    if user_uid:
        _user(conn, user_uid)
    conn.execute(
        # ⚠️ PLUS DE `photo_path` NI `photo_url` (FRE-80). Ce semis les écrivait
        # encore alors que Neon les a perdues le 20/08 — il ne passait que parce
        # que `docs/postgres-schema.sql`, dont ce test construit sa base, les
        # déclarait toujours. Le harnais écrivait donc dans des colonnes qui
        # n'existent PAS en production, et personne ne pouvait le voir : c'est
        # tout le sujet du ticket, et c'est en réconciliant le fichier que ces
        # 46 tests sont enfin tombés.
        text("INSERT INTO athletes (id, legacy_id, first_name, last_name, email, height_cm, "
             "weight_kg, birth_date, gender, coach_uid, user_uid, current_one_rm, kine_uid) "
             "VALUES (CAST(:id AS uuid), :legacy, :fn, :ln, :email, :h, :w, CAST(:bd AS date), "
             "CAST(:gender AS gender), :coach, :user, CAST(:orm AS jsonb), :kine)"),
        {
            "id": _UUIDS.get(uuid, uuid), "legacy": legacy,
            "fn": cols.get("first_name", ""), "ln": cols.get("last_name", ""),
            "email": cols.get("email"), "h": cols.get("height_cm"), "w": cols.get("weight_kg"),
            "bd": cols.get("birth_date"), "gender": cols.get("gender"),
            "coach": cols.get("coach_uid", "coach-1"), "user": user_uid,
            "orm": json.dumps(cols["current_one_rm"]) if cols.get("current_one_rm") is not None else None,
            "kine": cols.get("kine_uid"),
        })


def _seed_program(conn, program_id, athlete_uuid):
    conn.execute(
        text("INSERT INTO programs (id, athlete_id, coach_uid) "
             "VALUES (:p, CAST(:a AS uuid), 'coach-1')"),
        {"p": program_id, "a": _UUIDS.get(athlete_uuid, athlete_uuid)})


def _val(conn, legacy, col):
    return conn.execute(
        text(f"SELECT {col} FROM athletes WHERE legacy_id = :l"), {"l": legacy}).scalar()


def _by_id(body):
    return {a["id"]: a for a in body}


def _seed_two_coaches(engine):
    _seed_athlete(engine, "uuid-a1", "a1", first_name="A", coach_uid="coach-1",
                  user_uid="user-a1", email="a1@x.com")
    _seed_athlete(engine, "uuid-a2", "a2", first_name="B", coach_uid="coach-2",
                  user_uid="user-a2", email="a2@x.com")


# --------------------------------------------------------------------------- #
# GET /athletes/mine — mes athlètes (AVEC PII, filtré)
# --------------------------------------------------------------------------- #


def test_mine_coach_ne_voit_que_les_siens_avec_pii(auth_as, sql):
    _seed_two_coaches(sql)  # a1 → coach-1, a2 → coach-2
    body = auth_as(uid="coach-1").get("/athletes/mine", headers=_AUTH).json()
    assert [a["id"] for a in body] == ["a1"]  # PAS a2 (autre coach)
    # PII présente
    assert body[0]["email"] == "a1@x.com"
    assert body[0]["linkedUserId"] == "user-a1"


def test_mine_athlete_voit_son_record(auth_as, sql):
    _seed_two_coaches(sql)
    # l'athlète lié (user_uid=user-a2) voit SON propre record via user_uid=uid
    body = auth_as(uid="user-a2").get("/athletes/mine", headers=_AUTH).json()
    assert [a["id"] for a in body] == ["a2"]
    assert body[0]["email"] == "a2@x.com"


def test_mine_l_admin_ne_recoit_que_SES_fiches(auth_as, sql):
    """⚠️ LE LIEN, PAS LE RÔLE (FRE-190). Cette spec affirmait l'inverse : « admin →
    tous ». Le sélecteur d'athlète lit `/mine`, et lui proposer une fiche qu'il ne
    coache pas menait à un 403 sur le programme. L'admin qui ne coache personne
    reçoit une liste vide ; toutes les fiches, il les lit par l'annuaire.

    MUTATION QUI ROUGIT : remettre la branche `is_admin` → `mine_all`."""
    _seed_two_coaches(sql)
    _admin(sql, "boss")
    assert auth_as(uid="boss").get("/athletes/mine", headers=_AUTH).json() == []


def test_mine_intrus_liste_vide(auth_as, sql):
    _seed_two_coaches(sql)
    # ni coach ni athlète lié, pas admin → ne gère personne → liste vide
    body = auth_as(uid="intrus").get("/athletes/mine", headers=_AUTH).json()
    assert body == []


def test_AthletePublic_porte_TOUS_ses_champs(auth_as, sql):
    """⚠️ LE GARDE-FOU DU `response_model` (FRE-70), écrit AVANT le modèle.

    Déclarer un modèle de sortie FILTRE la réponse : un champ absent du modèle
    disparaît en silence, sans erreur ni journal — le front reçoit `undefined` et
    l'écran se vide. Aucune autre spec de ce fichier ne verrait un tel oubli :
    elles affirment `id`, `email`, `linkedUserId`, jamais l'ensemble.

    ⚠️ ELLE PASSAIT PAR L'ANNUAIRE, SUPPRIMÉ LE 30/08 — et c'était le piège de
    cette suppression : trois specs se servaient de cette route morte pour garder
    les routes VIVANTES. Retirer l'annuaire sans les rebrancher aurait emporté la
    garde en silence, ce qui est exactement le défaut qu'elle protège.

    `/suivis` rend le MÊME modèle : la garde change de porte, pas de sujet."""
    _make_kine(sql, "kine-1")
    _seed_athlete(sql, "uuid-a1", "a1", first_name="Bob", coach_uid="coach-1",
                  user_uid="user-1", email="bob@x.com", kine_uid="kine-1")
    a = auth_as(uid="kine-1").get("/athletes/suivis", headers=_AUTH).json()[0]
    assert set(a) == {
        "id", "firstName", "lastName", "gender", "height", "weight", "age",
        "coachId", "programId", "currentOneRM",
    }


def test_mine_partage_le_mapping_PUBLIC(auth_as, sql):
    """/mine = mapping public + exactement 6 clés en plus (email, linkedUserId,
    kineUid, archiveLe, birthDate, supportJusquAu).

    ⚠️ L'ÉGALITÉ EST LE TEST, pas une commodité. Cette assertion a rattrapé
    l'ajout de `kineUid` : toute clé qui apparaît dans /mine doit être décidée
    ici, sinon la frontière public/PII se déplace sans que personne ne le voie —
    et « cet athlète est suivi par un kiné » est une information de santé.

    Comparée à `/suivis` depuis le 30/08, l'annuaire ayant été supprimé."""
    _make_kine(sql, "kine-1")
    _seed_athlete(sql, "uuid-a1", "a1", first_name="Bob", coach_uid="coach-1",
                  user_uid="user-1", email="bob@x.com", kine_uid="kine-1")
    mine = auth_as(uid="coach-1").get("/athletes/mine", headers=_AUTH).json()[0]
    public = auth_as(uid="kine-1").get("/athletes/suivis", headers=_AUTH).json()[0]
    # ⚠️ `archiveLe` REJOINT LA LISTE DÉLIBÉRÉMENT (FRE-127), et cette assertion
    # l'a exigé. « Cet athlète a suspendu son coaching » est un fait de la
    # relation coach-athlète, comme `kineUid` : il appartient à l'athlète, à son
    # coach et à un admin — pas à la communauté.
    #
    # ⚠️ `birthDate` AUSSI (FRE-168) : plus intime qu'un âge, elle reste du côté
    # du coach ; le kiné reçoit l'âge qui s'en déduit, calculé par brokkr.
    #
    # ⚠️ `supportJusquAu` (FRE-202) ne dit rien de l'athlète : c'est l'accès support
    # en cours DE L'APPELANT sur lui. Elle n'a pas de sens pour un kiné qui suit.
    assert set(mine) - set(public) == {"email", "linkedUserId", "kineUid", "archiveLe", "birthDate",
                                       "supportJusquAu"}
    # les clés communes ont les mêmes valeurs
    assert {k: mine[k] for k in public} == public


def test_le_modele_PUBLIC_ne_dit_PAS_qui_est_suivi_par_un_kine(auth_as, sql):
    """« En suivi kiné » est une information de santé : elle appartient à
    l'athlète, à son coach et à un admin — elle n'a rien à faire dans le modèle
    public, quelle que soit la route qui le sert."""
    _make_kine(sql, "kine-1")
    _seed_athlete(sql, "uuid-a1", "a1", coach_uid="coach-1", kine_uid="kine-1")
    suivis = auth_as(uid="kine-1").get("/athletes/suivis", headers=_AUTH).json()
    assert suivis and all("kineUid" not in a for a in suivis)


def test_mine_rend_le_kine_a_son_coach_et_a_l_athlete(auth_as, sql):
    _make_kine(sql, "kine-1")
    _seed_athlete(sql, "uuid-a1", "a1", coach_uid="coach-1", user_uid="user-a1",
                  kine_uid="kine-1")
    for uid in ("coach-1", "user-a1"):
        body = auth_as(uid=uid).get("/athletes/mine", headers=_AUTH).json()
        assert [a["kineUid"] for a in body] == ["kine-1"], uid


def test_mine_rend_kineUid_null_sans_suivi(auth_as, sql):
    """L'état de TOUS les athlètes au déploiement : la clé est présente et vaut
    null, elle ne disparaît pas."""
    _seed_athlete(sql, "uuid-a1", "a1", coach_uid="coach-1")
    body = auth_as(uid="coach-1").get("/athletes/mine", headers=_AUTH).json()
    assert body[0]["kineUid"] is None


# --------------------------------------------------------------------------- #
# POST /athletes — création (coach-only)
#
# ⚠️ CETTE ROUTE N'AVAIT AUCUN TEST, et c'est ce qui a laissé passer le trou du
# 25/08 : l'unique bouton de l'app vivait derrière `isAdmin` alors que le serveur
# ne demande que `require_coach`, donc un coach non-admin ne pouvait pas ajouter
# d'athlète. Personne ne pouvait voir l'écart, parce que rien n'écrivait
# noir sur blanc À QUI cette route est ouverte.
# --------------------------------------------------------------------------- #


def test_creation_rattache_l_athlete_AU_COACH_QUI_CREE(auth_as, sql):
    """C'est l'invariant qui rend le geste utile au coach : il n'a RIEN à
    réassigner ensuite. `coach_uid` vient du jeton, jamais du corps."""
    r = auth_as(uid="coach-2").post(
        "/athletes", json={"firstName": "Camille", "email": "camille@x.com"}, headers=_AUTH)
    assert r.status_code == 200, r.text
    cree = r.json()

    assert _val(sql, cree["id"], "coach_uid") == "coach-2"
    assert _val(sql, cree["id"], "first_name") == "Camille"
    # L'email n'est pas un contact : c'est la CLÉ que `POST /athletes/link`
    # rapproche à la première connexion de l'athlète.
    assert _val(sql, cree["id"], "email") == "camille@x.com"

    # Le pointeur programme naît avec la fiche, chez le même coach — sans lui,
    # l'athlète existe mais n'a aucun arbre d'entraînement où écrire.
    prog = sql.execute(
        text("SELECT coach_uid, athlete_id FROM programs WHERE id = :p"),
        {"p": cree["programId"]}).mappings().first()
    assert prog is not None
    assert prog["coach_uid"] == "coach-2"
    assert str(prog["athlete_id"]) == str(
        sql.execute(text("SELECT id FROM athletes WHERE legacy_id = :l"),
                    {"l": cree["id"]}).scalar())


def test_creation_UNE_FICHE_NEUVE_N_A_AUCUN_1RM(auth_as, sql):
    """⚠️ LA DEMI-RÈGLE DE FRE-137, TROUVÉE PAR `make invariants` SUR LA PRODUCTION.

    Le lot 5 a retiré les 122 clés de 1RM à zéro et posé le robinet sur le PATCH
    (`_mesure_ou_absence`) — mais la CRÉATION écrivait un gabarit des cinq clés
    à `0`. Le premier athlète créé après la migration (12/09, 09:26) est reparti
    avec quatre zéros, et un PATCH partiel ne les efface jamais : il ne
    transporte que la clé touchée.

    « Appliquée à la création et pas à la suppression, à l'écriture et pas à la
    lecture » — c'est la faute que CLAUDE.md nomme, et elle s'est rejouée trois
    heures après le déploiement qui prétendait la clore.

    Un 1RM non renseigné n'a PAS de clé : c'est ce que l'invariant
    `pas_de_mesure_a_zero` affirme, et le front lit déjà des fiches à trois clés.
    """
    cree = auth_as(uid="coach-2").post(
        "/athletes", json={"firstName": "Loan", "email": "loan@x.com"}, headers=_AUTH).json()

    orm = _val(sql, cree["id"], "current_one_rm")
    if isinstance(orm, str):  # SQLite stocke du texte
        orm = json.loads(orm)
    assert orm == {}, f"une fiche neuve part avec des 1RM à zéro : {orm}"


def test_creation_UN_ADMIN_QUI_N_EST_PAS_COACH_est_refusé(auth_as, sql):
    """⚠️ LE TEST QUI DIT POURQUOI LA GARDE DU FRONT DOIT ÊTRE `isCoach`.
    `is_coach` (une ligne dans `coaches`) et `is_admin` (`users.is_admin`) sont
    INDÉPENDANTS : le titre d'admin n'ouvre pas cette route. Un écran qui
    afficherait le bouton sur `isAdmin` promettrait donc un geste que le serveur
    refuse — c'est exactement ce que l'ancienne vue Admin faisait."""
    _admin(sql, "boss")
    r = auth_as(uid="boss").post(
        "/athletes", json={"firstName": "Noa", "email": "noa@x.com"}, headers=_AUTH)
    assert r.status_code == 403
    assert r.json()["code"] == "reserve_aux_coachs"
    assert sql.execute(text("SELECT count(*) FROM athletes")).scalar() == 0


# --------------------------------------------------------------------------- #
# PATCH /athletes/{id}/coach — réassignation (admin-only, cross-store)
# --------------------------------------------------------------------------- #


def _seed_coaches(conn, *uids):
    """Idempotent : la fixture sème déjà coach-1 et coach-2."""
    for u in uids:
        _user(conn, u)
        conn.execute(text("INSERT INTO coaches (uid) VALUES (:u) ON CONFLICT DO NOTHING"),
                     {"u": u})


def test_reassign_deplace_athlete_ET_ses_programmes(auth_as, sql):
    _seed_athlete(sql, "uuid-a1", "a1", coach_uid="coach-1")
    _seed_program(sql, "prog-1", "uuid-a1")
    _seed_coaches(sql, "coach-1", "coach-2")
    _admin(sql,"boss")
    r = auth_as(uid="boss").patch("/athletes/a1/coach", json={"coachUid": "coach-2"}, headers=_AUTH)
    assert r.status_code == 200
    assert r.json() == {"ok": True, "programIds": ["prog-1"]}
    assert _val(sql, "a1", "coach_uid") == "coach-2"
    assert sql.execute(text("SELECT coach_uid FROM programs WHERE id='prog-1'")).scalar() == "coach-2"
    # ⚠️ PLUS AUCUNE ÉCRITURE CROISÉE VERS FIRESTORE. Ce test l'affirmait ici en
    # relisant un faux magasin ; la garde est désormais GLOBALE et bien plus
    # forte — `firestore.client()` LÈVE (conftest), donc aucune ligne de tout le
    # produit ne peut y toucher sans faire rougir la suite entière.


def test_reassign_non_admin_403(auth_as, sql):
    _seed_athlete(sql, "uuid-a1", "a1", coach_uid="coach-1")
    _seed_coaches(sql, "coach-2")
    r = auth_as(uid="coach-1").patch("/athletes/a1/coach", json={"coachUid": "coach-2"}, headers=_AUTH)
    assert r.status_code == 403
    assert _val(sql, "a1", "coach_uid") == "coach-1"   # inchangé


def test_reassign_coach_cible_inconnu_400(auth_as, sql):
    _seed_athlete(sql, "uuid-a1", "a1", coach_uid="coach-1")
    _admin(sql,"boss")
    r = auth_as(uid="boss").patch("/athletes/a1/coach", json={"coachUid": "ghost"}, headers=_AUTH)
    assert r.status_code == 400  # coach pas encore en base (resync identité requis)


def test_reassign_athlete_inconnu_404(auth_as, sql):
    _seed_coaches(sql, "coach-2")
    _admin(sql,"boss")
    r = auth_as(uid="boss").patch("/athletes/zzz/coach", json={"coachUid": "coach-2"}, headers=_AUTH)
    assert r.status_code == 404


# --------------------------------------------------------------------------- #
# POST /athletes/link — auto-linking (verify_token seul, cross-store)
# --------------------------------------------------------------------------- #


def test_link_rattache_athlete_non_lie(auth_as, sql):
    _seed_athlete(sql, "uuid-a1", "a1", email="bob@x.com")  # user_uid NULL
    # email du token en MAJUSCULES → matche via lower() (insensible à la casse)
    r = auth_as(uid="new-user", email="BOB@X.COM", email_verified=True).post("/athletes/link", headers=_AUTH)
    assert r.status_code == 200
    assert r.json() == {"linked": True, "athleteId": "a1", "motif": None}
    assert _val(sql, "a1", "user_uid") == "new-user"
    # La liaison ne touche QUE Postgres : le doc Firestore qu'on alignait ici
    # servait les règles Storage des photos d'athlètes, qui n'existent plus.
    # (Garde globale : `firestore.client()` lève — cf. conftest.)


def test_link_pas_de_hijack_si_deja_lie(auth_as, sql):
    """⚠️ LE REFUS EST JUSTE, MAIS IL DOIT SE NOMMER (FRE-76). Cette garde protège
    un athlète contre qui prouverait posséder son adresse — elle reste. Ce qui
    change, c'est que la réponse dit désormais LAQUELLE des deux situations elle
    décrit : ici une fiche existe et appartient à quelqu'un d'autre, ce qui n'a
    rien à voir avec « ton coach ne t'a pas enregistré »."""
    _seed_athlete(sql, "uuid-a1", "a1", email="bob@x.com", user_uid="ancien-user")
    r = auth_as(uid="pirate", email="bob@x.com", email_verified=True).post("/athletes/link", headers=_AUTH)
    assert r.status_code == 200
    assert r.json() == {"linked": False, "athleteId": None, "motif": "fiche_deja_liee"}
    assert _val(sql, "a1", "user_uid") == "ancien-user"   # pas de hijack


def test_link_aucun_athlete_pour_cet_email(auth_as, sql):
    _seed_athlete(sql, "uuid-a1", "a1", email="bob@x.com")
    r = auth_as(uid="coach-pur", email="autre@x.com", email_verified=True).post("/athletes/link", headers=_AUTH)
    assert r.status_code == 200
    # Personne ne porte cette adresse — le seul cas où « ton coach ne t'a pas
    # encore enregistré » est vrai.
    assert r.json() == {"linked": False, "athleteId": None, "motif": "aucune_fiche"}


def test_link_dit_POURQUOI_il_refuse(auth_as, sql):
    """⚠️ CE QUI RESTE DE FRE-76, ET C'EN ÉTAIT L'ESSENTIEL.

    Un athlète dont l'uid Firebase change — compte Google recréé, second compte,
    autre fournisseur — voit sa fiche rester accrochée à l'ancien uid.
    `/athletes/link` refuse alors, à juste titre : c'est la garde
    anti-usurpation, sans laquelle quiconque prouve posséder l'adresse d'un
    athlète prendrait sa place.

    Le défaut n'était pas le refus, c'était son MUTISME : l'écran servait « ton
    coach ne t'a pas encore enregistré », qui accusait le coach à tort. Le motif
    distingue désormais les deux situations.

    ⚠️ LA SORTIE, ELLE, N'EST PLUS UNE ROUTE (FRE-131). `DELETE /link` la
    fournissait, et fournissait aussi l'étape 0 d'une prise de contrôle par le
    coach. Zéro appel en 30 jours, aucun bouton depuis le 22/08 : le
    détachement redevient un UPDATE en base, fait à la main — ce que le front
    annonce déjà. La spec le joue tel quel, pour vérifier que la REPRISE tient
    toujours une fois la fiche libérée."""
    _seed_athlete(sql, "uuid-a1", "a1", email="bob@x.com",
                  coach_uid="coach-1", user_uid="ancien-user")

    # 1. L'impasse : le nouvel uid de Bob est refusé, mais le refus se NOMME.
    bloque = auth_as(uid="bob-v2", email="bob@x.com", email_verified=True).post(
        "/athletes/link", headers=_AUTH)
    assert bloque.json()["motif"] == "fiche_deja_liee"

    # 2. La sortie, à la main — le geste qu'on fait désormais en base.
    sql.execute(text("UPDATE athletes SET user_uid = NULL WHERE legacy_id = 'a1'"))

    # 3. Bob se rattache SEUL à sa connexion suivante : le chemin normal reprend,
    #    on n'a rien de spécial à lui faire faire.
    reprise = auth_as(uid="bob-v2", email="bob@x.com", email_verified=True).post(
        "/athletes/link", headers=_AUTH)
    assert reprise.json() == {"linked": True, "athleteId": "a1", "motif": None}
    assert _val(sql, "a1", "user_uid") == "bob-v2"


def test_la_route_de_detachement_N_EXISTE_PLUS(auth_as, sql):
    """⚠️ QUATRE SPECS ONT DISPARU AVEC ELLE, ET C'EST LE SUJET (FRE-131).

    `DELETE /athletes/{id}/link` détachait le compte d'une fiche. Ouverte au
    coach, elle était l'ÉTAPE 0 d'une prise de contrôle : détacher, écrire son
    adresse sur une fiche redevenue libre, se rattacher — et lire les bilans
    kiné. Le gel de l'email ferme la deuxième étape ; celle-ci ferme la
    première, définitivement.

    La passer en admin aurait suffi. La MESURE a dit de la supprimer : zéro
    appel en 30 jours de journaux, contre 119 DELETE sur d'autres routes sur la
    même période — le relevé les voit donc bien. Aucun bouton depuis le 22/08,
    et le seul admin ignorait qu'elle existait.

    Cette spec-ci reste pour une raison : un 405 prouve que la route est PARTIE,
    là où sa simple absence du fichier ne prouve rien — un décorateur recopié
    ailleurs la ferait revenir sans que rien ne rougisse."""
    _seed_athlete(sql, "uuid-a1", "a1", email="bob@x.com",
                  coach_uid="coach-1", user_uid="bob")
    _admin(sql, "patron")
    r = auth_as(uid="patron").delete("/athletes/a1/link", headers=_AUTH)

    # ⚠️ 404 `route_introuvable`, ET PAS `athlete_introuvable` — la nuance est
    # justement ce que le vocabulaire d'erreurs sert à dire. Aucun verbe ne
    # subsiste sur ce chemin (`POST /athletes/link` est une autre URL, sans
    # `{athlete_id}`), donc c'est l'ADRESSE qui n'existe pas, pas la fiche.
    # Attendre `athlete_introuvable` ici passerait au vert sur une route encore
    # en place qui ne trouve pas l'athlète.
    assert r.status_code == 404
    assert r.json()["code"] == "route_introuvable"
    assert _val(sql, "a1", "user_uid") == "bob"


def test_link_email_non_verifie_refuse(auth_as, sql):
    _seed_athlete(sql, "uuid-a1", "a1", email="bob@x.com")
    r = auth_as(uid="u", email="bob@x.com", email_verified=False).post("/athletes/link", headers=_AUTH)
    assert r.status_code == 403
    assert _val(sql, "a1", "user_uid") is None          # rien lié


def test_link_refuse_un_jeton_SANS_LA_CLAIM(auth_as, sql):
    """⚠️ LE CAS QUE LA GARDE D'ORIGINE LAISSAIT PASSER (FRE-131).

    Elle s'écrivait « si le token porte `email_verified`, l'exiger vrai » : un
    jeton SANS la claim traversait. Or c'est LUI le cas dangereux — on ne sait
    alors rien de l'adresse, et cette adresse est la clé qui décide de la
    propriété de la fiche, donc de l'accès aux bilans. « Absent » se lisait
    comme « prouvé ».

    Un fournisseur qui ne dit rien de l'email ne le prouve pas."""
    _seed_athlete(sql, "uuid-a1", "a1", email="bob@x.com")
    r = auth_as(uid="u", email="bob@x.com").post("/athletes/link", headers=_AUTH)   # aucune claim
    assert r.status_code == 403
    assert r.json()["code"] == "email_non_verifie"
    assert _val(sql, "a1", "user_uid") is None


def test_link_email_verifie_true_ok(auth_as, sql):
    _seed_athlete(sql, "uuid-a1", "a1", email="bob@x.com")
    r = auth_as(uid="u", email="bob@x.com", email_verified=True).post("/athletes/link", headers=_AUTH)
    assert r.json() == {"linked": True, "athleteId": "a1", "motif": None}


def test_link_token_sans_email(auth_as, sql):
    # token sans email (ex. auth téléphone) → rien à rapprocher, pas d'erreur
    _seed_athlete(sql, "uuid-a1", "a1", email="bob@x.com")
    r = auth_as(uid="u", email="", email_verified=True).post("/athletes/link", headers=_AUTH)
    assert r.status_code == 200
    assert r.json() == {"linked": False, "athleteId": None, "motif": "aucune_fiche"}


def test_link_uid_neuf_cree_le_stub_users(auth_as, sql):
    _seed_athlete(sql, "uuid-a1", "a1", email="bob@x.com")  # aucun users seedé
    r = auth_as(uid="newbie", email="bob@x.com", email_verified=True).post("/athletes/link", headers=_AUTH)
    assert r.json() == {"linked": True, "athleteId": "a1", "motif": None}
    # stub users créé (uid, email) — FK athletes.user_uid satisfaite
    u = sql.execute(text("SELECT email, is_admin FROM users WHERE uid='newbie'")).mappings().first()
    assert dict(u) == {"email": "bob@x.com", "is_admin": False}  # défauts appliqués


def test_link_uid_existant_ne_clobbe_pas_la_ligne_users(auth_as, sql):
    # ligne ETL préexistante (is_admin=1, displayName) — NE DOIT PAS être écrasée.
    sql.execute(text(
        "INSERT INTO users (uid, email, display_name, is_admin) "
        "VALUES ('coach-etl', 'coach@x.com', 'Boss', true)"))
    _seed_athlete(sql, "uuid-a1", "a1", email="coach@x.com")  # athlète de contact au même email
    r = auth_as(uid="coach-etl", email="coach@x.com", email_verified=True).post("/athletes/link", headers=_AUTH)
    assert r.json() == {"linked": True, "athleteId": "a1", "motif": None}  # le lien se fait quand même
    u = sql.execute(text("SELECT display_name, is_admin FROM users WHERE uid='coach-etl'")).mappings().first()
    assert dict(u) == {"display_name": "Boss", "is_admin": True}  # ON CONFLICT DO NOTHING : intacte


# --------------------------------------------------------------------------- #
# helper
# --------------------------------------------------------------------------- #


def test_one_rm_helper_toutes_formes():
    from app.personnes.metier_athletes import _one_rm

    assert _one_rm(None) == {}
    assert _one_rm({"squat": 100}) == {"squat": 100}  # dict jsonb (Postgres)
    assert _one_rm('{"squat": 90}') == {"squat": 90}  # texte JSON (SQLite)
    assert _one_rm("pas du json") == {}  # invalide → {}


# --------------------------------------------------------------------------- #
# PATCH /athletes/{id}/kine — affectation du kiné (FRE-52)
#
# DEUX GESTES DISTINCTS, et c'est volontaire : l'admin POSE le rôle
# (`PUT /users/{uid}/kine`, « cette personne est kiné »), le COACH fait le LIEN
# (« ce kiné suit cet athlète »). Ni le kiné (on ne se donne pas ses propres
# patients), ni l'athlète.
# --------------------------------------------------------------------------- #


def test_le_coach_affecte_un_kine_a_son_athlete(auth_as, sql):
    _make_kine(sql, "kine-1")
    _seed_athlete(sql, "uuid-a1", "a1", coach_uid="coach-1")
    r = auth_as(uid="coach-1").patch(
        "/athletes/a1/kine", json={"kineUid": "kine-1"}, headers=_AUTH)
    assert r.status_code == 200
    assert r.json() == {"ok": True, "kineUid": "kine-1"}
    assert _val(sql, "a1", "kine_uid") == "kine-1"


def test_null_DETACHE_le_kine(auth_as, sql):
    """Détacher est un état NORMAL, pas une erreur : la plupart des athlètes
    n'ont pas de kiné, et un suivi se termine."""
    _make_kine(sql, "kine-1")
    _seed_athlete(sql, "uuid-a1", "a1", coach_uid="coach-1", kine_uid="kine-1")
    r = auth_as(uid="coach-1").patch("/athletes/a1/kine", json={"kineUid": None}, headers=_AUTH)
    assert r.status_code == 200
    assert r.json() == {"ok": True, "kineUid": None}
    assert _val(sql, "a1", "kine_uid") is None


def test_la_chaine_VIDE_detache_aussi(auth_as, sql):
    """`vide_en_none` — la règle qui ferme une famille entière de défauts. Un
    champ `text` nullable se lit `''` (convention de tout l'arbre : un champ
    contrôlé de React qui reçoit `null` casse la saisie), donc `''` doit être
    accepté à l'écriture. Sans ça, l'écriture refuserait ce que sa lecture rend
    — l'incident du 11/08, celui du 15/08, cinq passes de revue. On ferme la
    porte AVANT de l'ouvrir."""
    _make_kine(sql, "kine-1")
    _seed_athlete(sql, "uuid-a1", "a1", coach_uid="coach-1", kine_uid="kine-1")
    r = auth_as(uid="coach-1").patch("/athletes/a1/kine", json={"kineUid": ""}, headers=_AUTH)
    assert r.status_code == 200, r.text
    assert _val(sql, "a1", "kine_uid") is None


def test_l_athlete_d_un_AUTRE_coach_est_introuvable_404(auth_as, sql):
    """404 et NON 403 : le coach d'à côté n'apprend pas que cet athlète existe.
    C'est la convention du module d'écriture de l'arbre, et « qui suit qui » est
    précisément ce qu'on ne confirme pas par la bande."""
    _make_kine(sql, "kine-1")
    _seed_athlete(sql, "uuid-a2", "a2", coach_uid="coach-2")
    r = auth_as(uid="coach-1").patch(
        "/athletes/a2/kine", json={"kineUid": "kine-1"}, headers=_AUTH)
    assert r.status_code == 404
    assert _val(sql, "a2", "kine_uid") is None       # et rien n'a été écrit


def test_un_uid_qui_n_est_pas_kine_422(auth_as, sql):
    """422 explicite, et pas l'IntegrityError de la FK — celle-ci donnerait un
    500 doublé d'une transaction perdue. Le refus doit être lisible."""
    _user(sql, "simple-user")
    _seed_athlete(sql, "uuid-a1", "a1", coach_uid="coach-1")
    r = auth_as(uid="coach-1").patch(
        "/athletes/a1/kine", json={"kineUid": "simple-user"}, headers=_AUTH)
    assert r.status_code == 422
    assert _val(sql, "a1", "kine_uid") is None


def test_un_uid_inexistant_422(auth_as, sql):
    _seed_athlete(sql, "uuid-a1", "a1", coach_uid="coach-1")
    r = auth_as(uid="coach-1").patch(
        "/athletes/a1/kine", json={"kineUid": "fantome"}, headers=_AUTH)
    assert r.status_code == 422
    assert _val(sql, "a1", "kine_uid") is None


def test_l_appartenance_passe_AVANT_la_validite_du_kine(auth_as, sql):
    """L'ordre de FRE-43, appliqué ici. Un coach visant l'athlète d'un confrère
    avec un uid bidon doit recevoir 404 (« pas ton athlète »), pas 422 (« cet uid
    n'est pas kiné ») — sinon il apprend par élimination quels uids SONT kinés,
    en tapant sur un athlète qui ne lui appartient pas."""
    _seed_athlete(sql, "uuid-a2", "a2", coach_uid="coach-2")
    r = auth_as(uid="coach-1").patch(
        "/athletes/a2/kine", json={"kineUid": "fantome"}, headers=_AUTH)
    assert r.status_code == 404


def test_l_athlete_ne_choisit_pas_son_kine_403(auth_as, sql):
    """`require_coach` : l'athlète n'est pas coach, il est refusé avant tout."""
    _make_kine(sql, "kine-1")
    _seed_athlete(sql, "uuid-a1", "a1", coach_uid="coach-1", user_uid="user-a1")
    r = auth_as(uid="user-a1").patch(
        "/athletes/a1/kine", json={"kineUid": "kine-1"}, headers=_AUTH)
    assert r.status_code == 403
    assert _val(sql, "a1", "kine_uid") is None


def test_le_kine_ne_se_donne_pas_ses_propres_patients(auth_as, sql):
    """LE cas qui dit pourquoi cette route est réservée au coach. Un kiné déclaré
    n'est pas coach : il ne peut pas s'affecter à qui il veut."""
    _make_kine(sql, "kine-1")
    _seed_athlete(sql, "uuid-a1", "a1", coach_uid="coach-1")
    r = auth_as(uid="kine-1").patch(
        "/athletes/a1/kine", json={"kineUid": "kine-1"}, headers=_AUTH)
    assert r.status_code == 403
    assert _val(sql, "a1", "kine_uid") is None


def test_un_champ_inconnu_est_refuse_422(auth_as, sql):
    """Contrat NEUF : `extra="forbid"` dès le premier jour."""
    _make_kine(sql, "kine-1")
    _seed_athlete(sql, "uuid-a1", "a1", coach_uid="coach-1")
    r = auth_as(uid="coach-1").patch(
        "/athletes/a1/kine", json={"kineUid": "kine-1", "coachUid": "coach-2"}, headers=_AUTH)
    assert r.status_code == 422
    assert _val(sql, "a1", "kine_uid") is None


def test_aller_retour_du_kine(auth_as, sql):
    """L'ALLER-RETOUR D'ÉCHO, dès le premier jour de la route : ce que
    `/athletes/mine` rend sur `kineUid`, le PATCH doit l'accepter tel quel — et
    dans les DEUX états, affecté et détaché. C'est l'état VIDE qui met les
    contrats en défaut, jamais celui qui est rempli."""
    _make_kine(sql, "kine-1")
    _seed_athlete(sql, "uuid-a1", "a1", coach_uid="coach-1")
    c = auth_as(uid="coach-1")

    for attendu in (None, "kine-1"):
        if attendu:
            c.patch("/athletes/a1/kine", json={"kineUid": attendu}, headers=_AUTH)
        lu = c.get("/athletes/mine", headers=_AUTH).json()[0]["kineUid"]
        assert lu == attendu
        r = c.patch("/athletes/a1/kine", json={"kineUid": lu}, headers=_AUTH)
        assert r.status_code == 200, (attendu, r.text)
        # …et l'écho n'a rien changé.
        assert c.get("/athletes/mine", headers=_AUTH).json()[0]["kineUid"] == attendu


# --------------------------------------------------------------------------- #
# LE RIS DANS L'ANNUAIRE (FRE-92)
# --------------------------------------------------------------------------- #

def _competition(conn, nom, date, athlete_uuid, poids, genre, essais):
    """Une compétition où `athlete_uuid` réalise `essais` = {mouvement: charge}.

    ⚠️ LES QUATRE PLACES DU BARÈME SONT TOUJOURS DISPUTÉES, avec ou sans essai
    (FRE-147). `competition_scores` borne désormais le total du barème aux
    épreuves qui disputent ce qu'il NOTE — sinon une SBD y entrerait avec le
    squat seul. Une compétition à un mouvement n'a donc plus de RIS, et ces
    specs-là parlent du RIS, pas de la composition d'une épreuve. Déclarer sans
    essai ne change aucun total : seuls les essais réussis alimentent la vue."""
    cid = conn.execute(text(
        "INSERT INTO competitions (name, start_date, end_date, created_by) "
        "VALUES (:n, :d, :d, 'coach-1') RETURNING id"), {"n": nom, "d": date}).scalar()
    pid = conn.execute(text(
        "INSERT INTO competition_participants (competition_id, athlete_id, name, "
        "bodyweight_kg, gender) VALUES (:c, CAST(:a AS uuid), :n, :b, :g) RETURNING id"),
        {"c": cid, "a": athlete_uuid, "n": nom + "-p", "b": poids, "g": genre}).scalar()
    disputes = dict.fromkeys(("MUSCLE UP", "PULL UP", "DIPS", "SQUAT", *essais))
    mouvements = {}
    for i, mouvement in enumerate(disputes):
        mouvements[mouvement] = conn.execute(text(
            "INSERT INTO competition_movements (competition_id, movement, position) "
            "VALUES (:c, :m, :p) RETURNING id"), {"c": cid, "m": mouvement, "p": i}).scalar()
    for mouvement, charge in essais.items():
        conn.execute(text(
            "INSERT INTO competition_attempts (participant_id, movement_id, attempt_index, "
            "weight_kg, result) VALUES (:p, :m, 1, :w, 'rep')"),
            {"p": pid, "m": mouvements[mouvement], "w": charge})


def test_la_lecture_sert_le_RIS_et_son_contexte(auth_as, sql):
    """⚠️ SERVI, PLUS CALCULÉ PAR LE NAVIGATEUR. Trois écrans le calculaient
    chacun à sa façon, et deux ne tombaient pas d'accord — `competition-detail`
    classait sur le SCORE, `athletes` sur le TOTAL DU BARÈME."""
    _seed_athlete(sql, "uuid-a1", "a1", first_name="Bob", coach_uid="coach-1",
                  weight_kg=90, gender="M")
    _competition(sql, "Open", "2026-05-01", _UUIDS["uuid-a1"], 80, "M",
                 {"SQUAT": 160, "DIPS": 90, "MUSCLE UP": 25, "PULL UP": 70})

    a = _by_id(auth_as(uid="coach-1").get("/athletes/mine", headers=_AUTH).json())["a1"]
    assert a["risTotal"] == 345
    # ⚠️ VALEUR SORTIE DE L'IMPLÉMENTATION DU FRONT sur ces entrées exactes
    # (345 kg @ 80 kg, M), pas estimée de tête — même discipline que
    # tests/test_ris.py. J'avais d'abord recopié un chiffre vu sur une maquette :
    # il était faux, et le test l'a dit.
    assert a["ris"] == pytest.approx(68.8442612136, abs=1e-9)
    assert a["risCompetition"] == "Open" and a["risDate"] == "2026-05-01"
    # ⚠️ LE POIDS DU JOUR (80), PAS LE POIDS ACTUEL (90). C'est toute la règle :
    # un RIS vaut pour le poids auquel il a été réalisé, et l'écart avec le poids
    # d'aujourd'hui est une information — pas une erreur à corriger.
    assert a["risBodyweight"] == 80


def test_le_MEILLEUR_RIS_l_emporte_pas_le_dernier(auth_as, sql):
    """Un RIS représente un athlète par sa MEILLEURE performance : une
    compétition ratée ne doit pas effacer un titre."""
    _seed_athlete(sql, "uuid-a1", "a1", first_name="Bob", coach_uid="coach-1")
    _competition(sql, "La bonne", "2026-01-01", _UUIDS["uuid-a1"], 80, "M", {"SQUAT": 200})
    _competition(sql, "La ratée", "2026-06-01", _UUIDS["uuid-a1"], 80, "M", {"SQUAT": 100})

    a = _by_id(auth_as(uid="coach-1").get("/athletes/mine", headers=_AUTH).json())["a1"]
    assert a["risCompetition"] == "La bonne" and a["risTotal"] == 200


def test_un_athlète_SANS_COMPÉTITION_n_a_pas_de_RIS(auth_as, sql):
    """⚠️ DÉCISION DU 21/08, ET ELLE EST ASSUMÉE : le RIS ne vient QUE des
    compétitions. La table des 1RM ne peut pas garantir que le total et le poids
    ont été obtenus ensemble — deux écrans, deux moments. Résultat : 55 athlètes
    sur 59 n'ont pas de RIS, et l'écran affiche « — » plutôt qu'une estimation
    qu'on ne saurait pas tenir à jour.

    La clé est ABSENTE, pas nulle : `response_model_exclude_unset` la retire, et
    le front n'a rien à défendre."""
    _seed_athlete(sql, "uuid-a1", "a1", first_name="Bob", coach_uid="coach-1",
                  weight_kg=80, gender="M",
                  current_one_rm={"squat": 160, "dip": 90, "muscleUp": 25, "pullUp": 70})

    a = _by_id(auth_as(uid="coach-1").get("/athletes/mine", headers=_AUTH).json())["a1"]
    assert "ris" not in a, "un total de 1RM ne fait pas un RIS"


def test_un_participant_SANS_POIDS_ne_produit_pas_de_RIS(auth_as, sql):
    """Le barème a besoin des deux entrées. Sans poids, pas de classement — et
    surtout pas un zéro, qui ferait de lui un dernier."""
    _seed_athlete(sql, "uuid-a1", "a1", first_name="Bob", coach_uid="coach-1")
    _competition(sql, "Open", "2026-05-01", _UUIDS["uuid-a1"], None, "M", {"SQUAT": 160})

    a = _by_id(auth_as(uid="coach-1").get("/athletes/mine", headers=_AUTH).json())["a1"]
    assert "ris" not in a


# --------------------------------------------------------------------------- #
# ARCHIVER UN ATHLÈTE (FRE-127)
#
# ⚠️ CE QUE CES SPECS GARDENT, ET CE N'EST PAS « la colonne s'écrit ». Deux
# décisions qui ne se devinent pas :
#
#   1. RIEN N'EST FILTRÉ CÔTÉ SERVEUR. Un archivé reste dans `/athletes/mine`,
#      avec sa date — c'est l'écran qui masque. Filtrer ici ferait de
#      « reprendre plus tard » un aller simple, et retirerait l'athlète des
#      endroits où il est NOMMÉ (une compétition passée, un bilan) ;
#   2. LE LIEN COACH RESTE INTACT, ce qui distingue archiver de DÉTACHER : c'est
#      lui qui garde l'accès du coach, donc le pouvoir de réactiver.
# --------------------------------------------------------------------------- #

def test_archiver_pose_une_DATE_et_reactiver_l_efface(auth_as, sql):
    _seed_athlete(sql, "uuid-a1", "a1", first_name="A", coach_uid="coach-1")
    c = auth_as(uid="coach-1")

    r = c.patch("/athletes/a1/archive", json={"archive": True}, headers=_AUTH)
    assert r.status_code == 200, r.text[:300]
    assert r.json()["archiveLe"] is not None

    r = c.patch("/athletes/a1/archive", json={"archive": False}, headers=_AUTH)
    assert r.json()["archiveLe"] is None, "réactiver efface la date, il n'en pose pas une autre"


def test_un_archive_reste_dans_la_liste_AVEC_sa_date(auth_as, sql):
    """⚠️ LA DÉCISION CENTRALE DU TICKET. Le serveur SERT l'état, il ne filtre
    pas : la barre latérale masque, un « voir les archivés » rappelle, et une
    compétition passée continue de nommer l'athlète.

    Filtrer ici aurait paru plus propre et aurait tout cassé — l'écran n'aurait
    plus eu de quoi proposer la réactivation."""
    _seed_athlete(sql, "uuid-a1", "a1", first_name="A", coach_uid="coach-1")
    c = auth_as(uid="coach-1")
    c.patch("/athletes/a1/archive", json={"archive": True}, headers=_AUTH)

    liste = c.get("/athletes/mine", headers=_AUTH).json()
    archive = next(a for a in liste if a["id"] == "a1")
    assert archive["archiveLe"] is not None


def test_un_athlete_ACTIF_n_a_pas_de_date(auth_as, sql):
    """`None`, pas `''` : « actif » est une absence de date."""
    _seed_athlete(sql, "uuid-a1", "a1", first_name="A", coach_uid="coach-1")
    liste = auth_as(uid="coach-1").get("/athletes/mine", headers=_AUTH).json()
    assert next(a for a in liste if a["id"] == "a1")["archiveLe"] is None


def test_archiver_NE_DETACHE_PAS(auth_as, sql):
    """⚠️ CE QUI SÉPARE CE TICKET DE FRE-128. Le coach garde son athlète — donc
    son accès, donc le bouton pour le réactiver. Vider `coach_uid` ferait
    disparaître la fiche pour tout le monde, et le retour demanderait un `UPDATE`
    en base."""
    _seed_athlete(sql, "uuid-a1", "a1", first_name="A", coach_uid="coach-1")
    c = auth_as(uid="coach-1")
    c.patch("/athletes/a1/archive", json={"archive": True}, headers=_AUTH)

    apres = next(a for a in c.get("/athletes/mine", headers=_AUTH).json() if a["id"] == "a1")
    assert apres["coachId"] == "coach-1"


def test_un_AUTRE_coach_ne_peut_pas_archiver(auth_as, sql):
    """404 ET NON 403 : l'appartenance est dans le WHERE, donc un coach visant
    l'athlète d'un confrère n'apprend même pas qu'il existe."""
    _seed_athlete(sql, "uuid-a1", "a1", first_name="A", coach_uid="coach-1")
    r = auth_as(uid="coach-2").patch("/athletes/a1/archive",
                                     json={"archive": True}, headers=_AUTH)
    assert r.status_code == 404


# --------------------------------------------------------------------------- #
# L'âge se calcule depuis la date de naissance (FRE-168)
# --------------------------------------------------------------------------- #


def test_l_age_se_calcule_a_la_lecture_et_change_le_jour_de_l_anniversaire(auth_as, sql):
    """⚠️ LE CAS LIMITE QUI JUSTIFIE UNE SEULE DÉFINITION : l'anniversaire du
    JOUR. Né il y a exactement 30 ans → 30 ; né demain il y a 30 ans → 29 encore.
    `current_date` vient de Postgres, dans le fuseau de la session : c'est la
    même horloge qui décide pour tous les écrans."""
    aujourd_hui = sql.execute(text("SELECT current_date")).scalar()
    anniv = aujourd_hui.replace(year=aujourd_hui.year - 30)
    demain = sql.execute(text("SELECT CAST(current_date - interval '30 years' + interval '1 day' AS date)")).scalar()
    _seed_athlete(sql, "uuid-a1", "a1", first_name="Bob", coach_uid="coach-1", birth_date=anniv.isoformat())
    _seed_athlete(sql, "uuid-a2", "a2", first_name="Zoé", coach_uid="coach-1", birth_date=demain.isoformat())
    _seed_athlete(sql, "uuid-a3", "a3", first_name="Zut", coach_uid="coach-1")
    corps = {a["id"]: a for a in auth_as(uid="coach-1").get("/athletes/mine", headers=_AUTH).json()}
    assert (corps["a1"]["age"], corps["a1"]["birthDate"]) == (30, anniv.isoformat())
    assert (corps["a2"]["age"], corps["a2"]["birthDate"]) == (29, demain.isoformat())
    # Sans date, ni âge ni date — une absence, pas un zéro ni `''`.
    assert (corps["a3"]["age"], corps["a3"]["birthDate"]) == (None, None)
