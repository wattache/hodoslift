import { useTranslation } from 'react-i18next';

import type { RenduProgression } from '@/api/types';
import { RENDUS_AU_CHOIX } from '@/lib/preference-progression';
import type { ProgressionPoint } from '../exercise-progression-data';
import { cn } from '@/lib/utils';
import { RenduChiffres } from './chiffres';
import { RenduCourbe } from './courbe';
import { Silhouette } from './silhouettes';
import { trajectoireEnMots } from './socle';

/** UN COMPOSANT, UN PARAMÈTRE : `<ProgressionBloc points rendu />`, et un rendu
 *  = un petit composant qui reçoit les mêmes `ProgressionPoint[]`. Changer de
 *  rendu ne recharge rien : mêmes points, autre dessin.
 *
 *  Deux rendus, pas neuf (William, 28/09) : la courbe — la carte telle qu'elle
 *  est — et les chiffres, sa vue tableau. Le vocabulaire est celui de brokkr. */
export function ProgressionBloc({ points, rendu, courante = -1 }: {
  points: ProgressionPoint[];
  rendu: RenduProgression;
  /** L'index de la semaine en cours dans `points` ; −1 sans. */
  courante?: number;
}) {
  const { t } = useTranslation();
  return (
    <div data-rendu={rendu} role="img" aria-label={trajectoireEnMots(points, t)} className="flex flex-col gap-2.5">
      {rendu === 'chiffres' ? <RenduChiffres points={points} courante={courante} /> : <RenduCourbe points={points} courante={courante} />}
    </div>
  );
}

/** LE RÉGLAGE RAPIDE — dans l'en-tête de la carte, les mêmes silhouettes en
 *  26 px : on essaie un rendu là où on le lit, sans quitter la séance. C'est le
 *  chemin principal ; le profil ne fait que refléter le dernier choix. */
export function SelecteurDeRendu({ rendu, onChoisir }: {
  rendu: RenduProgression;
  onChoisir: (rendu: RenduProgression) => void;
}) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={t('progression.affichage')} className="flex items-center gap-1">
      {RENDUS_AU_CHOIX.map(r => {
        const actif = r === rendu;
        return (
          <button key={r} type="button" aria-pressed={actif} aria-label={t(`progression.rendus.${r}.nom`)} title={t(`progression.rendus.${r}.nom`)}
                  onClick={() => onChoisir(r)}
                  className={cn('flex h-[26px] w-[30px] items-center justify-center rounded-md border transition-colors',
                                actif ? 'border-gold/70 bg-gold/15 text-gold' : 'border-border text-muted-foreground hover:text-foreground')}>
            <Silhouette rendu={r} className="h-3 w-[18px]" />
          </button>
        );
      })}
    </div>
  );
}
