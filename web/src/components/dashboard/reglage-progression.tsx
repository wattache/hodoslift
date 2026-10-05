import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { LineChart } from 'lucide-react';

import { useTraining } from '@/api/hooks/use-training';
import type { Macrocycle, RenduProgression } from '@/api/types';
import { ExerciseProgressionCard } from '@/components/training/exercise-progression';
import { buildExerciseProgressionPoints, type ProgressionPoint } from '@/components/training/exercise-progression-data';
import { Silhouette } from '@/components/training/progression/silhouettes';
import { useAthleteSelection } from '@/lib/athlete-selection';
import { RENDUS_AU_CHOIX, usePreferenceProgression } from '@/lib/preference-progression';
import { cn } from '@/lib/utils';

/** LE RÉGLAGE DE LA PROGRESSION — UNE RANGÉE DE LA PAGE PROFIL, PAS UN ÉCRAN
 *  (brief progression, revu le 28/09). Des vignettes de la taille d'un bouton,
 *  et l'aperçu à la taille de la carte, sur les données de l'athlète. UNE
 *  préférence, celle de la personne qui regarde, vue partout : la carte porte
 *  le même sélecteur, le profil ne fait que refléter le dernier choix. */

export type Apercu = { points: ProgressionPoint[]; titre: string; courante?: string };

/** Le créneau qui montre le mieux : le plus de semaines CHARGÉES, dans le bloc
 *  le plus récent qui en a au moins deux. Sans lui, l'exemple du brief, dit tel. */
export function apercuDepuis(macros: Macrocycle[]): Apercu | null {
  for (const macro of [...macros].reverse()) {
    for (const block of [...macro.blocks].reverse()) {
      const weeks = block.weeks ?? [];
      if (weeks.length < 2) continue;
      const candidats = weeks.flatMap(week => (week.sessions ?? []).flatMap(session =>
        session.exercises.flatMap((ex, i) => {
          if (!(ex.name ?? '').trim()) return [];
          const points = buildExerciseProgressionPoints(session, i, weeks);
          const chargees = points.filter(p => p.kgEffective !== null).length;
          return chargees >= 2 ? [{ points, titre: ex.name ?? '', chargees }] : [];
        })));
      const meilleur = candidats.reduce<typeof candidats[number] | null>((m, c) => !m || c.chargees > m.chargees ? c : m, null);
      if (meilleur) {
        const derniereFaite = [...meilleur.points].reverse().find(p => p.rpeRaw.trim() || p.kgDone !== null);
        return { points: meilleur.points, titre: meilleur.titre, courante: derniereFaite?.label };
      }
    }
  }
  return null;
}

/** L'exemple du brief — PULL UP lesté, quatre semaines, une plus dure. */
const EXEMPLE: ProgressionPoint[] = [60, 62.5, 65, 67.5].map((kg, i) => ({
  label: `S${i + 1}`, sets: '3', reps: '2', repsDone: i === 2 ? '1' : '', repsUnit: 'count',
  kg, kgDone: i === 2 ? 62.5 : null, kgEffective: i === 2 ? 62.5 : kg, assistance: '',
  rest: '', restActual: '', variante: '', tempo: '',
  rpe: i < 3 ? (i === 2 ? 9 : 8) : null, rpeRaw: i < 3 ? (i === 2 ? '9' : '8') : '', aimedRpeRaw: '8', feedback: '',
}));

export function ReglageProgression() {
  const { t } = useTranslation();
  const sel = useAthleteSelection();
  const { data: macros = [] } = useTraining(sel.canView ? sel.selected?.programId : null);
  const apercu = useMemo<Apercu>(() => apercuDepuis(macros) ?? { points: EXEMPLE, titre: t('progression.reglage.apercuExemple'), courante: 'S4' }, [macros, t]);
  const { rendu, choisir, etat } = usePreferenceProgression();
  const enregistrement = {
    repos: '',
    enregistrement: t('progression.reglage.enregistrement'),
    enregistre: t('progression.reglage.enregistre'),
    echec: t('progression.reglage.echec'),
  }[etat];

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5" aria-labelledby="titre-reglage-progression">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="titre-reglage-progression" className="flex items-center gap-2 font-display text-lg font-bold uppercase tracking-tight">
          <LineChart className="h-4 w-4 text-gold" aria-hidden /> {t('progression.reglage.titre')}
        </h2>
        <span data-enregistrement={etat} role="status"
              className={cn('text-[12px]', etat === 'enregistre' ? 'text-success' : etat === 'echec' ? 'text-warning' : 'text-muted-foreground')}>
          {enregistrement}
        </span>
      </div>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">{t('progression.reglage.intro')}</p>

      {/* Trois par ligne au téléphone, une tuile d'environ 150 px sur grand écran. */}
      <div role="radiogroup" aria-label={t('progression.reglage.titre')} className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
        {RENDUS_AU_CHOIX.map((r: RenduProgression) => {
          const choisi = r === rendu;
          return (
            <button key={r} type="button" role="radio" aria-checked={choisi} onClick={() => choisir(r)}
                    className={cn('flex flex-col gap-1.5 rounded-lg border p-1.5 text-left transition-colors sm:w-[150px]',
                                  choisi ? 'border-gold bg-gold/10 text-gold' : 'border-border text-muted-foreground hover:bg-accent/40 hover:text-foreground')}>
              <span className="flex h-[52px] items-center justify-center rounded-md border border-border/70 bg-background px-2">
                <Silhouette rendu={r} className="h-10 w-[104px] max-w-full" />
              </span>
              <span className="flex items-center gap-1.5 px-0.5">
                <span aria-hidden className={cn('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2', choisi ? 'border-gold' : 'border-muted-foreground/60')}>
                  {choisi && <span className="h-1.5 w-1.5 rounded-full bg-gold" />}
                </span>
                <span className={cn('text-[13px] font-semibold', choisi ? 'text-foreground' : 'text-muted-foreground')}>{t(`progression.rendus.${r}.nom`)}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* L'aperçu, à la taille de la carte et pas plus large : ce qu'on vient de
          choisir, vu sur les données de la personne. */}
      <div data-apercu className="mt-3 max-w-[520px] rounded-lg border border-border/70 bg-background/40 p-2.5">
        <ExerciseProgressionCard points={apercu.points} rendu={rendu} semaineCourante={apercu.courante}
                                 title={`${t('progression.reglage.apercu')} · ${apercu.titre}`} />
      </div>
      <p className="mt-3 text-[12px] text-muted-foreground">{t('progression.reglage.chacunLeSien')}</p>
    </section>
  );
}
