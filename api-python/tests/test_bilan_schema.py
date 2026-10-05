"""Le schéma du bilan kiné tient-il ses promesses cliniques ?

⚠️ CES SPECS PORTENT SUR LA BASE, PAS SUR DU CODE, et c'est voulu : les garanties
qu'on cherche ici doivent tenir même si une route se trompe. Un `CHECK` mal écrit
ou une clé primaire manquante ne se voient pas à la lecture — ils se voient quand
la donnée est déjà fausse, des mois plus tard.

Elles tournent sur le VRAI Postgres (fixture `pg`), qui applique
`docs/postgres-schema.sql` : c'est le même fichier que la production, à ceci près
qu'il faut y penser à chaque migration. Ces tests sont ce qui rappelle d'y penser.
"""

import pytest
from sqlalchemy import text

_ATH = "aaaaaaaa-1111-1111-1111-111111111111"


@pytest.fixture
def modele(pg):
    """Un modèle minimal : une rubrique, un test."""
    mid = pg.execute(text(
        "INSERT INTO bilan_modeles (nom) VALUES ('M') RETURNING id")).scalar()
    rid = pg.execute(text(
        "INSERT INTO bilan_rubriques (modele_id, libelle, ordre) "
        "VALUES (:m, 'R', 0) RETURNING id"), {"m": mid}).scalar()
    tid = pg.execute(text(
        "INSERT INTO bilan_tests (rubrique_id, libelle, mesure, bilateral, ordre) "
        "VALUES (:r, 'Grip', 'secondes', true, 0) RETURNING id"), {"r": rid}).scalar()
    return {"modele": mid, "rubrique": rid, "test": tid}


@pytest.fixture
def bilan(pg, modele):
    """Un athlète, un kiné, un bilan en cours."""
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('coach-1','c@x.fr'), ('kine-1','k@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1')"))
    pg.execute(text("INSERT INTO kines (uid) VALUES ('kine-1')"))
    pg.execute(text(
        "INSERT INTO athletes (id, legacy_id, coach_uid, first_name, kine_uid) "
        "VALUES (CAST(:a AS uuid),'a1','coach-1','A','kine-1')"), {"a": _ATH})
    return pg.execute(text(
        "INSERT INTO bilans (athlete_id, modele_id, modele_nom, bilan_date, kine_uid) "
        "VALUES (CAST(:a AS uuid), :m, 'M', DATE '2026-08-21', 'kine-1') RETURNING id"),
        {"a": _ATH, "m": modele["modele"]}).scalar()


def test_un_bilan_naît_EN_COURS(pg, bilan):
    """⚠️ `en_cours` EST LA RÈGLE, PAS L'EXCEPTION. 32 tests avec du matériel ne
    se remplissent pas d'une traite. Si le défaut était `finalise`, un bilan à
    peine commencé entrerait dans les comparaisons — et une évolution se lirait
    sur trois tests au lieu de trente-deux."""
    assert pg.execute(text("SELECT statut FROM bilans WHERE id = :b"), {"b": bilan}).scalar() == "en_cours"


@pytest.mark.parametrize("invente", ["brouillon", "en cours", "draft"])
def test_un_STATUT_inventé_est_refusé(pg, bilan, invente):
    """Le vocabulaire est CLOS. Trois variantes qu'un appel distrait pourrait
    écrire, et qui feraient chacune un troisième état qu'aucun écran ne sait
    traiter.

    ⚠️ LES DEUX PREMIÈRES SONT DES PIÈGES RÉELS, pas des épouvantails.
    `brouillon` est le mot que ce schéma portait avant le 21/08 — un copier-coller
    d'une branche antérieure l'écrirait sans hésiter. Et « en cours » avec une
    ESPACE est à un caractère de la vraie valeur `en_cours` : c'est le genre
    d'écart qu'on relit dix fois sans le voir.

    ⚠️ PARAMÉTRÉ ET NON BOUCLÉ, et la différence n'est pas cosmétique. Écrit en
    boucle, ce test PASSAIT en glissant une valeur VALIDE au milieu : le premier
    refus avorte la transaction Postgres, et tout ce qui suit échoue pour cette
    raison-là plutôt que pour la bonne. Un test vert qui ne teste rien. La
    paramétrisation donne une transaction neuve par cas — vérifié en y glissant
    `finalise`, qui fait bien rougir le cas correspondant."""
    with pytest.raises(Exception, match="statut|check"):
        pg.execute(text("UPDATE bilans SET statut = :s WHERE id = :b"),
                   {"s": invente, "b": bilan})


def test_un_RESSENTI_inventé_est_refusé(pg, bilan):
    """`ras / douleur / gene` est le MÊME vocabulaire que le signalement,
    volontairement : une gêne relevée pendant un bilan doit
    pouvoir alimenter le tableau « qui va mal en ce moment ». Deux vocabulaires
    proches mais distincts rendraient ce rapprochement impossible."""
    with pytest.raises(Exception, match="ressenti|check"):
        pg.execute(text(
            "INSERT INTO bilan_resultats (bilan_id, test_libelle, mesure, bilateral, "
            "ressenti) VALUES (:b, 'Grip', 'secondes', true, 'un peu mal')"), {"b": bilan})


def test_NULL_et_ZERO_sont_DEUX_choses_différentes(pg, bilan):
    """⚠️ LA DISTINCTION EST CLINIQUE, et c'est la raison d'être de ce test.

      NULL = test NON RÉALISÉ — matériel absent, douleur qui l'empêche, pas eu
             le temps ;
      0    = test réalisé, échec complet.

    Pour une kiné ces deux-là n'ont rien à voir. Les confondre ferait qu'un test
    sauté creuse la courbe exactement comme une régression, et personne ne
    pourrait plus distinguer l'un de l'autre après coup.

    C'est le défaut le plus récurrent du projet — le vide et l'absence traités
    pareil. Ici la base les garde distincts, et rien ne doit venir « normaliser »
    l'un vers l'autre."""
    pg.execute(text(
        "INSERT INTO bilan_resultats (bilan_id, test_libelle, mesure, bilateral, "
        "mesure_gauche, mesure_droite) "
        "VALUES (:b, 'Grip', 'secondes', true, 0, NULL)"), {"b": bilan})
    g, d = pg.execute(text(
        "SELECT mesure_gauche, mesure_droite FROM bilan_resultats "
        "WHERE bilan_id = :b"), {"b": bilan}).one()
    assert g == 0, "un échec complet doit rester un ZÉRO"
    assert d is None, "un test non réalisé doit rester ABSENT"
    assert g is not None and (d is None) != (g is None)


def test_un_seul_RÉSULTAT_par_test_et_par_bilan(pg, bilan, modele):
    """⚠️ CE QUI REND LA SAISIE IDEMPOTENTE. Un bilan en cours enregistre à chaque
    frappe : la même ligne est réécrite des dizaines de fois. Sans cette clé, on
    accumulerait des doublons dont aucun ne serait « le » résultat, et l'écran en
    afficherait un au hasard."""
    ligne = ("INSERT INTO bilan_resultats (bilan_id, test_id, test_libelle, mesure, "
             "bilateral) VALUES (:b, :t, 'Grip', 'secondes', true)")
    pg.execute(text(ligne), {"b": bilan, "t": modele["test"]})
    with pytest.raises(Exception, match="duplicate|unique|pkey"):
        pg.execute(text(ligne), {"b": bilan, "t": modele["test"]})


def test_le_RÉÉCRIRE_marche_par_contre(pg, bilan, modele):
    """Le pendant du précédent : la clé bloque les doublons, elle ne bloque pas la
    correction. C'est exactement ce dont la saisie a besoin — la ligne naît avec le
    bilan (la copie du modèle), et chaque frappe la met à jour."""
    pg.execute(text(
        "INSERT INTO bilan_resultats (bilan_id, test_id, test_libelle, mesure, "
        "bilateral, mesure_gauche) VALUES (:b, :t, 'Grip', 'secondes', true, 30)"),
        {"b": bilan, "t": modele["test"]})
    pg.execute(text("UPDATE bilan_resultats SET mesure_gauche = 42 WHERE bilan_id = :b"),
               {"b": bilan})
    assert pg.execute(text(
        "SELECT mesure_gauche FROM bilan_resultats WHERE bilan_id = :b"), {"b": bilan}).scalar() == 42


def test_supprimer_le_BILAN_emporte_ses_résultats(pg, bilan):
    """Un résultat sans bilan n'est rien : ni daté, ni rattaché à personne."""
    pg.execute(text(
        "INSERT INTO bilan_resultats (bilan_id, test_libelle, mesure, bilateral) "
        "VALUES (:b, 'Grip', 'secondes', true)"), {"b": bilan})
    pg.execute(text("DELETE FROM bilans WHERE id = :b"), {"b": bilan})
    assert pg.execute(text("SELECT count(*) FROM bilan_resultats WHERE bilan_id = :b"), {"b": bilan}).scalar() == 0


def test_le_départ_du_KINÉ_n_emporte_PAS_le_bilan(pg, bilan):
    """⚠️ LE BILAN APPARTIENT À L'ATHLÈTE, PAS AU PRATICIEN. `ON DELETE SET NULL` :
    un kiné qui s'en va ne doit pas effacer l'historique de santé des gens qu'il a
    suivis. C'est la même leçon que FRE-24 sur la bibliothèque — une référence
    d'auteur n'a pas à retenir, ni à emporter."""
    pg.execute(text("UPDATE athletes SET kine_uid = NULL WHERE id = CAST(:a AS uuid)"), {"a": _ATH})
    pg.execute(text("DELETE FROM kines WHERE uid = 'kine-1'"))
    ligne = pg.execute(text("SELECT statut, kine_uid FROM bilans WHERE id = :b"), {"b": bilan}).first()
    assert ligne is not None, "le bilan a disparu avec son kiné"
    assert ligne.kine_uid is None


def test_supprimer_l_ATHLÈTE_emporte_ses_bilans(pg, bilan):
    """L'inverse du précédent, et c'est voulu : la donnée de santé d'une personne
    part avec elle. C'est la règle du RGPD autant que celle du bon sens."""
    pg.execute(text("DELETE FROM athletes WHERE id = CAST(:a AS uuid)"), {"a": _ATH})
    assert pg.execute(text("SELECT count(*) FROM bilans WHERE id = :b"), {"b": bilan}).scalar() == 0


def test_supprimer_un_TEST_du_modèle_n_efface_PAS_les_résultats(pg, bilan, modele):
    """⚠️ `ON DELETE SET NULL`, ET C'EST TOUT LE CONTRAIRE D'UN DÉTAIL. Un test
    supprimé du modèle ne doit jamais emporter des mesures d'athlètes : le résultat
    survit, lisible par son INSTANTANÉ (§3.1), et cesse seulement d'être comparable
    aux bilans suivants.

    C'est ce qui permet à la kiné d'éditer ses modèles sans qu'on ait à lui
    expliquer quelles retouches sont dangereuses : aucune ne l'est."""
    pg.execute(text(
        "INSERT INTO bilan_resultats (bilan_id, test_id, test_libelle, mesure, "
        "bilateral, mesure_gauche) VALUES (:b, :t, 'Grip', 'secondes', true, 45)"),
        {"b": bilan, "t": modele["test"]})
    pg.execute(text("DELETE FROM bilan_tests WHERE id = :t"), {"t": modele["test"]})

    ligne = pg.execute(text(
        "SELECT test_id, test_libelle, mesure_gauche FROM bilan_resultats "
        "WHERE bilan_id = :b"), {"b": bilan}).first()
    assert ligne is not None, "le résultat a disparu avec le test du modèle"
    assert ligne.test_id is None, "le lien devait être coupé, pas la ligne"
    assert ligne.test_libelle == "Grip" and ligne.mesure_gauche == 45


def test_supprimer_le_MODÈLE_n_efface_PAS_les_bilans(pg, bilan, modele):
    """Même règle un cran au-dessus : `bilans.modele_id` est `SET NULL`, et
    `modele_nom` est recopié pour que l'instance reste intelligible seule."""
    pg.execute(text("DELETE FROM bilan_resultats WHERE bilan_id = :b"), {"b": bilan})
    pg.execute(text("DELETE FROM bilan_tests WHERE rubrique_id = :r"), {"r": modele["rubrique"]})
    pg.execute(text("DELETE FROM bilan_modeles WHERE id = :m"), {"m": modele["modele"]})
    ligne = pg.execute(text(
        "SELECT modele_id, modele_nom FROM bilans WHERE id = :b"), {"b": bilan}).first()
    assert ligne is not None and ligne.modele_id is None
    assert ligne.modele_nom == "M", "le nom recopié devait survivre"


def test_un_test_SANS_CÔTÉ_ne_peut_pas_porter_de_mesure_DROITE(pg, bilan, modele):
    """⚠️ LA BASE LE REFUSE, PAS SEULEMENT LE ROUTEUR.

    `patch_resultat` refuse déjà ce cas — mais une garde de routeur ne protège
    que le chemin qu'on a écrit. Un script de reprise, un correctif SQL passé à
    la main un soir de panne, ou une route ajoutée demain par habitude écrivent
    sans la croiser.

    Et le dégât est SOURNOIS : une `mesure_droite` sur un test de tronc ne
    s'affiche sur aucun écran (l'interface n'y met qu'un champ), donc personne ne
    la corrige — jusqu'au jour où une comparaison la ramasse."""
    with pytest.raises(Exception, match="bilateral|check"):
        pg.execute(text(
            "INSERT INTO bilan_resultats (bilan_id, test_libelle, mesure, bilateral, "
            "mesure_gauche, mesure_droite) "
            "VALUES (:b, 'Érecteur du rachis', 'secondes', false, 45, 40)"), {"b": bilan})


def test_un_test_sans_côté_accepte_UNE_mesure(pg, bilan):
    """Le pendant : la contrainte refuse le côté en trop, pas le test."""
    pg.execute(text(
        "INSERT INTO bilan_resultats (bilan_id, test_libelle, mesure, bilateral, "
        "mesure_gauche) VALUES (:b, 'Érecteur du rachis', 'secondes', false, 45)"),
        {"b": bilan})
    assert pg.execute(text(
        "SELECT mesure_gauche FROM bilan_resultats WHERE bilan_id = :b"),
        {"b": bilan}).scalar() == 45


def test_un_test_SANS_MESURE_ne_peut_porter_aucun_nombre(pg, bilan):
    """Un test de mobilité n'observe qu'un ressenti. Un nombre glissé là dormirait
    en base, invisible à l'écran et inutilisable en comparaison."""
    with pytest.raises(Exception, match="mesure|check"):
        pg.execute(text(
            "INSERT INTO bilan_resultats (bilan_id, test_libelle, mesure, bilateral, "
            "mesure_gauche) VALUES (:b, 'Épaule — flexion', 'aucune', false, 12)"),
            {"b": bilan})


def test_un_test_sans_mesure_garde_son_RESSENTI_et_son_COMMENTAIRE(pg, bilan):
    """⚠️ CE QUI REND LA CONTRAINTE TENABLE. Elle interdit les NOMBRES, pas
    l'observation : c'est précisément sur ces tests-là que le ressenti et le
    commentaire sont tout ce qu'il y a."""
    pg.execute(text(
        "INSERT INTO bilan_resultats (bilan_id, test_libelle, mesure, bilateral, "
        "ressenti, detail) "
        "VALUES (:b, 'Épaule — flexion', 'aucune', false, 'gene', 'tire à droite')"),
        {"b": bilan})
    ligne = pg.execute(text(
        "SELECT ressenti, detail FROM bilan_resultats WHERE bilan_id = :b"), {"b": bilan}).one()
    assert ligne.ressenti == "gene" and ligne.detail == "tire à droite"
