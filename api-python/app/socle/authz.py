"""Les dépendances d'autorisation : qui accède à quel athlète, à quel programme.

⚠️ LA RÉSOLUTION uid → RÔLES VIT ICI, ET NULLE PART AILLEURS (FRE-64). Ce module
seul sait quelles colonnes portent les rôles ; les routes ne consomment que
`ProgramAccess.roles`. Une comparaison d'uid dans un routeur casse la promesse :
le jour où une ADHÉSION porte les rôles, seule la requête d'ici change.

⚠️ C'est le LIEN qui ouvre l'accès, pas le rôle : « kiné DE cet athlète »
(`athletes.kine_uid`), pas « est kiné ». `is_kine()` répond à une autre question
— « est-ce un kiné déclaré ? » — pour les modèles de bilan, où il n'y a pas d'athlète.
"""

from dataclasses import dataclass
from typing import Literal

from fastapi import Depends, status
from sqlalchemy import text

from app.socle.auth import verify_token
from app.socle.db import get_session
from app.socle.erreurs import ErreurMetier


# Un ACCÈS SUPPORT en cours de l'appelant sur l'athlète (FRE-202). Un fragment et
# non une fonction : les deux dépendances le lisent DANS leur requête, sans
# second aller-retour. `clock_timestamp()` et non `now()` : l'accès se juge à
# l'heure réelle, pas au début de la transaction qui le demande.
_SUPPORT = ("EXISTS (SELECT 1 FROM acces_support s WHERE s.uid = :uid "
            "AND s.athlete_id = {athlete} AND s.fin > clock_timestamp())")


@dataclass
class AthleteAccess:
    """Résultat d'une vérification d'accès réussie."""

    athlete_id: str
    claims: dict    # claims du token Firebase


class _AthleteAccessDep:
    """Dépendance paramétrable : vérifie l'accès au document athlète."""

    # ⚠️ La liste COMPLÈTE des modes. Un `Literal` incomplet n'interdit rien à
    # l'exécution, mais fait mentir la seule déclaration qu'on lit pour savoir ce
    # qui existe : un mode ajouté plus bas entre ici, et dans `require_athlete_access`.
    def __init__(self, mode: Literal["owner", "staff", "owner_or_staff",
                                     "owner_or_kine", "kine", "coach"]) -> None:
        self.mode = mode

    def __call__(
        self,
        athlete_id: str,
        claims: dict = Depends(verify_token),
    ) -> AthleteAccess:
        # Le segment de chemin est `athletes.legacy_id`, pas `id`.
        with get_session() as session:
            row = session.execute(
                text("SELECT a.coach_uid, a.user_uid, a.kine_uid, "
                     + _SUPPORT.format(athlete="a.id") + " AS support "
                     "FROM athletes a WHERE a.legacy_id = :legacy"),
                {"legacy": athlete_id, "uid": claims["uid"]},
            ).mappings().first()
        if row is None:
            raise ErreurMetier("athlete_introuvable", 
                status_code=status.HTTP_404_NOT_FOUND,
                detail="athlète introuvable",
            )

        uid = claims["uid"]
        # ⚠️ C'est le LIEN qui ouvre l'accès (`coach_uid`, `kine_uid`), pas le rôle :
        # un kiné déclaré n'a rien sur un athlète qu'il ne suit pas. Le rôle dit
        # QUELS athlètes, pas QUOI : sur l'athlète qu'il suit, le kiné a les droits
        # du coach — d'où `staff`, dont le nom dit QUI il laisse entrer. Un mode qui
        # ment sur son contenu se fait élargir par mégarde.
        #
        # ⚠️ `owner_or_kine` EXCLUT LE COACH : un bilan porte des antécédents et des
        # pathologies, pas de la donnée d'entraînement (bilan-kine.md §7). « Ouvrir
        # large entre gens du staff » ne décide pas du secret médical. Le coach ne
        # voit que le signal dérivé, par le tableau des signalements.
        #
        # ⚠️ UN ACCÈS SUPPORT EN COURS VAUT COACH ET KINÉ (FRE-202) — sur CET athlète,
        # jusqu'à sa fin, et c'est encore un lien : l'admin se l'ouvre, il expire
        # seul. Il entre ICI, dans les trois flags, et nulle part ailleurs.
        support = bool(row["support"])
        est_staff = uid in (row["coach_uid"], row["kine_uid"]) or support
        est_kine = (row["kine_uid"] is not None and uid == row["kine_uid"]) or support
        est_coach = uid == row["coach_uid"] or support
        # ⚠️ Les modes FERMÉS À L'ATHLÈTE sont traités en premier, et séparément.
        # Le `else` commence par `authorized = user_uid == uid` : y faire passer un
        # mode fermé l'autoriserait d'abord pour le lui retirer ensuite — une ligne
        # déplacée ouvrirait un dossier médical. Ce qui est fermé se lit comme fermé.
        if self.mode == "staff":
            authorized = est_staff
        # ⚠️ `kine` — le plus étroit, fermé à l'athlète LUI-MÊME (FRE-102). Pour
        # les NOTES DE SUIVI : l'observation du praticien, une hypothèse et non un
        # constat. La montrer censurerait ce que le kiné y écrit. Élargir plus tard
        # est trivial ; resserrer ne l'est pas.
        elif self.mode == "kine":
            authorized = est_kine
        # ⚠️ `coach` — le pendant de `kine`, fermé à l'athlète (FRE-122). Pour les
        # OBJECTIFS TECHNIQUES : l'athlète les lit (`owner_or_staff`), le coach les
        # écrit. Il exclut aussi le KINÉ, contrairement à `staff` : c'est de la
        # PROGRAMMATION. « Ouvrir large » vaut pour ce qu'on regarde, pas pour ce
        # qu'on prescrit.
        elif self.mode == "coach":
            authorized = est_coach
        else:
            authorized = row["user_uid"] == uid
            if not authorized and self.mode == "owner_or_staff":
                authorized = est_staff
            if not authorized and self.mode == "owner_or_kine":
                authorized = est_kine

        if not authorized:
            raise ErreurMetier("athlete_hors_perimetre", 
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Accès non autorisé à cet athlète",
            )

        # ⚠️ Pas de `.athlete` dans le résultat, comme pas de `.program` plus bas
        # (FRE-143) : rendre les uids, c'est offrir de quoi les recomparer hors d'ici.
        return AthleteAccess(athlete_id=athlete_id, claims=claims)


def require_athlete_access(
    mode: Literal["owner", "staff", "owner_or_staff", "owner_or_kine", "kine",
                  "coach"] = "owner",
) -> _AthleteAccessDep:
    """Rend la dépendance FastAPI qui garde l'accès à une fiche athlète.

    mode="owner"           → seul l'athlète lié (`user_uid`).
    mode="staff"           → son coach (`coach_uid`) OU son kiné (`kine_uid`).
    mode="owner_or_staff"  → l'athlète lié, ou l'un des deux.
    mode="owner_or_kine"   → l'athlète lié, ou son KINÉ — le coach est exclu.
                             Réservé au médical (bilan-kine.md §7).
    mode="coach"           → SON COACH SEUL, ni le kiné ni l'athlète : les
                             objectifs techniques (FRE-122).
    mode="kine"            → SON KINÉ SEUL, ni le coach ni l'athlète : les notes
                             de suivi (FRE-102).

    La dépendance lève 404 `athlete_introuvable` si la fiche n'existe pas, puis
    403 `athlete_hors_perimetre` si le lien manque.
    """
    return _AthleteAccessDep(mode)


# Mode d'une route → les rôles qui l'ouvrent. Les rôles SUR UN PROGRAMME —
# `coach`, `athlete`, `kine` — sont un vocabulaire CLOS, et la seule chose que les
# routes consomment (`ProgramAccess.roles`). Pas un moteur RBAC.
#
# Les noms énumèrent QUI, et restent longs à dessein : `coach_or_athlete_or_kine`
# se lit et se grep, là où `lecture` nommerait un USAGE.
#
# ⚠️ LE KINÉ PROGRAMME COMME LE COACH sur l'athlète qu'il suit : c'est le staff
# qui s'organise entre humains, pas le logiciel qui arbitre. D'où `kine` dans
# TOUS les modes. `rehab` est une NATURE de ligne, une étiquette comme `warmup` :
# elle ne porte aucun droit.
_MODES: dict[str, frozenset[str]] = {
    "coach": frozenset({"coach", "kine"}),
    "coach_or_athlete": frozenset({"coach", "athlete", "kine"}),
    "coach_or_athlete_or_kine": frozenset({"coach", "athlete", "kine"}),
}


@dataclass
class ProgramAccess:
    """Résultat d'une vérification d'accès réussie à un programme."""

    program_id: str
    claims: dict    # claims du token Firebase
    # Ce que l'appelant EST sur ce programme — l'unique canal par lequel un rôle
    # sort d'ici. Un ENSEMBLE, pas un scalaire : rien n'interdit d'en porter deux
    # sur un même programme, et le périmètre par champ est alors leur UNION.
    roles: frozenset[str] = frozenset()


class _ProgramAccessDep:
    """Dépendance paramétrable : vérifie l'accès au document programme."""

    def __init__(
        self,
        mode: Literal["coach", "coach_or_athlete", "coach_or_athlete_or_kine"],
    ) -> None:
        self.mode = mode

    def __call__(
        self,
        program_id: str,
        claims: dict = Depends(verify_token),
    ) -> ProgramAccess:
        # UNE requête pour les trois rôles : le programme, et (LEFT JOIN) l'athlète
        # lié, qui porte son compte (`user_uid`) et son kiné (`kine_uid`, FRE-52).
        # Pas besoin d'interroger `kines` : `kine_uid` est une FK vers cette table.
        with get_session() as session:
            row = session.execute(
                text(
                    "SELECT p.coach_uid, a.user_uid, a.kine_uid, "
                    + _SUPPORT.format(athlete="a.id") + " AS support "
                    "FROM programs p LEFT JOIN athletes a ON a.id = p.athlete_id "
                    "WHERE p.id = :program_id"
                ),
                {"program_id": program_id, "uid": claims["uid"]},
            ).mappings().first()
        if row is None:
            raise ErreurMetier("programme_introuvable", 
                status_code=status.HTTP_404_NOT_FOUND,
                detail="programme introuvable",
            )

        uid = claims["uid"]
        # LA résolution uid → rôles : rien d'autre ne la refait. Une colonne NULL
        # (`user_uid`, `kine_uid`) n'égale aucun uid : pas de garde à ajouter.
        roles = frozenset(
            role for role, porteur in (
                ("coach", row["coach_uid"]),
                ("athlete", row["user_uid"]),
                ("kine", row["kine_uid"]),
            ) if porteur == uid
        )
        # Un accès support en cours ajoute les deux rôles du staff (FRE-202).
        if row["support"]:
            roles |= {"coach", "kine"}

        if not (roles & _MODES[self.mode]):
            raise ErreurMetier("programme_hors_perimetre", 
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Accès non autorisé à ce programme",
            )

        # ⚠️ Pas de `.program` dans le résultat (FRE-143) : un `coach_uid` rendu se
        # recompare à `claims["uid"]` dans un routeur, et la logique de rôle
        # s'échappe d'ici. Ce qui concerne les rôles passe par `roles`.
        return ProgramAccess(program_id=program_id, claims=claims, roles=roles)


def require_program_access(
    mode: Literal["coach", "coach_or_athlete", "coach_or_athlete_or_kine"] = "coach",
) -> _ProgramAccessDep:
    """Rend la dépendance FastAPI qui garde l'accès à un programme.

    mode="coach"                    → ceux qui PROGRAMMENT : le coach propriétaire
        (`programs.coach_uid`) et le kiné qui suit l'athlète (`athletes.kine_uid`).
    mode="coach_or_athlete"         → les mêmes, plus l'athlète lié (`athletes.user_uid`).
    mode="coach_or_athlete_or_kine" → le MÊME ensemble que le précédent (voir `_MODES`).
        Lecture du programme et PATCH d'une ligne : les trois entrent, et c'est
        le périmètre par champ (`perimetre.py`) qui dit QUOI chacun écrit.

    ⚠️ Le kiné est dans les TROIS modes : il programme comme le coach. Les deux
    derniers noms restent distincts parce qu'ils disent QUI on a voulu laisser
    entrer, pas parce qu'ils diffèrent.

    La dépendance lève 404 `programme_introuvable` si le programme n'existe pas,
    puis 403 `programme_hors_perimetre` si l'appelant n'y porte aucun rôle admis.
    """
    return _ProgramAccessDep(mode)


def is_coach(uid: str) -> bool:
    """Vrai ssi `coaches` porte une ligne pour cet uid : être coach, c'est avoir une ligne."""
    with get_session() as session:
        return bool(
            session.execute(
                text("SELECT EXISTS(SELECT 1 FROM coaches WHERE uid = :uid)"),
                {"uid": uid},
            ).scalar()
        )


def is_admin(uid: str) -> bool:
    """Vrai ssi `users.is_admin` pour cet uid (faux si aucune ligne)."""
    with get_session() as session:
        return bool(
            session.execute(
                text("SELECT is_admin FROM users WHERE uid = :uid"),
                {"uid": uid},
            ).scalar()
        )


def est_membre(uid: str) -> bool:
    """Un lien RÉEL avec l'application : un rôle, ou une fiche athlète.

    ⚠️ « AUTHENTIFIÉ » N'EST PAS « MEMBRE » (FRE-78). Firebase accepte tout compte
    Google, sans restriction de domaine : `verify_token` prouve qu'une personne
    existe chez Google, pas qu'elle a un rapport avec le club. C'est la condition
    que `AuthGate` applique à l'écran.

    UNE requête, à dessein : cette garde s'exécute sur des routes de liste.
    """
    with get_session() as session:
        return bool(
            session.execute(
                text(
                    """
                    SELECT EXISTS(SELECT 1 FROM coaches  WHERE uid = :uid)
                        OR EXISTS(SELECT 1 FROM kines    WHERE uid = :uid)
                        OR EXISTS(SELECT 1 FROM athletes WHERE user_uid = :uid)
                        OR EXISTS(SELECT 1 FROM users    WHERE uid = :uid AND is_admin)
                    """
                ),
                {"uid": uid},
            ).scalar()
        )


def require_membre(claims: dict = Depends(verify_token)) -> dict:
    """Dépendance FastAPI : n'autorise que les comptes liés à l'application.

    Raises:
        ErreurMetier: 403 `reserve_aux_membres`.
    """
    if not est_membre(claims["uid"]):
        raise ErreurMetier("reserve_aux_membres",
            status_code=status.HTTP_403_FORBIDDEN,
            detail="compte sans lien avec l'application",
        )
    return claims


def is_kine(uid: str) -> bool:
    """Vrai ssi `kines` porte une ligne pour cet uid — même règle que `is_coach`."""
    with get_session() as session:
        return bool(
            session.execute(
                text("SELECT EXISTS(SELECT 1 FROM kines WHERE uid = :uid)"),
                {"uid": uid},
            ).scalar()
        )


def require_kine(claims: dict = Depends(verify_token)) -> dict:
    """Dépendance FastAPI : n'autorise que les kinés déclarés.

    ⚠️ SANS PORTE DÉROBÉE POUR LE COACH : comme `require_coach` ne lit que
    `coaches`, celle-ci ne lit que `kines`. Cette garde protège la
    COMPOSITION des modèles de bilan : décider quels tests cliniques existent, et
    sous quel protocole, est un acte de praticien (bilan-kine.md §6).

    L'admin n'y est pas non plus : administrer les comptes n'est pas exercer.
    Pour dépanner, on donne le rôle ; on n'élargit pas la garde.

    Raises:
        ErreurMetier: 403 `reserve_aux_kines`.
    """
    if not is_kine(claims["uid"]):
        raise ErreurMetier("reserve_aux_kines",
            status_code=status.HTTP_403_FORBIDDEN,
            detail="réservé aux kinés",
        )
    return claims


def require_coach(claims: dict = Depends(verify_token)) -> dict:
    """Dépendance FastAPI : n'autorise que les coachs (une ligne dans `coaches`)."""
    if not is_coach(claims["uid"]):
        raise ErreurMetier("reserve_aux_coachs", 
            status_code=status.HTTP_403_FORBIDDEN,
            detail="réservé aux coachs",
        )
    return claims


def require_admin(claims: dict = Depends(verify_token)) -> dict:
    """Dépendance FastAPI : n'autorise que les admins (`users.is_admin`)."""
    if not is_admin(claims["uid"]):
        raise ErreurMetier("reserve_aux_admins", 
            status_code=status.HTTP_403_FORBIDDEN,
            detail="réservé aux admins",
        )
    return claims


def derive_participant_uids(participants: list[dict]) -> list[str]:
    """Uids uniques non vides des participants, ordre stable (1re occurrence gardée)."""
    seen: dict[str, None] = {}
    for p in participants:
        uid = p.get("uid")
        if uid:
            seen.setdefault(uid, None)
    return list(seen.keys())