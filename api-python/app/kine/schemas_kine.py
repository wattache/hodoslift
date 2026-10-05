"""Ce que `GET /kines` rend — le répertoire qui nourrit le sélecteur du coach.

⚠️ Un `response_model` FILTRE la sortie : un champ absent d'ici disparaîtrait de
la réponse sans erreur. `test_le_repertoire_des_kines_porte_TOUS_ses_champs` fige
l'ensemble des clés, écrit avant ce modèle.
"""

from pydantic import BaseModel, ConfigDict


class KineLu(BaseModel):
    """Un kiné déclaré. Le strict nécessaire pour le choisir dans une liste —
    aucun lien vers ses athlètes suivis, qui ne regardent pas le coach."""

    model_config = ConfigDict(extra="forbid")

    uid: str
    displayName: str
    email: str
