"""La bibliothèque d'exercices : une table `library_entries`, UNE PAR STRUCTURE (FRE-13).

Unique par (structure, category, name) : on ne recrée jamais une entrée
existante (409). Tout y est partagé dans la structure — pas de scope privé, pas
de DELETE. `competition` marque les lifts suivis en 1RM et n'a de sens que pour
`exercices` ; `supports` dit les groupes principaux qu'un renforcement soutient.

La LECTURE est ouverte à tout MEMBRE (FRE-78) — les athlètes la voient dans
leurs listes ; l'ÉCRITURE est au coach, dans SA structure.

⚠️ SQL portable (tests SQLite hermétiques) : pas de `CAST AS enum`, et l'uuid se
compare par `CAST(id AS text) = :id`.
"""

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import text

from app.socle.erreurs import erreurs
from app.socle.audit import log_write
from app.socle.authz import compte, require_coach, require_membre
from app.socle.structures import PREMIERE, structure_ecrite, structures_de
from app.socle.db import get_session
from app.bibliotheque.schemas_library import BibliothequeLue, LibraryEntryCreate, LibraryEntryPatch
from app.socle.schemas_ecriture import EntreeCreee, ObjetCree
from app.socle.erreurs import ErreurMetier

router = APIRouter(prefix="/library", tags=["library"])

_CATEGORIES = ("exercices", "variantes", "assistances", "tempos", "formats")

# ⚠️ UNE bibliothèque PAR STRUCTURE (FRE-13). Un coach crée et renomme dans la
# SIENNE, et un renommage ne se propage qu'aux lignes de sa structure : la clé
# étrangère porte `structure` (`…_une_bibliotheque_par_structure.sql`).
_GET_ALL_SQL = text(
    "SELECT id, category, name, competition, supports FROM library_entries "
    "WHERE structure = :structure ORDER BY category, name"
)
# Insert atomique : conflit (structure, category, name) → aucune ligne → 409.
_INSERT_SQL = text(
    """
    INSERT INTO library_entries (structure, category, name, competition, supports, created_by)
    VALUES (:structure, :category, :name, :competition, :supports, :created_by)
    ON CONFLICT (structure, category, name) DO NOTHING
    RETURNING id
    """
)
_SELECT_BY_ID_SQL = text(
    "SELECT structure, category, name, competition, supports FROM library_entries "
    "WHERE CAST(id AS text) = :id"
)
_CLASH_SQL = text(
    "SELECT 1 FROM library_entries "
    "WHERE structure = :structure AND category = :category AND name = :name "
    "AND CAST(id AS text) <> :id"
)
_STRUCTURE_QUERY = Query(default=None, max_length=64,
                         description="La bibliothèque de quelle structure (FRE-13) ; absente = la première du compte")


def _structure_lue(uid: str, demandee: str | None) -> str:
    """La bibliothèque qu'on LIT : celle demandée, si le compte en est.

    ⚠️ 404 et pas 403 : hors de ses structures, elle n'existe pas — un 403
    mentirait sur la cause. Sans structure demandée : la première du compte,
    dans l'ordre de `structures_de` (`PREMIERE` d'abord, puis par nom) — le même
    « premier » que le menu ; un compte sans structure lit `PREMIERE`.

    Raises:
        ErreurMetier: `structure_inconnue` (404).
    """
    siennes = [s["slug"] for s in structures_de(uid)]
    if demandee is None:
        return siennes[0] if siennes else PREMIERE
    if demandee not in siennes:
        raise ErreurMetier("structure_inconnue", status.HTTP_404_NOT_FOUND,
                           "pas une structure de ce compte")
    return demandee
_UPDATE_SQL = text(
    "UPDATE library_entries SET name = :name, competition = :competition, supports = :supports "
    "WHERE CAST(id AS text) = :id"
)


@router.get("", response_model=BibliothequeLue, response_model_exclude_unset=True,
            responses=erreurs(401, 403, 404))
def get_library(claims: dict = Depends(require_membre), structure: str | None = _STRUCTURE_QUERY) -> dict:
    """Toute la bibliothèque, groupée par catégorie.

    `competition` n'est rendu que sur les exercices, `supports` que s'il y en a.

    ⚠️ Réservé aux MEMBRES, comme l'annuaire (FRE-78) : `verify_token` seul
    laisserait n'importe quel compte Google la lire — Firebase n'impose aucun
    domaine.
    """
    with get_session() as session:
        rows = session.execute(_GET_ALL_SQL, {"structure": _structure_lue(claims["uid"], structure)}).all()

    out: dict[str, list] = {category: [] for category in _CATEGORIES}
    for entry_id, category, name, competition, supports in rows:
        entry = {"id": str(entry_id), "name": name}
        if category == "exercices":
            entry["competition"] = bool(competition)
        # ⚠️ `if supports:` est juste parce que le VIDE n'existe pas (FRE-157). En
        # Python un tableau vide est FAUX : cette ligne confondrait `[]` et NULL
        # si la base ne refusait pas `[]` (`…_un_support_vide_n_existe_pas.sql`).
        # Ne pas la « réparer » en `is not None` : ce serait rendre visible un
        # état que rien ne produit.
        if supports:
            entry["supports"] = list(supports)
        out.setdefault(category, []).append(entry)
    return out


@router.post("/entries", response_model=EntreeCreee, responses=erreurs(401, 403, 409))
def create_entry(
    payload: LibraryEntryCreate,
    claims: dict = Depends(require_coach),
    structure: str | None = _STRUCTURE_QUERY,
) -> dict:
    """Crée une entrée dans la bibliothèque de la structure du coach.

    `competition` hors `exercices` est déjà refusé par le schéma (422).

    Raises:
        ErreurMetier: `entree_deja_existante` (409).
    """
    uid = claims["uid"]
    with get_session() as session:
        row = session.execute(
            _INSERT_SQL,
            {
                "structure": structure_ecrite(session, uid, structure),
                "category": payload.category,
                "name": payload.name,
                "competition": payload.competition,
                "supports": payload.supports,
                "created_by": uid,
            },
        ).first()
        if row is None:
            raise ErreurMetier("entree_deja_existante", 
                status.HTTP_409_CONFLICT, "une entrée (catégorie, nom) identique existe déjà"
            )
        new_id = row[0]

    log_write(
        uid=uid,
        resource="library_entry",
        doc_path=f"library/entries/{new_id}",
        fields=["category", "name", "competition"],
    )
    return {"id": str(new_id)}


@router.patch("/entries/{entry_id}", response_model=ObjetCree, responses=erreurs(401, 403, 404, 409))
def patch_entry(
    entry_id: str,
    payload: LibraryEntryPatch,
    claims: dict = Depends(require_coach),
) -> dict:
    """Renomme une entrée, change son drapeau `competition` ou ses `supports`.

    Lecture puis écriture : le refus de `competition` hors `exercices` dépend de
    la catégorie EXISTANTE, qui ne se patche pas.

    Raises:
        ErreurMetier: `entree_introuvable` (404), `competition_hors_exercices`
            (422), `entree_deja_existante` (409).
    """
    with get_session() as session:
        existing = session.execute(_SELECT_BY_ID_SQL, {"id": entry_id}).mappings().first()
        # ⚠️ L'entrée d'une AUTRE structure n'existe pas pour ce coach (404, pas
        # 403) : la renommer propagerait aux lignes d'athlètes qu'il ne suit pas.
        qui = compte(claims["uid"], session)
        if existing is None or (existing["structure"] != qui.coach_structure and not qui.admin):
            raise ErreurMetier("entree_introuvable", status.HTTP_404_NOT_FOUND, "entrée introuvable")

        champs = payload.model_fields_set
        new_name = payload.name if "name" in champs else existing["name"]
        new_competition = (payload.competition if "competition" in champs
                           else bool(existing["competition"]))
        # ⚠️ LA PRÉSENCE DE LA CLÉ TRANCHE, PAS LA VALEUR (FRE-185). Le contrat
        # normalise `[]` en `None` — le vide n'existe pas en base (FRE-157) —,
        # donc `payload.supports is not None` confondrait « vider » et « ne pas
        # toucher », et le vidage deviendrait un no-op SILENCIEUX.
        new_supports = payload.supports if "supports" in champs else existing["supports"]

        if new_competition and existing["category"] != "exercices":
            raise ErreurMetier("competition_hors_exercices", 
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "competition réservé à la catégorie 'exercices'",
            )

        if new_name != existing["name"]:
            clash = session.execute(
                _CLASH_SQL, {"structure": existing["structure"], "category": existing["category"],
                             "name": new_name, "id": entry_id}
            ).first()
            if clash is not None:
                raise ErreurMetier("entree_deja_existante", 
                    status.HTTP_409_CONFLICT, "une entrée (catégorie, nom) identique existe déjà"
                )

        session.execute(
            _UPDATE_SQL,
            {"name": new_name, "competition": new_competition, "supports": new_supports, "id": entry_id},
        )

    log_write(
        uid=claims["uid"],
        resource="library_entry",
        doc_path=f"library/entries/{entry_id}",
        fields=sorted(payload.model_dump(exclude_none=True).keys()),
    )
    return {"ok": True, "id": entry_id}
