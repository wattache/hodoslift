import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { blocDuJour, evenementsDuJour, moisVoisin, semainesDuMois } from '@/lib/calendrier-mois';
import { parseISODate } from '@/lib/dates-ui';
import type { BandeDeBloc, EvenementDeFrise, ISO } from '@/lib/frise-periodisation';
import { cn } from '@/lib/utils';

/** LE CALENDRIER AU MOIS (FRE-245) — à côté de la frise, pas à sa place.
 *
 *  Un mois à la fois, lisible sur téléphone. Le bloc du jour en filet de sa
 *  couleur de TYPE (`--block-*`, la même que la frise) : jamais une couleur par
 *  rotation d'index, ce qui avait fait retirer l'ancienne grille de douze mois.
 *  Toucher un jour ouvre la saisie d'un évènement à cette date. */
export function CalendrierMois({ blocs, evenements, aujourdhui, peutSaisir, onSaisir, onCompetition, onEvenement }: {
  blocs: BandeDeBloc[];
  evenements: EvenementDeFrise[];
  aujourdhui: ISO;
  peutSaisir: boolean;
  onSaisir: (debut: ISO, fin: ISO) => void;
  onCompetition: (id: string) => void;
  onEvenement: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [mois, setMois] = useState<ISO>(`${aujourdhui.slice(0, 7)}-01`);
  const semaines = semainesDuMois(mois);
  const jours = semaines.flat();
  const blocsDuMois = blocs.filter(b => b.debut <= jours[jours.length - 1] && jours[0] <= b.fin);
  const titre = new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }).format(parseISODate(mois));
  const jourLong = (jour: ISO) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' }).format(parseISODate(jour));
  const enTetes = semaines[0].map(jour =>
    new Intl.DateTimeFormat(i18n.language, { weekday: 'short' }).format(parseISODate(jour)));

  return (
    <section aria-label={titre} className="rounded-xl border border-border/80 bg-card p-3 sm:p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold uppercase tracking-[0.01em] first-letter:uppercase">{titre}</h2>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setMois(m => moisVoisin(m, -1))} aria-label={t('calendar.moisPrecedent')}
                  className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => setMois(`${aujourdhui.slice(0, 7)}-01`)}
                  className="h-8 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">{t('periodization.aujourdhui')}</button>
          <button type="button" onClick={() => setMois(m => moisVoisin(m, 1))} aria-label={t('calendar.moisSuivant')}
                  className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </header>

      <div role="grid" aria-label={titre} className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border/60 bg-border/60">
        {enTetes.map((nom, i) => (
          <div key={i} role="columnheader" className="bg-card py-1 text-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{nom}</div>
        ))}
        {jours.map(jour => {
          const horsDuMois = jour.slice(0, 7) !== mois.slice(0, 7);
          const bloc = blocDuJour(jour, blocs);
          const ceJour = evenementsDuJour(jour, evenements);
          return (
            <div key={jour} role="gridcell" data-jour={jour}
                 className={cn('relative flex min-h-[64px] flex-col gap-0.5 p-1 sm:min-h-[84px]', horsDuMois ? 'bg-muted/60' : 'bg-card')}>
              {bloc && <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: `var(--block-${bloc.type})` }} title={bloc.nom} />}
              {/* Toute la case est la cible : au doigt, le chiffre seul est trop petit. */}
              {peutSaisir && (
                <button type="button" onClick={() => onSaisir(jour, jour)}
                        aria-label={t('calendar.ajouterLe', { jour: jourLong(jour) })}
                        className="absolute inset-0 hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none" />
              )}
              <span className={cn('pointer-events-none relative self-start px-1 font-mono text-[11px] tabular-nums',
                jour === aujourdhui ? 'rounded bg-gold text-gold-foreground' : horsDuMois ? 'text-muted-foreground/60' : 'text-foreground')}>
                {Number(jour.slice(8))}
              </span>
              {ceJour.slice(0, 2).map(e => (
                <button key={e.id} type="button"
                        onClick={() => (e.competitionId ? onCompetition(e.competitionId) : onEvenement(e.id))}
                        title={e.nom}
                        className={cn('relative truncate rounded px-1 text-left text-[10px] leading-4',
                          e.nature === 'competition' ? 'bg-gold/15 text-gold' : 'bg-muted text-foreground')}>
                  {/* Au téléphone, l'emoji seul : sept colonnes ne laissent pas la place d'un nom. */}
                  {e.emoji}<span className="hidden sm:inline"> {e.nom}</span>
                </button>
              ))}
              {ceJour.length > 2 && <span className="pointer-events-none relative px-1 text-[10px] text-muted-foreground">+{ceJour.length - 2}</span>}
            </div>
          );
        })}
      </div>

      {blocsDuMois.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {blocsDuMois.map(b => (
            <li key={b.id} className="flex items-center gap-1.5">
              <span aria-hidden className="h-1 w-4 rounded-full" style={{ backgroundColor: `var(--block-${b.type})` }} />
              {b.nom}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
