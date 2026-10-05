import { ChevronLeft, ChevronRight, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { memeTour, tourFini } from '@/lib/plateau';
import { cn } from '@/lib/utils';
import type { Participant } from './types';
import type { EtatDuPlateau } from './use-plateau';
import { nomDuGroupe } from './nom-du-groupe';

/** Le tour affiché : sa place dans la séquence de la compétition, ses flèches,
 *  les segments du groupe, et le retour au tour du plateau quand on a décroché. */
export function CarteDuTour({ plateau, participants, groupes, avecPastilles }: {
  plateau: EtatDuPlateau;
  participants: Participant[];
  /** Les groupes en lice ; vide ou `[null]` quand aucun groupe n'est défini. */
  groupes: (string | null)[];
  /** Les pastilles du groupe en piste : au téléphone, elles remplacent les onglets de la feuille. */
  avecPastilles: boolean;
}) {
  const { t } = useTranslation();
  const { tours, idx, live, tour } = plateau;
  if (!tour) return null;
  const toursDuGroupe = tours.filter(x => x.flight === tour.flight);
  const avecGroupes = groupes.some(g => g !== null);

  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={plateau.precedent} disabled={plateau.premierPassage} aria-label={t('competition.passagePrecedent')}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-30">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            {t('competition.tourNsurN', { n: idx + 1, total: tours.length })}
            {tour.flight && ` · ${nomDuGroupe(t, tour.flight)}`}
          </div>
          <h2 className="truncate font-display text-2xl font-bold uppercase tracking-tight">{tour.mouvement}</h2>
          <span className="inline-block rounded-md bg-gold/15 px-2 py-0.5 text-xs font-semibold text-gold">
            {t('competition.essaiN', { n: tour.essai + 1 })}
          </span>
        </div>
        <button type="button" onClick={plateau.suivant} disabled={plateau.dernierPassage} aria-label={t('competition.passageSuivant')}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-30">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <ol className="mt-3 flex gap-1" aria-label={t('competition.toursDuGroupe')}>
        {toursDuGroupe.map(x => {
          const etat = memeTour(x, tour) ? 'enCours' : tourFini(participants, x) ? 'fini' : 'aVenir';
          return (
            <li key={`${x.mouvement}-${x.essai}`} title={`${x.mouvement} · ${t('competition.essaiN', { n: x.essai + 1 })}`}
                aria-label={t(`competition.etatDuTour.${etat}`, { mouvement: x.mouvement, essai: x.essai + 1 })}
                className={cn('h-1 flex-1 rounded-full', etat === 'fini' ? 'bg-success' : etat === 'enCours' ? 'bg-gold' : 'bg-muted')} />
          );
        })}
      </ol>

      {idx !== live && (
        <button type="button" onClick={plateau.revenir}
                className="mt-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-gold/50 text-sm font-semibold text-gold hover:bg-gold/10">
          <Undo2 className="h-4 w-4" /> {t('competition.revenirAuTourEnCours')}
        </button>
      )}

      {avecPastilles && avecGroupes && (
        <div role="group" aria-label={t('competition.groupeEnPiste')} className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{t('competition.enPiste')}</span>
          {groupes.map(g => (
            <button key={g ?? ''} type="button" aria-pressed={g === tour.flight} onClick={() => plateau.choisirLeGroupe(g)}
                    className={cn('h-11 rounded-full border px-4 text-sm font-semibold',
                      g === tour.flight ? 'border-gold bg-gold text-gold-foreground' : 'border-border text-muted-foreground')}>
              {nomDuGroupe(t, g)}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
