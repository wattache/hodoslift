"""La sonde des bornes servies sait-elle dire NON ? (FRE-154)

`scripts/verifier_bornes_servies.py` ne tourne que contre la production, depuis
`make verifier`. Sa seule logique — comparer ce que `/health/db` rend à
`BORNES_DU_ROLE` — est éprouvée ici, hors réseau, sur les trois façons de mentir
qu'une réponse peut avoir : une valeur fausse, une valeur absente, et un serveur
d'avant la sonde qui ne rend pas le champ du tout.
"""

from app.socle.db import BORNES_DU_ROLE
from scripts.verifier_bornes_servies import ecarts


def test_des_bornes_conformes_ne_donnent_aucun_ecart():
    assert ecarts(dict(BORNES_DU_ROLE)) == []


def test_une_valeur_fausse_est_un_ecart():
    servies = dict(BORNES_DU_ROLE, statement_timeout="0")
    assert ecarts(servies) == ["statement_timeout : attendu '15s', reçu '0'"]


def test_une_borne_absente_est_un_ecart():
    servies = dict(BORNES_DU_ROLE)
    del servies["TimeZone"]
    assert ecarts(servies) == ["TimeZone : attendu 'Europe/Paris', reçu None"]


def test_un_serveur_sans_le_champ_bornes_est_un_ecart_par_borne():
    """⚠️ UN BROKKR D'AVANT LA SONDE NE PASSE PAS POUR BON. Une réponse sans
    `bornes` — `None`, ou le champ absent — vaut « rien reçu » sur chaque
    borne, pas « rien à redire »."""
    assert len(ecarts(None)) == len(BORNES_DU_ROLE)
    assert len(ecarts({})) == len(BORNES_DU_ROLE)


def test_la_sonde_est_derivee_de_BORNES_DU_ROLE():
    """Une borne ajoutée à `app/socle/db.py` est attendue ici sans qu'on y touche :
    la liste n'est pas recopiée, c'est le défaut que FRE-154 ferme partout."""
    servies = dict(BORNES_DU_ROLE)
    servies["une_borne_de_plus"] = "x"  # servie en plus : pas un écart
    assert ecarts(servies) == []
