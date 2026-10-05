"""Les primitives d'écriture dans l'arbre, sans HTTP (FRE-45).

Créer un bloc, une semaine, une séance, une ligne — partagées par les routes de
création, de duplication et de génération.

⚠️ Les ids rendus sont ALIGNÉS sur ce que le client a envoyé, même ordre et même
longueur : sinon il attribue le mauvais id à la mauvaise ligne, et chaque frappe
part sur un objet fantôme.

⚠️ Les numéros viennent du SERVEUR (`inserer_avec_numero`), sous contrainte
d'unicité (FRE-134).
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text

from fastapi import status

from app.entrainement.prescription import COLONNES_LIGNE, COLONNES_PAR_TABLE, normaliser_groupes, valeur_ligne
from app.entrainement.schemas_training_structure import BlockCreate, WeekCreate
from app.socle.erreurs import ErreurMetier

def COLONNE_SQL(cle: str) -> str:
    """Traduit une clé camelCase en colonne.

    `day` n'est pas dans la table des lignes d'exercice (une séance n'a pas de
    jour) : il se traduit à l'identique."""
    return COLONNES_LIGNE.get(cle, cle)


def date_ou_none(v):
    """Traduit `''` en NULL : une colonne `date` refuse la chaîne vide.

    ⚠️ Nécessaire ICI parce que le contenu d'une semaine (`sessions[]`) est un
    dictionnaire LIBRE : Pydantic ne valide que les champs déclarés, et le front
    écrit « pas de date » par `''`."""
    return v or None



def prochain_numero(conn, table: str, parent_col: str, parent_id) -> int:
    """Rend le prochain numéro libre sous ce parent — calculé par le SERVEUR.

    Le client ne voit qu'un arbre potentiellement périmé : lui laisser le numéro
    ouvre la porte aux collisions.

    ⚠️ `max + 1` et NON `count + 1`. Sur une donnée contiguë les deux coïncident ;
    sur une donnée TROUÉE, `count + 1` peut tomber sur un numéro déjà pris (sur
    2-3-4, il rend 4), `max + 1` jamais."""
    return conn.execute(
        text(f"SELECT coalesce(max(number), 0) + 1 FROM {table} WHERE {parent_col} = :p"),
        {"p": parent_id}).scalar()


def inserer_avec_numero(conn, table: str, parent_col: str, parent_id, inserer):
    """Alloue un numéro, insère, et RÉESSAIE UNE FOIS si quelqu'un a pris le même.

    ⚠️ `max + 1` est une LECTURE, et deux lecteurs lisent le même maximum
    (FRE-134) : double clic, deux onglets, rejeu de la file hors ligne. Sans
    garde, deux semaines portent le même numéro, et le Tracking les fusionne sur
    `(week_number, session_index)` (FRE-59).

    La contrainte `UNIQUE (parent, number)` transforme le doublon muet en erreur ;
    ce réessai transforme l'erreur en geste réussi : le perdant relit le maximum,
    qui a bougé.

    ⚠️ Un POINT DE REPRISE (`begin_nested`), pas un `try` nu : une violation
    abandonne la transaction Postgres entière, et emporterait tout ce que
    l'appelant a déjà écrit.

    ⚠️ UNE SEULE FOIS : deux écrivains simultanés, c'est le cas réel. La seconde
    collision remonte en erreur, bruyamment.

    ⚠️ La contrainte est `DEFERRABLE INITIALLY IMMEDIATE` — déférABLE pour que
    `metier_training_structure.recompacter` traverse un état à doublon, IMMEDIATE
    pour que la violation surgisse ici et non au COMMIT, quand plus personne ne
    peut recalculer.
    """
    from sqlalchemy.exc import IntegrityError

    for derniere in (False, True):
        numero = prochain_numero(conn, table, parent_col, parent_id)
        point = conn.begin_nested()
        try:
            resultat = inserer(numero)
        except IntegrityError as erreur:
            point.rollback()
            if derniere or "_number_unique" not in str(getattr(erreur, "orig", erreur)):
                raise
            continue
        point.commit()
        return resultat



def retrouver(conn, table: str, parent_col: str, parent_id, objet_id) -> str:
    """L'objet que le client voulait créer existe déjà : rend son id si c'est
    le sien, refuse sinon.

    ⚠️ C'EST CE QUI REND UNE CRÉATION REJOUABLE. Le front garde un `POST` fait
    sans réseau et le renvoie au retour, avec l'identité qu'il avait choisie ;
    `ON CONFLICT (id) DO NOTHING` a rendu `NULL`, et on retrouve ici l'objet du
    premier envoi. Sous un AUTRE parent, l'identité n'est pas la sienne : un
    client ne se sert pas d'un id pour écrire là où il n'a rien créé.

    Raises:
        ErreurMetier: `identifiant_pris` (409)."""
    parent = conn.execute(text(f"SELECT {parent_col} FROM {table} WHERE id = CAST(:id AS uuid)"),
                          {"id": str(objet_id)}).scalar()
    if parent is None or str(parent) != str(parent_id):
        raise ErreurMetier("identifiant_pris", status.HTTP_409_CONFLICT,
                           detail="cet identifiant désigne déjà un autre objet")
    return str(objet_id)


def creer_seances(conn, week_id, seances: list[dict[str, Any]]) -> list[dict]:
    """Insère les séances d'une semaine et rend LEURS IDS, alignés sur la requête.

    ⚠️ L'ALIGNEMENT : le chargement en masse ÉCARTE les lignes sans nom (résidus
    d'édition), et le client doit associer chaque ligne envoyée à l'identité
    reçue. La liste rendue a donc la MÊME LONGUEUR que celle reçue, avec `null` là
    où la ligne a été écartée — sinon le client devine le décalage, et faux."""
    sortie = []
    for position, seance in enumerate(seances):
        session_id = conn.execute(text(
            "INSERT INTO training_sessions (week_id, legacy_id, position, name, "
            "session_date, form_of_the_day) "
            "VALUES (:w, gen_random_uuid()::text, :p, :name, :d, :f) RETURNING id"),
            {"w": week_id, "p": position, "name": seance.get("name") or f"Séance {position + 1}",
             "d": date_ou_none(seance.get("sessionDate")),
             "f": seance.get("formOfTheDay") or None}).scalar()
        # ⚠️ Une nature par groupe (FRE-36) : les séances arrivent en dictionnaires
        # LIBRES — chargement en masse, duplication, génération — où deux lignes
        # liées peuvent annoncer deux natures.
        exercices = seance.get("exercises") or []
        normaliser_groupes(exercices)
        lignes, rang = [], 0
        for exo in exercices:
            # `rang` et non l'index de la requête : les positions en base restent
            # CONTIGUËS même quand une ligne est écartée, et le réordonnancement
            # raisonne en positions.
            ligne_id = inserer_ligne(conn, "training_exercises", "session_id",
                                      session_id, rang, exo)
            if ligne_id is not None:
                rang += 1
            lignes.append(ligne_id)
        sortie.append({"id": str(session_id), "exercises": lignes})
    return sortie


def creer_semaine(conn, block_id, payload: WeekCreate) -> dict:
    """Crée la semaine ET son contenu, celui-ci étant fourni par l'APPELANT.

    La génération depuis la BASE et la semaine suivante calculent leur contenu
    côté serveur (`generation_semaine.py`, `semaine_suivante.py`) et ne passent
    pas par ici.

    Rend l'ARBRE des ids créés, et pas seulement celui de la semaine : sans les
    ids des séances et des lignes, le client ne peut rien persister avant le
    prochain refetch, et chaque frappe dans l'intervalle est perdue."""
    instantane = payload.athlete or {}
    week_id = inserer_avec_numero(conn, "training_weeks", "block_id", block_id, lambda numero: conn.execute(text(
        "INSERT INTO training_weeks (block_id, legacy_id, number, name, hidden, "
        "start_date, end_date, athlete_weight_kg, athlete_height_cm) "
        "VALUES (:b, gen_random_uuid()::text, :n, :name, :hid, :d1, :d2, :w, :h) RETURNING id"),
        {"b": block_id, "n": numero, "name": payload.name, "hid": payload.hidden,
         "d1": date_ou_none(payload.startDate), "d2": date_ou_none(payload.endDate),
         # Le poids et la taille viennent de l'instantané `athlete`, une seule
         # façon de les dire — deux auraient demandé de trancher les conflits.
         "w": instantane.get("weight") or None,
         "h": instantane.get("height") or None}).scalar())

    return {"week": str(week_id),
            "sessions": creer_seances(conn, week_id, payload.sessions)}



#: Les tables où une ligne SANS NOM est une ligne LÉGITIME, et non un résidu.
#:
#: ⚠️ La distinction est celle du GESTE, pas du contenu (FRE-119, FRE-144).
#: `PUT /base` remplace la trame ENTIÈRE, et son seul écrivain est l'éditeur : une
#: ligne sans nom y est une ligne que le coach vient d'ajouter. L'écarter répond
#: 200 à une écriture qui n'écrit pas, et la ligne DISPARAÎT à la relecture.
#:
#: ⚠️ Les lignes de SÉANCE gardent la règle inverse : elles arrivent par
#: chargement en masse — duplication, semaine suivante, génération — où une ligne
#: sans nom est un résidu d'édition. La séance neuve, qui en veut une VRAIE,
#: l'insère explicitement (`create_next_week`, `routes_training_structure.py`).
SANS_NOM_ACCEPTE: frozenset[str] = frozenset({
    "training_base_principles", "training_base_accessories",
})


def inserer_ligne(conn, table: str, parent_col: str, parent_id, position: int,
                   src: dict[str, Any]) -> str | None:
    """Insère une ligne de prescription — d'exercice ou de BASE — et rend son id.

    Les champs inconnus sont IGNORÉS et non rejetés : le client envoie l'objet
    qu'il manipule. Rend `None` si la ligne a été ÉCARTÉE faute de nom, ce qui
    n'arrive que hors de `SANS_NOM_ACCEPTE`."""
    permises = COLONNES_PAR_TABLE[table]
    fourni = {k: valeur_ligne(k, v) for k, v in src.items() if k in permises}
    if not fourni.get("name"):
        if table not in SANS_NOM_ACCEPTE:
            return None
        # ⚠️ `NULL` et non `''`, comme la ligne d'amorce d'une séance (FRE-123) :
        # la colonne RÉFÉRENCE la bibliothèque, où aucune entrée ne s'appelle
        # `''` — une chaîne vide violerait la clé étrangère, donc 500. La lecture
        # reconvertit en `''` pour le front.
        fourni["name"] = None
    # Seules les colonnes de CETTE table partent (`COLONNES_PAR_TABLE`) : un
    # accessoire porte un `day` et pas de tier, un principe l'inverse. Une
    # colonne de trop fait un `UndefinedColumn`, donc un 500.
    cols = ", ".join([parent_col, "position", *(COLONNE_SQL(k) for k in fourni)])
    binds = ", ".join([":parent", ":position", *(f":{k}" for k in fourni)])
    return str(conn.execute(text(f"INSERT INTO {table} ({cols}) VALUES ({binds}) RETURNING id"),
                            {"parent": parent_id, "position": position, **fourni}).scalar())



def creer_bloc(conn, macro_id, payload: BlockCreate) -> dict:
    base = payload.base or {}
    block_id = inserer_avec_numero(conn, "training_blocks", "macro_id", macro_id, lambda numero: conn.execute(text(
        "INSERT INTO training_blocks (id, macro_id, legacy_id, number, name, start_date, "
        "end_date, day_split, selected_principals, granularity, s1_start_date, s1_end_date) "
        "VALUES (coalesce(CAST(:id AS uuid), gen_random_uuid()), :m, gen_random_uuid()::text, "
        ":n, :name, :d1, :d2, CAST(:ds AS jsonb), :sp, CAST(:g AS jsonb), :s1, :s2) "
        "ON CONFLICT (id) DO NOTHING RETURNING id"),
        {"id": str(payload.id) if payload.id else None,
         "m": macro_id, "n": numero, "name": payload.name,
         "d1": payload.startDate, "d2": payload.endDate,
         "ds": json_ou_none(base.get("daySplit")), "sp": base.get("selectedPrincipaux"),
         "g": json_ou_none(base.get("granularity")),
         # ⚠️ `date_ou_none`, pas `.get()` nu : `base` arrive ici en dictionnaire
         # LIBRE (`BlockCreate.base: dict[str, Any]`), sans le `DateISO` qui
         # garde `PUT /blocks/{id}/base`. La lecture rend `''` quand la trame
         # n'a pas de dates S1 : dupliquer un bloc en renvoyant ce que
         # `GET /training` donne partirait en 500.
         "s1": date_ou_none(base.get("s1StartDate")),
         "s2": date_ou_none(base.get("s1EndDate"))}).scalar())
    if block_id is None:
        # Un rejeu : le bloc, ses lignes et sa semaine sont déjà là.
        return {"block": retrouver(conn, "training_blocks", "macro_id", macro_id, payload.id)}

    # ⚠️ LES LIGNES DE LA BASE AUSSI, pas seulement sa configuration : c'est ce
    # chemin qui sert à DUPLIQUER un macro ou un bloc. Sans elles, la perte est
    # silencieuse — le front affiche son clone optimiste, principes compris, puis
    # le refetch le remplace par une BASE vide, sans erreur ni journal.
    for table, cle in (("training_base_principles", "principles"),
                       ("training_base_accessories", "accessories")):
        for position, ligne in enumerate(base.get(cle) or []):
            inserer_ligne(conn, table, "block_id", block_id, position, ligne)

    ids = {"block": str(block_id)}
    if payload.week is not None:
        ids |= creer_semaine(conn, block_id, payload.week)
    return ids



def json_ou_none(v):
    import json
    return json.dumps(v) if v is not None else None
