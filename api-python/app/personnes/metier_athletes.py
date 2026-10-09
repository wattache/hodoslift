"""Les requêtes et les règles des fiches athlète, sans aucun gestionnaire HTTP.

Ce que le module porte : les listes (`/mine`, `/suivis`), la création d'une
fiche et de son programme, le rattachement d'un compte à sa fiche, les
signalements et leur coche, les liens coach / kiné, l'archivage, le meilleur RIS.

⚠️ C'est le LIEN nominatif (`coach_uid`, `user_uid`, `kine_uid`) qui ouvre une
fiche ; seul l'admin les voit toutes. La structure (FRE-13) est un FILTRE de
vue, pas une autorisation. Les archivés sont SERVIS, pas filtrés (FRE-127).
"""

import json

from sqlalchemy import text

from app.competitions.scoring import compute_ris
from app.socle.authz import porte_un_lien


# Colonnes communes aux deux vues (`/suivis` s'y limite ; `/mine` ajoute la PII
# de compte). programId = sous-requête LIMIT 1 (pas de JOIN → une ligne/athlète).
#
# ⚠️ L'ÂGE SE CALCULE À LA LECTURE (FRE-168), depuis la date de naissance : un
# entier stocké vieillit sans que rien ne le signale. Une seule définition, celle
# de Postgres — `age()` tient l'anniversaire du jour et le 29 février — et
# `current_date` suit le fuseau de la session, Europe/Paris (`db.py`).
COMMON_COLS = """
    a.legacy_id, a.first_name, a.last_name, a.gender, a.height_cm, a.weight_kg,
    CAST(date_part('year', age(current_date, a.birth_date)) AS integer) AS age,
    a.current_one_rm, a.coach_uid,
    (SELECT p.id FROM programs p WHERE p.athlete_id = a.id LIMIT 1) AS program_id
"""
# /mine : mêmes colonnes + la PII de compte (email, user_uid).
# ⚠️ LES ARCHIVÉS SONT SERVIS, PAS FILTRÉS ICI (FRE-127). Le serveur rend la
# DATE, l'écran décide : la barre latérale les masque, une compétition passée
# continue de les nommer. Filtrer ici imposerait un paramètre à chaque route,
# donc une clé de cache par état.
# ⚠️ `:structure` NULL = TOUTES (FRE-13) : c'est ce que demande un front qui ne
# connaît pas les structures. Un FILTRE de vue, pas une autorisation : le lien
# nominatif (`coach_uid`, `user_uid`) reste ce qui ouvre la fiche.
#
# ⚠️ LE LIEN, PAS LE RÔLE (FRE-190) : un admin reçoit ici SES fiches, comme tout
# le monde. Toutes les fiches, il les lit par l'annuaire (`ANNUAIRE_SQL`), qui ne
# porte que ce que l'écran Admin affiche — sans programme ni mesure, qu'aucun
# droit ne lui ouvre.
# ⚠️ UN ACCÈS SUPPORT EN COURS EST UN LIEN AUSSI (FRE-202) : l'athlète entre dans
# la liste le temps qu'il court, avec sa fin — c'est ce qui le fait entrer
# dans le sélecteur, et ce qui dit au front ce que l'appelant peut y faire.
# Les liens sans terme portent NULL, que `max` ignore.
_SUPPORT_JUSQU_AU = ("(SELECT max(l.jusqu_au) FROM liens_athlete l "
                     "WHERE l.uid = :uid AND l.athlete_id = a.id)")
MINE_OWN_SQL = text(
    f"SELECT a.id, {COMMON_COLS}, a.email, a.user_uid, a.kine_uid, a.archive_le, a.birth_date, "
    f"{_SUPPORT_JUSQU_AU} AS support_jusqu_au FROM athletes a "
    f"WHERE {porte_un_lien('coach', 'athlete')} "
    f"AND (CAST(:structure AS text) IS NULL OR a.structure = :structure) "
    f"ORDER BY a.first_name, a.last_name"
)


# current_one_rm par défaut : un objet VIDE, et le littéral est voulu (coercé
# jsonb en Postgres, texte en SQLite → portable ; un paramètre lié serait typé
# text et refusé par la colonne jsonb).
#
# ⚠️ VIDE, PAS CINQ CLÉS À ZÉRO (FRE-137). Un 1RM non renseigné n'a pas de clé,
# et un PATCH partiel n'effacerait pas un zéro posé ici : il ne transporte que la
# clé touchée. `pas_de_mesure_a_zero` le garde (`make invariants`).
# ⚠️ LA FICHE NAÎT DANS LA STRUCTURE DU COACH QUI LA CRÉE (FRE-13), lue dans
# `coaches` par la même instruction. Le `DEFAULT 'french-forge'` de la colonne ne
# joue jamais ici — `test_la_fiche_nait_dans_la_structure_du_coach` le garde.
CREATE_ATHLETE_SQL = text(
    "INSERT INTO athletes (legacy_id, first_name, email, coach_uid, current_one_rm, structure) "
    "SELECT :legacy_id, :first_name, :email, :coach_uid, '{}', c.structure "
    "FROM coaches c WHERE c.uid = :coach_uid "
    "RETURNING id"
)
CREATE_PROGRAM_SQL = text(
    "INSERT INTO programs (id, coach_uid, athlete_id) VALUES (:program_id, :coach_uid, :athlete_uuid)"
)


# --- Auto-linking : rattache l'utilisateur courant à SON athlète ---------------
# Le rattachement se fait ICI, dans la base qui décide de l'autorisation : tenu
# ailleurs, `athletes.user_uid` dérive et l'athlète se voit refuser sa fiche.
FIND_UNLINKED_SQL = text(
    "SELECT id, legacy_id FROM athletes "
    "WHERE lower(email) = :email AND user_uid IS NULL "
    "ORDER BY legacy_id LIMIT 1"  # pick déterministe si plusieurs candidats
)
# STUB users minimal (uid, email) pour la FK athletes.user_uid → users(uid) : un
# athlète tout neuf n'est pas encore dans `users` — sa ligne complète naît au
# premier `GET /users/me`, qui peut venir après.
# ⚠️ ON CONFLICT (uid) DO NOTHING : on n'écrase JAMAIS une ligne existante (son
# `is_admin` reste intact) ; les autres colonnes NOT NULL de `users` s'appuient
# sur leurs DEFAULT.
ENSURE_USER_SQL = text(
    "INSERT INTO users (uid, email) VALUES (:uid, :email) ON CONFLICT (uid) DO NOTHING"
)
LINK_SQL = text("UPDATE athletes SET user_uid = :uid WHERE id = :athlete_uuid")
# ⚠️ LA QUESTION QUI REND LE MESSAGE HONNÊTE (FRE-76) : une fiche porte-t-elle
# cette adresse, mais rattachée à quelqu'un d'AUTRE ? Posée seulement quand le
# rattachement a échoué — jamais sur le chemin qui va bien.
FICHE_DEJA_LIEE_SQL = text(
    "SELECT 1 FROM athletes WHERE lower(email) = :email AND user_uid IS NOT NULL LIMIT 1"
)


# L'ENTRÉE DU KINÉ (FRE-65) : « mes athlètes suivis ».
SUIVIS_SQL = text(
    f"SELECT {COMMON_COLS} FROM athletes a WHERE {porte_un_lien('kine')} "
    f"AND (CAST(:structure AS text) IS NULL OR a.structure = :structure) "
    f"ORDER BY a.first_name, a.last_name"
)


# LE TABLEAU DES SIGNALEMENTS : ce que MES athlètes ont rapporté, tous confondus.
#
# `daily_logs` porte une ligne par athlète et par jour : bon pour lire UN
# athlète, pas pour « qui va mal en ce moment ? ». Côté client, ce serait un
# appel par athlète suivi ; le serveur le rend en une requête.
#
# ⚠️ COACH ET KINÉ : le coach a le même besoin sur ses propres athlètes, et deux
# routes parallèles divergeraient.
#
# PAS DE GARDE DE RÔLE — même corollaire que `/suivis` : le LIEN est la vérité.
# Qui ne staffe personne reçoit une liste vide, pas un refus.
#
# ⚠️ UN SIGNALEMENT EST UN ATHLÈTE ET UN JOUR, PAS UNE DOULEUR (FRE-195). La
# coche du lecteur porte cette clé-là (`signalement_vu`), et un athlète peut
# noter deux douleurs le même jour : les servir séparément ferait deux lignes
# qu'une seule coche ferait disparaître ensemble. On agrège donc par jour, et
# la ligne porte LA LISTE de ce qui a été noté.
SIGNALEMENTS_SQL = text(f"""
    SELECT a.legacy_id, a.first_name, a.last_name, l.log_date,
           (SELECT p.id FROM programs p WHERE p.athlete_id = a.id LIMIT 1) AS program_id,
           jsonb_agg(jsonb_build_object(
               'id', d.id::text, 'nom', d.nom, 'zone', d.zone,
               'intensite', l.intensite, 'commentaire', l.commentaire,
               -- ⚠️ `recurrente` SE DÉDUIT ICI AUSSI, du même compte qu'ailleurs :
               -- la règle vit côté serveur, en un seul endroit.
               'logs', (SELECT count(*) FROM douleur_logs x WHERE x.douleur_id = d.id),
               'recurrente', (SELECT count(*) FROM douleur_logs x WHERE x.douleur_id = d.id) > 1
           ) ORDER BY l.intensite DESC, d.nom) AS douleurs
    FROM douleur_logs l
    JOIN douleurs d ON d.id = l.douleur_id
    JOIN athletes a ON a.id = d.athlete_id
    WHERE {porte_un_lien('coach', 'kine')}
      AND a.archive_le IS NULL
      AND l.log_date >= :depuis
    GROUP BY a.legacy_id, a.first_name, a.last_name, l.log_date, a.id
    ORDER BY l.log_date DESC, a.first_name, a.last_name
""")


# LA COCHE D'UN SIGNALEMENT, PAR LECTEUR.
#
# ⚠️ PAS UNE COLONNE SUR `daily_logs`. Le kiné et le coach voient le MÊME
# signalement (`SIGNALEMENTS_SQL` ci-dessus) : une colonne unique laisserait l'un
# le faire disparaître de la file de l'autre. C'est une table, `signalement_vu`,
# dont la clé est (athlète, jour, QUI a coché).
#
# L'AUTORISATION EST LE LIEN, PAS LE RÔLE — `staff`, c'est-à-dire la même
# condition que la lecture (`kine_uid = uid OR coach_uid = uid`). Seul un lecteur
# de ce signalement peut le cocher.
#
# Idempotentes : `ON CONFLICT DO NOTHING`, et décocher l'absent rend 200.

SIGNALEMENT_EXISTE_SQL = text("""
    SELECT DISTINCT a.id
      FROM douleur_logs l
      JOIN douleurs d ON d.id = l.douleur_id
      JOIN athletes a ON a.id = d.athlete_id
     WHERE a.legacy_id = :legacy AND l.log_date = :jour
""")
VU_SQL = text("""
    INSERT INTO signalement_vu (athlete_id, log_date, uid) VALUES (:aid, :jour, :uid)
    ON CONFLICT DO NOTHING
""")
NON_VU_SQL = text("""
    DELETE FROM signalement_vu s USING athletes a
     WHERE s.athlete_id = a.id AND a.legacy_id = :legacy
       AND s.log_date = :jour AND s.uid = :uid
""")


# --- Réassignation de coach (admin-only) --------------------------------------
# ⚠️ DEUX tables, et les deux comptent : `athletes.coach_uid` ET
# `programs.coach_uid`. L'autorisation d'un programme se lit sur le programme,
# pas sur l'athlète (cf. `_ProgramAccessDep`) — n'en déplacer qu'une laisserait
# le nouveau coach devant un arbre qu'il ne peut ni lire ni écrire.
ATHLETE_UUID_SQL = text("SELECT id FROM athletes WHERE legacy_id = :legacy")
COACH_EXISTS_SQL = text("SELECT 1 FROM coaches WHERE uid = :coach")
# ⚠️ UN COACH DE LA MÊME STRUCTURE (FRE-13). La fiche et ses lignes gardent leur
# structure : sous un coach d'une autre, elle n'apparaîtrait dans aucune de ses
# listes. La fiche ne bouge pas ; c'est le coach qui doit être de chez elle.
COACH_DE_LA_MEME_STRUCTURE_SQL = text(
    "SELECT 1 FROM coaches c JOIN athletes a ON a.structure = c.structure "
    "WHERE c.uid = :coach AND a.legacy_id = :legacy")
REASSIGN_ATHLETE_SQL = text("UPDATE athletes SET coach_uid = :coach WHERE legacy_id = :legacy")
PROGRAM_IDS_SQL = text("SELECT id FROM programs WHERE athlete_id = :athlete_uuid")
REASSIGN_PROGRAMS_SQL = text("UPDATE programs SET coach_uid = :coach WHERE athlete_id = :athlete_uuid")


# --- Affectation du kiné (FRE-52) ---------------------------------------------
# LE COACH écrit `kine_uid` sur SON athlète : c'est lui qui décide à qui il confie
# le suivi. Ni le kiné (on ne se donne pas ses propres patients), ni l'athlète, ni
# l'admin — l'admin POSE le rôle (`PUT /users/{uid}/kine`), le coach fait le LIEN.
# L'un dit « cette personne est kiné », l'autre « ce kiné suit cet athlète ».
ATHLETE_DU_COACH_SQL = text(
    "SELECT id FROM athletes WHERE legacy_id = :legacy AND coach_uid = :coach"
)
KINE_EXISTS_SQL = text("SELECT 1 FROM kines WHERE uid = :kine")
SET_KINE_SQL = text("UPDATE athletes SET kine_uid = :kine WHERE legacy_id = :legacy")

# ⚠️ ARCHIVER N'EST PAS DÉTACHER (FRE-127 contre FRE-128). Le lien coach reste
# intact : l'athlète garde son programme, son historique et ses records, et son
# coach garde son accès — donc le pouvoir de le réactiver. Vider `coach_uid`
# ferait disparaître la fiche pour TOUS les coachs, et le retour demanderait un
# `UPDATE` en base.
SET_ARCHIVE_SQL = text(
    "UPDATE athletes SET archive_le = :quand WHERE legacy_id = :legacy "
    "RETURNING archive_le"
)


# ⚠️ LES CANDIDATS AU RIS, PAS LE RIS (FRE-92). Le SQL agrège — la vue
# `competition_scores` porte déjà le total du barème et le poids du jour — et
# Python applique le barème : dix constantes et une exponentielle sont du métier,
# pas de l'agrégation. Un seul aller-retour pour toute la liste.
#
# ⚠️ SEULES LES COMPÉTITIONS COMPTENT. Le RIS exige un total ET un poids obtenus
# ENSEMBLE ; une participation le garantit, la table des 1RM non — le poids vit
# sur `athletes`, les 1RM ailleurs, saisis à deux moments. Conséquence assumée :
# un athlète sans compétition n'a pas de RIS.
_RIS_CANDIDATS_SQL = text(
    """
    SELECT cs.athlete_id, cs.total_bareme_kg, cs.bodyweight_kg, cs.gender,
           c.name AS competition, c.start_date
    FROM competition_scores cs
    JOIN competitions c ON c.id = cs.competition_id
    WHERE cs.athlete_id IS NOT NULL
      AND cs.total_bareme_kg > 0
      AND cs.bodyweight_kg IS NOT NULL
      AND cs.gender IS NOT NULL
    """
)


def meilleurs_ris(session) -> dict:
    """athlete_id → le meilleur RIS et son contexte, ou rien.

    ⚠️ LE MEILLEUR, PAS LE DERNIER. Un RIS est une performance : avec le plus
    récent, une compétition ratée effacerait un titre.
    """
    par_athlete: dict = {}
    for r in session.execute(_RIS_CANDIDATS_SQL).mappings().all():
        valeur = compute_ris(float(r["total_bareme_kg"]),
                             float(r["bodyweight_kg"]), r["gender"])
        if valeur is None:
            continue
        actuel = par_athlete.get(r["athlete_id"])
        if actuel is None or valeur > actuel["ris"]:
            par_athlete[r["athlete_id"]] = {
                "ris": valeur,
                "risTotal": float(r["total_bareme_kg"]),
                "risBodyweight": float(r["bodyweight_kg"]),
                "risCompetition": r["competition"],
                "risDate": r["start_date"].isoformat() if r["start_date"] else None,
            }
    return par_athlete


def _num(value) -> float | None:
    return float(value) if value is not None else None


def _one_rm(value) -> dict:
    """current_one_rm : dict (jsonb Postgres), texte JSON (SQLite), ou NULL → {}."""
    if value is None:
        return {}
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return {}
    return value


def map_common(row) -> dict:
    """Ligne SQL → dict de profil SANS la PII de compte.

    Accès par NOM de colonne (`.mappings()`) : partagé par les deux vues quel que
    soit l'ordre du SELECT.
    """
    return {
        "id": row["legacy_id"],
        "firstName": row["first_name"] or "",
        "lastName": row["last_name"] or "",
        "gender": row["gender"],
        "height": _num(row["height_cm"]),
        "weight": _num(row["weight_kg"]),
        "age": row["age"],
        "coachId": row["coach_uid"],
        "programId": row["program_id"],
        "currentOneRM": _one_rm(row["current_one_rm"]),
    }


# --------------------------------------------------------------------------- #
# Les requêtes, une fonction chacune — ce que les gestionnaires appellent
# --------------------------------------------------------------------------- #


def create_program(session, *, program_id, coach_uid, athlete_uuid):
    return session.execute(CREATE_PROGRAM_SQL, {"program_id": program_id, "coach_uid": coach_uid, "athlete_uuid": athlete_uuid})


def ensure_user(session, *, uid, email):
    return session.execute(ENSURE_USER_SQL, {"uid": uid, "email": email})


def link(session, *, uid, athlete_uuid):
    return session.execute(LINK_SQL, {"uid": uid, "athlete_uuid": athlete_uuid})


def vu(session, *, aid, jour, uid):
    return session.execute(VU_SQL, {"aid": aid, "jour": jour, "uid": uid})


def non_vu(session, *, legacy, jour, uid):
    return session.execute(NON_VU_SQL, {"legacy": legacy, "jour": jour, "uid": uid})


def reassign_athlete(session, *, coach, legacy):
    return session.execute(REASSIGN_ATHLETE_SQL, {"coach": coach, "legacy": legacy})


def reassign_programs(session, *, coach, athlete_uuid):
    return session.execute(REASSIGN_PROGRAMS_SQL, {"coach": coach, "athlete_uuid": athlete_uuid})


def set_kine(session, *, kine, legacy):
    return session.execute(SET_KINE_SQL, {"kine": kine, "legacy": legacy})


def inserer_la_fiche(session, *, legacy_id, first_name, email, coach_uid):
    return session.execute(CREATE_ATHLETE_SQL, {"legacy_id": legacy_id, "first_name": first_name, "email": email, "coach_uid": coach_uid}).first()


def signalement_existe(session, *, legacy, jour):
    return session.execute(SIGNALEMENT_EXISTE_SQL, {"legacy": legacy, "jour": jour}).scalar()


def athlete_uuid(session, *, legacy):
    return session.execute(ATHLETE_UUID_SQL, {"legacy": legacy}).scalar()


def set_archive(session, *, quand, legacy):
    return session.execute(SET_ARCHIVE_SQL, {"quand": quand, "legacy": legacy}).scalar()


def fiche_deja_liee(session, *, email):
    return session.execute(FICHE_DEJA_LIEE_SQL, {"email": email}).first()


def coach_exists(session, *, coach):
    return session.execute(COACH_EXISTS_SQL, {"coach": coach}).first()


def coach_de_la_meme_structure(session, *, coach, legacy):
    return session.execute(COACH_DE_LA_MEME_STRUCTURE_SQL, {"coach": coach, "legacy": legacy}).first()


def athlete_du_coach(session, *, legacy, coach):
    return session.execute(ATHLETE_DU_COACH_SQL, {"legacy": legacy, "coach": coach}).first()


def find_unlinked(session, *, email):
    return session.execute(FIND_UNLINKED_SQL, {"email": email}).mappings().first()


def suivis(session, *, uid, structure):
    return session.execute(SUIVIS_SQL, {"uid": uid, "structure": structure}).mappings().all()


def signalements(session, *, uid, depuis):
    return session.execute(SIGNALEMENTS_SQL, {"uid": uid, "depuis": depuis}).mappings().all()


def kine_exists(session, *, kine):
    return session.execute(KINE_EXISTS_SQL, {"kine": kine}).first()


def mine_own(session, *, uid, structure):
    return session.execute(MINE_OWN_SQL, {"uid": uid, "structure": structure}).mappings().all()


def program_ids(session, *, athlete_uuid):
    return session.execute(PROGRAM_IDS_SQL, {"athlete_uuid": athlete_uuid}).scalars().all()


def horloge(session):
    """L'heure RÉELLE de la base, et non `now()` qui rend celle du début de transaction."""
    return session.execute(text("SELECT clock_timestamp()")).scalar()


# L'annuaire de l'admin (FRE-190) : TOUTES les fiches de la structure, et les
# seuls champs que l'écran Admin lit. Ni `programId`, ni 1RM, ni poids : l'admin
# n'a aucun droit sur un programme ou une fiche qu'il ne coache pas, et un champ
# qu'on ne peut pas ouvrir n'a rien à faire dans la réponse.
ANNUAIRE_SQL = text(
    "SELECT a.legacy_id, a.first_name, a.last_name, a.email, a.user_uid, a.coach_uid, a.kine_uid, "
    f"{_SUPPORT_JUSQU_AU} AS support_jusqu_au "
    "FROM athletes a "
    "WHERE (CAST(:structure AS text) IS NULL OR a.structure = :structure) "
    "ORDER BY a.first_name, a.last_name"
)


def annuaire(session, *, uid, structure) -> list[dict]:
    return [
        {"id": r["legacy_id"], "firstName": r["first_name"] or "", "lastName": r["last_name"] or "",
         "email": r["email"], "linkedUserId": r["user_uid"], "coachId": r["coach_uid"],
         "kineUid": r["kine_uid"], "supportJusquAu": _iso(r["support_jusqu_au"])}
        for r in session.execute(ANNUAIRE_SQL, {"uid": uid, "structure": structure}).mappings().all()
    ]


def _iso(moment) -> str | None:
    return moment.isoformat() if moment else None


# L'accès support (FRE-202). L'ouvrir crée une ligne ; en cours, il se PROLONGE
# plutôt que de s'empiler — un seul par (admin, athlète) à la fois.
_FICHE_SQL = text("SELECT id FROM athletes WHERE legacy_id = :legacy")
_SUPPORT_EN_COURS_SQL = text(
    "SELECT id FROM acces_support WHERE uid = :uid AND athlete_id = :aid AND fin > clock_timestamp()")


def ouvrir_acces_support(session, *, uid, legacy, heures: int) -> str | None:
    """Ouvre ou prolonge l'accès support ; rend sa fin, ou None si la fiche n'existe pas."""
    aid = session.execute(_FICHE_SQL, {"legacy": legacy}).scalar()
    if aid is None:
        return None
    en_cours = session.execute(_SUPPORT_EN_COURS_SQL, {"uid": uid, "aid": aid}).scalar()
    if en_cours:
        fin = session.execute(text(
            "UPDATE acces_support SET fin = clock_timestamp() + make_interval(hours => :h) WHERE id = :id RETURNING fin"),
            {"h": heures, "id": en_cours}).scalar()
    else:
        fin = session.execute(text(
            "INSERT INTO acces_support (uid, athlete_id, fin) VALUES (:uid, :aid, clock_timestamp() + make_interval(hours => :h)) "
            "RETURNING fin"), {"uid": uid, "aid": aid, "h": heures}).scalar()
    return fin.isoformat()


def fermer_acces_support(session, *, uid, legacy) -> bool | None:
    """Ferme l'accès support en cours ; None si la fiche n'existe pas, False s'il n'y en avait pas."""
    aid = session.execute(_FICHE_SQL, {"legacy": legacy}).scalar()
    if aid is None:
        return None
    n = session.execute(text(
        "UPDATE acces_support SET fin = clock_timestamp() WHERE uid = :uid AND athlete_id = :aid "
        "AND fin > clock_timestamp()"),
        {"uid": uid, "aid": aid}).rowcount
    return n > 0

