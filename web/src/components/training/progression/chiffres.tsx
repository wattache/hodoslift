import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import type { ProgressionPoint } from '../exercise-progression-data';
import { chargeEcrite, ecartsDeCharge, pasEncoreFaite, rpeEcrit, signe, volumeEcrit } from './socle';

/** LE RENDU « CHIFFRES » — la grille, rien d'autre (brief progression, 27/09) :
 *  une colonne par semaine, séries × reps, charge, RPE, et la ligne « Écart »
 *  que la courbe fait deviner. Sans charge, c'est l'assistance qui s'écrit. */
export function RenduChiffres({ points, courante }: { points: ProgressionPoint[]; courante: number }) {
  const { t } = useTranslation();
  const ecarts = ecartsDeCharge(points);
  const libelle = 'font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground';
  const cellule = 'text-center font-mono text-[13px] leading-tight tabular-nums';
  return (
    <div className="grid gap-y-2" style={{ gridTemplateColumns: `minmax(48px, auto) repeat(${points.length}, minmax(0, 1fr))` }}>
      <span />
      {points.map((p, i) => (
        <span key={i} data-semaine className={cn(cellule, 'text-[11px]', i === courante ? 'font-semibold text-gold' : 'text-muted-foreground')}>{p.label}</span>
      ))}
      <span className={libelle}>{t('progression.seriesReps')}</span>
      {points.map((p, i) => {
        const v = volumeEcrit(p);
        return <span key={i} data-valeur-volume className={cn(cellule, v.includes('→') && 'font-semibold text-gold')}>{v || '—'}</span>;
      })}
      <span className={libelle}>{t('progression.charge')}</span>
      {points.map((p, i) => {
        const c = chargeEcrite(p);
        const aide = p.assistance.trim();
        return (
          <span key={i} data-valeur-charge={c.texte || aide ? true : undefined}
                className={cn(cellule, 'text-[15px]', c.ecart || pasEncoreFaite(p) ? 'font-semibold text-gold' : c.texte ? 'font-semibold' : aide ? 'text-gold' : 'text-muted-foreground')}>
            {c.texte || aide || '—'}
          </span>
        );
      })}
      <span className={libelle}>{t('base.rpe')}</span>
      {points.map((p, i) => {
        const r = rpeEcrit(p, t);
        return (
          <span key={i} data-valeur-rpe className={cn(cellule, r.vise ? 'text-muted-foreground' : 'font-semibold')} style={{ color: r.couleur }}>
            {r.texte}
          </span>
        );
      })}
      <span className={libelle}>{t('progression.ecart')}</span>
      {points.map((_, i) => {
        const e = ecarts[i];
        return (
          <span key={i} data-ecart className={cn(cellule, e === null ? 'text-muted-foreground' : e > 0 ? 'text-success' : e < 0 ? 'text-destructive' : 'text-muted-foreground')}>
            {e === null ? '—' : signe(e)}
          </span>
        );
      })}
    </div>
  );
}
