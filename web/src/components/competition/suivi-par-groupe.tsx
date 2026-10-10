import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { Flight, WeightCategories } from '@/api/types';
import { useTranslation } from 'react-i18next';
import { verdictBascule } from '@/lib/essai-competition';
import { cn } from '@/lib/utils';
import { CaseDEssai } from './case-d-essai';
import { DescriptionDuGroupe } from './description-du-groupe';
import { DonneesDeLAthlete } from './donnees-de-l-athlete';
import type { Reglement } from '@/lib/norep-reasons';
import { Annonce, Verdict } from './en-barre';
import { nomDuGroupe, nomSuivant } from './nom-du-groupe';
import { ProjectionInline } from './projection';
import type { Participant, SetAttempt } from './types';
import type { EtatDuPlateau } from './use-plateau';

/** Les groupes, leurs athlètes, et la carte de l'un d'eux — où TOUT se saisit.
 *
 *  On choisit un groupe, puis un athlète : ses douze essais s'affichent, ce qui
 *  a été passé comme ce qui reste. Tout ce que porte un athlète se saisit ici,
 *  sous son nom, et nulle part ailleurs : poids du jour, genre, catégorie, jour
 *  de passage — et chaque essai, en touchant sa case (FRE-225).
 *
 *  ⚠️ LA CARTE NE SUIT PAS L'ENCART LIVE, et l'encart ne suit pas la carte. Sur
 *  un plateau, chaque coach tient SON athlète : si la carte sautait sur
 *  l'athlète en barre, un coach qui ne saisit pas déplacerait tous les autres.
 *  L'encart dit où en est la séquence ; la carte est où l'on saisit. */
export function SuiviParGroupe({ plateau, participants, groupes, flight, onChoisirFlight, flights, categories, onSaveFlights, movementNames, maxAttempts, reglement, canWrite, setAttempt, onChangeParticipant, onRemoveParticipant, jours }: {
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
  reglement: Reglement;
  canWrite: boolean;
  setAttempt: SetAttempt;
  onChangeParticipant: (pi: number, patch: Partial<Participant>) => void;
  onRemoveParticipant: (pi: number) => void;
  jours: { start: string; end: string } | null;
}) {
  const { t } = useTranslation();
  // L'athlète choisi tient tant qu'on ne le change pas ; sans choix, celui en barre.
  const [athleteChoisi, setAthleteChoisi] = useState<number | undefined>(undefined);
  // L'essai qu'on saisit, sur la carte : un mouvement et un rang.
  const [essaiChoisi, setEssaiChoisi] = useState<{ m: string; ai: number } | null>(null);
  const choisirAthlete = (i: number | undefined) => { setAthleteChoisi(i); setEssaiChoisi(null); };
  const [edition, setEdition] = useState(false);

  const inscrits = participants.map((p, i) => ({ p, i })).filter(({ p }) => (p.flight ?? null) === flight);
  const dansLeGroupe = (i: number | null | undefined) => i != null && inscrits.some(x => x.i === i);
  // Sans choix : le premier du groupe — pas l'athlète en barre, que la séquence déplacerait.
  const pi = dansLeGroupe(athleteChoisi) ? athleteChoisi! : inscrits[0]?.i;
  const p = pi != null ? participants[pi] : null;
  const avecGroupes = groupes.some(g => g !== null);
  const miChoisi = p && essaiChoisi ? p.movements.findIndex(mv => mv.name === essaiChoisi.m) : -1;
  const attemptsChoisis = p && miChoisi >= 0 ? p.movements[miChoisi].attempts : null;
  const attemptChoisi = attemptsChoisis && essaiChoisi ? attemptsChoisis[essaiChoisi.ai] : undefined;

  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-card p-4" aria-label={t('competition.suiviParGroupe')}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-xl font-bold uppercase tracking-tight">{t('competition.suiviParGroupe')}</h2>
        {avecGroupes && (
          <div role="group" aria-label={t('competition.groupes')} className="flex flex-wrap rounded-lg border border-border p-0.5">
            {groupes.map(g => (
              <button key={g ?? ''} type="button" aria-pressed={g === flight}
                      onClick={() => { onChoisirFlight(g); choisirAthlete(undefined); setEdition(false); }}
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
          <button key={i} type="button" aria-pressed={i === pi} onClick={() => choisirAthlete(i)}
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
                                  duTourAffiche={enCours && plateau.tour?.essai === ai && plateau.selection === pi}
                                  selectionnee={essaiChoisi?.m === m && essaiChoisi.ai === ai}
                                  cliquable={canWrite}
                                  onSelect={() => setEssaiChoisi(e => e && e.m === m && e.ai === ai ? null : { m, ai })} />
                    ) : <div key={ai} className="h-14 flex-1" />)}
                  </div>
                </div>
              );
            })}
          </div>
          {/* L'essai touché se saisit ICI, sous la carte : annonce, puis verdict. Le
              même geste que l'encart live, sans déplacer qui est en barre. */}
          {canWrite && essaiChoisi && attemptsChoisis && attemptChoisi && (
            <div role="region" className="mt-3 rounded-lg border border-gold/60 bg-card p-3" aria-label={t('competition.essaiChoisi', { mouvement: essaiChoisi.m, essai: essaiChoisi.ai + 1 })}>
              <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-gold">
                {t('competition.essaiChoisi', { mouvement: essaiChoisi.m, essai: essaiChoisi.ai + 1 })}
              </div>
              <Annonce key={`${pi}-${essaiChoisi.m}-${essaiChoisi.ai}`} attempts={attemptsChoisis} ai={essaiChoisi.ai} canWrite
                       onChange={a => setAttempt(pi, miChoisi, essaiChoisi.ai, a)} />
              <Verdict attempt={attemptChoisi} mouvement={essaiChoisi.m} reglement={reglement}
                       onVerdict={v => { const a = verdictBascule(attemptChoisi, v); setAttempt(pi, miChoisi, essaiChoisi.ai, a); plateau.apresVerdict(pi, a.result); }}
                       onMotif={motif => { setAttempt(pi, miChoisi, essaiChoisi.ai, { ...attemptChoisi, norepReason: motif }); plateau.apresMotif(); }}
                       onVar={varUsed => setAttempt(pi, miChoisi, essaiChoisi.ai, { ...attemptChoisi, varUsed })} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
