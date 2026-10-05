"""Les bilans en base : la copie du modèle, les comptes, la recherche, la mise en forme.

⚠️ L'appartenance à l'athlète fait partie de la RECHERCHE (`_UN_SQL`,
`bilan_ou_404`) : le bilan d'un autre athlète n'existe pas — 404, pas 403.
⚠️ « Renseigné » n'est pas « a une ligne » : toutes les lignes naissent avec le
bilan, c'est `_PORTE_QUELQUE_CHOSE` qui compte.
⚠️ Un résultat montre SES médias (`bilan_resultat_medias`, un instantané), jamais
ceux du test courant.
"""

from fastapi import status
from sqlalchemy import text

from app.kine import mediatheque
from app.socle.erreurs import ErreurMetier

MEDIAS_DU_RESULTAT = mediatheque.sql_medias(
    "bilan_resultat_medias", "resultat_id", "r.id")

RESULTATS_SQL = text(
    f"""
    SELECT r.id, r.test_id, r.test_libelle, r.rubrique_libelle, r.protocole,
           r.vues, r.cible, r.mesure, r.bilateral, r.ordre,
           r.ressenti, r.detail, r.mesure_gauche, r.mesure_droite,
           r.charge_kg, r.materiel,
           -- ⚠️ LES IMAGES DU RÉSULTAT, PAS CELLES DU TEST. C'est toute la
           -- différence entre montrer la consigne d'alors et celle
           -- d'aujourd'hui : `bilan_resultat_medias` est un instantané.
           {MEDIAS_DU_RESULTAT} AS medias
    FROM bilan_resultats r
    WHERE r.bilan_id = CAST(:bid AS uuid)
    ORDER BY r.ordre NULLS LAST, r.test_libelle
    """
)

# Les modèles proposables à la création : ni archivés, ni vides.
MODELES_DISPO_SQL = text(
    """
    SELECT m.id, m.nom, m.description, m.archive,
           (SELECT count(*) FROM bilan_tests t
            JOIN bilan_rubriques r ON r.id = t.rubrique_id
            WHERE r.modele_id = m.id AND NOT t.retire) AS nb_tests
    FROM bilan_modeles m
    WHERE NOT m.archive
    ORDER BY m.nom
    """
)

# Le dernier bilan de l'athlète, pour pré-remplir les antécédents (§3.7).
DERNIERS_ANTECEDENTS_SQL = text(
    "SELECT antecedents FROM bilans WHERE athlete_id = :aid AND antecedents IS NOT NULL "
    "ORDER BY bilan_date DESC, cree_le DESC LIMIT 1"
)

# ⚠️ La copie du modèle, en UN SEUL ordre. `INSERT … SELECT` plutôt qu'une boucle
# Python : un aller-retour, et surtout une copie ATOMIQUE — un bilan à moitié
# constitué n'existe jamais.
COPIER_TESTS_SQL = text(
    """
    INSERT INTO bilan_resultats
        (bilan_id, test_id, test_libelle, rubrique_libelle, protocole, vues,
         cible, mesure, bilateral, ordre, charge_kg, materiel)
    SELECT CAST(:bid AS uuid), t.id, t.libelle, r.libelle, t.protocole, t.vues,
           t.cible, t.mesure, t.bilateral,
           row_number() OVER (ORDER BY r.ordre, t.ordre), t.charge_kg, t.materiel
    FROM bilan_tests t JOIN bilan_rubriques r ON r.id = t.rubrique_id
    WHERE r.modele_id = CAST(:mid AS uuid) AND NOT t.retire
    """
)


# ⚠️ Un SECOND ordre plutôt qu'une CTE, et c'est `test_id` qui le permet : chaque
# résultat garde l'identité du test dont il vient, la correspondance
# source → copie est déjà dans la table. Une CTE `RETURNING` volerait le
# `rowcount` de `COPIER_TESTS_SQL` — celui qui détecte un modèle vide. Deux ordres
# dans la MÊME transaction sont tout aussi atomiques.
COPIER_MEDIAS_SQL = text(
    """
    INSERT INTO bilan_resultat_medias (resultat_id, media_id, ordre)
    SELECT r.id, tm.media_id, tm.ordre
    FROM bilan_resultats r JOIN bilan_test_medias tm ON tm.test_id = r.test_id
    WHERE r.bilan_id = CAST(:bid AS uuid)
    """
)

_ATHLETE_SQL = text("SELECT id FROM athletes WHERE legacy_id = :legacy")

# ⚠️ « RENSEIGNÉ » n'est pas « a une ligne ». Toutes les lignes existent dès la
# création (la copie du modèle) : compter les lignes donnerait un bilan vierge
# complet. Ce qui compte, c'est qu'un champ PORTE quelque chose — c'est sur ce
# compte qu'on décide de reprendre ou de finaliser.
_PORTE_QUELQUE_CHOSE = """
    (r.ressenti IS NOT NULL OR r.detail IS NOT NULL
     OR r.mesure_gauche IS NOT NULL OR r.mesure_droite IS NOT NULL)
"""

COMPTES = f"""
    (SELECT count(*) FROM bilan_resultats r WHERE r.bilan_id = b.id) AS total,
    (SELECT count(*) FROM bilan_resultats r WHERE r.bilan_id = b.id
     AND {_PORTE_QUELQUE_CHOSE}) AS renseignes
"""


LISTE_SQL = text(
    f"""
    SELECT b.id, b.bilan_date, b.statut, b.kine_uid, b.modele_nom, {COMPTES}
    FROM bilans b
    WHERE b.athlete_id = :aid
    ORDER BY b.bilan_date DESC, b.cree_le DESC
    """
)

_UN_SQL = text(
    f"""
    SELECT b.id, b.bilan_date, b.statut, b.kine_uid, b.modele_nom,
           b.antecedents, b.notes, b.cree_le, b.modifie_le, {COMPTES}
    FROM bilans b
    WHERE b.id = CAST(:bid AS uuid) AND b.athlete_id = :aid
    """
)


def uuid_athlete(session, legacy: str) -> str:
    uuid = session.execute(_ATHLETE_SQL, {"legacy": legacy}).scalar()
    if uuid is None:
        raise ErreurMetier("athlete_introuvable", status.HTTP_404_NOT_FOUND,
                           "athlète introuvable")
    return uuid


def bilan_ou_404(session, bilan_id: str, aid: str):
    ligne = session.execute(_UN_SQL, {"bid": bilan_id, "aid": aid}).mappings().first()
    if ligne is None:
        raise ErreurMetier("bilan_introuvable", status.HTTP_404_NOT_FOUND,
                           "bilan introuvable")
    return ligne


def _num(v) -> float | None:
    """Le nombre en `float`, `None` restant `None`.

    ⚠️ Pas de `or 0` : il replierait un test NON RÉALISÉ sur un échec complet,
    ce que la base distingue.
    """
    return None if v is None else float(v)


def resume(ligne) -> dict:
    return {
        "id": str(ligne["id"]),
        "date": ligne["bilan_date"],
        "statut": ligne["statut"],
        "kineUid": ligne["kine_uid"],
        "modeleNom": ligne["modele_nom"],
        "testsRenseignes": ligne["renseignes"],
        "testsTotal": ligne["total"],
    }


def resultat_lu(r) -> dict:
    return {
        "id": str(r["id"]),
        "testId": str(r["test_id"]) if r["test_id"] else None,
        "testLibelle": r["test_libelle"],
        "rubriqueLibelle": r["rubrique_libelle"],
        "protocole": r["protocole"],
        "vues": list(r["vues"] or []),
        "cible": r["cible"],
        "mesure": r["mesure"],
        "bilateral": r["bilateral"],
        "ordre": r["ordre"],
        "ressenti": r["ressenti"],
        "detail": r["detail"],
        "mesureGauche": _num(r["mesure_gauche"]),
        "mesureDroite": _num(r["mesure_droite"]),
        "chargeKg": _num(r["charge_kg"]),
        "materiel": r["materiel"],
        # ⚠️ Des URL SIGNÉES, jamais des chemins. Signer est un calcul local : le
        # faire par image ne coûte ni appel réseau ni quota.
        "medias": mediatheque.liste_lue(r["medias"]),
    }


# --------------------------------------------------------------------------- #
# Lectures et écritures — ce que les gestionnaires appellent
# --------------------------------------------------------------------------- #

#: camelCase du contrat → colonne, pour la méta d'un bilan et pour un résultat.
_COLONNES_META = {"date": "bilan_date", "antecedents": "antecedents",
                  "notes": "notes", "statut": "statut"}
_COLONNES_RESULTAT = {"ressenti": "ressenti", "detail": "detail",
                      "mesureGauche": "mesure_gauche", "mesureDroite": "mesure_droite",
                      "chargeKg": "charge_kg"}


def modeles_disponibles(session) -> list:
    return session.execute(MODELES_DISPO_SQL).mappings().all()


def bilans_de(session, aid: str) -> list:
    return session.execute(LISTE_SQL, {"aid": aid}).mappings().all()


def resultats_de(session, bilan_id: str) -> list:
    return session.execute(RESULTATS_SQL, {"bid": bilan_id}).mappings().all()


def modele_a_copier_ou_404(session, modele_id: str):
    """Le modèle dont un bilan va copier les tests.

    Raises:
        ErreurMetier: `modele_introuvable` (404).
    """
    modele = session.execute(text(
        "SELECT id, nom FROM bilan_modeles WHERE id = CAST(:mid AS uuid)"),
        {"mid": modele_id}).mappings().first()
    if modele is None:
        raise ErreurMetier("modele_introuvable", status.HTTP_404_NOT_FOUND,
                           "modèle de bilan introuvable")
    return modele


def kine_de_l_athlete(session, aid: str) -> str | None:
    return session.execute(
        text("SELECT kine_uid FROM athletes WHERE id = :a"), {"a": aid}).scalar()


def derniers_antecedents(session, aid: str):
    return session.execute(DERNIERS_ANTECEDENTS_SQL, {"aid": aid}).scalar()


def ouvrir_un_bilan(session, *, aid: str, modele_id: str, modele_nom: str, date,
                    kine_uid: str | None, antecedents):
    """Insère le bilan, SANS ses résultats : `copier_les_tests` les fait naître."""
    return session.execute(text(
        "INSERT INTO bilans (athlete_id, modele_id, modele_nom, bilan_date, "
        "kine_uid, antecedents) "
        "VALUES (:aid, CAST(:mid AS uuid), :nom, :d, :kine, :ant) RETURNING id"),
        {"aid": aid, "mid": modele_id, "nom": modele_nom,
         "d": date, "kine": kine_uid, "ant": antecedents}).scalar()


def copier_les_tests(session, bilan_id: str, modele_id: str) -> int:
    """Le nombre de tests copiés — zéro dit que le modèle est VIDE."""
    return session.execute(COPIER_TESTS_SQL, {"bid": bilan_id, "mid": modele_id}).rowcount


def copier_les_medias(session, bilan_id: str) -> None:
    session.execute(COPIER_MEDIAS_SQL, {"bid": bilan_id})


def ecrire_la_meta(session, bilan_id: str, champs: dict) -> None:
    sets = ", ".join(f"{_COLONNES_META[k]} = :{k}" for k in champs)
    session.execute(text(
        f"UPDATE bilans SET {sets}, modifie_le = now() WHERE id = CAST(:bid AS uuid)"),
        {**champs, "bid": bilan_id})


def resultat_ou_404(session, resultat_id: str, bilan_id: str):
    """⚠️ L'appartenance au bilan fait partie de la RECHERCHE.

    Raises:
        ErreurMetier: `resultat_introuvable` (404).
    """
    resultat = session.execute(text(
        "SELECT mesure, bilateral FROM bilan_resultats "
        "WHERE id = CAST(:rid AS uuid) AND bilan_id = CAST(:bid AS uuid)"),
        {"rid": resultat_id, "bid": bilan_id}).mappings().first()
    if resultat is None:
        raise ErreurMetier("resultat_introuvable", status.HTTP_404_NOT_FOUND,
                           "résultat introuvable dans ce bilan")
    return resultat


def ecrire_un_resultat(session, bilan_id: str, resultat_id: str, champs: dict) -> None:
    """Écrit le résultat ET horodate le bilan qui le porte."""
    sets = ", ".join(f"{_COLONNES_RESULTAT[k]} = :{k}" for k in champs)
    session.execute(text(
        f"UPDATE bilan_resultats SET {sets}, modifie_le = now() "
        "WHERE id = CAST(:rid AS uuid)"), {**champs, "rid": resultat_id})
    session.execute(text(
        "UPDATE bilans SET modifie_le = now() WHERE id = CAST(:bid AS uuid)"),
        {"bid": bilan_id})


def supprimer_le_bilan(session, bilan_id: str) -> None:
    session.execute(text("DELETE FROM bilans WHERE id = CAST(:bid AS uuid)"),
                    {"bid": bilan_id})
