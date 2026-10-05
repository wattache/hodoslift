import { useMemo } from 'react';
import { Check, Minus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { CoachAvailabilityStatus } from '@/api/types';
import { useCompetitionAvailability, useSetCoachAvailability } from '@/api/hooks/use-competitions';
import { useMe } from '@/api/hooks/use-me';
import { toastSaveError } from '@/lib/save-error';
import { cn } from '@/lib/utils';
import { formatShort } from '@/lib/dates-ui';

/** Qui encadre, et quel jour.
 *
 *  Une compétition dure souvent deux jours et chaque athlète passe le sien :
 *  la disponibilité est donc PAR JOUR. « Qui est là samedi ? » est la question
 *  qui permet de répartir les passages ; « qui vient ? » ne permet rien.
 *
 *  `pending` est un état à part entière, affiché comme tel — c'est lui qui
 *  montre qui reste à relancer. Le confondre avec « indisponible » ferait
 *  croire l'effectif complet alors que personne n'a répondu. */

const CYCLE: Record<CoachAvailabilityStatus, CoachAvailabilityStatus> = {
  pending: 'available',
  available: 'unavailable',
  unavailable: 'pending',
};

const STYLE: Record<CoachAvailabilityStatus, string> = {
  pending: 'border-border bg-background text-muted-foreground hover:border-gold/40',
  available: 'border-success/40 bg-success/15 text-success',
  unavailable: 'border-destructive/40 bg-destructive/10 text-destructive',
};

const ICON = {
  pending: Minus,
  available: Check,
  unavailable: X,
} as const;

export function CoachAvailabilitySection({ competitionId }: { competitionId: string }) {
  const { t } = useTranslation();
  // La section décide elle-même de son droit d'écriture : brokkr réserve la
  // déclaration aux coachs, le front ne doit donc proposer le geste qu'à eux.
  const { data: me } = useMe();
  const canEdit = !!me?.isCoach;
  const { data: rows = [], isLoading } = useCompetitionAvailability(competitionId);
  const setAvailability = useSetCoachAvailability(competitionId);

  const { days, coaches, byKey } = useMemo(() => {
    const days = [...new Set(rows.map(r => r.day))].sort();
    const seen = new Map<string, string>();
    for (const r of rows) if (!seen.has(r.coachUid)) seen.set(r.coachUid, r.coachName);
    return {
      days,
      coaches: [...seen].map(([coachUid, coachName]) => ({ coachUid, coachName })),
      byKey: new Map(rows.map(r => [`${r.coachUid}|${r.day}`, r.status])),
    };
  }, [rows]);

  if (isLoading || rows.length === 0) return null;

  const pending = rows.filter(r => r.status === 'pending').length;

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h3 className="text-sm font-semibold tracking-tight">{t('availability.title')}</h3>
        {pending > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {t('availability.pendingCount', { count: pending })}
          </span>
        )}
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2 text-left font-medium">{t('availability.coach')}</th>
              {days.map(day => (
                <th key={day} className="px-3 py-2 text-center font-medium">{formatShort(day)}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {coaches.map(({ coachUid, coachName }) => (
              <tr key={coachUid}>
                <td className="px-4 py-2 font-medium">{coachName}</td>
                {days.map(day => {
                  const status = byKey.get(`${coachUid}|${day}`) ?? 'pending';
                  const Icon = ICON[status];
                  const label = t(`availability.${status}`);
                  return (
                    <td key={day} className="px-3 py-2 text-center">
                      <button
                        type="button"
                        disabled={!canEdit}
                        aria-label={`${coachName} — ${formatShort(day)} : ${label}`}
                        title={canEdit ? t('availability.toggle') : label}
                        onClick={() => setAvailability.mutate(
                          { coachUid, day, status: CYCLE[status] },
                          { onError: toastSaveError },
                        )}
                        className={cn(
                          'inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors',
                          STYLE[status],
                          !canEdit && 'cursor-default opacity-70',
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
