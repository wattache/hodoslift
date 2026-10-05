import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { SessionEditing } from '@/api/types';
import { renderExerciseImage } from '@/lib/exercise-share';
import { shareFileName } from '@/lib/session-share';
import { ShareImageDialog } from './share-image-dialog';
import type { ProgressionPoint } from './exercise-progression-data';

/** Partage de la PROGRESSION d'un exercice sur le bloc.
 *
 *  Rien à partager sous deux points renseignés : une progression d'un seul
 *  point n'en est pas une, et le bouton promettrait plus que l'image ne
 *  donnerait. */
export function ShareExerciseDialog({ session, points, name, detail, contextLabel }: {
  session: SessionEditing;
  points: ProgressionPoint[];
  name: string;
  detail?: string;
  contextLabel?: string;
}) {
  const { t } = useTranslation();
  const render = useCallback(
    () => renderExerciseImage({ points, name, detail, contextLabel }),
    [points, name, detail, contextLabel],
  );

  if (points.filter(p => p.kgEffective !== null).length < 2) return null;

  return (
    <ShareImageDialog
      render={render}
      fileName={shareFileName(session, `${name}-progression`)}
      title={`${name} — ${contextLabel ?? ''}`.trim().replace(/—$/, '').trim()}
      triggerTitle={t('share.exercise')}
    />
  );
}
