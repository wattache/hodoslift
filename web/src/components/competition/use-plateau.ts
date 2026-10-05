import { useMemo, useState } from 'react';
import { ordreDuTour, premierTourOuvert, sequenceDesTours, type EntreeDuTour, type Tour } from '@/lib/comp-helpers';
import { memeTour, tourDuPlateau } from '@/lib/plateau';
import type { Participant } from './types';

/** Où regarde le Plateau : le tour affiché, et l'athlète en barre.
 *
 *  LE TOUR SUIT LE PLATEAU, SANS ARRACHER LA CONSULTATION (décision du 24/09).
 *  Tant que le suivi est armé, le tour affiché est celui du plateau
 *  (`tourDuPlateau`) : le dernier verdict d'un tour fait passer au suivant. Une
 *  navigation à la main — flèches, case d'un autre tour, autre groupe — coupe
 *  le suivi ; `revenir` le réarme. Un verdict un autre téléphone ne ramène pas.
 *
 *  ⚠️ UN VERDICT POSÉ ICI RAMÈNE AU PLATEAU : le passage suivant est le premier
 *  qui attend dans l'ordre de la compétition, pas le suivant de l'athlète qu'on
 *  vient de juger. Juger les trois muscle up d'Ignacy d'affilée mène au premier
 *  de Théo, qui attend encore, pas au premier pull up d'Ignacy.
 *
 *  Les flèches avancent d'un PASSAGE — un athlète d'un tour, dans l'ordre de
 *  barre —, pas d'un tour entier.
 *
 *  ⚠️ UN NO REP ÉPINGLE L'ESSAI JUGÉ, le temps de choisir son motif : sans ça,
 *  le panneau passerait au suivant avant qu'on ait pu dire pourquoi. Choisir le
 *  motif ramène au plateau. */
export function usePlateau(participants: Participant[], flightNames: string[], movementNames: string[], maxAttempts: number) {
  const tours = useMemo(() => sequenceDesTours(participants, flightNames, movementNames, maxAttempts),
    [participants, flightNames, movementNames, maxAttempts]);
  const live = tourDuPlateau(participants, tours);

  const [suivi, setSuivi] = useState(true);
  const [manuel, setManuel] = useState<Tour | null>(null);
  const [choisi, setChoisi] = useState<number | null>(null);

  const idxManuel = manuel ? tours.findIndex(t => memeTour(t, manuel)) : -1;
  const idx = suivi || idxManuel < 0 ? live : idxManuel;
  const tour: Tour | undefined = tours[idx];
  const file: EntreeDuTour[] = tour ? ordreDuTour(participants, tour.flight, tour.mouvement, tour.essai) : [];
  const enAttente = file.filter(e => !e.juge);

  // L'athlète choisi, s'il est du groupe affiché ; sinon le premier qui attend.
  const choisiValide = choisi != null && participants[choisi]
    && (participants[choisi].flight ?? null) === (tour?.flight ?? null);
  const selection: number | null = choisiValide ? choisi : (enAttente[0]?.index ?? file[0]?.index ?? null);

  // Les passages de la compétition, tour après tour, chacun dans son ordre de barre.
  const levees = useMemo(() => tours.flatMap((t, ti) =>
    ordreDuTour(participants, t.flight, t.mouvement, t.essai).map(e => ({ ti, pi: e.index }))), [tours, participants]);
  const position = levees.findIndex(l => l.ti === idx && l.pi === selection);

  const allerAuTour = (t: Tour, pi: number | null = null) => {
    const i = tours.findIndex(x => memeTour(x, t));
    if (i < 0) return;
    setManuel(t);
    setSuivi(i === live);
    setChoisi(pi);
  };

  const revenir = () => { setSuivi(true); setManuel(null); setChoisi(null); };

  return {
    tours, idx, live, tour, file, enAttente, selection, suivi,
    allerAuTour,
    revenir,
    precedent: () => { const l = levees[position - 1] ?? (position < 0 ? levees.filter(x => x.ti < idx).pop() : undefined); if (l) allerAuTour(tours[l.ti], l.pi); },
    suivant: () => { const l = position >= 0 ? levees[position + 1] : levees.find(x => x.ti > idx); if (l) allerAuTour(tours[l.ti], l.pi); },
    premierPassage: position === 0 || (position < 0 && !levees.some(x => x.ti < idx)),
    dernierPassage: position === levees.length - 1 || (position < 0 && !levees.some(x => x.ti > idx)),
    choisirLeGroupe: (flight: string | null) => {
      const t = premierTourOuvert(participants, flight, movementNames, maxAttempts);
      allerAuTour({ flight, mouvement: movementNames[t.mouvement], essai: t.essai });
    },
    /** Choisir un athlète du tour affiché (ordre de barre, nom sur la feuille). */
    choisir: (pi: number) => { setChoisi(pi); },
    apresVerdict: (pi: number, resultat: 'rep' | 'norep' | '') => {
      if (resultat === 'norep' && tour) {
        setManuel(tour);
        setSuivi(false);
        setChoisi(pi);
        return;
      }
      revenir();
    },
    /** Le motif dit, l'essai épinglé se libère : retour au plateau. */
    apresMotif: () => { revenir(); },
  };
}

export type EtatDuPlateau = ReturnType<typeof usePlateau>;
