"""Les compétitions en base : validations, écriture décomposée, recomposition, version.

Une compétition s'écrit en quatre tables (compétition, mouvements, participants,
essais) et se LIT recomposée dans la forme imbriquée du contrat. L'écriture est
un create-or-replace : les enfants sont supprimés puis réinsérés.

⚠️ Une compétition appartient à UNE structure (FRE-13). Hors d'elle, elle
n'existe pas : 404, pas 403 (`exiger_sa_structure`, `exiger_de_la_voir`).
⚠️ Le total du barème vient de la vue `competition_scores`, jamais d'un calcul ici.
"""

import json

from fastapi import status
from sqlalchemy import text

from app.socle.authz import compte, derive_participant_uids, porte_un_lien
from app.socle.structures import slugs_de
from app.competitions.schemas_competition import Participant
from app.competitions.scoring import compute_ris, compute_projection
from app.socle.empreinte import empreinte
from app.socle.erreurs import ErreurMetier


# --------------------------------------------------------------------------- #
# SQL — écriture
# --------------------------------------------------------------------------- #

# ⚠️ LA LIGNE EST VERROUILLÉE JUSQU'À LA FIN DE LA TRANSACTION (FRE-162) : c'est
# ce qui met les écritures d'une compétition À LA FILE. La version se compare
# APRÈS ce verrou ; sans lui, deux PATCH simultanés passent tous deux la
# comparaison avant que l'un n'ait écrit, et le remplacement en bloc du second
# efface le premier — deux 200. `tests/test_competition_course.py` le garde.
# `NO KEY` : les lignes filles (essais, disponibilités) qui référencent la
# compétition s'insèrent sans attendre.
SELECT_COMP_SQL = text(
    "SELECT id, created_by, start_date, end_date FROM competitions WHERE legacy_id = :legacy "
    "FOR NO KEY UPDATE"
)

# ⚠️ Elle naît dans la structure de son créateur (FRE-13) — ou dans celle que
# l'admin regarde (`structure_ecrite`, `?structure=`) : la structure est résolue
# AVANT, jamais laissée au `DEFAULT` de la colonne.
INSERT_COMP_SQL = text(
    """
    INSERT INTO competitions (legacy_id, name, start_date, end_date, location, max_attempts, created_by, structure)
    VALUES (:legacy_id, :name, :start_date, :end_date, :location, :max_attempts, :created_by, :structure)
    RETURNING id
    """
)
DEL_COMP = text("DELETE FROM competitions WHERE id = :cid")


# ---------------------------------------------------------------------------
# Disponibilité des coachs (FRE-22)
#
# Table DÉDIÉE `competition_coach_availability`, et non un sous-arbre du payload
# compétition : le PUT d'une compétition supprime ses enfants et les réinsère.
# Une disponibilité rangée là serait effacée à la première édition par un autre.
#
# Le GET renvoie la MATRICE COMPLÈTE coach × jour, comblée à `pending` :
# l'appelant n'a à connaître ni la liste des coachs ni celle des jours.
# ---------------------------------------------------------------------------

AVAIL_SQL = text(
    "SELECT coach_uid, day, status FROM competition_coach_availability "
    "WHERE competition_id = :cid"
)

COACHS_DE_LA_COMP_SQL = text(
    "SELECT c.uid, COALESCE(u.display_name, u.email, c.uid) AS name "
    "FROM coaches c LEFT JOIN users u ON u.uid = c.uid "
    "WHERE c.structure = (SELECT structure FROM competitions WHERE id = :cid) "
    "   OR c.uid IN (SELECT a.coach_uid FROM competition_participants cp "
    "                JOIN athletes a ON a.id = cp.athlete_id WHERE cp.competition_id = :cid) "
    "ORDER BY name")

UPSERT_AVAIL_SQL = text(
    "INSERT INTO competition_coach_availability (competition_id, coach_uid, day, status) "
    "VALUES (:cid, :uid, :day, :status) "
    "ON CONFLICT (competition_id, coach_uid, day) DO UPDATE "
    # CURRENT_TIMESTAMP et non now() : le SQLite des tests n'a pas now().
    "SET status = EXCLUDED.status, updated_at = CURRENT_TIMESTAMP"
)


# ⚠️ Bornée aux structures de l'APPELANT (FRE-13) — l'admin les a toutes. Le
# coach est un paramètre libre : sans ce filtre, tout membre lirait les
# compétitions d'une autre structure à travers les dispos d'un de ses coachs.
COACH_AVAIL_SQL = text(
    "SELECT k.legacy_id AS competition_id, a.day, a.status "
    "FROM competition_coach_availability a "
    "JOIN competitions k ON k.id = a.competition_id "
    "WHERE a.coach_uid = :uid AND k.structure = ANY(CAST(:structures AS text[])) "
    "ORDER BY a.day"
)


def iso(value) -> str:
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


# --------------------------------------------------------------------------- #
# Validation des mouvements de compétition (lifts de compét = library_entries
# category='exercices' ET competition=true). Insensible à la casse.
# --------------------------------------------------------------------------- #

# ⚠️ Les lifts de la bibliothèque de SA structure : une bibliothèque par
# structure, un lift ajouté dans l'une n'en fait pas un dans l'autre.
_COMP_LIFTS_SQL = text(
    "SELECT upper(name) FROM library_entries "
    "WHERE category = 'exercices' AND competition = true AND structure = :structure"
)


def validate_competition_movements(session, movement_names: list[str], structure: str) -> None:
    valid = {r[0] for r in session.execute(_COMP_LIFTS_SQL, {"structure": structure}).all()}
    for name in movement_names:
        if name.strip().upper() not in valid:
            raise ErreurMetier("pas_un_lift_de_competition", 
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"mouvement « {name} » : doit être un lift de compétition "
                "(library_entries category='exercices' et competition=true)",
            )


def validate_competes_on(pairs, start: str, end: str) -> None:
    """Refuse un jour de passage hors de la compétition.

    `pairs` = liste de (nom, competes_on ISO | None). La comparaison lexicale de
    dates ISO vaut comparaison de dates.

    Raises:
        ErreurMetier: `jour_hors_competition` (422), avec la liste des fautifs.
    """
    bad = [name for name, co in pairs if co is not None and not (start <= co <= end)]
    if bad:
        raise ErreurMetier("jour_hors_competition", 
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"jour de passage hors plage [{start} – {end}] : {', '.join(bad)}",
        )


_WEIGHT_CATS_SQL = text("SELECT gender, code FROM weight_categories ORDER BY gender, position")


def validate_weight_categories(session, participants) -> None:
    """Valide (gender, weight_category) de chaque participant contre le référentiel.

    AVANT insertion : la FK COMPOSITE (gender, weight_category) → weight_categories
    refuserait sinon en IntegrityError, donc en 500. Une catégorie `None` est
    optionnelle. Le référentiel est chargé UNE fois.

    Raises:
        ErreurMetier: `categorie_exige_le_genre` ou `categorie_invalide` (422).
    """
    rows = session.execute(_WEIGHT_CATS_SQL).all()
    valid = {(g, c) for g, c in rows}
    by_gender: dict = {}
    for g, c in rows:
        by_gender.setdefault(g, []).append(c)
    for p in participants:
        wc = p["weight_category"]
        if wc is None:
            continue
        gender = p["gender"]
        if gender is None:  # FK composite → une catégorie sans genre est non résoluble
            raise ErreurMetier("categorie_exige_le_genre", 
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"{p['name']} : la catégorie de poids exige le genre du participant",
            )
        if (gender, wc) not in valid:
            codes = ", ".join(by_gender.get(gender, []))
            raise ErreurMetier("categorie_invalide", 
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"{p['name']} : catégorie « {wc} » invalide pour le genre {gender} "
                f"(codes valides : {codes})",
            )


def validate_attempt_norep(participants) -> None:
    """Refuse un motif de non-validation sur un essai qui n'est pas un `norep`.

    Le CHECK (norep_reason IS NULL OR result = 'norep') en ferait un 500 ; ici
    c'est un 422 qui situe l'essai.

    Raises:
        ErreurMetier: `motif_exige_un_echec` (422).
    """
    for p in participants:
        for m in p["movements"]:
            for idx, a in enumerate(m["attempts"], start=1):
                if a["norep_reason"] is not None and a["result"] != "norep":
                    raise ErreurMetier("motif_exige_un_echec", 
                        status.HTTP_422_UNPROCESSABLE_CONTENT,
                        f"{p['name']} / {m['name']} essai #{idx} : un motif de "
                        "non-validation exige result='norep'",
                    )


def validate_annonces_croissantes(participants) -> None:
    """Refuse une annonce plus légère qu'un essai précédent du même mouvement.

    On ne baisse pas (William, 24/09) : après un échec on peut retenter la même
    charge, jamais une plus légère. La règle porte sur la charge ANNONCÉE
    (`weight_kg`) ; le plan P/R/O reste libre, c'est une hypothèse. Un essai sans
    annonce ne compte pas.

    Raises:
        ErreurMetier: `annonce_en_baisse` (422).
    """
    for p in participants:
        for m in p["movements"]:
            plancher = 0.0
            for idx, a in enumerate(m["attempts"], start=1):
                charge = a["weight_kg"] or 0.0
                if charge <= 0:
                    continue
                if charge < plancher:
                    raise ErreurMetier("annonce_en_baisse",
                        status.HTTP_422_UNPROCESSABLE_CONTENT,
                        f"{p['name']} / {m['name']} essai #{idx} : {charge:g} kg après "
                        f"{plancher:g} kg — une annonce ne baisse pas",
                    )
                plancher = charge

# ---------------------------------------------------------------------------
# LA STRUCTURE D'UNE COMPÉTITION (FRE-13)
#
# Tout coach édite toute compétition — À L'INTÉRIEUR de sa structure : le staff
# d'une structure se parle, pas celui de deux. Une compétition se lit et s'édite
# par les coachs de SA structure, et par l'admin partout.
#
# ⚠️ Hors de sa structure, elle n'existe pas : 404, pas 403. La liste ne la
# montre pas ; un 403 confirmerait qu'elle existe.
# ---------------------------------------------------------------------------
STRUCTURE_DE_COMP_SQL = text("SELECT structure FROM competitions WHERE legacy_id = :legacy")
STRUCTURE_DU_COACH_SQL = text("SELECT structure FROM coaches WHERE uid = :uid")


def exiger_sa_structure(session, uid: str, comp_id: str) -> None:
    """Exige que la compétition soit de la structure où l'appelant coache (l'admin passe).

    Ne dit rien d'une compétition ABSENTE : la route garde son propre 404, ou crée.

    Raises:
        ErreurMetier: `competition_introuvable` (404, pas 403).
    """
    sienne = session.execute(STRUCTURE_DE_COMP_SQL, {"legacy": comp_id}).scalar()
    if sienne is None:
        return
    qui = compte(uid, session)
    if not qui.admin and qui.coach_structure != sienne:
        raise ErreurMetier("competition_introuvable", status.HTTP_404_NOT_FOUND, "compétition introuvable")


# ⚠️ Y concourir, ou y avoir un ATHLÈTE (FRE-13, le meet partagé) : un coach
# suit ses athlètes là où ils concourent, même dans une autre structure. La
# compétition lui est lisible, et sa matrice le compte parmi les coachs.
_Y_CONCOURT_SQL = text(
    "SELECT 1 FROM competition_participants cp JOIN athletes a ON a.id = cp.athlete_id "
    "JOIN competitions k ON k.id = cp.competition_id "
    f"WHERE k.legacy_id = :legacy AND {porte_un_lien('coach', 'athlete')} LIMIT 1")


def exiger_de_la_voir(session, uid: str, comp_id: str) -> None:
    """Exige de pouvoir LIRE la matrice : être de sa structure, ou y concourir, ou l'admin.

    ⚠️ « En être » — coach, kiné ou athlète —, pas « y coacher » : la matrice est
    lisible par tout membre du club (`get_availability`). `e2e-reel/disponibilites`
    garde le cas de l'athlète.

    Raises:
        ErreurMetier: `competition_introuvable` (404), comme `exiger_sa_structure`.
    """
    sienne = session.execute(STRUCTURE_DE_COMP_SQL, {"legacy": comp_id}).scalar()
    if sienne is None or sienne in slugs_de(uid):
        return
    if session.execute(_Y_CONCOURT_SQL, {"legacy": comp_id, "uid": uid}).first() is None:
        raise ErreurMetier("competition_introuvable", status.HTTP_404_NOT_FOUND, "compétition introuvable")

_INSERT_MOVEMENT_SQL = text(
    "INSERT INTO competition_movements (competition_id, movement, position) "
    "VALUES (:cid, :movement, :position) RETURNING id"
)
# Les enums (gender, result, selected_tier) passent en texte SANS CAST : Postgres
# fait le cast d'affectation, et le SQLite des tests a des colonnes TEXT.
_INSERT_PARTICIPANT_SQL = text(
    """
    INSERT INTO competition_participants
        (competition_id, athlete_id, name, competes_on, bodyweight_kg, gender, weight_category)
    VALUES (:cid, :athlete_id, :name, :competes_on, :bodyweight_kg, :gender, :weight_category)
    RETURNING id
    """
)
_INSERT_ATTEMPT_SQL = text(
    """
    INSERT INTO competition_attempts
        (participant_id, movement_id, attempt_index, weight_kg, result,
         weight_pessimistic, weight_realistic, weight_optimistic, selected_tier, norep_reason, var_used)
    VALUES
        (:participant_id, :movement_id, :attempt_index, :weight_kg, :result,
         :weight_pessimistic, :weight_realistic, :weight_optimistic, :selected_tier, :norep_reason, :var_used)
    """
)

# Suppression EXPLICITE des enfants (portable : ne dépend pas du CASCADE/PRAGMA).
_DEL_ATTEMPTS = text(
    "DELETE FROM competition_attempts WHERE participant_id IN "
    "(SELECT id FROM competition_participants WHERE competition_id = :cid)"
)
_DEL_PARTICIPANTS = text("DELETE FROM competition_participants WHERE competition_id = :cid")
_DEL_MOVEMENTS = text("DELETE FROM competition_movements WHERE competition_id = :cid")

_ATHLETE_MAP_SQL = text("SELECT user_uid, id FROM athletes WHERE user_uid IS NOT NULL")


def athlete_map(session) -> dict:
    """user_uid → athlete uuid (résolution des participants liés)."""
    return {u: i for u, i in session.execute(_ATHLETE_MAP_SQL).all()}


# --------------------------------------------------------------------------- #
# Normalisation payload → interne (colonnes) et écriture décomposée
# --------------------------------------------------------------------------- #


def participants_to_internal(participants: list[Participant], athletes_par_uid: dict) -> list[dict]:
    """Traduit les participants Pydantic en dicts au format colonnes.

    `uid` → `athlete_id`, NULL pour un invité : on garde son nom, rien d'inventé.
    """
    out: list[dict] = []
    for p in participants:
        out.append(
            {
                "name": p.name,
                "athlete_id": athletes_par_uid.get(p.uid) if p.uid else None,
                "competes_on": p.competesOn,
                "bodyweight_kg": p.bodyweight,
                "gender": p.gender,
                "weight_category": p.weightCategory,
                "movements": [
                    {
                        "name": m.name,
                        "attempts": [
                            {
                                "weight_kg": a.weight,
                                "result": a.result or None,  # '' → NULL (pas encore tenté)
                                "weight_pessimistic": a.weights.pessimistic if a.weights else None,
                                "weight_realistic": a.weights.realistic if a.weights else None,
                                "weight_optimistic": a.weights.optimistic if a.weights else None,
                                "selected_tier": a.selectedTier,
                                "norep_reason": a.norepReason,
                                "var_used": a.varUsed,
                            }
                            for a in m.attempts
                        ],
                    }
                    for m in p.movements
                ],
            }
        )
    return out


_CHAMPS_D_ESSAI = (
    "weight_kg", "result", "weight_pessimistic", "weight_realistic",
    "weight_optimistic", "selected_tier", "norep_reason", "var_used",
)


# Tout ce qui n'est ni la charge ni le résultat : un prono, un palier choisi, un
# motif de non-validation, le VAR. Leur seule PRÉSENCE vaut saisie.
_MARQUES_D_ESSAI = (
    "weight_pessimistic", "weight_realistic", "weight_optimistic",
    "selected_tier", "norep_reason", "var_used",
)


def _essai_saisi(essai: dict) -> bool:
    """Dit si un essai porte quelque chose.

    ⚠️ LE VIDE N'EST PAS NULL. Un essai vierge arrive du front en
    `{weight: 0, result: ''}`, jamais en NULL : le front pose ces cases dès qu'on
    ajoute un participant, et le schéma EXIGE `weight`. Tester « non NULL »
    compterait chaque case vide comme une saisie, et `valider_essais_conserves`
    refuserait des écritures qui ne détruisent rien.

    Une charge de 0 sans résultat n'est pas un essai à 0 kg : c'est une case que
    personne n'a remplie.
    """
    if essai.get("result"):  # 'rep' / 'norep' — NULL et '' ne comptent pas
        return True
    poids = essai.get("weight_kg")
    if poids is not None and poids != 0:
        return True
    return any(essai.get(champ) is not None for champ in _MARQUES_D_ESSAI)


def valider_essais_conserves(movement_names: list[str], participants: list[dict]) -> None:
    """Refuse une écriture qui ferait disparaître des essais SAISIS (FRE-85).

    ⚠️ `write_children` résout le mouvement d'un essai PAR SON NOM, et saute un
    essai dont le mouvement n'est pas dans `movement_names`. Sans ce garde, un
    `PATCH movementNames` amputé emporte en silence (200) les essais de tous les
    participants sur ce mouvement.

    ⚠️ Toute destruction n'est pas refusée. Retirer un participant emporte ses
    essais, et l'appelant l'EXPRIME en l'omettant. Retirer un mouvement n'exprime
    rien sur les essais des participants gardés : c'est cette destruction-là qui
    est refusée.

    Pour retirer un mouvement : envoyer `movementNames` ET des `participants`
    dont les essais sur ce mouvement ont été retirés. Le geste devient explicite.

    Raises:
        ErreurMetier: `essais_perdus` (409), avec le compte des essais.
    """
    connus = {m for m in movement_names}
    perdus = sum(
        1
        for p in participants
        for m in p["movements"]
        if m["name"] not in connus
        for essai in m["attempts"]
        if _essai_saisi(essai)
    )
    if perdus:
        # Le COMPTE est dans le message : c'est lui qui aide à décider.
        raise ErreurMetier(
            "essais_perdus",
            status.HTTP_409_CONFLICT,
            f"{perdus} essai(s) saisi(s) portent sur un mouvement retiré de la compétition",
        )


def write_children(session, cid, movement_names: list[str], participants: list[dict]) -> None:
    """Insère mouvements, participants et essais (`participants` au format interne).

    Le `movement_id` d'un essai se résout par le NOM au sein de CETTE compétition ;
    un essai d'un mouvement inconnu est sauté — d'où `valider_essais_conserves`.
    """
    mv_map: dict[str, object] = {}
    for position, name in enumerate(movement_names, start=1):
        mid = session.execute(
            _INSERT_MOVEMENT_SQL, {"cid": cid, "movement": name, "position": position}
        ).scalar()
        mv_map[name] = mid

    for p in participants:
        pid = session.execute(
            _INSERT_PARTICIPANT_SQL,
            {
                "cid": cid,
                "athlete_id": p["athlete_id"],
                "name": p["name"],
                "competes_on": p["competes_on"],
                "bodyweight_kg": p["bodyweight_kg"],
                "gender": p["gender"],
                "weight_category": p["weight_category"],
            },
        ).scalar()
        for m in p["movements"]:
            mid = mv_map.get(m["name"])
            if mid is None:
                continue  # essais d'un mouvement hors movementNames → ignorés
            for idx, a in enumerate(m["attempts"], start=1):
                session.execute(
                    _INSERT_ATTEMPT_SQL,
                    {"participant_id": pid, "movement_id": mid, "attempt_index": idx, **a},
                )


def validate_flights(session, flights) -> None:
    """Valide les flights : noms distincts, catégories du référentiel, une catégorie par flight.

    AVANT insertion : la clé primaire et les FK en feraient des 500.

    Raises:
        ErreurMetier: `flight_en_double`, `categorie_invalide` ou
            `categorie_dans_deux_flights` (422).
    """
    valid = {(g, c) for g, c in session.execute(_WEIGHT_CATS_SQL).all()}
    noms: set = set()
    placees: dict = {}
    for f in flights:
        # « A » et « a » sont le même flight sur une affiche.
        if f.name.casefold() in noms:
            raise ErreurMetier("flight_en_double", status.HTTP_422_UNPROCESSABLE_CONTENT,
                               f"deux flights s'appellent « {f.name} »")
        noms.add(f.name.casefold())
        for cat in f.categories:
            cle = (cat.gender, cat.weightCategory)
            if cle not in valid:
                raise ErreurMetier("categorie_invalide", status.HTTP_422_UNPROCESSABLE_CONTENT,
                                   f"flight {f.name} : catégorie « {cat.weightCategory} » invalide "
                                   f"pour le genre {cat.gender}")
            if cle in placees:
                raise ErreurMetier("categorie_dans_deux_flights", status.HTTP_422_UNPROCESSABLE_CONTENT,
                                   f"{cat.gender} {cat.weightCategory} est dans les flights "
                                   f"{placees[cle]} et {f.name}")
            placees[cle] = f.name


_INSERT_FLIGHT_SQL = text(
    "INSERT INTO competition_flights (competition_id, name, position) "
    "VALUES (:cid, :name, :position) RETURNING id"
)
_INSERT_FLIGHT_CATEGORY_SQL = text(
    "INSERT INTO competition_flight_categories (competition_id, flight_id, gender, weight_category) "
    "VALUES (:cid, :fid, :gender, :weight_category)"
)
_DEL_FLIGHT_CATEGORIES = text("DELETE FROM competition_flight_categories WHERE competition_id = :cid")
_DEL_FLIGHTS = text("DELETE FROM competition_flights WHERE competition_id = :cid")


def replace_flights(session, cid, flights) -> None:
    """Remplace les flights d'une compétition ; leur rang dans la liste est leur ordre de passage."""
    clear_flights(session, cid)
    for position, f in enumerate(flights, start=1):
        fid = session.execute(_INSERT_FLIGHT_SQL, {"cid": cid, "name": f.name, "position": position}).scalar()
        for cat in f.categories:
            session.execute(_INSERT_FLIGHT_CATEGORY_SQL, {
                "cid": cid, "fid": fid, "gender": cat.gender, "weight_category": cat.weightCategory})


def clear_flights(session, cid) -> None:
    session.execute(_DEL_FLIGHT_CATEGORIES, {"cid": cid})
    session.execute(_DEL_FLIGHTS, {"cid": cid})


def clear_children(session, cid) -> None:
    session.execute(_DEL_ATTEMPTS, {"cid": cid})
    session.execute(_DEL_PARTICIPANTS, {"cid": cid})
    session.execute(_DEL_MOVEMENTS, {"cid": cid})


# --------------------------------------------------------------------------- #
# Lecture : recomposition du doc imbriqué
# --------------------------------------------------------------------------- #

# `:cid` NULL = toutes les compétitions ; sinon UNE, et chaque lecture s'y borne
# (FRE-222) : relire la version d'une compétition dans sa transaction d'écriture
# ne recompose plus le club entier.
_UNE_OU_TOUTES = "(CAST(:cid AS uuid) IS NULL OR {col} = CAST(:cid AS uuid))"
_READ_COMPS = text(
    "SELECT id, legacy_id, name, start_date, end_date, location, max_attempts, created_by, structure "
    f"FROM competitions WHERE {_UNE_OU_TOUTES.format(col='id')} ORDER BY start_date, legacy_id"
)
_READ_MOVEMENTS = text(
    "SELECT competition_id, id, movement, position FROM competition_movements "
    f"WHERE {_UNE_OU_TOUTES.format(col='competition_id')} ORDER BY competition_id, position"
)
# ⚠️ Le total du barème vient de la VUE `competition_scores`, pas d'un calcul
# ici : le refaire en Python serait une SECONDE définition de la même règle
# (quatre places, dont une disputée entre pull up et chin up), libre de diverger.
# La vue agrège, Python applique le barème.
_READ_PARTICIPANTS = text(
    "SELECT cp.id, cp.competition_id, cp.name, cp.competes_on, cp.bodyweight_kg, cp.gender, "
    "cp.weight_category, a.user_uid, cs.score, cs.total_bareme_kg "
    "FROM competition_participants cp "
    "LEFT JOIN athletes a ON a.id = cp.athlete_id "
    "LEFT JOIN competition_scores cs ON cs.participant_id = cp.id "
    f"WHERE {_UNE_OU_TOUTES.format(col='cp.competition_id')} "
    "ORDER BY cp.competition_id, cp.name"
)
_ATTEMPTS_COLS = (
    "ca.participant_id, cm.movement, cm.position, ca.attempt_index, ca.weight_kg, ca.result, "
    "ca.weight_pessimistic, ca.weight_realistic, ca.weight_optimistic, ca.selected_tier, "
    "ca.norep_reason, ca.var_used"
)
_READ_ATTEMPTS = text(
    f"SELECT {_ATTEMPTS_COLS} FROM competition_attempts ca "
    "JOIN competition_movements cm ON cm.id = ca.movement_id "
    f"WHERE {_UNE_OU_TOUTES.format(col='cm.competition_id')} "
    "ORDER BY ca.participant_id, cm.position, ca.attempt_index"
)


# Un flight sans catégorie sort quand même : le LEFT JOIN le garde, `gender` nul.
_READ_FLIGHTS = text(
    "SELECT f.competition_id, f.name, f.position, fc.gender, fc.weight_category "
    "FROM competition_flights f "
    "LEFT JOIN competition_flight_categories fc ON fc.flight_id = f.id "
    "LEFT JOIN weight_categories wc ON wc.gender = fc.gender AND wc.code = fc.weight_category "
    f"WHERE {_UNE_OU_TOUTES.format(col='f.competition_id')} "
    "ORDER BY f.competition_id, f.position, fc.gender, wc.position"
)


def _num(value):
    return float(value) if value is not None else None


def _recompose_attempt(r) -> dict:
    att: dict = {
        "weight": float(r["weight_kg"]) if r["weight_kg"] is not None else 0.0,
        "result": r["result"] or "",  # NULL → '' (pas encore tenté)
    }
    wp, wr, wo = r["weight_pessimistic"], r["weight_realistic"], r["weight_optimistic"]
    if wp is not None or wr is not None or wo is not None:
        att["weights"] = {"pessimistic": _num(wp) or 0.0, "realistic": _num(wr) or 0.0, "optimistic": _num(wo) or 0.0}
    if r["selected_tier"] is not None:
        att["selectedTier"] = r["selected_tier"]
    if r["norep_reason"] is not None:
        att["norepReason"] = r["norep_reason"]
    if r["var_used"] is not None:
        att["varUsed"] = r["var_used"]
    return att


def recompose_all(session, cid=None) -> list[dict]:
    """Les compétitions recomposées dans la forme imbriquée du contrat — toutes, ou UNE (`cid`)."""
    p = {"cid": cid}
    comps = session.execute(_READ_COMPS, p).mappings().all()
    movements = session.execute(_READ_MOVEMENTS, p).mappings().all()
    participants = session.execute(_READ_PARTICIPANTS, p).mappings().all()
    attempts = session.execute(_READ_ATTEMPTS, p).mappings().all()
    flights = session.execute(_READ_FLIGHTS, p).mappings().all()

    flights_by_comp: dict = {}
    flight_de_categorie: dict = {}
    for f in flights:
        docs = flights_by_comp.setdefault(f["competition_id"], [])
        if not docs or docs[-1]["name"] != f["name"]:
            docs.append({"name": f["name"], "categories": []})
        if f["gender"] is not None:
            docs[-1]["categories"].append({"gender": f["gender"], "weightCategory": f["weight_category"]})
            flight_de_categorie[(f["competition_id"], f["gender"], f["weight_category"])] = f["name"]

    mv_by_comp: dict = {}
    for m in movements:
        mv_by_comp.setdefault(m["competition_id"], []).append(m["movement"])

    att_by_part: dict = {}
    for a in attempts:
        att_by_part.setdefault(a["participant_id"], {}).setdefault(a["movement"], []).append(_recompose_attempt(a))

    parts_by_comp: dict = {}
    for p in participants:
        pdoc: dict = {"name": p["name"]}
        if p["user_uid"] is not None:
            pdoc["uid"] = p["user_uid"]
        if p["bodyweight_kg"] is not None:
            pdoc["bodyweight"] = _num(p["bodyweight_kg"])
        if p["gender"] is not None:
            pdoc["gender"] = p["gender"]
        if p["weight_category"] is not None:
            pdoc["weightCategory"] = p["weight_category"]
        flight = flight_de_categorie.get((p["competition_id"], p["gender"], p["weight_category"]))
        if flight is not None:
            pdoc["flight"] = flight
        # competesOn : TOUJOURS renvoyé (null si non renseigné), contrairement aux
        # autres optionnels (le front s'en sert pour le J−x du dashboard).
        pdoc["competesOn"] = iso(p["competes_on"]) if p["competes_on"] is not None else None
        # Mouvements du participant = ceux où il a des essais, dans l'ordre de la compét.
        part_att = att_by_part.get(p["id"], {})
        ordered = [mv for mv in mv_by_comp.get(p["competition_id"], []) if mv in part_att]
        pdoc["movements"] = [{"name": mv, "attempts": part_att[mv]} for mv in ordered]
        # ⚠️ Le score aussi vient de la VUE : elle agrège sur `upper(movement)`,
        # là où « SQUAT » et « Squat » coexistent dans `competition_movements`.
        # Un calcul sur le nom brut en ferait deux mouvements.
        pdoc["score"] = float(p["score"])
        # Vers quoi il se dirige, selon les trois hypothèses du plan (FRE-203).
        pdoc["projection"] = compute_projection(pdoc["movements"])
        # ⚠️ Le RIS est SERVI, pas calculé par le navigateur (FRE-92) : une seule
        # définition, tirée du TOTAL DU BARÈME — pas du score.
        pdoc["risTotal"] = _num(p["total_bareme_kg"])
        pdoc["ris"] = compute_ris(_num(p["total_bareme_kg"]),
                                  _num(p["bodyweight_kg"]), p["gender"])
        parts_by_comp.setdefault(p["competition_id"], []).append(pdoc)

    out: list[dict] = []
    for c in comps:
        participants_docs = parts_by_comp.get(c["id"], [])
        doc: dict = {
            "id": c["legacy_id"],
            "name": c["name"],
            "startDate": iso(c["start_date"]),
            "endDate": iso(c["end_date"]),
            "date": iso(c["start_date"]),  # compat : = startDate (le front l'utilise encore)
            "maxAttempts": c["max_attempts"],
            "movementNames": mv_by_comp.get(c["id"], []),
            "participants": participants_docs,
            "flights": flights_by_comp.get(c["id"], []),
            "editorEmails": [],  # non persisté (co-édition inexistante côté produit)
            "createdBy": c["created_by"],
            "participantUids": derive_participant_uids(participants_docs),
        }
        if c["location"] is not None:
            doc["location"] = c["location"]
        doc["version"] = version_de_competition(doc)
        out.append(doc)
    return out


def version_de_competition(doc: dict) -> str:
    """L'empreinte d'une compétition telle qu'elle est en base (FRE-162).

    ⚠️ Sur le document RECOMPOSÉ, pas sur les lignes : le PATCH réinsère
    participants et essais avec de nouveaux identifiants — une empreinte qui les
    contiendrait changerait pour un contenu identique.

    ⚠️ Et d'un ordre qui ne dépend que du CONTENU : on trie la sérialisation des
    participants plutôt que de reposer sur l'ordre d'une requête. Une version qui
    bougerait d'une lecture à l'autre ferait refuser des écritures légitimes.
    """
    canon = {k: v for k, v in doc.items() if k != "version"}
    canon["participants"] = sorted(json.dumps(p, sort_keys=True) for p in doc.get("participants") or [])
    canon["participantUids"] = sorted(doc.get("participantUids") or [])
    return empreinte([[json.dumps(canon, sort_keys=True, default=str)]])


def version_actuelle(session, legacy_id: str) -> str:
    """La version de UNE compétition, relue dans la transaction en cours.

    Par `recompose_all`, bornée à elle : UNE seule définition de la
    recomposition, sans relire le club entier sous le verrou d'écriture.
    """
    cid = session.execute(text("SELECT id FROM competitions WHERE legacy_id = :l"),
                          {"l": legacy_id}).scalar()
    return next(c["version"] for c in recompose_all(session, cid=cid) if c["id"] == legacy_id)


def load_participants_internal(session, cid) -> list[dict]:
    """Recharge les participants existants au format INTERNE.

    Sert au PATCH qui change les mouvements sans toucher aux participants : ils
    sont réinsérés tels quels.
    """
    parts = session.execute(
        text(
            "SELECT id, athlete_id, name, competes_on, bodyweight_kg, gender, weight_category "
            "FROM competition_participants WHERE competition_id = :cid ORDER BY name"
        ),
        {"cid": cid},
    ).mappings().all()
    attempts = session.execute(
        text(
            f"SELECT {_ATTEMPTS_COLS} FROM competition_attempts ca "
            "JOIN competition_movements cm ON cm.id = ca.movement_id "
            "WHERE cm.competition_id = :cid ORDER BY ca.participant_id, cm.position, ca.attempt_index"
        ),
        {"cid": cid},
    ).mappings().all()

    att_by_part: dict = {}
    for a in attempts:
        att_by_part.setdefault(a["participant_id"], {}).setdefault(a["movement"], []).append(
            # ⚠️ La MÊME liste que celle d'`_essai_saisi`, en une seule définition :
            # un champ ajouté d'un seul côté rendrait le garde-fou aveugle à ce champ.
            {k: a[k] for k in _CHAMPS_D_ESSAI}
        )

    out: list[dict] = []
    for p in parts:
        movs = att_by_part.get(p["id"], {})
        out.append(
            {
                "name": p["name"], "athlete_id": p["athlete_id"],
                "competes_on": iso(p["competes_on"]) if p["competes_on"] is not None else None,
                "bodyweight_kg": p["bodyweight_kg"], "gender": p["gender"],
                "weight_category": p["weight_category"],
                "movements": [{"name": mv, "attempts": movs[mv]} for mv in movs],
            }
        )
    return out


def load_movement_names(session, cid) -> list[str]:
    return [
        r[0]
        for r in session.execute(
            text("SELECT movement FROM competition_movements WHERE competition_id = :cid ORDER BY position"),
            {"cid": cid},
        ).all()
    ]


def competition_row(session, comp_id: str):
    row = session.execute(
        text("SELECT id, start_date, end_date FROM competitions WHERE legacy_id = :c"),
        {"c": comp_id},
    ).first()
    if row is None:
        raise ErreurMetier("competition_introuvable", status.HTTP_404_NOT_FOUND, "compétition introuvable")
    return row


def days(start, end) -> list[str]:
    """Tous les jours de la compétition, bornes incluses.

    Chaque coach se déclare jour par jour.
    """
    from datetime import date, timedelta

    d0, d1 = date.fromisoformat(iso(start)), date.fromisoformat(iso(end or start))
    return [(d0 + timedelta(days=i)).isoformat() for i in range((d1 - d0).days + 1)]


# --------------------------------------------------------------------------- #
# Les requêtes, une fonction chacune — ce que les gestionnaires appellent
# --------------------------------------------------------------------------- #


def del_comp(session, *, cid):
    return session.execute(DEL_COMP, {"cid": cid})


def upsert_avail(session, *, cid, uid, day, status):
    return session.execute(UPSERT_AVAIL_SQL, {"cid": cid, "uid": uid, "day": day, "status": status})


def select_comp(session, *, legacy):
    return session.execute(SELECT_COMP_SQL, {"legacy": legacy}).first()


def structure_du_coach(session, *, uid):
    return session.execute(STRUCTURE_DU_COACH_SQL, {"uid": uid}).scalar()


def coachs_de_la_comp(session, *, cid):
    return session.execute(COACHS_DE_LA_COMP_SQL, {"cid": cid}).all()


def structure_de_comp(session, *, legacy):
    return session.execute(STRUCTURE_DE_COMP_SQL, {"legacy": legacy}).scalar()


def avail(session, *, cid):
    return session.execute(AVAIL_SQL, {"cid": cid}).all()


def coach_avail(session, *, uid, structures):
    return session.execute(COACH_AVAIL_SQL, {"uid": uid, "structures": structures}).all()


def inserer_la_competition(session, comp_params: dict, *, created_by: str, structure):
    return session.execute(
        INSERT_COMP_SQL, {**comp_params, "created_by": created_by, "structure": structure}).scalar()


def remplacer_la_meta(session, cid, comp_params: dict) -> None:
    """Le PUT : `created_by` et `structure` ne bougent pas."""
    session.execute(
        text("UPDATE competitions SET name = :name, start_date = :start_date, end_date = :end_date, "
             "location = :location, max_attempts = :max_attempts WHERE id = :cid"),
        {**comp_params, "cid": cid},
    )


def jours_de_passage(session, cid) -> list:
    """(nom, jour) des participants qui ont un jour de passage."""
    return session.execute(
        text("SELECT name, competes_on FROM competition_participants "
             "WHERE competition_id = :cid AND competes_on IS NOT NULL"),
        {"cid": cid},
    ).all()


def ecrire_la_competition(session, set_clauses: list[str], params: dict) -> None:
    """Le PATCH : `set_clauses` est bâti par le gestionnaire sur des noms de colonne CLOS."""
    session.execute(text(f"UPDATE competitions SET {', '.join(set_clauses)} WHERE id = :cid"), params)


def structure_par_competition(session) -> dict:
    return dict(session.execute(text("SELECT legacy_id, structure FROM competitions")).all())


def competitions_de_mes_athletes(session, uid: str) -> set:
    """Celles où concourt un athlète que je coache — le meet partagé."""
    return {r[0] for r in session.execute(text(
        "SELECT DISTINCT k.legacy_id FROM competition_participants cp "
        "JOIN athletes a ON a.id = cp.athlete_id JOIN competitions k ON k.id = cp.competition_id "
        f"WHERE {porte_un_lien('coach')}"), {"uid": uid}).all()}


# Les athlètes de la structure de la compétition, pour l'écran d'inscription
# (FRE-190). Les archivés restent : une compétition passée continue de les nommer.
_INSCRIPTIBLES_SQL = text(
    "SELECT a.legacy_id, a.first_name, a.last_name, a.user_uid, a.weight_kg, a.gender "
    "FROM athletes a JOIN competitions k ON k.structure = a.structure "
    "WHERE k.legacy_id = :legacy ORDER BY a.first_name, a.last_name")


def athletes_inscriptibles(session, *, legacy) -> list[dict]:
    return [
        {"id": r["legacy_id"], "firstName": r["first_name"] or "", "lastName": r["last_name"] or "",
         "linkedUserId": r["user_uid"],
         "weight": float(r["weight_kg"]) if r["weight_kg"] is not None else None,
         "gender": r["gender"]}
        for r in session.execute(_INSCRIPTIBLES_SQL, {"legacy": legacy}).mappings().all()
    ]
