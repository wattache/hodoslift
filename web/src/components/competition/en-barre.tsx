import { useId, useState } from 'react';
import { Check, Video, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { TIER_DEFS, plancherDAnnonce } from '@/lib/comp-helpers';
import { getNorepReasons, norepLabel, type Reglement } from '@/lib/norep-reasons';
import { annonceLibre, annoncer, planDeLEssai } from '@/lib/plateau';
import { cn } from '@/lib/utils';
import type { Attempt, Tier } from './types';

/** La saisie d'un essai : l'annonce (le plan P / R / O, ou une charge hors plan
 *  par le `±`) et le verdict. Portée par la carte de l'athlète (FRE-225).
 *
 *  ⚠️ ANNONCER, C'EST CHOISIR UN TIER, ou poser une charge hors plan par le `±`.
 *  Le plan, lui, se prépare dans les Feuilles. Chaque geste passe par
 *  `lib/plateau`, qui refuse ce que brokkr refuserait : une annonce sous le
 *  plancher n'est jamais envoyée. */
export function Annonce({ attempts, ai, canWrite, onChange }: {
  attempts: Attempt[]; ai: number; canWrite: boolean; onChange: (a: Attempt) => void;
}) {
  const { t } = useTranslation();
  const idRefus = useId();
  const attempt = attempts[ai];
  const plan = planDeLEssai(attempts, ai);
  // Sans plan, rien à choisir : la charge se saisit d'emblée.
  const sansPlan = TIER_DEFS.every(d => !(plan[d.id] > 0));
  const [libreOuverte, setLibreOuverte] = useState(sansPlan);
  const plancher = plancherDAnnonce(attempts, ai);
  const refusees = TIER_DEFS.filter(d => attempt.selectedTier !== d.id && plan[d.id] > 0 && plan[d.id] < plancher);

  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted-foreground">{t('competition.chargeAnnonceeTitre')}</span>
        {plancher > 0 && <span className="font-mono text-xs text-muted-foreground">{t('competition.plancher', { charge: plancher })}</span>}
      </div>
      <div role="group" aria-label={t('competition.chargesDuPlan')} className="mt-2 grid grid-cols-[repeat(3,minmax(0,1fr))_auto] gap-2">
        {TIER_DEFS.map(d => {
          const choisi = attempt.selectedTier === d.id;
          const propre = attempt.weights?.[d.id as Tier] ?? 0;
          const refuse = refusees.includes(d);
          const possible = canWrite && (choisi || annoncer(attempts, ai, d.id) !== null);
          return (
            <div key={d.id}>
              <button type="button" disabled={!possible} aria-pressed={choisi} title={d.full}
                      aria-describedby={refuse ? idRefus : undefined}
                      onClick={() => { const a = annoncer(attempts, ai, d.id); if (a) onChange(a); }}
                      className={cn('flex h-[54px] w-full flex-col items-center justify-center rounded-lg border font-mono',
                        choisi ? 'border-gold bg-gold/15 text-gold' : 'border-border bg-muted/30 text-foreground',
                        !possible && !choisi && 'opacity-40')}>
                <span className={cn('text-lg font-semibold tabular-nums', !propre && !choisi && 'text-muted-foreground')}>{plan[d.id] > 0 ? plan[d.id] : '—'}</span>
                <span className="text-[10px]">{d.label}</span>
              </button>
            </div>
          );
        })}
        {canWrite && (
          <button type="button" onClick={() => setLibreOuverte(o => !o)} aria-expanded={libreOuverte}
                  aria-label={t('competition.saisieLibre')} title={t('competition.saisieLibre')}
                  className={cn('flex h-[54px] w-12 items-center justify-center rounded-lg border border-dashed text-lg',
                    libreOuverte ? 'border-gold text-gold' : 'border-border text-muted-foreground')}>
            ±
          </button>
        )}
      </div>
      {refusees.length > 0 && (
        <p id={idRefus} className="mt-1.5 text-xs text-muted-foreground">{t('competition.annonceEnBaisse', { plancher })}</p>
      )}
      {sansPlan && canWrite && <p className="mt-1.5 text-xs text-muted-foreground">{t('competition.sansPlan')}</p>}
      {libreOuverte && canWrite && (
        <SaisieLibre attempts={attempts} ai={ai} plancher={plancher} focus={!sansPlan}
                     onAnnonce={a => { onChange(a); setLibreOuverte(false); }} />
      )}
    </div>
  );
}

/** Une charge hors plan, soumise au même plancher que les tiers. */
function SaisieLibre({ attempts, ai, plancher, focus, onAnnonce }: {
  attempts: Attempt[]; ai: number; plancher: number;
  /** Le focus seulement quand on l'ouvre par le `±` : ouverte d'office, elle ne le vole pas. */
  focus: boolean;
  onAnnonce: (a: Attempt) => void;
}) {
  const { t } = useTranslation();
  const [valeur, setValeur] = useState('');
  const [refus, setRefus] = useState(false);
  const idRefus = useId();
  const valider = () => {
    const a = annonceLibre(attempts, ai, parseFloat(valeur.replace(',', '.')));
    if (!a) { setRefus(true); return; }
    onAnnonce(a);
  };
  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <Input value={valeur} inputMode="decimal" autoFocus={focus} aria-label={t('competition.chargeHorsPlan')}
               aria-invalid={refus} aria-describedby={refus ? idRefus : undefined}
               placeholder={t('competition.chargeHorsPlan')}
               onChange={e => { setValeur(e.target.value); setRefus(false); }}
               onKeyDown={e => { if (e.key === 'Enter') valider(); }}
               className="h-11 flex-1 font-mono text-base lg:text-sm" />
        <button type="button" onClick={valider}
                className="h-11 rounded-lg bg-gold px-4 text-sm font-semibold text-gold-foreground hover:bg-gold/90">
          {t('competition.annoncer')}
        </button>
      </div>
      {refus && (
        <p id={idRefus} role="alert" className="mt-1 text-xs text-destructive">
          {plancher > 0 ? t('competition.annonceEnBaisse', { plancher }) : t('competition.chargeIllisible')}
        </p>
      )}
    </div>
  );
}

export function Verdict({ attempt, mouvement, reglement, onVerdict, onMotif, onVar }: {
  attempt: Attempt; mouvement: string; reglement: Reglement;
  onVerdict: (v: 'rep' | 'norep') => void; onMotif: (motif: string) => void; onVar: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-3">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" aria-pressed={attempt.result === 'rep'} onClick={() => onVerdict('rep')}
                className={cn('flex h-14 items-center justify-center gap-1.5 rounded-lg text-lg font-bold',
                  attempt.result === 'rep' ? 'bg-success text-white' : 'bg-muted/50 text-foreground hover:text-success')}>
          <Check className="h-5 w-5" /> REP
        </button>
        <button type="button" aria-pressed={attempt.result === 'norep'} onClick={() => onVerdict('norep')}
                className={cn('flex h-14 items-center justify-center gap-1.5 rounded-lg text-lg font-bold',
                  attempt.result === 'norep' ? 'bg-destructive text-white' : 'bg-muted/50 text-foreground hover:text-destructive')}>
          <X className="h-5 w-5" /> NO REP
        </button>
      </div>
      {/* Un MENU DÉROULANT : treize motifs en pastilles ne se lisaient plus (William, 24/09). */}
      {attempt.result === 'norep' && (
        <select value={attempt.norepReason || 'unknown'} aria-label={t('competition.motifDuNoRep')}
                onChange={e => onMotif(e.target.value)}
                className="mt-2 h-11 w-full rounded-lg border border-border bg-background px-3 text-base outline-none focus:border-gold xl:text-sm">
          {getNorepReasons(mouvement, reglement).map(r => (
            <option key={r.id} value={r.id}>{r.auto ? '⚠ ' : ''}{norepLabel(r.id)}</option>
          ))}
        </select>
      )}
      {/* La VAR a été consultée : un fait vrai sur un rep comme sur un no rep. */}
      {attempt.result !== '' && (
        <button type="button" aria-pressed={!!attempt.varUsed} onClick={() => onVar(!attempt.varUsed)}
                className={cn('mt-2 flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold',
                  attempt.varUsed ? 'border-gold bg-gold/15 text-gold' : 'border-border text-muted-foreground hover:border-gold/40 hover:text-foreground')}>
          <Video className="h-4 w-4" /> {t('competition.var')}
        </button>
      )}
    </div>
  );
}
