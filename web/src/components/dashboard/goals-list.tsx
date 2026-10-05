import { useEffect, useMemo, useState } from 'react';
import { Calendar, Check, ChevronDown, Eye, Pencil, Plus, Quote, Target, Trophy, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Goal, OneRepMax, RecordDeForce } from '@/api/types';
import { ecartDeLObjectif, lePlusProche, type EcartObjectif } from '@/lib/ecart-objectif';
import { MOVEMENT_TO_ORM, PRINCIPAL_MOVEMENTS, type PrincipalMovement } from '@/lib/constants';
import { todayIso } from '@/lib/dates';
import { formatShort } from '@/lib/dates-ui';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/components/ui/confirm-dialog';

interface Props {
  goals: Goal[];
  /** ⚠️ LES RECORDS, POUR DIRE LA DISTANCE. `dashboard.tsx` les a déjà — il les
   *  passe à `AllTimePrTable` juste au-dessus. Une prop, aucune donnée nouvelle,
   *  aucun appel : c'est ce qui permet d'écrire « 20 visé, 15 aujourd'hui, +5 »
   *  au lieu de « muscle up 1 @ 20 », qui ne dit rien. */
  records?: RecordDeForce[];
  manualPRs?: Record<string, Record<number, number>>;
  /** ⚠️ ET LES RECORDS DE COMPÉTITION, qui manquaient au premier jet : 33 des 44
   *  objectifs ouverts visent un single, et c'est précisément ce que la
   *  compétition apporte. Calculés par `dashboard.tsx`, comme pour la grille. */
  competitionPRs?: Partial<Record<string, { weight: number }>>;
  /** Le 1RM courant, affiché en tête de groupe : il situe la cible. */
  oneRM?: OneRepMax;
  /** Persiste la liste complète (PUT). Absent = lecture seule. */
  onReplace?: (goals: Goal[]) => void;
  /** Les mouvements de COMPÉTITION, lus dans la bibliothèque (FRE-140).
   *
   *  ⚠️ ET PAS `PRINCIPAL_MOVEMENTS`, QUI ÉTAIT CODÉ EN DUR ICI. Depuis FRE-123,
   *  `athlete_goals.exercise` porte une clé étrangère vers la bibliothèque :
   *  proposer un nom qu'elle ne contient pas donne un 422 à l'enregistrement.
   *  La liste en dur et la bibliothèque disent la même chose AUJOURD'HUI (sept
   *  contre sept, mesuré le 08/09) — c'est FRE-147 qui vient de les réaligner,
   *  et le lot 4 de FRE-11 va renommer des mouvements. Une liste qui se recopie
   *  finit toujours par diverger de celle qui fait foi.
   *
   *  `library.tsx` fait déjà exactement ça : `lib.exercices.filter(e => e.competition)`. */
  mouvements: string[];
}

/** Objectifs de l'athlète — shape du contrat brokkr (strings, createdAt/achievedAt).
 *  Le « deadline » de l'ancien front a été retiré : jamais persisté (le champ
 *  n'existe pas côté serveur), sa saisie partait dans le vide. */
export function GoalsList({ goals: initialGoals, onReplace, mouvements,
                            records = [], manualPRs, competitionPRs, oneRM }: Props) {
  const { t } = useTranslation();
  const [goals, setGoals] = useState<Goal[]>(initialGoals);
  const [editMode, setEditMode] = useState(false);
  const canWrite = !!onReplace;

  useEffect(() => {
    setGoals(initialGoals);
  }, [initialGoals]);

  // Édition de champ : state local, persisté à la sortie du mode édition.
  const update = (id: string, patch: Partial<Goal>) =>
    setGoals(g => g.map(x => (x.id === id ? { ...x, ...patch } : x)));
  // Structurel (suppression/toggle) → persiste immédiatement.
  const remove = (id: string) => {
    if (!canWrite) return;
    setGoals(g => {
      const next = g.filter(x => x.id !== id);
      onReplace?.(next);
      return next;
    });
  };
  const toggleDone = (id: string) => {
    if (!canWrite) return;
    setGoals(g => {
      const next = g.map(x =>
        x.id === id
          ? { ...x, achievedAt: x.achievedAt ? undefined : todayIso() }
          : x,
      );
      onReplace?.(next);
      return next;
    });
  };
  /** ⚠️ SANS MOUVEMENT, ON NE PROPOSE PAS D'EN AJOUTER (FRE-157).
   *
   *  `exercise: mouvements[0] ?? ''` fabriquait un objectif à exercice VIDE tant
   *  que la bibliothèque n'avait pas répondu. Et comme l'enregistrement remplace
   *  la LISTE ENTIÈRE à la sortie du mode édition, brokkr refusait tout le lot en
   *  422 (`schemas/goals.py` : `min_length=1`, plus « exercise ne peut pas être
   *  vide ») — le coach perdait donc aussi les objectifs qu'il venait de
   *  corriger, pour un objectif vide qu'il n'avait pas voulu.
   *
   *  Le front ne propose une écriture que là où brokkr l'accepte : le bouton
   *  disparaît le temps du chargement plutôt que d'offrir un geste refusé. Et le
   *  `''` cesse de tenir lieu de « pas encore chargé », qui est le défaut le plus
   *  récurrent de ce projet. */
  const peutAjouter = mouvements.length > 0;
  const add = () => {
    if (!canWrite || !peutAjouter) return;
    setGoals(g => [
      ...g,
      {
        id: `g${Date.now()}`,
        exercise: mouvements[0],
        sets: '1',
        reps: '1',
        weight: '0',
        motivation: '',
        createdAt: todayIso(),
      },
    ]);
  };
  const toggleEditMode = () => {
    if (!canWrite) return;
    setEditMode(v => {
      if (v) onReplace?.(goals);
      return !v;
    });
  };

  const doneCount = goals.filter(g => g.achievedAt).length;

  const ecartDe = (g: Goal) => ecartDeLObjectif(g, records, manualPRs, competitionPRs);

  /** ⚠️ GROUPÉ PAR MOUVEMENT, ET TRIÉ PAR PROXIMITÉ DEDANS. Quatre lignes
   *  « MUSCLE UP » d'affilée se lisaient comme une répétition ; groupées sous
   *  leur mouvement et rangées du plus proche au plus lointain, elles deviennent
   *  une PROGRESSION — ce qu'elles sont.
   *
   *  ⚠️ ON NE DÉDUPLIQUE RIEN. Quatre cibles sur le muscle-up, c'est voulu : ce
   *  sont les paliers, pas des doublons. */
  const groupes = useMemo(() => {
    const par = new Map<string, Goal[]>();
    for (const g of goals) {
      const liste = par.get(g.exercise);
      if (liste) liste.push(g); else par.set(g.exercise, [g]);
    }
    for (const liste of par.values()) {
      liste.sort((a, b) => {
        // Les atteints en bas : ce sont des acquis, pas des paliers.
        if (!!a.achievedAt !== !!b.achievedAt) return a.achievedAt ? 1 : -1;
        const ea = ecartDe(a), eb = ecartDe(b);
        // « Pas de record » ne peut pas prétendre être proche : il ferme la
        // marche, sans prétendre non plus être le plus lointain.
        const d = (e: EcartObjectif) => (e.etat === 'mesure' ? e.restant : Number.POSITIVE_INFINITY);
        return d(ea) - d(eb);
      });
    }
    return [...par.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [goals, records, manualPRs, competitionPRs]);

  const proche = lePlusProche(goals.filter(g => !g.achievedAt), ecartDe);

  /** Le 1RM courant du mouvement, s'il en a un — il situe la cible sans qu'on
   *  aille le chercher dans la table au-dessus. */
  const oneRMDe = (mouvement: string): number | null => {
    const cle = PRINCIPAL_MOVEMENTS.find(
      m => m.toUpperCase() === mouvement.trim().toUpperCase()) as PrincipalMovement | undefined;
    const v = cle && oneRM ? oneRM[MOVEMENT_TO_ORM[cle]] : null;
    return v && v > 0 ? v : null;
  };

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
        {/* Le troisième tableau du bas d'écran porte le même titre que les deux
            autres : trois voisins dont l'un serait plus petit se liraient comme
            une hiérarchie qui n'existe pas. */}
        <h3 className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-display text-[19px] font-bold uppercase tracking-[0.01em] text-gold">
          <span className="flex items-center gap-2">
            <Target className="h-4 w-4 self-center" /> {t('goals.title')}
          </span>
          <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">
            {t('goals.atteintsSur', { n: doneCount, total: goals.length })}
          </span>
          {/* ⚠️ LE PLUS PROCHE, ANNONCÉ EN TÊTE. C'est ce qui transforme une liste
              de vœux en prochain palier : sans lui, neuf objectifs se valent et
              l'écran ne répond pas à « je travaille quoi maintenant ». */}
          {proche && (
            <span className="font-mono text-[11px] font-normal text-muted-foreground">
              {t('goals.lePlusProche', {
                objectif: `${proche.item.exercise.toLowerCase()} ${proche.item.reps || 1} @ ${proche.item.weight}`,
                kg: proche.ecart.restant,
              })}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-1">
          {canWrite && editMode && peutAjouter && (
            <button
              type="button"
              onClick={add}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Plus className="h-3 w-3" /> Ajouter
            </button>
          )}
          {canWrite && (
            <button
              type="button"
              onClick={toggleEditMode}
              className={cn(
                'flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
                editMode
                  ? 'bg-gold/15 text-gold hover:bg-gold/20'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {editMode ? (
                <><Eye className="h-3 w-3" /> {t('goals.preview')}</>
              ) : (
                <><Pencil className="h-3 w-3" /> {t('goals.edit')}</>
              )}
            </button>
          )}
        </div>
      </header>

      {goals.length === 0 ? (
        <div className="p-8 text-center">
          <Target className="mx-auto h-5 w-5 text-muted-foreground" />
          <p className="mt-2 text-xs text-muted-foreground">{t('goals.empty')}</p>
        </div>
      ) : editMode ? (
        <ul className="divide-y divide-border/60">
          {goals.map(g => (
            <GoalRowEdit key={g.id} goal={g} mouvements={mouvements}
                           onChange={patch => update(g.id, patch)} onRemove={() => remove(g.id)} />
          ))}
        </ul>
      ) : (
        <div className="divide-y divide-border/60">
          {groupes.map(([mouvement, liste]) => {
            const rm = oneRMDe(mouvement);
            return (
              <div key={mouvement}>
                <div className="flex flex-wrap items-baseline gap-x-2 bg-muted/20 px-4 py-1.5">
                  <span className="font-display text-[13px] font-bold uppercase tracking-[0.01em] text-gold">
                    {mouvement}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {t('goals.nObjectifs', { count: liste.length })}
                    {rm !== null && ` · ${t('goals.rmCourant', { kg: rm })}`}
                  </span>
                </div>
                <ul className="divide-y divide-border/40">
                  {liste.map(g => (
                    <GoalRowView key={g.id} goal={g} ecart={ecartDe(g)}
                                 onToggle={canWrite ? () => toggleDone(g.id) : undefined} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function schemaLabel(goal: Goal): { sets: string; reps: string; weight: string } {
  return { sets: goal.sets || '1', reps: goal.reps || '1', weight: goal.weight || '0' };
}

function GoalRowView({ goal, ecart, onToggle }: {
  goal: Goal; ecart: EcartObjectif; onToggle?: () => void;
}) {
  const { t } = useTranslation();
  const done = !!goal.achievedAt;
  const { sets, reps, weight } = schemaLabel(goal);

  return (
    <li className={cn('group relative px-4 py-3 transition-colors hover:bg-accent/20', done && 'bg-gold/[0.03]')}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onToggle?.()}
          disabled={!onToggle}
          className={cn(
            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all',
            done
              ? 'border-gold bg-gold text-gold-foreground shadow-[0_0_12px_-2px_var(--gold)]'
              : 'border-border hover:border-gold/60',
            !onToggle && 'cursor-default hover:border-border',
          )}
          title={onToggle ? (done ? 'Marquer non atteint' : 'Marquer atteint') : 'Lecture seule'}
        >
          {done && <Check className="h-3 w-3" strokeWidth={3} />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span
              className={cn(
                'font-mono text-sm font-bold uppercase tracking-wider',
                done ? 'text-muted-foreground line-through' : 'text-gold',
              )}
            >
              {goal.exercise}
            </span>
            <span className="font-mono text-xs tabular-nums text-foreground/80">
              {parseInt(sets, 10) > 1 ? `${sets}×` : ''}
              {reps} <span className="text-muted-foreground">@</span>{' '}
              <span className="font-bold">{weight}</span>
              <span className="text-[10px] text-muted-foreground">kg</span>
            </span>
            {done && <Trophy className="h-3 w-3 text-gold" />}

            {/* ⚠️ LA DISTANCE, ET C'EST TOUT CE QUI MANQUAIT. La barre se lit
                d'un coup d'œil ; le nombre dit combien il reste. Sur mobile elle
                passe sous la ligne (`w-full sm:w-auto`), la motivation en
                troisième. */}
            {ecart.etat === 'mesure' && !done && (
              <span className="flex w-full items-center gap-2 sm:w-auto">
                <span className="h-1 w-24 overflow-hidden rounded-full bg-muted">
                  <span className={cn('block h-full rounded-full',
                                      ecart.restant <= 0 ? 'bg-success' : 'bg-gold')}
                        style={{ width: `${Math.round(ecart.progression * 100)}%` }} />
                </span>
                <span className={cn('font-mono text-[11px] font-semibold tabular-nums',
                                    ecart.restant <= 0 ? 'text-success' : 'text-gold')}>
                  {ecart.restant <= 0 ? t('goals.depasse') : `+${ecart.restant}`}
                </span>
              </span>
            )}
            {/* ⚠️ « PAS DE RECORD » PLUTÔT QU'UN ÉCART CONTRE ZÉRO : on ne sait
                pas d'où l'athlète part sur ce schéma, et l'inventer donnerait un
                nombre faux qui se lit comme une mesure. */}
            {ecart.etat === 'sans-record' && !done && (
              <span className="font-mono text-[11px] text-muted-foreground">{t('goals.pasDeRecord')}</span>
            )}
          </div>

          {goal.motivation && (
            <p className="mt-1 flex items-start gap-1.5 text-[11px] italic leading-snug text-muted-foreground">
              <Quote className="mt-0.5 h-2.5 w-2.5 shrink-0 opacity-50" />
              <span>{goal.motivation}</span>
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end text-right">
          <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            <Calendar className="h-2.5 w-2.5" />
            {done ? t('goals.atteintLe', { date: formatShort(goal.achievedAt!) })
              : t('goals.depuisLe', { date: formatShort(goal.createdAt) })}
          </span>
        </div>
      </div>
    </li>
  );
}

function GoalRowEdit({ goal, mouvements, onChange, onRemove }: {
  mouvements: string[];
  goal: Goal;
  onChange: (patch: Partial<Goal>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const done = !!goal.achievedAt;
  return (
    <li className="group relative px-3 py-2.5 hover:bg-accent/20">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange({ achievedAt: done ? undefined : todayIso() })}
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors',
            done ? 'border-gold bg-gold text-gold-foreground' : 'border-border hover:border-gold/60',
          )}
        >
          {done && <Check className="h-2.5 w-2.5" />}
        </button>

        <div className="relative flex items-center gap-1">
          <select
            value={goal.exercise}
            onChange={e => onChange({ exercise: e.target.value })}
            className={cn(
              'appearance-none bg-transparent pr-5 font-mono text-xs font-bold uppercase tracking-wider outline-none',
              done ? 'text-muted-foreground line-through' : 'text-gold',
            )}
            style={{ minWidth: 110 }}
          >
            {/* ⚠️ LA VALEUR COURANTE EST TOUJOURS DANS LA LISTE, même si la
                bibliothèque ne la propose plus. Sans ça, un objectif posé sur un
                mouvement depuis retiré du flag `competition` s'afficherait vide,
                et le premier changement de N'IMPORTE QUEL autre champ le
                réécrirait en silence — le défaut du type d'événement `rest`,
                repris à l'identique. */}
            {(mouvements.includes(goal.exercise)
              ? mouvements
              : [goal.exercise, ...mouvements]).map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none -ml-5 h-3 w-3 text-muted-foreground" />
        </div>

        <NumInput value={goal.sets} onChange={v => onChange({ sets: v })} />
        <span className="text-muted-foreground">×</span>
        <NumInput value={goal.reps} onChange={v => onChange({ reps: v })} />
        <span className="text-muted-foreground">@</span>
        <NumInput value={goal.weight} onChange={v => onChange({ weight: v })} width={56} />
        <span className="text-[10px] text-muted-foreground">kg</span>

        <button
          type="button"
          onClick={async () => {
            if (await confirm({ title: t('goals.supprimerLObjectif', { nom: goal.exercise }) })) onRemove();
          }}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/50 opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
          title={t('common.delete')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <input
        type="text"
        value={goal.motivation}
        onChange={e => onChange({ motivation: e.target.value })}
        placeholder={t('goals.motivation')}
        className="mt-1 w-full bg-transparent pl-7 text-[11px] italic text-muted-foreground outline-none placeholder:text-muted-foreground/50 focus:text-foreground"
      />
    </li>
  );
}

function NumInput({ value, onChange, width = 40 }: { value: string; onChange: (v: string) => void; width?: number }) {
  return (
    <input
      inputMode="decimal"
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{ width }}
      className="h-7 rounded-md border border-border bg-background/60 px-1.5 text-center font-mono text-xs font-bold tabular-nums text-gold outline-none focus:border-gold"
    />
  );
}
