import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { SessionEditing } from '@/api/types';
import { renderSessionImage, shareFileName } from '@/lib/session-share';
import { ShareImageDialog } from './share-image-dialog';

/** Partage de la SÉANCE. Façade au-dessus de `ShareImageDialog` : seule la
 *  fonction de rendu change d'une image à l'autre. */
export function ShareSessionDialog({ session, athleteName, contextLabel }: {
  session: SessionEditing;
  /** Sert au titre du PARTAGE natif (invisible dans l'image). */
  athleteName: string;
  contextLabel?: string;
}) {
  const { t } = useTranslation();
  const render = useCallback(
    () => renderSessionImage({ session, contextLabel }),
    [session, contextLabel],
  );
  return (
    <ShareImageDialog
      render={render}
      fileName={shareFileName(session)}
      title={`${session.name} — ${athleteName}`}
      triggerTitle={t('share.title')}
    />
  );
}
