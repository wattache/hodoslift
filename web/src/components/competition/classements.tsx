import { useTranslation } from 'react-i18next';
import { classementAuRis, classementDuGroupe } from '@/lib/comp-helpers';
import { formatRis } from '@/lib/ris-score';
import { cn } from '@/lib/utils';
import type { Participant } from './types';
import { nomDuGroupe } from './nom-du-groupe';
import { ProjectionInline } from './projection';

/** Le classement d'un groupe, au total : dans un groupe, on se compare en kilos. */
export function ClassementDuGroupe({ participants, flight, cadre = true }: {
  participants: Participant[];
  flight: string | null;
  /** Sans cadre quand il vit dans l'onglet du téléphone. */
  cadre?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section className={cn(cadre && 'rounded-xl border border-border bg-card p-4')}
             aria-label={t('competition.classementDuGroupe', { groupe: nomDuGroupe(t, flight) })}>
      {cadre && (
        <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-gold">
          {t('competition.classementDuGroupe', { groupe: nomDuGroupe(t, flight) })}
        </h3>
      )}
      <ol className="flex flex-col gap-0.5">
        {classementDuGroupe(participants, flight).map(({ p, i }, rang) => (
          <li key={i} className={cn('flex items-center gap-3 rounded-md px-2 py-1.5 text-sm', rang === 0 && 'bg-gold/5')}>
            <span className="w-5 font-mono text-xs text-muted-foreground">{rang + 1}.</span>
            <span className="w-10 font-mono text-xs text-muted-foreground">{p.weightCategory ?? ''}</span>
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            {/* Le total, et vers quoi il se dirige (FRE-203) : P, R et O servis par brokkr. */}
            <div className="text-right">
              <span className="font-mono text-sm font-semibold tabular-nums text-gold">{p.score}</span>
              <ProjectionInline projection={p.projection} score={p.score} />
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-muted-foreground">{t('competition.noteClassement')}</p>
    </section>
  );
}

/** Le classement général, au RIS, tous groupes confondus (William, 24/09).
 *  ⚠️ Le RIS vient du serveur (FRE-141), jamais d'un calcul ici. */
export function ClassementAuRis({ participants }: { participants: Participant[] }) {
  const { t } = useTranslation();
  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gold">{t('competition.classementGeneralRis')}</h3>
      <ol className="flex flex-col gap-0.5">
        {classementAuRis(participants).map(({ p, i }, rang) => (
          <li key={i} className={cn('flex items-center gap-2 rounded-md px-2 py-1 text-sm', rang === 0 && p.ris != null && 'bg-gold/5')}>
            <span className="w-6 font-mono text-xs text-muted-foreground">{p.ris != null ? `${rang + 1}.` : '—'}</span>
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            {p.flight && <span className="text-[11px] text-muted-foreground">{nomDuGroupe(t, p.flight)}</span>}
            <span className="w-16 text-right font-mono text-xs text-muted-foreground">{p.score} kg</span>
            {/* Le serveur ne dit que « null » : les champs qui distinguent les cas sont là. */}
            <span className="w-14 text-right font-mono text-xs font-semibold text-gold"
                  title={p.ris != null ? undefined : t('competition.risNonCalculable', {
                    raison: t(!p.bodyweight ? 'misc.missingWeight' : !p.gender ? 'misc.missingGender' : 'misc.noValidRep') })}>
              {formatRis(p.ris ?? null)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
