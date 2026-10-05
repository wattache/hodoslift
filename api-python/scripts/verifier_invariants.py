"""LES INVARIANTS QUE LES COMMENTAIRES AFFIRMENT — vérifiés sur la vraie base.

⚠️ POURQUOI CE SCRIPT EXISTE (FRE-143). Le code de ce projet est très commenté,
et c'est un choix qui se défend : un développeur seul a besoin de retrouver
POURQUOI une décision a été prise. Mais deux natures de commentaire s'y mêlent,
et une seule vieillit bien.

  * « on a écarté X parce que Y » — une DÉCISION. Elle reste vraie, datée, et
    elle vaut ce que valait le raisonnement. Rien à vérifier.
  * « la base ne porte plus aucun groupe sans nature » — un ÉTAT DE LA DONNÉE.
    Celui-là est un TEST QUI N'A PAS ÉTÉ ÉCRIT. Il était vrai le jour de la
    reprise, il se périme en silence à la première écriture qui l'ignore, et
    rien ne prévient : ni `tsc`, ni pytest, ni `make schema-verifier`, qui ne
    compare que des noms de colonnes.

Ce script est l'endroit où ces affirmations deviennent vérifiables. La règle qui
va avec : **un commentaire qui affirme un état de la donnée cite l'invariant qui
le garde, et c'est l'invariant qui fait foi.**

CE QU'IL N'EST PAS
  · Pas `verifier_schema.py`, qui compare la FORME (tables, colonnes) au fichier
    de référence. Ici on interroge le CONTENU.
  · Pas un test. Il lui faut une vraie base ; pytest doit tourner sans
    identifiants. Le complément qui court partout, ce sont les specs de
    `tests/test_invariants.py`, qui vérifient les mêmes règles sur des lignes
    fabriquées — elles attrapent une RÉGRESSION DE CODE, jamais une dérive de
    la donnée déjà écrite. Les deux sont nécessaires.

LECTURE SEULE, donc sans garde-fou `_cible` : un dry-run peut viser n'importe
quelle base, c'est la règle du projet. À jouer contre la production, ou contre
le bac à sable après l'avoir rempli.

    uv run python scripts/verifier_invariants.py
    uv run python scripts/verifier_invariants.py --verbeux   # les lignes fautives

⚠️ UN INVARIANT ROUGE N'EST PAS UN BOGUE DE CE SCRIPT. C'est la leçon de
`verifier_schema.py`, qui a crié au loup pendant des semaines sur un schéma
juste : une vérification qui se trompe se fait ignorer. Chaque invariant ci-
dessous a donc été mesuré sur la production avant d'être écrit, et porte la
requête de RÉPARATION quand il est violé.
"""

from __future__ import annotations

import argparse
import pathlib
import sys
from dataclasses import dataclass, field
from typing import Literal

# Lancé depuis `scripts/` par `make` : la racine n'est pas sur le chemin
# d'import, contrairement à pytest qui l'y met.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from sqlalchemy import create_engine, text  # noqa: E402

from app.socle.db import BORNES_DU_ROLE, _resolve_url  # noqa: E402

@dataclass(frozen=True)
class Invariant:
    """Une affirmation qu'un commentaire porte, et la requête qui la vérifie.

    `compte` doit rendre UNE ligne, UNE colonne : le nombre de violations. Zéro
    veut dire que l'affirmation tient.

    `exemples` (facultatif) rend les lignes fautives, pour `--verbeux` : un
    compte tout seul dit qu'il y a un problème, pas où aller le regarder.
    """

    cle: str
    affirmation: str
    #: Où le commentaire vit. C'est le lien qu'on suit quand l'invariant rougit,
    #: et c'est aussi ce qui rend la dette trouvable depuis le code.
    source: str
    compte: str
    exemples: str | None = None
    reparation: str | None = None
    #: Un invariant que la production viole DÉJÀ au moment où on l'écrit. Il
    #: rougit, et c'est voulu — mais il ne doit pas faire échouer le script tant
    #: que la reprise n'est pas faite, sinon plus personne ne le lance.
    connu_viole: int = 0
    connu_ticket: str = ""
    #: ⚠️ UN INVARIANT QUI NE PEUT PAS TRANCHER (FRE-154). Il compte quelque chose
    #: de vrai, mais ce qu'il compte a une cause LÉGITIME qu'il ne sait pas
    #: distinguer de la faute — faute d'horodatage, typiquement. Il s'affiche,
    #: il ne fait jamais échouer. Sans ce statut, il rougirait tous les jours
    #: pour rien, et c'est exactement ce qui fait cesser de lancer le script.
    informatif: bool = False
    tags: tuple[str, ...] = field(default_factory=tuple)


Verdict = Literal["vert", "informatif", "connu", "rompu", "tolerance_perimee"]


def verdict(inv: Invariant, violations: int, strict: bool = False) -> Verdict:
    """Ce que vaut un compte de violations pour cet invariant.

    ⚠️ EXTRAITE DE `main` POUR ÊTRE ÉPROUVÉE (FRE-154). La logique vivait dans
    la boucle du rapport, contre une vraie base, donc hors de portée de pytest —
    et elle avait un trou : une tolérance dont la dette était PAYÉE (compte à
    zéro, `connu_viole` encore posé) devenait invisible, la boucle faisant
    `continue` sur zéro. Le chiffre restait dans le fichier indéfiniment, prêt
    à absorber la prochaine vraie violation sans un mot.

    `tolerance_perimee` est donc un ÉCHEC : la dette est payée, retire le
    chiffre. C'est le seul verdict qui échoue sur un compte de zéro."""
    if violations == 0:
        return "tolerance_perimee" if inv.connu_viole else "vert"
    if inv.informatif:
        return "informatif"
    if violations <= inv.connu_viole and not strict:
        return "connu"
    return "rompu"


def _sql_bornes(colonnes: str) -> str:
    """Le SQL de `bornes_de_session`, DÉRIVÉ de `BORNES_DU_ROLE` (FRE-154).

    ⚠️ IL ÉTAIT RECOPIÉ EN DUR, quatrième copie de la même règle (`app/socle/db.py`,
    la migration, `tests/conftest.py`, et ici) — pendant que `BORNES_DU_ROLE`
    était importé et jamais lu. C'est le défaut que ce projet nomme « règle
    dupliquée = calcul dupliqué », dans l'outil censé le surveiller."""
    lignes = " UNION ALL ".join(
        f"SELECT '{reglage}' AS reglage, current_setting('{reglage}') AS lu, "
        f"'{attendu}' AS attendu"
        for reglage, attendu in BORNES_DU_ROLE.items())
    return f"SELECT {colonnes} FROM ({lignes}) b WHERE b.lu <> b.attendu"


INVARIANTS: list[Invariant] = [
    # ----------------------------------------------------------- plomberie
    # ⚠️ CET INVARIANT NAÎT D'UNE PANNE QUE J'AI CAUSÉE, et sa PREMIÈRE rédaction
    # l'aurait laissée passer. Elle lisait `pg_roles.rolconfig` — le catalogue —
    # qui contenait bel et bien les trois réglages : elle serait sortie VERTE
    # pendant que la production tournait sans bornes, parce que le pooler ne les
    # propageait pas jusqu'à la session.
    #
    # Celui-ci lit `current_setting`, c'est-à-dire ce que la SESSION reçoit.
    #
    # ⚠️ CE QU'IL NE GARDE PAS, ET QU'IL PRÉTENDAIT GARDER (FRE-154) : le choix
    # d'endpoint de la PRODUCTION. Il lit `current_setting` sur la connexion
    # qu'ON LUI DONNE — celle du `.env` du poste, qui vise l'hôte direct — donc
    # il est vert par construction depuis un poste de dev, quoi que Cloud Run
    # résolve. Il garde l'endpoint qu'on lui donne, pas celui de la prod.
    #
    # Le vrai chemin est ailleurs : `/health/db` rend les bornes telles que
    # BROKKR les reçoit, et `make verifier` les compare après chaque déploiement.
    # C'est ce couple-là qui garde `nidavellir/brokkr.tf`. Celui-ci garde le
    # RÔLE : qu'une base restaurée d'un dump, qui ne porte pas les `ALTER ROLE`,
    # ne passe pas pour saine.
    Invariant(
        cle="bornes_de_session",
        affirmation="la connexion qu'on lui donne REÇOIT ses bornes "
                    "(statement_timeout, lock_timeout, fuseau) — pas seulement "
                    "le catalogue",
        source="app/socle/db.py — BORNES_DU_ROLE ; "
               "docs/migrations/2026-09-09_les_bornes_de_session_vivent_sur_le_role.sql",
        compte=_sql_bornes("count(*)"),
        exemples=_sql_bornes("b.reglage, b.lu AS recu, b.attendu"),
        reparation=(
            "la migration `…_les_bornes_de_session_vivent_sur_le_role.sql` — un\n"
            "   -- `ALTER ROLE` ne survit pas à un `pg_restore`.\n"
            "   -- ⚠️ NE PAS remettre ces bornes dans `connect_args` : le pooler\n"
            "   -- REFUSE le paramètre `options` à l'ouverture, et tout tombe (08/09).\n"
            "   -- Et pour la PRODUCTION, c'est `make verifier` qui dit si brokkr\n"
            "   -- les reçoit — pas ce script."
        ),
        tags=("plomberie",),
    ),
    # ----------------------------------------------------------------- groupes
    # ⚠️ CET INVARIANT EST NÉ ROUGE, et c'est exactement ce qui justifie le
    # script. `app/entrainement/prescription.py` affirmait « la base ne porte plus de None
    # sur un groupe », vrai le 29/08 au soir, faux depuis le 01/09.
    Invariant(
        cle="groupe_sans_nature",
        affirmation="un groupe de lignes liées porte toujours sa nature "
                    "(biset / dropset)",
        source="app/entrainement/prescription.py — NATURE_PAR_DEFAUT ; "
               "app/entrainement/metier_training_lines.py — propager_la_nature ; "
               "docs/migrations/2026-09-21_la_nature_suit_le_groupe.sql",
        compte="""
            SELECT (SELECT count(*) FROM training_exercises
                     WHERE coalesce(group_id, '') <> '' AND group_kind IS NULL)
                 + (SELECT count(*) FROM training_base_accessories
                     WHERE coalesce(group_id, '') <> '' AND group_kind IS NULL)
        """,
        exemples="""
            SELECT 'training_exercises' AS table_, id::text, group_id, name
              FROM training_exercises
             WHERE coalesce(group_id, '') <> '' AND group_kind IS NULL
            UNION ALL
            SELECT 'training_base_accessories', id::text, group_id, name
              FROM training_base_accessories
             WHERE coalesce(group_id, '') <> '' AND group_kind IS NULL
             ORDER BY 1, 3
        """,
        reparation=(
            "docs/migrations/2026-09-21_la_nature_suit_le_groupe.sql\n"
            "   -- ⚠️ UNE MIGRATION, PLUS UN `UPDATE` COLLÉ ICI (FRE-145). Le\n"
            "   -- geste avait déjà été fait le 29/08 et l'écart était revenu\n"
            "   -- trois jours plus tard : une reprise qui ne laisse pas de\n"
            "   -- trace se rejoue sans qu'on sache si elle a servi. Depuis\n"
            "   -- FRE-133, `schema_migrations` sait ce qui est passé.\n"
            "   -- ⚠️ SI L'ÉCART REVIENT APRÈS CETTE MIGRATION, UN CHEMIN\n"
            "   -- D'ÉCRITURE RESTE OUVERT : le chercher avant de rejouer un\n"
            "   -- UPDATE. Deux le posent — `normaliser_groupes` pour les\n"
            "   -- écritures en masse, `propager_la_nature` pour le grain de\n"
            "   -- la ligne ; une reprise seule ne tient pas s'il en existe un\n"
            "   -- troisième."
        ),
        # ⚠️ LA TOLÉRANCE TOMBE À ZÉRO DANS LE MÊME COMMIT QUE LES DEUX
        # CORRECTIFS, et cet invariant criera donc jusqu'à ce que la migration
        # ci-dessus soit jouée. C'est voulu : la cause est fermée, il ne reste
        # que la reprise, et un chiffre toléré ici la ferait oublier — c'est
        # exactement comme ça que la précédente s'est perdue.
        tags=("groupes",),
    ),
    Invariant(
        cle="nature_sans_groupe",
        affirmation="une ligne SANS groupe ne porte pas de nature "
                    "(sinon l'écran croit à un groupe d'un seul membre)",
        source="app/entrainement/training_tree.py — `_sortie`, la nature sort résolue",
        compte="""
            SELECT (SELECT count(*) FROM training_exercises
                     WHERE coalesce(group_id, '') = '' AND group_kind IS NOT NULL)
                 + (SELECT count(*) FROM training_base_accessories
                     WHERE coalesce(group_id, '') = '' AND group_kind IS NOT NULL)
        """,
        tags=("groupes",),
    ),
    # ------------------------------------------------------------ bibliothèque
    # La clé étrangère de FRE-123 garantit que le nom EXISTE dans la
    # bibliothèque. Elle ne peut pas garantir qu'il s'agit d'un lift de
    # COMPÉTITION : Postgres ne référence pas un index unique partiel. C'est donc
    # brokkr qui le tient, et c'est ici qu'on le vérifie.
    Invariant(
        cle="pr_hors_lift_de_competition",
        affirmation="un record se tient sur un lift de compétition, "
                    "pas sur du renforcement",
        source="docs/postgres-schema.sql — athlete_prs.movement ; "
               "app/suivi/routes_prs.py",
        compte="""
            SELECT count(*) FROM athlete_prs p
             WHERE p.movement IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM library_entries l
                                WHERE l.category = 'exercices' AND l.structure = p.structure
                                  AND l.competition AND l.name = p.movement)
        """,
        exemples="""
            SELECT p.id::text, p.movement, p.reps, p.weight_kg
              FROM athlete_prs p
             WHERE p.movement IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM library_entries l
                                WHERE l.category = 'exercices' AND l.structure = p.structure
                                  AND l.competition AND l.name = p.movement)
        """,
        tags=("bibliothèque",),
    ),
    Invariant(
        cle="mouvement_de_competition_hors_lift",
        affirmation="on ne dispute que des lifts de compétition",
        source="docs/postgres-schema.sql — competition_movements.movement",
        compte="""
            SELECT count(*) FROM competition_movements cm
              JOIN competitions k ON k.id = cm.competition_id
             WHERE NOT EXISTS (SELECT 1 FROM library_entries l
                                WHERE l.category = 'exercices' AND l.structure = k.structure
                                  AND l.competition AND l.name = cm.movement)
        """,
        tags=("bibliothèque",),
    ),
    Invariant(
        cle="cles_de_1rm_inattendues",
        affirmation="`athletes.current_one_rm` ne porte que les sept lifts "
                    "connus de la table de correspondance",
        # ⚠️ CETTE TABLE EST DUPLIQUÉE ENTRE PYTHON ET TYPESCRIPT (FRE-136). Tant
        # qu'elle l'est, cet invariant est le seul endroit qui remarquerait
        # qu'une huitième clé est apparue d'un côté seulement.
        #
        # ⚠️ ET IL SE MET À JOUR AVEC LE CONTRAT, JAMAIS APRÈS. `benchPress` et
        # `deadlift` (FRE-147) l'auraient fait échouer à la PREMIÈRE écriture :
        # un invariant qu'on découvre rouge puis qu'on élargit pour se
        # débarrasser de lui a cessé de garder quoi que ce soit.
        source="app/suivi/routes_tracking.py — _ONE_RM_KEYS ; eitri/src/lib/constants.ts",
        compte="""
            SELECT count(*) FROM (
                SELECT DISTINCT k FROM athletes, jsonb_each(current_one_rm) e(k, v)
                 WHERE k NOT IN ('muscleUp', 'pullUp', 'chinUp', 'dip', 'squat',
                                 'benchPress', 'deadlift')
            ) inattendues
        """,
        exemples="""
            SELECT DISTINCT k AS cle FROM athletes, jsonb_each(current_one_rm) e(k, v)
             WHERE k NOT IN ('muscleUp', 'pullUp', 'chinUp', 'dip', 'squat',
                             'benchPress', 'deadlift')
        """,
        tags=("bibliothèque",),
    ),
    # ------------------------------------------------------------------- dates
    # ⚠️ AUCUN `CHECK` NE LES GARDE, contrairement aux événements et aux
    # compétitions qui en ont un depuis leur création. L'asymétrie n'est pas
    # voulue : elle est un oubli, et elle a laissé passer deux semaines.
    Invariant(
        cle="dates_inversees",
        affirmation="une semaine ou un bloc ne se termine pas avant d'avoir "
                    "commencé",
        source="docs/postgres-schema.sql — training_weeks, training_blocks "
               "(CHECK depuis FRE-138, comme calendar_events et competitions)",
        compte="""
            SELECT (SELECT count(*) FROM training_weeks  WHERE end_date < start_date)
                 + (SELECT count(*) FROM training_blocks WHERE end_date < start_date)
        """,
        exemples="""
            SELECT 'semaine' AS quoi, w.id::text, w.number::text, w.start_date, w.end_date
              FROM training_weeks w WHERE w.end_date < w.start_date
            UNION ALL
            SELECT 'bloc', b.id::text, b.number::text, b.start_date, b.end_date
              FROM training_blocks b WHERE b.end_date < b.start_date
        """,
        reparation=(
            "docs/migrations/2026-09-09_une_semaine_ne_finit_pas_avant_de_commencer.sql\n"
            "   -- Elle reprend les lignes ET pose le CHECK qui manquait. Depuis,\n"
            "   -- cet invariant ne peut plus que rester à zéro : la base refuse\n"
            "   -- l'état. Il reste ici comme TÉMOIN — s'il rougissait, c'est que\n"
            "   -- la contrainte a sauté, ce qui est une information en soi."
        ),
        # ⚠️ LA TOLÉRANCE TOMBE À 0 AVEC LA MIGRATION. La note d'avant supposait
        # « une année ou un mois mal saisi » : la donnée a démenti — 28 jours
        # exactement, deux fois, sur le seul `start_date`. Une hypothèse écrite
        # dans une note de réparation se lit comme un fait ; celle-là a failli
        # faire corriger à la main ce qu'un `end_date - 6` fait sans deviner.
        tags=("dates",),
    ),
    # ------------------------------------------------------------- rattachement
    # `programs.coach_uid` et `athletes.coach_uid` disent la même chose, et rien
    # dans la base ne les tient ensemble : c'est `reassign_coach` qui écrit les
    # deux, dans une seule transaction. Une troisième écriture qui n'en
    # connaîtrait qu'une les ferait diverger sans bruit.
    Invariant(
        cle="deux_verites_du_coach",
        affirmation="le coach d'un programme est celui de son athlète",
        source="app/personnes/routes_athletes.py — reassign_coach écrit les deux",
        compte="""
            SELECT count(*) FROM programs p
              JOIN athletes a ON a.id = p.athlete_id
             WHERE p.coach_uid <> a.coach_uid
        """,
        exemples="""
            SELECT p.id, a.first_name, a.last_name,
                   p.coach_uid AS sur_le_programme, a.coach_uid AS sur_la_fiche
              FROM programs p JOIN athletes a ON a.id = p.athlete_id
             WHERE p.coach_uid <> a.coach_uid
        """,
        tags=("rattachement",),
    ),
    Invariant(
        cle="emails_de_compte_en_double",
        affirmation="deux comptes ne partagent pas une adresse",
        # ⚠️ L'UNICITÉ A ÉTÉ RETIRÉE le 22/08 (FRE-77) : Firebase autorise deux
        # comptes sur une même adresse, et la contrainte ne produisait qu'un 500
        # sur `GET /users/me`. Mais DEUX lectures rapprochent encore par email —
        # l'ajout d'un co-éditeur de compétition et `POST /athletes/link`. Elles
        # deviendraient ambiguës le jour où un doublon apparaîtrait, et c'est ce
        # jour-là qu'on veut être prévenu.
        source="docs/postgres-schema.sql — users.email ; "
               "app/personnes/routes_athletes.py — _FIND_UNLINKED_SQL",
        compte="""
            SELECT count(*) FROM (
                SELECT lower(email) FROM users WHERE btrim(email) <> ''
                 GROUP BY 1 HAVING count(*) > 1
            ) doublons
        """,
        exemples="""
            SELECT lower(email) AS email, count(*) AS comptes,
                   string_agg(uid, ', ') AS uids
              FROM users WHERE btrim(email) <> '' GROUP BY 1 HAVING count(*) > 1
        """,
        tags=("rattachement",),
    ),
    # -------------------------------------------------------------- projection
    # `training_sets.athlete_id` et `.program_id` sont du TEXTE recopié, sans
    # clé étrangère : ce sont des `legacy_id`, et la table est reconstruite
    # chaque nuit. Un orphelin signifie que le rebuild n'a pas tourné depuis une
    # suppression, ou qu'il a échoué à mi-course.
    Invariant(
        cle="projection_orpheline",
        affirmation="chaque ligne de `training_sets` se rattache à un athlète "
                    "et à un programme qui existent",
        source="docs/postgres-schema.sql — training_sets (ids LEGACY, sans FK)",
        compte="""
            SELECT count(*) FROM training_sets s
             WHERE NOT EXISTS (SELECT 1 FROM athletes a WHERE a.legacy_id = s.athlete_id)
                OR NOT EXISTS (SELECT 1 FROM programs p WHERE p.id = s.program_id)
        """,
        exemples="""
            SELECT s.athlete_id, s.program_id, count(*) AS lignes
              FROM training_sets s
             WHERE NOT EXISTS (SELECT 1 FROM athletes a WHERE a.legacy_id = s.athlete_id)
                OR NOT EXISTS (SELECT 1 FROM programs p WHERE p.id = s.program_id)
             GROUP BY 1, 2
        """,
        reparation="uv run python -m scripts.etl_training_sets --apply",
        tags=("projection",),
    ),
    # ⚠️ INFORMATIF, ET C'EST UNE LIMITE MESURÉE, PAS UN RENONCEMENT (FRE-154).
    # La projection se reconstruit chaque nuit à 03:30. Tout RPE saisi APRÈS est
    # donc absent jusqu'au lendemain — légitimement — et rien dans la donnée ne
    # distingue « saisi aujourd'hui » de « le job n'a pas tourné » :
    # `training_exercises` n'a pas d'horodatage. Cet invariant rougissait
    # DONC TOUS LES JOURS en journée, ce qui est la définition d'un vérificateur
    # qui crie au loup — dans le script écrit contre ça.
    #
    # Le signal « le job n'a pas tourné » vit déjà au bon endroit : le Cron
    # Monitor Sentry. Celui-ci rend le compte du jour, pour information.
    Invariant(
        cle="realise_hors_projection",
        affirmation="toute ligne PORTANT UNE TRACE de réalisation figure dans "
                    "la projection — hors la saisie du jour, que le rebuild "
                    "nocturne n'a pas encore vue",
        source="app/suivi/routes_tracking.py — _TRACE ; nidavellir/analytics.tf",
        # ⚠️ MÊME FILTRE QUE L'ETL, `coalesce(btrim(name), '') <> ''`. L'ETL
        # écarte les noms vides ET nuls ; la première rédaction ne filtrait que
        # `IS NOT NULL`, et une ligne à `name = ''` portant un RPE aurait été
        # comptée violation À JAMAIS, qu'aucun rebuild ne pouvait résorber. Le
        # vide et le nul confondus à une frontière — dans l'outil qui les traque.
        compte="""
            SELECT count(*) FROM training_exercises e
             WHERE coalesce(btrim(e.name), '') <> ''
               AND (e.felt_rpe IS NOT NULL OR e.felt_rpe_by_set IS NOT NULL)
               AND NOT EXISTS (SELECT 1 FROM training_sets s WHERE s.exercise_id = e.id)
        """,
        reparation="uv run python -m scripts.etl_training_sets --apply",
        informatif=True,
        tags=("projection",),
    ),

    # ⚠️ CELUI-CI EST LE PRIX D'UN CHOIX, ET IL EST OBLIGATOIRE (FRE-151). Les
    # privilèges du rôle applicatif sont accordés TABLE PAR TABLE
    # (`nidavellir/sql/brokkr_app.sql`), et non par `ON ALL TABLES` avec des
    # privilèges par défaut. Décision assumée : le droit se lit alors dans un
    # fichier, sans interroger la base.
    #
    # Mais une migration qui crée une table et oublie son `GRANT` ne casse RIEN
    # au déploiement : elle rend la table invisible à l'application, et le défaut
    # sort au premier appel de la route concernée, en 500, découvert par un
    # coach. Une consigne ne garde pas ça — celle-ci non plus, sans ce compte.
    #
    # ⚠️ `schema_migrations` EST EXCLUE EXPRÈS, et c'est la seule. Une application
    # capable de réécrire le registre des migrations pourrait en faire rejouer
    # une, ou en faire sauter une. Elle n'appartient qu'à `scripts/migrer.py`.
    # Si cette table venait à recevoir le droit, l'invariant le compte AUSSI :
    # une garde qui ne regarde que dans un sens laisse l'autre ouvert.
    Invariant(
        cle="privileges_du_role_applicatif",
        affirmation="chaque relation de `public` est lisible et écrivable par le "
                    "rôle applicatif — sauf `schema_migrations`, qui ne l'est par "
                    "aucun des deux",
        source="nidavellir/sql/brokkr_app.sql",
        # ⚠️ LA JOINTURE SUR `pg_roles` N'EST PAS DE L'ORNEMENT : sans elle,
        # `has_table_privilege` LÈVE quand le rôle n'existe pas, et l'invariant
        # ne rendrait plus un compte mais une trace. Avec elle, il rend zéro —
        # il n'y a pas de privilège à juger tant qu'il n'y a pas de rôle.
        compte="""
            SELECT count(*) FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
              JOIN pg_roles r ON r.rolname = 'brokkr_app'
             WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v')
               AND (c.relname = 'schema_migrations')
                <> (NOT has_table_privilege(r.oid, c.oid, 'SELECT'))
        """,
        exemples="""
            SELECT c.relname,
                   has_table_privilege(r.oid, c.oid, 'SELECT') AS peut_lire
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              JOIN pg_roles r ON r.rolname = 'brokkr_app'
             WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v')
               AND (c.relname = 'schema_migrations')
                <> (NOT has_table_privilege(r.oid, c.oid, 'SELECT'))
        """,
        reparation=(
            "GRANT SELECT, INSERT, UPDATE, DELETE ON <la table> TO brokkr_app;\n"
            "   -- et l'ajouter à `nidavellir/sql/brokkr_app.sql`, qui est la\n"
            "   -- liste de référence. Une migration qui crée une table doit\n"
            "   -- porter son GRANT — `tests/test_migrer.py` le refuse sinon."
        ),
        # ⚠️ IL GARDE LA LISTE, PAS L'EXISTENCE DU RÔLE, et il faut le dire :
        # tant que `brokkr_app` n'existe pas, cet invariant vaut zéro. Ce n'est
        # pas le faux vert de FRE-154, parce que l'existence du rôle est gardée
        # ailleurs, et bruyamment : un `DB_USER` qui ne correspond à aucun rôle
        # empêche brokkr de se connecter du tout — `/health/db` répond 503 et
        # `make verifier` le dit après le déploiement. Un rôle absent ne passe
        # donc pas inaperçu ; une TABLE absente de la liste, si.
        tags=("securite",),
    ),

    # ⚠️ LE PENDANT DE `bornes_de_session`, POUR LE RÔLE QUI SERT LA PRODUCTION
    # (FRE-151). Celui-là lit `current_setting` sur la connexion qu'on lui donne
    # — donc sous `brokkr`, depuis un poste. Il est resté VERT le 09/09 pendant
    # que la production tournait sans plafond de requête : le service venait de
    # passer sous `brokkr_app`, un rôle neuf qui ne portait aucune borne.
    #
    # Celui-ci regarde le CATALOGUE — ce que le rôle applicatif porte, quel que
    # soit le rôle qui pose la question. C'est la seule façon de le voir AVANT le
    # déploiement : `make verifier`, qui l'a rattrapé, ne parle qu'après.
    Invariant(
        cle="bornes_du_role_applicatif",
        affirmation="le rôle que sert la production porte les trois bornes de "
                    "session dans son catalogue",
        source="app/socle/db.py — BORNES_DU_ROLE ; "
               "docs/migrations/2026-09-09_le_role_applicatif_porte_les_bornes.sql",
        # ⚠️ LA JOINTURE SUR `pg_roles` REND ZÉRO là où le rôle n'existe pas — bac
        # à sable, pytest, poste de dev — au lieu de compter trois manques qui
        # n'auraient aucun sens hors production.
        compte="""
            SELECT count(*) FROM pg_roles r,
                 unnest(ARRAY['statement_timeout=15s', 'lock_timeout=5s',
                              'TimeZone=Europe/Paris']) AS attendu
             WHERE r.rolname = 'brokkr_app'
               AND NOT (coalesce(r.rolconfig, ARRAY[]::text[]) @> ARRAY[attendu])
        """,
        exemples="""
            SELECT attendu AS borne_absente, r.rolconfig AS portees
              FROM pg_roles r,
                   unnest(ARRAY['statement_timeout=15s', 'lock_timeout=5s',
                                'TimeZone=Europe/Paris']) AS attendu
             WHERE r.rolname = 'brokkr_app'
               AND NOT (coalesce(r.rolconfig, ARRAY[]::text[]) @> ARRAY[attendu])
        """,
        reparation=(
            "docs/migrations/2026-09-09_le_role_applicatif_porte_les_bornes.sql\n"
            "   -- puis une NOUVELLE connexion : un `ALTER ROLE` ne change rien\n"
            "   -- aux backends que Cloud Run tient déjà ouverts."
        ),
        tags=("securite", "plomberie"),
    ),
    # ------------------------------------------------ le vide contre le NULL
    # ⚠️ CET INVARIANT PORTE UNE DETTE QUI SE PAIE PAR LOTS (FRE-137), et c'est
    # exactement ce pour quoi `connu_viole` existe. Il rougit aujourd'hui, il
    # doit rougir — mais il ne fait pas échouer le script tant que les
    # migrations ne sont pas jouées.
    #
    # ⚠️ ET C'EST LUI QUI PORTE L'ÉTAT, PAS UN COMMENTAIRE. Les chiffres de
    # FRE-137 dataient du 06/09 : ils annonçaient 9 colonnes concernées, il y en
    # a dix-huit, et l'un d'eux se lisait « aucun NULL » là où il fallait lire
    # « non relevé ». Un compte gravé dans le code aurait vieilli pareil.
    #
    # ⚠️ LE CHIFFRE DE `connu_viole` DESCEND À CHAQUE LOT, et le script refuse de
    # le laisser traîner : une tolérance dont la dette est payée sort en
    # `tolerance_perimee`, c'est-à-dire un ÉCHEC. On ne peut donc pas oublier de
    # la retirer.
    Invariant(
        cle="pas_de_texte_vide",
        affirmation="une absence s'écrit `NULL` et jamais `''` — une seule "
                    "façon de dire « rien », sur les TROIS tables de lignes",
        source="app/entrainement/prescription.py — vide_vaut_absence ; "
               "docs/migrations/2026-09-11_le_vide_n_est_pas_une_valeur_lot_*.sql",
        compte="""
            SELECT (SELECT count(*) FILTER (WHERE btrim(format) = '')
                     + count(*) FILTER (WHERE btrim(cluster_mode) = '')
                     + count(*) FILTER (WHERE btrim(cluster_rest) = '')
                     + count(*) FILTER (WHERE btrim(tempo) = '')
                     + count(*) FILTER (WHERE btrim(sets) = '')
                     + count(*) FILTER (WHERE btrim(reps) = '')
                     + count(*) FILTER (WHERE btrim(weight) = '')
                     + count(*) FILTER (WHERE btrim(assistance) = '')
                     + count(*) FILTER (WHERE btrim(aimed_rpe) = '')
                     + count(*) FILTER (WHERE btrim(rest) = '')
                     + count(*) FILTER (WHERE btrim(reps_done) = '')
                     + count(*) FILTER (WHERE btrim(weight_done) = '')
                     + count(*) FILTER (WHERE btrim(rest_actual) = '')
                     + count(*) FILTER (WHERE btrim(felt_rpe) = '')
                     + count(*) FILTER (WHERE btrim(athlete_feedback) = '')
                     + count(*) FILTER (WHERE btrim(coach_note) = '')
                     + count(*) FILTER (WHERE btrim(link) = '')
                     + count(*) FILTER (WHERE btrim(group_id) = '')
                     + count(*) FILTER (WHERE btrim(increment) = '')
                     + count(*) FILTER (WHERE btrim(name) = '')
                      FROM training_exercises)
                 + (SELECT count(*) FILTER (WHERE btrim(format) = '')
                     + count(*) FILTER (WHERE btrim(cluster_mode) = '')
                     + count(*) FILTER (WHERE btrim(cluster_rest) = '')
                     + count(*) FILTER (WHERE btrim(tempo) = '')
                     + count(*) FILTER (WHERE btrim(sets) = '')
                     + count(*) FILTER (WHERE btrim(reps) = '')
                     + count(*) FILTER (WHERE btrim(weight) = '')
                     + count(*) FILTER (WHERE btrim(assistance) = '')
                     + count(*) FILTER (WHERE btrim(aimed_rpe) = '')
                     + count(*) FILTER (WHERE btrim(rest) = '')
                     + count(*) FILTER (WHERE btrim(coach_note) = '')
                     + count(*) FILTER (WHERE btrim(increment) = '')
                     + count(*) FILTER (WHERE btrim(name) = '')
                      FROM training_base_principles)
                 + (SELECT count(*) FILTER (WHERE btrim(format) = '')
                     + count(*) FILTER (WHERE btrim(cluster_mode) = '')
                     + count(*) FILTER (WHERE btrim(cluster_rest) = '')
                     + count(*) FILTER (WHERE btrim(tempo) = '')
                     + count(*) FILTER (WHERE btrim(sets) = '')
                     + count(*) FILTER (WHERE btrim(reps) = '')
                     + count(*) FILTER (WHERE btrim(weight) = '')
                     + count(*) FILTER (WHERE btrim(assistance) = '')
                     + count(*) FILTER (WHERE btrim(aimed_rpe) = '')
                     + count(*) FILTER (WHERE btrim(rest) = '')
                     + count(*) FILTER (WHERE btrim(coach_note) = '')
                     + count(*) FILTER (WHERE btrim(increment) = '')
                     + count(*) FILTER (WHERE btrim(group_id) = '')
                     + count(*) FILTER (WHERE btrim(name) = '')
                      FROM training_base_accessories)
        """,
        exemples="""
            SELECT 'training_exercises' AS t, 'format' AS colonne, count(*) AS vides FROM training_exercises WHERE btrim(format) = ''
            UNION ALL
            SELECT 'training_exercises' AS t, 'cluster_mode' AS colonne, count(*) AS vides FROM training_exercises WHERE btrim(cluster_mode) = ''
            UNION ALL
            SELECT 'training_exercises' AS t, 'cluster_rest' AS colonne, count(*) AS vides FROM training_exercises WHERE btrim(cluster_rest) = ''
            UNION ALL
            SELECT 'training_exercises' AS t, 'tempo' AS colonne, count(*) AS vides FROM training_exercises WHERE btrim(tempo) = ''
            UNION ALL
            SELECT 'training_exercises' AS t, 'sets' AS colonne, count(*) AS vides FROM training_exercises WHERE btrim(sets) = ''
            UNION ALL
            SELECT 'training_exercises' AS t, 'reps' AS colonne, count(*) AS vides FROM training_exercises WHERE btrim(reps) = ''
            UNION ALL
            SELECT 'training_exercises' AS t, 'weight' AS colonne, count(*) AS vides FROM training_exercises WHERE btrim(weight) = ''
            UNION ALL
            SELECT 'training_exercises' AS t, 'assistance' AS colonne, count(*) AS vides FROM training_exercises WHERE btrim(assistance) = ''
            UNION ALL
            SELECT 'training_exercises' AS t, 'aimed_rpe' AS colonne, count(*) AS vides FROM training_exercises WHERE btrim(aimed_rpe) = ''
            UNION ALL
            SELECT 'training_exercises' AS t, 'rest' AS colonne, count(*) AS vides FROM training_exercises WHERE btrim(rest) = ''
            UNION ALL
            SELECT 'training_exercises' AS t, 'reps_done' AS colonne, count(*) AS vides FROM training_exercises WHERE btrim(reps_done) = ''
            UNION ALL
            SELECT 'training_exercises' AS t, 'weight_done' AS colonne, count(*) AS vides FROM training_exercises WHERE btrim(weight_done) = ''
            UNION ALL
            SELECT 'training_exercises' AS t, 'rest_actual' AS colonne, count(*) AS vides FROM training_exercises WHERE btrim(rest_actual) = ''
            UNION ALL
            SELECT 'training_exercises' AS t, 'felt_rpe' AS colonne, count(*) AS vides FROM training_exercises WHERE btrim(felt_rpe) = ''
            UNION ALL
            SELECT 'training_exercises' AS t, 'athlete_feedback' AS colonne, count(*) AS vides FROM training_exercises WHERE btrim(athlete_feedback) = ''
            UNION ALL
            SELECT 'training_exercises' AS t, 'coach_note' AS colonne, count(*) AS vides FROM training_exercises WHERE btrim(coach_note) = ''
            UNION ALL
            SELECT 'training_exercises' AS t, 'link' AS colonne, count(*) AS vides FROM training_exercises WHERE btrim(link) = ''
            UNION ALL
            SELECT 'training_exercises' AS t, 'group_id' AS colonne, count(*) AS vides FROM training_exercises WHERE btrim(group_id) = ''
            UNION ALL
            SELECT 'training_exercises' AS t, 'increment' AS colonne, count(*) AS vides FROM training_exercises WHERE btrim(increment) = ''
            UNION ALL
            SELECT 'training_exercises' AS t, 'name' AS colonne, count(*) AS vides FROM training_exercises WHERE btrim(name) = ''
            UNION ALL
            SELECT 'training_base_principles' AS t, 'format' AS colonne, count(*) AS vides FROM training_base_principles WHERE btrim(format) = ''
            UNION ALL
            SELECT 'training_base_principles' AS t, 'cluster_mode' AS colonne, count(*) AS vides FROM training_base_principles WHERE btrim(cluster_mode) = ''
            UNION ALL
            SELECT 'training_base_principles' AS t, 'cluster_rest' AS colonne, count(*) AS vides FROM training_base_principles WHERE btrim(cluster_rest) = ''
            UNION ALL
            SELECT 'training_base_principles' AS t, 'tempo' AS colonne, count(*) AS vides FROM training_base_principles WHERE btrim(tempo) = ''
            UNION ALL
            SELECT 'training_base_principles' AS t, 'sets' AS colonne, count(*) AS vides FROM training_base_principles WHERE btrim(sets) = ''
            UNION ALL
            SELECT 'training_base_principles' AS t, 'reps' AS colonne, count(*) AS vides FROM training_base_principles WHERE btrim(reps) = ''
            UNION ALL
            SELECT 'training_base_principles' AS t, 'weight' AS colonne, count(*) AS vides FROM training_base_principles WHERE btrim(weight) = ''
            UNION ALL
            SELECT 'training_base_principles' AS t, 'assistance' AS colonne, count(*) AS vides FROM training_base_principles WHERE btrim(assistance) = ''
            UNION ALL
            SELECT 'training_base_principles' AS t, 'aimed_rpe' AS colonne, count(*) AS vides FROM training_base_principles WHERE btrim(aimed_rpe) = ''
            UNION ALL
            SELECT 'training_base_principles' AS t, 'rest' AS colonne, count(*) AS vides FROM training_base_principles WHERE btrim(rest) = ''
            UNION ALL
            SELECT 'training_base_principles' AS t, 'coach_note' AS colonne, count(*) AS vides FROM training_base_principles WHERE btrim(coach_note) = ''
            UNION ALL
            SELECT 'training_base_principles' AS t, 'increment' AS colonne, count(*) AS vides FROM training_base_principles WHERE btrim(increment) = ''
            UNION ALL
            SELECT 'training_base_principles' AS t, 'name' AS colonne, count(*) AS vides FROM training_base_principles WHERE btrim(name) = ''
            UNION ALL
            SELECT 'training_base_accessories' AS t, 'format' AS colonne, count(*) AS vides FROM training_base_accessories WHERE btrim(format) = ''
            UNION ALL
            SELECT 'training_base_accessories' AS t, 'cluster_mode' AS colonne, count(*) AS vides FROM training_base_accessories WHERE btrim(cluster_mode) = ''
            UNION ALL
            SELECT 'training_base_accessories' AS t, 'cluster_rest' AS colonne, count(*) AS vides FROM training_base_accessories WHERE btrim(cluster_rest) = ''
            UNION ALL
            SELECT 'training_base_accessories' AS t, 'tempo' AS colonne, count(*) AS vides FROM training_base_accessories WHERE btrim(tempo) = ''
            UNION ALL
            SELECT 'training_base_accessories' AS t, 'sets' AS colonne, count(*) AS vides FROM training_base_accessories WHERE btrim(sets) = ''
            UNION ALL
            SELECT 'training_base_accessories' AS t, 'reps' AS colonne, count(*) AS vides FROM training_base_accessories WHERE btrim(reps) = ''
            UNION ALL
            SELECT 'training_base_accessories' AS t, 'weight' AS colonne, count(*) AS vides FROM training_base_accessories WHERE btrim(weight) = ''
            UNION ALL
            SELECT 'training_base_accessories' AS t, 'assistance' AS colonne, count(*) AS vides FROM training_base_accessories WHERE btrim(assistance) = ''
            UNION ALL
            SELECT 'training_base_accessories' AS t, 'aimed_rpe' AS colonne, count(*) AS vides FROM training_base_accessories WHERE btrim(aimed_rpe) = ''
            UNION ALL
            SELECT 'training_base_accessories' AS t, 'rest' AS colonne, count(*) AS vides FROM training_base_accessories WHERE btrim(rest) = ''
            UNION ALL
            SELECT 'training_base_accessories' AS t, 'coach_note' AS colonne, count(*) AS vides FROM training_base_accessories WHERE btrim(coach_note) = ''
            UNION ALL
            SELECT 'training_base_accessories' AS t, 'increment' AS colonne, count(*) AS vides FROM training_base_accessories WHERE btrim(increment) = ''
            UNION ALL
            SELECT 'training_base_accessories' AS t, 'group_id' AS colonne, count(*) AS vides FROM training_base_accessories WHERE btrim(group_id) = ''
            UNION ALL
            SELECT 'training_base_accessories' AS t, 'name' AS colonne, count(*) AS vides FROM training_base_accessories WHERE btrim(name) = ''
             ORDER BY vides DESC
        """,
        reparation=(
            "docs/migrations/2026-09-11_le_vide_n_est_pas_une_valeur_lot_*.sql\n"
            "   -- ⚠️ LE ROBINET D'ABORD, LA FLAQUE ENSUITE. `vide_vaut_absence`\n"
            "   -- est en production depuis le lot 1 : sans lui, une colonne\n"
            "   -- nettoyée se re-salit à la première GÉNÉRATION de semaine."
        ),
        # ⚠️ CE CHIFFRE DESCEND À CHAQUE LOT, ET LE SCRIPT L'EXIGE : une
        # tolérance dont la dette est payée sort en `tolerance_perimee`,
        # c'est-à-dire un ÉCHEC. On ne peut pas l'oublier ici.
        #
        # ⚠️ PLUS DE TOLÉRANCE : LA DETTE EST PAYÉE (FRE-137, 11/09). Elle valait
        # 50 712 — dont 12 119 que cet invariant ne voyait pas, faute de compter
        # les deux tables de BASE. Trois lots l'ont soldée : FROID 10 325,
        # TIÈDE 35 918, CHAUD 14 794.
        #
        # ⚠️ ET L'INVARIANT RESTE, alors que la base garantit tout par CHECK. Une
        # contrainte peut sauter — un DROP à la main, une base restaurée d'un
        # dump antérieur, un environnement monté autrement. Ce jour-là, il est le
        # seul à pouvoir le dire, et ses specs de mutation retirent désormais la
        # contrainte pour continuer à l'éprouver.
        tags=("donnee",),
    ),
    # ⚠️ LE MÊME DÉFAUT AVEC UN CHIFFRE À LA PLACE (FRE-137, lot 4). Deux
    # écritures pour la même absence, dont une qui se lit comme une valeur :
    # 28 fiches sur 70 pesaient zéro kilo, et 59 portaient un 1RM de chin-up à 0.
    #
    # Le CHECK couvre les deux colonnes de mesure ; le 1RM, lui, vit dans un
    # `jsonb` qu'aucune contrainte ne peut garder simplement — c'est donc cet
    # invariant qui le tient, et c'est sa vraie raison d'être.
    Invariant(
        cle="pas_de_mesure_a_zero",
        affirmation="une mesure de corps absente s'écrit `NULL`, et un 1RM non "
                    "renseigné n'a pas de clé — jamais un zéro",
        source="app/personnes/routes_athlete_profile.py — _mesure_ou_absence ; "
               "app/personnes/routes_athletes.py — _CREATE_ATHLETE_SQL ; "
               "docs/migrations/2026-09-11_un_zero_n_est_pas_une_mesure.sql",
        compte="""
            SELECT (SELECT count(*) FROM athletes
                     WHERE weight_kg <= 0 OR height_cm <= 0)
                 + (SELECT count(*) FROM athletes, jsonb_each(current_one_rm) AS e(k, v)
                     WHERE (v#>>'{}')::numeric <= 0)
        """,
        exemples="""
            SELECT legacy_id, first_name, 'weight_kg' AS quoi, weight_kg::text AS valeur
              FROM athletes WHERE weight_kg <= 0
            UNION ALL
            SELECT legacy_id, first_name, 'height_cm', height_cm::text
              FROM athletes WHERE height_cm <= 0
            UNION ALL
            SELECT a.legacy_id, a.first_name, 'currentOneRM.' || e.k, e.v#>>'{}'
              FROM athletes a, jsonb_each(a.current_one_rm) AS e(k, v)
             WHERE (e.v#>>'{}')::numeric <= 0
             ORDER BY 1, 3
        """,
        reparation=(
            "docs/migrations/2026-09-11_un_zero_n_est_pas_une_mesure.sql\n"
            "   -- ⚠️ ET LE ROBINET EST CÔTÉ SERVEUR, pas dans le navigateur :\n"
            "   -- `athlete-profile-edit.tsx` fait `parseFloat(v) || 0`, donc\n"
            "   -- vider la case envoie toujours `0`. C'est brokkr qui traduit."
        ),
        tags=("donnee",),
    ),
    Invariant(
        cle="pas_de_sentinelle_de_repos",
        affirmation="« repos libre » n'a qu'une écriture, NULL — jamais `-1` "
                    "ni `Free`, et la projection ne porte aucun repos négatif",
        source="app/entrainement/prescription.py — SENTINELLES_DE_REPOS ; "
               "docs/migrations/2026-09-12_le_repos_libre_n_a_qu_une_ecriture.sql",
        # ⚠️ LES TROIS TABLES DE LIGNES ET LA PROJECTION. Le CHECK ne couvre que
        # les trois premières ; `training_sets.rest_s` est reconstruite la nuit
        # depuis elles, et c'est elle que la première moyenne de repos lira.
        compte="""
            SELECT (SELECT count(*) FROM training_exercises        WHERE rest IN ('-1', 'Free'))
                 + (SELECT count(*) FROM training_base_principles  WHERE rest IN ('-1', 'Free'))
                 + (SELECT count(*) FROM training_base_accessories WHERE rest IN ('-1', 'Free'))
                 + (SELECT count(*) FROM training_sets             WHERE rest_s < 0)
        """,
        exemples="""
            SELECT 'exercice' AS quoi, id::text, rest FROM training_exercises
             WHERE rest IN ('-1', 'Free')
            UNION ALL
            SELECT 'principal', id::text, rest FROM training_base_principles
             WHERE rest IN ('-1', 'Free')
            UNION ALL
            SELECT 'accessoire', id::text, rest FROM training_base_accessories
             WHERE rest IN ('-1', 'Free')
            UNION ALL
            SELECT 'projection', exercise_id::text, rest_s::text FROM training_sets
             WHERE rest_s < 0
            LIMIT 20
        """,
        reparation=(
            "docs/migrations/2026-09-12_le_repos_libre_n_a_qu_une_ecriture.sql\n"
            "   -- Elle éponge les trois tables ET pose le CHECK `rest_sans_sentinelle`.\n"
            "   -- La projection se refait la nuit (03:30) : un −1 qui y resterait le\n"
            "   -- lendemain veut dire que le job n'a pas tourné."
        ),
        tags=("donnee",),
    ),
    # -------------------------------------------- la grille contre les principes
    # ⚠️ CET INVARIANT A FAILLI ÊTRE ÉCRIT AVEC LE MAUVAIS CRITÈRE (FRE-193).
    # La première version du ticket relevait les tiers ABSENTS DE LA
    # BIBLIOTHÈQUE, et comptait 53. Ce critère est vert aujourd'hui — zéro — sur
    # une production qui porte pourtant vingt tiers muets : `BENCH` est un nom
    # VIVANT de la bibliothèque qui ne désigne le mouvement d'AUCUN bloc. Il a
    # coûté deux migrations incomplètes le 23/09 avant qu'on le voie.
    #
    # LE CRITÈRE EST CELUI QUE LA GÉNÉRATION APPLIQUE, et rien d'autre : nom ET
    # tier, dans SON bloc. Ce qui existe ailleurs ne la regarde pas.
    Invariant(
        cle="tier_sans_principe",
        affirmation="un tier de la répartition apparie un principe de SON bloc, "
                    "par NOM et par TIER — sinon il n'engendre aucune ligne",
        source="app/entrainement/generation_semaine.py — generer_semaine : "
               '`if p.get("name") == mouvement and p.get("tier") == tier`',
        # ⚠️ AUCUN CAST. Un `::int` sur une valeur jsonb non numérique ferait
        # ÉCHOUER le vérificateur au lieu de compter — et un vérificateur qui
        # explose sur la donnée qu'il surveille ne surveille rien. Comparé en
        # texte, un tier aberrant n'apparie simplement aucun principe : il
        # compte comme violation, ce qu'il est.
        compte="""
            SELECT count(*)
              FROM training_blocks b,
                   jsonb_array_elements(coalesce(b.day_split, '[]'::jsonb)) AS j(jour),
                   jsonb_each(coalesce(j.jour->'tiers', '{}'::jsonb)) AS k(mouvement, tier)
             WHERE jsonb_typeof(b.day_split) = 'array'
               AND NOT EXISTS (
                     SELECT 1 FROM training_base_principles p
                      WHERE p.block_id = b.id AND p.name = k.mouvement
                        AND p.tier::text = (k.tier #>> '{}'))
        """,
        exemples="""
            SELECT a.first_name, a.last_name, b.number AS bloc,
                   j.jour->>'day' AS jour, k.mouvement, k.tier #>> '{}' AS tier_pose,
                   coalesce((SELECT string_agg(DISTINCT p.tier::text, ',' ORDER BY p.tier::text)
                               FROM training_base_principles p
                              WHERE p.block_id = b.id AND p.name = k.mouvement),
                            'pas prescrit') AS tiers_prescrits
              FROM training_blocks b
              JOIN training_macros m ON m.id = b.macro_id
              JOIN programs pr ON pr.id = m.program_id
              JOIN athletes a ON a.id = pr.athlete_id,
                   jsonb_array_elements(coalesce(b.day_split, '[]'::jsonb)) AS j(jour),
                   jsonb_each(coalesce(j.jour->'tiers', '{}'::jsonb)) AS k(mouvement, tier)
             WHERE jsonb_typeof(b.day_split) = 'array'
               AND NOT EXISTS (
                     SELECT 1 FROM training_base_principles p
                      WHERE p.block_id = b.id AND p.name = k.mouvement
                        AND p.tier::text = (k.tier #>> '{}'))
             ORDER BY 1, 3, 4
             LIMIT 20
        """,
        reparation=(
            "Le tier est POSÉ mais rien ne l'engendre. `tiers_prescrits` dit ce que\n"
            "   le bloc prescrit pour ce mouvement : « pas prescrit » = la case est\n"
            "   orpheline ; un autre chiffre = le tier ne correspond pas.\n"
            "   ⚠️ DEUX GESTES DE COACH, ET ON N'ARBITRE PAS : déplacer la case au tier\n"
            "   prescrit, ou changer le tier du principe. Rien ne dit lequel il voulait."
        ),
        # ⚠️ VINGT, PAS CINQUANTE-TROIS. Le chiffre du ticket datait du critère
        # « absent de la bibliothèque », et les quatre migrations du 23/09 ont
        # repris ce qu'il visait. Une tolérance dont la dette est payée sort en
        # `tolerance_perimee`, donc en ÉCHEC : on ne peut pas l'oublier ici.
        connu_viole=20,
        connu_ticket="FRE-193",
        tags=("donnee", "entrainement"),
    ),
    Invariant(
        cle="lignes_dans_la_structure_de_l_athlete",
        affirmation="une ligne qui nomme un mouvement porte la structure de son "
                    "athlète — c'est dans CETTE bibliothèque que son nom est cherché",
        source="docs/migrations/2026-09-19_une_bibliotheque_par_structure.sql — "
               "ff_pose_la_structure",
        # ⚠️ LE TRIGGER LA POSE À L'INSERTION ; RIEN NE LA SUIT SI L'ATHLÈTE
        # CHANGE DE STRUCTURE (décision du 19/09, « tant pis »). C'est ce cas-là,
        # et un trigger perdu, que ce compte voit. Les lignes de séance suffisent :
        # elles sont l'essentiel du volume, et le chemin le plus long vers l'athlète.
        compte="""
            SELECT count(*) FROM training_exercises e
              JOIN training_sessions se ON se.id = e.session_id
              JOIN training_weeks w ON w.id = se.week_id
              JOIN training_blocks b ON b.id = w.block_id
              JOIN training_macros m ON m.id = b.macro_id
              JOIN programs p ON p.id = m.program_id
              JOIN athletes a ON a.id = p.athlete_id
             WHERE e.structure <> a.structure
        """,
        exemples="""
            SELECT a.legacy_id, a.first_name, a.structure AS athlete, e.structure AS ligne,
                   count(*) AS lignes
              FROM training_exercises e
              JOIN training_sessions se ON se.id = e.session_id
              JOIN training_weeks w ON w.id = se.week_id
              JOIN training_blocks b ON b.id = w.block_id
              JOIN training_macros m ON m.id = b.macro_id
              JOIN programs p ON p.id = m.program_id
              JOIN athletes a ON a.id = p.athlete_id
             WHERE e.structure <> a.structure
             GROUP BY 1, 2, 3, 4
             LIMIT 20
        """,
        reparation=(
            "Un athlète a changé de structure : ses lignes gardent l'ancienne.\n"
            "   Les réaligner À LA MAIN (les noms doivent exister dans la bibliothèque\n"
            "   d'arrivée), table par table — rien ne l'expose."
        ),
        tags=("donnee",),
    ),
    Invariant(
        cle="fiche_dans_la_structure_de_son_coach",
        affirmation="une fiche athlète est dans la structure où son coach coache "
                    "— la liste « mes athlètes » d'une structure montre tout ce "
                    "que ce coach y suit, et rien d'une autre",
        source="app/personnes/routes_athletes.py — _CREATE_ATHLETE_SQL, _MINE_*_SQL ; "
               "docs/migrations/2026-09-18_les_structures.sql",
        # ⚠️ NICO N'EST PAS UNE EXCEPTION : sa fiche French Forge est coachée par
        # Aubin (French Forge). C'est son COMPTE qui est dans deux structures, pas
        # une fiche. Un écart ici voudrait dire qu'un coach suit un athlète que la
        # liste de SA structure ne montre pas — invisible, donc non programmé.
        compte="""
            SELECT count(*) FROM athletes a JOIN coaches c ON c.uid = a.coach_uid
             WHERE a.structure <> c.structure
        """,
        exemples="""
            SELECT a.legacy_id, a.first_name, a.structure AS fiche, c.uid AS coach,
                   c.structure AS coache_dans
              FROM athletes a JOIN coaches c ON c.uid = a.coach_uid
             WHERE a.structure <> c.structure
             LIMIT 20
        """,
        reparation=(
            "Décider à qui est l'athlète : réaffecter le coach (`PATCH /athletes/{id}/coach`,\n"
            "   admin) ou changer la structure de la fiche — une écriture à la main, rien\n"
            "   ne l'expose encore."
        ),
        tags=("donnee",),
    ),
]


def _lignes(connexion, sql: str) -> list[dict]:
    return [dict(r) for r in connexion.execute(text(sql)).mappings().all()]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Vérifie sur la vraie base les invariants que les "
                    "commentaires affirment (lecture seule).")
    parser.add_argument("--verbeux", action="store_true",
                        help="affiche les lignes fautives, pas seulement le compte")
    parser.add_argument("--strict", action="store_true",
                        help="échoue AUSSI sur les violations déjà connues "
                             "(par défaut elles avertissent sans faire échouer)")
    args = parser.parse_args()

    try:
        url = _resolve_url()
    except Exception as e:  # noqa: BLE001 — on veut le message, pas la trace
        print(f"⛔ base introuvable : {e}")
        return 1

    par_verdict: dict[Verdict, list[tuple[Invariant, int]]] = {
        "vert": [], "informatif": [], "connu": [], "rompu": [], "tolerance_perimee": []}
    details: list[tuple[Invariant, list[dict]]] = []

    with create_engine(url).connect() as c:
        for inv in INVARIANTS:
            violations = c.execute(text(inv.compte)).scalar() or 0
            v = verdict(inv, violations, args.strict)
            par_verdict[v].append((inv, violations))
            if v != "vert" and args.verbeux and inv.exemples:
                details.append((inv, _lignes(c, inv.exemples)))

    total = len(INVARIANTS)
    rompus, connus = par_verdict["rompu"], par_verdict["connu"]
    perimes, informatifs = par_verdict["tolerance_perimee"], par_verdict["informatif"]

    for inv, n in informatifs:
        print(f"[invariant] ℹ️  {inv.cle} — {n} ligne(s), pour information")
        print(f"   {inv.affirmation}")
        print()

    for inv, n in connus:
        print(f"[invariant] ⚠️  {inv.cle} — {n} violation(s), CONNUES")
        print(f"   affirmation : {inv.affirmation}")
        print(f"   affirmée par : {inv.source}")
        print(f"   {inv.connu_ticket}")
        print()

    for inv, _ in perimes:
        print(f"[invariant] ⛔ {inv.cle} — tolère {inv.connu_viole} violation(s), "
              f"il n'y en a PLUS AUCUNE")
        print("   La dette est payée : retirez `connu_viole` et `connu_ticket`.")
        print("   Un chiffre toléré qui ne correspond plus à rien absorberait en")
        print("   silence la prochaine vraie violation — c'est comme ça que la")
        print("   reprise du 29/08 s'est perdue.")
        print()

    for inv, n in rompus:
        connu = f" (dont {inv.connu_viole} connue(s) — {n - inv.connu_viole} DE PLUS)" \
            if inv.connu_viole else ""
        print(f"[invariant] ⛔ {inv.cle} — {n} violation(s){connu}")
        print(f"   affirmation : {inv.affirmation}")
        print(f"   affirmée par : {inv.source}")
        if inv.reparation:
            print(f"   réparation :\n   {inv.reparation}")
        print()

    for inv, lignes in details:
        print(f"   ── {inv.cle} : {len(lignes)} ligne(s)")
        for ligne in lignes[:20]:
            print("      " + " | ".join(
                "∅" if v is None else str(v) for v in ligne.values()))
        if len(lignes) > 20:
            print(f"      … et {len(lignes) - 20} autre(s)")
        print()

    tranchants = total - len(informatifs)
    verts = len(par_verdict["vert"])
    if rompus or perimes:
        print(f"[invariants] ÉCHEC — {verts}/{tranchants} tiennent, "
              f"{len(rompus)} rompu(s), {len(perimes)} tolérance(s) périmée(s), "
              f"{len(connus)} connu(s).")
        print("  Un invariant rompu, c'est un commentaire devenu faux quelque part.")
        print("  Corrigez la DONNÉE et la CAUSE, ou retirez l'affirmation du code.")
        return 1

    if connus:
        print(f"[invariants] {verts}/{tranchants} tiennent, "
              f"{len(connus)} violation(s) connue(s) et non résorbée(s).")
        return 0

    info = f", {len(informatifs)} informatif(s)" if informatifs else ""
    print(f"[invariants] OK — {tranchants}/{tranchants} tiennent{info}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
