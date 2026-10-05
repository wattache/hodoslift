"""LE VOCABULAIRE D'UNE LIGNE — une seule définition, et on le vérifie (FRE-45).

⚠️ POURQUOI CE FICHIER EXISTE. La liste des champs de prescription vivait en
DEUX exemplaires : `app/entrainement/routes_training_structure.py` disait ce que la création
accepte, `generation_semaine.py` ce que la génération recopie. Elles ne
différaient que d'un champ — `kind` — ce qui rendait la divergence invisible :
les deux avaient l'air correctes, et aucun test ne les confrontait.

Ce que ça aurait coûté un jour : un champ de prescription ajouté à l'une seule.
Côté création, la route l'ignore en silence (les champs inconnus sont écartés,
pas rejetés) ; côté génération, la semaine produite le perd. Dans les deux cas,
rien ne casse — quelque chose disparaît.

Ces specs ne gardent donc pas une liste, elles gardent une RELATION.
"""

from app.entrainement.generation_semaine import _PRESCRIPTION as COPIES_A_LA_GENERATION
from app.entrainement.prescription import (
    CHAMPS_COPIES,
    CHAMPS_PRESCRIPTION,
    COLONNES_PAR_TABLE,
    champs_de_groupe,
    normaliser_groupes,
    valeur_ligne,
)
from app.entrainement.arbre_creation import COLONNES_PAR_TABLE as TABLES_DE_L_ECRITURE


def test_l_ecriture_et_la_generation_lisent_la_MEME_source():
    """⚠️ LA SPEC QUI PORTE LE FICHIER. Si quelqu'un redéfinit une liste locale
    « pour aller vite », cette égalité d'IDENTITÉ tombe — pas juste l'égalité de
    contenu, qui laisserait passer une copie fidèle vouée à dériver."""
    assert TABLES_DE_L_ECRITURE is COLONNES_PAR_TABLE
    assert COPIES_A_LA_GENERATION is CHAMPS_COPIES


def test_la_generation_recopie_la_prescription_ET_la_nature():
    """`kind` n'est pas dans la prescription — c'est un vocabulaire clos, traité à
    part parce qu'une chaîne vide y violerait le CHECK. Mais il accompagne la
    prescription partout : marquer un échauffement a autant de sens dans la trame
    que dans la semaine générée."""
    assert set(CHAMPS_COPIES) == CHAMPS_PRESCRIPTION | {"kind"}


def test_aucun_champ_de_REALISE_ne_se_copie():
    """⚠️ LA RÈGLE DU 21/08 (FRE-75), EXPRIMÉE EN VOCABULAIRE : une charge réelle
    ne se duplique JAMAIS avec la semaine — elle vit là où elle a été saisie.

    37 lignes de production portaient une perf que personne n'avait faite, et le
    front l'effaçait pourtant déjà : tant qu'une règle ne tient qu'au client,
    elle ne vaut que pour le client qui l'applique."""
    realise = {"repsDone", "weightDone", "feltRPE", "feltRPEBySet",
               "athleteFeedback", "restActual", "dateExact"}
    assert CHAMPS_PRESCRIPTION.isdisjoint(realise)
    assert set(CHAMPS_COPIES).isdisjoint(realise)
    for table, permises in COLONNES_PAR_TABLE.items():
        assert permises.isdisjoint(realise), f"{table} accepte du réalisé"


def test_incrementRef_n_est_copie_nulle_part():
    """Ce champ n'existe NULLE PART côté serveur : ni colonne, ni contrat de
    lecture. Le générateur TypeScript le recopiait — la copie écrivait donc une
    valeur qui ne survivait à aucun aller-retour."""
    assert "incrementRef" not in CHAMPS_COPIES
    assert "incrementRef" not in CHAMPS_PRESCRIPTION


def test_chaque_table_accepte_toute_la_prescription():
    """Les différences entre les trois tables portent sur le PLACEMENT (un
    accessoire a un jour, un principe un tier), jamais sur la prescription."""
    for table, permises in COLONNES_PAR_TABLE.items():
        assert CHAMPS_PRESCRIPTION <= permises, f"{table} en perd"


def test_les_differences_entre_tables_sont_celles_du_PLACEMENT():
    """Envoyer un champ à la mauvaise table donne un `UndefinedColumn`, donc un
    500 et non un refus lisible. Ces trois écarts sont donc des faits de schéma,
    pas des réglages."""
    extra = {t: sorted(c - CHAMPS_PRESCRIPTION) for t, c in COLONNES_PAR_TABLE.items()}
    # `unbroken` suit les groupes (FRE-116) : là où il y a un `groupId`, pas ailleurs.
    assert extra["training_exercises"] == ["groupId", "groupKind", "kind", "link", "tier", "unbroken"]
    assert extra["training_base_principles"] == ["kind", "tier"]
    assert extra["training_base_accessories"] == ["day", "groupId", "groupKind", "kind", "unbroken"]


class TestValeurLigne:
    """⚠️ LE FRONT ENVOIE `''` POUR TOUT CE QUI EST VIDE, et ces chemins reçoivent
    un dictionnaire LIBRE — pas un modèle Pydantic. Sans nettoyage, `''` vers une
    colonne typée fait un 500, que le navigateur signale d'ailleurs en CORS
    puisqu'une réponse d'erreur ne porte pas d'en-têtes."""

    def test_un_booleen_vide_devient_faux_et_non_une_erreur(self):
        assert valeur_ligne("weightLocked", "") is False
        assert valeur_ligne("weightLocked", "true") is True
        assert valeur_ligne("weightLocked", True) is True

    def test_un_entier_vide_devient_NULL_et_non_zero(self):
        # ⚠️ `None` et pas 0 : un tier absent n'est pas un tier 0.
        assert valeur_ligne("tier", "") is None
        assert valeur_ligne("tier", 2) == 2

    def test_un_booleen_n_est_pas_lu_comme_un_entier(self):
        # `isinstance(True, int)` vaut vrai en Python : sans la garde explicite,
        # un `True` passerait pour un tier.
        assert valeur_ligne("tier", True) is None

    def test_un_vocabulaire_vide_devient_NULL(self):
        # `''` violerait le CHECK de la colonne.
        assert valeur_ligne("kind", "") is None
        assert valeur_ligne("kind", "rehab") == "rehab"

    def test_le_texte_passe_intact(self):
        assert valeur_ligne("name", "SQUAT") == "SQUAT"

    def test_un_texte_vide_devient_NULL_lui_aussi(self):
        """⚠️ CETTE SPEC AFFIRMAIT L'INVERSE — `valeur_ligne("coachNote", "")`
        rendait `''`, et c'était la moitié du défaut (FRE-137).

        La base portait les deux encodages de la même absence, et le `''`
        REMPLAÇAIT le `NULL` ligne après ligne : mesuré le 11/09 par semaine
        d'entraînement, `tempo` avait 0 vide en juin contre 154 sur 171 en
        octobre. Le vocabulaire était déjà protégé — par son CHECK, pas par une
        décision — et le texte libre ne l'était pas.
        """
        assert valeur_ligne("coachNote", "") is None
        assert valeur_ligne("tempo", "   ") is None
        # ⚠️ Ce qui n'est pas vide reste intact : « 0 » est une charge réelle sur
        # 461 lignes de production, et « PDC » une consigne.
        assert valeur_ligne("weight", "0") == "0"
        assert valeur_ligne("weight", "PDC") == "PDC"

    def test_une_colonne_NOT_NULL_garde_sa_chaine_vide(self):
        """⚠️ `day` EST `NOT NULL` : y écrire `NULL` ferait un 500 sur le geste
        d'ajout d'un accessoire. Relevé le 11/09 — c'est la seule colonne dans ce
        cas parmi les tables de lignes, et aucune de `training_exercises`."""
        assert valeur_ligne("day", "") == ""


# --------------------------------------------------------------------------- #
# LA NATURE D'UN GROUPE — elle appartient au GROUPE, pas à la ligne (FRE-36)
# --------------------------------------------------------------------------- #

def test_une_nature_annoncee_par_UNE_ligne_gagne_tout_le_groupe():
    """⚠️ LE POINT QUI DÉCIDE SI LA NATURE EST FIABLE. Un groupe mi-bi-set
    mi-dropset n'a aucune lecture possible : l'en-tête afficherait l'une, les
    champs proposeraient l'autre. Mieux vaut que ce soit IMPOSSIBLE que corrigé
    après coup."""
    lignes = [
        {"groupId": "g1", "groupKind": "dropset"},
        {"groupId": "g1", "groupKind": ""},
        {"groupId": "g1"},
    ]
    normaliser_groupes(lignes)
    assert [l["groupKind"] for l in lignes] == ["dropset", "dropset", "dropset"]


def test_deux_lignes_qui_se_CONTREDISENT_sont_tranchees():
    """⚠️ ET CE N'EST PAS THÉORIQUE. L'écran ne propose déjà qu'une case
    séries/repos pour tout un groupe, et la donnée diverge quand même : 8 des 42
    groupes réels portent deux valeurs de `rest`, 3 deux valeurs de `sets`. Une
    affordance n'est pas un invariant — elle ne vaut que pour le chemin qu'on a
    prévu, et il y en a toujours un autre."""
    lignes = [
        {"groupId": "g1", "groupKind": "dropset"},
        {"groupId": "g1", "groupKind": "biset"},
    ]
    normaliser_groupes(lignes)
    assert lignes[0]["groupKind"] == lignes[1]["groupKind"] == "dropset"


def test_deux_groupes_DISTINCTS_gardent_chacun_la_sienne():
    """Le garde-fou ne doit pas uniformiser toute la séance."""
    lignes = [
        {"groupId": "g1", "groupKind": "dropset"},
        {"groupId": "g1"},
        {"groupId": "g2", "groupKind": "biset"},
        {"groupId": "g2"},
    ]
    normaliser_groupes(lignes)
    assert [l["groupKind"] for l in lignes] == ["dropset", "dropset", "biset", "biset"]


def test_une_ligne_SANS_groupe_n_a_pas_de_nature():
    """⚠️ SINON UN LIAGE FUTUR LA RESSUSCITE. Une nature posée sur une ligne
    libre ne veut rien dire aujourd'hui, et décide de tout le jour où on la lie —
    en silence, et sans que personne l'ait demandé."""
    lignes = [{"groupId": "", "groupKind": "dropset"}, {"groupKind": "dropset"}]
    normaliser_groupes(lignes)
    assert [l["groupKind"] for l in lignes] == [None, None]


def test_un_groupe_SANS_nature_en_recoit_une_PAR_DEFAUT():
    """⚠️ CETTE SPEC DISAIT L'INVERSE JUSQU'AU 08/09, ET SON ARGUMENT MÉRITE
    D'ÊTRE GARDÉ : « la normalisation n'invente pas une nature que personne n'a
    annoncée, sinon un groupe importé sans nature devient indistinguable d'un
    groupe qualifié à la main ».

    Ce qui l'a renversé (FRE-145) : la LECTURE invente déjà. `training_tree._sortie`
    traduit `NULL → bi-set`, donc « le coach n'a rien dit » n'est lu par PERSONNE
    — la distinction qu'on croyait préserver était déjà perdue à l'affichage. Ce
    qui restait, en revanche, était bien réel : DEUX encodages de la même chose en
    base, ce que la migration `2026-08-29_group_kind_biset.sql` avait entrepris de
    supprimer, et 11 lignes de production dans ce cas.

    Deux lignes liées sont un bi-set ou un dropset — il n'y a pas de troisième
    cas. Écrire la nature est donc strictement plus honnête que de la deviner à
    chaque lecture.

    ⚠️ ET ÇA NE VAUT QUE POUR LA NATURE. `sets` et `rest` gardent la règle
    inverse — « on ne remplit pas un groupe vide » — parce qu'un groupe sans
    repos n'a réellement rien à dire. La spec voisine le tient."""
    lignes = [{"groupId": "g1"}, {"groupId": "g1"}]
    normaliser_groupes(lignes)
    assert [l["groupKind"] for l in lignes] == ["biset", "biset"]


def test_une_nature_ANNONCEE_gagne_toujours_sur_le_defaut():
    """Le défaut ne s'applique qu'à un groupe où personne n'a rien dit."""
    lignes = [{"groupId": "g1"}, {"groupId": "g1", "groupKind": "dropset"}]
    normaliser_groupes(lignes)
    assert [l["groupKind"] for l in lignes] == ["dropset", "dropset"]


def test_une_ligne_HORS_groupe_ne_recoit_aucune_nature():
    """⚠️ 14 600 lignes de production ne sont dans aucun groupe : leur en donner
    une inventerait un lien qui n'existe pas — et c'est précisément pourquoi la
    colonne ne peut pas être `NOT NULL`."""
    lignes = [{"name": "SQUAT"}, {"groupId": "", "name": "CURL"}]
    normaliser_groupes(lignes)
    assert [l["groupKind"] for l in lignes] == [None, None]


def test_la_nature_passe_par_valeur_ligne_comme_les_autres_vocabulaires():
    """⚠️ LE PIÈGE DE `repsUnit` : la colonne porte un CHECK, et `''` le viole.
    Sans cette traduction, une ligne sans nature ferait un 500 à l'insertion —
    un refus illisible sur le cas le plus banal qui soit."""
    assert valeur_ligne("groupKind", "") is None
    assert valeur_ligne("groupKind", "dropset") == "dropset"


def test_l_ecriture_en_MASSE_unifie_aussi_les_champs_de_groupe():
    """⚠️ PAS SEULEMENT LE PATCH. Un chargement de séances, une duplication, une
    génération : autant de portes où deux lignes liées peuvent arriver en
    désaccord sans que rien ne proteste."""
    lignes = [
        {"groupId": "g1", "groupKind": "biset", "sets": "3", "rest": "-1", "name": "CURL"},
        {"groupId": "g1", "groupKind": "biset", "sets": "", "rest": "120", "name": "TRICEPS"},
    ]
    normaliser_groupes(lignes)
    assert [l["sets"] for l in lignes] == ["3", "3"]
    assert [l["rest"] for l in lignes] == ["-1", "-1"]
    # Un bi-set garde SES deux mouvements.
    assert [l["name"] for l in lignes] == ["CURL", "TRICEPS"]


def test_un_DROPSET_unifie_aussi_son_exercice():
    lignes = [
        {"groupId": "g1", "groupKind": "dropset", "name": "BACK EXTENSION", "reps": "30"},
        {"groupId": "g1", "groupKind": "dropset", "name": "AUTRE CHOSE", "reps": "8"},
    ]
    normaliser_groupes(lignes)
    assert [l["name"] for l in lignes] == ["BACK EXTENSION", "BACK EXTENSION"]
    # ⚠️ LES REPS RESTENT PROPRES À CHAQUE DESCENTE : c'est tout l'intérêt d'un
    # dropset — 30 puis 8. Les unifier le viderait de son sens.
    assert [l["reps"] for l in lignes] == ["30", "8"]


def test_un_groupe_entierement_VIDE_ne_se_remplit_pas():
    """⚠️ ON UNIFIE, ON N'INVENTE PAS. Un groupe qui n'a rien à dire continue de
    ne rien dire — poser une valeur ferait apparaître une prescription que
    personne n'a écrite."""
    lignes = [{"groupId": "g1", "sets": ""}, {"groupId": "g1", "sets": ""}]
    normaliser_groupes(lignes)
    assert [l["sets"] for l in lignes] == ["", ""]


def test_deux_groupes_gardent_chacun_leurs_valeurs():
    lignes = [
        {"groupId": "g1", "sets": "3"}, {"groupId": "g1", "sets": ""},
        {"groupId": "g2", "sets": "5"}, {"groupId": "g2", "sets": ""},
    ]
    normaliser_groupes(lignes)
    assert [l["sets"] for l in lignes] == ["3", "3", "5", "5"]


def test_champs_de_groupe_depend_de_la_nature():
    assert champs_de_groupe("dropset") == ("sets", "rest", "name")
    assert champs_de_groupe("biset") == ("sets", "rest")
    # Sans nature annoncée, on retombe sur le bi-set — le nom ne se propage donc
    # JAMAIS par défaut. Un doute penche du côté qui ne détruit rien.
    assert champs_de_groupe(None) == ("sets", "rest")


def test_les_natures_d_ENCHAINEMENT_partagent_series_et_repos():
    """Un circuit est un bi-set à plus de membres : la mécanique tours/repos est
    la même (FRE-116)."""
    assert champs_de_groupe("circuit") == ("sets", "rest")


def test_un_groupe_CHRONOMETRE_partage_son_temps():
    """EMOM : les séries sont les tours, l'intervalle est commun, pas de repos.
    AMRAP : la durée est commune, et les tours sont le RÉSULTAT (FRE-116)."""
    assert champs_de_groupe("emom") == ("sets", "clusterMode")
    assert champs_de_groupe("amrap") == ("clusterMode", "toursRealises")


def test_l_ecriture_en_MASSE_retire_le_format_d_un_groupe_chronometre_SEULEMENT():
    """Une BASE ou un arbre chargé d'un coup passent par ici, pas par le PATCH : la
    règle doit y tenir aussi. Et un bi-set garde ses AMRAP de ligne.

    MUTATION QUI ROUGIT : effacer le format quelle que soit la nature."""
    lignes = [
        {"groupId": "g1", "groupKind": "amrap", "format": "AMRAP", "clusterMode": "300", "clusterRest": "20"},
        {"groupId": "g1", "groupKind": "amrap", "format": "AMRAP", "clusterMode": "180"},
        {"groupId": "g2", "groupKind": "biset", "format": "AMRAP", "clusterMode": "300"},
        {"groupId": "g2", "groupKind": "biset", "format": "AMRAP", "clusterMode": "180"},
    ]
    normaliser_groupes(lignes)
    assert [l["format"] for l in lignes] == [None, None, "AMRAP", "AMRAP"]
    assert [l.get("clusterRest") for l in lignes] == [None, None, None, None]
    assert [l["clusterMode"] for l in lignes] == ["300", "300", "300", "180"]


def test_un_lien_UNBROKEN_vers_rien_ne_se_garde():
    """« Sans lâcher jusqu'à la suivante » n'a pas de sens sur la dernière ligne
    d'un groupe, ni hors groupe (FRE-116). Un lien resté là serait invisible à
    l'écran, et ressusciterait au prochain liage.

    MUTATION QUI ROUGIT : garder `unbroken` tel qu'envoyé."""
    lignes = [
        {"groupId": "g1", "groupKind": "circuit", "unbroken": True},
        {"groupId": "g1", "groupKind": "circuit", "unbroken": True},
        {"groupId": "g1", "groupKind": "circuit", "unbroken": True},
        {"groupId": "", "unbroken": True},
    ]
    normaliser_groupes(lignes)
    assert [l["unbroken"] for l in lignes] == [True, True, False, False]
