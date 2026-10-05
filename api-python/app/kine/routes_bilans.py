"""Les bilans d'un athlète : l'instance passée, comparable dans le temps.

Spec : `docs/bilan-kine.md`. Composition des modèles : `routes_bilan_modeles.py`.

⚠️ Autz `owner_or_kine` : le COACH EST EXCLU, et c'est le seul domaine où il
l'est. Un bilan porte des antécédents et des pathologies (§8) — du secret médical,
pas de la donnée d'entraînement. Le coach ne voit que le signal DÉRIVÉ, par le
tableau des signalements.
⚠️ Le bilan COPIE le modèle à sa création (§3.1) : ses lignes naissent toutes,
vides, avec l'instantané de ce qui est demandé. Modifier le modèle ne touche
aucun bilan ouvert — sinon chaque retouche fausserait les courbes en silence.
⚠️ Un bilan se remplit sur plusieurs séances : chaque résultat s'enregistre seul.
Seul un bilan `finalise` entre dans une comparaison, et il ne se modifie plus.
"""

from fastapi import APIRouter, Depends, status

from app.socle.audit import log_write
from app.socle.authz import AthleteAccess, require_athlete_access
from app.socle.db import get_session
from app.socle.erreurs import ErreurMetier, UuidDeChemin, erreurs
from app.kine.schemas_bilan import (
    BilanCree, BilanLu, BilanPatch, BilanResume, ModelesDisponibles, ResultatEcrit,
)
from app.kine import metier_bilans as metier

router = APIRouter(prefix="/athletes/{athlete_id}/bilans", tags=["bilans"])

# Le kiné ou l'athlète lui-même — jamais le coach.
_ACCES = require_athlete_access("owner_or_kine")


@router.get("/modeles", response_model=ModelesDisponibles,
            responses=erreurs(401, 403, 404))
def list_modeles_disponibles(athlete_id: str,
                             access: AthleteAccess = Depends(_ACCES)) -> dict:
    """Les modèles proposables, pour le choix à la création.

    ⚠️ Sous le préfixe ATHLÈTE bien qu'elle n'en dépende pas : c'est ce qui lui
    donne son autorisation. Le catalogue n'est pas lisible par n'importe quel
    authentifié, mais l'athlète doit pouvoir choisir en ouvrant son bilan.
    """
    with get_session() as session:
        metier.uuid_athlete(session, athlete_id)
        lignes = metier.modeles_disponibles(session)
    return {"modeles": [
        {"id": str(m["id"]), "nom": m["nom"], "description": m["description"],
         "archive": m["archive"], "nbTests": m["nb_tests"]}
        for m in lignes
    ]}


@router.get("", response_model=list[BilanResume], responses=erreurs(401, 403, 404))
def list_bilans(athlete_id: str, access: AthleteAccess = Depends(_ACCES)) -> list:
    with get_session() as session:
        aid = metier.uuid_athlete(session, athlete_id)
        lignes = metier.bilans_de(session, aid)
    return [metier.resume(l) for l in lignes]


@router.get("/{bilan_id}", response_model=BilanLu, responses=erreurs(401, 403, 404))
def get_bilan(athlete_id: str, bilan_id: UuidDeChemin,
              access: AthleteAccess = Depends(_ACCES)) -> dict:
    with get_session() as session:
        aid = metier.uuid_athlete(session, athlete_id)
        ligne = metier.bilan_ou_404(session, bilan_id, aid)
        resultats = metier.resultats_de(session, bilan_id)
    return {
        **metier.resume(ligne),
        "antecedents": ligne["antecedents"],
        "notes": ligne["notes"],
        "creeLe": ligne["cree_le"],
        "modifieLe": ligne["modifie_le"],
        "resultats": [metier.resultat_lu(r) for r in resultats],
    }


@router.post("", status_code=status.HTTP_201_CREATED, response_model=BilanLu,
             responses=erreurs(401, 403, 404, 409))
def create_bilan(athlete_id: str, payload: BilanCree,
                 access: AthleteAccess = Depends(_ACCES)) -> dict:
    """Ouvre un bilan `en_cours` en COPIANT le modèle choisi.

    ⚠️ Toutes les lignes de résultats naissent ICI (§3.1), vides mais porteuses
    de leur instantané : le modèle peut ensuite changer, ce bilan ne bouge plus.

    ⚠️ Un modèle VIDE est refusé : un bilan sans test se finaliserait aussitôt
    et entrerait dans les comparaisons sans rien mesurer.

    Les antécédents se pré-remplissent depuis le bilan précédent (§3.7), et
    l'athlète corrige : chaque bilan garde ce qui était connu à SA date.
    `kine_uid` vaut l'appelant s'il est le kiné de l'athlète, NULL sinon — il dit
    qui a CONDUIT le bilan, pas qui le suit.

    Raises:
        ErreurMetier: `modele_introuvable` (404), `modele_vide` (409).
    """
    uid = access.claims["uid"]
    with get_session() as session:
        aid = metier.uuid_athlete(session, athlete_id)

        modele = metier.modele_a_copier_ou_404(session, payload.modeleId)
        kine = metier.kine_de_l_athlete(session, aid)
        antecedents = payload.antecedents
        if antecedents is None:
            antecedents = metier.derniers_antecedents(session, aid)

        bilan_id = metier.ouvrir_un_bilan(
            session, aid=aid, modele_id=payload.modeleId, modele_nom=modele["nom"],
            date=payload.date, kine_uid=uid if uid == kine else None,
            antecedents=antecedents)

        copies = metier.copier_les_tests(session, str(bilan_id), payload.modeleId)
        if not copies:
            # La transaction est annulée par l'exception : aucun bilan fantôme.
            raise ErreurMetier("modele_vide", status.HTTP_409_CONFLICT,
                               "ce modèle ne contient aucun test")
        metier.copier_les_medias(session, str(bilan_id))

        ligne = metier.bilan_ou_404(session, str(bilan_id), aid)
        resultats = metier.resultats_de(session, str(bilan_id))

    log_write(uid=uid, resource="bilan", doc_path=f"athletes/{athlete_id}/bilans/{bilan_id}",
              fields=["create"])
    return {
        **metier.resume(ligne),
        "antecedents": ligne["antecedents"], "notes": ligne["notes"],
        "creeLe": ligne["cree_le"], "modifieLe": ligne["modifie_le"],
        "resultats": [metier.resultat_lu(r) for r in resultats],
    }


@router.patch("/{bilan_id}", response_model=BilanResume, responses=erreurs(401, 403, 404, 409))
def patch_bilan(athlete_id: str, bilan_id: UuidDeChemin, payload: BilanPatch,
                access: AthleteAccess = Depends(_ACCES)) -> dict:
    """Modifie la méta du bilan : date, antécédents, notes, statut.

    ⚠️ Un bilan FINALISÉ ne se modifie plus, EN RIEN (FRE-132) — ni réouverture,
    ni date, ni antécédents, ni notes. C'est la référence comparable : sa date le
    situe sur la courbe, ses antécédents sont la donnée la plus sensible du
    produit. Une correction se fait par un nouveau bilan. Le corps vide reste
    accepté : il n'écrit rien.

    ⚠️ Il ne se finalise que COMPLET : un test manquant se confondrait avec un
    test qui n'existait pas encore. « Renseigné » n'est pas « mesuré » — un test
    impossible (matériel absent, douleur) se marque d'un ressenti ou d'un
    commentaire, mesures à NULL : la base distingue « non réalisé » de « échec ».

    Raises:
        ErreurMetier: `bilan_deja_finalise` (409), `bilan_incomplet` (409).
    """
    champs = payload.model_dump(exclude_unset=True)
    with get_session() as session:
        aid = metier.uuid_athlete(session, athlete_id)
        actuel = metier.bilan_ou_404(session, bilan_id, aid)
        if champs and actuel["statut"] == "finalise":
            raise ErreurMetier("bilan_deja_finalise", status.HTTP_409_CONFLICT,
                               "un bilan finalisé ne se modifie plus : en créer un nouveau")
        if champs.get("statut") == "finalise":
            reste = actuel["total"] - actuel["renseignes"]
            if reste > 0:
                raise ErreurMetier(
                    "bilan_incomplet", status.HTTP_409_CONFLICT,
                    f"il reste {reste} test{'s' if reste > 1 else ''} à renseigner "
                    f"sur {actuel['total']} : un bilan ne se finalise que complet")
        if champs:
            metier.ecrire_la_meta(session, bilan_id, champs)
        ligne = metier.bilan_ou_404(session, bilan_id, aid)
    log_write(uid=access.claims["uid"], resource="bilan",
              doc_path=f"athletes/{athlete_id}/bilans/{bilan_id}", fields=sorted(champs))
    return metier.resume(ligne)


@router.patch("/{bilan_id}/resultats/{resultat_id}", response_model=BilanResume,
              responses=erreurs(401, 403, 404, 409))
def patch_resultat(athlete_id: str, bilan_id: UuidDeChemin,
                   resultat_id: UuidDeChemin, payload: ResultatEcrit,
                   access: AthleteAccess = Depends(_ACCES)) -> dict:
    """Renseigne UN résultat.

    Appelé à chaque frappe, et idempotent : la ligne existe déjà (créée avec le
    bilan), on la met à jour.

    ⚠️ Un test non bilatéral n'a pas de côté DROIT (§3.5), et c'est l'INSTANTANÉ
    qui en décide, pas le modèle courant : un bilan ouvert garde ce qui a été
    demandé à l'athlète.

    ⚠️ Un test SANS MESURE n'en reçoit pas : la valeur ne serait affichée ni
    comparée nulle part — invisible, donc jamais corrigée.

    Raises:
        ErreurMetier: `bilan_deja_finalise` (409), `resultat_introuvable` (404),
            `test_non_bilateral` (422), `test_sans_mesure` (422).
    """
    champs = payload.model_dump(exclude_unset=True)
    with get_session() as session:
        aid = metier.uuid_athlete(session, athlete_id)
        ligne = metier.bilan_ou_404(session, bilan_id, aid)
        if ligne["statut"] == "finalise":
            raise ErreurMetier("bilan_deja_finalise", status.HTTP_409_CONFLICT,
                               "ce bilan est finalisé : ses résultats ne changent plus")

        resultat = metier.resultat_ou_404(session, resultat_id, bilan_id)

        if champs.get("mesureDroite") is not None and not resultat["bilateral"]:
            raise ErreurMetier("test_non_bilateral", status.HTTP_422_UNPROCESSABLE_CONTENT,
                               "ce test n'a qu'un résultat : mesureDroite n'a pas de sens")
        if resultat["mesure"] == "aucune" and (
                champs.get("mesureGauche") is not None
                or champs.get("mesureDroite") is not None):
            raise ErreurMetier("test_sans_mesure", status.HTTP_422_UNPROCESSABLE_CONTENT,
                               "ce test ne se mesure pas : seul le ressenti est attendu")

        if champs:
            metier.ecrire_un_resultat(session, bilan_id, resultat_id, champs)
        ligne = metier.bilan_ou_404(session, bilan_id, aid)
    log_write(uid=access.claims["uid"], resource="bilan_resultat",
              doc_path=f"athletes/{athlete_id}/bilans/{bilan_id}/resultats/{resultat_id}",
              fields=sorted(champs))
    return metier.resume(ligne)


@router.delete("/{bilan_id}", response_model=BilanResume, responses=erreurs(401, 403, 404, 409))
def delete_bilan(athlete_id: str, bilan_id: UuidDeChemin,
                 access: AthleteAccess = Depends(_ACCES)) -> dict:
    """Supprime un bilan EN COURS.

    ⚠️ Un bilan finalisé est une mesure datée : l'effacer retirerait un point
    d'une courbe de santé.

    Raises:
        ErreurMetier: `bilan_deja_finalise` (409).
    """
    with get_session() as session:
        aid = metier.uuid_athlete(session, athlete_id)
        ligne = metier.bilan_ou_404(session, bilan_id, aid)
        if ligne["statut"] == "finalise":
            raise ErreurMetier("bilan_deja_finalise", status.HTTP_409_CONFLICT,
                               "un bilan finalisé ne se supprime pas")
        metier.supprimer_le_bilan(session, bilan_id)
    log_write(uid=access.claims["uid"], resource="bilan",
              doc_path=f"athletes/{athlete_id}/bilans/{bilan_id}", fields=[], status="deleted")
    return metier.resume(ligne)
