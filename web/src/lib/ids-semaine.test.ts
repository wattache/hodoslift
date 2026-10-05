import { describe, expect, it } from 'vitest';

import type { WeekEditing } from '@/api/types';
import { createEmptyExercise } from '@/lib/exercise';
import { adopterLesIds } from '@/lib/ids-semaine';

const ligne = (name: string) => ({ ...createEmptyExercise(), name });

const seance = (name: string, exercises: ReturnType<typeof ligne>[]) =>
  ({ name, sessionDate: '', formOfTheDay: null, exercises, lignesSansRessenti: 0 });

/** ⚠️ COMPLÈTE SAUF LES IDS, et c'est ce que produisent réellement
 *  `createEmptyWeek` et `buildNextWeek` : une semaine entière dont seule
 *  l'identité manque. La fixture d'avant n'avait que `weekNumber` et `sessions`,
 *  et laissait donc croire que la fonction recevait un objet à trous. */
const semaineEnvoyee = (): WeekEditing => ({
  weekNumber: 1,
  name: '',
  hidden: false,
  startDate: '',
  endDate: '',
  athlete: { firstName: '', lastName: '', height: 0, weight: 0 },
  sessions: [
    seance('Lundi', [ligne('SQUAT'), ligne('DIPS')]),
    seance('Jeudi', [ligne('MUSCLE UP')]),
  ],
});

describe('adopterLesIds', () => {
  it('recolle l\'identité de la semaine, des séances et des lignes', () => {
    const semaine = adopterLesIds(semaineEnvoyee(), {
      week: 'w-1',
      sessions: [
        { id: 's-1', exercises: ['e-1', 'e-2'] },
        { id: 's-2', exercises: ['e-3'] },
      ],
    });

    expect(semaine.id).toBe('w-1');
    expect(semaine.sessions?.map(s => s.id)).toEqual(['s-1', 's-2']);
    expect(semaine.sessions?.flatMap(s => s.exercises.map(e => e.id)))
      .toEqual(['e-1', 'e-2', 'e-3']);
  });

  /** LE cas qui justifie que le serveur rende `null` plutôt qu'une liste courte :
   *  le chargement en masse écarte les lignes sans nom. Une liste raccourcie
   *  ferait glisser l'id de la ligne suivante sur celle qui l'a précédée — et
   *  chaque frappe irait alors écrire sur le mauvais exercice. */
  it('ne décale RIEN quand le serveur a écarté une ligne', () => {
    const envoyee: WeekEditing = {
      ...semaineEnvoyee(),
      sessions: [seance('Lundi', [ligne('SQUAT'), ligne(''), ligne('DIPS')])],
    };

    const semaine = adopterLesIds(envoyee, {
      week: 'w-1',
      sessions: [{ id: 's-1', exercises: ['e-1', null, 'e-2'] }],
    });

    const lignes = semaine.sessions![0].exercises;
    expect(lignes[0]).toMatchObject({ name: 'SQUAT', id: 'e-1' });
    expect(lignes[1].id).toBeUndefined();          // écartée : toujours sans identité
    expect(lignes[2]).toMatchObject({ name: 'DIPS', id: 'e-2' });
  });

  it('conserve le contenu de chaque ligne', () => {
    const envoyee: WeekEditing = {
      ...semaineEnvoyee(),
      sessions: [seance('Lundi', [{ ...ligne('SQUAT'), sets: '5', reps: '3', weightLocked: true }])],
    };

    const ligneRendue = adopterLesIds(envoyee, {
      week: 'w-1', sessions: [{ id: 's-1', exercises: ['e-1'] }],
    }).sessions![0].exercises[0];

    expect(ligneRendue).toMatchObject({ sets: '5', reps: '3', weightLocked: true, id: 'e-1' });
  });

  it('survit à une réponse sans arbre de séances', () => {
    // Un serveur plus ancien, ou une semaine créée vide : on garde ce qu'on a
    // plutôt que de fabriquer des identités.
    const semaine = adopterLesIds(semaineEnvoyee(), { week: 'w-1' });

    expect(semaine.id).toBe('w-1');
    expect(semaine.sessions?.every(s => s.id === undefined)).toBe(true);
  });
});
