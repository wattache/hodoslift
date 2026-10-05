"""Les contrats de la « forme du jour » (`daily_logs`).

`extra="forbid"` est volontaire : un champ non prévu est rejeté (422) plutôt
qu'écrit aveuglément en base. Le schéma ne déclare que ce qui a une colonne : les
métriques objectives (weight/sleep/water/calories), le bloc kiné et le cycle.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

#: Les phases du cycle — le vocabulaire du type Postgres `cycle_phase`, que seule
#: `daily_logs.cycle_phase` utilise.
CyclePhase = Literal["menstruation", "follicular", "ovulation", "luteal"]


#: Bornes du bloc kiné. Des garde-fous de VOLUME, pas des règles métier : le
#: contenu appartient au front tant que le questionnaire bouge, mais un objet
#: libre sans borne est une porte ouverte à un dépôt de n'importe quoi.
_KINE_MAX_CHAMPS = 30
_KINE_MAX_TEXTE = 2000


class DailyLogPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    weight: float | None = Field(default=None, ge=0, le=500)   # kg
    sleep: float | None = Field(default=None, ge=0, le=24)     # heures
    water: float | None = Field(default=None, ge=0, le=20)     # litres
    # Borne haute = garde-fou de saisie (faute de frappe), pas une limite physiologique.
    calories: float | None = Field(default=None, ge=0, le=20000)  # kcal

    # ⚠️ PLUS DE BLOC `kine` ICI (FRE-195). Le journal quotidien a porté le suivi
    # kiné en objet libre tant que le questionnaire se cherchait. Il ne se cherche
    # plus : une douleur a une zone, une intensité, un commentaire — et surtout
    # une IDENTITÉ, qui manquait. Elle vit dans `douleurs` / `douleur_logs`, avec
    # ses clés étrangères. Laisser le champ ici offrirait une seconde façon
    # d'écrire la même chose, que plus aucun écran ne lirait.

    # La phase du cycle (FRE-173) — un fait du jour, déclaré par l'athlète seule
    # (la route est `owner`). Une phase déclarée par erreur doit pouvoir
    # s'effacer : fournir `cycle: null` efface ; l'omettre n'y touche pas.
    cycle: CyclePhase | None = None

    @model_validator(mode="after")
    def _reject_empty(self) -> "DailyLogPatch":
        # ⚠️ `exclude_unset` et non `exclude_none` : `cycle: null` — le geste
        # « j'efface une phase déclarée par erreur » — n'a aucun champ non nul
        # mais N'EST PAS un patch vide. Avec `exclude_none`, il serait rejeté
        # en 422, et une phase fausse resterait sans moyen de partir.
        if not self.model_dump(exclude_unset=True):
            raise ValueError("patch vide : au moins un champ doit être fourni")
        return self


class JourneeLue(BaseModel):
    """Une journée du journal (`GET /athletes/{id}/daily-logs`) — FRE-70.

    ⚠️ TOUTES LES CLÉS SONT OMISES quand la valeur est nulle, elles ne sortent pas
    à `null` : la route les ajoute une par une (`if weight is not None`). D'où
    `response_model_exclude_unset=True` sur la route. Une mesure absente reste
    ABSENTE : ni `null`, ni zéro.

    La réponse elle-même est un DICTIONNAIRE indexé par date ISO, pas une liste :
    `dict[str, JourneeLue]`. Le front indexe par jour.

    Le suivi kiné n'y est plus (FRE-195) : il a son propre modèle, avec son
    identité et ses clés étrangères.
    """

    model_config = ConfigDict(extra="forbid")

    weight: float | None = None
    sleep: float | None = None
    water: float | None = None
    calories: float | None = None
    cycle: CyclePhase | None = None
