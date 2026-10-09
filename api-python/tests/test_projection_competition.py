"""Les totaux P, R et O projetés d'un participant (FRE-203).

La règle est pure — des essais en entrée, trois totaux en sortie — et se prouve
sans base. La spec de `test_competitions.py` garde qu'elle est SERVIE.

Chaque cas est une étape réelle d'une compétition : avant le premier essai,
pendant, après un raté, à la fin.
"""

from app.competitions.scoring import compute_projection


def essai(p=0.0, r=0.0, o=0.0, *, fait="", charge=0.0):
    a = {"weight": charge, "result": fait}
    if p or r or o:
        a["weights"] = {"pessimistic": p, "realistic": r, "optimistic": o}
    return a


def mouvement(*essais):
    return {"name": "X", "attempts": list(essais)}


def pro(*mouvements):
    t = compute_projection(list(mouvements))
    return (t["pessimistic"], t["realistic"], t["optimistic"])


def test_avant_le_premier_essai_c_est_le_plan():
    """Le plus haut plan de chaque hypothèse, sommé sur les mouvements."""
    assert pro(mouvement(essai(40, 42.5, 45), essai(45, 47.5, 50), essai(47.5, 50, 55)),
               mouvement(essai(100, 105, 110), essai(110, 115, 120), essai(115, 120, 125))) \
        == (162.5, 170.0, 180.0)


def test_une_reussite_au_dessus_du_plan_P_releve_le_total_P():
    """Le 2e essai passe à 47,5 : le total P ne peut plus descendre sous ce qui
    est acquis, même si le 3e prévoyait moins en P.

    MUTATION QUI ROUGIT : ignorer la meilleure réussite — P retombe à 46."""
    assert pro(mouvement(essai(40, 42.5, 45, fait="rep", charge=42.5),
                         essai(45, 47.5, 50, fait="rep", charge=47.5),
                         essai(46, 50, 52.5))) == (47.5, 50.0, 52.5)


def test_un_mouvement_FINI_ne_compte_que_sa_reussite():
    """Le 3e essai est manqué : le plan O à 55 ne compte plus, le mouvement vaut
    ce qu'il a réussi, dans les trois hypothèses.

    MUTATION QUI ROUGIT : compter les essais DÉJÀ tentés comme prévus — O resterait à 55."""
    assert pro(mouvement(essai(40, 42.5, 45, fait="rep", charge=42.5),
                         essai(45, 47.5, 50, fait="rep", charge=47.5),
                         essai(47.5, 50, 55, fait="norep", charge=50))) == (47.5, 47.5, 47.5)


def test_tout_manque_ne_compte_rien():
    assert pro(mouvement(essai(40, 40, 40, fait="norep", charge=40),
                         essai(40, 40, 40, fait="norep", charge=40),
                         essai(40, 40, 40, fait="norep", charge=40))) == (0.0, 0.0, 0.0)


def test_un_essai_a_venir_SANS_plan_reprend_le_dernier_plan():
    """Le coach n'a planifié que le 1er essai : les deux suivants le reprennent,
    plutôt que de faire tomber le total à la réussite."""
    assert pro(mouvement(essai(40, 42.5, 45, fait="rep", charge=40), essai(), essai())) == (40.0, 42.5, 45.0)


def test_une_charge_annoncee_SANS_plan_vaut_pour_les_trois():
    """La forme d'avant la stratégie P/R/O : une seule charge, que l'athlète
    tentera quelle que soit l'hypothèse."""
    assert pro(mouvement(essai(charge=60))) == (60.0, 60.0, 60.0)


def test_a_la_fin_les_trois_totaux_egalent_le_score():
    """L'invariant qui dit que la projection atterrit : plus rien à venir, plus
    rien à projeter."""
    fini = [mouvement(essai(40, 42.5, 45, fait="rep", charge=42.5), essai(45, 47.5, 50, fait="norep", charge=47.5)),
            mouvement(essai(100, 105, 110, fait="rep", charge=105), essai(110, 115, 120, fait="rep", charge=115))]
    # 157,5 = le score que la vue `competition_scores` rend pour ces essais.
    assert pro(*fini) == (157.5, 157.5, 157.5)
