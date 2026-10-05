import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { Flight, WeightCategories } from '@/api/types';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { CaseDEssai } from './case-d-essai';
import { DescriptionDuGroupe } from './description-du-groupe';
import { DonneesDeLAthlete } from './donnees-de-l-athlete';
import { nomDuGroupe, nomSuivant } from './nom-du-groupe';
import { ProjectionInline } from './projection';
import type { Participant } from './types';
import type { EtatDuPlateau } from './use-plateau';

/** Les groupes, leurs athlètes, et le récapitulatif de l'un d'eux.
 *
 *  On choisit un groupe, puis un athlète : ses douze essais s'affichent, ce qui
 *  a été passé comme ce qui reste. TOUT ce que porte un athlète se saisit ici,
 *  sous son nom, et nulle part ailleurs : poids du jour, genre, catégorie, jour
 *  de passage.
 *
 *  ⚠️ CE CHOIX N'EST PAS L'ENCART LIVE : regarder un athlète ne change pas qui
 *  est en barre. Toucher une case, si : elle devient l'essai de l'encart.
 *
 *  Le choix tient tant que l'encart ne bouge pas. Dès qu'un autre athlète passe
 *  en barre, le bloc le suit : c'est lui qu'on veut voir. */
export function SuiviParGroupe({ plateau, participants, groupes, flight, onChoisirFlight, flights, categories, onSaveFlights, movementNames, maxAttempts, canWrite, onChangeParticipant, onRemoveParticipant, jours }: {
  plateau: EtatDuPlateau;
  participants: Participant[];
  groupes: (string | null)[];
  /** Le groupe consulté, partagé avec le classement du groupe. */
  flight: string | null;
  onChoisirFlight: (flight: string | null | undefined) => void;
  /** Les groupes de la compétition : ils se créent et se règlent ici. */
  flights: Flight[];
  categories: WeightCategories;
  onSaveFlights: (flights: Flight[]) => void;
  movementNames: string[];
  maxAttempts: number;
  canWrite: boolean;
  onChangeParticipant: (pi: number, patch: Partial<Participant>) => void;
  onRemoveParticipant: (pi: number) => void;
  jours: { start: string; end: string } | null;
}) {
  const { t } = useTranslation();
  // L'athlète choisi, et qui était en barre à ce moment-là : si ce n'est plus lui, on suit l'encart.
  const [choix, setChoix] = useState<{ pi: number; enBarre: number | null } | null>(null);
  const athleteChoisi = choix && choix.enBarre === plateau.selection ? choix.pi : undefined;
  const setAthleteChoisi = (pi: number | undefined) => setChoix(pi === undefined ? null : { pi, enBarre: plateau.selection });
  const [edition, setEdition] = useState(false);

  const inscrits = participants.map((p, i) => ({ p, i })).filter(({ p }) => (p.flight ?? null) === flight);
  const dansLeGroupe = (i: number | null | undefined) => i != null && inscrits.some(x => x.i === i);
  const pi = dansLeGroupe(athleteChoisi) ? athleteChoisi! : dansLeGroupe(plateau.selection) ? plateau.selection! : inscrits[0]?.i;
  const p = pi != null ? participants[pi] : null;
  const avecGroupes = groupes.some(g => g !== null);

  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-card p-4" aria-label={t('competition.suiviParGroupe')}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-xl font-bold uppercase tracking-tight">{t('competition.suiviParGroupe')}</h2>
        {avecGroupes && (
          <div role="group" aria-label={t('competition.groupes')} className="flex flex-wrap rounded-lg border border-border p-0.5">
            {groupes.map(g => (
              <button key={g ?? ''} type="button" aria-pressed={g === flight}
                      onClick={() => { onChoisirFlight(g); setAthleteChoisi(undefined); setEdition(false); }}
                      className={cn('h-9 rounded-md px-3 text-sm font-semibold',
                        g === flight ? 'bg-gold text-gold-foreground' : 'text-muted-foreground hover:text-foreground')}>
                {nomDuGroupe(t, g)}
              </button>
            ))}
          </div>
        )}
        {canWrite && (
          <button type="button" onClick={() => {
            const nom = nomSuivant(flights);
            onSaveFlights([...flights, { name: nom, categories: [] }]);
            onChoisirFlight(nom);
            setEdition(true);
          }} className="flex h-9 items-center gap-1 rounded-md border border-dashed border-border px-3 text-sm text-muted-foreground hover:border-gold/40 hover:text-foreground">
            <Plus className="h-3.5 w-3.5" /> {t('competition.ajouterUnGroupe')}
          </button>
        )}
      </div>

      <DescriptionDuGroupe key={flight ?? ''} flights={flights} flight={flight} categories={categories} canWrite={canWrite}
                           edition={edition} onEdition={setEdition} onSave={onSaveFlights}
                           onRenomme={nom => onChoisirFlight(nom)} />

      {/* Les athlètes du groupe, en pastilles : le nom, et le total qui suit chaque verdict. */}
      <div role="group" aria-label={t('competition.athletesDuGroupe')} className="flex flex-wrap gap-2">
        {inscrits.map(({ p: a, i }) => (
          <button key={i} type="button" aria-pressed={i === pi} onClick={() => setAthleteChoisi(i)}
                  className={cn('flex h-11 items-center gap-2 rounded-full border px-4 text-sm',
                    i === pi ? 'border-gold bg-gold/10 text-foreground' : 'border-border text-muted-foreground hover:border-gold/40 hover:text-foreground')}>
            <span className="font-semibold">{a.name}</span>
            <span className="font-mono font-bold tabular-nums text-gold">{a.score}</span>
          </button>
        ))}
      </div>

      {/* Le récapitulatif : ses douze essais, ce qui est passé et ce qui reste. */}
      {p && pi != null && (
        <div className="rounded-lg border border-border/70 bg-background/30 p-3">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <div>
              <h3 className="font-display text-lg font-bold uppercase">{p.name}</h3>
              <span className="font-mono text-xs text-muted-foreground">
                {[p.weightCategory, p.bodyweight ? `${p.bodyweight} kg` : null].filter(Boolean).join(' · ') || '—'}
              </span>
            </div>
            <div className="text-right">
              <span className="font-mono text-xl font-bold tabular-nums text-gold">{p.score}</span>
              <span className="ml-1 text-xs text-muted-foreground">kg</span>
              <ProjectionInline projection={p.projection} score={p.score} />
            </div>
          </div>
          {canWrite && (
            <div className="mb-3">
              <DonneesDeLAthlete p={p} categories={categories} jours={jours}
                                 onChange={patch => onChangeParticipant(pi, patch)} onRemove={() => onRemoveParticipant(pi)} />
            </div>
          )}
          <div className="flex flex-col gap-2">
            {movementNames.map(m => {
              const attempts = p.movements.find(mv => mv.name === m)?.attempts;
              const enCours = plateau.tour?.mouvement === m && plateau.tour.flight === flight;
              return (
                <div key={m} className="grid grid-cols-[6rem_1fr] items-center gap-2">
                  <span className={cn('font-mono text-[11px] uppercase tracking-wider', enCours ? 'text-gold' : 'text-muted-foreground')}>{m}</span>
                  <div className="flex gap-1.5">
                    {Array.from({ length: maxAttempts }, (_, ai) => attempts?.[ai] ? (
                      <CaseDEssai key={ai} grande nom={p.name} mouvement={m} attempts={attempts} ai={ai}
                                  duTourAffiche={enCours && plateau.tour?.essai === ai}
                                  selectionnee={enCours && plateau.tour?.essai === ai && plateau.selection === pi}
                                  cliquable={canWrite}
                                  onSelect={() => plateau.allerAuTour({ flight, mouvement: m, essai: ai }, pi)} />
                    ) : <div key={ai} className="h-14 flex-1" />)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
