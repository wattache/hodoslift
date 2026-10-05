"""Où est chacun, et à quel titre — les STRUCTURES (FRE-13).

Une structure se lit sur ce qui existe déjà : la ligne `coaches`, la ligne
`kines`, la fiche athlète liée au compte. Un même compte peut être COACH dans une
structure et ATHLÈTE dans une autre ; c'est ICI que se calcule ce qu'il est dans
chacune — le front choisit une entrée, il ne recompose rien.

⚠️ La structure choisit ce qu'on REGARDE, elle n'OUVRE rien. L'accès à un athlète
ou à un programme reste le lien nominatif d'`app/socle/authz.py`. Elle ne borne
que les LISTES sans lien nominatif : les compétitions et les kinés.

⚠️ L'ADMIN est de la plateforme : il voit toutes les structures, avec les rôles
qu'il y a réellement — là où il n'en a aucun, il voit, il ne coache pas.
"""

from fastapi import status
from sqlalchemy import text

from app.socle.authz import is_admin
from app.socle.db import get_session
from app.socle.erreurs import ErreurMetier

#: La structure de l'existant. Sert à ORDONNER (elle vient d'abord), jamais de
#: valeur par défaut d'une écriture : chaque chemin nomme la sienne.
PREMIERE = "french-forge"

_MES_STRUCTURES_SQL = text(
    """
    SELECT s.slug, s.nom,
           EXISTS(SELECT 1 FROM coaches c WHERE c.uid = :uid AND c.structure = s.slug) AS est_coach,
           -- ⚠️ Y EXERCER, OU Y SUIVRE UN ATHLÈTE. Le lien kiné est libre
           -- entre structures (`PATCH /athletes/{id}/kine`) : sans cette
           -- seconde branche, un kiné qui suit un athlète d'une AUTRE
           -- structure ne l'a dans aucun menu, et « mes suivis » ne le montre
           -- dans aucune vue — une écriture permise, lisible
           -- nulle part.
           (EXISTS(SELECT 1 FROM kines   k WHERE k.uid = :uid AND k.structure = s.slug)
            OR EXISTS(SELECT 1 FROM athletes a WHERE a.kine_uid = :uid AND a.structure = s.slug)) AS est_kine,
           (SELECT a.legacy_id FROM athletes a
             WHERE a.user_uid = :uid AND a.structure = s.slug LIMIT 1)            AS athlete_id,
           EXISTS(SELECT 1 FROM users u WHERE u.uid = :uid AND u.is_admin)         AS est_admin
    FROM structures s
    ORDER BY s.slug <> :premiere, s.nom
    """
)


def structures_de(uid: str) -> list[dict]:
    """Les structures de ce compte, chacune avec ce qu'il y EST.

    Une structure en fait partie s'il y coache, y exerce, y a sa fiche — ou s'il
    est admin. ⚠️ « Kiné » vaut aussi pour qui y SUIT un athlète sans y exercer :
    le lien kiné est libre entre structures (`PATCH /athletes/{id}/kine`), et
    sans cela un suivi permis ne serait lisible nulle part.
    Ordre : `PREMIERE` d'abord, puis par nom."""
    with get_session() as session:
        rows = session.execute(_MES_STRUCTURES_SQL, {"uid": uid, "premiere": PREMIERE}).mappings().all()
    return [
        {"slug": r["slug"], "nom": r["nom"], "isCoach": bool(r["est_coach"]),
         "isKine": bool(r["est_kine"]), "athleteId": r["athlete_id"]}
        for r in rows
        if r["est_admin"] or r["est_coach"] or r["est_kine"] or r["athlete_id"]
    ]


def slugs_de(uid: str) -> set[str]:
    """Les slugs des structures de ce compte — pour borner une liste."""
    return {s["slug"] for s in structures_de(uid)}


_STRUCTURE_DU_COACH_SQL = text("SELECT structure FROM coaches WHERE uid = :uid")


def structure_ecrite(session, uid: str, demandee: str | None) -> str:
    """Où une ÉCRITURE de coach se range — bibliothèque, compétition.

    Celle où l'on COACHE, sauf l'admin, qui écrit dans celle qu'il nomme : il
    administre la structure qu'il regarde, et n'y coache pas forcément. Sans ce
    cas, ce qu'il crée se range dans SA structure de coach — invisible de la vue
    où il vient de le créer, et fermé aux coachs de la structure regardée.

    Raises:
        ErreurMetier: `reserve_aux_coachs` (403) si un coach nomme une autre
            structure que la sienne."""
    sienne = session.execute(_STRUCTURE_DU_COACH_SQL, {"uid": uid}).scalar()
    if demandee is None or demandee == sienne:
        return sienne
    if is_admin(uid):
        return demandee
    raise ErreurMetier("reserve_aux_coachs", status.HTTP_403_FORBIDDEN,
                       "on n'écrit que dans la structure où l'on coache")
