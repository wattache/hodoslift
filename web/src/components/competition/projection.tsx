import i18n from '@/i18n';
import { TIER_DEFS } from '@/lib/comp-helpers';
import type { Participant } from './types';

/** Les totaux P, R et O vers lesquels l'athlète se dirige (FRE-203).
 *
 *  Servis par brokkr, qui les recalcule à chaque enregistrement de la feuille :
 *  ils suivent le clic d'environ une seconde. Tus quand ils égalent tous le
 *  total — plus rien à venir, plus rien à projeter. */
export function ProjectionInline({ projection, score }: { projection?: Participant['projection']; score: number }) {
  if (!projection || TIER_DEFS.every(d => projection[d.id] === score)) return null;
  return (
    <div className="mt-0.5 flex justify-end gap-1 whitespace-nowrap font-mono text-[10px] tabular-nums text-muted-foreground"
         aria-label={i18n.t('competition.projection')}>
      {TIER_DEFS.map(d => (
        <span key={d.id} title={d.full}>
          <span className="font-semibold text-foreground/70">{d.label}</span> {projection[d.id]}
        </span>
      ))}
    </div>
  );
}
