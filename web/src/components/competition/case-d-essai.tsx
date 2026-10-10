import { useTranslation } from 'react-i18next';
import { TIER_DEFS, chargeAnnoncee } from '@/lib/comp-helpers';
import { planDeLEssai } from '@/lib/plateau';
import { cn } from '@/lib/utils';
import type { Attempt } from './types';

type EtatDeCase = 'rep' | 'norep' | 'enBarre' | 'prevu';

function etatDeCase(attempt: Attempt, duTourAffiche: boolean): EtatDeCase {
  if (attempt.result === 'rep') return 'rep';
  if (attempt.result === 'norep') return 'norep';
  return duTourAffiche ? 'enBarre' : 'prevu';
}

// Les teintes du brief, portées par les jetons du thème pour tenir aussi en clair.
const STYLE: Record<EtatDeCase, string> = {
  rep: 'border-success bg-success/15 text-success',
  norep: 'border-destructive bg-destructive/15 text-destructive',
  enBarre: 'border-gold bg-gold/10 text-foreground',
  prevu: 'border-border bg-muted/40 text-muted-foreground',
};

/** Une case de la feuille : la charge qu'un essai montre (`chargeAnnoncee`), la
 *  lettre du tier annoncé, et son état.
 *
 *  ⚠️ Sans droit d'écriture, la case n'est PAS un bouton : elle sort de la
 *  tabulation au lieu d'être seulement désactivée. L'état se dit aussi dans le
 *  libellé accessible, jamais par la seule couleur. */
export function CaseDEssai({ nom, mouvement, attempts, ai, duTourAffiche, selectionnee, cliquable, onSelect, grande = false }: {
  nom: string;
  mouvement: string;
  attempts: Attempt[];
  ai: number;
  duTourAffiche: boolean;
  selectionnee: boolean;
  cliquable: boolean;
  onSelect: () => void;
  grande?: boolean;
}) {
  const { t } = useTranslation();
  const attempt = attempts[ai];
  const charge = chargeAnnoncee(attempts, ai);
  const etat = etatDeCase(attempt, duTourAffiche);
  const tier = TIER_DEFS.find(d => d.id === attempt.selectedTier);
  // La lettre dit QUEL tier est annoncé ; sans annonce, la charge montrée est le R du plan.
  const lettre = tier?.label ?? (charge > 0 ? 'R' : '');
  const label = charge > 0
    ? t('competition.caseAria', { nom, mouvement, essai: ai + 1, etat: t(`competition.etat.${etat}`), charge })
    : t('competition.caseAriaSansCharge', { nom, mouvement, essai: ai + 1, etat: t(`competition.etat.${etat}`) });

  // ⚠️ UN ESSAI À VENIR MONTRE SES TROIS CHARGES, pas la seule réaliste : le
  // choix se fait à la barre, entre les trois (FRE-225). Dès qu'un tier est
  // annoncé ou l'essai jugé, la case ne montre plus que ce qui compte.
  const plan = grande && !attempt.result && !tier ? planDeLEssai(attempts, ai) : null;
  const troisCharges = plan && TIER_DEFS.some(d => plan[d.id] > 0);
  // ⚠️ SUR UN TÉLÉPHONE, trois charges côte à côte ne tiennent pas dans un
  // tiers de l'écran (« 3532.5 » : les cases se chevauchaient). En étroit, le
  // R porte la case et P/O se lisent en dessous, sur une ligne.
  const contenu = troisCharges ? (
    <>
      <div className="hidden items-end gap-2 sm:flex">
        {TIER_DEFS.map(d => (
          <span key={d.id} className={cn('flex flex-col items-center gap-0.5', d.id !== 'realistic' && 'opacity-60')}>
            <span className={cn('font-mono tabular-nums leading-none', d.id === 'realistic' ? 'text-base font-semibold' : 'text-xs')}>
              {plan[d.id] > 0 ? plan[d.id] : '—'}
            </span>
            <span className="font-mono text-[9px] leading-none">{d.label}</span>
          </span>
        ))}
      </div>
      <div className="flex flex-col items-center gap-0.5 sm:hidden">
        <span className="font-mono text-base font-semibold tabular-nums leading-none">{plan.realistic > 0 ? plan.realistic : '—'}</span>
        <span className="whitespace-nowrap font-mono text-[9px] leading-none opacity-60">
          {plan.pessimistic > 0 ? plan.pessimistic : '—'} P · {plan.optimistic > 0 ? plan.optimistic : '—'} O
        </span>
      </div>
    </>
  ) : (
    <>
      <span className={cn('font-mono font-semibold tabular-nums leading-none', grande ? 'text-base' : 'text-xs')}>{charge > 0 ? charge : '—'}</span>
      {lettre && (
        <span className={cn('font-mono text-[9px] leading-none', tier ? 'text-gold' : 'opacity-60')}>{lettre}</span>
      )}
    </>
  );
  const classes = cn(
    'flex flex-col items-center justify-center gap-0.5 rounded-md border',
    grande ? 'h-14 min-w-0 flex-1 overflow-hidden px-0.5' : 'h-11 w-10 shrink-0',
    STYLE[etat],
    selectionnee && 'border-2 border-gold',
  );

  if (!cliquable) return <div className={classes} aria-label={label} role="img">{contenu}</div>;
  return (
    <button type="button" className={cn(classes, 'hover:border-gold/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold')}
            aria-label={label} aria-pressed={selectionnee} onClick={onSelect}>
      {contenu}
    </button>
  );
}
