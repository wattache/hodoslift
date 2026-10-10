import { useMemo, useState, type ReactNode } from 'react';
import type { Flight, WeightCategories } from '@/api/types';
import { useMediaQuery } from '@/lib/use-mobile';
import { ClassementDuGroupe } from './classements';
import { SuiviParGroupe } from './suivi-par-groupe';
import type { Participant, SetAttempt } from './types';
import type { Reglement } from '@/lib/norep-reasons';
import { usePlateau } from './use-plateau';

/** Le Plateau : les classements, puis les groupes et la carte d'un athlète, où
 *  chaque essai se saisit (FRE-225). Pas d'encart qui suit la séquence : sur un
 *  plateau, chaque coach tient SON athlète, et choisit ce qu'il regarde.
 *
 *  ⚠️ UNE SEULE DES DEUX MISES EN PAGE EST RENDUE (`useMediaQuery`), pas l'autre
 *  cachée en CSS : chaque texte y figurerait deux fois, pour les lecteurs
 *  d'écran comme pour les specs. */
export function Plateau({ participants, movementNames, maxAttempts, reglement, canWrite, setAttempt, onChangeParticipant, onRemoveParticipant, categories, jours, flights, onSaveFlights, classementGeneral }: {
  participants: Participant[];
  movementNames: string[];
  maxAttempts: number;
  reglement: Reglement;
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
  // Tous les groupes, même vides : un groupe se crée avant qu'on y range quelqu'un.
  const tousLesGroupes: (string | null)[] = participants.some(p => !p.flight) ? [...flightNames, null] : flightNames;
  // LE GROUPE CONSULTÉ, un seul pour le bloc des athlètes et le classement du
  // groupe. Il tient tant qu'on ne le change pas : sur un plateau, chaque coach
  // regarde le sien (FRE-225).
  const [choix, setChoix] = useState<string | null | undefined>(undefined);
  const flightConsulte = choix !== undefined && tousLesGroupes.includes(choix) ? choix : (tousLesGroupes[0] ?? null);

  const suivi = (
    <SuiviParGroupe plateau={plateau} participants={participants} groupes={tousLesGroupes} flight={flightConsulte}
                    onChoisirFlight={f => setChoix(f)} flights={flights} categories={categories} onSaveFlights={onSaveFlights}
                    movementNames={movementNames}
                    maxAttempts={maxAttempts} reglement={reglement} canWrite={canWrite} setAttempt={setAttempt} onChangeParticipant={onChangeParticipant}
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
        {suivi}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {/* Au téléphone, l'athlète d'abord : c'est lui qu'on tient au bord du plateau. */}
      {suivi}
      {classement}
      {classementGeneral}
    </div>
  );
}
