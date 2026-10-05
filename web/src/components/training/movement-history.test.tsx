// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { BlockEditing, ExerciseEditing } from '@/api/types';
import i18n from '@/i18n';
import { MovementHistory } from './movement-history';

/** L'HISTORIQUE REPLIÉ DE LA BASE — FRE-167.
 *
 *  ⚠️ CE FICHIER NAÎT D'UNE DEMANDE D'AUBIN, pas d'un inventaire : « au sein
 *  d'un macro cycle, quand on programme dans la BASE, on voit les historiques,
 *  mais ils sont illisibles ». Mesuré en production le 11/09 : 3 cartes en
 *  moyenne par (macro, mouvement), 19 au maximum — soit, à neuf rangées la
 *  carte, une cinquantaine de rangées de chiffres sous chaque mouvement.
 *
 *  ⚠️ ET « DÉPLIABLE » NE SUFFISAIT PAS. Un simple titre repliable aurait rendu
 *  la comparaison de quatre blocs plus coûteuse qu'avant : quatre clics pour
 *  revenir au point de départ. C'est la ligne REPLIÉE qui doit répondre — d'où
 *  les specs ci-dessous, qui portent toutes sur ce qu'on lit SANS déplier. */

const exo = (p: Partial<ExerciseEditing>) => ({
  name: 'SQUAT', variant: null, tier: '', sets: '5', reps: '3',
  repsDone: '', repsUnit: 'count', weight: '', weightDone: '',
  assistance: '', rest: '', restActual: '', aimedRPE: '', feltRPE: '',
  athleteFeedback: '', ...p,
}) as unknown as ExerciseEditing;

/** Un bloc d'une seule séance, une semaine par entrée. */
const bloc = (
  blockNumber: number,
  name: string,
  semaines: Partial<ExerciseEditing>[],
  nomSeance = 'Lundi',
) => ({
  id: `b-${blockNumber}`,
  blockNumber,
  name,
  weeks: semaines.map((ex, i) => ({
    id: `w-${blockNumber}-${i}`,
    weekNumber: i + 1,
    sessions: [{ id: `s-${blockNumber}-${i}`, name: nomSeance, exercises: [exo(ex)] }],
  })),
}) as unknown as BlockEditing;

const monter = (pastBlocks: BlockEditing[]) =>
  render(<MovementHistory movement="SQUAT" pastBlocks={pastBlocks} />);

beforeAll(async () => { await i18n.changeLanguage('fr'); });
// `globals: false` dans vitest.config : le nettoyage automatique de RTL n'est
// pas branché, et deux montages se superposeraient dans le même document.
afterEach(cleanup);

describe('MovementHistory', () => {
  const troisSemaines = [
    { weight: '100', aimedRPE: '8', feltRPE: '8' },
    { weight: '110', aimedRPE: '8', feltRPE: '8' },
    { weight: '115', aimedRPE: '8', feltRPE: '8' },
  ];

  it('répond sans qu\'on déplie : trajectoire, delta et verdict RPE', () => {
    monter([bloc(3, 'Force', troisSemaines)]);
    const ligne = screen.getByRole('button', { name: /Force/ });
    expect(ligne.textContent).toContain('100 → 115 kg');
    expect(ligne.textContent).toContain('+15 kg');
    expect(ligne.textContent).toContain('RPE tenu');
  });

  // ⚠️ La régression que garde cette spec : tout ouvert au montage ramènerait
  // exactement l'écran qu'Aubin a signalé.
  it('est repliée au montage, et le détail n\'est pas dans le document', () => {
    monter([bloc(3, 'Force', troisSemaines)]);
    expect(screen.getByRole('button', { name: /Force/ }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Volume')).toBeNull();
  });

  it('déplie au clic, et le détail apparaît', () => {
    monter([bloc(3, 'Force', troisSemaines)]);
    const ligne = screen.getByRole('button', { name: /Force/ });
    fireEvent.click(ligne);
    expect(ligne.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Volume')).toBeTruthy();
    // L'en-tête de la carte ne se répète pas : le titre vit dans la ligne.
    expect(screen.queryByText('Progression sur le bloc')).toBeNull();
  });

  it('« Tout déplier » ouvre tous les blocs d\'un geste', () => {
    monter([bloc(3, 'Force', troisSemaines), bloc(2, 'Volume', troisSemaines)]);
    fireEvent.click(screen.getByRole('button', { name: 'Tout déplier' }));
    for (const nom of [/Force/, /Volume/]) {
      expect(screen.getByRole('button', { name: nom }).getAttribute('aria-expanded')).toBe('true');
    }
    expect(screen.getByRole('button', { name: 'Tout replier' })).toBeTruthy();
  });

  // ⚠️ Le plus récent EN HAUT : `pastBlocks` arrive dans l'ordre du macro, et
  // ce que le coach vient chercher en écrivant sa trame est le dernier bloc.
  it('met le bloc le plus récent en premier', () => {
    monter([bloc(2, 'Volume', troisSemaines), bloc(3, 'Force', troisSemaines)]);
    const lignes = screen.getAllByRole('button', { expanded: false });
    expect(lignes[0].textContent).toContain('Force');
    expect(lignes[1].textContent).toContain('Volume');
  });

  it('dit « RPE dépassé ×2 » quand deux semaines passent au-dessus de la cible', () => {
    monter([bloc(3, 'Force', [
      { weight: '100', aimedRPE: '8', feltRPE: '9' },
      { weight: '110', aimedRPE: '8', feltRPE: '8' },
      { weight: '115', aimedRPE: '8', feltRPE: 'FAIL' },
    ])]);
    expect(screen.getByRole('button', { name: /Force/ }).textContent).toContain('RPE dépassé ×2');
  });

  // ⚠️ Sans cible, on ne dit pas « tenu » : cf. `verdictRPE`.
  it('ne prétend pas « RPE tenu » quand aucune semaine ne porte de cible', () => {
    monter([bloc(3, 'Force', [{ weight: '100', feltRPE: '9' }, { weight: '110', feltRPE: '8' }])]);
    const ligne = screen.getByRole('button', { name: /Force/ });
    expect(ligne.textContent).toContain('sans cible');
    expect(ligne.textContent).not.toContain('RPE tenu');
  });

  it('n\'invente pas de trajectoire quand aucune semaine ne porte de charge', () => {
    monter([bloc(3, 'Force', [{ sets: '3', reps: '10' }, { sets: '3', reps: '12' }])]);
    const ligne = screen.getByRole('button', { name: /Force/ });
    expect(ligne.textContent).toContain('—');
    expect(ligne.textContent).not.toContain('kg');
  });

  /** Un seul bloc, deux séances portant le mouvement — le lundi lourd et le
   *  vendredi sumo. 26,5 % des couples (macro, bloc, mouvement) de production
   *  sont dans ce cas (mesuré le 11/09 sur 3 079 couples). */
  const blocADeuxCreneaux = (lundi = troisSemaines, vendredi = troisSemaines) => {
    const a = bloc(3, 'Force', lundi, 'Lundi');
    const b = bloc(3, 'Force', vendredi, 'Vendredi');
    return {
      ...a,
      weeks: a.weeks.map((w, i) => ({
        ...w,
        sessions: [...w.sessions!, ...(b.weeks[i]?.sessions ?? [])],
      })),
    } as unknown as BlockEditing;
  };

  // ⚠️ LE PLI EST PAR BLOC : deux lignes de même titre à se suivre était le
  // deuxième grief. L'unité que le coach lit est le bloc.
  it('ne fait qu\'un seul pli pour un bloc à deux créneaux', () => {
    monter([blocADeuxCreneaux()]);
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(1);
  });

  // ⚠️ Fondre le lundi lourd et le vendredi sumo en un seul « 80 → 115 kg »
  // inventerait une progression que personne n'a faite.
  it('n\'invente pas de trajectoire commune à deux créneaux', () => {
    const leger = [{ weight: '80', aimedRPE: '8', feltRPE: '8' }, { weight: '85', aimedRPE: '8', feltRPE: '8' }];
    monter([blocADeuxCreneaux(troisSemaines, leger)]);
    const ligne = screen.getByRole('button', { name: /Force/ });
    expect(ligne.textContent).toContain('2 créneaux');
    expect(ligne.textContent).not.toContain('→');
    // Le verdict RPE, lui, s'agrège sans mentir : il compte des dépassements.
    expect(ligne.textContent).toContain('RPE tenu');
  });

  it('donne sa trajectoire à chaque créneau une fois le bloc déplié', () => {
    const leger = [{ weight: '80', aimedRPE: '8', feltRPE: '8' }, { weight: '85', aimedRPE: '8', feltRPE: '8' }];
    monter([blocADeuxCreneaux(troisSemaines, leger)]);
    fireEvent.click(screen.getByRole('button', { name: /Force/ }));
    const contenu = document.getElementById('historique-b-3')!;
    expect(within(contenu).getByText('Lundi')).toBeTruthy();
    expect(within(contenu).getByText('Vendredi')).toBeTruthy();
    expect(contenu.textContent).toContain('100 → 115 kg');
    expect(contenu.textContent).toContain('80 → 85 kg');
  });

  // ⚠️ À créneau unique, la description vit SUR la ligne : le pli n'a pas de
  // sous-en-tête, et sans ça la variante et le tempo disparaîtraient dans les
  // 73,5 % de blocs qui n'ont qu'un créneau.
  it('décrit le créneau unique sur la ligne, pas dans le pli', () => {
    monter([bloc(3, 'Force', troisSemaines, 'Lundi')]);
    const ligne = screen.getByRole('button', { name: /Force/ });
    expect(ligne.textContent).toContain('Lundi');
    fireEvent.click(ligne);
    expect(document.getElementById('historique-b-3')!.textContent).not.toContain('Lundi');
  });

  /** ⚠️ « Le nom seul ne dit pas l'exercice » : un squat NEUTRE en 3010 et un
   *  squat en 10X0 ne se comparent pas. Mesuré le 11/09 : 48,3 % des lignes
   *  portent une variante, 24,6 % un tempo. */
  it('écrit la variante et le tempo à côté du jour', () => {
    monter([bloc(3, 'Force', troisSemaines.map(s => ({ ...s, variant: ['NEUTRE'], tempo: '3010' })), 'Lundi')]);
    expect(screen.getByRole('button', { name: /Force/ }).textContent).toContain('Lundi · NEUTRE · 3010');
  });

  // ⚠️ Un tempo qui change en cours de bloc ne se résume pas à sa première
  // valeur : 0,1 % des créneaux de production, mais choisir affirmerait une
  // constance que la donnée ne porte pas.
  it('montre les deux tempos quand il change dans le bloc', () => {
    monter([bloc(3, 'Force', [
      { weight: '100', tempo: '3010' },
      { weight: '110', tempo: '20X0' },
    ], 'Lundi')]);
    expect(screen.getByRole('button', { name: /Force/ }).textContent).toContain('Lundi · 3010 / 20X0');
  });

  // ⚠️ « 112,5 » et non « 112.5 » : c'est la demi-plaque qu'on vient lire.
  it('garde les décimales, au séparateur de la locale', () => {
    monter([bloc(3, 'Force', [
      { weight: '85', aimedRPE: '8', feltRPE: '8' },
      { weight: '82.5', aimedRPE: '8', feltRPE: '8' },
    ])]);
    const ligne = screen.getByRole('button', { name: /Force/ });
    expect(ligne.textContent).toContain('85 → 82,5 kg');
    expect(ligne.textContent).toContain('−2,5 kg');
  });
});
