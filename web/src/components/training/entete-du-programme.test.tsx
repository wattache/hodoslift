// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import { EnteteDuProgramme } from './entete-du-programme';
import type { MacrocycleEditing } from '@/api/types';

await i18next.changeLanguage('fr');

/** CE QUE L'EN-TÊTE DU PROGRAMME ENCODE — la barre, absorbée le 13/09 (1b).
 *
 *  ⚠️ POURQUOI UN TEST DE COMPOSANT ET PAS UNE SPEC e2e. La barre est alimentée
 *  par `useStructure`, dont la réponse est PERSISTÉE dans IndexedDB (`gcTime` =
 *  péremption hors-ligne, FRE-118). Sur le dev-mock, modifier `mockTraining` ne
 *  change donc rien à l'écran tant que le cache disque n'a pas péri : j'ai
 *  essayé, deux fois, et les états « semaine vide » et « semaine masquée » sont
 *  restés inatteignables depuis le navigateur. Ils ne sont traversés par AUCUNE
 *  spec du harnais — c'est ce trou-là que ce fichier bouche.
 *
 *  ⚠️ ET CE QU'IL GARDE N'EST PAS « ça s'affiche », MAIS LE VOCABULAIRE. Quatre
 *  fois dans ce produit, un état s'est signalé par une OPACITÉ, et quatre fois il
 *  a fallu la retirer : sous le seuil de contraste, « pas actif » devient
 *  « illisible ». Le cas qui tranche est ici — le coach relit une semaine masquée
 *  pour décider de la rouvrir, et à `opacity-40` sur un chiffre de 12 px, il ne
 *  peut pas. La règle est écrite dans `docs/design.md` ; ces specs l'y tiennent.
 */

afterEach(cleanup);

const semaine = (n: number, o: Partial<{ hidden: boolean; seances: number }> = {}) => ({
  id: `w${n}`, weekNumber: n, name: '', hidden: o.hidden ?? false,
  startDate: '', endDate: '',
  athlete: { firstName: 'Léa', lastName: 'Martin', height: 168, weight: 62 },
  sessions: Array.from({ length: o.seances ?? 1 }, (_, i) => ({ id: `s${n}-${i}`, exercises: [] })),
});

/** `name: ''` → le générateur ; un nom non vide → le coach. La distinction est
 *  exactement ce que la convention « mono » sert à dire. */
const macros = (nomMacro = 'Prépa', nomBloc = 'Accumulation'): MacrocycleEditing[] => ([{
  id: 'm1', macroNumber: 1, name: nomMacro, trainingFrequency: null, coachNotes: null,
  blocks: [{
    id: 'b1', blockNumber: 1, name: nomBloc, startDate: '', endDate: '',
    weeks: [semaine(1), semaine(2, { seances: 0 }), semaine(3, { hidden: true })],
  }],
}] as unknown as MacrocycleEditing[]);

const barre = (props: Partial<Parameters<typeof EnteteDuProgramme>[0]> = {}) =>
  render(<EnteteDuProgramme macros={macros()} selectedMacroId="m1" selectedBlockId="b1"
                         selectedWeekId="w1" onSelect={() => {}} coachMode {...props} />);

const pastille = (n: number) => screen.getByRole('button', { name: `Semaine ${n}` });

describe('les états d’une semaine', () => {
  it('une semaine VIDE se dessine en tirets, pas en opacité', () => {
    barre();
    const vide = pastille(2);
    expect(vide.className).toContain('border-dashed');
    // ⚠️ LA MOITIÉ QUI COMPTE. Sans elle, remettre `opacity-45` laisserait la
    // spec verte : `border-dashed` peut coexister avec l'opacité.
    expect(vide.className).not.toMatch(/opacity-/);
  });

  it('une semaine MASQUÉE est barrée en rouge, et reste lisible', () => {
    barre();
    const masquee = pastille(3);
    expect(masquee.className).toContain('line-through');
    expect(masquee.className).toContain('decoration-destructive');
    expect(masquee.className).not.toMatch(/opacity-/);
  });

  it('une semaine PROGRAMMÉE n’est ni en tirets ni barrée', () => {
    // Le contre-exemple : sans lui, une règle qui s'appliquerait à TOUTES les
    // pastilles passerait les deux specs ci-dessus.
    barre({ selectedWeekId: 'w3' });
    const programmee = pastille(1);
    expect(programmee.className).not.toContain('border-dashed');
    expect(programmee.className).not.toContain('line-through');
  });

  it('la semaine SÉLECTIONNÉE porte l’aplat doré', () => {
    barre();
    expect(pastille(1).className).toContain('bg-gold');
    // `getAttribute` et non `toHaveAttribute` : `@testing-library/jest-dom`
    // n'est pas installé ici, et son matcher échoue en « Invalid Chai property »
    // — un message qui ne dit pas qu'il manque une dépendance.
    expect(pastille(1).getAttribute('aria-current')).toBe('true');
  });

  it('l’athlète ne voit pas les semaines masquées', () => {
    barre({ coachMode: false });
    expect(screen.queryByRole('button', { name: 'Semaine 3' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Semaine 2' })).toBeTruthy();
  });
});

describe('ce que la barre encode, et rien de plus', () => {
  it('aucun point de nature de bloc', () => {
    /** ⚠️ IL ÉTAIT DEVINÉ DU NOM par `inferBlockKind`, qui retombe sur
     *  « accumulation » pour tout ce qu'elle ne reconnaît pas : « Montée » y
     *  passait pour de l'accumulation. Quatre teintes hors charte, sans légende
     *  nulle part. Décision produit : il ne revient pas. */
    const { container } = barre();
    expect(container.querySelectorAll('[class*="bg-block-"]')).toHaveLength(0);
  });

  it('rien n’est en italique', () => {
    const { container } = barre();
    expect(container.querySelectorAll('[class*="italic"]')).toHaveLength(0);
  });

  it('le bloc sélectionné et la semaine sélectionnée se disent PAREIL', () => {
    // Deux étages, un seul signe : c'est ce qui empêche qu'un des deux se lise
    // comme « presque sélectionné ».
    barre();
    const bloc = screen.getByRole('button', { name: 'Accumulation' });
    expect(bloc.className).toContain('bg-gold');
    expect(pastille(1).className).toContain('bg-gold');
  });
});

describe('un nom fabriqué par le générateur se distingue d’un nom choisi', () => {
  /** ⚠️ LA RÈGLE S'APPLIQUE AUX DEUX ÉTAGES OU À AUCUN. Ce sont deux chemins de
   *  code distincts ; n'en traiter qu'un rend la convention indéchiffrable — on
   *  ne saurait plus si « Bloc 3 » en mono veut dire « auto-généré » ou « niveau
   *  bloc ». Deux specs séparées, donc, pour que l'échec dise LEQUEL a bougé. */

  it('au niveau MACRO', () => {
    render(<EnteteDuProgramme macros={macros('', 'Accumulation')} selectedMacroId="m1"
                           selectedBlockId="b1" selectedWeekId="w1" onSelect={() => {}} coachMode />);
    expect(screen.getByRole('button', { name: 'Macro 1' }).className).toContain('font-mono');
  });

  it('au niveau BLOC', () => {
    render(<EnteteDuProgramme macros={macros('Prépa', '')} selectedMacroId="m1"
                           selectedBlockId="b1" selectedWeekId="w1" onSelect={() => {}} coachMode />);
    // Le libellé porte le mono, pas le bouton : c'est lui qui descend d'un corps,
    // le mono paraissant plus gros à taille égale.
    expect(screen.getByRole('button', { name: 'Bloc 1' }).innerHTML).toContain('font-mono');
  });

  it('un nom CHOISI n’est pas en mono — ni au macro, ni au bloc', () => {
    // Le contre-exemple, et il porte plus que les deux cas passants : mettre tout
    // en mono passerait les specs ci-dessus sans rien distinguer.
    barre();
    expect(screen.getByRole('button', { name: 'Prépa' }).className).not.toContain('font-mono');
    expect(screen.getByRole('button', { name: 'Accumulation' }).innerHTML).not.toContain('font-mono');
  });
});

describe('la navigation EST l’en-tête de la semaine (1b, 13/09)', () => {
  it('la carte porte le titre de la semaine affichée, et le filet doré la ferme', () => {
    const m = macros();
    const { container } = barre({ week: m[0].blocks[0].weeks[0] });
    expect(screen.getByRole('heading', { level: 2, name: 'Semaine 1' })).toBeTruthy();
    const carte = container.querySelector('section')!;
    expect(carte.lastElementChild!.className).toContain('bg-gold');
  });

  it('sans semaine affichée — éditeur de base, hors ligne —, la carte n’est que navigation', () => {
    barre();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(screen.getByRole('button', { name: 'Accumulation' })).toBeTruthy();
  });

  it('les blocs s’enroulent : ni grille à deux colonnes, ni défilement', () => {
    /** Sous 640 px, `grid-cols-2` faisait du bloc courant un aplat de 320 px ; et
     *  `overflow-x` cachait le troisième bloc (retour du 12/09). */
    const { container } = barre();
    const rangee = screen.getByRole('button', { name: 'Accumulation' }).parentElement!;
    expect(rangee.className).toContain('flex-wrap');
    expect(container.innerHTML).not.toContain('grid-cols-2');
    expect(rangee.className).not.toMatch(/overflow-x/);
  });
});
