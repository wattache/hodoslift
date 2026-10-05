// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import { GoalsList } from './goals-list';
import type { Goal } from '@/api/types';

await i18next.changeLanguage('fr');

/** D'OÙ VIENNENT LES MOUVEMENTS PROPOSÉS À UN OBJECTIF — FRE-140.
 *
 *  ⚠️ ILS ÉTAIENT CODÉS EN DUR (`PRINCIPAL_MOVEMENTS`), alors que
 *  `athlete_goals.exercise` porte une clé étrangère vers la bibliothèque depuis
 *  FRE-123 : proposer un nom qu'elle ne contient pas donne un 422 à
 *  l'enregistrement. Les deux listes coïncidaient au moment du correctif — sept
 *  contre sept, mesuré — c'est FRE-147 qui venait de les réaligner. Le défaut
 *  était donc LATENT, et le lot 4 de FRE-11 (renommages) allait le réveiller.
 */
afterEach(cleanup);

const objectif = (exercise: string): Goal => ({
  id: 'g1', exercise, sets: '1', reps: '1', weight: '0',
  motivation: '', createdAt: '2026-09-01', achievedAt: null,
} as Goal);

/** Le sélecteur n'existe QU'EN MODE ÉDITION — la vue de lecture affiche le nom
 *  en texte. Une spec qui rend le composant et cherche le `<select>` tout de
 *  suite ne trouve rien, et l'erreur ne dit pas pourquoi. */
const enEdition = () => fireEvent.click(screen.getByRole('button', { name: /Éditer|Edit/ }));

const options = () =>
  [...screen.getByRole('combobox').querySelectorAll('option')].map(o => o.textContent);

describe('le sélecteur de mouvement d’un objectif', () => {
  it('propose ce que la BIBLIOTHÈQUE donne, et rien d’autre', () => {
    render(<GoalsList goals={[objectif('SQUAT')]} mouvements={['SQUAT', 'DEADLIFT']}
                      onReplace={() => {}} />);
    enEdition();
    expect(options()).toEqual(['SQUAT', 'DEADLIFT']);
  });

  it('⚠️ GARDE LA VALEUR COURANTE même si la bibliothèque ne la propose plus', () => {
    // Le cas d'un mouvement retiré du flag `competition` après coup. Sans cette
    // règle, le `<select>` s'afficherait VIDE et le premier changement de
    // n'importe quel autre champ réécrirait l'objectif en silence — le défaut du
    // type d'événement `rest`, repris à l'identique.
    render(<GoalsList goals={[objectif('MUSCLE UP')]} mouvements={['SQUAT', 'DEADLIFT']}
                      onReplace={() => {}} />);
    enEdition();
    expect(options()).toEqual(['MUSCLE UP', 'SQUAT', 'DEADLIFT']);
    expect(screen.getByRole('combobox')).toHaveProperty('value', 'MUSCLE UP');
  });
});

describe('le bouton « Ajouter » et la bibliothèque pas encore chargée', () => {
  /** ⚠️ LE FRONT NE PROPOSE PAS UNE ÉCRITURE QUE BROKKR REFUSE (FRE-157).
   *
   *  `exercise: mouvements[0] ?? ''` fabriquait un objectif à exercice VIDE tant
   *  que `useLibrary` n'avait pas répondu. L'enregistrement remplaçant la LISTE
   *  ENTIÈRE, brokkr refusait tout le lot en 422 — le coach perdait donc aussi
   *  les objectifs qu'il venait de corriger.
   *
   *  Aucune spec ne couvrait `mouvements = []` : les deux existantes passent une
   *  liste pleine. */
  it('⚠️ N’OFFRE PAS le geste tant qu’aucun mouvement n’est connu', () => {
    render(<GoalsList goals={[objectif('SQUAT')]} mouvements={[]} onReplace={() => {}} />);
    enEdition();
    expect(screen.queryByRole('button', { name: /Ajouter/ })).toBeNull();
  });

  it('l’offre dès que la bibliothèque a répondu', () => {
    render(<GoalsList goals={[objectif('SQUAT')]} mouvements={['SQUAT']} onReplace={() => {}} />);
    enEdition();
    expect(screen.getByRole('button', { name: /Ajouter/ })).toBeTruthy();
  });
});
