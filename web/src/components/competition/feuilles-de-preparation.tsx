import { Check, Trophy, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { BUMP_STEP, TIER_DEFS, chainedInheritedTiers, classementDuGroupe, flightsEnLice, plancherDAnnonce, type EffectiveTiers } from '@/lib/comp-helpers';
import { verdictBascule } from '@/lib/essai-competition';
import { formatRis, type RisGender } from '@/lib/ris-score';
import { cn } from '@/lib/utils';
import { ProjectionInline } from './projection';
import type { Attempt, Participant, SetAttempt, Tier } from './types';
import { nomDuGroupe } from './nom-du-groupe';

/** Les feuilles de match, une par athlète, toutes dépliées : la vue de
 *  PRÉPARATION. Chaque essai y montre ses trois charges P / R / O et se saisit
 *  sur place ; le Plateau, lui, sert le jour J. Ce que porte l'athlète — poids,
 *  genre, catégorie — se saisit dans « Groupes et athlètes », pas ici.
 *
 *  Rangées par groupe, dans l'ordre de passage, et au total dans chaque groupe. */
export function FeuillesDePreparation({ participants, flightNames, maxAttempts, setAttempt }: {
  participants: Participant[];
  flightNames: string[];
  maxAttempts: number;
  setAttempt: SetAttempt;
}) {
  const { t } = useTranslation();
  const avecGroupes = flightNames.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {flightsEnLice(participants, flightNames).map(flight => (
        <section key={flight ?? ''} className="flex flex-col gap-3">
          {avecGroupes && (
            <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-gold">
              {nomDuGroupe(t, flight)}
            </h3>
          )}
          {classementDuGroupe(participants, flight).map(({ p, i }, rank) => (
            <article key={i} className="overflow-hidden rounded-xl border border-border bg-card">
              <header className="flex items-center gap-3 border-b border-border bg-muted/20 px-4 py-2.5">
                <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold', rank === 0 ? 'bg-gold/20 text-gold' : 'bg-secondary text-muted-foreground')}>
                  {rank === 0 ? <Trophy className="h-3.5 w-3.5" /> : rank + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-semibold">{p.name}</h4>
                  <div className="text-[11px] text-muted-foreground">{[p.flight ? nomDuGroupe(t, p.flight) : null, p.weightCategory, p.bodyweight ? `${p.bodyweight} kg` : null].filter(Boolean).join(' · ') || '—'}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-lg font-bold tabular-nums text-gold">{p.score}</div>
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{t('competition.totalKg')}</div>
                  <ProjectionInline projection={p.projection} score={p.score} />
                  <RisInline ris={p.ris ?? null} bodyweight={p.bodyweight} gender={p.gender} />
                </div>
              </header>
              <div className="overflow-x-auto p-3">
                <table className="w-full">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-2 py-1 text-left font-medium">{t('session.mouvement')}</th>
                      {Array.from({ length: maxAttempts }, (_, k) => <th key={k} className="px-2 py-1 text-center font-medium">{t('competition.essaiN', { n: k + 1 })}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {p.movements.map((mv, mi) => (
                      <tr key={mi} className="border-t border-border/50 align-top">
                        <td className="px-2 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{mv.name}</td>
                        {Array.from({ length: maxAttempts }, (_, ai) => {
                          const a = mv.attempts[ai] ?? { weight: 0, result: '' as const };
                          return (
                            <td key={ai} className="px-1 py-1">
                              <TierAttemptCell attempt={a} inheritedTiers={chainedInheritedTiers(mv.attempts, ai)} plancher={plancherDAnnonce(mv.attempts, ai)} onChange={na => setAttempt(i, mi, ai, na)} />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

/** ⚠️ LE RIS EST REÇU, PAS CALCULÉ (FRE-141) — mais l'EXPLICATION reste locale :
 *  quand il vaut `null`, le coach doit savoir ce qui manque. */
function RisInline({ ris, bodyweight, gender }: { ris: number | null; bodyweight?: number; gender?: RisGender }) {
  const raison = i18n.t(!bodyweight ? 'misc.missingWeight' : !gender ? 'misc.missingGender' : 'misc.noValidRep');
  return (
    <div className={cn('mt-0.5 text-[10px] uppercase tracking-wider', ris === null ? 'text-muted-foreground' : 'text-gold')}
         title={ris === null ? i18n.t('competition.risNonCalculable', { raison }) : 'RIS - Relative Index for Streetlifting'}>
      RIS <span className="font-mono font-semibold tabular-nums">{formatRis(ris)}</span>
    </div>
  );
}

/* ---- Cellule d'essai : 3 charges candidates (P/R/O) + sélection/verrou + bump + verdict ---- */
function TierAttemptCell({ attempt, inheritedTiers, plancher, onChange }: {
  attempt: Attempt;
  inheritedTiers: EffectiveTiers | null;
  /** La plus lourde annonce des essais précédents : en dessous, on ne propose pas. */
  plancher: number;
  onChange: (a: Attempt) => void;
}) {
  const tiers = attempt.weights || { pessimistic: 0, realistic: attempt.weight > 0 && !attempt.selectedTier ? attempt.weight : 0, optimistic: 0 };
  const selected = attempt.selectedTier;
  const locked = !!selected;

  const bumpTier = (tier: Tier, delta: number) => {
    const cur = attempt.weights || { pessimistic: 0, realistic: 0, optimistic: 0 };
    let base = cur[tier];
    if (base === 0 && delta > 0 && inheritedTiers) base = inheritedTiers[tier];
    if (base === 0 && delta < 0) return;
    onChange({ ...attempt, weights: { ...cur, [tier]: Math.max(0, base + delta) } });
  };
  const toggleSelect = (tier: Tier) => {
    if (selected === tier) onChange({ ...attempt, selectedTier: null, weight: 0 });
    else onChange({ ...attempt, weights: tiers, selectedTier: tier, weight: tiers[tier] || 0 });
  };

  const bg = attempt.result === 'rep' ? 'border-success/40 bg-success/10' : attempt.result === 'norep' ? 'border-destructive/40 bg-destructive/10' : 'border-border';

  return (
    <div className={cn('flex w-[148px] flex-col gap-1 rounded-md border p-1.5', bg)}>
      {TIER_DEFS.map(t => {
        const isSel = selected === t.id;
        // ⚠️ ON NE BAISSE PAS (24/09) : brokkr refuse la feuille entière en 422, donc
        // la charge n'est pas proposée — l'annuler, elle, reste toujours possible.
        const enBaisse = !isSel && tiers[t.id as Tier] > 0 && tiers[t.id as Tier] < plancher;
        return (
          <div key={t.id} className={cn('flex items-center gap-1', locked && !isSel && 'opacity-40')}>
            <button type="button" onClick={() => toggleSelect(t.id as Tier)} disabled={enBaisse}
              title={enBaisse ? i18n.t('competition.annonceEnBaisse', { plancher }) : i18n.t(t.full)}
              className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold', isSel ? 'bg-gold text-gold-foreground' : 'border border-border text-muted-foreground', enBaisse && 'cursor-not-allowed opacity-40')}>
              {t.label}
            </button>
            {locked ? (
              <span className="flex-1 text-center font-mono text-xs">{tiers[t.id as Tier] > 0 ? tiers[t.id as Tier] : '—'}</span>
            ) : (
              <>
                <TierInput value={tiers[t.id as Tier]} placeholder={inheritedTiers && inheritedTiers[t.id as Tier] > 0 ? String(inheritedTiers[t.id as Tier]) : '—'}
                  onCommit={(n) => onChange({ ...attempt, weights: { ...tiers, [t.id]: n } })} />
                <button type="button" onClick={() => bumpTier(t.id as Tier, -BUMP_STEP)} className="flex h-5 w-4 items-center justify-center rounded text-muted-foreground hover:bg-accent">−</button>
                <button type="button" onClick={() => bumpTier(t.id as Tier, BUMP_STEP)} className="flex h-5 w-4 items-center justify-center rounded text-muted-foreground hover:bg-accent">+</button>
              </>
            )}
          </div>
        );
      })}
      <div className="flex gap-1">
        <button type="button" onClick={() => onChange(verdictBascule(attempt, 'rep'))}
          className={cn('flex h-6 flex-1 items-center justify-center rounded', attempt.result === 'rep' ? 'bg-success text-white' : 'border border-border text-muted-foreground hover:text-success')}>
          <Check className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => onChange(verdictBascule(attempt, 'norep'))}
          className={cn('flex h-6 flex-1 items-center justify-center rounded', attempt.result === 'norep' ? 'bg-destructive text-white' : 'border border-border text-muted-foreground hover:text-destructive')}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function TierInput({ value, placeholder, onCommit }: { value: number; placeholder?: string; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState(value ? String(value) : '');
  useEffect(() => { setDraft(value ? String(value) : ''); }, [value]);
  return (
    <input value={draft} placeholder={placeholder} onChange={e => setDraft(e.target.value)}
      onBlur={() => { const n = parseFloat(draft.replace(',', '.')); onCommit(Number.isNaN(n) ? 0 : n); }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className="h-5 w-10 rounded bg-background text-center font-mono text-[11px] outline-none focus:ring-1 focus:ring-gold" />
  );
}
