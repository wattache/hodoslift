"""Le vérificateur d'invariants tient-il debout ? (FRE-143)

⚠️ CES SPECS NE VÉRIFIENT PAS LA PRODUCTION — elles vérifient l'OUTIL qui la
vérifie. La distinction est tout l'intérêt du fichier.

`scripts/verifier_invariants.py` ne tourne qu'à la main, contre une vraie base.
C'est donc exactement le genre d'outil qui pourrit sans bruit : une colonne
renommée, et ses requêtes lèvent — ou pire, en rendent zéro pour une raison qui
n'a rien à voir avec la donnée. On aurait alors un vérificateur toujours vert,
c'est-à-dire pire que pas de vérificateur.

Trois garanties, et la troisième est la seule qui compte vraiment :

  1. chaque requête S'EXÉCUTE contre le schéma de référence ;
  2. sur une base vide, chaque invariant rend ZÉRO (il compte des violations,
     pas des lignes) ;
  3. ⚠️ chaque invariant VOIT une violation qu'on plante exprès.

La troisième est la règle maison « une spec jamais vue échouer n'existe pas »,
appliquée à un vérificateur : tant qu'on ne l'a pas vu rougir sur une faute
FABRIQUÉE, on ne sait pas s'il regarde au bon endroit. Deux invariants ont été
écrits d'après une violation réelle trouvée en production le 06/09 ; les autres
étaient verts le jour de leur écriture, et n'ont donc JAMAIS été vus rouges.
Ceux-là sont ceux qui méritent le plus cette spec.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from scripts.verifier_invariants import INVARIANTS


def _invariant(cle: str):
    for inv in INVARIANTS:
        if inv.cle == cle:
            return inv
    raise AssertionError(f"invariant « {cle} » introuvable")


def _compter(pg, cle: str) -> int:
    return pg.execute(text(_invariant(cle).compte)).scalar() or 0


# --------------------------------------------------------------------------- #
# 1. La déclaration elle-même
# --------------------------------------------------------------------------- #

def test_les_cles_sont_uniques():
    """Deux invariants de même clé : le second masquerait le premier au rapport."""
    cles = [inv.cle for inv in INVARIANTS]
    assert len(cles) == len(set(cles)), sorted(cles)


def test_une_violation_connue_cite_son_ticket():
    """⚠️ « CONNU » NE DOIT PAS DEVENIR « TOLÉRÉ ». Un invariant qu'on autorise à
    rougir sans dire POURQUOI ni OÙ ça se suit devient un avertissement de plus
    qu'on apprend à ignorer — le défaut même que ce script combat."""
    for inv in INVARIANTS:
        if inv.connu_viole:
            assert inv.connu_ticket, f"{inv.cle} tolère {inv.connu_viole} violation(s) sans référence"
            assert inv.reparation, f"{inv.cle} tolère des violations sans dire comment les résorber"


def test_chaque_invariant_dit_qui_l_affirme():
    """La `source` est le lien qui rend la dette trouvable DEPUIS le code. Sans
    elle, un invariant rouge n'indique pas le commentaire devenu faux."""
    for inv in INVARIANTS:
        assert inv.source, f"{inv.cle} n'indique pas quel commentaire il garde"
        assert inv.affirmation, f"{inv.cle} n'énonce pas ce qu'il affirme"


# --------------------------------------------------------------------------- #
# 2. Les requêtes tiennent contre le schéma
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("inv", INVARIANTS, ids=lambda i: i.cle)
def test_le_compte_s_execute_et_rend_un_entier(pg, inv):
    """⚠️ C'EST CE TEST QUI EMPÊCHE LE VÉRIFICATEUR DE POURRIR. Il ne tourne
    qu'à la main : une colonne renommée ne se verrait qu'au prochain lancement,
    des semaines plus tard, sous la forme d'une trace d'exception que personne
    n'attribuerait au renommage."""
    valeur = pg.execute(text(inv.compte)).scalar()
    assert isinstance(valeur, int), f"{inv.cle} ne rend pas un compte : {valeur!r}"


@pytest.mark.parametrize(
    "inv", [i for i in INVARIANTS if i.exemples], ids=lambda i: i.cle)
def test_les_exemples_s_executent(pg, inv):
    """`--verbeux` est le mode qu'on lance quand ça va MAL. Une requête cassée
    n'y ferait surface qu'au pire moment."""
    pg.execute(text(inv.exemples)).mappings().all()


@pytest.mark.parametrize("inv", INVARIANTS, ids=lambda i: i.cle)
def test_une_base_vide_ne_viole_rien(pg, inv):
    """Un invariant qui compte des LIGNES au lieu de compter des VIOLATIONS
    rougirait sur une base saine. Le schéma de test est vide ici (la fixture ne
    sème que la bibliothèque) : tout doit valoir zéro."""
    assert (pg.execute(text(inv.compte)).scalar() or 0) == 0


# --------------------------------------------------------------------------- #
# 3. LA MUTATION — chaque invariant voit-il la faute qu'il prétend voir ?
# --------------------------------------------------------------------------- #

def _semer_un_arbre(pg) -> dict[str, str]:
    """Le plus court chemin d'un coach à une ligne d'exercice.

    Écrit en SQL nu plutôt qu'avec `chargeur_arbre.load()` : on veut planter des
    lignes VOLONTAIREMENT FAUTIVES, que le chargeur normaliserait — c'est même
    son métier. Passer par lui reviendrait à demander au code de produire la
    faute qu'on veut lui apprendre à voir.
    """
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('c-inv', 'c@x.test')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('c-inv')"))
    athlete = pg.execute(text(
        "INSERT INTO athletes (legacy_id, coach_uid) VALUES ('a-inv', 'c-inv') "
        "RETURNING id")).scalar()
    pg.execute(text(
        "INSERT INTO programs (id, coach_uid, athlete_id) "
        "VALUES ('p-inv', 'c-inv', :a)"), {"a": athlete})
    macro = pg.execute(text(
        "INSERT INTO training_macros (program_id, legacy_id, number) "
        "VALUES ('p-inv', 'm1', 1) RETURNING id")).scalar()
    bloc = pg.execute(text(
        "INSERT INTO training_blocks (macro_id, legacy_id, number) "
        "VALUES (:m, 'b1', 1) RETURNING id"), {"m": macro}).scalar()
    semaine = pg.execute(text(
        "INSERT INTO training_weeks (block_id, legacy_id, number) "
        "VALUES (:b, 's1', 1) RETURNING id"), {"b": bloc}).scalar()
    seance = pg.execute(text(
        "INSERT INTO training_sessions (week_id, legacy_id, position, name) "
        "VALUES (:w, 'seance1', 0, 'Séance') RETURNING id"), {"w": semaine}).scalar()
    return {"athlete": str(athlete), "bloc": str(bloc),
            "semaine": str(semaine), "seance": str(seance)}


def test_groupe_sans_nature_voit_une_ligne_groupee_sans_nature(pg):
    """La violation RÉELLE trouvée en production le 06/09 : quatre groupes créés
    après la reprise du 29/08, sans nature. On la refabrique ici."""
    ids = _semer_un_arbre(pg)
    assert _compter(pg, "groupe_sans_nature") == 0

    pg.execute(text(
        "INSERT INTO training_exercises (session_id, position, name, group_id) "
        "VALUES (:s, 0, 'Squat', 'g-inv')"), {"s": ids["seance"]})
    assert _compter(pg, "groupe_sans_nature") == 1

    # ⚠️ ET LA TABLE DE LA BASE COMPTE AUSSI : les huit lignes trouvées en
    # production étaient des ACCESSOIRES, pas des lignes de séance. Un invariant
    # qui n'aurait regardé qu'une des deux tables serait resté vert.
    pg.execute(text(
        "INSERT INTO training_base_accessories (block_id, position, day, name, group_id) "
        "VALUES (:b, 0, 'Lundi', 'Squat', 'g-inv')"), {"b": ids["bloc"]})
    assert _compter(pg, "groupe_sans_nature") == 2


def test_groupe_sans_nature_ignore_une_ligne_libre(pg):
    """Le complément : `group_id` VIDE n'est pas un groupe. C'est le piège qui a
    faussé la première mesure de la revue — `group_id IS NOT NULL` comptait
    4 775 chaînes vides comme des groupes, et annonçait 793 groupes sans nature
    au lieu d'un seul.

    ⚠️ ET CE PIÈGE N'EXISTE PLUS EN BASE depuis le lot CHAUD de FRE-137 : un
    `group_id` vide y est IMPOSSIBLE. La spec retire donc la contrainte dans sa
    transaction pour continuer à éprouver la requête — le `coalesce(…, '') <> ''`
    de l'invariant doit rester juste le jour où une contrainte saute."""
    ids = _semer_un_arbre(pg)
    pg.execute(text("ALTER TABLE training_exercises DROP CONSTRAINT group_id_non_vide"))
    for valeur in ("''", "NULL"):
        pg.execute(text(
            f"INSERT INTO training_exercises (session_id, position, name, group_id) "
            f"VALUES (:s, (SELECT coalesce(max(position), -1) + 1 FROM training_exercises), "
            f"'Squat', {valeur})"), {"s": ids["seance"]})
    assert _compter(pg, "groupe_sans_nature") == 0


def test_nature_sans_groupe_voit_une_nature_orpheline(pg):
    ids = _semer_un_arbre(pg)
    # Cf. la spec précédente : `group_id = ''` n'est plus insérable, on retire la
    # contrainte dans la transaction (annulée) pour fabriquer l'orpheline.
    pg.execute(text("ALTER TABLE training_exercises DROP CONSTRAINT group_id_non_vide"))
    pg.execute(text(
        "INSERT INTO training_exercises (session_id, position, name, group_id, group_kind) "
        "VALUES (:s, 0, 'Squat', '', 'biset')"), {"s": ids["seance"]})
    assert _compter(pg, "nature_sans_groupe") == 1


def test_la_base_REFUSE_une_semaine_a_l_envers(pg):
    """⚠️ CETTE SPEC DISAIT L'INVERSE JUSQU'AU 09/09, et c'était vrai : « aucun
    `CHECK` ne l'interdit en base — c'est justement pourquoi cet invariant
    existe, et pourquoi cette insertion réussit. » Elle documentait un TROU, et
    deux semaines de production sont passées par lui.

    Depuis FRE-138, `training_weeks` porte la contrainte que `calendar_events` et
    `competitions` ont toujours eue. L'état n'est plus surveillé, il est
    IMPOSSIBLE — et c'est ce que cette spec garde désormais.

    Les valeurs sont celles du cas réel (bloc « Force », semaine 1)."""
    ids = _semer_un_arbre(pg)
    with pytest.raises(IntegrityError):
        with pg.begin_nested():
            pg.execute(text(
                "UPDATE training_weeks SET start_date = '2026-03-16', end_date = '2026-02-22' "
                "WHERE id = :w"), {"w": ids["semaine"]})


def test_dates_inversees_VOIT_encore_une_semaine_a_l_envers(pg):
    """⚠️ L'INVARIANT RESTE, ET IL DOIT RESTER ÉPROUVÉ. Une contrainte peut
    sauter — un `DROP CONSTRAINT` à la main, une base restaurée d'un dump
    antérieur, un environnement monté autrement. Le jour où ça arrive, cet
    invariant est le seul à pouvoir le dire, et un invariant qu'on ne teste plus
    parce que « ça ne peut plus arriver » est un invariant mort.

    On retire donc la contrainte DANS la transaction du test — qui est annulée à
    la sortie — pour prouver que la requête voit toujours ce qu'elle annonce."""
    ids = _semer_un_arbre(pg)
    assert _compter(pg, "dates_inversees") == 0
    pg.execute(text("ALTER TABLE training_weeks DROP CONSTRAINT training_weeks_dates"))
    pg.execute(text(
        "UPDATE training_weeks SET start_date = '2026-03-16', end_date = '2026-02-22' "
        "WHERE id = :w"), {"w": ids["semaine"]})
    assert _compter(pg, "dates_inversees") == 1


def test_deux_verites_du_coach_voit_la_divergence(pg):
    _semer_un_arbre(pg)
    assert _compter(pg, "deux_verites_du_coach") == 0
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('c2-inv', 'c2@x.test')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('c2-inv')"))
    pg.execute(text("UPDATE programs SET coach_uid = 'c2-inv' WHERE id = 'p-inv'"))
    assert _compter(pg, "deux_verites_du_coach") == 1


def test_emails_en_double_voit_deux_comptes_sur_une_adresse(pg):
    """L'unicité a été RETIRÉE le 22/08 (FRE-77) : cette insertion doit passer,
    et l'invariant doit la voir. Si elle échouait, c'est que la contrainte est
    revenue — et l'invariant deviendrait inutile."""
    assert _compter(pg, "emails_de_compte_en_double") == 0
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('u1-inv', 'Meme@x.test')"))
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('u2-inv', 'meme@x.test')"))
    # La casse ne fait pas deux adresses : le rapprochement se fait en minuscules.
    assert _compter(pg, "emails_de_compte_en_double") == 1


def test_pr_hors_lift_de_competition_voit_un_record_sur_du_renforcement(pg):
    """La clé étrangère de FRE-123 garantit que le nom EXISTE dans la
    bibliothèque, jamais qu'il s'agit d'un lift de COMPÉTITION. Cette insertion
    passe donc la FK et viole quand même la règle — c'est tout l'objet."""
    ids = _semer_un_arbre(pg)
    pg.execute(text(
        "INSERT INTO library_entries (category, name, competition) "
        "VALUES ('exercices', 'CURL INVARIANT', false) ON CONFLICT DO NOTHING"))
    assert _compter(pg, "pr_hors_lift_de_competition") == 0
    pg.execute(text(
        "INSERT INTO athlete_prs (athlete_id, movement, reps, weight_kg) "
        "VALUES (:a, 'CURL INVARIANT', 5, 40)"), {"a": ids["athlete"]})
    assert _compter(pg, "pr_hors_lift_de_competition") == 1


def test_projection_orpheline_voit_une_ligne_sans_athlete(pg):
    """`training_sets.athlete_id` est du TEXTE recopié, sans clé étrangère :
    rien en base n'empêche l'orphelin, seul le rebuild nocturne le résorbe."""
    _semer_un_arbre(pg)
    assert _compter(pg, "projection_orpheline") == 0
    pg.execute(text(
        "INSERT INTO training_sets (athlete_id, program_id, session_index, "
        "exercise_index, exercise) VALUES ('a-fantome', 'p-inv', 0, 0, 'SQUAT')"))
    assert _compter(pg, "projection_orpheline") == 1


def test_realise_hors_projection_voit_une_ligne_notee_absente(pg):
    """Le retard du job nocturne, vu depuis la DONNÉE et non depuis le monitor."""
    ids = _semer_un_arbre(pg)
    pg.execute(text(
        "INSERT INTO training_exercises (session_id, position, name, felt_rpe) "
        "VALUES (:s, 0, 'Squat', '8')"), {"s": ids["seance"]})
    assert _compter(pg, "realise_hors_projection") == 1


def test_cles_de_1rm_voit_une_cle_inattendue(pg):
    _semer_un_arbre(pg)
    assert _compter(pg, "cles_de_1rm_inattendues") == 0
    pg.execute(text(
        """UPDATE athletes SET current_one_rm = '{"squat": 100, "souleveDeTerre": 180}'::jsonb
           WHERE legacy_id = 'a-inv'"""))
    assert _compter(pg, "cles_de_1rm_inattendues") == 1


def test_cles_de_1rm_accepte_le_bench_et_le_deadlift(pg):
    """⚠️ L'INVARIANT SUIT LE CONTRAT, IL NE LE SUBIT PAS (FRE-147). Sans cette
    spec, l'élargissement à sept clés n'aurait été prouvé par rien : la spec
    d'à-côté reste verte avec une liste blanche à cinq, puisqu'elle n'observe
    qu'une clé étrangère au contrat. Celle-ci échoue si l'on oublie l'invariant
    en ajoutant les mouvements — c'est-à-dire dans le cas exact qui est arrivé."""
    _semer_un_arbre(pg)
    pg.execute(text(
        """UPDATE athletes SET current_one_rm = '{"squat": 100, "benchPress": 90, "deadlift": 180}'::jsonb
           WHERE legacy_id = 'a-inv'"""))
    assert _compter(pg, "cles_de_1rm_inattendues") == 0


def test_mouvement_de_competition_hors_lift_voit_un_renforcement(pg):
    pg.execute(text(
        "INSERT INTO users (uid, email) VALUES ('cc-inv', 'cc@x.test')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('cc-inv')"))
    competition = pg.execute(text(
        "INSERT INTO competitions (name, start_date, end_date, created_by) "
        "VALUES ('Test', '2026-01-01', '2026-01-01', 'cc-inv') RETURNING id")).scalar()
    assert _compter(pg, "mouvement_de_competition_hors_lift") == 0
    pg.execute(text(
        "INSERT INTO competition_movements (competition_id, movement, position) "
        "VALUES (:c, 'CURL INVARIANT', 1)"), {"c": competition})
    assert _compter(pg, "mouvement_de_competition_hors_lift") == 1


def test_bornes_de_session_voit_une_borne_absente(pg):
    """⚠️ SEUL INVARIANT QUI N'AVAIT PAS SA MUTATION (FRE-154), et pour une
    raison qui rendait la lacune invisible : `conftest` POSE lui-même les trois
    bornes sur le rôle du conteneur, donc `test_une_base_vide_ne_viole_rien` le
    voyait vert — la fixture fournissait la réponse. On ne l'avait jamais vu
    rouge sur une borne fausse.

    `SET LOCAL`, pas `ALTER ROLE` : la transaction du test est annulée à la
    sortie, et c'est la SESSION que l'invariant lit — c'est tout son objet."""
    assert _compter(pg, "bornes_de_session") == 0
    pg.execute(text("SET LOCAL statement_timeout = '30s'"))
    assert _compter(pg, "bornes_de_session") == 1
    pg.execute(text("SET LOCAL TimeZone = 'UTC'"))
    assert _compter(pg, "bornes_de_session") == 2


def test_bornes_de_session_est_derive_de_BORNES_DU_ROLE():
    """La liste attendue vient de `app.socle.db.BORNES_DU_ROLE`, pas d'une recopie :
    c'était la QUATRIÈME copie de la même règle, et l'import était mort."""
    from app.socle.db import BORNES_DU_ROLE
    sql = _invariant("bornes_de_session").compte
    for reglage, attendu in BORNES_DU_ROLE.items():
        assert f"current_setting('{reglage}')" in sql, reglage
        assert f"'{attendu}'" in sql, attendu


def test_realise_hors_projection_ignore_un_nom_vide(pg):
    """⚠️ MÊME FILTRE QUE L'ETL. Il écarte `btrim(name) <> ''` — vide ET nul.
    La première rédaction ne filtrait que `IS NOT NULL` : une ligne à `name = ''`
    portant un RPE aurait été comptée À JAMAIS, qu'aucun rebuild ne pouvait
    résorber. Le vide et le nul confondus, dans l'outil qui les traque."""
    ids = _semer_un_arbre(pg)
    pg.execute(text(
        "INSERT INTO training_exercises (session_id, position, name, felt_rpe) "
        "VALUES (:s, 0, NULL, '8')"), {"s": ids["seance"]})
    assert _compter(pg, "realise_hors_projection") == 0


def test_realise_hors_projection_est_informatif():
    """Il rougissait TOUS LES JOURS en journée : la projection se reconstruit à
    03:30 et rien dans la donnée ne distingue « saisi depuis » de « le job n'a
    pas tourné ». Un invariant qui crie au loup chaque jour est exactement le
    défaut que le script combat — il informe, il ne tranche pas."""
    assert _invariant("realise_hors_projection").informatif


# --------------------------------------------------------------------------- #
# 4. Le VERDICT — la logique du rapport, éprouvée hors de toute base (FRE-154)
# --------------------------------------------------------------------------- #

from scripts.verifier_invariants import Invariant, verdict  # noqa: E402


def _inv(**kw) -> Invariant:
    return Invariant(cle="x", affirmation="x", source="x", compte="SELECT 0", **kw)


def test_verdict_zero_est_vert():
    assert verdict(_inv(), 0) == "vert"


def test_verdict_une_violation_est_rompu():
    assert verdict(_inv(), 1) == "rompu"


def test_verdict_connu_tant_que_le_compte_ne_depasse_pas():
    inv = _inv(connu_viole=3, connu_ticket="FRE-0")
    assert verdict(inv, 3) == "connu"
    assert verdict(inv, 4) == "rompu"
    # `--strict` : une violation connue reste une violation.
    assert verdict(inv, 3, strict=True) == "rompu"


def test_verdict_tolerance_perimee_quand_la_dette_est_payee():
    """⚠️ LE TROU QUE `main` AVAIT : un compte à zéro faisait `continue`, donc un
    `connu_viole` périmé restait dans le fichier pour toujours, prêt à absorber
    la prochaine vraie violation sans un mot. C'est le seul verdict qui ÉCHOUE
    sur zéro, et c'est voulu."""
    assert verdict(_inv(connu_viole=3, connu_ticket="FRE-0"), 0) == "tolerance_perimee"


def test_verdict_informatif_ne_tranche_jamais():
    inv = _inv(informatif=True)
    assert verdict(inv, 0) == "vert"
    assert verdict(inv, 500) == "informatif"
    assert verdict(inv, 500, strict=True) == "informatif"


def test_tier_sans_principe_voit_un_nom_QUE_LA_BIBLIOTHEQUE_CONNAIT(pg):
    """⚠️ LA MUTATION QUI DÉPARTAGE LES DEUX CRITÈRES, et c'est tout l'objet de
    cette spec (FRE-193).

    `BENCH PRESS` est semé dans la bibliothèque par la fixture. Un invariant
    qui relèverait les tiers « absents de la bibliothèque » resterait donc VERT
    sur la faute plantée ici — et c'est exactement ce qui est arrivé en
    production : `BENCH`, nom vivant du catalogue, ne désignait le mouvement
    d'aucun bloc et portait 31 placements muets. Deux migrations sont passées à
    côté avant qu'on le voie.

    Le critère juste est celui que la génération applique : nom ET tier, dans
    SON bloc."""
    import json

    ids = _semer_un_arbre(pg)
    assert _compter(pg, "tier_sans_principe") == 0

    grille = lambda tier: json.dumps([{"day": "J1", "tiers": {"BENCH PRESS": tier}}])
    pg.execute(text("UPDATE training_blocks SET day_split = CAST(:g AS jsonb) WHERE id = :b"),
               {"g": grille(1), "b": ids["bloc"]})
    assert _compter(pg, "tier_sans_principe") == 1

    # Le principe posé AU MÊME TIER le fait taire — la grille engendre enfin.
    pg.execute(text(
        "INSERT INTO training_base_principles (block_id, position, tier, name) "
        "VALUES (:b, 0, 1, 'BENCH PRESS')"), {"b": ids["bloc"]})
    assert _compter(pg, "tier_sans_principe") == 0

    # ⚠️ ET LE TIER FAIT PARTIE DE LA CLÉ. Le même mouvement, prescrit, mais
    # placé à un AUTRE tier n'engendre rien non plus : c'est le cas de David
    # Ortiz et d'Ulysse Guibert, qui prescrivent en 3 et placent en 1. Un
    # invariant qui ne comparerait que le NOM les manquerait tous les deux.
    pg.execute(text("UPDATE training_blocks SET day_split = CAST(:g AS jsonb) WHERE id = :b"),
               {"g": grille(3), "b": ids["bloc"]})
    assert _compter(pg, "tier_sans_principe") == 1


def test_tier_sans_principe_ignore_une_grille_SAINE(pg):
    """Le complément, sans lequel la spec ci-dessus pourrait compter n'importe
    quoi : une grille qui apparie ne compte pas, et un jour de REPOS non plus —
    `tiers` y vaut `{}`, et une absence n'est pas une violation."""
    ids = _semer_un_arbre(pg)
    import json

    pg.execute(text(
        "INSERT INTO training_base_principles (block_id, position, tier, name) "
        "VALUES (:b, 0, 2, 'SQUAT')"), {"b": ids["bloc"]})
    pg.execute(text("UPDATE training_blocks SET day_split = CAST(:g AS jsonb) WHERE id = :b"),
               {"g": json.dumps([{"day": "J1", "tiers": {"SQUAT": 2}},
                                 {"day": "J2", "tiers": {}}]),
                "b": ids["bloc"]})
    assert _compter(pg, "tier_sans_principe") == 0


# --------------------------------------------------------------------------- #
# 5. La garde des gardes : CHAQUE invariant tranchant a sa spec de mutation
# --------------------------------------------------------------------------- #

def test_CHAQUE_invariant_tranchant_a_sa_spec_de_mutation():
    """⚠️ LE PENDANT DE `test_CHAQUE_migration_est_declaree_quelque_part`, qui
    manquait de ce côté-ci (FRE-154). Onze invariants, dix mutations : le
    onzième n'avait pas la sienne, et un douzième pouvait arriver demain sans
    elle, en silence. Une spec de mutation, c'est une ligne qui attend un compte
    NON NUL après avoir planté la faute — on cherche cette ligne, par clé."""
    import pathlib
    import re
    source = pathlib.Path(__file__).read_text(encoding="utf-8")
    sans_mutation = [
        inv.cle for inv in INVARIANTS
        if not re.search(rf'_compter\(pg, "{re.escape(inv.cle)}"\) == [1-9]', source)
    ]
    assert not sans_mutation, (
        f"ces invariants n'ont jamais été vus ROUGES sur une faute fabriquée : "
        f"{', '.join(sans_mutation)}. Tant qu'on ne l'a pas vu rougir, on ne "
        "sait pas s'il regarde au bon endroit."
    )


# --------------------------------------------------------------------------- #
# `pas_de_texte_vide` — le vide contre le NULL (FRE-137)
# --------------------------------------------------------------------------- #

def test_pas_de_texte_vide_voit_une_case_vide(pg):
    """⚠️ CE QUE CETTE MUTATION PROUVE, c'est que l'invariant regarde les BONNES
    colonnes ET les bonnes TABLES. Il en a manqué les deux : sa liste comptait
    neuf colonnes là où il y en a dix-huit, puis une table sur trois — 12 119
    cases lui échappaient, dont 1 584 `coach_note` que le lot FROID aurait dû
    prendre. Un vérificateur qui sort vert pour la mauvaise raison est pire que
    pas de vérificateur.

    ⚠️ ET LA FAUTE SE PLANTE EN SQL DIRECT, jamais par l'API : depuis le lot 1,
    `vide_vaut_absence` convertit sur les trois chemins d'écriture. Passer par
    une route rendrait la spec VERTE pour la mauvaise raison — elle prouverait
    que la conversion marche, pas que l'invariant voit.

    ⚠️ ENFIN, LA COLONNE FAUTIVE CHANGE À CHAQUE LOT. Elle visait `coach_note`,
    puis `assistance` ; les lots FROID et TIÈDE leur ont posé un CHECK et la base
    a refusé l'INSERT. C'est le signe
    que la contrainte travaille — le jour où il ne reste plus de colonne
    migrable, c'est l'invariant qui n'aura plus de raison d'être."""
    ids = _semer_un_arbre(pg)
    assert _compter(pg, "pas_de_texte_vide") == 0
    # ⚠️ DEPUIS LE LOT CHAUD, PLUS AUCUNE COLONNE N'ACCEPTE `''` : la faute n'est
    # plus fabricable sans retirer la contrainte. On la retire DANS la
    # transaction du test — annulée à la sortie — comme
    # `test_dates_inversees_VOIT_encore_une_semaine_a_l_envers` le fait déjà.
    #
    # Un invariant qu'on cesse de tester parce que « ça ne peut plus arriver »
    # est un invariant mort : une contrainte peut sauter, par un DROP à la main
    # ou une base restaurée d'un dump antérieur. Ce jour-là, il est le seul à
    # pouvoir le dire.
    pg.execute(text("ALTER TABLE training_exercises DROP CONSTRAINT weight_non_vide"))
    pg.execute(text("ALTER TABLE training_exercises DROP CONSTRAINT rest_non_vide"))

    pg.execute(text(
        "INSERT INTO training_exercises (session_id, position, name, weight) "
        "VALUES (:s, 0, 'SQUAT', '')"), {"s": ids["seance"]})
    assert _compter(pg, "pas_de_texte_vide") == 1

    # Une case remplie d'ESPACES n'est pas davantage une valeur : `btrim` et non
    # `<> ''`, sinon la moitié de la dette resterait invisible.
    pg.execute(text(
        "INSERT INTO training_exercises (session_id, position, name, rest) "
        "VALUES (:s, 1, 'SQUAT', '   ')"), {"s": ids["seance"]})
    assert _compter(pg, "pas_de_texte_vide") == 2


def test_pas_de_texte_vide_voit_AUSSI_les_tables_de_BASE(pg):
    """⚠️ LE TROU QUE L'INVARIANT AVAIT. Les trois tables partagent la MÊME liste
    de champs (`prescription.CHAMPS_PRESCRIPTION`), parce qu'une trame et la
    semaine qu'elle produit portent la même prescription. Une règle posée sur
    `training_exercises` seule se rouvre donc par la GÉNÉRATION, qui recopie la
    trame dans la semaine."""
    ids = _semer_un_arbre(pg)
    # Cf. la spec précédente : plus aucune colonne n'accepte `''`, on retire donc
    # la contrainte dans la transaction — annulée à la fin du test.
    pg.execute(text("ALTER TABLE training_base_principles DROP CONSTRAINT weight_non_vide"))
    pg.execute(text("ALTER TABLE training_base_accessories DROP CONSTRAINT weight_non_vide"))

    avant = _compter(pg, "pas_de_texte_vide")
    pg.execute(text(
        "INSERT INTO training_base_principles (block_id, position, tier, name, weight) "
        "VALUES (:b, 0, 1, 'SQUAT', '')"), {"b": ids["bloc"]})
    apres = _compter(pg, "pas_de_texte_vide")
    assert apres > avant, "l'invariant ne voit pas training_base_principles"

    avant = apres
    pg.execute(text(
        "INSERT INTO training_base_accessories (block_id, position, day, name, weight) "
        "VALUES (:b, 0, 'Lundi', 'CURL', '')"), {"b": ids["bloc"]})
    assert _compter(pg, "pas_de_texte_vide") > avant, \
        "l'invariant ne voit pas training_base_accessories"


def test_pas_de_texte_vide_ignore_la_colonne_NOT_NULL(pg):
    """⚠️ `day` EST `NOT NULL` sur les accessoires : `''` y est le seul « rien »
    que la colonne accepte. Le compter ferait rougir l'invariant sur une forme
    qu'aucune migration ne peut corriger — et un invariant qui rougit pour rien
    finit par ne plus être lancé."""
    ids = _semer_un_arbre(pg)
    avant = _compter(pg, "pas_de_texte_vide")
    pg.execute(text(
        "INSERT INTO training_base_accessories (block_id, position, day, name) "
        "VALUES (:b, 0, '', 'CURL')"), {"b": ids["bloc"]})
    assert _compter(pg, "pas_de_texte_vide") == avant


def test_pas_de_texte_vide_ne_compte_pas_une_absence(pg):
    """⚠️ LA GARDE DE LA GARDE. Un invariant qui compterait aussi les `NULL`
    rougirait sur la forme qu'on veut ATTEINDRE — il serait vert le jour où la
    dette augmente, et rouge le jour où elle est payée."""
    ids = _semer_un_arbre(pg)
    # ⚠️ EN ÉCART : la ligne de principe porte des colonnes à `''` par DÉFAUT,
    # qui sont une dette réelle mais pas celle qu'on plante ici.
    avant = _compter(pg, "pas_de_texte_vide")
    pg.execute(text(
        "INSERT INTO training_exercises (session_id, position, name, weight, rest) "
        "VALUES (:s, 0, 'SQUAT', NULL, NULL)"), {"s": ids["seance"]})
    pg.execute(text(
        "INSERT INTO training_base_principles (block_id, position, tier, name, weight) "
        "VALUES (:b, 0, 1, 'SQUAT', NULL)"), {"b": ids["bloc"]})
    assert _compter(pg, "pas_de_texte_vide") == avant


# --------------------------------------------------------------------------- #
# `pas_de_mesure_a_zero` — le zéro qui joue le NULL (FRE-137, lot 4)
# --------------------------------------------------------------------------- #

def test_pas_de_mesure_a_zero_voit_un_poids_nul(pg):
    """⚠️ PERSONNE NE PÈSE ZÉRO KILO, et 28 fiches sur 70 le prétendaient. La
    cause est un `parseFloat(v) || 0` côté front : vider la case envoie `0`, et
    le serveur l'écrivait tel quel.

    La contrainte rend la faute infabricable — on la retire donc DANS la
    transaction du test, annulée à la sortie, comme
    `test_dates_inversees_VOIT_encore_une_semaine_a_l_envers` le fait déjà."""
    ids = _semer_un_arbre(pg)
    assert _compter(pg, "pas_de_mesure_a_zero") == 0
    pg.execute(text("ALTER TABLE athletes DROP CONSTRAINT weight_kg_positif"))

    pg.execute(text("UPDATE athletes SET weight_kg = 0 WHERE id = :a"), {"a": ids["athlete"]})
    assert _compter(pg, "pas_de_mesure_a_zero") == 1


def test_pas_de_mesure_a_zero_voit_un_1RM_a_zero(pg):
    """⚠️ ET C'EST LUI QUE L'INVARIANT GARDE VRAIMENT. Les deux mesures de corps
    ont un CHECK ; le 1RM vit dans un `jsonb` qu'aucune contrainte ne garde
    simplement. 59 fiches sur 70 portaient `chinUp: 0` — « non renseigné »
    déguisé en performance, et `tracking.py` fait `if one_rm else None`, ce qui
    confond les deux."""
    ids = _semer_un_arbre(pg)
    pg.execute(text(
        "UPDATE athletes SET current_one_rm = '{\"chinUp\": 0, \"squat\": 120}'::jsonb "
        "WHERE id = :a"), {"a": ids["athlete"]})
    assert _compter(pg, "pas_de_mesure_a_zero") == 1


def test_pas_de_mesure_a_zero_ne_compte_ni_l_absence_ni_une_vraie_valeur(pg):
    """⚠️ LA GARDE DE LA GARDE. Un invariant qui compterait les `NULL` rougirait
    sur la forme qu'on veut ATTEINDRE ; un qui compterait les clés absentes
    rougirait sur 70 fiches pour rien."""
    ids = _semer_un_arbre(pg)
    pg.execute(text(
        "UPDATE athletes SET weight_kg = 81, height_cm = NULL, "
        "current_one_rm = '{\"squat\": 120}'::jsonb WHERE id = :a"), {"a": ids["athlete"]})
    assert _compter(pg, "pas_de_mesure_a_zero") == 0


# --------------------------------------------------------------------------- #
# `privileges_du_role_applicatif` — le prix du choix « table par table » (FRE-151)
# --------------------------------------------------------------------------- #

def _semer_le_role_applicatif(pg) -> None:
    """Le rôle tel que `nidavellir/sql/brokkr_app.sql` le laisse : tout sauf le
    registre des migrations. `CREATE ROLE` est transactionnel — la fixture annule,
    le rôle disparaît avec elle."""
    pg.execute(text("CREATE ROLE brokkr_app NOLOGIN"))
    pg.execute(text("GRANT SELECT ON ALL TABLES IN SCHEMA public TO brokkr_app"))
    pg.execute(text("REVOKE SELECT ON schema_migrations FROM brokkr_app"))


def test_privileges_du_role_applicatif_ne_viole_rien_quand_la_liste_est_juste(pg):
    _semer_le_role_applicatif(pg)
    assert _compter(pg, "privileges_du_role_applicatif") == 0


def test_privileges_du_role_applicatif_voit_une_TABLE_OUBLIEE(pg):
    """⚠️ LA MUTATION QUI COMPTE, et la raison d'être de cet invariant. C'est
    exactement ce que produit une migration qui crée une table sans poser son
    `GRANT` : rien ne casse au déploiement, la table est simplement invisible à
    l'application, et le défaut sort au premier appel de la route — en 500,
    découvert par un coach."""
    _semer_le_role_applicatif(pg)
    pg.execute(text("REVOKE SELECT ON athletes FROM brokkr_app"))
    assert _compter(pg, "privileges_du_role_applicatif") == 1


def test_privileges_du_role_applicatif_voit_le_REGISTRE_OUVERT(pg):
    """⚠️ ET DANS L'AUTRE SENS. Une garde qui ne regarde que les manques laisse
    les excès passer : une application capable d'écrire `schema_migrations`
    pourrait faire rejouer une migration, ou en faire sauter une."""
    _semer_le_role_applicatif(pg)
    pg.execute(text("GRANT SELECT ON schema_migrations TO brokkr_app"))
    assert _compter(pg, "privileges_du_role_applicatif") == 1


def test_privileges_du_role_applicatif_ne_LEVE_PAS_sans_le_role(pg):
    """⚠️ SANS LA JOINTURE SUR `pg_roles`, `has_table_privilege` LÈVE sur un rôle
    inconnu : l'invariant ne rendrait plus un compte mais une trace, et le
    script entier s'arrêterait — sur toutes les bases où la bascule n'est pas
    encore faite, à commencer par le conteneur de test.

    Il vaut donc zéro tant que le rôle n'existe pas. Ce n'est pas un faux vert :
    l'existence du rôle est gardée ailleurs et bruyamment — un `DB_USER` qui ne
    correspond à rien empêche brokkr de se connecter, `/health/db` répond 503, et
    `make verifier` le dit. C'est la LISTE que celui-ci garde."""
    assert _compter(pg, "privileges_du_role_applicatif") == 0


def test_bornes_du_role_applicatif_voit_une_borne_ABSENTE(pg):
    """⚠️ LA RÉGRESSION DU 09/09, refabriquée. Le service est passé sous un rôle
    neuf, qui ne portait aucune borne : la production a tourné sans plafond de
    requête, et `bornes_de_session` est resté vert — il lit la connexion qu'on
    lui donne, sous un AUTRE rôle."""
    pg.execute(text("CREATE ROLE brokkr_app NOLOGIN"))
    assert _compter(pg, "bornes_du_role_applicatif") == 3, "un rôle nu n'en porte aucune"

    pg.execute(text("ALTER ROLE brokkr_app SET statement_timeout = '15s'"))
    pg.execute(text("ALTER ROLE brokkr_app SET lock_timeout = '5s'"))
    assert _compter(pg, "bornes_du_role_applicatif") == 1, "il en manque encore une"

    pg.execute(text("ALTER ROLE brokkr_app SET timezone = 'Europe/Paris'"))
    assert _compter(pg, "bornes_du_role_applicatif") == 0


def test_bornes_du_role_applicatif_voit_une_borne_FAUSSE(pg):
    """Pas seulement l'absence : une valeur qui a dérivé. C'est le cas d'un
    `ALTER ROLE` joué à la main avec un chiffre approximatif."""
    pg.execute(text("CREATE ROLE brokkr_app NOLOGIN"))
    pg.execute(text("ALTER ROLE brokkr_app SET statement_timeout = '30s'"))
    pg.execute(text("ALTER ROLE brokkr_app SET lock_timeout = '5s'"))
    pg.execute(text("ALTER ROLE brokkr_app SET timezone = 'Europe/Paris'"))
    assert _compter(pg, "bornes_du_role_applicatif") == 1


def test_bornes_du_role_applicatif_ne_compte_rien_sans_le_role(pg):
    """Hors production ce rôle n'existe pas : trois manques y seraient du bruit,
    et un script qui crie au loup cesse d'être lancé."""
    assert _compter(pg, "bornes_du_role_applicatif") == 0


def test_pas_de_sentinelle_de_repos_voit_les_trois_tables(pg):
    """FRE-169. La faute se plante en SQL nu, contrainte retirée dans la
    transaction du test — comme `test_pas_de_texte_vide_voit_une_case_vide` :
    depuis la migration, la base refuse `-1`, et un invariant qu'on cesse de
    tester parce que « ça ne peut plus arriver » est un invariant mort."""
    ids = _semer_un_arbre(pg)
    assert _compter(pg, "pas_de_sentinelle_de_repos") == 0
    for table in ("training_exercises", "training_base_principles", "training_base_accessories"):
        pg.execute(text(f"ALTER TABLE {table} DROP CONSTRAINT rest_sans_sentinelle"))
    pg.execute(text(
        "INSERT INTO training_exercises (session_id, position, name, rest) "
        "VALUES (:s, 5, 'SQUAT', '-1')"), {"s": ids["seance"]})
    assert _compter(pg, "pas_de_sentinelle_de_repos") == 1
    pg.execute(text(
        "INSERT INTO training_exercises (session_id, position, name, rest) "
        "VALUES (:s, 6, 'SQUAT', 'Free')"), {"s": ids["seance"]})
    assert _compter(pg, "pas_de_sentinelle_de_repos") == 2


def test_fiche_dans_la_structure_de_son_coach_voit_une_fiche_egaree(pg):
    """FRE-13. La faute : une fiche SCAPPULIFT coachée par un coach French Forge
    — elle n'apparaîtrait dans la liste d'AUCUNE structure de son coach."""
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('c-ff', 'c@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid, structure) VALUES ('c-ff', 'french-forge')"))
    pg.execute(text("INSERT INTO athletes (legacy_id, coach_uid, structure) "
                    "VALUES ('a-ok', 'c-ff', 'french-forge')"))
    assert _compter(pg, "fiche_dans_la_structure_de_son_coach") == 0
    pg.execute(text("INSERT INTO athletes (legacy_id, coach_uid, structure) "
                    "VALUES ('a-egaree', 'c-ff', 'scappulift')"))
    assert _compter(pg, "fiche_dans_la_structure_de_son_coach") == 1



def test_lignes_dans_la_structure_de_l_athlete_voit_une_ligne_egaree(pg):
    """FRE-13, 19/09. La faute : UNE ligne dont la structure n'est plus celle de
    son athlète — un athlète qui a changé de structure, ou un trigger perdu.
    Posée par un `UPDATE` de la seule colonne `structure`, que le trigger ne
    surveille pas ; l'entrée SCAPPULIFT existe, donc la clé l'accepte."""
    ids = _semer_un_arbre(pg)
    assert _compter(pg, "lignes_dans_la_structure_de_l_athlete") == 0
    pg.execute(text("INSERT INTO library_entries (structure, category, name) "
                    "VALUES ('scappulift', 'exercices', 'SQUAT') ON CONFLICT DO NOTHING"))
    pg.execute(text("INSERT INTO training_exercises (session_id, position, name) "
                    "VALUES (:s, 7, 'SQUAT')"), {"s": ids["seance"]})
    pg.execute(text("UPDATE training_exercises SET structure = 'scappulift' "
                    "WHERE session_id = :s AND position = 7"), {"s": ids["seance"]})
    assert _compter(pg, "lignes_dans_la_structure_de_l_athlete") == 1
