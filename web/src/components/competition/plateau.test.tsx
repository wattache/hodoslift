// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import '@/i18n';
import type { Flight } from '@/api/types';
import { Plateau } from './plateau';
import type { Attempt, Participant } from './types';

await i18next.changeLanguage('fr');

/** LE PLATEAU, PAR L'ÉCRAN — ce que `lib/plateau` ne peut pas voir seul : que
 *  l'encart live suive le plateau sans arracher la consultation, que le bloc des
 *  groupes suive l'encart, et qu'une annonce refusée ne parte jamais. */

// L'écran large.
beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width'), media: query,
    addEventListener: () => {}, removeEventListener: () => {},
  }));
});
afterEach(cleanup);

const plan = (p: number, r: number, o: number, rest: Partial<Attempt> = {}): Attempt =>
  ({ weight: 0, result: '', weights: { pessimistic: p, realistic: r, optimistic: o }, ...rest });
const fait = (r: number, result: 'rep' | 'norep' = 'rep'): Attempt =>
  plan(r - 2.5, r, r + 2.5, { weight: r, result, selectedTier: 'realistic' });

const athlete = (name: string, flight: string, squat: Attempt[], dips: Attempt[]): Participant => ({
  name, flight, score: 0, movements: [{ name: 'SQUAT', attempts: squat }, { name: 'DIPS', attempts: dips }],
});

/** Deux groupes, deux mouvements, deux essais : huit tours. Le groupe A a
 *  entamé son squat ; B n'a rien passé. */
const depart = (): Participant[] => [
  athlete('Alice', 'A', [fait(100), plan(100, 105, 110)], [plan(40, 45, 50), plan(45, 50, 55)]),
  athlete('Anna', 'A', [fait(90), plan(92.5, 95, 97.5)], [plan(30, 35, 40), plan(35, 40, 45)]),
  athlete('Bruno', 'B', [plan(150, 160, 170), plan(160, 170, 180)], [plan(60, 65, 70), plan(65, 70, 75)]),
  athlete('Basile', 'B', [plan(140, 150, 160), plan(150, 160, 170)], [plan(50, 55, 60), plan(55, 60, 65)]),
];
const GROUPES: Flight[] = [{ name: 'A', categories: [] }, { name: 'B', categories: [] }];

function Banc({ ecrire = () => {}, initial = depart(), canWrite = true }: {
  ecrire?: (pi: number, attempt: Attempt) => void; initial?: Participant[]; canWrite?: boolean;
}) {
  const [participants, setParticipants] = useState(initial);
  // Un autre téléphone juge le tour 2 : l'écriture arrive par la donnée, pas par ce panneau.
  const ailleurs = () => setParticipants(ps => ps.map(p => p.flight !== 'A' ? p : {
    ...p, movements: p.movements.map(m => m.name !== 'SQUAT' ? m : { ...m, attempts: [m.attempts[0], { ...m.attempts[1], result: 'rep' }] }),
  }));
  return (
    <>
      <button type="button" onClick={ailleurs}>autre téléphone</button>
      <Plateau participants={participants} flights={GROUPES} onSaveFlights={() => {}} movementNames={['SQUAT', 'DIPS']}
               maxAttempts={2} canWrite={canWrite} categories={{ M: [], F: [] }} jours={null}
               onChangeParticipant={() => {}} onRemoveParticipant={() => {}}
               setAttempt={(pi, mi, ai, attempt) => {
                 ecrire(pi, attempt);
                 setParticipants(ps => ps.map((p, i) => i !== pi ? p : {
                   ...p, movements: p.movements.map((m, j) => j !== mi ? m : { ...m, attempts: m.attempts.map((a, k) => k !== ai ? a : attempt) }),
                 }));
               }} />
    </>
  );
}

const tour = () => screen.getByText(/^Tour \d+ \/ 8/).textContent;
const encart = () => screen.getByRole('region', { name: 'En barre' });
const enBarre = () => within(encart()).getByRole('heading').textContent;
const bloc = () => screen.getByRole('region', { name: 'Groupes et athlètes' });
const recap = () => within(bloc()).getAllByRole('heading', { level: 3 })[0].textContent;
/** Consulter un athlète dans le bloc des groupes : l'onglet du groupe, puis sa ligne. */
const consulter = (groupe: string, nom: string) => {
  fireEvent.click(within(bloc()).getByRole('button', { name: `Groupe ${groupe}` }));
  // Sa pastille — le nom puis le total —, pas ses cases (« Anna — SQUAT essai 1… »).
  fireEvent.click(within(within(bloc()).getByRole('group', { name: 'Athlètes du groupe' })).getByRole('button', { name: new RegExp(`^${nom}`) }));
};
const verdict = (v: 'REP' | 'NO REP') => fireEvent.click(within(encart()).getByRole('button', { name: v }));

describe('le Plateau', () => {
  it('s’ouvre sur le tour du plateau', () => {
    render(<Banc />);
    expect(tour()).toBe('Tour 2 / 8 · Groupe A');
    expect(enBarre()).toBe('Anna');
  });

  it('toucher une case du récapitulatif la met en barre, et le tour la suit, groupe compris', () => {
    /** MUTATION QUI ROUGIT : ne pas déplacer le tour au clic — l'encart
     *  resterait sur le squat du groupe A. */
    render(<Banc />);
    consulter('B', 'Basile');
    fireEvent.click(screen.getByRole('button', { name: /^Basile — DIPS essai 2/ }));
    expect(tour()).toBe('Tour 8 / 8 · Groupe B');
    expect(enBarre()).toBe('Basile');
    expect(screen.getByRole('button', { name: /^Basile — DIPS essai 2/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('annoncer change la place dans l’ordre de barre', () => {
    /** MUTATION QUI ROUGIT : ranger le tour par ordre d'inscription — Alice
     *  resterait 1re quelle que soit l'annonce d'Anna. */
    render(<Banc />);
    consulter('A', 'Alice');
    fireEvent.click(screen.getByRole('button', { name: /^Alice — SQUAT essai 2/ }));
    // Alice annonce son P, 100 ; Anna reste à 95 (son R) : Alice passe 2e.
    fireEvent.click(within(within(encart()).getByRole('group', { name: /Charges du plan/ })).getByRole('button', { name: /^100/ }));
    expect(within(encart()).getByText(/passe en 2e sur 2/)).toBeTruthy();
    // Anna annonce 102,5, hors plan : Alice passe devant.
    consulter('A', 'Anna');
    fireEvent.click(screen.getByRole('button', { name: /^Anna — SQUAT essai 2/ }));
    fireEvent.click(within(encart()).getByRole('button', { name: 'Annoncer une charge hors plan' }));
    fireEvent.change(within(encart()).getByRole('textbox', { name: /Charge hors plan/ }), { target: { value: '102.5' } });
    fireEvent.click(within(encart()).getByRole('button', { name: 'Annoncer' }));
    expect(within(encart()).getByText(/passe en 2e sur 2/)).toBeTruthy();
  });

  it('une annonce sous le plancher est refusée AVANT tout envoi', () => {
    /** MUTATION QUI ROUGIT : écrire la saisie libre sans passer par
     *  `annonceLibre` — l'écriture part, et brokkr répondrait 422. */
    const ecrire = vi.fn();
    render(<Banc ecrire={ecrire} />);
    consulter('A', 'Alice');
    fireEvent.click(screen.getByRole('button', { name: /^Alice — SQUAT essai 2/ }));
    // Alice a passé 100 : 97,5 serait une baisse.
    fireEvent.click(within(encart()).getByRole('button', { name: 'Annoncer une charge hors plan' }));
    fireEvent.change(within(encart()).getByRole('textbox', { name: /Charge hors plan/ }), { target: { value: '97.5' } });
    fireEvent.click(within(encart()).getByRole('button', { name: 'Annoncer' }));
    expect(ecrire).not.toHaveBeenCalled();
    expect(within(encart()).getByRole('alert').textContent).toMatch(/une annonce ne baisse pas/);
  });

  it('les flèches avancent d’un passage, et du dernier d’un groupe au premier du suivant', () => {
    /** MUTATION QUI ROUGIT : avancer d'un tour entier — la flèche sauterait
     *  Alice pour passer au groupe B. */
    render(<Banc />);
    // Dips, essai 2 : Anna (40) puis Alice (50), dernier passage du groupe A.
    consulter('A', 'Anna');
    fireEvent.click(screen.getByRole('button', { name: /^Anna — DIPS essai 2/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Passage suivant' }));
    expect([tour(), enBarre()]).toEqual(['Tour 4 / 8 · Groupe A', 'Alice']);
    fireEvent.click(screen.getByRole('button', { name: 'Passage suivant' }));
    // Squat, essai 1 du groupe B : Basile (150) passe avant Bruno (160).
    expect([tour(), enBarre()]).toEqual(['Tour 5 / 8 · Groupe B', 'Basile']);
  });

  it('armé, le suivi avance seul au dernier verdict d’un tour', () => {
    render(<Banc />);
    verdict('REP');
    expect(enBarre()).toBe('Alice');
    verdict('REP');
    expect(tour()).toBe('Tour 3 / 8 · Groupe A');
  });

  it('un verdict posé ici ramène au premier passage qui attend', () => {
    /** ⚠️ LE CAS DE WILLIAM (24/09) : juger d'affilée les essais d'un athlète
     *  menait à son mouvement suivant, pas au passage qui attendait. MUTATION QUI
     *  ROUGIT : rester sur le tour jugé — l'encart resterait sur les dips de B. */
    render(<Banc />);
    consulter('B', 'Basile');
    fireEvent.click(screen.getByRole('button', { name: /^Basile — DIPS essai 2/ }));
    verdict('REP');
    expect([tour(), enBarre()]).toEqual(['Tour 2 / 8 · Groupe A', 'Anna']);
  });

  it('une navigation à la main coupe le suivi, et le bouton le réarme', () => {
    /** MUTATION QUI ROUGIT : garder le suivi armé après une navigation — le tour
     *  jugé depuis l'autre téléphone ramènerait l'encart au tour 3. */
    render(<Banc />);
    expect(screen.queryByRole('button', { name: 'Revenir au tour en cours' })).toBeNull();
    consulter('B', 'Bruno');
    fireEvent.click(screen.getByRole('button', { name: /^Bruno — DIPS essai 1/ }));
    expect(tour()).toBe('Tour 7 / 8 · Groupe B');
    fireEvent.click(screen.getByRole('button', { name: 'autre téléphone' }));
    expect(tour()).toBe('Tour 7 / 8 · Groupe B');
    fireEvent.click(screen.getByRole('button', { name: 'Revenir au tour en cours' }));
    expect(tour()).toBe('Tour 3 / 8 · Groupe A');
  });

  it('un no rep garde l’athlète en barre le temps du motif', () => {
    /** MUTATION QUI ROUGIT : ne pas épingler l'essai — le dernier no rep du tour
     *  ferait passer au tour 3 avant qu'on ait dit pourquoi. */
    render(<Banc />);
    verdict('REP');
    verdict('NO REP');
    expect([tour(), enBarre()]).toEqual(['Tour 2 / 8 · Groupe A', 'Alice']);
    fireEvent.change(within(encart()).getByRole('combobox', { name: 'Motif du no rep' }), { target: { value: 'too_heavy' } });
    expect(tour()).toBe('Tour 3 / 8 · Groupe A');
  });

  it('le bloc des groupes suit l’encart quand un autre athlète passe en barre', () => {
    /** MUTATION QUI ROUGIT : garder le choix quoi qu'il arrive — le bloc
     *  resterait sur Basile quand Alice passe en barre. */
    render(<Banc />);
    consulter('B', 'Basile');
    expect(recap()).toBe('Basile');
    verdict('REP');
    expect([enBarre(), recap()]).toEqual(['Alice', 'Alice']);
  });

  it('un essai sans plan ouvre la saisie de la charge', () => {
    // Anna n'a rien au premier squat, ni plan ni essai avant lui dont hériter.
    const vide = (): Attempt => ({ weight: 0, result: '' });
    const sansPlan = depart().map(p => p.name !== 'Anna' ? p : {
      ...p, movements: p.movements.map(m => m.name !== 'SQUAT' ? m : { ...m, attempts: [vide(), vide()] }),
    });
    render(<Banc initial={sansPlan} />);
    expect([tour(), enBarre()]).toEqual(['Tour 1 / 8 · Groupe A', 'Anna']);
    expect(within(encart()).getByText(/Pas de plan pour cet essai/)).toBeTruthy();
    expect(within(encart()).getByRole('textbox', { name: /Charge hors plan/ })).toBeTruthy();
  });

  it('sans droit d’écriture, tout se lit : pas de case cliquable, pas de verdict', () => {
    /** MUTATION QUI ROUGIT : rendre les cases cliquables pour tous — elles
     *  resteraient dans la tabulation d'un athlète qui ne peut rien écrire. */
    render(<Banc canWrite={false} />);
    expect(screen.queryByRole('button', { name: /^Anna — SQUAT essai 2/ })).toBeNull();
    expect(screen.getByRole('img', { name: /^Anna — SQUAT essai 2/ })).toBeTruthy();
    expect(within(encart()).queryByRole('button', { name: 'REP' })).toBeNull();
  });
});
