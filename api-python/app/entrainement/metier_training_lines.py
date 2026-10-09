"""Les règles d'écriture d'une ligne de séance, côté base. Aucun gestionnaire HTTP ici.

  · l'APPARTENANCE : une ligne n'est à un programme que par la remontée complète
    (`_REMONTEE`) ; hors programme, c'est un 404, jamais un 403 ;
  · la renumérotation des positions, sans trou ;
  · les règles de GROUPE — nature, champs partagés, groupe chronométré, liens
    unbroken. Elles se rejouent après CHAQUE écriture qui touche le groupe ;
  · les moyennes par série, DÉRIVÉES ici et non au front (`DERIVEES`).
"""

from uuid import UUID

from fastapi import status
from sqlalchemy import text

from app.entrainement.arbre_creation import retrouver

from app.entrainement.prescription import (
    CHAMPS_COPIES, COLONNES_LIGNE, FORMAT_DE_LIGNE, NATURE_PAR_DEFAUT, NATURES_CHRONOMETREES,
    champs_de_groupe,
)
from app.socle.erreurs import ErreurMetier


# La remontée complète, utilisée par TOUTES les routes. Un exercice n'appartient
# à un programme que par cette chaîne — il n'y a pas de raccourci.
_REMONTEE = (
    "FROM training_exercises e "
    "JOIN training_sessions s ON s.id = e.session_id "
    "JOIN training_weeks w ON w.id = s.week_id "
    "JOIN training_blocks b ON b.id = w.block_id "
    "JOIN training_macros m ON m.id = b.macro_id "
)

# ⚠️ Les moyennes se dérivent ICI, pas dans le navigateur (FRE-136). Quand le
# tableau par série est fourni, `feltRPE`, `repsDone` et `weightDone` sont sa
# MOYENNE : des colonnes dérivées, calculées en SQL à l'écriture.
#
# ⚠️ Le scalaire envoyé AVEC son tableau est IGNORÉ, pas refusé. La file
# hors-ligne de l'athlète (IndexedDB, FRE-118) survit aux déploiements et rejoue
# d'anciens patchs `{tableau, scalaire}` : un 422 y perdrait une séance saisie.
#
# ⚠️ Le scalaire SEUL reste écrivable : sans tableau, ce n'est pas une dérivée,
# c'est la saisie elle-même.
DERIVEES = {
    "feltRPEBySet": ("felt_rpe", "ff_moyenne_rpe", "feltRPE"),
    "repsDoneBySet": ("reps_done", "ff_moyenne_serie", "repsDone"),
    "weightDoneBySet": ("weight_done", "ff_moyenne_serie", "weightDone"),
}


def derivations(fourni: dict) -> list[str]:
    """Rend les fragments `SET` que le SERVEUR calcule, et retire de `fourni` le scalaire dérivé.

    Modifie `fourni` en place.

    ⚠️ `CAST(… AS text[])` explicite : sans lui un tableau vide arrive en type
    inconnu, et Postgres ne sait pas laquelle des deux fonctions appeler.

    ⚠️ Un tableau VIDE envoyé AVEC son scalaire est un RETOUR AU GLOBAL — le seul
    cas où le scalaire survit au tableau :

      `{tableau: []}`              « j'efface ma saisie » : les deux colonnes se vident ;
      `{tableau: [], scalaire: v}` « je réponds pour la LIGNE » : le tableau se
                                   vide, et `v` est une saisie, pas une moyenne.

    Sans cette distinction, `ff_moyenne_rpe('{}')` rend `''` et efface le ressenti
    écrit dans le même patch : fermer un pli laisserait un tableau périmé, que le
    badge de séries (FRE-156) lit comme un pli ouvert.
    """
    frags = []
    for tableau, (colonne, fonction, scalaire) in DERIVEES.items():
        if tableau not in fourni:
            continue
        if not fourni[tableau] and scalaire in fourni:
            continue          # retour au global : le scalaire de l'appelant fait foi
        fourni.pop(scalaire, None)
        frags.append(f"{colonne} = {fonction}(CAST(:{tableau} AS text[]))")
    return frags


def _uuid_ou_404(valeur: str, quoi: str) -> str:
    """Rend `valeur` si c'est un uuid : un id mal formé est INTROUVABLE, pas un 500.

    Sans ce filtre, le `CAST(... AS uuid)` de chaque requête lève — et un vieux
    client envoie encore des ids Firestore.

    Raises:
        ErreurMetier: `objet_arbre_introuvable` (404).
    """
    try:
        UUID(valeur)
    except (ValueError, AttributeError, TypeError):
        raise ErreurMetier("objet_arbre_introuvable", status.HTTP_404_NOT_FOUND, detail=f"{quoi} introuvable") from None
    return valeur


def exercice(conn, program_id: str, exercise_id: str):
    """Rend la ligne, SI elle appartient à ce programme.

    ⚠️ 404 et non 403 : un code distinct confirmerait l'existence de la ligne d'un
    autre athlète.

    Raises:
        ErreurMetier: `exercice_introuvable` (404).
    """
    row = conn.execute(
        # `e.kind` décide qui a le droit de toucher la ligne (FRE-53). Lu ICI : seule
        # la requête d'appartenance garantit qu'on parle de la ligne de CE programme.
        text("SELECT e.id, e.session_id, e.position, e.group_id, e.kind "
             + _REMONTEE
             + "WHERE e.id = CAST(:eid AS uuid) AND m.program_id = :pid"),
        {"eid": _uuid_ou_404(exercise_id, "exercice"), "pid": program_id},
    ).mappings().first()
    if row is None:
        raise ErreurMetier("exercice_introuvable", status.HTTP_404_NOT_FOUND, detail="exercice introuvable")
    return row


def seance(conn, program_id: str, session_id: str):
    row = conn.execute(
        text("SELECT s.id FROM training_sessions s "
             "JOIN training_weeks w ON w.id = s.week_id "
             "JOIN training_blocks b ON b.id = w.block_id "
             "JOIN training_macros m ON m.id = b.macro_id "
             "WHERE s.id = CAST(:sid AS uuid) AND m.program_id = :pid"),
        {"sid": _uuid_ou_404(session_id, "séance"), "pid": program_id},
    ).mappings().first()
    if row is None:
        raise ErreurMetier("seance_introuvable", status.HTTP_404_NOT_FOUND, detail="séance introuvable")
    return row


def renumeroter(conn, session_id) -> None:
    """Repositionne les lignes de la séance de 0 à n-1, sans trou.

    La contrainte d'unicité est DEFERRABLE : les positions peuvent se croiser le
    temps de la transaction.
    """
    conn.execute(
        text("UPDATE training_exercises e SET position = t.rang - 1 FROM ("
             "  SELECT id, row_number() OVER (ORDER BY position) AS rang "
             "  FROM training_exercises WHERE session_id = :sid) t "
             "WHERE e.id = t.id AND e.position <> t.rang - 1"),
        {"sid": session_id},
    )


def nettoyer_groupe(conn, session_id, group_id: str | None) -> int:
    """Délie un groupe réduit à UN membre, et rend le nombre de lignes déliées (FRE-31).

    Un identifiant de groupe orphelin est invisible à l'écran par construction :
    seul le serveur peut le retirer.

    ⚠️ LA NATURE PART AVEC LE LIEN : le rescapé n'est plus dans un groupe. Lui
    laisser `group_kind` ferait croire à un groupe d'un seul membre (invariant
    `nature_sans_groupe`), et un liage futur ressusciterait cette nature-là
    plutôt que celle du groupe rejoint. Les deux colonnes se défont ensemble.
    """
    if not group_id:
        return 0
    return conn.execute(
        text("UPDATE training_exercises SET group_id = NULL, group_kind = NULL "
             "WHERE session_id = :sid AND group_id = :gid AND "
             "(SELECT count(*) FROM training_exercises "
             " WHERE session_id = :sid AND group_id = :gid) = 1"),
        {"sid": session_id, "gid": group_id},
    ).rowcount


def propager_la_nature(conn, session_id, group_id: str | None, nature: str | None) -> None:
    """Écrit la nature sur TOUT le groupe, pas sur la seule ligne patchée (FRE-36).

    ⚠️ Un groupe mi-bi-set mi-dropset n'a aucune lecture possible : l'en-tête
    afficherait l'une, les champs proposeraient l'autre. L'affordance du front ne
    suffit pas : elle ne vaut que pour le chemin qu'on a prévu.

    Sans `group_id`, les lignes HORS groupe de la séance repassent à NULL : une
    nature sans objet serait ressuscitée par un liage futur.

    ⚠️ UN GROUPE N'EST JAMAIS NU (FRE-145) : sans nature connue, il prend
    `NATURE_PAR_DEFAUT`, la même constante que `normaliser_groupes` pour les
    écritures en masse. Deux lignes liées sont un bi-set ou un dropset : il n'y
    a pas de `NULL` à écrire.

    C'est ce qui rend le LIAGE sûr : il part en deux PATCH indépendants — le lien
    sur les deux lignes, la nature sur une seule — que rien n'oblige à arriver
    dans l'ordre. Celui qui ne porte que le lien pose le défaut au lieu du vide,
    et le second requalifie le groupe entier.
    """
    if not group_id:
        conn.execute(
            text("UPDATE training_exercises SET group_kind = NULL WHERE session_id = :sid "
                 "AND (group_id IS NULL OR group_id = '')"),
            {"sid": session_id},
        )
        return
    conn.execute(
        text("UPDATE training_exercises SET group_kind = :nature "
             "WHERE session_id = :sid AND group_id = :gid"),
        {"sid": session_id, "gid": group_id, "nature": nature or NATURE_PAR_DEFAUT},
    )


def propager_les_champs_de_groupe(conn, ligne, fourni: dict) -> None:
    """Écrit sur tous les membres les champs du patch qui décrivent le GROUPE.

    ⚠️ La nature se lit EN BASE quand le patch ne la porte pas : un patch de
    `sets` seul ne la dit pas, et c'est elle qui décide si le NOM est partagé —
    sur un dropset oui, sur un bi-set non, où il écraserait le second mouvement.

    ⚠️ Sur un dropset, les descentes affichent « ↑ » PAR RÈGLE : un nom divergent
    n'y serait visible, donc corrigible, sur aucun écran.
    """
    gid = (fourni.get("groupId", ligne["group_id"]) or "").strip()
    if not gid:
        return
    nature = nature_du_groupe(conn, ligne["session_id"], gid)
    partages = [c for c in champs_de_groupe(fourni.get("groupKind") or nature) if c in fourni]
    if not partages:
        return
    sets_sql = ", ".join(f"{COLONNES_LIGNE[c]} = :{c}" for c in partages)
    conn.execute(
        text(f"UPDATE training_exercises SET {sets_sql} "
             "WHERE session_id = :sid AND group_id = :gid"),
        {**{c: fourni[c] for c in partages}, "sid": ligne["session_id"], "gid": gid},
    )


def aligner_un_groupe_chronometre(conn, session_id, group_id: str | None) -> None:
    """Donne UN temps à un EMOM ou un AMRAP de groupe, et retire le format de ses lignes.

    ⚠️ S'appelle après CHAQUE écriture qui touche le groupe, pas au seul
    changement de nature (FRE-116) : une ligne peut recevoir un format ensuite,
    ou une ligne neuve rejoindre le groupe avec le sien. Sinon c'est une
    demi-règle.

    Deux gestes :
      * le FORMAT de ligne s'efface : « AMRAP 5' » sur une ligne d'un AMRAP de
        groupe dirait deux temps pour un seul effort ;
      * les champs du groupe s'alignent sur la PREMIÈRE ligne qui en porte un,
        dans l'ordre de la séance — un bi-set passé en AMRAP garde ainsi la durée
        de sa première ligne comme durée du groupe.

    Sans effet sur les autres natures : un bi-set garde un format par ligne, et
    ses deux AMRAP peuvent avoir deux durées.
    """
    if not group_id:
        return
    nature = nature_du_groupe(conn, session_id, group_id)
    if nature not in NATURES_CHRONOMETREES:
        return
    effacer = ", ".join(f"{COLONNES_LIGNE[c]} = NULL" for c in FORMAT_DE_LIGNE)
    conn.execute(
        text(f"UPDATE training_exercises SET {effacer} "
             "WHERE session_id = :sid AND group_id = :gid"),
        {"sid": session_id, "gid": group_id},
    )
    for champ in champs_de_groupe(nature):
        col = COLONNES_LIGNE[champ]
        conn.execute(
            text(f"UPDATE training_exercises SET {col} = premiere.v FROM ("
                 f"  SELECT {col} AS v FROM training_exercises "
                 f"   WHERE session_id = :sid AND group_id = :gid AND {col} IS NOT NULL "
                 f"   ORDER BY position LIMIT 1) premiere "
                 "WHERE session_id = :sid AND group_id = :gid"),
            {"sid": session_id, "gid": group_id},
        )


def ranger_les_liens(conn, session_id) -> None:
    """Efface les liens UNBROKEN qui ne mènent à rien (FRE-116).

    Le lien dit « sans lâcher jusqu'à la SUIVANTE du groupe ». Délier, supprimer,
    déplacer ou dupliquer peut le laisser sur une ligne sans suivante — invisible
    à l'écran, et ressuscité au prochain liage.

    ⚠️ S'appelle après CHAQUE écriture qui touche la forme de la séance, pas
    seulement après un patch du lien. La même règle que
    `prescription.normaliser_groupes` pour les écritures en masse.
    """
    conn.execute(
        text("UPDATE training_exercises e SET unbroken = false "
             "WHERE e.session_id = :sid AND e.unbroken AND ("
             "  coalesce(e.group_id, '') = '' OR NOT EXISTS ("
             "    SELECT 1 FROM training_exercises n WHERE n.session_id = e.session_id "
             "       AND n.group_id = e.group_id AND n.position > e.position))"),
        {"sid": session_id},
    )


# --------------------------------------------------------------------------- #
# Lectures et écritures de LIGNE — ce que les gestionnaires appellent
# --------------------------------------------------------------------------- #

def nature_du_groupe(conn, session_id, group_id: str) -> str | None:
    """La nature que le groupe porte déjà en base."""
    return conn.execute(
        text("SELECT max(group_kind) FROM training_exercises "
             "WHERE session_id = :sid AND group_id = :gid"),
        {"sid": session_id, "gid": group_id},
    ).scalar()


def ecrire_la_ligne(conn, exercise_id: str, fourni: dict, derivees: list[str]) -> None:
    """Le PATCH : les champs fournis, plus les fragments que le serveur dérive."""
    sets_sql = ", ".join([f"{COLONNES_LIGNE[k]} = :{k}" for k in fourni] + derivees)
    conn.execute(
        text(f"UPDATE training_exercises SET {sets_sql} WHERE id = CAST(:eid AS uuid)"),
        {**fourni, "eid": exercise_id},
    )


def ajouter_en_fin_de_seance(conn, session_id: str, fourni: dict, ligne_id=None) -> tuple[str, bool]:
    """La position est calculée ICI : laissée au client, elle permettrait des collisions.

    Rend l'id de la ligne, et si elle EXISTAIT déjà — un rejeu (cf. `retrouver`)."""
    cols = "".join(f", {COLONNES_LIGNE[k]}" for k in fourni)
    binds = "".join(f", :{k}" for k in fourni)
    eid = conn.execute(
        text(f"INSERT INTO training_exercises (id, session_id, position{cols}) "
             f"SELECT coalesce(CAST(:id AS uuid), gen_random_uuid()), :sid, "
             f"coalesce(max(position) + 1, 0){binds} "
             f"FROM training_exercises WHERE session_id = :sid "
             f"ON CONFLICT (id) DO NOTHING RETURNING id"),
        {**fourni, "sid": session_id, "id": str(ligne_id) if ligne_id else None},
    ).scalar()
    if eid is None:
        return retrouver(conn, "training_exercises", "session_id", session_id, ligne_id), True
    return str(eid), False


def dupliquer_sous_son_groupe(conn, ligne, exercise_id: str):
    """Copie la prescription (`CHAMPS_COPIES`) sous la ligne — ou sous son GROUPE entier."""
    colonnes = ", ".join(COLONNES_LIGNE[k] for k in CHAMPS_COPIES)
    apres = ligne["position"]
    if ligne["group_id"]:
        apres = conn.execute(
            text("SELECT max(position) FROM training_exercises "
                 "WHERE session_id = :sid AND group_id = :gid"),
            {"sid": ligne["session_id"], "gid": ligne["group_id"]},
        ).scalar()
    # L'unicité (session, position) est DIFFÉRÉE : le décalage peut croiser des
    # positions le temps de la transaction.
    conn.execute(
        text("UPDATE training_exercises SET position = position + 1 "
             "WHERE session_id = :sid AND position > :apres"),
        {"sid": ligne["session_id"], "apres": apres},
    )
    return conn.execute(
        text(f"INSERT INTO training_exercises (session_id, position, {colonnes}) "
             f"SELECT session_id, :position, {colonnes} FROM training_exercises "
             f"WHERE id = CAST(:eid AS uuid) RETURNING id"),
        {"eid": exercise_id, "position": apres + 1},
    ).scalar()


def supprimer_la_ligne(conn, exercise_id: str) -> None:
    conn.execute(text("DELETE FROM training_exercises WHERE id = CAST(:eid AS uuid)"),
                 {"eid": exercise_id})


def ids_de_la_seance(conn, session_id: str) -> set[str]:
    return {
        str(r[0]) for r in conn.execute(
            text("SELECT id FROM training_exercises WHERE session_id = :sid"),
            {"sid": session_id}).all()
    }


def poser_l_ordre(conn, exercise_ids: list[str]) -> None:
    """Pose les positions dans l'ordre de la liste — UN UPDATE, pas un par ligne."""
    conn.execute(
        text("UPDATE training_exercises e SET position = t.ord - 1 "
             "FROM unnest(CAST(:ids AS uuid[])) WITH ORDINALITY AS t(id, ord) "
             "WHERE e.id = t.id"),
        {"ids": list(exercise_ids)},
    )


def meme_semaine(conn, session_a, session_b) -> bool:
    """Les deux séances sont-elles dans la même semaine ? Une requête, pas deux."""
    return bool(conn.execute(text(
        "SELECT (SELECT week_id FROM training_sessions WHERE id = CAST(:a AS uuid)) "
        "     = (SELECT week_id FROM training_sessions WHERE id = CAST(:b AS uuid))"),
        {"a": session_a, "b": session_b}).scalar())


def deplacer_vers(conn, ligne, session_id: str, position: int | None) -> list[str]:
    """Déplace la ligne — et son groupe entier, s'il y en a un — dans une autre
    séance, à la position demandée. Rend les ids déplacés, dans l'ordre.

    ⚠️ LE GROUPE SUIT, comme dans une séance (FRE-31) : ses membres restent
    consécutifs et gardent leur nature et leur identifiant. Une ligne seule qui
    quitterait son bi-set laisserait un orphelin d'un côté et un membre sans
    partenaire de l'autre.

    ⚠️ RIEN DU RÉALISÉ N'EST TOUCHÉ : l'id est le même, la charge et le ressenti
    restent sur la ligne. C'est ce que « supprimer puis recréer » ne sait pas faire.

    L'unicité de (séance, position) est DEFERRABLE : le décalage et l'insertion se
    croisent le temps de la transaction, puis `renumeroter` referme les trous.
    """
    if ligne["group_id"]:
        ids = [str(r[0]) for r in conn.execute(
            text("SELECT id FROM training_exercises WHERE session_id = :s AND group_id = :g ORDER BY position"),
            {"s": ligne["session_id"], "g": ligne["group_id"]}).all()]
    else:
        ids = [str(ligne["id"])]
    n = len(ids)
    total = conn.execute(text("SELECT count(*) FROM training_exercises WHERE session_id = CAST(:s AS uuid)"),
                         {"s": session_id}).scalar()
    rang = total if position is None or position > total else position
    conn.execute(text("UPDATE training_exercises SET position = position + :n "
                      "WHERE session_id = CAST(:s AS uuid) AND position >= :p"),
                 {"n": n, "s": session_id, "p": rang})
    conn.execute(text("UPDATE training_exercises e SET session_id = CAST(:s AS uuid), position = :p + t.ord - 1 "
                      "FROM unnest(CAST(:ids AS uuid[])) WITH ORDINALITY AS t(id, ord) "
                      "WHERE e.id = t.id"),
                 {"s": session_id, "p": rang, "ids": ids})
    return ids
