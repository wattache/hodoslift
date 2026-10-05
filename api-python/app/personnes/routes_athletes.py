"""Les routes des fiches athlète. brokkr porte l'autorisation.

  - GET /athletes/mine : ceux que l'appelant gère (coach_uid = uid) ou EST
    (user_uid = uid), admin compris. Champs COMPLETS, PII de compte incluse.
  - GET /athletes/annuaire : toutes les fiches, pour l'écran Admin — admin seul,
    sept champs, ni programme ni mesure.
  - GET /athletes/suivis : les athlètes suivis par le kiné appelant, SANS email
    ni linkedUserId.

⚠️ AUCUNE route ne rend la liste de tous les athlètes à tout compte authentifié.

PÉRIMÈTRE : profil + current_one_rm + programId. PAS les goals ni les PR, qui
ont leurs propres endpoints. Les requêtes vivent dans `metier_athletes.py`.
"""

from datetime import date as date_cls, timedelta

from fastapi import APIRouter, Depends, Query, status

from app.socle.erreurs import erreurs
from app.socle.audit import log_write
from app.socle.auth import verify_token
from app.socle.authz import require_admin, require_coach
from app.socle.db import get_session
from app.personnes.identifiants import nouvel_identifiant
from app.personnes.schemas_athlete_profile import (AccesSupportDemande, AthleteArchive, AthleteCoachReassign,
                                      AthleteCreate, AthleteKineSet)
from app.personnes.schemas_athlete_lecture import AthleteAnnuaire, AthleteMine, AthletePublic
from app.personnes.schemas_signalement import Signalement
from app.socle.schemas_ecriture import (AthleteArchive as AthleteArchiveEcrit,
                               AccesSupportEcrit, AthleteCree, CoachAffecte, Confirmation, KineAffecte,
                               LiaisonAthlete)
from app.socle.authz import AthleteAccess, require_athlete_access
from app.socle.erreurs import ErreurMetier
from app.personnes import metier_athletes as metier

router = APIRouter(prefix="/athletes", tags=["athletes"])


@router.post("", response_model=AthleteCree, responses=erreurs(401, 403))
def create_athlete(payload: AthleteCreate, claims: dict = Depends(require_coach)) -> dict:
    """Crée un athlète et son pointeur programme (coach-only).

    L'arbre d'entraînement n'est PAS créé ici : macro, bloc et semaines viennent
    ensuite, par les routes de `routes_training_structure.py`. Les deux
    identifiants sont frappés par `app/personnes/identifiants.py`.
    """
    uid = claims["uid"]
    legacy_id = nouvel_identifiant()
    program_id = nouvel_identifiant()

    with get_session() as session:
        row = metier.inserer_la_fiche(session, legacy_id=legacy_id, first_name=payload.firstName,
                                      email=payload.email, coach_uid=uid)
        athlete_uuid = row[0]
        metier.create_program(session, program_id=program_id, coach_uid=uid, athlete_uuid=athlete_uuid)

    log_write(
        uid=uid,
        resource="athlete_create",
        doc_path=f"athletes/{legacy_id}",
        fields=["first_name", "email", "program_id"],
    )
    return {"id": legacy_id, "programId": program_id}


@router.post("/link", response_model=LiaisonAthlete, responses=erreurs(401, 403))
def link_athlete(claims: dict = Depends(verify_token)) -> dict:
    """Lie l'utilisateur courant à l'athlète NON LIÉ qui porte son email.

    Autz : le jeton seul (un athlète tout neuf n'a aucun rôle). Aucun match →
    `{"linked": false}` et un `motif`, pas une erreur : un pur coach n'a rien à
    lier. `user_uid IS NULL` garantit qu'on ne détourne jamais une fiche déjà
    rattachée. Crée au passage le STUB `users(uid, email)` qu'exige la FK ; le
    profil complet est écrit par `GET /users/me`.

    Raises:
        ErreurMetier: `email_non_verifie` (403).
    """
    uid = claims["uid"]
    # ⚠️ EXIGÉ VRAI, et pas « refusé si faux » (FRE-131). Un jeton SANS la claim
    # est le cas dangereux : on ne sait rien de l'adresse, et cette adresse est la
    # clé de rapprochement qui décide de la propriété de la fiche. « Absent » ne
    # se lit pas « prouvé ». Rattacher sans preuve serait un geste explicite
    # d'admin, pas un silence dans un jeton.
    if claims.get("email_verified") is not True:
        raise ErreurMetier("email_non_verifie", status.HTTP_403_FORBIDDEN, "email non vérifié")

    email = (claims.get("email") or "").strip().lower()
    if not email:
        return {"linked": False, "athleteId": None, "motif": "aucune_fiche"}

    with get_session() as session:
        row = metier.find_unlinked(session, email=email)
        if row is None:
            deja = metier.fiche_deja_liee(session, email=email)
            return {"linked": False, "athleteId": None,
                    "motif": "fiche_deja_liee" if deja else "aucune_fiche"}
        # Stub users puis lien, DANS LA MÊME transaction (FK satisfaite, atomique).
        metier.ensure_user(session, uid=uid, email=email)
        metier.link(session, uid=uid, athlete_uuid=row["id"])
        legacy_id = row["legacy_id"]

    log_write(uid=uid, resource="athlete_link", doc_path=f"athletes/{legacy_id}", fields=["user_uid"])
    return {"linked": True, "athleteId": legacy_id, "motif": None}

# ⚠️ IL N'Y A PAS DE `DELETE /athletes/{id}/link`, ET C'EST VOULU (FRE-131).
# Détacher un compte d'une fiche est l'ÉTAPE 0 d'une prise de contrôle : détacher,
# écrire son adresse sur la fiche redevenue libre, se rattacher, lire les bilans
# kiné. Le détachement est un UPDATE en base, fait à la main.
#
# Contrepartie (FRE-76) : `POST /athletes/link` exige `user_uid IS NULL`, donc un
# athlète dont l'uid Firebase change reste dehors — et le refus se NOMME
# (`motif: fiche_deja_liee`) au lieu d'accuser le coach.


@router.get("/mine", response_model=list[AthleteMine], response_model_exclude_unset=True, responses=erreurs(401))
def list_my_athletes(
    claims: dict = Depends(verify_token),
    structure: str | None = Query(default=None, max_length=64,
                                  description="Borne la liste à une structure (FRE-13) ; absente = toutes"),
) -> list:
    """Mes athlètes (coach_uid=uid OU user_uid=uid), champs COMPLETS.

    ⚠️ LE LIEN, PAS LE RÔLE (FRE-190) : l'admin reçoit SES fiches, comme tout le
    monde. Le sélecteur d'athlète lit cette route ; lui en proposer une qu'il ne
    coache pas le menait à un 403 sur le programme.

    ⚠️ `kineUid` sort ICI et pas dans `/suivis`, comme l'email et le linkedUserId.
    « Cet athlète est suivi par un kiné » est une information de santé : elle
    appartient à l'athlète, à son coach et à un admin.
    """
    uid = claims["uid"]
    with get_session() as session:
        rows = metier.mine_own(session, uid=uid, structure=structure)
        # Le tableau de bord lit CETTE route : le RIS y sort, servi et non
        # recalculé par l'écran.
        ris = metier.meilleurs_ris(session)
    return [
        metier.map_common(row) | ris.get(row["id"], {})
        | {"email": row["email"], "linkedUserId": row["user_uid"],
           "kineUid": row["kine_uid"],
           # La DATE ne sort qu'ici ; les suivis d'un kiné n'ont que l'âge.
           "birthDate": row["birth_date"].isoformat() if row["birth_date"] else None,
           # ⚠️ `None` ET NON `''` — « actif » est une ABSENCE de date.
           "archiveLe": row["archive_le"].isoformat() if row["archive_le"] else None,
           "supportJusquAu": row["support_jusqu_au"].isoformat() if row["support_jusqu_au"] else None}
        for row in rows
    ]


@router.get("/annuaire", response_model=list[AthleteAnnuaire], responses=erreurs(401, 403))
def list_athletes_annuaire(
    claims: dict = Depends(require_admin),
    structure: str | None = Query(default=None, max_length=64,
                                  description="Borne la liste à une structure (FRE-13) ; absente = toutes"),
) -> list:
    """Toutes les fiches de la structure, pour l'écran Admin (FRE-190).

    L'admin y réaffecte un coach, y voit qui est lié et qui suit qui : c'est
    l'annuaire, et c'est un acte d'administration — aucun lien ne le remplace.
    """
    with get_session() as session:
        return metier.annuaire(session, uid=claims["uid"], structure=structure)


@router.post("/{athlete_id}/support", response_model=AccesSupportEcrit, responses=erreurs(401, 403, 404))
def ouvrir_acces_support(
    athlete_id: str,
    payload: AccesSupportDemande = AccesSupportDemande(),
    claims: dict = Depends(require_admin),
) -> dict:
    """L'admin s'ouvre un accès support à cet athlète, ou le prolonge (FRE-202).

    Tant qu'il court, l'admin a sur CET athlète les droits de son coach et de son
    kiné — c'est `authz` qui le lit, nulle part ailleurs. À lui-même seulement :
    un accès support se prend, il ne se distribue pas.

    Raises:
        ErreurMetier: `athlete_introuvable` (404).
    """
    with get_session() as session:
        fin = metier.ouvrir_acces_support(session, uid=claims["uid"], legacy=athlete_id, heures=payload.heures)
    if fin is None:
        raise ErreurMetier("athlete_introuvable", status.HTTP_404_NOT_FOUND, "athlète introuvable")
    log_write(uid=claims["uid"], resource="acces_support", doc_path=f"athletes/{athlete_id}",
              fields=["ouverture"], count=payload.heures)
    return {"ok": True, "supportJusquAu": fin}


@router.delete("/{athlete_id}/support", response_model=AccesSupportEcrit, responses=erreurs(401, 403, 404))
def fermer_acces_support(athlete_id: str, claims: dict = Depends(require_admin)) -> dict:
    """Ferme l'accès support en cours avant son terme (FRE-202). Sans accès en cours, rien à faire.

    Raises:
        ErreurMetier: `athlete_introuvable` (404).
    """
    with get_session() as session:
        close = metier.fermer_acces_support(session, uid=claims["uid"], legacy=athlete_id)
    if close is None:
        raise ErreurMetier("athlete_introuvable", status.HTTP_404_NOT_FOUND, "athlète introuvable")
    if close:
        log_write(uid=claims["uid"], resource="acces_support", doc_path=f"athletes/{athlete_id}",
                  fields=["fin"])
    return {"ok": True, "supportJusquAu": None}


@router.get("/suivis", response_model=list[AthletePublic], response_model_exclude_unset=True, responses=erreurs(401))
def list_athletes_suivis(
    claims: dict = Depends(verify_token),
    structure: str | None = Query(default=None, max_length=64,
                                  description="Borne la liste à une structure (FRE-13) ; absente = toutes"),
) -> list:
    """Les athlètes SUIVIS par l'appelant (`athletes.kine_uid`) — l'entrée du kiné.

    PAS de garde de rôle, et c'est voulu (corollaire FRE-64 d'authz.py) : le
    LIEN est la vérité. Un appelant qui n'est le kiné de personne reçoit une
    liste vide, pas un refus — comme « mes athlètes » du coach filtre sur
    `coach_uid`. Un `require_kine` ici créerait la fonction de rôle global que le
    corollaire interdit, pour ne rien protéger de plus.

    Rien de la PII de compte ; `programId` compris, c'est par lui que le front
    navigue vers l'entraînement.
    """
    with get_session() as session:
        rows = metier.suivis(session, uid=claims["uid"], structure=structure)
    return [metier.map_common(row) for row in rows]


@router.get("/signalements", response_model=list[Signalement], responses=erreurs(401))
def list_signalements(jours: int = Query(default=30, ge=1, le=365),
                      claims: dict = Depends(verify_token)) -> list:
    """Les signalements récents des athlètes que l'appelant staffe.

    ⚠️ CE SONT DES DOULEURS, PAS DES JOURNÉES (FRE-195). L'écran dit « qui va
    mal », et la source est `douleur_logs` : une ligne par jour où quelqu'un a
    noté quelque chose. Aucun filtre n'est nécessaire — la table ne contient que
    de la douleur, là où le journal quotidien portait aussi le poids et le
    sommeil.
    """
    with get_session() as session:
        rows = metier.signalements(session, uid=claims["uid"],
                                   depuis=date_cls.today() - timedelta(days=jours - 1))
    return [{
        "athleteId": r["legacy_id"],
        "firstName": r["first_name"] or "",
        "lastName": r["last_name"] or "",
        "programId": r["program_id"],
        "date": r["log_date"].isoformat(),
        "douleurs": r["douleurs"],
    } for r in rows]


# ⚠️ LE JOUR EST TYPÉ DANS LE CHEMIN (`date`), pas validé à la main : une date
# mal formée est refusée par FastAPI avec le code de validation commun
# (`corps_invalide`) — pas un `date_invalide` métier que le contrat des erreurs
# devrait déclarer route par route.

@router.post("/{athlete_id}/signalements/{date}/vu", response_model=Confirmation,
             responses=erreurs(401, 403, 404))
def marquer_signalement_vu(date: date_cls,
                           access: AthleteAccess = Depends(require_athlete_access("staff"))) -> dict:
    """CE lecteur a vu ce signalement : il sort de SA file, pas de celle des autres.

    Raises:
        ErreurMetier: `signalement_introuvable` (404).
    """
    jour = date
    with get_session() as session:
        aid = metier.signalement_existe(session, legacy=access.athlete_id, jour=jour)
        if aid is None:
            # Cocher un jour sans signalement n'a pas de sens — et la clé
            # étrangère le refuserait de toute façon, en 500. On le dit en 404.
            raise ErreurMetier("signalement_introuvable", status.HTTP_404_NOT_FOUND,
                               "aucun signalement ce jour-là pour cet athlète")
        metier.vu(session, aid=aid, jour=jour, uid=access.claims["uid"])
    log_write(uid=access.claims["uid"], resource="signalement",
              doc_path=f"athletes/{access.athlete_id}/signalements/{date}/vu", fields=["vu"])
    return {"ok": True}


@router.delete("/{athlete_id}/signalements/{date}/vu", response_model=Confirmation,
               responses=erreurs(401, 403, 404))
def retirer_signalement_vu(date: date_cls,
                           access: AthleteAccess = Depends(require_athlete_access("staff"))) -> dict:
    """Le signalement redevient à voir pour CE lecteur."""
    jour = date
    with get_session() as session:
        metier.non_vu(session, legacy=access.athlete_id, jour=jour, uid=access.claims["uid"])
    log_write(uid=access.claims["uid"], resource="signalement",
              doc_path=f"athletes/{access.athlete_id}/signalements/{date}/vu", fields=["non-vu"])
    return {"ok": True}


@router.patch("/{athlete_id}/coach", response_model=CoachAffecte, responses=erreurs(400, 401, 403, 404, 409))
def reassign_coach(
    athlete_id: str,
    payload: AthleteCoachReassign,
    claims: dict = Depends(require_admin),
) -> dict:
    """Réassigne un athlète à un autre coach (admin-only), et rend les programmes déplacés.

    Le nouveau coach doit exister dans `coaches` : un coach fraîchement promu n'y
    est qu'après un resync identité.

    Raises:
        ErreurMetier: `athlete_introuvable` (404), `coach_inconnu` (400),
            `coach_d_une_autre_structure` (409).
    """
    new_coach = payload.coachUid
    with get_session() as session:
        athlete_uuid = metier.athlete_uuid(session, legacy=athlete_id)
        if athlete_uuid is None:
            raise ErreurMetier("athlete_introuvable", status.HTTP_404_NOT_FOUND, "athlète inconnu en base SQL")
        if metier.coach_exists(session, coach=new_coach) is None:
            raise ErreurMetier("coach_inconnu", status.HTTP_400_BAD_REQUEST, "coach cible inconnu en base SQL")
        if metier.coach_de_la_meme_structure(session, coach=new_coach, legacy=athlete_id) is None:
            raise ErreurMetier("coach_d_une_autre_structure", status.HTTP_409_CONFLICT,
                               "ce coach n'est pas de la structure de l'athlète")
        program_ids = list(
            metier.program_ids(session, athlete_uuid=athlete_uuid)
        )
        metier.reassign_athlete(session, coach=new_coach, legacy=athlete_id)
        metier.reassign_programs(session, coach=new_coach, athlete_uuid=athlete_uuid)

    # ⚠️ Postgres est la SEULE copie du lien coach. Ne pas entretenir « par
    # sécurité » une copie ailleurs que personne ne lit : c'est une divergence
    # silencieuse le jour où quelqu'un recommence à la lire.
    log_write(
        uid=claims["uid"],
        resource="athlete_coach_reassign",
        doc_path=f"athletes/{athlete_id}",
        fields=["coach_uid", *program_ids],
    )
    return {"ok": True, "programIds": program_ids}


@router.patch("/{athlete_id}/kine", response_model=KineAffecte, responses=erreurs(401, 403, 404))
def set_athlete_kine(
    athlete_id: str,
    payload: AthleteKineSet,
    claims: dict = Depends(require_coach),
) -> dict:
    """Affecte (ou détache) le kiné qui suit cet athlète. Coach de l'athlète only.

    404 SI L'ATHLÈTE N'EST PAS LE SIEN — et non 403. La requête d'appartenance
    porte `coach_uid` dans son WHERE : un coach visant l'athlète d'un autre
    n'apprend pas qu'il existe. C'est la convention de l'écriture de l'arbre
    (`verifier`, `metier_training_structure.py`), et le « qui suit qui » est
    justement une information à ne pas confirmer par la bande.

    422 SI L'UID N'EST PAS UN KINÉ DÉCLARÉ. La FK le refuserait, mais en
    `IntegrityError` — un 500 doublé d'une transaction perdue. Le contrôle
    explicite distingue « cet uid n'est pas kiné » de « cet athlète n'est pas à
    toi ».

    `kineUid: null` (ou `''`, cf. `vide_en_none`) DÉTACHE : c'est un état normal,
    la plupart des athlètes n'ont pas de kiné.

    Raises:
        ErreurMetier: `athlete_introuvable` (404), `pas_un_kine` (422).
    """
    uid = claims["uid"]
    kine_uid = payload.kineUid

    with get_session() as session:
        # ⚠️ APPARTENANCE D'ABORD, validité de la cible ensuite (FRE-43). Inversés,
        # un coach apprendrait qu'un uid est kiné en visant l'athlète d'un confrère.
        if metier.athlete_du_coach(session, legacy=athlete_id, coach=uid) is None:
            raise ErreurMetier("athlete_introuvable", status.HTTP_404_NOT_FOUND, "athlète introuvable")
        if kine_uid is not None and metier.kine_exists(session, kine=kine_uid) is None:
            raise ErreurMetier("pas_un_kine", 
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "cet utilisateur n'est pas un kiné déclaré",
            )
        metier.set_kine(session, kine=kine_uid, legacy=athlete_id)

    log_write(
        uid=uid,
        resource="athlete_kine_set",
        doc_path=f"athletes/{athlete_id}",
        fields=["kine_uid"],
    )
    return {"ok": True, "kineUid": kine_uid}


@router.patch("/{athlete_id}/archive", response_model=AthleteArchiveEcrit,
              responses=erreurs(401, 403, 404))
def set_athlete_archive(
    athlete_id: str,
    payload: AthleteArchive,
    claims: dict = Depends(require_coach),
) -> dict:
    """Archive un athlète qui suspend le coaching, ou le réactive. Son coach seul.

    404 SI L'ATHLÈTE N'EST PAS LE SIEN — et non 403, comme l'affectation du kiné
    juste au-dessus : un coach visant l'athlète d'un autre n'apprend pas qu'il
    existe.

    ⚠️ RIEN N'EST SUPPRIMÉ NI CACHÉ CÔTÉ SERVEUR. Les lectures continuent de
    servir cet athlète — c'est l'ÉCRAN qui masque. Filtrer ici ferait de
    « reprendre plus tard » un aller simple, et retirerait l'athlète des endroits
    où il est NOMMÉ : une compétition passée, un bilan, un objectif.

    ⚠️ `clock_timestamp()` ET NON `now()`, qui rend l'heure de DÉBUT DE
    TRANSACTION : deux archivages dans la même transaction porteraient la même
    date, et « archivé le » cesserait d'ordonner quoi que ce soit.

    Raises:
        ErreurMetier: `athlete_introuvable` (404).
    """
    uid = claims["uid"]
    with get_session() as session:
        if metier.athlete_du_coach(session, legacy=athlete_id, coach=uid) is None:
            raise ErreurMetier("athlete_introuvable", status.HTTP_404_NOT_FOUND,
                               "athlète introuvable")
        quand = metier.horloge(session) if payload.archive else None
        archive_le = metier.set_archive(session, quand=quand, legacy=athlete_id)

    log_write(uid=uid, resource="athlete_archive",
              doc_path=f"athletes/{athlete_id}", fields=["archive_le"])
    return {"ok": True, "archiveLe": archive_le.isoformat() if archive_le else None}
