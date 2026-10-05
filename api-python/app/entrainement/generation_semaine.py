"""La génération d'une semaine depuis la BASE — un calcul pur, sans base de données.

Une BASE décrit une semaine type : quels mouvements tombent quel jour (la
grille), sous quelle prescription (les principes), plus le renforcement (les
accessoires). Générer, c'est dérouler cette grille en séances.

⚠️ UNE SEULE IMPLÉMENTATION, aperçu compris : `/base/preview-week` appelle
`generer_semaine` sans rien écrire, `generate-week` l'appelle puis insère. Le
front ne recalcule rien, donc l'aperçu dit ce que la génération écrira.
"""

from __future__ import annotations

import re
from typing import Any

from app.entrainement.prescription import CHAMPS_COPIES, NATURE_PAR_DEFAUT

# ⚠️ LA GRILLE EST UN CYCLE — J1 … Jn — : rien n'impose sept jours, même si les
# coachs en configurent sept. Le jour est une ÉTIQUETTE : aucun code ne dérive
# une date d'un jour de cycle — la SEMAINE est l'objet de programmation le plus
# fin, et le suivi agrège à la semaine.
#
# ⚠️ LE RANG SE LIT COMME UN NOMBRE, PAS COMME UNE CHAÎNE : « J10 » vient après
# « J9 », alors qu'un tri de texte le mettrait entre « J1 » et « J2 ».
_JOUR_DE_CYCLE = re.compile(r"^J([0-9]+)$")

#: Après tous les autres — la place qu'avait déjà un jour hors de la liste.
_APRES_TOUT = 10**6


def rang_de_cycle(jour: Any) -> int:
    """Le numéro d'un jour de cycle (« J7 » → 7) ; le reste passe en dernier."""
    trouve = _JOUR_DE_CYCLE.match(jour.strip()) if isinstance(jour, str) else None
    return int(trouve.group(1)) if trouve else _APRES_TOUT

# L'ordre CANONIQUE des mouvements principaux — le repli quand le coach n'a
# jamais configuré sa sélection.
MOUVEMENTS_PRINCIPAUX = ["MUSCLE UP", "PULL UP", "CHIN UP", "DIPS", "SQUAT"]

# ⚠️ DÉRIVÉ du vocabulaire partagé, pas recopié (FRE-45) : voir `prescription.py`,
# `incrementRef` compris.
_PRESCRIPTION = CHAMPS_COPIES


def _ligne(source: dict[str, Any], tier: int | None) -> dict[str, Any]:
    """Rend une ligne de séance neuve, copiée d'une ligne de BASE.

    ⚠️ `list(...)` sur les variantes : sans copie, la semaine générée partagerait
    le tableau de la BASE, et éditer l'une modifierait l'autre (FRE-33)."""
    ligne = {champ: source.get(champ) for champ in _PRESCRIPTION}
    ligne["variant"] = list(source.get("variant") or [])
    ligne["tier"] = tier
    # ⚠️ Ces dictionnaires servent DEUX contrats : insérés en base ET rendus tels
    # quels par l'aperçu. `groupId` y reste une chaîne ; `groupKind` dit l'absence
    # par `None` (FRE-137), comme le contrat de lecture l'annonce.
    ligne["groupId"] = ""
    # La NATURE suit le lien, jamais seule : elle se pose plus bas, avec le
    # `groupId` refabriqué. Une ligne sortie sans groupe n'en a pas.
    ligne["groupKind"] = None
    # Le lien UNBROKEN suit le groupe comme la nature : posé plus bas, seulement
    # si la ligne a une suivante dans son groupe refabriqué (FRE-116).
    ligne["unbroken"] = False
    return ligne


#: Les jours de la semaine, dans l'ordre d'un cycle de sept jours : J1 = lundi.
JOURS_DE_LA_SEMAINE = ("Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche")


def nom_du_jour(jour: dict, nb_jours: int) -> str:
    """Le nom d'un jour du cycle — celui que porte la séance générée.

    Le libellé posé par le coach d'abord. Sinon, sur un cycle de SEPT jours, le
    jour de la semaine (J1 = lundi) : c'est le cas de toutes les trames, et le
    geste « nommer comme la semaine » était oublié presque partout. Sur tout
    autre cycle, `J<n>` — nommer J8 « lundi » n'aurait aucun sens.

    ⚠️ UNE CHAÎNE D'ESPACES N'EST PAS UN NOM : une case ouverte puis refermée
    laisse `''` dans la trame. ⚠️ LA MÊME RÈGLE QUE `nomDuJour` (eitri,
    `lib/constants.ts`), qui l'affiche avant la génération."""
    propre = (jour.get("label") or "").strip()
    if propre:
        return propre
    trouve = re.fullmatch(r"J(\d+)", (jour.get("day") or "").strip())
    if nb_jours == len(JOURS_DE_LA_SEMAINE) and trouve and 1 <= int(trouve.group(1)) <= 7:
        return JOURS_DE_LA_SEMAINE[int(trouve.group(1)) - 1]
    return jour["day"]

def generer_semaine(
    base: dict[str, Any],
    *,
    week_number: int = 1,
    graine_id: str = "gen",
) -> dict[str, Any]:
    """Déroule la BASE en séances. Ne touche à rien : rend une structure.

    `graine_id` sert à fabriquer les identifiants de groupe des bi-sets. En
    persistance il vaut l'id de la semaine créée ; en aperçu, une constante.
    """
    grille = base.get("daySplit") or []
    principes = base.get("principles") or []
    accessoires = base.get("accessories") or []

    ordonnee = sorted(grille, key=lambda j: rang_de_cycle(j.get("day")))

    # ⚠️ L'ORDRE EST CELUI DES MOUVEMENTS, PAS DES TIERS (FRE-29). Une séance se
    # lit muscle up → traction → dips → squat, quelles que soient les variations ;
    # le tier ne départage que deux lignes d'un MÊME mouvement.
    #
    # ⚠️ LE REPLI SUR L'ORDRE CANONIQUE : `selectedPrincipaux` peut être NULL. Sans
    # repli, chaque rang vaudrait « après tout le monde » et l'ordre retomberait
    # sur celui d'AJOUT des principes — alors que l'éditeur affiche l'ordre
    # canonique. Le coach verrait une chose et en générerait une autre.
    #
    # ⚠️ `[]` N'EST PAS `None` ICI : une liste vide est un geste délibéré (le coach
    # a retiré les mouvements un par un) et garde son sens ; seul `None` déclenche
    # le repli. D'où `is None`, et NON un test de véracité : `[]` est falsy, donc
    # `selection if selection else …` replierait la liste vide comme `None`.
    selection = base.get("selectedPrincipaux")
    ordre_mouvements = MOUVEMENTS_PRINCIPAUX if selection is None else selection

    def rang_mouvement(mouvement: str) -> int:
        try:
            return ordre_mouvements.index(mouvement)
        except ValueError:
            return 10**6  # hors référentiel (DEV COUCHE…) → après

    def rang_principe(mouvement: str, tier: int) -> int:
        for i, p in enumerate(principes):
            if p.get("name") == mouvement and p.get("tier") == tier:
                return i
        return 10**6

    seances: list[dict[str, Any]] = []
    for jour in ordonnee:
        lignes: list[dict[str, Any]] = []
        # index dans la séance générée → identifiant de groupe DANS LA BASE
        liens: dict[int, str] = {}
        # identifiant de groupe DANS LA BASE → sa nature (FRE-36)
        natures: dict[str, str | None] = {}
        # index dans la séance générée → lien unbroken de l'accessoire source
        liens_unbroken: dict[int, bool] = {}

        tiers_du_jour = sorted(
            (
                (mouvement, tier)
                for mouvement, tier in (jour.get("tiers") or {}).items()
                if tier in (1, 2, 3)
            ),
            key=lambda e: (rang_mouvement(e[0]), e[1], rang_principe(e[0], e[1])),
        )

        for mouvement, tier in tiers_du_jour:
            for p in principes:
                if p.get("name") == mouvement and p.get("tier") == tier:
                    lignes.append(_ligne(p, tier))

        # Les accessoires APRÈS les principes : la séance s'enchaîne principal →
        # renfo, qui est l'ordre naturel.
        for a in accessoires:
            if a.get("day") != jour.get("day") or not a.get("name"):
                continue
            gid = (a.get("groupId") or "").strip()
            if gid:
                liens[len(lignes)] = gid
                natures.setdefault(gid, (a.get("groupKind") or "").strip() or None)
                liens_unbroken[len(lignes)] = a.get("unbroken") is True
            lignes.append(_ligne(a, None))

        if not lignes:
            continue

        # ⚠️ UN IDENTIFIANT DE GROUPE REFABRIQUÉ, jamais celui de la BASE : le
        # sien est local à elle, et deux semaines générées porteraient alors le
        # même. La forme reprend celle de l'app pour que les bi-sets générés
        # soient indistinguables de ceux liés à la main.
        #
        # ⚠️ UN GROUPE RESTÉ SEUL N'EN REÇOIT AUCUN (FRE-31). Un accessoire supprimé
        # de la BASE laisse son partenaire avec un `groupId` qui ne relie rien : on
        # ne recrée pas les orphelins que `nettoyerGroupesSeuls` (front) nettoie,
        # invisibles à l'écran puisque l'affichage exige deux membres.
        par_groupe: dict[str, list[int]] = {}
        for index, gid in liens.items():
            par_groupe.setdefault(gid, []).append(index)
        for gid, indices in par_groupe.items():
            if len(indices) < 2:
                continue
            # ⚠️ LA NATURE DANS LE PRÉFIXE, et ce n'est pas cosmétique : ces
            # identifiants se lisent dans la base et dans les journaux, et un
            # dropset nommé `biset-…` mentirait à qui l'inspecte.
            nature = natures.get(gid) or NATURE_PAR_DEFAUT
            nouveau = f"{nature}-{graine_id}-{jour['day']}-{min(indices)}-{max(indices)}"
            for index in indices:
                lignes[index]["groupId"] = nouveau
                # La BASE porte la nature du groupe ; la semaine générée doit la
                # porter aussi, sinon toute régénération rebasculerait un dropset
                # en bi-set sans que personne ne l'ait demandé.
                lignes[index]["groupKind"] = nature
                # Pas de lien sur la dernière ligne : elle n'a pas de suivante.
                lignes[index]["unbroken"] = liens_unbroken.get(index, False) and index != max(indices)

        # ⚠️ LE LIBELLÉ NOMME LA SÉANCE, `day` L'IDENTIFIE (FRE-187). `day` rattache
        # les accessoires par égalité de chaîne, donne le rang du cycle et entre
        # dans l'identifiant des groupes engendrés ci-dessus : il ne se remplace
        # pas. Un jour sans libellé donne son `J<n>`, qui est un nom suffisant.
        #
        # ⚠️ UNE CHAÎNE D'ESPACES N'EST PAS UN NOM. Une case ouverte puis refermée
        # sans rien écrire laisse un `''` dans la trame, et une séance sans nom
        # n'est plus désignable à l'écran — la semaine suivante se recopie par ce
        # nom (`semaine_suivante.py`).
        seances.append({"name": nom_du_jour(jour, len(grille)),
                        "sessionDate": "", "exercises": lignes})

    return {
        "weekNumber": week_number,
        "name": "",
        "hidden": False,
        "startDate": base.get("s1StartDate") or "",
        "endDate": base.get("s1EndDate") or "",
        "sessions": seances,
    }
