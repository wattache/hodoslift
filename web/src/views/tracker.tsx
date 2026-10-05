import { useEffect, useMemo, useState } from 'react';
import { Droplets, Flame, Moon, Scale } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useDailyLogs, usePatchDailyLog } from '@/api/hooks/use-daily-logs';
import type { CyclePhase, DailyLogEntry } from '@/api/types';
import { useFormeParJour } from '@/api/hooks/use-forme';
import { useAthleteSelection } from '@/lib/athlete-selection';
import { PHASES } from '@/lib/cycle';
import { addDays, todayISO } from '@/lib/dates-ui';
import { cn } from '@/lib/utils';
import { DatePicker } from '@/components/ui/date-picker';
import { DailyChart } from '@/components/dashboard/daily-chart';
import { SeriesDeLAthlete, TrackingChart } from '@/components/dashboard/tracking-chart';
import { useLocalStorageState } from '@/lib/storage';
import { BlocEnTableau } from '@/components/tracker/bloc-en-tableau';
import { PoidsParSemaine } from '@/components/tracker/poids-par-semaine';
import { toastSaveError } from '@/lib/save-error';

/** Vue Tracker — le QUOTIDIEN d'un athlète, puis sa progression.
 *
 *  Saisie réservée à l'athlète lui-même (autz brokkr `owner`) : pour le coach,
 *  la carte de saisie disparaît et il ne reste que la lecture.
 *
 *  REMANIÉE LE 17/08 — l'onglet Tracking a fusionné ici, et six graphes sont
 *  partis. Ce n'était pas un arbitrage esthétique : `TonnageCharts` recalculait
 *  CÔTÉ CLIENT, depuis l'arbre d'entraînement complet, ce que le Tracking
 *  obtient du serveur en un appel — tonnage par mouvement, charge max, RPE,
 *  volume total. Deux réponses à la même question, dont une plus lente et
 *  moins juste (elle ne distingue pas le réalisé du prescrit).
 *
 *  Ce qui reste tient en une phrase : les données JOURNALIÈRES (poids,
 *  sommeil, eau, calories, forme du jour), puis la progression.
 *
 *  ⚠️ La forme du jour ne vient PAS de `dailyLogs` — elle est portée par la
 *  SÉANCE (`session.formOfTheDay`, saisie au lancement), et sa date se replie
 *  sur le début de semaine. Cette règle vit désormais dans brokkr, une fois
 *  (FRE-119) : cet écran lit `useFormeParJour`, comme le Dashboard et le Détail
 *  athlète, au lieu d'extraire les points de l'arbre d'entraînement. */

const METRICS = [
  { key: 'weight', labelKey: 'tracker.weight', unit: 'kg', icon: Scale, color: 'var(--serie-poids)', step: 0.1, max: 250 },
  { key: 'sleep', labelKey: 'tracker.sleep', unit: 'h', icon: Moon, color: 'var(--serie-sommeil)', step: 0.5, max: 16 },
  { key: 'water', labelKey: 'tracker.water', unit: 'L', icon: Droplets, color: 'var(--serie-eau)', step: 0.25, max: 10 },
  // Pas d'incrément fin : on saisit un total de journée, pas une pesée.
  { key: 'calories', labelKey: 'tracker.calories', unit: 'kcal', icon: Flame, color: 'var(--serie-calories)', step: 50, max: 10000 },
] as const;

type MetricKey = (typeof METRICS)[number]['key'];
// ⚠️ DÉRIVÉ DU CONTRAT (`Pick<DailyLogEntry, MetricKey>`) et non redécrit : le
// serveur rend ces champs `number | null` — absents quand rien n'est saisi,
// jamais `undefined`. Les redéclarer en `number` obligeait à convertir à chaque
// usage, et laissait le type mentir sur ce qui arrive vraiment (FRE-70).
type LogRow = { date: string } & Pick<DailyLogEntry, MetricKey | 'cycle'>;

function buildLast(days: number, byDate: Record<string, Omit<LogRow, 'date'>>): LogRow[] {
  const start = addDays(todayISO(), -(days - 1));
  return Array.from({ length: days }, (_, i) => {
    const d = addDays(start, i);
    return { date: d, ...(byDate[d] ?? {}) };
  });
}

/** Input numérique avec brouillon local, commit au blur. */
function MetricInput({ value, step, max, onCommit }: {
  // `| null` : le contrat rend la mesure nullable, et `value != null` traite déjà
  // les deux absences de la même façon — champ vide.
  value: number | null | undefined;
  step: number;
  max: number;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState<string>(value != null ? String(value) : '');
  useEffect(() => {
    setDraft(value != null ? String(value) : '');
  }, [value]);

  const commit = () => {
    if (draft === '') return;
    const n = Math.max(0, Math.min(max, parseFloat(draft.replace(',', '.'))));
    if (!Number.isNaN(n) && n !== value) onCommit(n);
  };

  return (
    <input
      type="number"
      min={0}
      max={max}
      step={step}
      value={draft}
      placeholder="—"
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className="h-8 w-20 rounded-md border border-border bg-background px-2 text-center font-mono text-sm tabular-nums focus:border-[var(--gold)] focus:outline-none"
    />
  );
}

const SOUS_ONGLETS = ['poids', 'charge', 'bloc', 'series'] as const;
type SousOnglet = (typeof SOUS_ONGLETS)[number];

export function TrackerView() {
  const { t } = useTranslation();
  const sel = useAthleteSelection();
  const athleteId = sel.canView ? (sel.selected?.id ?? null) : null;
  const [range, setRange] = useState<14 | 30 | 60>(30);
  const [onglet, setOnglet] = useLocalStorageState<SousOnglet>(
    'ff-tracker-onglet', 'charge', (v) => SOUS_ONGLETS.includes(v));

  // Fenêtre chargée = la plus large proposée (60 j) : le range n'est qu'un zoom.
  const { data: logsByDate = {} } = useDailyLogs(athleteId, 60);
  // Fenêtre la plus large, comme les logs : le range n'est qu'un zoom.
  const { data: formePoints = [] } = useFormeParJour(athleteId, 60);
  const patchLog = usePatchDailyLog(athleteId);

  const series = useMemo(() => buildLast(range, logsByDate), [range, logsByDate]);

  // Date saisie — aujourd'hui par défaut, mais rattrapable. Bornée à aujourd'hui.
  const [entryDate, setEntryDate] = useState(todayISO());
  const isToday = entryDate === todayISO();
  const entry: LogRow = { date: entryDate, ...(logsByDate[entryDate] ?? {}) };
  // `== null` attrape l'absence ET le nul : depuis que le type vient du contrat,
  // les deux sont possibles et veulent dire la même chose — « pas saisi ».
  const missing = METRICS.filter(m => entry[m.key] == null);

  const canWrite = sel.isSelf;
  const commit = (key: MetricKey, n: number) =>
    patchLog.mutate(
      { date: entryDate, patch: { [key]: n } },
      { onError: toastSaveError },
    );
  // ⚠️ `null` FOURNI, pas la clé omise : c'est l'effacement (même règle que le
  // bloc kiné côté serveur). Re-cliquer la phase du jour la retire.
  const declarerLaPhase = (phase: CyclePhase | null) =>
    patchLog.mutate({ date: entryDate, patch: { cycle: phase } }, { onError: toastSaveError });

  if (!sel.selected) {
    return (
      <div className="mx-auto max-w-6xl rounded-lg border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
        {t('tracker.aucunAthleteSelectionne')}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex items-center justify-end">
        <div className="flex rounded-md border border-border/80 bg-card/80 p-0.5 shadow-[0_10px_28px_rgba(0,0,0,0.16)]">
          {[14, 30, 60].map(r => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r as 14 | 30 | 60)}
              className={cn(
                'rounded-sm px-2.5 py-1 text-[11px] font-medium transition-colors',
                range === r ? 'bg-gold text-gold-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {t('tracker.daysShort', { n: r })}
            </button>
          ))}
        </div>
      </div>

      {/* Saisie du jour — masquée pour qui ne la détient pas */}
      {canWrite && (
        <section className="rounded-xl border border-border/80 bg-card p-4 shadow-[0_16px_42px_rgba(0,0,0,0.16)]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">{isToday ? t('tracker.today') : t('tracker.catchUp')}</h2>
              <DatePicker
                value={entryDate}
                title={t('tracker.entryDay')}
                min={addDays(todayISO(), -59)}
                max={todayISO()}
                onChange={v => setEntryDate(v || todayISO())}
                className="h-7"
              />
              {!isToday && (
                <button
                  type="button"
                  onClick={() => setEntryDate(todayISO())}
                  className="text-[11px] text-muted-foreground underline hover:text-foreground"
                >
                  revenir à aujourd'hui
                </button>
              )}
            </div>
            <span className="text-[11px] text-muted-foreground">
              {missing.length === 0 ? t('tracker.allFilled') : t('tracker.toFill', { count: missing.length })}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {METRICS.map(m => {
              const val = entry[m.key];
              const Icon = m.icon;
              return (
                <div
                  key={m.key}
                  className="flex items-center justify-between rounded-lg border border-border/80 bg-background/45 px-3 py-2.5 transition-colors hover:border-gold/20"
                  style={{ boxShadow: `inset 3px 0 0 ${m.color}` }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-md"
                      style={{ background: `color-mix(in oklab, ${m.color} 16%, transparent)` }}
                    >
                      <Icon className="h-3.5 w-3.5" style={{ color: m.color }} />
                    </span>
                    <span className="text-xs font-medium">{t(m.labelKey)}</span>
                    <span className="text-[10px] text-muted-foreground">({m.unit})</span>
                  </div>
                  <MetricInput value={val} step={m.step} max={m.max} onCommit={n => commit(m.key, n)} />
                </div>
              );
            })}
          </div>

          {/* LA PHASE DU CYCLE — un fait du jour, comme la pesée (FRE-173). Elle
              vivait dans le calendrier comme un événement daté de… à…, et la
              seule entrée jamais saisie couvrait 117 jours. Ici : une phase par
              jour, ou rien — et « rien » ne vaut pas « menstruation ». */}
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border/80 bg-background/45 px-3 py-2.5"
               role="group" aria-label={t('tracker.cycle')} title={t('tracker.cycleAide')}>
            <span className="text-xs font-medium">{t('tracker.cycle')}</span>
            <div className="flex flex-wrap gap-1">
              {PHASES.map(p => {
                const active = entry.cycle === p.value;
                return (
                  <button key={p.value} type="button" aria-pressed={active}
                          onClick={() => declarerLaPhase(active ? null : p.value)}
                          className={cn('flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors',
                                        active ? 'border-gold bg-gold/15 text-foreground'
                                        : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground')}>
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                    {t(p.labelKey)}
                  </button>
                );
              })}
            </div>
            {entry.cycle == null && (
              <span className="text-[11px] text-muted-foreground">{t('tracker.cycleNonDeclare')}</span>
            )}
          </div>
        </section>
      )}

      {/* LE graphe journalier — cinq courbes, un cadre. Il remplace quatre
          cartes-sparkline et celle de la forme du jour : la question devant ces
          chiffres est « est-ce que ma forme baisse quand je dors moins ? », et
          y répondre demandait de comparer cinq vignettes de tête. */}
      {sel.canView && <DailyChart jours={series} logs={logsByDate} formePoints={formePoints} />}

      {/* ⚠️ TROIS SOUS-ONGLETS SOUS LE QUOTIDIEN (William, 17/09) : la page
          empilait le bloc en tableau, la charge + RPE et les séries par semaine,
          et il fallait défiler trois graphes pour atteindre celui qu'on venait
          voir. L'ordre reste celui des trois échelles — le mouvement, le bloc
          vécu, les lifts comparés — et « Charge & RPE » s'ouvre d'office.

          L'onglet choisi est une commodité de l'appareil (`localStorage`) : il
          ne dit rien de la donnée, et le perdre ne coûte qu'un clic. */}
      {sel.canView && athleteId && (
        <section className="flex flex-col gap-3">
          <div role="tablist" aria-label={t('tracker.sousOnglets')}
               className="inline-flex w-fit items-center gap-1 rounded-full border border-border bg-card p-1">
            {SOUS_ONGLETS.map((o) => (
              <button key={o} type="button" role="tab" aria-selected={onglet === o}
                onClick={() => setOnglet(o)}
                className={cn('rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                  onglet === o ? 'bg-gold text-gold-foreground' : 'text-muted-foreground hover:text-foreground')}>
                {t(`tracker.onglet.${o}`)}
              </button>
            ))}
          </div>
          {onglet === 'poids' && <PoidsParSemaine athleteId={athleteId} peutPoser={sel.isSelf || sel.canManage} />}
          {onglet === 'charge' && <TrackingChart athleteId={athleteId} />}
          {onglet === 'bloc' && <BlocEnTableau />}
          {onglet === 'series' && <SeriesDeLAthlete athleteId={athleteId} />}
        </section>
      )}

    </div>
  );
}
