"""Écriture de l'arbre d'entraînement dans Postgres — utilitaire de TEST.

⚠️ CE FICHIER S'APPELAIT `scripts/etl_training_tree.py`, ET IL MENTAIT SUR SON
MÉTIER. C'était l'ETL Firestore → Postgres de FRE-12 : `extract()` lisait les 604
documents de l'arbre, `load()` les écrivait. La bascule faite et Firestore coupé
le 20/08, `extract()` et son `main()` ne pouvaient plus rien lire — le module
`app.firestore` qu'ils importaient n'existe même plus.

Mais `load()`, lui, N'A JAMAIS CESSÉ DE SERVIR : huit fichiers de test s'en
servent pour semer un arbre complet en Postgres. Supprimer le script les aurait
tous cassés, et c'est ce qui a révélé la vraie nature de ce code — un
CONSTRUCTEUR D'ARBRE, pas un transporteur de données.

Il vit donc désormais dans `tests/`, avec ses seuls utilisateurs, amputé de tout
ce qui parlait à Firestore. `sauver_objectifs`/`restaurer_objectifs` restent :
ils protègent les objectifs de bloc pendant un rechargement, et les tests de
FRE-12 les éprouvent.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import text


# --------------------------------------------------------------------------- #
# Normalisation — la valeur du coach est préservée, seule la FORME est corrigée
# --------------------------------------------------------------------------- #

def _texte(v) -> str | None:
    """'' et les non-chaînes → None. Le reste est rendu tel quel, espaces rognés."""
    if not isinstance(v, str):
        return None
    s = v.strip()
    return s or None


def _variantes(v) -> list[str] | None:
    """Chaîne OU liste → liste d'atomes (FRE-33). None si rien."""
    brut = [v] if isinstance(v, str) else v
    if not isinstance(brut, list):
        return None
    out = [s.strip() for s in brut if isinstance(s, str) and s.strip()]
    return out or None


def _entier(v) -> int | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return int(v)
    if isinstance(v, str) and v.strip().lstrip("-").isdigit():
        return int(v.strip())
    return None


def _tier(v) -> int | None:
    """Hors 1-3 → None : la colonne porte un CHECK, et un tier 0 ne veut rien dire."""
    n = _entier(v)
    return n if n in (1, 2, 3) else None


def _decimal(v) -> float | None:
    """Poids/taille de l'instantané. Accepte la virgule."""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v) or None
    if isinstance(v, str):
        try:
            return float(v.strip().replace(",", ".")) or None
        except ValueError:
            return None
    return None


def _booleen(v) -> bool:
    """`weightLocked` vaut la chaîne 'true' côté Firestore ; `hidden` un vrai bool."""
    if isinstance(v, bool):
        return v
    return isinstance(v, str) and v.strip().lower() == "true"


def _date(v) -> str | None:
    """ISO 'YYYY-MM-DD'. Une date illisible devient None ET une anomalie."""
    s = _texte(v)
    if not s:
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date().isoformat()
    except ValueError:
        return None


def _horodatage(dt) -> datetime | None:
    """`update_time` Firestore → `datetime` ordinaire, à la microseconde.

    Firestore rend un `DatetimeWithNanoseconds` et Postgres stocke la
    microseconde. L'aller-retour reste égal SANS cette conversion — vérifié : la
    classe de Google hérite la comparaison de `datetime`, qui ignore les
    nanosecondes. On convertit quand même, pour que l'égalité dont dépend tout le
    delta repose sur le type standard et non sur ce détail d'implémentation d'une
    bibliothèque tierce."""
    if dt is None:
        return None
    return datetime(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second,
                    dt.microsecond, tzinfo=dt.tzinfo)


def _vocabulaire(v, permises: set[str]) -> str | None:
    """Hors vocabulaire → None. La colonne porte un CHECK : y pousser une valeur
    inconnue ferait tomber TOUT le chargement pour une ligne fautive."""
    s = _texte(v)
    return s if s in permises else None


_REPS_UNIT = {"count", "sec"}
_INCREMENT_UNIT = {"kg", "reps", "rpe", "sets"}
_KIND = {"training", "warmup", "rehab"}

# Colonnes jsonb. psycopg REFUSE d'adapter un dict ou une liste de dicts sans
# cast explicite (« cannot adapt type 'dict' ») : on sérialise et on caste. Les
# colonnes text[] (`variant`, `selected_principals`, `felt_rpe_by_set`), elles,
# s'adaptent naturellement depuis une liste de chaînes.
_JSONB = {"day_split", "granularity"}


def _bind(col: str) -> str:
    return f"CAST(:{col} AS jsonb)" if col in _JSONB else f":{col}"


def _valeurs(d: dict) -> dict:
    return {k: (json.dumps(v) if k in _JSONB and v is not None else v) for k, v in d.items()}


# --------------------------------------------------------------------------- #
# EXTRACT
# --------------------------------------------------------------------------- #

@dataclass
class Arbre:
    macros: list[dict] = field(default_factory=list)
    compte: Counter = field(default_factory=Counter)
    anomalies: Counter = field(default_factory=Counter)
    # Programmes dont l'arbre a été lu INTÉGRALEMENT. C'est le périmètre — et la
    # seule autorisation — de l'élagage : on ne supprime que sous un parent dont
    # on vient de voir la totalité des enfants. Vide par défaut, donc pas
    # d'élagage : un appelant qui ne le renseigne pas (les tests) ne risque rien.
    programmes_lus: list[str] = field(default_factory=list)


def _ligne_prescription(src: dict) -> dict:
    """Partie COMMUNE à un exercice de séance et à une ligne de BASE.

    Les colonnes portent les mêmes noms des deux côtés — c'est la correction de
    fond de FRE-33 : `movement`/`name` et `variation`/`variant` désignaient la
    même chose sous deux noms, si bien qu'on corrigeait un arbre en oubliant
    l'autre."""
    return {
        # `kind` est commun aux trois tables depuis la correction de FRE-10 :
        # une ligne de BASE peut être un échauffement ou du kiné, et c'est même
        # là que le coach le saisit. Aucune BASE réelle n'en porte encore — mais
        # l'ETL doit savoir le charger, sous peine de le perdre à la prochaine
        # passe une fois la fonctionnalité en service.
        "kind": _vocabulaire(src.get("kind"), _KIND),
        "variant": _variantes(src.get("variant") if "variant" in src else src.get("variation")),
        "format": _texte(src.get("format")),
        "cluster_mode": _texte(src.get("clusterMode")),
        "cluster_rest": _texte(src.get("clusterRest")),
        "tempo": _texte(src.get("tempo")),
        "sets": _texte(src.get("sets")),
        "reps": _texte(src.get("reps")),
        "reps_unit": _vocabulaire(src.get("repsUnit"), _REPS_UNIT),
        "weight": _texte(src.get("weight")),
        "weight_locked": _booleen(src.get("weightLocked")),
        "assistance": _texte(src.get("assistance")),
        "aimed_rpe": _texte(src.get("aimedRPE")),
        "rest": _texte(src.get("rest")),
        "coach_note": _texte(src.get("coachNote")),
        "increment": _texte(src.get("increment")),
        "increment_unit": _vocabulaire(src.get("incrementUnit"), _INCREMENT_UNIT),
    }


def _upsert(conn, table: str, cle: tuple[str, ...], valeurs: dict) -> str:
    """INSERT … ON CONFLICT (cle) DO UPDATE, renvoie l'id — pour câbler les enfants.

    L'upsert sur (parent, legacy_id) est ce qui rend l'ETL rejouable : une
    seconde passe met à jour au lieu de dupliquer."""
    cols = ", ".join(valeurs)
    binds = ", ".join(_bind(c) for c in valeurs)
    maj = ", ".join(f"{c} = EXCLUDED.{c}" for c in valeurs if c not in cle)
    sql = (f"INSERT INTO {table} ({cols}) VALUES ({binds}) "
           f"ON CONFLICT ({', '.join(cle)}) DO UPDATE SET {maj} RETURNING id")
    return conn.execute(text(sql), _valeurs(valeurs)).scalar()


def _insert_lignes(conn, table: str, parent_col: str, parent_id: str, lignes: list[dict]) -> None:
    """Les lignes filles sont REMPLACÉES en bloc : leur identité est leur position,
    pas un id Firestore (elles vivent dans un tableau JSON, sans clé propre)."""
    conn.execute(text(f"DELETE FROM {table} WHERE {parent_col} = :p"), {"p": parent_id})
    for ligne in lignes:
        # ⚠️ MÊME RÈGLE QUE LA PRODUCTION (FRE-123) : un nom vide est une
        # ABSENCE, pas une chaîne. Le contrat d'écriture le convertit par
        # `vide_en_none` ; ce chargeur court-circuite Pydantic, il doit donc
        # l'appliquer lui-même — sinon il sème un `''` que la clé étrangère vers
        # la bibliothèque refuse, et le test échoue pour une raison qui n'est pas
        # la sienne.
        for cle in ("name", "exercise", "movement"):
            if cle in ligne and isinstance(ligne[cle], str) and not ligne[cle].strip():
                ligne[cle] = None
        cols = ", ".join([parent_col, *ligne])
        binds = ", ".join([f":{parent_col}", *(_bind(c) for c in ligne)])
        conn.execute(text(f"INSERT INTO {table} ({cols}) VALUES ({binds})"),
                     {parent_col: parent_id, **_valeurs(ligne)})


def _index(conn, table: str, parent_col: str) -> dict[tuple[str, str], tuple[str, datetime | None]]:
    """(parent, legacy_id) → (id, horodatage source), pour toute la table.

    UNE requête par niveau, et non une par objet : c'est ce qui rend le delta
    rentable. Interroger les 604 documents un par un coûterait 604 allers-retours
    — 18 s depuis un poste de travail, soit plus que le gain espéré."""
    lignes = conn.execute(text(
        f"SELECT {parent_col}, legacy_id, id, source_updated_at FROM {table}")).all()
    return {(str(r[0]), r[1]): (str(r[2]), r[3]) for r in lignes}


# Au-delà de cette part d'un niveau, l'élagage REFUSE de s'exécuter. Perdre un
# quart de l'arbre d'un coup n'est pas un week-end de ménage, c'est une lecture
# Firestore incomplète ou un périmètre mal calculé — et la transaction entière
# est annulée plutôt que de le découvrir après coup.
_PART_MAX_ELAGUEE = 0.25

# …mais une POIGNÉE n'est jamais un emballement, quelle qu'en soit la proportion.
# Sans ce plancher, la règle se retourne contre les petits ensembles : supprimer
# une semaine sur trois déclencherait le refus, alors que c'est le geste le plus
# ordinaire qui soit. Le garde-fou vise la catastrophe, pas le ménage.
_MIN_ELAGUE_AVANT_REFUS = 5


def _elaguer(conn, arbre: Arbre, vus: dict[str, set[str]]) -> Counter:
    """Supprime ce qui a DISPARU de Firestore depuis la dernière passe.

    Sans ça, le delta ne serait qu'additif : une semaine effacée par le coach
    survivrait indéfiniment en Postgres. C'est le même défaut que celui de l'ETL
    complet, qui a demandé `--purge` — ici il se règle sans rien vider.

    PÉRIMÈTRE : uniquement sous les programmes déclarés LUS INTÉGRALEMENT. Un
    parent qu'on n'a pas parcouru ne peut pas dire ce qui lui manque."""
    supprime = Counter()
    if not arbre.programmes_lus:
        return supprime

    # Du haut vers le bas : supprimer un macro emporte ses blocs par la cascade,
    # ce qui évite de les compter deux fois.
    niveaux = [
        ("macros", "training_macros", "SELECT id FROM training_macros WHERE program_id = ANY(:p)"),
        ("blocs", "training_blocks",
         "SELECT b.id FROM training_blocks b JOIN training_macros m ON m.id = b.macro_id "
         "WHERE m.program_id = ANY(:p)"),
        ("semaines", "training_weeks",
         "SELECT w.id FROM training_weeks w JOIN training_blocks b ON b.id = w.block_id "
         "JOIN training_macros m ON m.id = b.macro_id WHERE m.program_id = ANY(:p)"),
    ]
    for cle, table, sql in niveaux:
        presents = {str(r[0]) for r in conn.execute(text(sql), {"p": arbre.programmes_lus}).all()}
        a_jeter = presents - vus[cle]
        if not a_jeter:
            continue
        if (len(a_jeter) > _MIN_ELAGUE_AVANT_REFUS
                and len(a_jeter) > _PART_MAX_ELAGUEE * max(len(presents), 1)):
            raise RuntimeError(
                f"élagage refusé : {len(a_jeter)}/{len(presents)} {cle} à supprimer, "
                f"soit plus de {_PART_MAX_ELAGUEE:.0%}. Lecture Firestore incomplète ? "
                f"Vérifier avant de forcer (un rechargement complet reste possible "
                f"avec --purge).")
        conn.execute(text(f"DELETE FROM {table} WHERE id = ANY(CAST(:ids AS uuid[]))"),
                     {"ids": list(a_jeter)})
        supprime[cle] = len(a_jeter)
    return supprime


def load(conn, arbre: Arbre, delta: bool = False) -> Counter:
    """Charge l'arbre. En mode `delta`, ne réécrit que ce que Firestore a touché.

    Le repère est `source_updated_at`, l'horodatage du document source. Sauter un
    document, c'est sauter TOUT ce qu'il porte : une semaine inchangée épargne ses
    séances et ses exercices, et c'est là que vit l'essentiel du volume (12 615
    lignes sur 15 034 sont des feuilles).

    Le mode complet reste le défaut, et reste la référence : c'est lui qu'on joue
    après un `--purge`, et lui qui sert à prouver que le delta ne ment pas."""
    ecrit = Counter()
    connu = {t: _index(conn, t, p) for t, p in (
        ("training_macros", "program_id"),
        ("training_blocks", "macro_id"),
        ("training_weeks", "block_id"),
    )} if delta else {}
    vus: dict[str, set[str]] = {"macros": set(), "blocs": set(), "semaines": set()}

    def _inchange(table: str, parent_id: str, objet: dict) -> str | None:
        """L'id de l'objet SI son document source n'a pas bougé, sinon None."""
        if not delta:
            return None
        existant = connu[table].get((str(parent_id), objet["legacy_id"]))
        if existant is None or existant[1] is None:
            return None
        return existant[0] if existant[1] == objet["source_updated_at"] else None

    for macro in arbre.macros:
        blocs = macro.pop("blocs")
        macro_id = _inchange("training_macros", macro["program_id"], macro)
        if macro_id is None:
            macro_id = _upsert(conn, "training_macros", ("program_id", "legacy_id"), macro)
            ecrit["macros"] += 1
        else:
            ecrit["macros_inchanges"] += 1
        vus["macros"].add(str(macro_id))

        for bloc in blocs:
            principes, accessoires = bloc.pop("principes"), bloc.pop("accessoires")
            semaines = bloc.pop("semaines")
            bloc_id = _inchange("training_blocks", macro_id, bloc)
            if bloc_id is None:
                bloc_id = _upsert(conn, "training_blocks", ("macro_id", "legacy_id"),
                                  {"macro_id": macro_id, **bloc})
                ecrit["blocs"] += 1
                # La BASE vit DANS le document bloc : son horodatage la couvre.
                _insert_lignes(conn, "training_base_principles", "block_id", bloc_id, principes)
                _insert_lignes(conn, "training_base_accessories", "block_id", bloc_id, accessoires)
                ecrit["principes"] += len(principes)
                ecrit["accessoires"] += len(accessoires)
            else:
                ecrit["blocs_inchanges"] += 1
            vus["blocs"].add(str(bloc_id))

            for semaine in semaines:
                seances = semaine.pop("seances")
                semaine_id = _inchange("training_weeks", bloc_id, semaine)
                if semaine_id is not None:
                    ecrit["semaines_inchangees"] += 1
                    vus["semaines"].add(str(semaine_id))
                    continue
                semaine_id = _upsert(conn, "training_weeks", ("block_id", "legacy_id"),
                                     {"block_id": bloc_id, **semaine})
                ecrit["semaines"] += 1
                vus["semaines"].add(str(semaine_id))
                # Séances et exercices vivent DANS le document semaine : ils sont
                # remplacés en bloc, comme les lignes de BASE sous leur bloc.
                conn.execute(text("DELETE FROM training_sessions WHERE week_id = :w"),
                             {"w": semaine_id})
                for seance in seances:
                    exercices = seance.pop("exercices")
                    seance_id = _upsert(conn, "training_sessions", ("week_id", "legacy_id"),
                                        {"week_id": semaine_id, **seance})
                    ecrit["seances"] += 1
                    _insert_lignes(conn, "training_exercises", "session_id", seance_id, exercices)
                    ecrit["exercices"] += len(exercices)

    # L'élagage appartient au mode DELTA, et à lui seul. Sans lui, `--apply`
    # supprimait en silence — le compte rendu annonçait « en base est un CUMUL »
    # au moment même où il venait de retirer un macro. Un chargement additif doit
    # rester additif : c'est ce que son bilan promet.
    if delta:
        for cle, n in _elaguer(conn, arbre, vus).items():
            ecrit[f"{cle}_supprimes"] = n
    return ecrit


# --------------------------------------------------------------------------- #

# Hôtes considérés comme LOCAUX. Tout le reste est une base vivante.
_HOTES_LOCAUX = ("localhost", "127.0.0.1", "::1")


def database_url(env_path: str = ".env") -> str:
    for line in open(env_path):
        if line.startswith("DATABASE_URL="):
            url = line.split("=", 1)[1].strip()
            return url.replace("postgresql://", "postgresql+psycopg://").replace(
                "postgres://", "postgresql+psycopg://")
    sys.exit(f"DATABASE_URL introuvable dans {env_path}")


_COLONNES_OBJECTIF = ("position", "exercise", "variant", "format", "sets", "reps",
                      "weight_min", "weight_max", "assistance")


def sauver_objectifs(conn) -> list[dict]:
    """Les objectifs de bloc, désignés par des identités qui SURVIVENT à la purge.

    ⚠️ CE QUE CETTE FONCTION EMPÊCHE. `block_objectives` n'existe QUE dans
    Postgres — ces lignes ont été migrées le 2026-08-03 et Firestore ne les porte
    plus. Or elles référencent le bloc par une clé étrangère `ON DELETE CASCADE`,
    donc un TRUNCATE de l'arbre les emporte, et l'ETL ne saurait pas les
    reconstruire : elles seraient perdues pour de bon. Constaté sur la base de
    travail — 346 objectifs à zéro après la première purge.

    On les relève donc par les identités LEGACY (programme + id Firestore du macro
    et du bloc), les seules stables d'une passe à l'autre : les uuid, eux, sont
    refrappés à chaque rechargement."""
    return [dict(r) for r in conn.execute(text(f"""
        SELECT m.program_id, m.legacy_id AS macro_legacy, b.legacy_id AS block_legacy,
               {', '.join('o.' + c for c in _COLONNES_OBJECTIF)}
        FROM block_objectives o
        JOIN training_blocks b ON b.id = o.block_id
        JOIN training_macros m ON m.id = b.macro_id
    """)).mappings().all()]


def restaurer_objectifs(conn, sauvegarde: list[dict]) -> tuple[int, int]:
    """Réattache les objectifs aux blocs RECHARGÉS. Rend (restaurés, orphelins).

    Un orphelin veut dire que son bloc n'existe plus dans Firestore : ce n'est
    pas rattrapable ici, mais ça doit se VOIR — d'où le compte rendu."""
    remis = orphelins = 0
    cols = ", ".join(_COLONNES_OBJECTIF)
    binds = ", ".join(f":{c}" for c in _COLONNES_OBJECTIF)
    for o in sauvegarde:
        bloc = conn.execute(text(
            "SELECT b.id FROM training_blocks b JOIN training_macros m ON m.id = b.macro_id "
            "WHERE m.program_id = :p AND m.legacy_id = :ml AND b.legacy_id = :bl"),
            {"p": o["program_id"], "ml": o["macro_legacy"], "bl": o["block_legacy"]}).scalar()
        if bloc is None:
            orphelins += 1
            continue
        conn.execute(text(f"INSERT INTO block_objectives (block_id, {cols}) "
                          f"VALUES (:bid, {binds})"),
                     {"bid": bloc, **{c: o[c] for c in _COLONNES_OBJECTIF}})
        remis += 1
    return remis, orphelins


# Les sept tables de l'arbre, et le nom sous lequel l'extraction les compte.
# Le compteur des inchangés porte l'accord en genre : « semaines inchangées ».
_CLE_INCHANGE = {"macros": "macros_inchanges", "blocs": "blocs_inchanges",
                 "semaines": "semaines_inchangees"}

_TABLES_ARBRE = {
    "macros": "training_macros", "blocs": "training_blocks",
    "semaines": "training_weeks", "seances": "training_sessions",
    "exercices": "training_exercises", "principes": "training_base_principles",
    "accessoires": "training_base_accessories",
}

