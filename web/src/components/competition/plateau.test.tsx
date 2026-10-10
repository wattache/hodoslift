// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import '@/i18n';
import type { Flight } from '@/api/types';
import type { Reglement } from '@/lib/norep-reasons';
import { Plateau } from './plateau';
import type { Attempt, Participant } from './types';

await i18next.changeLanguage('fr');

/** LE PLATEAU, PAR L'ÉCRAN — ce que `lib/plateau` ne peut pas voir seul (FRE-225) :
 *  qu'un coach choisisse SON athlète et le garde, que chaque essai se saisisse
 *  sur sa carte, qu'une annonce refusée ne parte jamais, et que les motifs de
 *  « no rep » soient ceux du règlement de la compétition. */

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

/** Deux groupes, deux mouvements, deux essais. Le groupe A a entamé son squat ;
 *  B n'a rien passé. */
const depart = (): Participant[] => [
  athlete('Alice', 'A', [fait(100), plan(100, 105, 110)], [plan(40, 45, 50), plan(45, 50, 55)]),
  athlete('Anna', 'A', [fait(90), plan(92.5, 95, 97.5)], [plan(30, 35, 40), plan(35, 40, 45)]),
  athlete('Bruno', 'B', [plan(150, 160, 170), plan(160, 170, 180)], [plan(60, 65, 70), plan(65, 70, 75)]),
  athlete('Basile', 'B', [plan(140, 150, 160), plan(150, 160, 170)], [plan(50, 55, 60), plan(55, 60, 65)]),
];
const GROUPES: Flight[] = [{ name: 'A', categories: [] }, { name: 'B', categories: [] }];

function Banc({ ecrire = () => {}, initial = depart(), canWrite = true, reglement = 'fnsl' }: {
  ecrire?: (pi: number, attempt: Attempt) => void; initial?: Participant[]; canWrite?: boolean; reglement?: Reglement;
}) {
  const [participants, setParticipants] = useState(initial);
  // Un autre téléphone juge Alice : l'écriture arrive par la donnée, pas par ce panneau.
  const ailleurs = () => setParticipants(ps => ps.map(p => p.name !== 'Alice' ? p : {
    ...p, movements: p.movements.map(m => m.name !== 'SQUAT' ? m : { ...m, attempts: [m.attempts[0], { ...m.attempts[1], weight: 105, selectedTier: 'realistic', result: 'rep' }] }),
  }));
  return (
    <>
      <button type="button" onClick={ailleurs}>autre téléphone</button>
      <Plateau reglement={reglement} participants={participants} flights={GROUPES} onSaveFlights={() => {}} movementNames={['SQUAT', 'DIPS']}
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

const bloc = () => screen.getByRole('region', { name: 'Groupes et athlètes' });
const recap = () => within(bloc()).getAllByRole('heading', { level: 3 })[0].textContent;
/** Consulter un athlète dans le bloc des groupes : l'onglet du groupe, puis sa pastille. */
const consulter = (groupe: string, nom: string) => {
  fireEvent.click(within(bloc()).getByRole('button', { name: `Groupe ${groupe}` }));
  // Sa pastille — le nom puis le total —, pas ses cases (« Anna — SQUAT essai 1… »).
  fireEvent.click(within(within(bloc()).getByRole('group', { name: 'Athlètes du groupe' })).getByRole('button', { name: new RegExp(`^${nom}`) }));
};
const caseDe = (nom: string, mouvement: string, essai: number) =>
  screen.getByRole('button', { name: new RegExp(`^${nom} — ${mouvement} essai ${essai}`) });
/** La saisie sous la carte, pour l'essai touché. */
const saisie = (mouvement: string, essai: number) => screen.getByRole('region', { name: `${mouvement} · essai ${essai}` });
const verdict = (mouvement: string, essai: number, v: 'REP' | 'NO REP') =>
  fireEvent.click(within(saisie(mouvement, essai)).getByRole('button', { name: v }));

describe('le Plateau', () => {
  it('s’ouvre sur le premier groupe et son premier athlète, sans encart qui suit la séquence', () => {
    render(<Banc />);
    expect(recap()).toBe('Alice');
    expect(screen.queryByRole('region', { name: 'En barre' })).toBeNull();
    expect(screen.queryByText(/^Tour \d+/)).toBeNull();
  });

  it('un essai à venir montre ses trois charges, P R O', () => {
    /** MUTATION QUI ROUGIT : ne montrer que la réaliste — la case dirait « 105 R ». */
    render(<Banc />);
    expect(caseDe('Alice', 'SQUAT', 2).textContent).toBe('100P105R110O');
    // Un essai jugé ne montre que ce qui compte.
    expect(caseDe('Alice', 'SQUAT', 1).textContent).toBe('100R');
  });

  it('toucher une case ouvre la saisie sous la carte ; la retoucher la referme', () => {
    render(<Banc />);
    consulter('B', 'Basile');
    expect(screen.queryByRole('region', { name: /essai/ })).toBeNull();
    fireEvent.click(caseDe('Basile', 'DIPS', 2));
    expect(caseDe('Basile', 'DIPS', 2).getAttribute('aria-pressed')).toBe('true');
    expect(within(saisie('DIPS', 2)).getByRole('button', { name: 'REP' })).toBeTruthy();
    fireEvent.click(caseDe('Basile', 'DIPS', 2));
    expect(screen.queryByRole('region', { name: 'DIPS · essai 2' })).toBeNull();
  });

  it('annoncer sur la carte écrit l’essai, et la case ne montre plus que l’annonce', () => {
    const ecrire = vi.fn();
    render(<Banc ecrire={ecrire} />);
    consulter('A', 'Alice');
    fireEvent.click(caseDe('Alice', 'SQUAT', 2));
    fireEvent.click(within(within(saisie('SQUAT', 2)).getByRole('group', { name: /Charges du plan/ })).getByRole('button', { name: /^100/ }));
    expect(ecrire).toHaveBeenCalledWith(0, expect.objectContaining({ weight: 100, selectedTier: 'pessimistic' }));
    expect(caseDe('Alice', 'SQUAT', 2).textContent).toBe('100P');
  });

  it('une annonce sous le plancher est refusée AVANT tout envoi', () => {
    /** MUTATION QUI ROUGIT : écrire la saisie libre sans passer par
     *  `annonceLibre` — l'écriture part, et brokkr répondrait 422. */
    const ecrire = vi.fn();
    render(<Banc ecrire={ecrire} />);
    consulter('A', 'Alice');
    fireEvent.click(caseDe('Alice', 'SQUAT', 2));
    // Alice a passé 100 : 97,5 serait une baisse.
    const s = saisie('SQUAT', 2);
    fireEvent.click(within(s).getByRole('button', { name: 'Annoncer une charge hors plan' }));
    fireEvent.change(within(s).getByRole('textbox', { name: /Charge hors plan/ }), { target: { value: '97.5' } });
    fireEvent.click(within(s).getByRole('button', { name: 'Annoncer' }));
    expect(ecrire).not.toHaveBeenCalled();
    expect(within(s).getByRole('alert').textContent).toMatch(/une annonce ne baisse pas/);
  });

  it('le verdict écrit l’essai, et la carte RESTE sur l’athlète choisi, quoi que fasse le plateau', () => {
    /** ⚠️ LE CAS DU PLATEAU (coachs, 09/10) : un coach par athlète. MUTATION QUI
     *  ROUGIT : suivre l'athlète en barre après un verdict ou une écriture venue
     *  d'ailleurs — la carte sauterait sur Alice. */
    const ecrire = vi.fn();
    render(<Banc ecrire={ecrire} />);
    consulter('B', 'Basile');
    fireEvent.click(caseDe('Basile', 'SQUAT', 1));
    verdict('SQUAT', 1, 'REP');
    expect(ecrire).toHaveBeenCalledWith(3, expect.objectContaining({ result: 'rep' }));
    expect(recap()).toBe('Basile');
    fireEvent.click(screen.getByRole('button', { name: 'autre téléphone' }));
    expect(recap()).toBe('Basile');
  });

  it('un no rep demande son motif, dans la liste du règlement', () => {
    /** MUTATION QUI ROUGIT : ignorer `reglement` dans `getNorepReasons` — la
     *  liste FNSL servirait une compétition FinalRep. */
    render(<Banc reglement="finalrep" />);
    consulter('A', 'Alice');
    fireEvent.click(caseDe('Alice', 'SQUAT', 2));
    verdict('SQUAT', 2, 'NO REP');
    const motifs = within(saisie('SQUAT', 2)).getByRole('combobox', { name: 'Motif du no rep' });
    const ids = Array.from(motifs.querySelectorAll('option')).map(o => o.value);
    expect(ids).toContain('fr_depth');
    expect(ids).toContain('fr_dropping_bar');
    expect(ids).not.toContain('too_heavy');
    expect(ids).not.toContain('s_depth');
  });

  it('sous FNSL, les motifs sont ceux de la FNSL', () => {
    render(<Banc />);
    consulter('A', 'Alice');
    fireEvent.click(caseDe('Alice', 'SQUAT', 2));
    verdict('SQUAT', 2, 'NO REP');
    const ids = Array.from(within(saisie('SQUAT', 2)).getByRole('combobox', { name: 'Motif du no rep' }).querySelectorAll('option')).map(o => o.value);
    expect(ids).toContain('s_depth');
    expect(ids).not.toContain('fr_depth');
  });

  it('un essai sans plan ouvre la saisie de la charge', () => {
    // Anna n'a rien au premier squat, ni plan ni essai avant lui dont hériter.
    const vide = (): Attempt => ({ weight: 0, result: '' });
    const sansPlan = depart().map(p => p.name !== 'Anna' ? p : {
      ...p, movements: p.movements.map(m => m.name !== 'SQUAT' ? m : { ...m, attempts: [vide(), vide()] }),
    });
    render(<Banc initial={sansPlan} />);
    consulter('A', 'Anna');
    fireEvent.click(caseDe('Anna', 'SQUAT', 1));
    expect(within(saisie('SQUAT', 1)).getByText(/Pas de plan pour cet essai/)).toBeTruthy();
    expect(within(saisie('SQUAT', 1)).getByRole('textbox', { name: /Charge hors plan/ })).toBeTruthy();
  });

  it('sans droit d’écriture, tout se lit : pas de case cliquable, pas de saisie', () => {
    /** MUTATION QUI ROUGIT : rendre les cases cliquables pour tous — elles
     *  resteraient dans la tabulation d'un athlète qui ne peut rien écrire. */
    render(<Banc canWrite={false} />);
    expect(screen.queryByRole("button", { name: /^Alice — SQUAT essai 2/ })).toBeNull();
    expect(screen.getByRole("img", { name: /^Alice — SQUAT essai 2/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'REP' })).toBeNull();
  });
});
