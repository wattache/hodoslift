"""Les contrats du BILAN — spec dans `docs/bilan-kine.md`.

Deux familles, qui ne se mélangent pas : le MODÈLE, composé par la kiné (modèles,
rubriques, tests), et l'INSTANCE, passée par un athlète (bilan, résultats).

⚠️ `response_model` filtre et valide À L'EXÉCUTION : un champ non déclaré
disparaît en silence, un type qui ne colle pas rend 500. Chaque modèle de lecture
énumère l'ensemble EXACT des clés que sa route produit (FRE-70).
⚠️ Règle des DÉFAUTS : clé toujours envoyée → pas de défaut ; parfois omise →
`default_factory` ; envoyée mais nullable → `X | None` sans défaut. Un défaut
déclare que le champ peut manquer, et `openapi-typescript` rend la clé optionnelle.
"""

# ⚠️ ALIASÉS : un champ nommé `date` dans un corps de classe ÉCRASE le type
# importé. `date: date | None = None` assigne `date = None` PUIS évalue
# l'annotation, qui devient `None | None` et lève au chargement du module.
from datetime import date as Date, datetime as DateTime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.kine.schemas_bilan_media import MediaDuTest

Statut = Literal["en_cours", "finalise"]
Ressenti = Literal["ras", "douleur", "gene"]
# `aucune` = rien à saisir, le ressenti seul. Une valeur explicite plutôt qu'un
# `None` : chaque lecteur interpréterait le vide à sa façon.
Mesure = Literal["aucune", "reps", "secondes"]
Vue = Literal["face", "profil", "dos"]


# ══════════════════════════════════════════════════════════════════════════
# LE MODÈLE — composé par la kiné
# ══════════════════════════════════════════════════════════════════════════

class TestLu(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    libelle: str
    protocole: str | None
    mesure: Mesure
    # ⚠️ Dit s'il y a DEUX RÉSULTATS, pas si le geste a un côté (§3.5).
    bilateral: bool
    chargeKg: float | None
    materiel: str | None
    vues: list[Vue]
    cible: str | None
    ordre: int
    # Retiré = absent des FUTURS bilans. Rendu quand même à la kiné, qui doit
    # pouvoir le voir et le réactiver.
    retire: bool

    # --- Les images de démonstration (FRE-99) -------------------------------
    # ⚠️ Une liste ORDONNÉE : un mouvement se montre en deux ou trois photos —
    # départ, passage, arrivée — et l'ordre fait partie de la consigne.
    medias: list[MediaDuTest]


class RubriqueLue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    libelle: str
    ordre: int
    tests: list[TestLu]


class ModeleResume(BaseModel):
    """Une ligne du catalogue — sans son contenu."""

    model_config = ConfigDict(extra="forbid")

    id: str
    nom: str
    description: str | None
    archive: bool
    # Ce que l'écran affiche sans ouvrir. Compte les tests VIFS, pas les retirés.
    nbTests: int


class ModeleLu(ModeleResume):
    model_config = ConfigDict(extra="forbid")

    rubriques: list[RubriqueLue]


class ModeleCree(BaseModel):
    """Un modèle à créer, vide ou par duplication.

    ⚠️ `dupliquerDe` est la voie NORMALE (§6) : un bilan spécialisé naît du bilan
    complet, puis on élague. La page blanche sert aux bilans courts, sans parenté.
    """

    model_config = ConfigDict(extra="forbid")

    nom: str = Field(min_length=1, max_length=120)
    description: str | None = None
    dupliquerDe: str | None = None


class ModelePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nom: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    archive: bool | None = None


class RubriqueCree(BaseModel):
    model_config = ConfigDict(extra="forbid")

    libelle: str = Field(min_length=1, max_length=120)


class RubriquePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    libelle: str | None = Field(default=None, min_length=1, max_length=120)
    ordre: int | None = None


class TestCree(BaseModel):
    model_config = ConfigDict(extra="forbid")

    libelle: str = Field(min_length=1, max_length=200)
    protocole: str | None = None
    mesure: Mesure = "aucune"
    bilateral: bool = False
    chargeKg: float | None = None
    materiel: str | None = None
    vues: list[Vue] = Field(default_factory=list)
    cible: str | None = None


class TestPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    libelle: str | None = Field(default=None, min_length=1, max_length=200)
    protocole: str | None = None
    mesure: Mesure | None = None
    bilateral: bool | None = None
    chargeKg: float | None = None
    materiel: str | None = None
    vues: list[Vue] | None = None
    cible: str | None = None
    ordre: int | None = None
    retire: bool | None = None
    # ⚠️ La liste ENTIÈRE, pas un delta : ajouter, retirer, réordonner tiennent
    # dans une seule liste, reposée telle quelle — idempotent.
    #
    # ⚠️ « ABSENT » n'est pas « VIDE » : `[]` détache tout, ne pas envoyer le
    # champ ne touche à rien. Sinon un PATCH du seul libellé effacerait les images.
    #
    # Les images sont désignées par leur IDENTITÉ, jamais par un chemin fourni
    # par le client — qui pourrait viser n'importe quel objet du seau.
    mediaIds: list[str] | None = None


# ══════════════════════════════════════════════════════════════════════════
# L'INSTANCE — passée par un athlète
# ══════════════════════════════════════════════════════════════════════════

class ResultatLu(BaseModel):
    """Un résultat AVEC son instantané — c'est ce qui le rend lisible seul.

    ⚠️ `testLibelle`, `mesure`, `bilateral` sont FIGÉS à la création du bilan
    (§3.1). Ils ne viennent pas du modèle courant : sans ça, une retouche de la
    kiné réécrirait le sens des bilans déjà passés. `chargeKg` est COPIÉE du
    modèle à la création, puis reste écrivable (`ResultatEcrit`) : elle dit la
    charge réellement utilisée.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    # L'identité stable du test, pour comparer d'un bilan à l'autre. `None` si le
    # test a été supprimé du modèle : le résultat reste lisible, il cesse
    # seulement d'être comparé.
    testId: str | None
    testLibelle: str
    rubriqueLibelle: str | None
    # ⚠️ Les CONSIGNES font partie de l'instantané. L'athlète n'a pas accès au
    # catalogue des modèles (réservé à la kiné) : sans elles ici, aucun chemin ne
    # les lui apporte. Et un résultat obtenu sous une consigne garde CETTE consigne.
    protocole: str | None
    vues: list[Vue]
    cible: str | None
    mesure: Mesure
    bilateral: bool
    ordre: int | None

    ressenti: Ressenti | None
    detail: str | None
    # ⚠️ NULL ≠ 0, jusqu'ici. `None` = test non réalisé ; `0` = réalisé, échec
    # complet. Ne JAMAIS replier l'un sur l'autre en sérialisant.
    mesureGauche: float | None
    mesureDroite: float | None
    chargeKg: float | None
    materiel: str | None

    # --- Les images de démonstration, figées elles aussi (FRE-99) -----------
    # ⚠️ Elles appartiennent à l'INSTANTANÉ, pas au modèle courant. Une image est
    # une consigne : la relire en direct montrerait l'illustration d'aujourd'hui
    # à côté du protocole d'hier.
    medias: list[MediaDuTest]


class ResultatEcrit(BaseModel):
    """Ce que la saisie modifie d'un résultat.

    Tous les champs sont optionnels : le remplissage est progressif et
    enregistre à chaque frappe.

    ⚠️ L'INSTANTANÉ n'en fait pas partie. `testLibelle`, `mesure`, `bilateral`
    sont posés à la création du bilan et ne se réécrivent jamais (§3.1). Seule
    la charge l'est : elle décrit ce qui a été FAIT, pas ce qui a été demandé.
    """

    model_config = ConfigDict(extra="forbid")

    ressenti: Ressenti | None = None
    detail: str | None = None
    mesureGauche: float | None = None
    mesureDroite: float | None = None
    chargeKg: float | None = None


class BilanResume(BaseModel):
    """Une ligne de la liste — sans les résultats, ni les antécédents.

    ⚠️ Les ANTÉCÉDENTS n'y sont pas, volontairement : l'historique médical
    transiterait à chaque ouverture d'écran, pour n'être lu qu'en ouvrant un
    bilan. Le périmètre médical se garde étroit jusque dans les charges utiles.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    date: Date
    statut: Statut
    kineUid: str | None
    # Recopié à la création : le modèle peut être renommé ou supprimé, le bilan
    # reste intelligible.
    modeleNom: str
    # Ce que l'écran affiche sans ouvrir : « N tests sur M ».
    testsRenseignes: int
    testsTotal: int


class BilanLu(BilanResume):
    model_config = ConfigDict(extra="forbid")

    antecedents: str | None
    notes: str | None
    resultats: list[ResultatLu]
    creeLe: DateTime
    modifieLe: DateTime


class BilanCree(BaseModel):
    model_config = ConfigDict(extra="forbid")

    modeleId: str
    # ⚠️ PAS de défaut sur la date : « aujourd'hui » est une décision du client,
    # qui seul connaît son fuseau. Le serveur qui la devine se trompe d'un jour
    # pour un athlète qui saisit le soir depuis un autre fuseau.
    date: Date
    # Repris du bilan précédent par le serveur si absent (§3.7) — l'athlète corrige.
    antecedents: str | None = None


class BilanPatch(BaseModel):
    """La méta d'un bilan à modifier.

    `exclude_unset` côté route : seul ce qui est envoyé est écrit, donc `None`
    signifie « vider », pas « ne pas toucher ».
    """

    model_config = ConfigDict(extra="forbid")

    date: Date | None = None
    antecedents: str | None = None
    notes: str | None = None
    statut: Statut | None = None


class ModelesDisponibles(BaseModel):
    """Les modèles proposables à la création d'un bilan.

    ⚠️ `modeles` sans défaut : la clé est toujours envoyée (cf. l'en-tête).
    """

    model_config = ConfigDict(extra="forbid")

    modeles: list[ModeleResume]
