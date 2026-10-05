"""Les modèles de bilan en base : le catalogue, la lecture en arbre, les recherches.

⚠️ L'appartenance au modèle fait partie de la RECHERCHE (`rubrique_ou_404`,
`test_ou_404`) : une rubrique ou un test d'un autre modèle n'existe pas — 404.
⚠️ Le compte de tests (`NB_TESTS`) ignore les tests RETIRÉS : il annonce ce qu'un
bilan contiendrait.
⚠️ Les images d'un test se REPOSENT en entier (`reposer_les_images`), et se
lisent en URL signées, jamais en chemins.
"""

from fastapi import status
from sqlalchemy import text

from app.kine import mediatheque
from app.socle.erreurs import ErreurMetier

# ⚠️ `NOT t.retire` dans le compte : le catalogue annonce ce qu'un bilan
# CONTIENDRAIT, pas l'historique des tests que la kiné a écartés.
NB_TESTS = """
    (SELECT count(*) FROM bilan_tests t
     JOIN bilan_rubriques r ON r.id = t.rubrique_id
     WHERE r.modele_id = m.id AND NOT t.retire)
"""


LISTE_SQL = text(
    f"SELECT m.id, m.nom, m.description, m.archive, {NB_TESTS} AS nb_tests "
    "FROM bilan_modeles m ORDER BY m.archive, m.nom"
)

_UN_SQL = text(
    f"SELECT m.id, m.nom, m.description, m.archive, {NB_TESTS} AS nb_tests "
    "FROM bilan_modeles m WHERE m.id = CAST(:mid AS uuid)"
)

RUBRIQUES_SQL = text(
    "SELECT id, libelle, ordre FROM bilan_rubriques "
    "WHERE modele_id = CAST(:mid AS uuid) ORDER BY ordre, libelle"
)

# Les images du test, agrégées — jamais jointes (cf. `mediatheque.sql_medias`).
MEDIAS_DU_TEST = mediatheque.sql_medias("bilan_test_medias", "test_id", "t.id")

_TESTS_SQL = text(
    f"""
    SELECT t.id, t.rubrique_id, t.libelle, t.protocole, t.mesure, t.bilateral,
           t.charge_kg, t.materiel, t.vues, t.cible, t.ordre, t.retire,
           {MEDIAS_DU_TEST} AS medias
    FROM bilan_tests t
         JOIN bilan_rubriques r ON r.id = t.rubrique_id
    WHERE r.modele_id = CAST(:mid AS uuid)
    ORDER BY r.ordre, t.ordre
    """
)


def _num(v) -> float | None:
    """Le nombre en `float`, `None` restant `None`.

    ⚠️ Pas de `or 0` : il inventerait une charge.
    """
    return None if v is None else float(v)


def test_lu(r) -> dict:
    return {
        "id": str(r["id"]), "libelle": r["libelle"], "protocole": r["protocole"],
        "mesure": r["mesure"], "bilateral": r["bilateral"],
        "chargeKg": _num(r["charge_kg"]), "materiel": r["materiel"],
        "vues": list(r["vues"] or []), "cible": r["cible"],
        "ordre": r["ordre"], "retire": r["retire"],
        # ⚠️ Des URL SIGNÉES, jamais des chemins. Signer est un calcul local : le
        # faire par image ne coûte ni appel réseau ni quota.
        "medias": mediatheque.liste_lue(r["medias"] if "medias" in r.keys() else []),
    }


def reposer_les_images(session, test_id: str, media_ids: list[str]) -> None:
    """Remplace la liste ENTIÈRE des images du test, dans l'ordre reçu.

    ⚠️ On REPOSE, on ne différencie pas : ajout, retrait et changement d'ordre
    tiennent dans une seule liste à l'écran. C'est IDEMPOTENT — la même requête
    rejouée laisse le même état.

    ⚠️ Les DOUBLONS sont écartés ici plutôt que laissés heurter la clé primaire :
    une image deux fois dans un test est un double-clic, et un 500 y répondrait
    mal.
    """
    session.execute(text("DELETE FROM bilan_test_medias WHERE test_id = CAST(:t AS uuid)"),
                    {"t": test_id})
    vus: set[str] = set()
    for ordre, media_id in enumerate(m for m in media_ids if not (m in vus or vus.add(m))):
        session.execute(text(
            "INSERT INTO bilan_test_medias (test_id, media_id, ordre) "
            "VALUES (CAST(:t AS uuid), CAST(:m AS uuid), :o)"),
            {"t": test_id, "m": media_id, "o": ordre})


def resume(r) -> dict:
    return {
        "id": str(r["id"]), "nom": r["nom"], "description": r["description"],
        "archive": r["archive"], "nbTests": r["nb_tests"],
    }


def modele_ou_404(session, modele_id: str):
    ligne = session.execute(_UN_SQL, {"mid": modele_id}).mappings().first()
    if ligne is None:
        raise ErreurMetier("modele_introuvable", status.HTTP_404_NOT_FOUND,
                           "modèle de bilan introuvable")
    return ligne


def rubrique_ou_404(session, rubrique_id: str, modele_id: str):
    """La rubrique, cherchée DANS son modèle.

    ⚠️ L'appartenance fait partie de la recherche : sans elle, une rubrique d'un
    autre modèle s'éditerait par son seul identifiant.

    Raises:
        ErreurMetier: `rubrique_introuvable` (404).
    """
    ligne = session.execute(text(
        "SELECT id FROM bilan_rubriques WHERE id = CAST(:rid AS uuid) "
        "AND modele_id = CAST(:mid AS uuid)"),
        {"rid": rubrique_id, "mid": modele_id}).first()
    if ligne is None:
        raise ErreurMetier("rubrique_introuvable", status.HTTP_404_NOT_FOUND,
                           "rubrique introuvable")
    return ligne


def test_ou_404(session, test_id: str, modele_id: str):
    ligne = session.execute(text(
        "SELECT t.id FROM bilan_tests t JOIN bilan_rubriques r ON r.id = t.rubrique_id "
        "WHERE t.id = CAST(:tid AS uuid) AND r.modele_id = CAST(:mid AS uuid)"),
        {"tid": test_id, "mid": modele_id}).first()
    if ligne is None:
        raise ErreurMetier("test_introuvable", status.HTTP_404_NOT_FOUND,
                           "test introuvable")
    return ligne


def lire_modele(session, modele_id: str) -> dict:
    ligne = modele_ou_404(session, modele_id)
    rubriques = session.execute(RUBRIQUES_SQL, {"mid": modele_id}).mappings().all()
    tests = session.execute(_TESTS_SQL, {"mid": modele_id}).mappings().all()
    par_rubrique: dict[str, list] = {}
    for t in tests:
        par_rubrique.setdefault(str(t["rubrique_id"]), []).append(test_lu(t))
    return {
        **resume(ligne),
        "rubriques": [
            {"id": str(r["id"]), "libelle": r["libelle"], "ordre": r["ordre"],
             "tests": par_rubrique.get(str(r["id"]), [])}
            for r in rubriques
        ],
    }


# --------------------------------------------------------------------------- #
# Lectures et écritures — ce que les gestionnaires appellent
# --------------------------------------------------------------------------- #

#: camelCase du contrat → colonne d'un test.
_COLONNES_TEST = {"libelle": "libelle", "protocole": "protocole", "mesure": "mesure",
                  "bilateral": "bilateral", "chargeKg": "charge_kg",
                  "materiel": "materiel", "vues": "vues", "cible": "cible",
                  "ordre": "ordre", "retire": "retire"}


def modeles(session) -> list:
    return session.execute(LISTE_SQL).mappings().all()


def creer_le_modele(session, nom: str, description, uid: str):
    return session.execute(text(
        "INSERT INTO bilan_modeles (nom, description, cree_par) "
        "VALUES (:nom, :desc, :uid) RETURNING id"),
        {"nom": nom, "desc": description, "uid": uid}).scalar()


def dupliquer_le_contenu(session, source_id: str, modele_id) -> None:
    """Recopie rubriques, tests NON retirés et images de `source_id` dans `modele_id`."""
    for r in session.execute(RUBRIQUES_SQL, {"mid": source_id}).mappings().all():
        nouvelle = session.execute(text(
            "INSERT INTO bilan_rubriques (modele_id, libelle, ordre) "
            "VALUES (CAST(:mid AS uuid), :l, :o) RETURNING id"),
            {"mid": modele_id, "l": r["libelle"], "o": r["ordre"]}).scalar()
        # ⚠️ TEST PAR TEST, parce que les images sont une table à part. Un
        # `INSERT … SELECT` d'un seul tenant ne rend pas la CORRESPONDANCE
        # source → copie, qu'il faut pour recopier les liens ; la rétablir par
        # `ordre` supposerait qu'il soit unique dans la rubrique, et rien ne le
        # garantit. Une boucle dans la même transaction est aussi atomique.
        for t in session.execute(text(
            "SELECT id, libelle, protocole, mesure, bilateral, charge_kg, "
            "materiel, vues, cible, ordre FROM bilan_tests "
            "WHERE rubrique_id = CAST(:source AS uuid) AND NOT retire"),
                {"source": str(r["id"])}).mappings().all():
            copie = session.execute(text(
                """
                INSERT INTO bilan_tests
                    (rubrique_id, libelle, protocole, mesure, bilateral,
                     charge_kg, materiel, vues, cible, ordre)
                VALUES (CAST(:nouvelle AS uuid), :libelle, :protocole,
                        :mesure, :bilateral, :charge, :materiel, :vues,
                        :cible, :ordre)
                RETURNING id
                """),
                {"nouvelle": nouvelle, "libelle": t["libelle"],
                 "protocole": t["protocole"], "mesure": t["mesure"],
                 "bilateral": t["bilateral"], "charge": t["charge_kg"],
                 "materiel": t["materiel"], "vues": t["vues"],
                 "cible": t["cible"], "ordre": t["ordre"]}).scalar()
            # ⚠️ Les IMAGES suivent : un modèle dupliqué qui perdrait ses photos
            # obligerait à les rattacher une à une.
            session.execute(text(
                "INSERT INTO bilan_test_medias (test_id, media_id, ordre) "
                "SELECT CAST(:copie AS uuid), media_id, ordre "
                "FROM bilan_test_medias WHERE test_id = :source"),
                {"copie": copie, "source": t["id"]})


def ecrire_le_modele(session, modele_id: str, champs: dict) -> None:
    sets = ", ".join(f"{k} = :{k}" for k in champs)
    session.execute(text(
        f"UPDATE bilan_modeles SET {sets}, modifie_le = now() "
        "WHERE id = CAST(:mid AS uuid)"), {**champs, "mid": modele_id})


def bilans_qui_utilisent(session, modele_id: str) -> int:
    return session.execute(text(
        "SELECT count(*) FROM bilans WHERE modele_id = CAST(:mid AS uuid)"),
        {"mid": modele_id}).scalar()


def supprimer_le_modele(session, modele_id: str) -> None:
    session.execute(text("DELETE FROM bilan_modeles WHERE id = CAST(:mid AS uuid)"),
                    {"mid": modele_id})


def ajouter_une_rubrique(session, modele_id: str, libelle: str) -> None:
    """À LA FIN : l'ordre se règle ensuite, sans bousculer l'existant."""
    ordre = session.execute(text(
        "SELECT coalesce(max(ordre), -1) + 1 FROM bilan_rubriques "
        "WHERE modele_id = CAST(:mid AS uuid)"), {"mid": modele_id}).scalar()
    session.execute(text(
        "INSERT INTO bilan_rubriques (modele_id, libelle, ordre) "
        "VALUES (CAST(:mid AS uuid), :l, :o)"),
        {"mid": modele_id, "l": libelle, "o": ordre})


def ecrire_la_rubrique(session, rubrique_id: str, champs: dict) -> None:
    sets = ", ".join(f"{k} = :{k}" for k in champs)
    session.execute(text(
        f"UPDATE bilan_rubriques SET {sets} WHERE id = CAST(:rid AS uuid)"),
        {**champs, "rid": rubrique_id})


def tests_de_la_rubrique(session, rubrique_id: str) -> int:
    return session.execute(text(
        "SELECT count(*) FROM bilan_tests WHERE rubrique_id = CAST(:rid AS uuid)"),
        {"rid": rubrique_id}).scalar()


def supprimer_la_rubrique(session, rubrique_id: str) -> None:
    session.execute(text("DELETE FROM bilan_rubriques WHERE id = CAST(:rid AS uuid)"),
                    {"rid": rubrique_id})


def ajouter_un_test(session, rubrique_id: str, payload):
    """À LA FIN de sa rubrique. Rend la ligne créée, telle que `test_lu` l'attend."""
    ordre = session.execute(text(
        "SELECT coalesce(max(ordre), -1) + 1 FROM bilan_tests "
        "WHERE rubrique_id = CAST(:rid AS uuid)"), {"rid": rubrique_id}).scalar()
    return session.execute(text(
        """
        INSERT INTO bilan_tests
            (rubrique_id, libelle, protocole, mesure, bilateral, charge_kg,
             materiel, vues, cible, ordre)
        VALUES (CAST(:rid AS uuid), :libelle, :protocole, :mesure, :bilateral,
                :charge, :materiel, :vues, :cible, :ordre)
        RETURNING id, libelle, protocole, mesure, bilateral, charge_kg,
                  materiel, vues, cible, ordre, retire
        """),
        {"rid": rubrique_id, "libelle": payload.libelle,
         "protocole": payload.protocole, "mesure": payload.mesure,
         "bilateral": payload.bilateral, "charge": payload.chargeKg,
         "materiel": payload.materiel, "vues": payload.vues,
         "cible": payload.cible, "ordre": ordre}).mappings().first()


def ecrire_le_test(session, test_id: str, champs: dict) -> None:
    sets = ", ".join(f"{_COLONNES_TEST[k]} = :{k}" for k in champs)
    session.execute(text(
        f"UPDATE bilan_tests SET {sets} WHERE id = CAST(:tid AS uuid)"),
        {**champs, "tid": test_id})


def test_avec_ses_medias(session, test_id: str):
    return session.execute(text(
        f"SELECT t.id, t.libelle, t.protocole, t.mesure, t.bilateral, t.charge_kg, "
        f"t.materiel, t.vues, t.cible, t.ordre, t.retire, "
        f"{MEDIAS_DU_TEST} AS medias "
        f"FROM bilan_tests t WHERE t.id = CAST(:tid AS uuid)"),
        {"tid": test_id}).mappings().first()


def resultats_qui_portent(session, test_id: str) -> int:
    return session.execute(text(
        "SELECT count(*) FROM bilan_resultats WHERE test_id = CAST(:tid AS uuid)"),
        {"tid": test_id}).scalar()


def supprimer_le_test(session, test_id: str) -> None:
    session.execute(text("DELETE FROM bilan_tests WHERE id = CAST(:tid AS uuid)"),
                    {"tid": test_id})
