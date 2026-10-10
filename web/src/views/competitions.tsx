import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar as CalendarIcon, ChevronRight, MapPin, Plus, Trash2, Trophy, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { CompAttempt, Competition } from '@/api/types';
import { newCompetitionId, useCompetitions, useDeleteCompetition, usePutCompetition } from '@/api/hooks/use-competitions';
import { useMe } from '@/api/hooks/use-me';
import { isUpcoming } from '@/lib/athlete';
import { daysBetween, formatRange, todayISO } from '@/lib/dates-ui';
import { REGLEMENTS, reglementLabel, type Reglement } from '@/lib/norep-reasons';
import { formatRis } from '@/lib/ris-score';
import { DEFAULT_COMP_MOVEMENTS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { toastSaveError } from '@/lib/save-error';

/** Vue Compétitions — liste compacte. Clic → /competitions/:id (détail 1RM). */

function bestWeight(attempts: CompAttempt[]) {
  return attempts.filter(a => a.result === 'rep').reduce((m, a) => Math.max(m, a.weight), 0);
}

export function CompetitionsView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { data: me } = useMe();
  const { data: competitions = [] } = useCompetitions();
  const putCompetition = usePutCompetition();
  const deleteCompetition = useDeleteCompetition();

  const [draft, setDraft] = useState<{ name: string; startDate: string; endDate: string; location: string; reglement: Reglement } | null>(null);
  const today = todayISO();
  const upcoming = competitions.filter(c => isUpcoming(c, today)).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const done = competitions.filter(c => !isUpcoming(c, today)).sort((a, b) => b.startDate.localeCompare(a.startDate));
  // Le coach de la structure — ou l'admin, qui crée dans celle qu'il regarde
  // (brokkr : `PUT /competitions?structure=`) : William organise les meets
  // French Forge en coachant chez ElGustoLift.
  const canWrite = !!me?.isCoach || !!me?.isAdmin;

  const onError = toastSaveError;

  const save = () => {
    if (!draft || !draft.name.trim() || !draft.startDate) return;
    putCompetition.mutate(
      {
        id: newCompetitionId(),
        competition: {
          name: draft.name.trim(),
          startDate: draft.startDate,
          // Vide = compétition d'un seul jour.
          endDate: draft.endDate || draft.startDate,
          location: draft.location || undefined,
          maxAttempts: 3,
          reglement: draft.reglement,
          movementNames: [...DEFAULT_COMP_MOVEMENTS],
          participants: [],
        },
      },
      { onError },
    );
    setDraft(null);
  };

  const remove = async (comp: Competition) => {
    if (await confirm({
      title: t('competition.supprimerLaCompetition', { nom: comp.name }),
      description: t('competition.participantsPartentAvec'),
    })) {
      deleteCompetition.mutate(comp.id, { onError });
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div className="flex items-center justify-end">
        {canWrite && !draft && (
          <Button size="sm" className="h-8 bg-gold text-gold-foreground hover:bg-gold/90" onClick={() => setDraft({ name: '', startDate: todayISO(), endDate: todayISO(), location: '', reglement: 'fnsl' })}>
            <Plus className="h-3.5 w-3.5" /> {t('competition.nouvelleCompetition')}
          </Button>
        )}
      </div>

      {draft && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
          <Input value={draft.name} onChange={e => setDraft(d => d && { ...d, name: e.target.value })} placeholder={t('competition.nomDeLaCompetition')} className="h-8 flex-1 min-w-[180px] text-sm" autoFocus onKeyDown={e => { if (e.key === 'Enter') save(); }} />
          <div className="flex items-center gap-1">
            <DatePicker value={draft.startDate} title={t('competition.premierJour')}
                        onChange={v => setDraft(d => d && { ...d, startDate: v, endDate: d.endDate && d.endDate >= v ? d.endDate : v })} />
            <span className="text-xs text-muted-foreground">→</span>
            <DatePicker value={draft.endDate} title={t('competition.dernierJour')} min={draft.startDate}
                        onChange={v => setDraft(d => d && { ...d, endDate: v })} />
          </div>
          <Input value={draft.location} onChange={e => setDraft(d => d && { ...d, location: e.target.value })} placeholder={t('competition.lieu')} className="h-8 w-40 text-sm" />
          <select value={draft.reglement} aria-label={t('competition.reglement')} title={t('competition.reglement')}
                      onChange={e => setDraft(d => d && { ...d, reglement: e.target.value as Reglement })}
                      className="h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold">
                {REGLEMENTS.map(r => <option key={r} value={r}>{reglementLabel(r)}</option>)}
              </select>
          <Button size="sm" className="h-8 bg-gold text-gold-foreground hover:bg-gold/90" onClick={save}>{t('competition.creer')}</Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => setDraft(null)}>{t('common.annuler')}</Button>
        </div>
      )}

      {competitions.length === 0 && !draft && (
        <div className="rounded-lg border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
          {t(canWrite ? 'competition.aucuneCompetitionCreeEn' : 'competition.aucuneCompetition')}
        </div>
      )}

      {upcoming.length > 0 && (
        <CompetitionList
          title={t('competition.aVenir')}
          comps={upcoming}
          canDelete={canWrite}
          onOpen={id => void navigate(`/competitions/${id}`)}
          onDelete={comp => void remove(comp)}
        />
      )}
      {done.length > 0 && (
        <CompetitionList
          title={t('competition.terminees')}
          comps={done}
          canDelete={canWrite}
          onOpen={id => void navigate(`/competitions/${id}`)}
          onDelete={comp => void remove(comp)}
        />
      )}
    </div>
  );
}

function CompetitionList({ title, comps, canDelete, onOpen, onDelete }: {
  title: string;
  comps: Competition[];
  canDelete: boolean;
  onOpen: (id: string) => void;
  onDelete: (comp: Competition) => void;
}) {
  return (
    <section>
      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</h2>
      <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-[0_16px_42px_rgba(0,0,0,0.16)] divide-y divide-border/70">
        {comps.map(c => (
          <CompetitionRow key={c.id} comp={c} canDelete={canDelete} onOpen={() => onOpen(c.id)} onDelete={() => onDelete(c)} />
        ))}
      </div>
    </section>
  );
}

function CompetitionRow({ comp, canDelete, onOpen, onDelete }: {
  comp: Competition;
  canDelete: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const upcoming = isUpcoming(comp);
  const days = daysBetween(todayISO(), comp.startDate);
  const total = comp.participants.reduce((sum, p) => sum + p.movements.reduce((s, m) => s + bestWeight(m.attempts), 0), 0);
  // ⚠️ SERVI PAR BROKKR (FRE-92). Cet écran recalculait le RIS depuis les
  // essais, `competition-detail` le tirait du SCORE, et `athletes` du TOTAL DU
  // BARÈME : trois calculs, deux résultats différents pour un même athlète.
  const bestRis = comp.participants
    .map(p => p.ris)
    .filter((ris): ris is number => ris != null)
    .sort((a, b) => b - a)[0] ?? null;
  const nb = comp.participants.length;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}
      className={cn(
        'group flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/30',
        upcoming ? 'shadow-[inset_3px_0_0_var(--gold)]' : 'shadow-[inset_3px_0_0_var(--success)]',
      )}
    >
      <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border', upcoming ? 'border-gold/25 bg-gold/15 text-gold' : 'border-success/20 bg-success/10 text-success')}>
        <Trophy className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{comp.name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><CalendarIcon className="h-3 w-3" />{formatRange(comp.startDate, comp.endDate)}</span>
          {comp.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{comp.location}</span>}
          <span className="flex items-center gap-1"><Users className="h-3 w-3" />{t('competition.nbParticipants', { count: nb })}</span>
        </div>
      </div>
      {upcoming ? (
        <span className="shrink-0 rounded-md border border-gold/25 bg-gold/15 px-2 py-1 font-mono text-xs text-gold tabular-nums">J−{days}</span>
      ) : total > 0 ? (
        <span className="shrink-0 rounded-md border border-success/25 bg-success/15 px-2 py-1 font-mono text-xs text-success tabular-nums">
          {bestRis !== null ? `RIS ${formatRis(bestRis)}` : `${total} kg`}
        </span>
      ) : null}
      {canDelete && (
        <button
          type="button"
          title={t('common.delete')}
          onClick={e => { e.stopPropagation(); onDelete(); }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </div>
  );
}
