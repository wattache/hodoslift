"""LES MÉDIAS DE DÉMONSTRATION (FRE-99, lot B) — contre un VRAI Postgres.

Il n'y a pas encore de route : ce fichier garde ce que la TABLE promet, et rien
d'autre. C'est délibéré — les contraintes posées ici sont celles qui empêcheront
plus tard une route mal écrite de faire des dégâts, et elles doivent être vraies
avant que cette route existe.

⚠️ CE QUI SE JOUE VRAIMENT : la séparation des deux familles de médias (§3.6).
Une table qui accepterait n'importe quoi ferait basculer les démonstrations dans
le régime des données de santé le jour où quelqu'un y déposerait une vidéo
d'athlète « en attendant ». Les CHECK sont ce qui rend ce jour impossible.
"""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError


@pytest.fixture
def kine(pg):
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('kine-1','k@x.fr')"))
    pg.execute(text("INSERT INTO kines (uid) VALUES ('kine-1')"))
    return pg


def _creer(conn, **champs):
    champs.setdefault("chemin", "tests/squat-overhead-face.png")
    colonnes = ", ".join(champs)
    binds = ", ".join(f":{c}" for c in champs)
    return conn.execute(text(
        f"INSERT INTO bilan_medias_demo ({colonnes}) VALUES ({binds}) RETURNING id"),
        champs).scalar()


def test_un_media_naît_image_par_défaut(kine):
    """`type` a une valeur par défaut : tant qu'il n'y a qu'une nature de média,
    l'exiger à chaque insertion serait du bruit."""
    mid = _creer(kine, cree_par="kine-1")
    ligne = kine.execute(text(
        "SELECT type, legende, cree_par FROM bilan_medias_demo WHERE id = :i"),
        {"i": mid}).mappings().first()
    assert ligne["type"] == "image"
    assert ligne["legende"] is None
    assert ligne["cree_par"] == "kine-1"


def test_une_VIDEO_est_refusée(kine):
    """⚠️ LE CHECK QUI PORTE LA DÉCISION DU 26/08. La spec prévoyait
    `('image', 'video')`, mais une vidéo ne vivra PAS dans le seau : api.video la
    transcode et la sert, donc elle se désigne par un identifiant chez eux, pas
    par un chemin d'objet. Accepter « video » ici inviterait à ranger cet
    identifiant dans `chemin` — un champ à deux natures d'adresse, c'est-à-dire
    exactement ce qu'on paye deux ans plus tard.

    Le refus est un marqueur : quand la vidéo arrivera, elle arrivera avec sa
    colonne, et CE test devra être réécrit sciemment."""
    with pytest.raises(IntegrityError):
        _creer(kine, type="video")


@pytest.mark.parametrize("chemin", ["", "   "])
def test_un_chemin_VIDE_est_refusé(kine, chemin):
    """Un média sans chemin ne désigne rien. C'est le même piège que partout
    ailleurs dans ce projet : `''` et NULL confondus à une frontière — ici NULL
    est déjà interdit, restait la chaîne blanche."""
    with pytest.raises(IntegrityError):
        _creer(kine, chemin=chemin)


def test_retirer_le_ROLE_kiné_ne_touche_ni_la_photo_ni_son_auteur(kine):
    """⚠️ CE TEST GARDAIT UNE PERTE, ET NE LA GARDE PLUS (26/08).

    Il vérifiait qu'au départ d'un kiné la photo survivait avec `cree_par` à
    NULL — l'attribution disparaissait. C'était mieux que de perdre la photo,
    mais toujours faux : on ne supprime jamais un `users` dans ce produit, on
    retire une ligne `kines`. La personne reste ; seul son RÔLE change.

    La clé pointe donc vers `users(uid)`, et un changement de rôle ne concerne
    plus ni la photo ni son auteur. Même correction que `kine_notes` — le
    symptôme était opposé, la cause identique."""
    mid = _creer(kine, cree_par="kine-1")
    kine.execute(text("DELETE FROM kines WHERE uid = 'kine-1'"))

    ligne = kine.execute(text(
        "SELECT chemin, cree_par FROM bilan_medias_demo WHERE id = :i"),
        {"i": mid}).mappings().first()
    assert ligne is not None, "la photo a disparu avec le rôle de son auteur"
    assert ligne["cree_par"] == "kine-1", "l'attribution a été perdue sur un changement de RÔLE"


def test_supprimer_un_média_ne_supprime_PAS_le_test(kine):
    """⚠️ LA CASCADE S'ARRÊTE AU LIEN, et il protège l'inverse. Un test vaut par
    son PROTOCOLE écrit : c'est ainsi que les 32 tests fonctionnent aujourd'hui,
    sans aucune image. Une cascade qui remonterait au test le ferait disparaître
    parce qu'on a retiré sa photo — une perte sans commune mesure avec le geste.

    ⚠️ ET CE N'EST PLUS UN `SET NULL` DEPUIS QUE LES IMAGES SONT UNE LISTE : c'est
    la LIGNE DE LIAISON qui part. Le test, lui, ne bouge pas — il a simplement une
    photo de moins."""
    kine.execute(text(
        "INSERT INTO bilan_modeles (id, nom) VALUES "
        "('11111111-1111-1111-1111-111111111111', 'Bilan complet')"))
    kine.execute(text(
        "INSERT INTO bilan_rubriques (id, modele_id, libelle, ordre) VALUES "
        "('22222222-2222-2222-2222-222222222222',"
        " '11111111-1111-1111-1111-111111111111', 'Tests généraux', 1)"))
    mid = _creer(kine)
    kine.execute(text(
        "INSERT INTO bilan_tests (id, rubrique_id, libelle, ordre) VALUES "
        "('33333333-3333-3333-3333-333333333333',"
        " '22222222-2222-2222-2222-222222222222', 'Squat overhead', 1)"))
    kine.execute(text(
        "INSERT INTO bilan_test_medias (test_id, media_id, ordre) VALUES "
        "('33333333-3333-3333-3333-333333333333', :m, 0)"), {"m": mid})

    kine.execute(text("DELETE FROM bilan_medias_demo WHERE id = :i"), {"i": mid})

    ligne = kine.execute(text(
        "SELECT libelle FROM bilan_tests "
        "WHERE id = '33333333-3333-3333-3333-333333333333'")).mappings().first()
    assert ligne is not None, "le test a disparu avec sa photo"
    assert kine.execute(text(
        "SELECT count(*) FROM bilan_test_medias "
        "WHERE test_id = '33333333-3333-3333-3333-333333333333'")).scalar() == 0


def test_un_média_MONTRÉ_PAR_UN_BILAN_ne_s_efface_pas(kine):
    """⚠️ L'ASYMÉTRIE VOULUE, et c'est la seule chose qui la garde. Côté MODÈLE,
    retirer une image défait un lien : le catalogue est vivant. Côté BILAN, un
    résultat est une mesure datée prise SOUS UNE CONSIGNE — effacer l'image que
    ce bilan montre encore viderait une consigne du passé en silence, exactement
    ce que l'instantané (§3.1) existe pour empêcher.

    Aucune route ne supprime de média aujourd'hui (la clé Scaleway ne porte pas
    ce droit) : cette règle attend le jour où l'une existera. C'est précisément
    pour ce jour-là qu'elle est écrite maintenant — après, personne ne se
    demandera pourquoi la suppression échoue, on retirera la contrainte."""
    mid = _creer(kine)
    kine.execute(text("INSERT INTO users (uid, email) VALUES ('coach-1','c@x.fr')"))
    kine.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1')"))
    kine.execute(text(
        "INSERT INTO athletes (id, legacy_id, coach_uid, first_name) VALUES "
        "('aaaaaaaa-1111-1111-1111-111111111111','a1','coach-1','A')"))
    kine.execute(text(
        "INSERT INTO bilans (id, athlete_id, bilan_date, modele_nom) VALUES "
        "('44444444-4444-4444-4444-444444444444',"
        " 'aaaaaaaa-1111-1111-1111-111111111111', '2026-08-26', 'Bilan complet')"))
    kine.execute(text(
        "INSERT INTO bilan_resultats (id, bilan_id, test_libelle, mesure, bilateral) "
        "VALUES ('55555555-5555-5555-5555-555555555555',"
        " '44444444-4444-4444-4444-444444444444', 'Squat overhead', 'aucune', false)"))
    kine.execute(text(
        "INSERT INTO bilan_resultat_medias (resultat_id, media_id, ordre) VALUES "
        "('55555555-5555-5555-5555-555555555555', :m, 0)"), {"m": mid})

    with pytest.raises(IntegrityError):
        kine.execute(text("DELETE FROM bilan_medias_demo WHERE id = :i"), {"i": mid})


def test_le_NOM_DU_SEAU_n_est_pas_stocké(kine):
    """⚠️ CE QUE CE TEST GARDE EST UNE ABSENCE, et c'est le genre de décision
    qu'on défait sans y penser. `chemin` porte le chemin de l'objet, PAS l'URL
    complète ni le nom du seau : ceux-là viennent de l'environnement. Y stocker
    une URL absolue rendrait un changement d'hébergeur — le but même de FRE-99 —
    dépendant d'une réécriture de toutes les lignes."""
    colonnes = {r[0] for r in kine.execute(text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name = 'bilan_medias_demo'")).all()}
    assert colonnes == {"id", "chemin", "type", "legende", "cree_par", "cree_le"}, \
        "une colonne est apparue : vérifier qu'elle ne fige pas l'hébergeur"
