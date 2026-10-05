"""Le BARÈME porté côté serveur donne-t-il EXACTEMENT le même nombre ? (FRE-92)

Ce fichier ne garde plus que la FORMULE. Le total qu'elle prend en entrée est
agrégé par la vue `competition_scores`, et ses règles — quatre places, pull up
et chin up en concurrence — sont éprouvées dans `test_vue_ris.py`, là où elles
vivent désormais.

⚠️ CE QUE CES SPECS PROTÈGENT : une formule TRANSCRITE. Dix constantes
barémiques recopiées d'un fichier TypeScript vers un fichier Python — une
virgule déplacée passe la revue, passe les types, et fausse un classement
d'athlètes pendant des mois sans que rien ne rougisse.

Les valeurs attendues ci-dessous ne sont pas calculées de tête : elles sont
SORTIES DE L'IMPLÉMENTATION DU FRONT, exécutée sur ces entrées exactes, puis
figées ici. C'est la seule façon de prouver un port — pas de le relire.

Le jour où le barème change, ces nombres changent aussi, et il faudra les
regénérer depuis la source qui fait foi. C'est voulu : un test qu'on met à jour
sans y penser ne garde rien.
"""

import pytest

from app.competitions.scoring import compute_ris

# (total, poids, genre) → RIS rendu par `eitri/src/lib/ris-score.ts`, à 10 décimales.
_REFERENCE = [
    (345, 82, "M", 67.7783037104),
    (167.5, 60, "F", 67.7940224691),
    (119, 62, "F", 47.2903444225),
    (500, 110, "M", 91.4133195965),
    (200, 55, "M", 53.6078633389),
    (180, 95, "F", 66.7247676881),
    # Le poids PIVOT de la courbe (V) : c'est là qu'une erreur de signe sur B se
    # cacherait le mieux, puisque l'exponentielle y vaut exactement 1.
    (345, 74.777, "M", 72.5061021506),
    (1, 40, "F", 0.5439201999),
]


@pytest.mark.parametrize("total,poids,genre,attendu", _REFERENCE)
def test_le_RIS_donne_le_MÊME_nombre_que_le_front(total, poids, genre, attendu):
    calcule = compute_ris(total, poids, genre)
    assert calcule is not None
    # 1e-9 : on compare une transcription, pas une approximation. Un écart au-delà
    # du bruit flottant signifie qu'une constante a bougé.
    assert calcule == pytest.approx(attendu, abs=1e-9), f"{calcule!r} ≠ {attendu!r}"


@pytest.mark.parametrize("total,poids,genre", [
    (0, 80, "M"),       # rien soulevé
    (345, 0, "M"),      # poids absent
    (345, None, "M"),
    (345, 82, None),    # genre absent
    (345, 82, "X"),     # genre inconnu
    (None, 82, "M"),
    (345, -5, "M"),     # poids absurde
])
def test_une_entrée_MANQUANTE_rend_None_et_jamais_zéro(total, poids, genre):
    """⚠️ `None` ET PAS `0.0`. Un RIS de zéro est un athlète qui n'a rien
    soulevé ; une entrée manquante est un athlète qu'on ne sait pas classer. Les
    confondre le ferait apparaître DERNIER d'un classement auquel il ne
    participe même pas."""
    assert compute_ris(total, poids, genre) is None
