import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ChevronRight, Dumbbell } from 'lucide-react';

import type { BlockObjective, Goal, OneRepMax } from '@/api/types';
import { useCompetitions } from '@/api/hooks/use-competitions';
import { useRecords } from '@/api/hooks/use-records';
import { useGoals, useReplaceGoals } from '@/api/hooks/use-goals';
import { useDeletePr, useManualPrs, useUpsertPr } from '@/api/hooks/use-prs';
import { usePatchAthleteProfile } from '@/api/hooks/use-athletes';
import { useFormeParJour } from '@/api/hooks/use-forme';
import { useProgramStructure } from '@/api/hooks/use-structure';
import { useAthleteSelection } from '@/lib/athlete-selection';
import { useProgramSelection } from '@/lib/program-selection';
import { nextCompetitionOf, athleteFullName } from '@/lib/athlete';
import { computeCompetitionPRs } from '@/lib/selectors';
import { formatRis } from '@/lib/ris-score';
import { formatLong } from '@/lib/dates-ui';
import { cn } from '@/lib/utils';

import { useArchiverAthlete } from '@/api/hooks/use-athletes';
import { Button } from '@/components/ui/button';
import { AthleteHeader } from '@/components/dashboard/athlete-header';
import { Link } from 'react-router-dom';
import { UserRound } from 'lucide-react';
import { FormSparkline } from '@/components/dashboard/form-sparkline';
import { RmPercentageTable } from '@/components/dashboard/rm-percentage-table';
import { AllTimePrTable } from '@/components/dashboard/all-time-pr-table';
import { GoalsList } from '@/components/dashboard/goals-list';
/* ⚠️ LA CARTE D'OBJECTIF VIENT DE LA VUE ENTRAÎNEMENT, elle n'est pas recopiée :
   les deux écrans montrent la MÊME liste, et deux mises en page pour une donnée
   divergent au premier changement de style. C'est la correction déjà passée
   entre le coach et l'athlète (refonte des écrans, 09/2026), étendue au tableau de bord. */
import { Cadre, CarteObjectif, CompteurAtteints } from '@/components/training/block-objectives-editor';
import { useLibrary } from '@/api/hooks/use-library';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { toastSaveError } from '@/lib/save-error';

export function DashboardView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const sel = useAthleteSelection();
  const athlete = sel.selected;

  const athleteId = sel.canView ? (athlete?.id ?? null) : null;

  const { data: competitions = [] } = useCompetitions();
  // La CHARPENTE, pas l'arbre : cet écran n'affiche que les libellés et les
  // dates du bloc courant (FRE-119).
  const { data: macros = [] } = useProgramStructure(sel.canView ? athlete?.programId : null);
  const { data: formePoints = [] } = useFormeParJour(athleteId, 30);
  const { data: records = [] } = useRecords(athleteId);
  const { data: goals = [] } = useGoals(athleteId);
  // ⚠️ LA BIBLIOTHÈQUE FAIT FOI POUR LES MOUVEMENTS D'OBJECTIF (FRE-140) :
  // `athlete_goals.exercise` porte une clé étrangère vers elle, donc un nom
  // qu'elle ne contient pas donne un 422 à l'enregistrement. Même filtre que
  // l'écran Bibliothèque, qui est le seul autre à poser la question.
  const { data: bibliotheque } = useLibrary();
  const mouvementsDeCompetition = useMemo(
    () => (bibliotheque?.exercices ?? []).filter(e => e.competition).map(e => e.name),
    [bibliotheque?.exercices]);
  const { data: manualPrList = [] } = useManualPrs(athleteId);

  const replaceGoals = useReplaceGoals(athleteId);
  const upsertPr = useUpsertPr(athleteId);
  const deletePr = useDeletePr(athleteId);
  const patchProfile = usePatchAthleteProfile();
  const confirm = useConfirm();
  const program = useProgramSelection(athlete?.programId, macros);
  // ⚠️ PLUS ÉTROIT QUE `sel.canManage`, qui inclut le kiné : archiver est un
  // geste de COACH, et brokkr le refuse à tout le monde d'autre (mode `coach`).
  const estSonCoach = Boolean(athlete && sel.me?.isCoach && athlete.coachId === sel.me.uid);
  const archiver = useArchiverAthlete();

  if (sel.loading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!athlete) {
    return (
      <div className="mx-auto max-w-6xl rounded-lg border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
        {t('dashboard.aucunAthleteChoisis')}
      </div>
    );
  }

  const onError = (e: unknown) =>
    toastSaveError(e);

  // Le compte à rebours est calculé par `AthleteHeader`, qui est désormais le
  // SEUL endroit où la compétition est dite (refonte des écrans, 09/2026).
  const nextCompetition = nextCompetitionOf(competitions, athlete);

  /* L'écart entre le poids d'aujourd'hui et celui du jour où le RIS a été fait.
     ⚠️ NULL QUAND IL VAUT ZÉRO : « (+0 aujourd'hui) » est du bruit — l'écart ne
     s'affiche que s'il en est un. Et null aussi si l'un des deux poids manque,
     sinon on annoncerait un écart contre une absence. */
  const ecartDePoids = athlete.weight != null && athlete.risBodyweight != null
    && Math.round(athlete.weight - athlete.risBodyweight) !== 0
    ? Math.round(athlete.weight - athlete.risBodyweight)
    : null;

  // Les PR manuels « simples » (sans contexte sets/variante/format) alimentent
  // la matrice mouvement × reps de la table All-Time.
  const manualPrMap: Record<string, Record<number, number>> = {};
  for (const pr of manualPrList) {
    if (pr.sets != null || pr.variant || pr.format) continue;
    (manualPrMap[pr.movement] ??= {})[pr.reps] = pr.weight;
  }

  const updateManualPr = async (movement: string, reps: number, weight: number) => {
    if (weight <= 0) {
      const existing = manualPrList.find(
        p => p.movement === movement && p.reps === reps && p.sets == null && !p.variant && !p.format,
      );
      if (!existing) return;
      // ⚠️ LA SUPPRESSION LA PLUS SOURNOISE DU PRODUIT : rien ne dit qu'un champ
      // VIDÉ efface. Les onze autres suppressions passent par une corbeille, donc
      // l'intention est claire ; ici le geste est « je corrige une valeur », et
      // le record part. C'est aussi le seul endroit où l'on détruit sans avoir
      // visé un bouton de destruction.
      if (!await confirm({
        title: t('dashboard.supprimerLeRecordManuel', { mouvement: movement, reps }),
        description: t('dashboard.ilVautActuellement', { poids: existing.weight }),
      })) return;
      deletePr.mutate(existing.id, { onError });
      return;
    }
    upsertPr.mutate({ movement, reps, weight }, { onError });
  };

  const updateOneRM = (key: keyof OneRepMax, value: number) => {
    patchProfile.mutate({ athleteId: athlete.id, patch: { currentOneRM: { [key]: value } } }, { onError });
  };

  const persistGoals = (next: Goal[]) => replaceGoals.mutate(next, { onError });

  /* ⚠️ LES MAXIMA DE COMPÉTITION, pour que l'écart d'un objectif dise la même
     chose que la grille des records — qui les fusionne depuis toujours. Même
     appel, mêmes arguments : une seule définition de « son meilleur en
     compétition », jouée deux fois. */
  const competitionPRs = computeCompetitionPRs(
    competitions, [athlete.linkedUserId, athlete.id], athleteFullName(athlete));

  return (
    /* ⚠️ `w-full` N'EST PAS DÉCORATIF : sans lui, ce conteneur prend la largeur
       de son CONTENU, et une carte trop large pousse la PAGE ENTIÈRE. Un
       conteneur qui défile (`overflow-x-auto`) ne rétrécit que si son parent lui
       donne une largeur ferme — sinon il garde celle de sa table, et son
       `overflow` ne sert à rien.

       Mesuré le 10/09 : 627 px de large sur un écran de 390. La seule carte des
       records personnels imposait 611 à elle seule, quand toutes les autres se
       contentaient de 358. La Table RM juste au-dessus ne débordait pas — non
       qu'elle soit mieux construite : ses colonnes de chiffres sont simplement
       étroites. Elle passait par chance, et trois autres vues en dépendaient
       encore (`kine`, `bilan`, `bilan-modeles`). */
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <AthleteHeader
        athlete={athlete}
        nextCompetition={nextCompetition}
        action={
          <>
            {/* La fiche a son onglet (27/09). Ce bouton est l'entrée du téléphone,
                où la barre du bas ne le porte pas. */}
            <Button asChild size="sm" variant="outline" className="h-8">
              <Link to="/profil"><UserRound className="h-3.5 w-3.5" /> {t('nav.profil')}</Link>
            </Button>
            {/* ARCHIVER / RÉACTIVER (FRE-127) — ICI, ET PAS SUR LA FICHE.
                ⚠️ LE GESTE ÉTAIT POSÉ SUR `/athletes/{id}`, UNE PAGE QUE PLUS
                AUCUN LIEN N'ATTEINT depuis la suppression de l'annuaire le
                31/08. Il fallait taper l'URL pour le voir — autant dire qu'il
                n'existait pas. Le tableau de bord est à un clic de la barre
                latérale, c'est là que le coach range sa liste.

                ⚠️ ET PAS `sel.canManage`, QUI INCLUT LE KINÉ : archiver est un
                geste de coach, et brokkr le refuse à tout le monde d'autre. */}
            {estSonCoach && (
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => archiver.mutate({ athleteId: athlete.id, archive: !athlete.archiveLe })}
                disabled={archiver.isPending}
              >
                {t(athlete.archiveLe ? 'dashboard.reactiver' : 'dashboard.archiver')}
              </Button>
            )}
          </>
        }
      />

      {/* ⚠️ CETTE CARTE A QUITTÉ `KpiCard`, ET C'EST POUR CESSER DE DÉTOURNER
          `delta` (refonte des écrans, 09/2026). Elle recevait `delta={risTotal} kg` : la prop existe
          pour une VARIATION, elle est stylée comme telle (couleur de tendance),
          et le total s'affichait donc en 10 px dans un coin. Or `325 kg` et
          `65.42` sont deux lectures du même résultat — la carte s'intitulait
          « RIS / Total » et n'en montrait qu'une en grand.

          ⚠️ LE RIS RESTE SERVI PAR BROKKR. Ne pas le recalculer ici : c'est écrit
          deux fois dans le code (FRE-92, FRE-141), avec l'historique de ce qui
          s'est passé la fois où un écran l'a fait. */}
      {/* ⚠️ LES DEUX LECTURES DU MÊME ATHLÈTE, CÔTE À CÔTE. Le total dit ce qu'il
          VAUT, la forme ce qu'il EST aujourd'hui : empilées, il fallait défiler
          pour tenir les deux dans l'œil, et la sparkline se retrouvait derrière
          le programme, c'est-à-dire après ce qu'elle sert à interpréter. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section className="relative overflow-hidden rounded-xl border border-border/80 bg-card p-4 shadow-[0_14px_36px_rgba(0,0,0,0.16)] before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-gold before:content-['']">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('dashboard.meilleurTotal')}
          </span>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="flex items-baseline gap-1">
              <span className="font-display text-[34px] font-bold leading-none tabular-nums text-gold">
                {athlete.risTotal ?? '—'}
              </span>
              {athlete.risTotal != null && (
                <span className="text-sm text-muted-foreground">kg</span>
              )}
            </span>
            {/* Le libellé AVANT la valeur : « RIS 65.42 » se lit comme une unité,
                « 65.42 RIS » comme un nombre qu'on doit ensuite nommer. */}
            <span className="flex items-baseline gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('dashboard.ris')}
              </span>
              <span className="font-display text-2xl font-bold leading-none tabular-nums">
                {athlete.ris != null ? formatRis(athlete.ris) : '—'}
              </span>
            </span>
          </div>
          {/* ⚠️ LE POIDS DU JOUR, PAS CELUI D'AUJOURD'HUI. Un RIS vaut pour le
              poids auquel il a été réalisé : l'afficher à côté de la compétition
              dit d'où vient le score, et rend visible l'écart avec le poids
              actuel — qui est une information, pas une erreur.

              ⚠️ ET L'ÉCART EST DÉSORMAIS CALCULÉ, plutôt que laissé à faire de
              tête. C'est la seule chose que ces deux nombres avaient à dire
              ensemble : « à 79 kg (+2 aujourd'hui) » se lit d'un coup, « 79 »
              puis « 81 » deux cartes plus loin, non. */}
          <p className="mt-1.5 text-xs text-muted-foreground">
            {athlete.risCompetition ? (
              <>
                {athlete.risCompetition} · {t('dashboard.aPoids', { poids: athlete.risBodyweight })}
                {ecartDePoids !== null && (
                  <span className="text-gold"> ({ecartDePoids > 0 ? '+' : ''}{ecartDePoids} {t('dashboard.aujourdhui')})</span>
                )}
              </>
            ) : t('dashboard.risMissing')}
          </p>
        </section>

        {sel.canView && <FormSparkline points={formePoints} days={30} />}
      </div>

      {sel.canView && program.macro && program.block && program.week && (
        <CycleCard
          macroLabel={program.macro.name || `Macro ${program.macro.macroNumber}`}
          macroAuto={!program.macro.name}
          blockLabel={program.block.name || `Bloc ${program.block.blockNumber}`}
          blockAuto={!program.block.name}
          weekLabel={program.week.name || `S${program.week.weekNumber}`}
          startDate={program.week.startDate}
          endDate={program.week.endDate}
          objectives={program.block.objectives}
          onGoTraining={() => void navigate('/training')}
        />
      )}


      <RmPercentageTable
        oneRM={athlete.currentOneRM}
        onUpdateOneRM={sel.canManage ? updateOneRM : undefined}
        athleteId={athlete.id}
      />

      {sel.canView && (
        <AllTimePrTable
          records={records}
          competitions={competitions}
          athleteUids={[athlete.linkedUserId, athlete.id]}
          athleteName={athleteFullName(athlete)}
          manualPRs={manualPrMap}
          onUpdateManualPR={sel.canManage ? updateManualPr : undefined}
        />
      )}

      {sel.canView && <GoalsList goals={goals} mouvements={mouvementsDeCompetition}
                                 records={records} manualPRs={manualPrMap}
                                 competitionPRs={competitionPRs}
                                 oneRM={athlete.currentOneRM}
                                 onReplace={sel.canEdit ? persistGoals : undefined} />}
    </div>
  );
}

function CycleCard({
  macroLabel, macroAuto, blockLabel, blockAuto, weekLabel, startDate, endDate, objectives, onGoTraining,
}: {
  macroLabel: string;
  /** Le libellé vient-il du GÉNÉRATEUR ? C'est ce que le mono dit, et il faut le
   *  savoir ici : à ce niveau, « Macro 4 » et « Prépa Coupe de France » ne sont
   *  pas la même nature de nom. */
  macroAuto: boolean;
  blockLabel: string;
  blockAuto: boolean;
  weekLabel: string;
  startDate?: string | null;
  endDate?: string | null;
  // ⚠️ Chaque champ peut manquer depuis FRE-137 : le contrat le dit, et cet
  // écran n'affiche que ce qui est renseigné.
  //
  // ⚠️ ET `atteintLe` MANQUAIT À CETTE SIGNATURE (refonte des écrans, 09/2026). L'information était
  // donc perdue À LA FRONTIÈRE DU COMPOSANT, pas à l'affichage — d'où des
  // pastilles grises indifférenciées, alors que l'état existe en base et que
  // l'éditeur coach le saisit. Le type du contrat le porte : on le prend entier.
  objectives: BlockObjective[];
  onGoTraining: () => void;
}) {
  const { t } = useTranslation();
  const dateLabel = startDate && endDate
    ? `${formatLong(startDate)} → ${formatLong(endDate)}`
    : t('dashboard.noDates');
  const atteints = objectives.filter(o => o.atteintLe).length;

  return (
    <section className="rounded-xl border border-border/80 bg-card/95 p-5 shadow-[0_14px_36px_rgba(0,0,0,0.16)] ring-1 ring-gold/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden />
            <span>{t('dashboard.program')}</span>
          </div>
          {/* ⚠️ LE MÊME VOCABULAIRE QUE LA BARRE DU PROGRAMME (refonte des écrans, 09/2026), parce
              que les deux écrans nomment la MÊME position : macro en retrait,
              bloc et semaine en aplat doré, nom auto-généré en mono. Les trois
              niveaux tenaient dans une seule pastille — « Macro 4 > Bloc 1 > S2 »
              — où rien ne disait lequel était lequel. */}
          <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-2">
            <span className={cn('rounded bg-muted px-2 py-1 text-[12px] text-muted-foreground',
                                macroAuto && 'font-mono')}>
              {macroLabel}
            </span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className={cn('rounded-md bg-gold px-2.5 py-1 text-gold-foreground',
                                blockAuto ? 'font-mono text-[13px]'
                                          : 'font-display text-[15px] font-bold uppercase leading-none')}>
              {blockLabel}
            </span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="rounded-md bg-gold px-2.5 py-1 font-mono text-[13px] font-semibold text-gold-foreground">
              {weekLabel}
            </span>
            <span className="ml-1 text-xs text-muted-foreground">{dateLabel}</span>
          </div>
        </div>

        {/* ⚠️ PLEINE LARGEUR ET 48 px SOUS `sm`. C'est l'action principale de
            l'écran pour un athlète, et c'était un petit bouton en haut à droite
            d'une carte — le dernier endroit où un pouce va le chercher. */}
        <button
          type="button"
          onClick={onGoTraining}
          className={cn(
            'flex h-12 w-full items-center justify-center gap-1.5 rounded-md bg-gold px-3 text-sm font-semibold text-gold-foreground shadow-sm transition-colors hover:bg-gold/90',
            'ring-1 ring-gold/20 sm:h-8 sm:w-auto sm:text-xs',
          )}
        >
          <Dumbbell className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
          {t('dashboard.train')}
          <ArrowRight className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
        </button>
      </div>

      <div className="mt-4 border-t border-border/60 pt-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t('objectives.title')}
          </span>
          <CompteurAtteints atteints={atteints} total={objectives.length} />
        </div>
        {objectives.length > 0 ? (
          /* ⚠️ LA MÊME CARTE QUE LA VUE ENTRAÎNEMENT, importée et non recopiée.
             Cet écran rendait la même liste en pastilles plates grises ; deux
             écrans qui montrent la même donnée doivent la montrer pareil, sinon
             ils divergent au premier changement de style.

             ⚠️ ET ON NE DÉDUPLIQUE RIEN. Les doublons apparents — SQUAT deux
             fois, DIPS deux fois — sont de VRAIES données : deux schémas de
             séries sur le même mouvement. En pastilles plates ça ressemblait à un
             bug ; en cartes, le schéma se lit et la question ne se pose plus. */
          <>
            <ul className="mt-3 grid grid-cols-1 gap-1.5 lg:grid-cols-3">
              {objectives.map((o, i) => (
                /* ⚠️ LA COUPURE EST EN CSS, PAS EN JAVASCRIPT. Sur bureau les
                   trois colonnes les montrent tous ; sur téléphone, une colonne
                   de six cartes pousserait la forme du jour et la Table RM hors
                   de portée. Passer par `matchMedia` ferait dépendre le rendu
                   d'un état qui ne survit pas au premier redimensionnement — ici
                   c'est la feuille de style qui tranche, et le compte au-dessus
                   dit de toute façon combien il y en a. */
                <Cadre key={i} atteint={!!o.atteintLe} className={i >= 3 ? 'hidden lg:block' : undefined}>
                  <CarteObjectif o={o} peutEcrire={false} />
                </Cadre>
              ))}
            </ul>
            {objectives.length > 3 && (
              <p className="mt-1.5 px-1 font-mono text-[10px] text-muted-foreground lg:hidden">
                {t('views.nAutres', { count: objectives.length - 3 })}
              </p>
            )}
          </>
        ) : (
          <div className="mt-2 text-sm italic text-muted-foreground">{t('dashboard.noObjectives')}</div>
        )}
      </div>
    </section>
  );
}
