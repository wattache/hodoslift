import { Dumbbell } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ExerciceDeDouleur } from '@/api/types';
import { libelleDExercice } from '@/lib/douleurs/libelles';
import { cn } from '@/lib/utils';

/** SUR QUELLE(S) LIGNE(S) DE SÉANCE UNE NOTE DE DOULEUR A ÉTÉ SIGNALÉE.
 *
 *  Une puce par ligne, et c'est la même puce partout — la carte, l'histoire, le
 *  guichet, le tableau des signalements — pour que « sur MUSCLE UP · 5×3 @ 6 kg »
 *  se lise pareil où qu'on le croise. Une ligne dont le lien s'est éteint
 *  (semaine régénérée) garde son cliché : elle se lit pareil, en plus discret. */
export function SurLaLigne({ exercices, className }: {
  exercices: readonly ExerciceDeDouleur[]; className?: string;
}) {
  const { t } = useTranslation();
  if (exercices.length === 0) return null;
  return (
    // Des puces en ligne, pas une liste : les écrans qui l'accueillent sont déjà
    // des listes de relevés, et une liste dans la liste brouillerait leur lecture.
    <div className={cn('flex flex-wrap gap-1.5', className)} role="group" aria-label={t('douleurs.surLaLigne')}>
      {exercices.map((e, i) => (
        <span key={e.exerciseId ?? `${e.name}-${i}`} data-sur-la-ligne
              className={cn('inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5',
                            'font-mono text-[11px] leading-5',
                            e.ligneVivante ? 'border-border text-foreground/90'
                                           : 'border-dashed border-border text-muted-foreground')}>
          <Dumbbell className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">{libelleDExercice(e)}</span>
        </span>
      ))}
    </div>
  );
}
