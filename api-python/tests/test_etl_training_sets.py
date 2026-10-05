"""Projection analytics `training_sets` — sur le VRAI Postgres.

Ces tests portaient sur un `transform_exercise` Python, pur et sans base. Ce
transform n'existe plus : la source vivant désormais dans la même base que la
cible, la projection est un `INSERT … SELECT` et le parsing descend dans les
fonctions `ff_*` (cf. `docs/postgres-schema.sql`).

Ils sont donc rejoués ICI, contre Postgres 16 — la version de Neon. C'est plus
lent qu'un test pur, et c'est le prix à payer : une expression rationnelle
Postgres ne se vérifie pas en Python, et l'ancienne suite ne couvrait justement
PAS le LOAD (« se vérifie à la main contre Neon », disait son en-tête). Ce qui
était vérifié à la main l'est maintenant par la suite.

⚠️ CE QUI N'EST PAS ICI, ET NE PEUT PLUS L'ÊTRE. L'équivalence entre ces
fonctions SQL et les parseurs Python qu'elles remplacent a été prouvée en les
rejouant sur `training_sets.raw`, qui portait l'entrée Firestore exacte de
chaque ligne : 9 902 lignes, zéro divergence. `raw` a disparu avec l'ancienne
table — la preuve n'est plus rejouable, ces tests-ci en tiennent lieu.
"""

import pytest
from sqlalchemy import text

from scripts.etl_training_sets import apply, main

_SESSION = "cccccccc-0000-0000-0000-000000000001"


@pytest.fixture
def seance(pg):
    """Un athlète, son programme, et l'arbre jusqu'à UNE séance. Les lignes
    d'exercice sont semées par test : c'est leur projection qui est le sujet."""
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('coach-1','a@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1')"))
    pg.execute(text(
        "INSERT INTO athletes (id, legacy_id, coach_uid, first_name) VALUES "
        "('11111111-1111-1111-1111-111111111111','ath-1','coach-1','Aubin')"))
    pg.execute(text(
        "INSERT INTO programs (id, coach_uid, athlete_id) "
        "VALUES ('p1','coach-1','11111111-1111-1111-1111-111111111111')"))
    pg.execute(text(
        "INSERT INTO training_macros (id, program_id, legacy_id, number) VALUES "
        "('aaaaaaaa-0000-0000-0000-000000000001','p1','m1',1)"))
    pg.execute(text(
        "INSERT INTO training_blocks (id, macro_id, legacy_id, number) VALUES "
        "('bbbbbbbb-0000-0000-0000-000000000001',"
        "'aaaaaaaa-0000-0000-0000-000000000001','b1',2)"))
    # La semaine porte une date de DÉBUT mais la séance n'a pas été lancée :
    # c'est le cas de repli, et le plus fréquent (49 % des lignes réelles).
    pg.execute(text(
        "INSERT INTO training_weeks (id, block_id, legacy_id, number, start_date) VALUES "
        "('dddddddd-0000-0000-0000-000000000001',"
        "'bbbbbbbb-0000-0000-0000-000000000001','w1',3,DATE '2026-08-03')"))
    pg.execute(text(
        "INSERT INTO training_sessions (id, week_id, legacy_id, position, name) VALUES "
        "(CAST(:s AS uuid),'dddddddd-0000-0000-0000-000000000001','s1',0,'Lundi')"),
        {"s": _SESSION})
    return pg


def projeter(pg, position: int = 0, **champs):
    """Sème UNE ligne d'exercice, reconstruit la projection, rend la row produite
    (ou None si la ligne a été écartée)."""
    champs.setdefault("name", "SQUAT")
    colonnes = ", ".join(champs)
    binds = ", ".join(f":{c}" for c in champs)
    pg.execute(text(
        f"INSERT INTO training_exercises (session_id, position, {colonnes}) "
        f"VALUES (CAST(:sid AS uuid), :pos, {binds})"),
        {"sid": _SESSION, "pos": position, **champs})
    apply(pg)
    return pg.execute(text("SELECT * FROM training_sets ORDER BY exercise_index")).first()


# --------------------------------------------------------------------------- #
# LES SÉRIES TENUES, ET LE REPÈRE DU PRESCRIT (FRE-110)
#
# ⚠️ LA MÊME RÈGLE QUE `app/entrainement/records.py`, DANS L'AUTRE DIALECTE — et le projet a
# déjà payé pour savoir ce que ça coûte : la trace de « réalisé » recopiée d'un
# dialecte à l'autre avait perdu `rpe_by_set` en chemin (FRE-71 §1). Les specs
# ci-dessous tiennent donc la formulation ELLE-MÊME, pas seulement son résultat :
# les deux formules écartées y ont chacune leur contre-exemple.
# --------------------------------------------------------------------------- #

def test_une_série_ÉCHOUÉE_ne_compte_pas_dans_le_tonnage(seance):
    """Un 4×5 @ 100 dont la 4e a échoué vaut 3 séries, soit 1 500 kg — pas 2 000.

    Mesuré avant de changer : 81 lignes de production, 36 731 kg comptés pour
    9 093 réellement tenus."""
    row = projeter(seance, sets="4", reps="5", weight="100",
                   felt_rpe="FAIL", felt_rpe_by_set=["9", "9.5", "10", "FAIL"])
    assert row.sets == 3
    assert row.tonnage_kg == 1500


def test_le_tonnage_PRÉVU_garde_la_trace_de_ce_qui_était_visé(seance):
    """⚠️ LE REPÈRE EXISTE POUR QU'UN ÉCHEC NE RESSEMBLE PAS À UNE ABSENCE. 51
    lignes de production tombent à zéro de tonnage ; sans second repère, la
    courbe plonge et se lit « il n'est pas venu » — alors qu'il était là, sous une
    barre trop lourde. C'est l'ÉCART qui porte l'information."""
    row = projeter(seance, sets="4", reps="5", weight="100",
                   felt_rpe="FAIL", felt_rpe_by_set=["9", "9.5", "10", "FAIL"])
    assert (row.tonnage_kg, row.tonnage_prevu_kg) == (1500, 2000)


def test_le_VOLUME_EN_REPS_a_le_même_repère_que_le_tonnage(seance):
    """⚠️ LE GRAPHE A DEUX UNITÉS, ET LE DÉFAUT LES TOUCHE TOUTES LES DEUX. Le
    volume en répétitions vaut `sets × reps` : il baisse exactement comme le
    tonnage quand `sets` compte les séries tenues. Un repère posé sur le seul
    tonnage aurait laissé l'autre moitié du graphe inexpliquée — c'est-à-dire le
    défaut même qu'on répare."""
    row = projeter(seance, sets="4", reps="5", weight="100",
                   felt_rpe="FAIL", felt_rpe_by_set=["9", "9.5", "10", "FAIL"])
    assert (row.sets, row.sets_prevus) == (3, 4)


def test_sans_échec_les_deux_tonnages_sont_ÉGAUX(seance):
    """⚠️ LE CONTRE-EXEMPLE, ET IL EST NÉCESSAIRE : sans lui, un `tonnage_prevu_kg`
    qui vaudrait toujours le prescrit passerait la spec précédente tout en
    dessinant un repère sur CHAQUE semaine. L'égalité est ce qui permet à
    l'affichage de ne rien filtrer — il compare, et ne montre que si ça diffère."""
    row = projeter(seance, sets="4", reps="5", weight="100",
                   felt_rpe="8", felt_rpe_by_set=["8", "8", "8.5", "9"])
    assert row.tonnage_kg == row.tonnage_prevu_kg == 2000


def test_une_ligne_TOUT_ÉCHOUÉE_reste_avec_un_tonnage_NUL(seance):
    """⚠️ CE N'EST PAS UN FILTRE. La ligne demeure — sa charge, son RPE, sa trace
    d'échec — c'est son tonnage qui vaut zéro. L'écarter ferait disparaître
    l'échec des statistiques qui le comptent (`fails`, `failsAtMax`)."""
    row = projeter(seance, sets="3", reps="5", weight="100",
                   felt_rpe="FAIL", felt_rpe_by_set=["FAIL", "FAIL", "FAIL"])
    assert row is not None and row.felt_rpe_raw == "FAIL"
    assert (row.sets, row.tonnage_kg, row.tonnage_prevu_kg) == (0, 0, 1500)


def test_les_séries_tenues_APRÈS_un_échec_comptent(seance):
    """⚠️ ON NE S'ARRÊTE PAS AU PREMIER ÉCHEC, et c'est la production qui l'a dit :
    NEUF lignes sur 100 portent des valeurs APRÈS un FAIL. L'athlète baisse la
    charge, souffle, repart.

    Contre-exemple de la formule « tout ce qui précède le premier FAIL », qui
    rendrait ZÉRO ici et ferait disparaître deux séries réellement tenues."""
    row = projeter(seance, sets="3", reps="5", weight="100",
                   felt_rpe="FAIL", felt_rpe_by_set=["FAIL", "8", "9.5"])
    assert row.sets == 2
    assert row.tonnage_kg == 1000


def test_les_séries_NON_NOTÉES_ne_se_déduisent_PAS_du_prescrit(seance):
    """⚠️ CONTRE-EXEMPLE DE `sets - nombre_de_FAIL`, la formule qui vient
    naturellement ensuite. Sur `sets = 3` noté `['FAIL']` — DIX lignes réelles —
    elle affirmerait deux séries tenues dont rien ne porte la trace.

    On ne compte que ce qui est NOTÉ, quitte à sous-estimer quand l'athlète n'a
    rempli qu'une case. Sous-estimer est le bon sens de l'erreur : un tonnage
    crédite un travail, il ne le présume pas."""
    row = projeter(seance, sets="3", reps="5", weight="100",
                   felt_rpe="FAIL", felt_rpe_by_set=["FAIL"])
    assert row.sets == 0, "aucune série notée hors échec"
    assert row.tonnage_kg == 0


def test_un_FAIL_GLOBAL_sans_détail_ne_change_RIEN(seance):
    """⚠️ LA LIGNE QU'ON NE SAIT PAS LIRE — 45 lignes de production. Un FAIL global
    sans détail par série peut vouloir dire « rien passé » comme « raté la
    dernière ». Faute de savoir, le tonnage reste celui du prescrit : c'est le
    comportement d'avant, et le changer supposerait ce qu'on ignore.

    ⚠️ Divergence ASSUMÉE avec les records, qui écartent ces lignes. Un record
    doit se PROUVER ; un tonnage décrit une séance qui a eu lieu."""
    row = projeter(seance, sets="3", reps="5", weight="100", felt_rpe="FAIL")
    assert (row.sets, row.tonnage_kg) == (3, 1500)


# --------------------------------------------------------------------------- #
# Charge prescrite / réalisée (FRE-18)
# --------------------------------------------------------------------------- #

def test_charge_reelle_dans_sa_colonne(seance):
    row = projeter(seance, weight="100", weight_done="105")
    assert (row.weight_kg, row.weight_done_kg) == (100, 105)


def test_tonnage_sur_la_charge_reelle_si_saisie(seance):
    # 3 × 5 × 105 (réalisé), PAS × 100 (prescrit).
    row = projeter(seance, sets="3", reps="5", weight="100", weight_done="105")
    assert row.tonnage_kg == 1575


def test_tonnage_retombe_sur_le_prescrit(seance):
    row = projeter(seance, sets="3", reps="5", weight="100")
    assert row.tonnage_kg == 1500


def test_reps_et_charge_reelles_priment_ensemble(seance):
    # Même convention pour les deux : le réalisé s'il est saisi.
    row = projeter(seance, sets="3", reps="5", reps_done="4",
                   weight="100", weight_done="105")
    assert row.tonnage_kg == 3 * 4 * 105


def test_pdc_realise_traite_comme_poids_du_corps(seance):
    # « PDC » → pas de charge externe : weight_done_kg NULL, le tonnage retombe
    # sur le prescrit plutôt que de disparaître.
    row = projeter(seance, sets="3", reps="5", weight="100", weight_done="PDC")
    assert row.weight_done_kg is None
    assert row.tonnage_kg == 1500


def test_charge_reelle_sur_un_exercice_prescrit_en_pdc(seance):
    # Le coach prescrit PDC, l'athlète charge 10 : le tonnage existe.
    row = projeter(seance, sets="3", reps="5", weight="PDC", weight_done="10")
    assert row.bodyweight is True
    assert (row.weight_kg, row.weight_done_kg) == (None, 10)
    assert row.tonnage_kg == 150


# --------------------------------------------------------------------------- #
# Isométrie (FRE-20)
# --------------------------------------------------------------------------- #

def test_isometrie_sans_tonnage(seance):
    # Le cas réel du ticket : CHINESE PLANK, 3 × 60 s @ 40 kg produisait
    # 7 200 kg de tonnage pour un exercice où rien n'est déplacé.
    row = projeter(seance, name="CHINESE PLANK", sets="3", reps="60",
                   reps_unit="sec", weight="40")
    assert row.tonnage_kg is None


def test_isometrie_tonnage_null_et_pas_zero(seance):
    """NULL, pas 0 : « non applicable » n'est pas « zéro ».

    `sum()` ignore les NULL — tous les agrégats se corrigent sans qu'aucune
    requête ne change. Un 0 se serait fondu dans les moyennes en les tirant vers
    le bas. `0 == None` est faux, mais on verrouille la DISTINCTION, pas la
    seule nullité."""
    row = projeter(seance, sets="3", reps="60", reps_unit="sec", weight="40")
    assert row.tonnage_kg is not None or row.tonnage_kg is None  # lisibilité
    assert row.tonnage_kg is None and row.tonnage_kg != 0


def test_isometrie_garde_ses_autres_colonnes(seance):
    # Seul le tonnage disparaît : la ligne reste exploitable (durée en `reps`,
    # unité, charge portée), de quoi bâtir un jour une métrique de temps sous
    # tension sans nouveau rebuild.
    row = projeter(seance, sets="3", reps="60", reps_unit="sec", weight="40")
    assert (row.sets, row.reps, row.reps_unit, row.weight_kg) == (3, 60, "sec", 40)


def test_un_exercice_en_reps_garde_son_tonnage(seance):
    # Le garde-fou du correctif : ne pas neutraliser ce qui doit compter.
    row = projeter(seance, sets="3", reps="10", reps_unit="count", weight="40")
    assert row.tonnage_kg == 1200


def test_unite_absente_compte_comme_des_reps(seance):
    # Une unité NULL ne doit PAS être lue comme du chrono — sinon tout
    # l'historique d'avant le champ perdrait son tonnage.
    row = projeter(seance, sets="3", reps="10", weight="40")
    assert row.tonnage_kg == 1200


# --------------------------------------------------------------------------- #
# Nature de la ligne (FRE-10)
# --------------------------------------------------------------------------- #

def test_kind_projete(seance):
    assert projeter(seance, kind="warmup").kind == "warmup"


def test_kind_absent_reste_null(seance):
    # Absent = entraînement (déduit), jamais réécrit dans l'arbre → NULL en base.
    assert projeter(seance).kind is None


def test_un_echauffement_garde_son_tonnage(seance):
    """LA distinction FRE-10 vs FRE-20 : un échauffement A un tonnage réel (un
    band pull-apart chargé déplace un poids), c'est l'AGRÉGATION (tracking.py)
    qui l'exclut, pas cette projection."""
    row = projeter(seance, kind="warmup", sets="3", reps="10", weight="20")
    assert row.tonnage_kg == 600


# --------------------------------------------------------------------------- #
# Parsing tolérant — tout est saisi à la main, en texte
# --------------------------------------------------------------------------- #

def test_fourchette_de_reps(seance):
    # « 8-10 » → borne basse en `reps`, haute en `reps_high`.
    row = projeter(seance, reps="8-10")
    assert (row.reps, row.reps_high) == (8, 10)


def test_reps_simple_sans_borne_haute(seance):
    row = projeter(seance, reps="8")
    assert (row.reps, row.reps_high) == (8, None)


def test_virgule_decimale(seance):
    # Les coachs écrivent « 2,5 » aussi bien que « 2.5 ».
    assert projeter(seance, weight="2,5").weight_kg == 2.5


def test_rpe_textuel_garde_sa_saisie(seance):
    # « Sub5 » et « FAIL » sont des valeurs LÉGITIMES : pas de numérique, mais le
    # texte est conservé — `tracking.py` compte les FAIL dessus.
    row = projeter(seance, felt_rpe="FAIL")
    assert (row.felt_rpe, row.felt_rpe_raw) == (None, "FAIL")


def test_rpe_hors_bornes_ecarte(seance):
    # Au-delà de 0-10 c'est une saisie parasite : pas de numérique, texte gardé.
    row = projeter(seance, felt_rpe="85")
    assert row.felt_rpe is None and row.felt_rpe_raw == "85"


def test_rpe_par_serie_filtre_et_ordonne(seance):
    row = projeter(seance, felt_rpe_by_set=["7", "abc", "8.5", "99"])
    assert row.rpe_by_set == [7, 8.5]


def test_rpe_par_serie_vide_devient_null(seance):
    # Un tableau vide n'est pas une mesure : NULL, pour que `{}` ne compte pas.
    assert projeter(seance, felt_rpe_by_set=[]).rpe_by_set is None


def test_texte_vide_devient_null(seance):
    """Le front écrit `''` là où il n'y a rien ; une table de faits veut NULL —
    sinon `count()` compte les vides et `GROUP BY` fabrique une catégorie
    « chaîne vide ».

    ⚠️ CE TEST A MORDU. La première version de la projection ne normalisait que
    les colonnes qu'elle PARSE, et recopiait les autres telles quelles. La preuve
    d'équivalence par `raw` ne l'a pas vu : elle portait justement sur les
    colonnes parsées. On couvre donc ici toutes les colonnes de texte QUI PEUVENT
    ENCORE PORTER UN VIDE.

    ⚠️ ET CETTE LISTE RÉTRÉCIT À CHAQUE LOT DE FRE-137. `coach_note` et
    `athlete_feedback` en sont sorties au lot FROID, `tempo`, `assistance` et
    `format` au lot TIÈDE : la base REFUSE désormais d'y écrire `''`, et l'INSERT
    de ce décor tombait en `CheckViolation`. Ce n'est pas la spec qui avait tort —
    c'est la contrainte qui rend sa faute INFABRICABLE, donc la normalisation de
    l'ETL inutile pour ces colonnes.

    ⚠️ ET DEPUIS LE LOT CHAUD, IL N'EN RESTE AUCUNE : toutes portent leur CHECK,
    la faute n'est plus fabricable sans retirer la contrainte. On la retire donc
    DANS la transaction du test — annulée à la sortie — plutôt que de supprimer
    la spec.

    Parce que la normalisation de l'ETL n'est pas devenue inutile : elle reste le
    filet du jour où une contrainte saute, ou d'une base restaurée d'un dump
    antérieur au 11/09. Un garde qu'on cesse de tester parce que « ça ne peut
    plus arriver » est un garde mort."""
    seance.execute(text("ALTER TABLE training_exercises DROP CONSTRAINT group_id_non_vide"))
    row = projeter(seance, group_id="")
    assert row.superset_group is None


def test_variante_vide_devient_null(seance):
    # `{}` n'est pas « une variante vide », c'est pas de variante.
    assert projeter(seance, variant=[]).variant is None


# --------------------------------------------------------------------------- #
# Structure et rattachement
# --------------------------------------------------------------------------- #

def test_variante_projetee_en_liste(seance):
    """FRE-50 — le défaut qui aurait vidé la colonne au premier rebuild.

    La source est un `text[]` depuis FRE-33, et l'ancien filtre `_text()`
    rejetait TOUTE liste, y compris à un seul élément : les 4 879 variantes
    seraient parties en silence."""
    assert projeter(seance, variant=["DS", "PAUSE"]).variant == ["DS", "PAUSE"]


def test_une_variante_seule_survit(seance):
    # Le cas exact que l'ancien filtre perdait aussi — et le plus fréquent.
    assert projeter(seance, variant=["COMP"]).variant == ["COMP"]


def test_le_nom_est_CELUI_DE_LA_BIBLIOTHEQUE(seance):
    """⚠️ CETTE SPEC AFFIRMAIT UNE NORMALISATION QUI N'A PLUS LIEU D'ÊTRE
    (FRE-123). La projection faisait `upper(e.name)` parce que la source pouvait
    porter n'importe quelle casse. Depuis que `training_exercises.name` RÉFÉRENCE
    `library_entries`, elle porte exactement l'orthographe de la bibliothèque —
    la normalisation est devenue redondante.

    ⚠️ ET DANGEREUSE, ce qui a décidé du retrait : `training_sets.exercise` a sa
    PROPRE clé étrangère. Le jour où une entrée s'appellerait « Pec deck »,
    `upper()` en ferait « PEC DECK » — un nom que la bibliothèque ne porte pas —
    et le rebuild nocturne ENTIER échouerait. Les 101 entrées sont majuscules
    aujourd'hui ; c'est un état de fait, pas une garantie.

    La garantie a donc changé de place : elle n'est plus dans une fonction de
    projection, elle est dans le schéma."""
    assert projeter(seance, name="SQUAT").exercise == "SQUAT"


def test_un_nom_HORS_bibliotheque_ne_peut_pas_ETRE_SEMÉ(seance):
    """Le pendant du précédent, et ce qui rend la normalisation inutile : la base
    REFUSE désormais ce que la projection devait auparavant rattraper."""
    import pytest as _pytest
    from sqlalchemy.exc import IntegrityError

    with _pytest.raises(IntegrityError):
        projeter(seance, name="squat")


def test_un_repos_LIBRE_n_est_pas_un_repos_de_moins_une_seconde(seance):
    """FRE-169 : `rest_s` portait 8 751 valeurs à −1 (56 % des lignes), et
    `avg(rest_s)` rendait 51 s là où les repos réels font 150 s. Le vu rouge du
    ticket : un `-1` et un `120`, moyenne 59,5 au lieu de 120.

    Depuis, la sentinelle ne peut plus ENTRER : c'est le CHECK qui rougit, pas
    la projection. Le repos libre est NULL, et NULL ne pèse rien dans une
    moyenne ; le repos nul (`0`) reste ce qu'il est."""
    import pytest as _pytest
    from sqlalchemy.exc import IntegrityError

    # `projeter` rend la PREMIÈRE ligne ; ici on en sème quatre, et on lit par position.
    for position, rest in enumerate((None, "120", "0", "BISET")):
        projeter(seance, position=position, rest=rest)
    rest_s = dict(seance.execute(text(
        "SELECT exercise_index, rest_s FROM training_sets ORDER BY exercise_index")).all())
    assert rest_s == {0: None, 1: 120, 2: 0, 3: None}
    with _pytest.raises(IntegrityError):
        with seance.begin_nested():
            projeter(seance, position=4, rest="-1")
    moyenne = seance.execute(text("SELECT avg(rest_s) FROM training_sets")).scalar()
    assert moyenne == 60  # (120 + 0) / 2 — le libre et le texte ne pèsent rien


def test_une_ligne_sans_nom_est_ecartee(seance):
    """Résidu d'édition : le coach a cliqué « ajouter un exercice » sans le
    garnir. La projection l'écarte plutôt que de fabriquer une ligne de faits
    vide.

    ⚠️ `None` ET NON `'   '` DEPUIS FRE-123. L'absence de nom se disait par une
    chaîne vide ; elle se dit maintenant par NULL, parce qu'une clé étrangère
    accepte l'absence et refuse la chaîne vide. Le cas testé n'a pas changé —
    seule sa NOTATION a changé, et c'est justement ce que la migration corrige :
    « pas encore choisi » redevient une absence."""
    assert projeter(seance, name=None) is None


def test_la_ligne_source_est_pointee(seance):
    # `exercise_id` remplace l'ancien `raw` : une identité, pas une copie figée.
    row = projeter(seance)
    source = seance.execute(text("SELECT id FROM training_exercises")).scalar()
    assert row.exercise_id == source


def test_la_cascade_nettoie_la_projection(seance):
    """Ce que l'ancienne table ne savait pas faire : sans FK, ses lignes
    survivaient à la suppression de leur source jusqu'au prochain rebuild."""
    projeter(seance)
    seance.execute(text("DELETE FROM training_exercises"))
    assert seance.execute(text("SELECT count(*) FROM training_sets")).scalar() == 0


def test_position_dans_larbre(seance):
    row = projeter(seance)
    assert (row.athlete_id, row.program_id) == ("ath-1", "p1")
    assert (row.macro_number, row.block_number, row.week_number) == (1, 2, 3)
    assert (row.session_index, row.exercise_index, row.session_name) == (0, 0, "Lundi")


def test_date_de_repli_sur_le_debut_de_semaine(seance):
    # La séance n'a pas été lancée : on retombe sur le début de semaine, et
    # `date_exact` le DIT — sans quoi personne ne pourrait distinguer les deux.
    row = projeter(seance)
    assert row.session_date.isoformat() == "2026-08-03"
    assert row.date_exact is False


def test_date_reelle_quand_la_seance_a_ete_lancee(seance):
    seance.execute(text(
        "UPDATE training_sessions SET session_date = DATE '2026-08-05'"))
    row = projeter(seance)
    assert row.session_date.isoformat() == "2026-08-05"
    assert row.date_exact is True


def test_le_rebuild_est_idempotent(seance):
    # DELETE + INSERT : rejouer ne duplique rien. L'invariant qui autorise le job
    # nocturne à tourner sans précaution.
    projeter(seance)
    apply(seance)
    apply(seance)
    assert seance.execute(text("SELECT count(*) FROM training_sets")).scalar() == 1


# --------------------------------------------------------------------------- #
# Le CHECK-IN Sentry — « le job n'a pas tourné » (FRE-81)
# --------------------------------------------------------------------------- #
#
# ⚠️ CE QU'AUCUNE REMONTÉE D'ERREUR NE SAIT FAIRE. Un job mort n'envoie rien :
# c'est l'ABSENCE de signal qu'il faut surveiller, et seul un monitor qui connaît
# l'horaire attendu peut la voir. D'où un check-in plutôt qu'un
# `capture_exception`. Ces deux specs gardent les deux façons de le rendre faux.


def _monitor_espion(monkeypatch):
    """Remplace le contexte `monitor` par un espion, et rend ce qu'il a vu."""
    import contextlib

    vu: dict = {}

    @contextlib.contextmanager
    def faux_monitor(monitor_slug=None, monitor_config=None):
        vu["slug"] = monitor_slug
        vu["config"] = monitor_config
        try:
            yield
        except BaseException as e:          # noqa: BLE001 — on observe, on ne juge pas
            vu["echec"] = type(e).__name__
            raise
        vu.setdefault("echec", None)

    import sentry_sdk.crons
    monkeypatch.setattr(sentry_sdk.crons, "monitor", faux_monitor)
    monkeypatch.setattr("app.socle.observabilite.installer", lambda: None)
    return vu


def test_un_DRY_RUN_ne_pointe_PAS(monkeypatch, pg):
    """⚠️ SINON IL MASQUE LE JOB MANQUANT. Un dry-run lancé à la main depuis un
    poste compterait comme l'exécution planifiée du soir : Sentry verrait un
    check-in à l'heure et se tairait, alors que le job de 3 h 30 n'a jamais
    tourné. Le monitor doit ne connaître QUE les vraies exécutions."""
    vu = _monitor_espion(monkeypatch)
    assert main([]) == 0            # pas de --apply
    assert vu == {}, "le dry-run ne doit pas pointer"


def test_une_SORTIE_NON_NULLE_ne_pointe_pas_ok(monkeypatch, pg):
    """⚠️ LE PIÈGE DU CONTEXTE : il ne voit que les EXCEPTIONS. La projection 1RM
    qui échoue rend 1 sans lever — le job serait ROUGE côté Cloud Run et VERT
    côté Sentry, ce qui est pire que pas de monitor du tout : on croirait la
    chaîne saine.

    Le code convertit donc la sortie non nulle en `SystemExit`, que le contexte
    voit passer."""
    vu = _monitor_espion(monkeypatch)
    monkeypatch.setattr("scripts.etl_training_sets._executer", lambda args: 1)

    with pytest.raises(SystemExit):
        main(["--apply"])

    assert vu["slug"] == "training-analytics-refresh"
    assert vu["echec"] == "SystemExit"


def test_le_monitor_declare_l_horaire_du_scheduler(monkeypatch, pg):
    """L'horaire vit à DEUX endroits — ici et dans `nidavellir/analytics.tf`.
    Cette spec ne peut pas lire le Terraform ; elle fige au moins la valeur pour
    que la divergence se voie en revue plutôt qu'en production."""
    vu = _monitor_espion(monkeypatch)
    monkeypatch.setattr("scripts.etl_training_sets._executer", lambda args: 0)

    assert main(["--apply"]) == 0
    assert vu["config"]["schedule"] == {"type": "crontab", "value": "30 3 * * *"}
    assert vu["config"]["timezone"] == "Europe/Paris"
    assert vu["echec"] is None


# --------------------------------------------------------------------------- #
# MÉCANOTRANSDUCTION (FRE-103) — le temps sous tension d'une série, en secondes
#
# La définition vit dans `ff_mechano` et ses cas limites sont éprouvés dans
# `test_mechano.py`. Ce qui se joue ICI est propre à la projection : le score
# arrive-t-il en colonne, et sur QUELLES répétitions est-il calculé.
# --------------------------------------------------------------------------- #

def test_mechano_projete(seance):
    # 3+0+1+0 = 4, × 12 reps = 48. Le score est celui d'UNE série.
    row = projeter(seance, kind="rehab", tempo="3010", sets="3", reps="12")
    assert row.mechano == 48


def test_mechano_calcule_pour_TOUTES_les_lignes_pas_seulement_kine(seance):
    """⚠️ ET C'EST DÉLIBÉRÉ, malgré une métrique réservée au travail kiné.

    Même raison que le tonnage d'un échauffement (FRE-10) : c'est
    l'AGRÉGATION qui filtre, pas la projection. Un `kind = 'rehab'` posé ici
    rendrait la colonne inexploitable le jour où quelqu'un voudra comparer — et
    une donnée non projetée ne se rattrape pas d'un WHERE.

    ⚠️ La LECTURE de l'arbre, elle, ne sert le score qu'aux lignes « Kiné »
    (`test_mechano.py`) : les deux chemins n'ont pas le même rôle, et c'est
    volontaire. L'écran montre, la table mesure."""
    row = projeter(seance, tempo="3010", sets="3", reps="12")
    assert row.kind is None
    assert row.mechano == 48


def test_mechano_d_une_serie_RATEE_vaut_ZERO(seance):
    """⚠️ MÊME CONVENTION QUE LE TONNAGE, et c'est une correction.

    J'avais d'abord écrit `nullif(reps_done, 0)` pour coller à `effectiveReps`
    côté front, où `0 || x` retombe sur la prescription. William a tranché :
    « 0 × quelque chose, ça fait 0 ». Une série rapportée à zéro répétition n'a
    produit aucun temps sous tension ; créditer le prescrit compterait un travail
    qui n'a pas eu lieu.

    ⚠️ ET `0` N'EST PAS `NULL` : le score existe et vaut zéro. L'écran le montre
    (`mt !== null`), là où `NULL` le ferait disparaître."""
    row = projeter(seance, kind="rehab", tempo="3010", sets="3", reps="12",
                   reps_done="0", weight="20")
    assert row.mechano == 0
    assert row.mechano is not None
    # ⚠️ ET LA CHARGE EST LÀ POUR QUE LA COMPARAISON AIT LIEU : sans elle le
    # tonnage vaudrait NULL (« une pièce manque »), et la ligne ne dirait rien de
    # la convention qu'on prétend partager. Les deux métriques rendent bien 0 sur
    # la même série ratée — plus aucun écart entre elles.
    assert row.tonnage_kg == 0


def test_mechano_prend_les_reps_REELLES_quand_elles_existent(seance):
    # 4 × 10 réalisées, pas les 12 prescrites.
    row = projeter(seance, kind="rehab", tempo="3010", sets="3", reps="12", reps_done="10")
    assert row.mechano == 40


def test_mechano_absent_sur_un_tempo_TEXTUEL(seance):
    # « 1CT PAUSE » pèse 693 lignes en production : un parseur laxiste y lirait 1.
    row = projeter(seance, kind="rehab", tempo="1CT PAUSE", sets="3", reps="12")
    assert row.mechano is None


def test_mechano_absent_en_isometrie(seance):
    # Comme le tonnage : multiplier une durée par une somme de durées ne veut
    # rien dire, et « non applicable » n'est pas « zéro ».
    row = projeter(seance, kind="rehab", tempo="3010", sets="3", reps="60", reps_unit="sec")
    assert row.mechano is None


# --------------------------------------------------------------------------- #
# LE RÉALISÉ PAR SÉRIE (06/09) — le tonnage cesse d'être un rectangle
#
# ⚠️ CE BLOC GARDE UNE ÉQUIVALENCE AUTANT QU'UNE NOUVEAUTÉ. La formule passe de
# `séries × reps × charge` à une somme de produits ; la moitié de ces specs
# vérifie donc que RIEN NE BOUGE quand les tableaux sont vides — c'est ce qui
# permet de livrer sans reprise du passé.
# --------------------------------------------------------------------------- #

def test_les_reps_par_série_donnent_le_tonnage_EXACT(seance):
    """3 séries à 10, 11 et 12 reps @ 8 kg valent 264 kg.

    ⚠️ C'EST UN DÉFAUT RÉPARÉ, PAS UN CONFORT. 73 lignes de production écrivent
    déjà « 10/11/12 » à la main dans `reps_done`, et `ff_num` n'en lit que la
    PREMIÈRE valeur : le tonnage vaut alors 3 × 10 × 8 = 240 kg. Sous-compté de
    24 kg, en silence, sur chacune de ces lignes."""
    row = projeter(seance, sets="3", reps="10", weight="8",
                   reps_done_by_set=["10", "11", "12"])
    assert row.tonnage_kg == 264


def test_la_charge_par_série_entre_aussi_dans_la_somme(seance):
    """10 reps @ 100 kg puis 5 @ 50 kg valent 1 250 kg.

    ⚠️ ET C'EST CE QUE LE PRODUIT DES MOYENNES NE SAIT PAS DIRE : 2 × 7,5 × 75
    rend 1 125 kg, faux de 10 %. L'écart ne se voit pas — les moyennes ont l'air
    justes et le total est bas. Les moyennes restent affichées, elles ne servent
    plus à calculer."""
    row = projeter(seance, sets="2", reps="10", weight="100",
                   reps_done_by_set=["10", "5"],
                   weight_done_by_set=["100", "50"])
    assert row.tonnage_kg == 1250


def test_sans_tableau_le_tonnage_est_INCHANGÉ(seance):
    """L'équivalence qui autorise la livraison sans reprise : la somme de `sets`
    fois le même produit vaut exactement l'ancien rectangle."""
    row = projeter(seance, sets="4", reps="5", weight="100")
    assert row.tonnage_kg == 2000


def test_une_série_NON_NOTÉE_au_milieu_retombe_sur_le_scalaire(seance):
    """`['10','','12']` dit « la deuxième n'est pas notée », pas « zéro rep ».

    ⚠️ LA POSITION EST CONSERVÉE, ET C'EST TOUT LE POINT du `text[]` : un
    tableau de nombres aurait dû inventer un zéro, qui aurait fait fondre le
    tonnage de cette série. Ici elle retombe sur la valeur de la ligne."""
    row = projeter(seance, sets="3", reps="10", weight="8",
                   reps_done_by_set=["10", "", "12"])
    assert row.tonnage_kg == 10 * 8 + 10 * 8 + 12 * 8


def test_un_tableau_PLUS_COURT_que_les_séries_complète_par_le_scalaire(seance):
    """`['11','10']` sur 3 séries : la troisième n'a pas de valeur propre.

    Le cas existe en production — « 11-10 » écrit sur une ligne à 3 séries. On ne
    devine pas la troisième, on la traite comme non notée."""
    row = projeter(seance, sets="3", reps="10", weight="8",
                   reps_done_by_set=["11", "10"])
    assert row.tonnage_kg == 11 * 8 + 10 * 8 + 10 * 8


def test_une_série_ÉCHOUÉE_n_ouvre_aucune_position(seance):
    """La règle des échecs (FRE-110) n'est pas réécrite : `sets` vaut déjà les
    séries TENUES, donc la somme n'a que 3 positions et la charge de la
    quatrième n'entre nulle part."""
    row = projeter(seance, sets="4", reps="5", weight="100",
                   felt_rpe="FAIL", felt_rpe_by_set=["9", "9.5", "10", "FAIL"],
                   reps_done_by_set=["5", "5", "5", "2"])
    assert row.sets == 3
    assert row.tonnage_kg == 1500


def test_une_ligne_TOUT_ÉCHOUÉE_vaut_ZÉRO_et_pas_NULL(seance):
    """⚠️ `generate_series(1, 0)` EST VIDE, DONC `sum()` REND NULL. Dans une table
    de faits, « zéro déplacé » n'est pas « non applicable » : un NULL se serait
    fondu dans les moyennes au lieu de peser. C'est le `coalesce` extérieur qui
    tient cette distinction."""
    row = projeter(seance, sets="3", reps="5", weight="100",
                   felt_rpe="FAIL", felt_rpe_by_set=["FAIL", "FAIL", "FAIL"])
    assert row.sets == 0
    assert row.tonnage_kg == 0


def test_l_isométrie_reste_SANS_tonnage_même_par_série(seance):
    """« CHINESE PLANK, 3 × 60 s @ 40 kg » ne déplace rien (FRE-20). Le réalisé
    par série ne change pas cette règle — la garder devant la somme évite qu'un
    tableau rempli fabrique 7 200 kg."""
    row = projeter(seance, sets="3", reps="60", reps_unit="sec", weight="40",
                   reps_done_by_set=["60", "55", "50"])
    assert row.tonnage_kg is None


def test_les_tableaux_sont_PROJETÉS_pour_la_dispersion(seance):
    """Ils ne servent pas qu'au calcul : le graphe doit pouvoir montrer qu'une
    ligne est descendue de 12 à 10, ce que la moyenne écrase."""
    row = projeter(seance, sets="3", reps="10", weight="8",
                   reps_done_by_set=["12", "11", "10"],
                   weight_done_by_set=["8", "8", "7,5"])
    assert row.reps_by_set == [12, 11, 10]
    assert row.weight_by_set == [8, 8, 7.5]


def test_une_ligne_SANS_CHARGE_garde_son_NULL_et_ne_vaut_pas_ZÉRO(seance):
    """LE DÉFAUT DU 06/09, trouvé en vérifiant la migration en production.

    ⚠️ 2 915 LIGNES SONT PASSÉES DE NULL À 0 sans que rien ne l'annonce. Le
    `coalesce(…, 0)` que j'avais posé autour de la somme visait le cas « toutes
    les séries ont échoué » (`sets = 0`, où `generate_series` est vide) — mais il
    attrapait aussi les lignes dont la CHARGE n'est pas saisie, où la somme vaut
    NULL pour une tout autre raison.

    ⚠️ ET AUCUN TOTAL NE BOUGEAIT : `sum()` ignore les NULL, donc le tonnage
    global restait identique au centime. Ce sont les MOYENNES qui se faisaient
    tirer vers le bas par 2 915 efforts « nuls » qui n'en étaient pas. Un défaut
    qui ne change aucune somme est précisément celui qu'on ne voit pas."""
    row = projeter(seance, sets="3", reps="9")   # ni charge prescrite, ni réalisée
    assert row.sets == 3
    assert row.tonnage_kg is None


def test_zéro_série_tenue_reste_un_ZÉRO_qui_pèse(seance):
    """L'autre moitié de la distinction, et elle vaut d'être tenue à part : ici
    on SAIT que rien n'a été déplacé. C'est une mesure, pas une absence — elle
    doit peser dans les moyennes au lieu d'en sortir."""
    row = projeter(seance, sets="3", reps="5", weight="100",
                   felt_rpe="FAIL", felt_rpe_by_set=["FAIL", "FAIL", "FAIL"])
    assert row.sets == 0
    assert row.tonnage_kg == 0


def test_le_rebuild_lève_LUI_MÊME_la_borne_de_15_s_du_rôle(seance):
    """FRE-155. Le rôle `brokkr` borne chaque ordre à 15 s ; le rebuild en prend
    une douzaine, sur une table qui grossit. Le job n'y échappait que parce qu'il
    vise le pooler, qui ne propage pas les défauts de rôle — un accident. On pose
    ici la borne que reçoit une connexion DIRECTE, et le rebuild doit la lever pour
    sa propre transaction.

    MUTATION QUI ROUGIT : retirer le `SET LOCAL statement_timeout = 0` d'`apply`."""
    seance.execute(text("SET LOCAL statement_timeout = '15s'"))
    apply(seance)
    assert seance.execute(text("SHOW statement_timeout")).scalar() == "0"
