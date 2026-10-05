"""Les erreurs : une forme unique, un vocabulaire clos, un relevé (FRE-38, FRE-40).

Toute erreur sort sous la forme `{code, detail, status}` (`Erreur`), et `code`
appartient au vocabulaire CLOS `CODES`.

⚠️ Un `responses=` recopié à la main dérive à la première exception ajoutée. Ce
module RELÈVE, en lisant les sources, les codes atteignables par chaque route ;
`tests/test_contrat_erreurs.py` compare ce relevé aux déclarations, dans les deux sens.

⚠️ « Atteignable » est une fermeture transitive : le corps du gestionnaire, les
fonctions qu'il appelle, et ses DÉPENDANCES FastAPI (le 401, les 403 des gardes).
"""

from __future__ import annotations

import ast
import logging
import pathlib
import re
from functools import lru_cache
from typing import Annotated, Any, Literal

from fastapi import HTTPException, Path
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger(__name__)

# `app/`, pas `app/socle/` : le relevé lit TOUS les domaines.
_RACINE = pathlib.Path(__file__).resolve().parent.parent

# ⚠️ FastAPI ajoute LUI-MÊME un 422 aux routes qui valident un corps ou des
# paramètres : il est dans le schéma sans qu'on le déclare. Le relevé l'ignore —
# on ne documente que ce que le CODE lève.
CODE_VALIDATION_FASTAPI = 422


def _code_de(nœud: ast.expr | None) -> int | None:
    """Le code HTTP d'un argument, littéral (`404`) ou nommé (`status.HTTP_404_NOT_FOUND`)."""
    if isinstance(nœud, ast.Constant) and isinstance(nœud.value, int):
        return nœud.value
    if isinstance(nœud, ast.Attribute):
        m = re.search(r"HTTP_(\d{3})", nœud.attr)
        if m:
            return int(m.group(1))
    return None


class _Releve(ast.NodeVisitor):
    """Par fonction : les codes levés directement, et les noms appelés."""

    def __init__(self) -> None:
        self.codes: dict[str, set[int]] = {}
        self.appels: dict[str, set[str]] = {}
        self.alias: dict[str, str] = {}   # `_coach = _AthleteAccessDep(...)` → classe
        self._pile: list[str] = []

    # Les méthodes comptent autant que les fonctions : `__call__` porte
    # l'autorisation, et c'est une dépendance FastAPI à part entière.
    def visit_FunctionDef(self, n: ast.FunctionDef) -> None:  # noqa: N802
        # ⚠️ Une fonction IMBRIQUÉE est un chemin vers ses codes : les gardes
        # viennent de FABRIQUES (`_coach = require_program_access("coach")`) qui
        # définissent la dépendance réelle à l'intérieur. Sans cette arête, les
        # routes protégées ressortent sans 401 ni 403.
        if self._pile:
            self.appels.setdefault(self._pile[-1], set()).add(n.name)
        self._pile.append(n.name)
        self.codes.setdefault(n.name, set())
        self.appels.setdefault(n.name, set())
        # `Depends(x)` en signature mène aux codes de `x` comme un appel direct.
        for defaut in list(n.args.defaults) + list(n.args.kw_defaults):
            for sous in ast.walk(defaut) if defaut else []:
                if isinstance(sous, ast.Call) and getattr(sous.func, "id", "") == "Depends":
                    for arg in sous.args:
                        nom = getattr(arg, "id", getattr(arg, "attr", None))
                        if nom:
                            self.appels[n.name].add(nom)
        self.generic_visit(n)
        self._pile.pop()

    visit_AsyncFunctionDef = visit_FunctionDef  # type: ignore[assignment]

    # ⚠️ Deux formes de levée, et le statut n'y est pas au même RANG :
    # `HTTPException` le prend en premier, `ErreurMetier` prend d'abord son code
    # (FRE-40). Ne chercher qu'au rang 0 rendrait « atteignables : aucun » partout.
    _LEVEES = {"HTTPException", "ErreurMetier"}

    def visit_Raise(self, n: ast.Raise) -> None:  # noqa: N802
        if self._pile and isinstance(n.exc, ast.Call):
            nom = getattr(n.exc.func, "id", getattr(n.exc.func, "attr", ""))
            if nom in self._LEVEES:
                code = next((c for c in (_code_de(a) for a in n.exc.args) if c is not None), None)
                if code is None:
                    for kw in n.exc.keywords:
                        if kw.arg == "status_code":
                            code = _code_de(kw.value)
                if code is not None:
                    self.codes[self._pile[-1]].add(code)
        self.generic_visit(n)

    def visit_Call(self, n: ast.Call) -> None:  # noqa: N802
        if self._pile:
            nom = getattr(n.func, "id", getattr(n.func, "attr", None))
            if nom:
                self.appels[self._pile[-1]].add(nom)
        self.generic_visit(n)

    def visit_Assign(self, n: ast.Assign) -> None:  # noqa: N802
        # `_coach = _AthleteAccessDep("staff")` — la dépendance est l'INSTANCE,
        # le code vit dans le `__call__` de sa classe.
        if isinstance(n.value, ast.Call) and len(n.targets) == 1:
            cible = getattr(n.targets[0], "id", None)
            classe = getattr(n.value.func, "id", None)
            if cible and classe:
                self.alias[cible] = classe
        self.generic_visit(n)


@lru_cache(maxsize=1)
def _graphe() -> tuple[dict[str, set[int]], dict[str, set[str]], dict[str, str]]:
    codes: dict[str, set[int]] = {}
    appels: dict[str, set[str]] = {}
    alias: dict[str, str] = {}
    classes: dict[str, str] = {}   # classe → nom de son `__call__` désambiguïsé
    for f in sorted(_RACINE.rglob("*.py")):
        arbre = ast.parse(f.read_text(encoding="utf-8"))
        # Les `__call__` sont renommés `Classe.__call__` pour ne pas se confondre.
        for n in ast.walk(arbre):
            if isinstance(n, ast.ClassDef):
                for corps in n.body:
                    if isinstance(corps, ast.FunctionDef) and corps.name == "__call__":
                        corps.name = f"{n.name}.__call__"
                        classes[n.name] = corps.name
        r = _Releve()
        r.visit(arbre)
        for k, v in r.codes.items():
            codes.setdefault(k, set()).update(v)
        for k, v in r.appels.items():
            appels.setdefault(k, set()).update(v)
        alias.update(r.alias)
    # Un nom lié à un appel mène à ce qu'il produit : `__call__` si c'est une
    # classe instanciée, la fonction elle-même si c'est une fabrique.
    for instance, cible in alias.items():
        appels.setdefault(instance, set()).add(classes.get(cible, cible))
    # ⚠️ Instancier une classe mène à son `__call__`, où qu'on le fasse. Les gardes
    # s'empilent — `_coach` → `require_program_access` → `_ProgramAccessDep` → son
    # `__call__` — et sans ce dernier saut la chaîne s'arrête sur le nom de la
    # classe : les routes protégées ressortent sans 401 ni 403.
    for appelants in appels.values():
        for classe in [a for a in list(appelants) if a in classes]:
            appelants.add(classes[classe])
    return codes, appels, alias


def codes_atteignables(fonction: str, _vus: frozenset[str] = frozenset()) -> set[int]:
    """Tous les codes qu'un gestionnaire peut rendre, dépendances comprises.

    ⚠️ Le relevé est VOLONTAIREMENT LARGE : il suit tout appel dont le NOM est
    connu, que la branche soit atteignable en pratique ou non. Une sur-déclaration
    se voit à la lecture ; une sous-déclaration se découvre en production.
    """
    codes, appels, _ = _graphe()
    if fonction in _vus:
        return set()
    vus = _vus | {fonction}
    total = set(codes.get(fonction, ()))
    for appele in appels.get(fonction, ()):
        if appele in codes or appele in appels:
            total |= codes_atteignables(appele, vus)
    return total


# --------------------------------------------------------------------------- #
# CE QUI PART DANS L'OPENAPI
# --------------------------------------------------------------------------- #

# ⚠️ Des descriptions GÉNÉRIQUES par statut, à dessein : une phrase par route
# vieillirait sans que rien ne le signale. On documente ce qui est VÉRIFIABLE —
# quels statuts une route peut rendre ; le pourquoi, c'est le `code` (`CODES`).
_DESCRIPTIONS: dict[int, str] = {
    400: "Requête incohérente avec l'état visé.",
    401: "Jeton absent, expiré ou invalide.",
    403: "Authentifié, mais hors de son périmètre.",
    404: "La ressource n'existe pas. Un OBJET (ligne, séance, bilan, note) qui existe "
         "mais appartient à un autre programme ou à un autre athlète répond 404 lui "
         "aussi, pour ne pas révéler son existence. Un PROGRAMME ou une FICHE qui "
         "existe hors du périmètre de l'appelant répond 403.",
    409: "Conflit avec l'état existant (unicité, ou dépendance qui empêche).",
    413: "Fichier trop volumineux.",
    415: "Type de fichier refusé.",
    422: "Corps ou paramètre refusé par le contrat.",
    503: "Dépendance indisponible.",
}


def erreurs(*codes: int) -> dict[int | str, dict[str, str]]:
    """Le `responses=` d'une route, à partir des codes qu'elle peut rendre.

    ⚠️ La liste est ÉCRITE À LA MAIN sur chaque route, pas déduite à l'exécution :
    déduire ferait lire l'arborescence des sources au démarrage du service.
    `tests/test_contrat_erreurs.py` compare la liste écrite au relevé — aux tests,
    pas au démarrage du serveur.
    """
    inconnus = [c for c in codes if c not in _DESCRIPTIONS]
    if inconnus:
        raise ValueError(f"code(s) sans description : {inconnus}")
    # ⚠️ `model=Erreur` rend la chaîne complète : la forme part dans l'OpenAPI,
    # `openapi-typescript` en fait un type, et le front reçoit l'union EXHAUSTIVE
    # des codes. Un code inventé côté serveur ne compile plus côté front.
    return {c: {"description": _DESCRIPTIONS[c], "model": Erreur} for c in sorted(codes)}


# --------------------------------------------------------------------------- #
# LA FORME D'ERREUR UNIQUE (FRE-40) — RFC 9457, allégée
#
# Le front décide sur `code`, STABLE et lisible par machine, et affiche SA
# traduction (l'app tourne en trois langues). Le statut seul ne suffit pas :
# plusieurs 409 ne se distinguent que par leur code. `detail` est une aide au
# diagnostic, en français, jamais affichée.
#
# ⚠️ LE VOCABULAIRE EST CLOS (`Literal`) : il part dans l'OpenAPI,
# `openapi-typescript` en fait une union, et un `code` inventé côté serveur ne
# compile plus côté front.
#
# ⚠️ Un code qui n'est plus levé SORT de `CODES` : le front l'attendrait, et le
# serveur ne le dirait jamais — un contrat faux.
# --------------------------------------------------------------------------- #

CODES: dict[str, str] = {
    # — Authentification et périmètre —————————————————————————————
    # Le filet (`_Filet`, FRE-79) : ce qui ÉCHAPPE au code sort quand même sous
    # la forme unique, et sous CORS.
    "erreur_interne": "Le serveur a rencontré une erreur imprévue.",
    # Le routage, distingué du métier : « cette URL n'existe pas » n'est pas
    # « cet athlète n'existe pas ».
    "route_introuvable": "Cette adresse n'existe pas sur ce serveur.",
    "methode_non_autorisee": "Cette adresse existe, mais pas pour ce verbe HTTP.",
    "token_invalide": "Jeton absent, expiré ou illisible.",
    "email_non_verifie": "Le compte existe mais son adresse n'est pas vérifiée.",
    "reserve_aux_coachs": "Geste réservé aux coachs.",
    "reserve_aux_admins": "Geste réservé aux administrateurs.",
    # ⚠️ Sans porte dérobée pour le coach ni l'admin : composer un modèle de
    # bilan est un acte de praticien (bilan-kine.md §6).
    "reserve_aux_kines": "Geste réservé aux kinés.",
    # ⚠️ « Authentifié » n'est pas « membre » (FRE-78) : Firebase accepte tout
    # compte Google, un jeton valide ne prouve aucun lien avec le club.
    "reserve_aux_membres": "Ce compte n'a aucun lien avec l'application.",
    "athlete_hors_perimetre": "Cet athlète n'est pas suivi par l'appelant.",
    "programme_hors_perimetre": "Ce programme n'appartient pas à l'appelant.",
    "champs_reserves_au_staff": "L'athlète a tenté d'écrire des champs qui ne sont pas les siens.",
    "prescription_reservee_au_staff": "L'athlète a tenté d'écrire une prescription (FRE-52).",
    # — Ressources absentes ————————————————————————————————————
    "athlete_introuvable": "Aucune fiche athlète pour cet identifiant.",
    "programme_introuvable": "Aucun programme pour cet identifiant.",
    "utilisateur_introuvable": "Aucun compte pour cet identifiant.",
    # FRE-13 — une structure se crée par migration ; un slug inconnu est une
    # faute de l'appelant, pas une structure à inventer.
    "structure_inconnue": "Aucune structure ne porte ce nom.",
    "profil_introuvable": "Aucun profil coach pour ce slug ou cet uid.",
    "profil_requis_avant_photo": "Il faut créer son profil avant d'y déposer une photo.",
    "competition_introuvable": "Aucune compétition pour cet identifiant.",
    "evenement_introuvable": "Aucun événement pour cet identifiant.",
    "bilan_introuvable": "Aucun bilan kiné pour cet identifiant, chez cet athlète.",
    "douleur_introuvable": "Aucune douleur suivie pour cet identifiant, chez cet athlète.",
    "modele_introuvable": "Aucun modèle de bilan pour cet identifiant.",
    "note_introuvable": "Aucune note de suivi pour cet identifiant, chez cet athlète.",
    "rubrique_introuvable": "Aucune rubrique pour cet identifiant, dans ce modèle.",
    "test_introuvable": "Aucun test pour cet identifiant, dans ce modèle.",
    "resultat_introuvable": "Aucun résultat pour cet identifiant, dans ce bilan.",
    "entree_introuvable": "Aucune entrée de bibliothèque pour cet identifiant.",
    "record_introuvable": "Aucun record pour cet athlète et cet identifiant.",
    "seance_introuvable": "Aucune séance pour cet identifiant.",
    "signalement_introuvable": "Aucun signalement ce jour-là pour cet athlète.",
    "exercice_introuvable": "Aucune ligne d'exercice pour cet identifiant.",
    "objet_arbre_introuvable": "Macro, bloc ou semaine absent du programme visé.",
    "identifiant_pris": "L'identifiant fourni à la création désigne déjà un objet, ailleurs.",
    "objectif_introuvable": "Aucun objectif technique pour cet identifiant, chez cet athlète.",
    # — Conflits avec l'état existant ———————————————————————————
    # ⚠️ Nommé LARGE (FRE-24) : quatre tables retiennent un coach, pas seulement
    # les athlètes. Un seul code, parce que la suite est la même — réattribuer —
    # et que le `detail` énumère ce qui retient.
    "coach_encore_reference": "Rétrogradation refusée : ce coach est encore référencé "
                              "(athlètes, programmes, compétitions ou bibliothèque).",
    "kine_a_des_athletes": "Rétrogradation refusée : ce kiné suit encore des athlètes.",
    "douleur_deja_suivie": "Une douleur est déjà suivie sur cette zone, et elle n'est pas close.",
    # Bilan kiné. `bilan_deja_finalise` couvre trois refus — écrire un résultat,
    # rouvrir, supprimer — parce que c'est UNE règle : un bilan finalisé est une
    # mesure datée qui ne bouge plus. Une correction se fait par un nouveau bilan.
    "bilan_deja_finalise": "Ce bilan est finalisé : il ne se modifie plus, ni ne se supprime.",
    "bilan_incomplet": "Un bilan ne se finalise que complet : il reste des tests à renseigner.",
    # ⚠️ Levé depuis une violation de CLÉ ÉTRANGÈRE vers `library_entries`, pas
    # depuis une liste de noms en Python (FRE-122) : c'est la base qui refuse,
    # `_mouvement_inconnu` traduit.
    "mouvement_inconnu": "Ce mouvement n'existe pas dans la bibliothèque.",
    "test_non_bilateral": "Ce test n'a qu'un seul résultat : une mesure droite n'a pas de sens.",
    "test_sans_mesure": "Ce test ne se mesure pas : seul le ressenti est attendu.",
    "modele_vide": "Ce modèle ne contient aucun test : un bilan vide ne mesure rien.",
    # ⚠️ Trois refus qui disent « archive plutôt que supprimer ». La base
    # survivrait (SET NULL, CASCADE), mais les résultats déjà enregistrés ne
    # seraient plus rattachables, donc plus comparables — en silence.
    "modele_utilise": "Des bilans utilisent ce modèle : l'archiver plutôt que le supprimer.",
    "rubrique_non_vide": "Cette rubrique porte encore des tests : les retirer d'abord.",
    "test_utilise": "Des résultats portent ce test : le retirer plutôt que le supprimer.",
    # ⚠️ Après liaison, l'email n'est plus un contact, c'est une IDENTITÉ
    # (FRE-131). Sans compte, l'adresse est une note du coach, qu'il corrige.
    # Une fois `user_uid` posé, elle décide QUI est propriétaire de la fiche,
    # donc qui lit les bilans kiné : la laisser modifiable ouvrirait au coach un
    # accès d'owner par un second compte. `users.email` fait foi.
    "email_fige_par_le_compte": (
        "Cette fiche est rattachée à un compte : son adresse vient de ce compte "
        "et ne se change plus ici."
    ),
    "slug_deja_pris": "Un autre profil coach porte déjà ce slug.",
    "slug_immuable": "Le slug d'un profil ne se change pas après création.",
    "entree_deja_existante": "Une entrée (catégorie, nom) identique existe déjà.",
    "dernier_bloc": "Un macrocycle garde au moins un bloc.",
    "semaine_deja_remplie": (
        "La semaine porte déjà des séances : son contenu ne se remplace pas. "
        "Pour la régénérer, il faut la supprimer explicitement."
    ),
    # ⚠️ Une trame sans dates fabrique du réalisé qui n'entre dans AUCUNE courbe
    # (FRE-138). La date de S1 est la source de toutes les autres : la génération
    # date les semaines depuis elle, et le suivi projette sur
    # `coalesce(session_date, week.start_date)`.
    # ⚠️ Les DEUX dates sont exigées : la fin donne la LONGUEUR appliquée à toutes
    # les semaines du bloc. Sans elle, le front retombe sur « début + 6 jours ».
    "base_sans_dates": (
        "La trame n'a pas ses dates de semaine 1 : les semaines générées seraient "
        "sans date, et le suivi ne pourrait pas les situer. Poser le début ET la "
        "fin de S1 dans la BASE, puis générer ou ajouter la semaine."
    ),
    # ⚠️ La destruction NON EXPRIMÉE, et elle seule (FRE-85). Retirer un
    # participant emporte ses essais : l'appelant l'exprime en l'omettant de
    # `participants`. Retirer un MOUVEMENT n'exprime rien sur les essais des
    # participants qu'on garde — d'où le refus.
    "essais_perdus": (
        "Cette écriture ferait disparaître des essais saisis sur un mouvement "
        "retiré. Retirer aussi ces essais des participants pour l'assumer."
    ),
    # — Règles métier refusées ——————————————————————————————————
    "slug_requis": "La création d'un profil exige un slug.",
    "pas_un_kine": "L'utilisateur visé n'est pas déclaré kiné.",
    "identifiant_invalide": "L'identifiant de chemin n'a pas la forme attendue.",
    "pas_un_lift_de_competition": "Le mouvement n'est pas marqué comme lift de compétition.",
    "jour_hors_competition": "Le jour visé n'appartient pas à la plage de la compétition.",
    "categorie_exige_le_genre": "Une catégorie de poids ne se pose pas sans le genre.",
    "categorie_invalide": "Cette catégorie n'existe pas pour ce genre.",
    "motif_exige_un_echec": "Un motif de non-validation exige un essai manqué.",
    # On ne baisse pas (FRE-204) : une annonce est au moins la charge de l'essai
    # précédent du même mouvement.
    "annonce_en_baisse": "Une annonce ne peut pas être plus légère qu'un essai précédent.",
    # Une catégorie passe dans UN flight (FRE-204) : dans deux, l'athlète n'aurait
    # pas de place dans l'ordre de passage.
    "categorie_dans_deux_flights": "Une catégorie de poids ne passe que dans un flight.",
    "flight_en_double": "Deux flights d'une même compétition portent le même nom.",
    "fin_avant_debut": "La date de fin précède la date de début.",
    "date_invalide": "Date absente, mal formée, ou hors des bornes admises.",
    "date_future": "le poids de départ ne se pose pas dans le futur",
    "intervalle_inverse": "La borne de début est postérieure à celle de fin.",
    "competition_hors_exercices": "Le marqueur « compétition » ne vaut que pour un exercice.",
    "reordonnancement_incoherent": "La liste fournie ne correspond pas au contenu à réordonner.",
    # Déplacer une ligne d'une séance à l'autre reste DANS la semaine (FRE-188) :
    # une semaine est l'unité de programmation, et la suivante se recopie de
    # la précédente — une ligne qui changerait de semaine y serait copiée deux fois.
    "seance_d_une_autre_semaine": "La séance cible n'est pas dans la même semaine que la ligne.",
    # ⚠️ Le conflit est VISIBLE au lieu d'être silencieux (FRE-134).
    # `PUT /athletes/{id}/goals` remplace la liste ENTIÈRE, et coach comme athlète
    # y écrivent (`owner_or_staff`) : sans version, le premier à avoir chargé la
    # page efface l'ajout de l'autre.
    "objectifs_perimes": "La liste d'objectifs a changé depuis sa lecture : recharger avant d'enregistrer.",
    # ⚠️ Même garde sur la compétition (FRE-162) : le PATCH d'un plateau renvoie
    # la liste ENTIÈRE des participants et de leurs essais. Le conflit est rendu
    # visible ; la saisie concurrente n'est pas ouverte.
    "competition_perimee": "La compétition a changé depuis sa lecture : recharger avant d'enregistrer.",
    "coach_inconnu": "Le coach visé n'existe pas en base.",
    # FRE-13 — la fiche ne change pas de structure ; le coach doit être de la sienne.
    "coach_d_une_autre_structure": "Ce coach n'est pas de la structure de l'athlète.",
    # — Fichiers ————————————————————————————————————————————
    "photo_trop_lourde": "La photo dépasse la taille maximale.",
    "media_trop_lourd": "Image trop lourde pour la médiathèque du bilan.",
    "media_format_refuse": "Format d'image refusé : PNG ou JPEG attendus.",
    "photo_pas_png": "Un fichier PNG est attendu.",
    # — Infrastructure ——————————————————————————————————————
    "base_injoignable": "La base de données ne répond pas.",
    # — Le filet ————————————————————————————————————————————
    # ⚠️ La validation de Pydantic a son code à elle, distinct des 422 MÉTIER :
    # c'est la FORME du corps qui ne colle pas, pas une règle du domaine. Les
    # confondre ferait afficher « date invalide » pour un champ mal orthographié.
    "corps_invalide": "Le corps ou un paramètre ne respecte pas le contrat.",
}


CodeErreur = Literal[tuple(CODES)]  # type: ignore[valid-type]


class Erreur(BaseModel):
    """La forme UNIQUE de toute erreur — succès mis à part, rien d'autre ne sort.

    Inspirée de la RFC 9457 (*Problem Details*) : un `code` pour décider, un
    `detail` pour diagnostiquer, un `status` pour le transport.

    ⚠️ `detail` est TOUJOURS une chaîne. Les erreurs de validation gardent leur
    structure, mais dans `champs`, à côté.

    ⚠️ `detail` n'est PAS destiné à l'utilisateur : c'est une aide au diagnostic,
    en français, à recopier dans un signalement. L'utilisateur lit la traduction
    que le front choisit à partir de `code`.
    """

    model_config = ConfigDict(extra="forbid")

    code: CodeErreur
    detail: str
    status: int
    # Présent uniquement sur `corps_invalide` : quel champ, et pourquoi.
    champs: list[dict[str, Any]] | None = Field(default=None)


class ErreurMetier(HTTPException):
    """Une exception qui porte son code.

    ⚠️ SOUS-CLASSE de `HTTPException`, pas remplacement : un `HTTPException` nu
    reste valide et reçoit un code déduit de son statut (`_CODE_PAR_DEFAUT`).
    Aucune erreur ne sort sans code.

    Raises:
        ValueError: `code` n'appartient pas à `CODES`.
    """

    def __init__(self, code: str, status_code: int, detail: str) -> None:
        if code not in CODES:
            raise ValueError(f"code d'erreur inconnu : {code!r}")
        super().__init__(status_code=status_code, detail=detail)
        self.code = code


# À défaut de code explicite, celui que le statut permet d'affirmer sans risque.
_CODE_PAR_DEFAUT: dict[int, str] = {
    401: "token_invalide",
    403: "athlete_hors_perimetre",
    404: "athlete_introuvable",
    422: "corps_invalide",
    503: "base_injoignable",
}


def corps_erreur(exc: HTTPException) -> dict[str, Any]:
    """La réponse d'une exception, code compris.

    ⚠️ `detail` est APLATI en chaîne, quoi qu'il arrive : FastAPI y met parfois
    une structure, et le front ne lit qu'une forme.
    """
    code = getattr(exc, "code", None) or _CODE_PAR_DEFAUT.get(exc.status_code, "corps_invalide")
    detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    return {"code": code, "detail": detail, "status": exc.status_code}


def installer(app) -> None:
    """Pose la forme unique sur TOUTES les sorties d'erreur.

    ⚠️ QUATRE sorties, et l'oubli d'une seule rouvre la brèche :

    * `HTTPException` — ce que le code lève explicitement ;
    * `RequestValidationError` — la validation d'ENTRÉE de Pydantic, qui ne passe
      pas par `HTTPException` et sortirait avec un `detail` en TABLEAU. Sa
      structure passe dans `champs` ;
    * `StarletteHTTPException` — les 404 de routage et les 405, levés par le
      framework avant tout gestionnaire ;
    * LE FILET (FRE-79), un middleware : sans lui, une exception imprévue sort en
      500 texte brut SANS en-tête CORS, et le navigateur y voit une coupure
      réseau. Un `exception_handler(Exception)` seul ne suffit PAS : voir `_Filet`.

    ⚠️ `installer` s'appelle AVANT `add_middleware(CORSMiddleware)` dans
    `main.py` : c'est l'ordre d'empilement qui place le filet SOUS CORS.

    ⚠️ Le ROUTAGE est séparé du métier : par `_CODE_PAR_DEFAUT`, une URL inconnue
    répondrait `athlete_introuvable` et un 405 `corps_invalide` — deux codes qui
    MENTENT. Starlette choisit le gestionnaire par la classe la plus spécifique :
    `HTTPException` de FastAPI d'un côté, celle de Starlette de l'autre.
    """
    from fastapi.exceptions import RequestValidationError
    from fastapi.responses import JSONResponse
    from starlette.exceptions import HTTPException as StarletteHTTPException

    def _json(corps: dict[str, Any]) -> JSONResponse:
        return JSONResponse(status_code=corps["status"], content=corps)

    @app.exception_handler(HTTPException)
    async def _http(_requete, exc):  # noqa: ANN001
        return _json(corps_erreur(exc))

    # Le ROUTAGE : ni le chemin ni le verbe n'ont trouvé de route. Aucun code
    # métier ne s'applique — l'appelant s'est trompé d'adresse, pas d'objet.
    _ROUTAGE = {404: "route_introuvable", 405: "methode_non_autorisee"}

    @app.exception_handler(StarletteHTTPException)
    async def _routage(_requete, exc):  # noqa: ANN001
        code = _ROUTAGE.get(exc.status_code)
        if code is None:
            return _json(corps_erreur(exc))
        detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        return _json({"code": code, "detail": detail, "status": exc.status_code})

    def _mouvement_inconnu(exc: Exception) -> JSONResponse | None:
        """Traduit en 422 `mouvement_inconnu` un nom d'exercice hors bibliothèque.

        ⚠️ C'est une faute de SAISIE, pas un incident (FRE-123) : les colonnes qui
        portent un mouvement référencent `library_entries`, et la base refuse un
        nom inventé. Sans cette traduction, c'est un 500 et une alerte Sentry.

        ⚠️ Posé ICI et non dans chaque route : plusieurs chemins d'écriture
        heurtent ces contraintes, et un `except` oublié repartirait en 500. La
        contrainte est UNE en base ; sa traduction est UNE ici.

        Reconnu par le NOM de la contrainte, fixé par la migration
        (`*_mouvement_fkey`) : le message de Postgres est localisable.
        """
        cause = getattr(exc, "orig", exc)
        texte = str(cause)
        if "_mouvement_fkey" not in texte:
            return None
        logger.info("mouvement hors bibliothèque refusé par la base")
        return _json({
            "code": "mouvement_inconnu",
            "detail": "ce mouvement n'existe pas dans la bibliothèque",
            "status": 422,
        })

    def _reponse_imprevue(exc: Exception) -> JSONResponse:
        """La réponse 500 `erreur_interne`, APRÈS avoir signalé l'exception.

        ⚠️ Un filet attrape-tout MARQUE l'exception comme traitée : sans envoi
        explicite, Sentry ne la verrait plus — un 500 muet à la place d'un 500
        bruyant.

        `logger.exception` garde la trace même sans Sentry (tests, dev local, e2e) ;
        `capture_exception` est appelé sans condition : le SDK ne fait rien s'il
        n'est pas initialisé.
        """
        connue = _mouvement_inconnu(exc)
        if connue is not None:
            return connue
        logger.exception("erreur imprévue : %s", exc)
        try:
            import sentry_sdk

            sentry_sdk.capture_exception(exc)
        except ImportError:  # pragma: no cover — le paquet est une dépendance
            pass
        # ⚠️ LE DÉTAIL NE SORT PAS : un message d'exception porte parfois le
        # contenu d'une requête — un poids, une note du kiné, un fragment de SQL.
        # La trace complète reste dans les logs.
        return _json({"code": "erreur_interne",
                      "detail": "erreur interne du serveur",
                      "status": 500})

    # ⚠️ LE FILET EST UN MIDDLEWARE, pas un `exception_handler(Exception)` (FRE-79).
    # Starlette exécute ce gestionnaire-là dans son `ServerErrorMiddleware`, la
    # couche la plus EXTERNE : sa réponse ne traverse jamais `CORSMiddleware`, et
    # le navigateur refuse de la lire. Le test envoie un `Origin` et exige
    # l'en-tête en retour.
    #
    # `add_middleware` empile vers l'EXTÉRIEUR : appelé ici, avant que `main.py` ne
    # pose CORS, ce filet est la couche la plus INTERNE — sa réponse remonte à
    # travers CORS. Le gestionnaire `Exception` plus bas ne sert qu'à ce qui
    # exploserait dans un middleware lui-même.
    class _Filet:
        def __init__(self, asgi) -> None:  # noqa: ANN001
            self.asgi = asgi

        async def __call__(self, scope, receive, send):  # noqa: ANN001
            if scope["type"] != "http":
                await self.asgi(scope, receive, send)
                return
            commence = False

            async def _send(message):  # noqa: ANN001
                nonlocal commence
                if message["type"] == "http.response.start":
                    commence = True
                await send(message)

            try:
                await self.asgi(scope, receive, _send)
            except Exception as exc:
                # Une réponse déjà entamée ne se remplace pas : on laisse la
                # couche externe clore la connexion, comme Starlette le ferait.
                if commence:
                    raise
                await _reponse_imprevue(exc)(scope, receive, send)

    app.add_middleware(_Filet)

    @app.exception_handler(Exception)
    async def _imprevu(_requete, exc: Exception):  # noqa: ANN001
        return _reponse_imprevue(exc)

    @app.exception_handler(RequestValidationError)
    async def _validation(_requete, exc: RequestValidationError):  # noqa: ANN001
        champs = [
            {"champ": ".".join(str(p) for p in e.get("loc", ())[1:]) or "corps",
             "motif": e.get("msg", "")}
            for e in exc.errors()
        ]
        # Un texte que le coach peut recopier dans un signalement, là où le
        # tableau brut de Pydantic ne veut rien dire pour personne.
        resume = " · ".join(f"{c['champ']} : {c['motif']}" for c in champs) or "corps invalide"
        # ⚠️ Un échec de CHEMIN a son propre code (FRE-39) : « cette URL ne peut
        # désigner personne » n'est pas « ce que tu envoies ne convient pas ».
        chemin = any(e.get("loc", ("",))[0] == "path" for e in exc.errors())
        return _json({"code": "identifiant_invalide" if chemin else "corps_invalide",
                      "detail": resume, "status": 422, "champs": champs})


# --------------------------------------------------------------------------- #
# LES IDENTIFIANTS DE CHEMIN (FRE-39)
# --------------------------------------------------------------------------- #

# ⚠️ La contrainte vit dans la SIGNATURE, pas dans le corps : une vérification
# appelée en tête de gestionnaire S'OUBLIE sur une route neuve, et reste
# INVISIBLE dans l'OpenAPI (un `string` libre là où seul ce motif passe).
# L'échec sort en 422 `identifiant_invalide`, posé par `_validation` quand il
# vient du CHEMIN.
#
# Ce motif ne couvre que les identifiants hérités de Firestore ; les uuid ont
# `MOTIF_UUID`.
MOTIF_IDENTIFIANT = r"^[A-Za-z0-9_-]{1,128}$"

IdentifiantDeChemin = Annotated[str, Path(pattern=MOTIF_IDENTIFIANT)]

# ⚠️ Un uuid ne se valide PAS par son cast SQL (FRE-79) : `abc` passe
# `MOTIF_IDENTIFIANT`, puis `CAST('abc' AS uuid)` lève une `DataError` — un 500
# là où un 422 `identifiant_invalide` est dû. Le format vit donc dans la
# signature, et l'OpenAPI l'annonce.
MOTIF_UUID = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"

UuidDeChemin = Annotated[str, Path(pattern=MOTIF_UUID)]
