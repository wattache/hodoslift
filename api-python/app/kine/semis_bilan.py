"""Le CONTENU du modèle « Bilan complet », à semer. Spec : `docs/bilan-kine.md`.

⚠️ C'est un SEMIS, pas un référentiel. Les tests sont de la DONNÉE
(`bilan_modeles` / `bilan_rubriques` / `bilan_tests`), que la kiné compose dans
l'application. Aucune route ne lit ce module : il sert UNE fois, à
`scripts/semer_modele_bilan.py`. En Python plutôt qu'en SQL parce que des
protocoles multilignes s'y relisent.

⚠️ Après le semis, la vérité est EN BASE : modifier ce fichier ne change rien à
ce que voit la kiné, et re-semer écraserait son travail — le script refuse de
semer deux fois.
"""

from dataclasses import dataclass
from typing import Literal

# Ce qu'on saisit comme résultat. `None` = aucune mesure, le ressenti seul : les
# tests de mobilité, et ceux dont le protocole fixe lui-même la durée.
Mesure = Literal["reps", "secondes"]

# L'angle de la vidéo. Il fait partie du protocole AFFICHÉ : sans lui, l'athlète
# ne sait pas comment se filmer, et une vidéo mal cadrée ne se compare pas.
Vue = Literal["face", "profil", "dos"]

Famille = Literal["general", "mobilite", "activation"]


# ⚠️ `Epreuve` et non `Test` : pytest collecte toute classe dont le nom commence
# par « Test ». Le vocabulaire du domaine reste « test » partout ailleurs.
@dataclass(frozen=True, slots=True)
class Epreuve:
    code: str
    libelle: str
    protocole: str
    famille: Famille
    mesure: Mesure | None = None
    # ⚠️ `bilateral` dit s'il y a DEUX RÉSULTATS, pas si le geste a un côté. Les
    # tests de TRONC (érecteur du rachis, transverse) n'en ont qu'un (§3.3) : les
    # dire bilatéraux remplirait `mesure_droite` au hasard.
    bilateral: bool = False
    # Charge PRESCRITE. Pré-remplit le résultat, qui reste modifiable : la salle
    # n'a pas toujours le disque du protocole, et deux bilans ne se comparent que
    # si le code ET la charge coïncident.
    charge_kg: float | None = None
    # Ce avec quoi la charge est produite ; `None` pour de la fonte nue. Sans ce
    # champ, 25 kg d'élastique et 25 kg de kettlebell seraient le même nombre.
    materiel: str | None = None
    vues: tuple[Vue, ...] = ()
    # Cible affichée pour les tests de maintien, quand la kiné en a posé une.
    cible: str | None = None


_TESTS: tuple[Epreuve, ...] = (
    # --- Généraux ------------------------------------------------------------
    Epreuve("squat_overhead", "Squat overhead",
         "20 squats, bras tendus tenant un bâton",
         "general", vues=("face", "profil", "dos")),
    Epreuve("lunge_overhead", "Lunge overhead",
         "20 fentes par jambe, posture contrôlée en overhead, bâton",
         "general", vues=("face", "profil", "dos")),

    # --- Mobilité — aucune mesure, le ressenti seul ---------------------------
    Epreuve("cervicale_rotation", "Cervicale — rotation",
         "3 rotations droites, 3 gauches", "mobilite", vues=("face",)),
    Epreuve("cervicale_inclinaison", "Cervicale — inclinaison",
         "3 inclinaisons droites, 3 gauches", "mobilite", vues=("face",)),
    Epreuve("cervicale_flex_ext", "Cervicale — flexion/extension",
         "3 flexions (regard bas), 3 extensions (regard haut)",
         "mobilite", vues=("profil",)),
    Epreuve("epaule_flexion", "Épaule — flexion",
         "Debout, expirer tout l'air, lever les bras au-dessus de la tête sans cambrer",
         "mobilite", vues=("profil",)),
    Epreuve("epaule_extension", "Épaule — extension",
         "Allongé, front au sol, bras le long du corps, lever le bâton dans le dos",
         "mobilite", vues=("profil",)),
    Epreuve("epaule_rotations", "Épaule — rotation externe/interne",
         "Allongé, épaule à 90°, tourner l'avant-bras haut et bas",
         "mobilite", vues=("profil",)),
    Epreuve("coude_pron_sup", "Coude — pronation/supination",
         "Debout, bâton en main, coude à 90°, tourner l'avant-bras intérieur/extérieur",
         "mobilite", vues=("face",)),
    Epreuve("coude_flexion_3pos", "Coude — flexion pronation/neutre/supination",
         "Bras collé au corps : 1 supination, 2 neutre, 3 pronation",
         "mobilite", vues=("profil",)),
    Epreuve("poignet_flex_ext", "Poignet — flexion/extension",
         "Avant-bras plaqué sur la table, main fermée vers le haut puis le bas",
         "mobilite", vues=("profil",)),
    Epreuve("thoracique_flex_ext", "Thoracique — flexion/extension",
         "Flexion : à 4 pattes, arrondir le dos. Extension : assis, mains aux "
         "épaules opposées, sternum au plafond",
         "mobilite", vues=("profil",)),
    Epreuve("thoracique_rotation", "Thoracique — rotation",
         "Assis, mains croisées sur les épaules, tourner sans bouger les hanches",
         "mobilite", vues=("face",)),
    Epreuve("hanche_rotations", "Hanche — rotation interne/externe",
         "RI : assis, objet entre les genoux, lever le pied vers l'extérieur sans "
         "lever le bassin. RE : pied opposé sur le côté, lever le pied vers l'intérieur",
         "mobilite", vues=("face",)),
    Epreuve("genou_flexion", "Genou — flexion",
         "Sur le ventre, talon aux fesses sans lever les hanches",
         "mobilite", vues=("face",)),
    Epreuve("genou_rotation_interne", "Genou — rotation interne",
         "Assis, pointe de pied relevée pour bloquer la cheville, tourner le tibia "
         "vers l'intérieur",
         "mobilite", vues=("face",)),
    Epreuve("cheville_flexion_dorsale", "Cheville — flexion dorsale",
         "Pied à 10 cm du mur, avancer le genou jusqu'au mur sans lever le talon",
         "mobilite", vues=("profil",)),

    # --- Activation musculaire ------------------------------------------------
    Epreuve("rotateur_externe_epaule", "Rotateur externe d'épaule",
         "Assis, bras à 90°, coude à 90° sur une box ; pivoter l'avant-bras vers "
         "le haut. Max reps",
         "activation", mesure="reps", bilateral=True, charge_kg=5, vues=("face",)),
    Epreuve("rotateur_interne_epaule", "Rotateur interne d'épaule",
         "Allongé, bras à 90°, coude à 90° ; pivoter l'avant-bras vers le haut "
         "sans bouger l'épaule. Max reps",
         "activation", mesure="reps", bilateral=True, charge_kg=10, vues=("profil",)),
    # Pas de mesure : le protocole fixe lui-même la durée d'isométrie, il ne
    # reste que le ressenti.
    Epreuve("grand_pectoral", "Grand pectoral",
         "Allongé perpendiculaire à l'élastique ; isométrie 10 s, coude tendu, "
         "vers 1 le nombril, 2 le mamelon opposé, 3 l'épaule opposée, 4 l'œil opposé",
         "activation", charge_kg=25, materiel="élastique", vues=("profil",)),
    Epreuve("grand_dorsal", "Grand dorsal",
         "Allongé, élastique fixé derrière ; ramener le bras en isométrie 20 s "
         "vers le nombril",
         "activation", charge_kg=20, materiel="élastique", vues=("profil",)),
    Epreuve("trapeze_superieur", "Trapèze supérieur",
         "Debout, coude tendu, KTB en main ; lever l'épaule au plafond sans plier "
         "le coude. Max reps",
         "activation", mesure="reps", bilateral=True, charge_kg=30,
         materiel="kettlebell", vues=("face",)),
    Epreuve("trapeze_inferieur", "Trapèze inférieur",
         "Allongé, front au sol, bras en Y pouce au ciel ; lever les bras en "
         "engageant les omoplates. Max reps",
         "activation", mesure="reps", bilateral=True, charge_kg=1.5, vues=("profil",)),
    Epreuve("dentele_anterieur", "Dentelé antérieur",
         "Allongé sur le dos, kettlebell en main, bras tendu ; pousser en "
         "décollant l'épaule, coude tendu. Max reps",
         "activation", mesure="reps", bilateral=True, charge_kg=30,
         materiel="kettlebell", vues=("profil",)),
    Epreuve("grip", "Grip",
         "Tenir un disque du bout des doigts, isométrie jusqu'à l'échec",
         "activation", mesure="secondes", bilateral=True, charge_kg=15,
         materiel="disque", vues=("profil",)),
    Epreuve("obliques", "Obliques",
         "GHD, hanche au bord du coussin, pieds fixés sur le côté ; inclinaison "
         "latérale jusqu'au buste parallèle au sol. Max reps",
         "activation", mesure="reps", bilateral=True, charge_kg=15,
         materiel="GHD", vues=("profil",)),
    # ⚠️ NON BILATÉRAL — test de tronc, cf. §3.3.
    Epreuve("erecteur_rachis", "Érecteur du rachis",
         "GHD, hanches légèrement en dehors du coussin ; pencher le torse puis "
         "remonter en contractant les lombaires. Maintien",
         "activation", mesure="secondes", charge_kg=40, materiel="GHD",
         vues=("profil",), cible="60 s"),
    # ⚠️ NON BILATÉRAL — test de tronc, cf. §3.3.
    Epreuve("transverse_grands_droits", "Transverse / grands droits",
         "Allongé sur le dos, bras derrière la tête, jambes levées ; écraser le "
         "sol avec le dos. Maintien",
         "activation", mesure="secondes", vues=("profil",), cible="30 s"),
    Epreuve("moyen_fessier", "Moyen fessier",
         "Sur le côté, appui avant-bras et côté du pied ; hanches en ligne, lever "
         "le pied à l'horizontale. Maintien",
         "activation", mesure="secondes", bilateral=True, vues=("profil",), cible="30 s"),
    Epreuve("petit_fessier", "Petit fessier",
         "Assis, une jambe en rotation externe devant, l'autre en rotation interne "
         "derrière ; lever le talon arrière au plafond, genou au sol. Max reps",
         "activation", mesure="reps", bilateral=True, vues=("face",)),
    Epreuve("quadriceps", "Quadriceps",
         "Dos au mur, genoux à 90°, KTB ; maintenir en tendant une jambe, puis l'autre",
         "activation", mesure="secondes", bilateral=True, charge_kg=20,
         materiel="kettlebell", vues=("profil",), cible="20 s"),
    Epreuve("triceps_sural", "Triceps sural",
         "Debout sur une jambe, genou légèrement fléchi, KTB dans la main opposée ; "
         "monter sur la pointe en contrôlant",
         "activation", mesure="reps", bilateral=True, charge_kg=30,
         materiel="kettlebell", vues=("dos",)),
)

#: Les tests dans l'ORDRE du protocole — celui dans lequel la kiné les fait
#: passer, et celui que le semis inscrit dans `bilan_tests.ordre`.
TESTS: tuple[Epreuve, ...] = _TESTS

#: Le nom du modèle semé, et les libellés de ses rubriques. Les `famille` du
#: dataclass deviennent des lignes de `bilan_rubriques` — une fois semées, la
#: kiné peut les renommer, les réordonner, en ajouter.
MODELE_NOM = "Bilan complet"
MODELE_DESCRIPTION = (
    "Le bilan initial : tests généraux, mobilité articulaire et activation "
    "musculaire. Point de départ à dupliquer pour composer un bilan plus court."
)
RUBRIQUES: tuple[tuple[Famille, str], ...] = (
    ("general", "Tests généraux"),
    ("mobilite", "Tests de mobilité"),
    ("activation", "Tests d'activation musculaire"),
)
