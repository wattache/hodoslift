"""La semaine suivante : la dernière semaine du bloc, copiée pour faire la prochaine.

Le réalisé est vidé, les incréments appliqués, les charges effacées là où rien
ne les fait progresser. Calcul PUR : il rend une structure, et n'écrit rien.

Le calcul vit ici et non au front : toutes ses entrées sont en base (la semaine
précédente et son réalisé, la trame, la granularité du bloc).

⚠️ Il n'y a PAS d'unité `%`, et le module ne lit aucun 1RM : voir
`resoudre_increment`.
"""

from __future__ import annotations

import copy
from datetime import date, timedelta
from typing import Any

# Le plus petit pas de charge, en kg. 1,25 partout, 2,5 au squat.
GRANULARITE_DEFAUT = 1.25
GRANULARITE_PAR_MOUVEMENT = {"SQUAT": 2.5}


def _nombre(valeur: Any) -> float | None:
    """Lit un nombre écrit par un coach : « 47,5 » comme « 47.5 ».

    `None` si ce n'en est pas un — « PDC » est une charge légitime.
    """
    try:
        return float(str(valeur or "").strip().replace(",", "."))
    except ValueError:
        return None


def _entier(valeur: Any) -> int | None:
    n = _nombre(valeur)
    return None if n is None else int(n)


def granularite(mouvement: str, configuree: dict[str, str] | None) -> float:
    """Rend le pas de charge, en kg.

    Le réglage du coach sur la BASE d'abord, puis le pas propre au mouvement,
    puis le défaut.
    """
    cle = (mouvement or "").upper()
    reglage = _nombre((configuree or {}).get(cle))
    if reglage is not None and reglage > 0:
        return reglage
    return GRANULARITE_PAR_MOUVEMENT.get(cle, GRANULARITE_DEFAUT)


def _arrondir_au_pas(valeur: float, pas: float) -> float:
    """Arrondit au pas, ⚠️ VERS LE HAUT : « 2 kg au pas de 1,25 » donne 2,5.

    Au plus proche, un incrément pourrait valoir zéro, et la progression
    s'arrêterait en silence.
    """
    if pas <= 0:
        return valeur
    return round(-(-valeur // pas) * pas, 2)


def resoudre_increment(ligne: dict[str, Any],
                       pas: float | None = None) -> float | None:
    """Rend l'incrément de charge en KILOS, arrondi au pas. `None` si ce n'est pas un nombre.

    ⚠️ Pas d'unité `%`, et ce n'est pas un oubli. Un pourcentage porterait sur un
    1RM lu AU MOMENT de la génération : le même « +5 % » donnerait une charge
    différente selon le jour du clic, sans trace du 1RM qui a servi. Seul le coach
    sait sur quel 1RM il raisonne (du jour, du début de bloc, de l'objectif) ; il
    écrit donc des kilos.
    """
    brut = str(ligne.get("increment") or "").strip()
    if not brut:
        return None
    n = _nombre(brut)
    if n is None:
        return None
    return _arrondir_au_pas(n, pas) if pas else n


def _cle_variantes(valeur: Any) -> str:
    """Rend une clé de comparaison des variantes, indifférente à l'ordre et à la casse.

    ⚠️ Une CLÉ, pas une égalité de listes (FRE-33) : « Strict + Lesté » et
    « Lesté + Strict » désignent la même ligne.
    """
    return "|".join(sorted(v.upper() for v in (valeur or []) if v))


def _meme_ligne(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return (
        a.get("name") == b.get("name")
        and _cle_variantes(a.get("variant")) == _cle_variantes(b.get("variant"))
        and a.get("format") == b.get("format")
        and a.get("tempo") == b.get("tempo")
        and a.get("sets") == b.get("sets")
        and a.get("reps") == b.get("reps")
    )


def _ligne_de_la_base(ligne: dict[str, Any], base: dict[str, Any]) -> dict[str, Any] | None:
    """Rend la ligne de TRAME dont cette ligne de semaine descend, ou `None`.

    ⚠️ `_meme_ligne` compare `sets` et `reps` — limite assumée : avec les unités
    `sets` et `reps`, la ligne s'éloigne de la trame dès la première progression
    et l'appariement se perd. Elle retombe alors sur ses propres valeurs.
    """
    for ligne_de_base in (base.get("principles") or []) + (base.get("accessories") or []):
        if _meme_ligne(ligne_de_base, ligne):
            return ligne_de_base
    return None


def _rpe_de_la_base(ligne: dict[str, Any], base: dict[str, Any]) -> str:
    for principe in base.get("principles") or []:
        if _meme_ligne(principe, ligne) and principe.get("aimedRPE"):
            return principe["aimedRPE"]
    for accessoire in base.get("accessories") or []:
        if _meme_ligne(accessoire, ligne) and accessoire.get("aimedRPE"):
            return accessoire["aimedRPE"]
    return ""


def _rpe_herite(semaines: list[dict], index_seance: int, nom_seance: str,
                index_ligne: int, ligne: dict[str, Any], base: dict[str, Any]) -> str:
    """Rend le RPE cible que la ligne portait la dernière fois, en remontant le bloc.

    ⚠️ Par INDEX puis par NOM, et les deux comptent : une séance renommée se
    retrouve par sa position, une séance déplacée par son nom. À défaut, la BASE
    tranche — elle porte l'intention d'origine.
    """
    for semaine in semaines:
        seances = semaine.get("sessions") or []
        candidates = []
        if index_seance < len(seances):
            candidates.append(seances[index_seance])
        candidates += [s for s in seances if s.get("name") == nom_seance]
        for seance in candidates:
            lignes = seance.get("exercises") or []
            if index_ligne < len(lignes) and lignes[index_ligne].get("aimedRPE"):
                return lignes[index_ligne]["aimedRPE"]
            for precedente in lignes:
                if precedente.get("name") == ligne.get("name") and precedente.get("aimedRPE"):
                    return precedente["aimedRPE"]
    return _rpe_de_la_base(ligne, base)


# Ce qui appartient à la semaine DÉJÀ ENTRAÎNÉE et ne se copie jamais.
#
# ⚠️ `None`, pas `''` (FRE-137) : comme l'aperçu de la génération, la structure
# dit EXACTEMENT ce qui sera écrit, et l'écriture pose `NULL` (`valeur_ligne`).
_REALISE = {
    "repsDone": None, "weightDone": None, "restActual": None,
    "feltRPE": None, "athleteFeedback": None, "toursRealises": None,
}


def _series_tenues(ligne: dict[str, Any]) -> int | None:
    """Rend le nombre de séries réellement tenues, ou `None` si on l'ignore.

    ⚠️ Seulement quand le détail couvre TOUTES les séries prescrites. Un tableau à
    moitié rempli décrit une SAISIE incomplète, pas un entraînement écourté : s'en
    servir retirerait une série à l'athlète pour un oubli de case. Le repère
    « 2/4 » de l'écran (FRE-156) traite ce cas ; ici on s'abstient.

    Un FAIL ne compte pas (FRE-110), et se lit position par position — pas « tout
    ce qui précède le premier échec ».
    """
    prescrites = _entier(ligne.get("sets"))
    par_serie = [str(v or "").strip() for v in (ligne.get("feltRPEBySet") or [])]
    if prescrites is None or len(par_serie) < prescrites:
        return None
    if any(not v for v in par_serie[:prescrites]):
        return None
    return sum(1 for v in par_serie[:prescrites] if v.upper() != "FAIL")


def semaine_suivante(bloc: dict[str, Any]) -> dict[str, Any]:
    """Rend la semaine qui suit la dernière du bloc. N'écrit rien, ne modifie pas `bloc`."""
    base = bloc.get("base") or {}
    semaines = bloc.get("weeks") or []
    numero = len(semaines) + 1

    # ⚠️ La semaine 1 d'un bloc VIDE prend les dates de S1 de la BASE (FRE-138) :
    # sinon « + Semaine » fabrique une S1 sans date sur chaque bloc neuf.
    if not semaines:
        return {"weekNumber": numero, "name": None, "hidden": False,
                "startDate": base.get("s1StartDate") or None,
                "endDate": base.get("s1EndDate") or None,
                "sessions": [{"name": "Séance 1", "sessionDate": None, "exercises": []}]}

    derniere = semaines[-1]
    # Des plus récentes aux plus anciennes : le RPE le plus frais gagne.
    precedentes = [derniere] + list(reversed(semaines[:-1]))

    # Le DÉBUT suit la semaine précédente : il respecte un décalage posé à la main.
    # ⚠️ La DURÉE est celle de S1, pas sept jours en dur (FRE-138) : une trame peut
    # déclarer des semaines de dix jours. C'est la règle de la cascade du front
    # (`blockWeekDates`). Sans dates de BASE (la route les exige), sept jours.
    duree = 6
    if base.get("s1StartDate") and base.get("s1EndDate"):
        duree = max(0, (date.fromisoformat(base["s1EndDate"])
                        - date.fromisoformat(base["s1StartDate"])).days)
    debut = ""
    if derniere.get("endDate"):
        debut = (date.fromisoformat(derniere["endDate"]) + timedelta(days=1)).isoformat()
    fin = (date.fromisoformat(debut) + timedelta(days=duree)).isoformat() if debut else ""

    seances = []
    for index_seance, seance in enumerate(copy.deepcopy(derniere.get("sessions") or [])):
        lignes = seance.get("exercises") or []
        for index_ligne, ligne in enumerate(lignes):
            rpe_precedent = ligne.get("aimedRPE") or _rpe_herite(
                precedentes, index_seance, seance.get("name"), index_ligne, ligne, base)

            # ⚠️ L'incrément se relit dans la TRAME, à chaque génération (FRE-150) :
            # hérité par recopie de semaine en semaine, une correction de la BASE
            # ne redescendrait jamais. La trame est la source, comme pour la
            # granularité et le RPE de repli.
            # Le repli reste la valeur de la LIGNE : une ligne ajoutée à la main
            # n'a pas de contrepartie dans la trame, et la priver d'incrément
            # effacerait sa charge.
            de_la_base = _ligne_de_la_base(ligne, base)
            if de_la_base is not None and str(de_la_base.get("increment") or "").strip():
                increment = str(de_la_base["increment"]).strip()
                unite = de_la_base.get("incrementUnit")
            else:
                increment = str(ligne.get("increment") or "").strip()
                unite = ligne.get("incrementUnit")

            # ⚠️ Le réalisé se lit AVANT d'être effacé (FRE-161). L'incrément part de
            # ce que l'athlète a FAIT, pas du prescrit : la progression le suit
            # dans les deux sens.
            #
            # ⚠️ SAUF le RPE, et c'est le seul. Le ressenti n'est pas un plan :
            # partir de lui prescrirait 9,5 à qui a ressenti 9 sur un 8 demandé, et
            # punirait un jour difficile. La consigne progresse depuis la consigne.
            #
            # ⚠️ `weightDone` est la MOYENNE quand la charge est notée par série, et
            # c'est un choix : c'est la valeur que l'écran affiche (« moy. 130 »),
            # donc le coach voit d'où part la semaine suivante. Le TOP SET est
            # l'autre lecture défendable — il ferait progresser sur un pic plutôt
            # que sur la séance ; si on en rediscute, c'est ici.
            charge_reelle = _nombre(ligne.get("weightDone"))
            reps_reelles = _entier(ligne.get("repsDone"))
            series_reelles = _series_tenues(ligne)

            ligne.update(_REALISE)
            ligne["feltRPEBySet"] = []
            ligne["repsDoneBySet"] = []
            ligne["weightDoneBySet"] = []

            if increment:
                if unite == "sets":
                    # Progresser en VOLUME plutôt qu'en charge : 3×5 → 4×5. Entier
                    # seulement — une demi-série n'existe pas.
                    inc = _entier(increment)
                    n = series_reelles if series_reelles is not None else _entier(ligne.get("sets"))
                    if inc is not None and n is not None:
                        ligne["sets"] = str(max(1, n + inc))
                elif unite == "reps":
                    inc = _entier(increment)
                    r = reps_reelles if reps_reelles is not None else _entier(ligne.get("reps"))
                    if inc is not None and r is not None:
                        ligne["reps"] = str(r + inc)
                elif unite == "rpe":
                    inc, r = _nombre(increment), _nombre(ligne.get("aimedRPE"))
                    if inc is not None and r is not None:
                        borne = min(10, max(5, r + inc))
                        arrondi = round(borne * 2) / 2
                        ligne["aimedRPE"] = str(int(arrondi) if arrondi.is_integer() else arrondi)
                elif ligne.get("weight") or charge_reelle is not None:
                    pas = granularite(ligne.get("name"), base.get("granularity"))
                    inc = resoudre_increment(
                        {**ligne, "increment": increment, "incrementUnit": unite}, pas)
                    charge = charge_reelle if charge_reelle is not None else _nombre(ligne.get("weight"))
                    if inc is not None and charge is not None:
                        somme = round(charge + inc, 2)
                        ligne["weight"] = str(int(somme) if somme.is_integer() else somme)

            # ⚠️ Pas d'héritage quand un incrément de RPE vient de jouer : il
            # écraserait la valeur qu'on vient de calculer.
            increment_de_rpe = unite == "rpe" and bool(increment)
            if not ligne.get("aimedRPE") and rpe_precedent and not increment_de_rpe:
                ligne["aimedRPE"] = rpe_precedent

            if not ligne.get("weightLocked"):
                # La charge ne survit que si quelque chose la PORTE. Sans
                # incrément, ou sous un incrément de RPE, elle s'efface : la
                # semaine progresse par le ressenti visé, et une charge recopiée
                # dirait deux consignes. Sous `sets`, `reps` ou une charge, elle
                # reste.
                if not increment or unite == "rpe":
                    # Effacée, donc ABSENTE — et pas « chaîne vide » (FRE-137).
                    ligne["weight"] = None

        # ⚠️ Le filtre vient APRÈS la boucle : `index_ligne` sert à retrouver la
        # ligne dans les semaines précédentes, et filtrer avant décalerait ces
        # index d'un cran par ligne écartée.
        # Une ligne sans nom est un résidu d'édition (« ajouter un exercice » non
        # garni) ; le chargement en masse l'écarte aussi.
        seance["exercises"] = [l for l in lignes if (l.get("name") or "").strip()]
        seance["sessionDate"] = None
        seance.pop("formOfTheDay", None)

        # ⚠️ Les ids de la semaine SOURCE ne survivent pas à la copie, aux DEUX
        # niveaux. L'insertion en fabrique de neufs, donc rien ne casserait ICI ;
        # mais une copie qui garde les uuid de la semaine précédente envoie chaque
        # frappe du coach en `PATCH /exercises/{ligne déjà entraînée}` — accepté,
        # et le réalisé d'avant écrasé en silence. La règle se tient là où le
        # calcul vit, pas seulement là où l'insertion pardonne.
        seance.pop("id", None)
        for ligne in seance["exercises"]:
            ligne.pop("id", None)
        seances.append(seance)

    return {"weekNumber": numero, "name": None, "hidden": False,
            "startDate": debut, "endDate": fin, "sessions": seances}
