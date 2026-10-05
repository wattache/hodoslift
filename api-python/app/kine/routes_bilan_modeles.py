"""Les modèles de bilan : ce que la kiné compose. Spec : `docs/bilan-kine.md`.

⚠️ `require_kine` PARTOUT, lectures comprises. Décider quels tests cliniques
existent est un acte de praticien : ni le coach ni l'admin n'y touchent (§6).
L'athlète voit les modèles disponibles par SA route, sous sa propre autorisation
(`/athletes/{id}/bilans/modeles`).

⚠️ Ce qui est édité ici ne réécrit JAMAIS le passé. Un bilan copie le modèle à sa
création (instantané, §3.1) : retoucher un test change les FUTURS bilans, jamais
ceux déjà passés. C'est ce qui rend l'édition libre sans être dangereuse.
"""

from fastapi import APIRouter, Depends, status

from app.socle.audit import log_write
from app.socle.authz import require_kine
from app.socle.db import get_session
from app.socle.erreurs import ErreurMetier, UuidDeChemin, erreurs
from app.kine.schemas_bilan import (
    ModeleCree, ModeleLu, ModelePatch, ModeleResume, RubriqueCree, RubriquePatch,
    TestCree, TestPatch, TestLu,
)
from app.kine import metier_bilan_modeles as metier

router = APIRouter(prefix="/bilan-modeles", tags=["bilan-modeles"])


# ⚠️ « ABSENT » n'est pas « VIDE ». `mediaIds: []` DÉTACHE tout ; ne pas envoyer
# le champ ne touche à rien. Confondre les deux ferait qu'un PATCH qui ne parle
# que du libellé effacerait les images au passage.
_ABSENT = object()


@router.get("", response_model=list[ModeleResume], responses=erreurs(401, 403))
def list_modeles(claims: dict = Depends(require_kine)) -> list:
    """Le catalogue, archivés compris — la kiné doit pouvoir les désarchiver."""
    with get_session() as session:
        return [metier.resume(r) for r in metier.modeles(session)]


@router.get("/{modele_id}", response_model=ModeleLu, responses=erreurs(401, 403, 404))
def get_modele(modele_id: UuidDeChemin,
               claims: dict = Depends(require_kine)) -> dict:
    with get_session() as session:
        return metier.lire_modele(session, modele_id)


@router.post("", status_code=status.HTTP_201_CREATED, response_model=ModeleLu,
             responses=erreurs(401, 403, 404))
def create_modele(payload: ModeleCree, claims: dict = Depends(require_kine)) -> dict:
    """Crée un modèle, vide ou par DUPLICATION.

    ⚠️ La DUPLICATION est la voie normale (§6) : un bilan spécialisé naît du
    bilan complet, puis on élague.

    Les tests RETIRÉS ne sont pas recopiés : dupliquer part de ce que le modèle
    contient, pas de son historique. Les images, elles, suivent.
    """
    uid = claims["uid"]
    with get_session() as session:
        modele_id = metier.creer_le_modele(session, payload.nom, payload.description, uid)
        if payload.dupliquerDe is not None:
            metier.modele_ou_404(session, payload.dupliquerDe)
            metier.dupliquer_le_contenu(session, payload.dupliquerDe, modele_id)

        resultat = metier.lire_modele(session, str(modele_id))
    log_write(uid=uid, resource="bilan_modele", doc_path=f"bilan-modeles/{modele_id}",
              fields=["create"])
    return resultat


@router.patch("/{modele_id}", response_model=ModeleLu, responses=erreurs(401, 403, 404))
def patch_modele(modele_id: UuidDeChemin, payload: ModelePatch,
                 claims: dict = Depends(require_kine)) -> dict:
    champs = payload.model_dump(exclude_unset=True)
    with get_session() as session:
        metier.modele_ou_404(session, modele_id)
        if champs:
            metier.ecrire_le_modele(session, modele_id, champs)
        resultat = metier.lire_modele(session, modele_id)
    log_write(uid=claims["uid"], resource="bilan_modele",
              doc_path=f"bilan-modeles/{modele_id}", fields=sorted(champs))
    return resultat


@router.delete("/{modele_id}", status_code=status.HTTP_204_NO_CONTENT,
               responses=erreurs(401, 403, 404, 409))
def delete_modele(modele_id: UuidDeChemin,
                  claims: dict = Depends(require_kine)) -> None:
    """Supprime un modèle qu'AUCUN bilan n'a utilisé.

    ⚠️ La base survivrait (`SET NULL`, les bilans restent lisibles par leur
    instantané), mais ils perdraient le fil qui les relie au modèle, donc toute
    comparaison avec un futur bilan du même type. ARCHIVER le retire des choix
    sans rien casser.

    Raises:
        ErreurMetier: `modele_utilise` (409).
    """
    with get_session() as session:
        metier.modele_ou_404(session, modele_id)
        utilises = metier.bilans_qui_utilisent(session, modele_id)
        if utilises:
            raise ErreurMetier(
                "modele_utilise", status.HTTP_409_CONFLICT,
                f"{utilises} bilan(s) utilisent ce modèle : l'archiver plutôt "
                "que le supprimer")
        metier.supprimer_le_modele(session, modele_id)
    log_write(uid=claims["uid"], resource="bilan_modele",
              doc_path=f"bilan-modeles/{modele_id}", fields=[], status="deleted")


# ── Rubriques ──────────────────────────────────────────────────────────────

@router.post("/{modele_id}/rubriques", status_code=status.HTTP_201_CREATED,
             response_model=ModeleLu, responses=erreurs(401, 403, 404))
def create_rubrique(modele_id: UuidDeChemin, payload: RubriqueCree,
                    claims: dict = Depends(require_kine)) -> dict:
    with get_session() as session:
        metier.modele_ou_404(session, modele_id)
        metier.ajouter_une_rubrique(session, modele_id, payload.libelle)
        resultat = metier.lire_modele(session, modele_id)
    log_write(uid=claims["uid"], resource="bilan_rubrique",
              doc_path=f"bilan-modeles/{modele_id}/rubriques", fields=["create"])
    return resultat


@router.patch("/{modele_id}/rubriques/{rubrique_id}", response_model=ModeleLu,
              responses=erreurs(401, 403, 404))
def patch_rubrique(modele_id: UuidDeChemin, rubrique_id: UuidDeChemin,
                   payload: RubriquePatch, claims: dict = Depends(require_kine)) -> dict:
    champs = payload.model_dump(exclude_unset=True)
    with get_session() as session:
        metier.modele_ou_404(session, modele_id)
        metier.rubrique_ou_404(session, rubrique_id, modele_id)
        if champs:
            metier.ecrire_la_rubrique(session, rubrique_id, champs)
        resultat = metier.lire_modele(session, modele_id)
    log_write(uid=claims["uid"], resource="bilan_rubrique",
              doc_path=f"bilan-modeles/{modele_id}/rubriques/{rubrique_id}",
              fields=sorted(champs))
    return resultat


@router.delete("/{modele_id}/rubriques/{rubrique_id}", response_model=ModeleLu,
               responses=erreurs(401, 403, 404, 409))
def delete_rubrique(modele_id: UuidDeChemin, rubrique_id: UuidDeChemin,
                    claims: dict = Depends(require_kine)) -> dict:
    """Supprime une rubrique VIDE.

    ⚠️ Le CASCADE de la base emporterait ses tests en silence, et avec eux le
    lien des résultats déjà enregistrés vers leur test. Retirer les tests
    d'abord est un geste explicite.

    Raises:
        ErreurMetier: `rubrique_non_vide` (409).
    """
    with get_session() as session:
        metier.modele_ou_404(session, modele_id)
        metier.rubrique_ou_404(session, rubrique_id, modele_id)
        restants = metier.tests_de_la_rubrique(session, rubrique_id)
        if restants:
            raise ErreurMetier(
                "rubrique_non_vide", status.HTTP_409_CONFLICT,
                f"cette rubrique porte encore {restants} test(s) : les retirer d'abord")
        metier.supprimer_la_rubrique(session, rubrique_id)
        resultat = metier.lire_modele(session, modele_id)
    log_write(uid=claims["uid"], resource="bilan_rubrique",
              doc_path=f"bilan-modeles/{modele_id}/rubriques/{rubrique_id}",
              fields=[], status="deleted")
    return resultat


# ── Tests ──────────────────────────────────────────────────────────────────

@router.post("/{modele_id}/rubriques/{rubrique_id}/tests",
             status_code=status.HTTP_201_CREATED, response_model=TestLu,
             responses=erreurs(401, 403, 404))
def create_test(modele_id: UuidDeChemin, rubrique_id: UuidDeChemin,
                payload: TestCree, claims: dict = Depends(require_kine)) -> dict:
    with get_session() as session:
        metier.modele_ou_404(session, modele_id)
        metier.rubrique_ou_404(session, rubrique_id, modele_id)
        ligne = metier.ajouter_un_test(session, rubrique_id, payload)
    log_write(uid=claims["uid"], resource="bilan_test",
              doc_path=f"bilan-modeles/{modele_id}/tests", fields=["create"])
    return metier.test_lu(ligne)


@router.patch("/{modele_id}/tests/{test_id}", response_model=TestLu,
              responses=erreurs(401, 403, 404))
def patch_test(modele_id: UuidDeChemin, test_id: UuidDeChemin,
               payload: TestPatch, claims: dict = Depends(require_kine)) -> dict:
    """Modifie un test du modèle, sans toucher AUCUN bilan existant (§3.1).

    ⚠️ Les résultats portent leur propre instantané : changer une charge change
    les prochains bilans, pas la lecture des précédents.
    """
    champs = payload.model_dump(exclude_unset=True)
    # ⚠️ `mediaIds` n'est pas une COLONNE : il désigne une table de liaison, et
    # sort des champs avant la boucle des `SET`.
    media_ids = champs.pop("mediaIds", _ABSENT)
    with get_session() as session:
        metier.modele_ou_404(session, modele_id)
        metier.test_ou_404(session, test_id, modele_id)
        if champs:
            metier.ecrire_le_test(session, test_id, champs)
        if media_ids is not _ABSENT:
            metier.reposer_les_images(session, test_id, media_ids or [])
        ligne = metier.test_avec_ses_medias(session, test_id)
    log_write(uid=claims["uid"], resource="bilan_test",
              doc_path=f"bilan-modeles/{modele_id}/tests/{test_id}",
              fields=sorted(champs) + ([] if media_ids is _ABSENT else ["mediaIds"]))
    return metier.test_lu(ligne)


@router.delete("/{modele_id}/tests/{test_id}", status_code=status.HTTP_204_NO_CONTENT,
               responses=erreurs(401, 403, 404, 409))
def delete_test(modele_id: UuidDeChemin, test_id: UuidDeChemin,
                claims: dict = Depends(require_kine)) -> None:
    """Supprime un test JAMAIS passé.

    ⚠️ Dès qu'un résultat existe, le retrait DOUX (`retire = true`) est la seule
    voie : il sort le test des futurs bilans en gardant le lien qui rend les
    anciens comparables. La base survivrait (`SET NULL`), mais les résultats ne
    seraient plus rattachables.

    Raises:
        ErreurMetier: `test_utilise` (409).
    """
    with get_session() as session:
        metier.modele_ou_404(session, modele_id)
        metier.test_ou_404(session, test_id, modele_id)
        utilises = metier.resultats_qui_portent(session, test_id)
        if utilises:
            raise ErreurMetier(
                "test_utilise", status.HTTP_409_CONFLICT,
                f"{utilises} résultat(s) portent ce test : le retirer "
                "(retire = true) plutôt que le supprimer")
        metier.supprimer_le_test(session, test_id)
    log_write(uid=claims["uid"], resource="bilan_test",
              doc_path=f"bilan-modeles/{modele_id}/tests/{test_id}",
              fields=[], status="deleted")
