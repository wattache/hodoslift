// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import i18n from '@/i18n';
import { rpeDotColor } from '@/lib/rpe';
import { ExerciseProgressionCard } from './exercise-progression';
import type { ProgressionPoint } from './exercise-progression-data';

/** LA PROGRESSION DU BLOC : UNE CARTE, PARTOUT — maquette 6a (15/09).
 *
 *  Une colonne par semaine, dans le pli comme dans la BASE ; une courbe qui porte
 *  les charges ; des rangées Volume, RPE et Repos en « prescrit → réel » sur une
 *  ligne, le prescrit en gris devant le réel. */

const point = (i: number, p: Partial<ProgressionPoint> = {}): ProgressionPoint => ({
  label: `S${i + 1}`, sets: '1', reps: '10', repsDone: '', repsUnit: 'count',
  kg: 7.5 + i * 2.5, kgDone: null, kgEffective: 7.5 + i * 2.5, assistance: '',
  rest: '', restActual: '', variante: '', tempo: '', rpe: 6 + i, rpeRaw: String(6 + i),
  aimedRpeRaw: '', feedback: '', ...p,
});
const semaines = (n: number) => Array.from({ length: n }, (_, i) => point(i));

beforeAll(async () => { await i18n.changeLanguage('fr'); });
afterEach(cleanup);

const corps = (c: HTMLElement) => c.querySelector('.rounded-md.border')!;
const tous = (c: HTMLElement, sel: string) => [...c.querySelectorAll(sel)] as HTMLElement[];
const textes = (c: HTMLElement, sel: string) => tous(c, sel).map(e => e.textContent);
/** Une couleur telle que le navigateur la normalise — `var(--x)` compris. */
const couleur = (c: string) => { const s = document.createElement('span'); s.style.color = c; return s.style.color; };

describe('la carte de progression', () => {
  it('est la MÊME dans le pli et dans la BASE', () => {
    const pli = render(<ExerciseProgressionCard points={semaines(3)} />);
    const structure = [...corps(pli.container).children].map(e => e.children.length);
    pli.unmount();
    const base = render(<ExerciseProgressionCard points={semaines(3)} contexte="base" />);
    expect([...corps(base.container).children].map(e => e.children.length)).toEqual(structure);
  });

  it('sa hauteur ne dépend pas du nombre de semaines : une semaine est une colonne', () => {
    /** MUTATION QUI ROUGIT : une rangée par semaine (les barres de 2b). */
    const deux = render(<ExerciseProgressionCard points={semaines(2)} />);
    const n = corps(deux.container).children.length;
    deux.unmount();
    const six = render(<ExerciseProgressionCard points={semaines(6)} />);
    expect(corps(six.container).children.length).toBe(n);
  });

  it('chaque cellule est dans la colonne de SA semaine, même quand toutes ont un écart', () => {
    /** Le piège 3 de la maquette : sans placement explicite, une cellule absente
     *  ou en trop décale toutes les suivantes d'une semaine.
     *  MUTATION QUI ROUGIT : retirer `gridColumn` des cellules de rangée. */
    const points = semaines(4).map(p => ({ ...p, aimedRpeRaw: '9' }));
    const { container } = render(<ExerciseProgressionCard points={points} />);
    for (const sel of ['[data-valeur-volume]', '[data-valeur-rpe]']) {
      expect(tous(container, sel).map(e => e.style.gridColumn)).toEqual(['2', '3', '4', '5']);
    }
  });

  it('la charge est cadrée sur SES extrêmes : le plus léger en bas, le plus lourd en haut', () => {
    /** Sur une échelle partant de zéro, un bloc de 7,5 à 15 kg est un trait quasi
     *  plat. MUTATION QUI ROUGIT : cadrer à partir de 0 (le plus léger ne descend
     *  plus au sol de la bande). */
    const { container } = render(<ExerciseProgressionCard points={semaines(4)} />);
    expect(textes(container, '[data-valeur-charge]')).toEqual(['7,5', '10', '12,5', '15']);
    const tops = tous(container, '[data-valeur-charge]').map(e => parseFloat(e.style.top));
    // Géométrie large : jsdom n'a pas de requête média (cf. `useMediaQuery`).
    expect(tops[0]).toBe(96 - 24);   // l'étiquette au-dessus du point posé au SOL
    expect(tops[3]).toBe(30 - 24);   // et au-dessus du point posé au CIEL
  });

  it('une charge réelle qui quitte la consigne passe en or, et la consigne reste écrite', () => {
    /** MUTATION QUI ROUGIT : ne plus rendre le prescrit (`data-prescrit-charge`)
     *  à côté du point creux. */
    const { container } = render(
      <ExerciseProgressionCard points={[point(0), point(1, { kgDone: 9, kgEffective: 9 })]} />);
    const [conforme, ecart] = tous(container, '[data-valeur-charge]');
    expect(ecart.textContent).toBe('9');
    expect(ecart.className).toContain('text-gold');
    expect(conforme.className).not.toContain('text-gold');
    expect(textes(container, '[data-prescrit-charge]')).toEqual(['10']);
  });

  it('une semaine sans charge est un TROU : le trait se coupe, rien n’est relié', () => {
    /** FRE-114 : relier inventerait une progression qui n'a pas eu lieu.
     *  MUTATION QUI ROUGIT : sauter le trou au lieu de couper le segment. */
    const points = semaines(5).map((p, i) => i === 2 ? { ...p, kg: null, kgEffective: null } : p);
    const { container } = render(<ExerciseProgressionCard points={points} />);
    expect(container.querySelectorAll('svg polyline')).toHaveLength(2);
    expect(textes(container, '[data-valeur-charge]')).toEqual(['7,5', '10', '15', '17,5']);
  });

  it('aucun chiffre dans le SVG : un SVG étiré comprimerait la fonte', () => {
    /** MUTATION QUI ROUGIT : rendre les valeurs en `<text>`. */
    const { container } = render(<ExerciseProgressionCard points={semaines(3)} />);
    expect(container.querySelectorAll('svg text')).toHaveLength(0);
  });

  it('le volume s’écrit « prescrit → réel », et le réel n’est jamais normalisé', () => {
    /** « 8/6/6 » raconte les séries ; « 3×6 » les effacerait.
     *  MUTATION QUI ROUGIT : rendre le réel sans son prescrit devant. */
    const { container } = render(<ExerciseProgressionCard points={[
      point(0, { sets: '3', reps: '8' }),
      point(1, { sets: '3', reps: '8', repsDone: '8/6/6' }),
    ]} />);
    expect(textes(container, '[data-valeur-volume]')).toEqual(['3×8', '3×8 → 8/6/6']);
  });

  it('le RPE s’écrit « visé → ressenti », dans la couleur de son échelle, et FAIL reste un mot', () => {
    /** MUTATION QUI ROUGIT : afficher `rpeToNumber` (FAIL → 10). */
    const { container } = render(<ExerciseProgressionCard points={[
      point(0, { aimedRpeRaw: '8', rpeRaw: '8', rpe: 8 }),
      point(1, { aimedRpeRaw: '8', rpeRaw: 'FAIL', rpe: 10 }),
      point(2, { aimedRpeRaw: '8', rpeRaw: '', rpe: null }),
    ]} />);
    expect(textes(container, '[data-valeur-rpe]')).toEqual(['8', '8 → FAIL', '8']);
    const reels = tous(container, '[data-valeur-rpe]').map(e => e.lastElementChild as HTMLElement);
    expect(reels[1].style.color).toBe(couleur(rpeDotColor('FAIL')));
    // Pas encore ressenti : la cible seule, en gris.
    expect(reels[2].className).toContain('text-muted-foreground');
  });

  it("le repos s’écrit « Libre → 3' », et sa rangée n’existe que s’il y a un repos", () => {
    /** MUTATION QUI ROUGIT : retirer la rangée Repos (la maquette 6a l'avait
     *  perdue ; William l'a redemandée le 15/09). */
    const avec = render(<ExerciseProgressionCard points={[point(0, { rest: '180' }), point(1, { restActual: '180' })]} />);
    expect(textes(avec.container, '[data-valeur-repos]')).toEqual(["3'", "Libre → 3'"]);
    avec.unmount();
    const sans = render(<ExerciseProgressionCard points={semaines(2)} />);
    expect(sans.container.querySelectorAll('[data-valeur-repos]')).toHaveLength(0);
  });

  it('la semaine en cours est marquée', () => {
    const { container } = render(<ExerciseProgressionCard points={semaines(3)} semaineCourante="S3" />);
    expect(tous(container, '[data-semaine]').map(e => e.className.includes('text-gold'))).toEqual([false, false, true]);
  });
});
