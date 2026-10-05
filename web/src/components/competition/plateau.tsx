import { useMemo, useState, type ReactNode } from 'react';
import type { Flight, WeightCategories } from '@/api/types';
import { flightsEnLice } from '@/lib/comp-helpers';
import { useMediaQuery } from '@/lib/use-mobile';
import { CarteDuTour } from './carte-du-tour';
import { ClassementDuGroupe } from './classements';
import { EnBarre } from './en-barre';
import { SuiviParGroupe } from './suivi-par-groupe';
import type { Participant, SetAttempt } from './types';
import { usePlateau } from './use-plateau';

/** Le Plateau : les groupes et le récapitulatif d'un athlète, à côté de
 *  l'encart live — le tour et l'athlète en barre.
 *
 *  ⚠️ UNE SEULE DES DEUX MISES EN PAGE EST RENDUE (`useMediaQuery`), pas l'autre
 *  cachée en CSS : chaque texte y figurerait deux fois, pour les lecteurs
 *  d'écran comme pour les specs. */
export function Plateau({ participants, movementNames, maxAttempts, canWrite, setAttempt, onChangeParticipant, onRemoveParticipant, categories, jours, flights, onSaveFlights, classementGeneral }: {
  participants: Participant[];
  movementNames: string[];
  maxAttempts: number;
  canWrite: boolean;
  setAttempt: SetAttempt;
  onChangeParticipant: (pi: number, patch: Partial<Participant>) => void;
  onRemoveParticipant: (pi: number) => void;
  categories: WeightCategories;
  jours: { start: string; end: string } | null;
  /** Les groupes : ils se créent et se règlent dans le bloc des athlètes. */
  flights: Flight[];
  onSaveFlights: (flights: Flight[]) => void;
  /** En tête, à côté du classement du groupe. */
  classementGeneral?: ReactNode;
}) {
  // Deux colonnes seulement là où la feuille tient à côté du panneau.
  const large = useMediaQuery('(min-width: 1280px)');
  const flightNames = useMemo(() => flights.map(f => f.name), [flights]);
  const plateau = usePlateau(participants, flightNames, movementNames, maxAttempts);
  // LE GROUPE CONSULTÉ, un seul pour le bloc des athlètes et le classement du
  // groupe. Le choix tient tant que l'encart ne bouge pas ; dès qu'un autre
  // athlète passe en barre, on suit son groupe.
  const [choix, setChoix] = useState<{ flight: string | null; enPiste: string | null; enBarre: number | null } | null>(null);
  const groupes = flightsEnLice(participants, flightNames);
  // Tous les groupes, même vides : un groupe se crée avant qu'on y range quelqu'un.
  const tousLesGroupes: (string | null)[] = participants.some(p => !p.flight) ? [...flightNames, null] : flightNames;
  const enPiste = plateau.tour?.flight ?? null;
  const consulte = choix && choix.enPiste === enPiste && choix.enBarre === plateau.selection && tousLesGroupes.includes(choix.flight) ? choix.flight : undefined;
  const flightConsulte = consulte !== undefined ? consulte : (plateau.tour ? enPiste : tousLesGroupes[0] ?? null);
  const setConsulte = (flight: string | null | undefined) => setChoix(flight === undefined ? null : { flight, enPiste, enBarre: plateau.selection });

  const live = (
    <>
      <CarteDuTour plateau={plateau} participants={participants} groupes={groupes} avecPastilles />
      <EnBarre plateau={plateau} participants={participants} canWrite={canWrite} setAttempt={setAttempt} />
    </>
  );
  const suivi = (
    <SuiviParGroupe plateau={plateau} participants={participants} groupes={tousLesGroupes} flight={flightConsulte}
                    onChoisirFlight={setConsulte} flights={flights} categories={categories} onSaveFlights={onSaveFlights}
                    movementNames={movementNames}
                    maxAttempts={maxAttempts} canWrite={canWrite} onChangeParticipant={onChangeParticipant}
                    onRemoveParticipant={onRemoveParticipant} jours={jours} />
  );
  const classement = <ClassementDuGroupe participants={participants} flight={flightConsulte} />;

  if (large) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          {classement}
          {classementGeneral}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_380px] items-start gap-4">
          {suivi}
          <div className="flex flex-col gap-4">{live}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {/* Au téléphone, l'encart live d'abord : c'est lui qu'on tient au bord du plateau. */}
      {live}
      {suivi}
      {classement}
      {classementGeneral}
    </div>
  );
}
