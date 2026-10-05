/** Le tracé des courbes de donnée : adoucir sans inventer, relier sans mentir.
 *
 *  ⚠️ POURQUOI PAS UNE CATMULL-ROM, QUI EST LA SPLINE QU'ON ÉCRIT D'INSTINCT.
 *  Elle DÉPASSE quand la pente change brusquement. Deux cas mesurés :
 *  `62 → 62,5 → 63 → 61` la fait monter à **63,06** — un kilo que personne n'a
 *  pesé, sur le seul écran où l'athlète lit sa santé ; `10 → 11 → 12 → 50` la
 *  fait descendre à **8,91**, sous le minimum de la série.
 *
 *  La cubique MONOTONE (Fritsch–Carlson, 1980) borne les pentes pour que la
 *  courbe ne sorte jamais de l'intervalle de ses voisins : elle arrondit
 *  l'angle, elle n'ajoute aucune valeur. `courbe.test.ts` la distingue d'une
 *  Catmull-Rom sur ces deux séries exactement — et ⚠️ le cas qu'on écrit
 *  d'instinct (un plateau, `60 → 61 → 61 → 66`) NE SÉPARE PAS les deux : la
 *  branche `seg === 0` l'aplatit de toute façon. Une spec posée là serait verte
 *  avec n'importe quelle interpolation.
 *
 *  Ce fichier vit dans `lib/` et non dans un composant : un module qui exporte
 *  autre chose qu'un composant casse le rafraîchissement à chaud de Vite (la
 *  règle que `pistes.ts` a déjà payée, FRE-114). */

export interface Point {
  x: number;
  y: number;
}

/** Les pentes de Fritsch–Carlson : la tangente en chaque point, bornée pour que
 *  l'interpolation reste monotone par morceaux. */
function pentes(pts: Point[]): number[] {
  const n = pts.length;
  // Les pentes des SEGMENTS (n-1 d'entre elles).
  const seg: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    seg.push(dx === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx);
  }

  const m: number[] = new Array(n);
  m[0] = seg[0];
  m[n - 1] = seg[n - 2];
  for (let i = 1; i < n - 1; i++) {
    // ⚠️ UN EXTREMUM LOCAL A UNE TANGENTE PLATE, ET C'EST TOUT LE THÉORÈME. Si
    // les deux segments voisins n'ont pas le même signe (ou si l'un est plat),
    // le point est un sommet ou un creux : toute tangente non nulle y ferait
    // dépasser la courbe. C'est cette ligne qui empêche le kilo inventé.
    m[i] = seg[i - 1] * seg[i] <= 0 ? 0 : (seg[i - 1] + seg[i]) / 2;
  }

  // Borne de Fritsch–Carlson : une tangente ne peut pas excéder trois fois la
  // pente du segment qu'elle touche, sinon la cubique ressort de l'intervalle.
  for (let i = 0; i < n - 1; i++) {
    if (seg[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / seg[i];
    const b = m[i + 1] / seg[i];
    const s = Math.hypot(a, b);
    if (s > 3) {
      m[i] = ((3 * a) / s) * seg[i];
      m[i + 1] = ((3 * b) / s) * seg[i];
    }
  }
  return m;
}

/** Le chemin SVG adouci qui passe par TOUS les points, sans jamais sortir de
 *  l'intervalle de deux points voisins.
 *
 *  Rend `''` sur une liste vide, un `M` seul sur un point unique (à dessiner
 *  comme une pastille, cf. `daily-chart` : un sous-tracé réduit à un `moveto` ne
 *  peint rien), et un segment droit sur deux points — il n'y a pas d'angle à
 *  arrondir entre deux points. */
export function cheminAdouci(pts: Point[]): string {
  if (!pts.length) return '';
  const f = (v: number) => v.toFixed(1);
  if (pts.length === 1) return `M${f(pts[0].x)},${f(pts[0].y)}`;
  if (pts.length === 2) {
    return `M${f(pts[0].x)},${f(pts[0].y)} L${f(pts[1].x)},${f(pts[1].y)}`;
  }

  const m = pentes(pts);
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    // Une Bézier cubique dont les points de contrôle portent les tangentes : le
    // tiers de l'intervalle de chaque côté, la forme d'Hermite en coordonnées de
    // Bézier.
    const dx = (pts[i + 1].x - pts[i].x) / 3;
    d +=
      ` C${f(pts[i].x + dx)},${f(pts[i].y + m[i] * dx)}` +
      ` ${f(pts[i + 1].x - dx)},${f(pts[i + 1].y - m[i + 1] * dx)}` +
      ` ${f(pts[i + 1].x)},${f(pts[i + 1].y)}`;
  }
  return d;
}

/** L'aire fermée entre DEUX courbes adoucies.
 *
 *  ⚠️ ELLE NE PEUT PAS ÊTRE TRACÉE À PART DES DEUX TRAITS. Une aire à bords
 *  droits sous deux traits adoucis dépasse dans les creux et se retire dans les
 *  bosses : le remplissage sort de sous la ligne, d'un pixel ou deux, partout.
 *  C'est pour ça que cette fonction existe ici plutôt qu'un `M … L … Z` recopié
 *  dans la vue — la forme de l'aire est la MÊME règle que la forme des traits, et
 *  deux définitions d'une même notion divergent.
 *
 *  Le retour parcourt `bas` à l'envers : la monotone est symétrique par
 *  renversement de l'axe des x (les `dx` changent de signe ensemble), donc le bord
 *  retour épouse exactement la courbe que `cheminAdouci(bas)` dessine. */
export function aireEntreCourbes(haut: Point[], bas: Point[]): string {
  if (haut.length < 2 || bas.length < 2) return '';
  const retour = cheminAdouci([...bas].reverse());
  // `M` → `L` : le retour se raccroche au bord aller au lieu d'ouvrir un
  // sous-tracé, sinon le remplissage se referme tout seul sur chaque moitié.
  return `${cheminAdouci(haut)} L${retour.slice(1)} Z`;
}

/** Le chemin DROIT d'une suite de points, sans adoucissement. Sert aux ponts. */
export function cheminDroit(pts: Point[]): string {
  if (!pts.length) return '';
  const f = (v: number) => v.toFixed(1);
  return pts.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)},${f(p.y)}`).join(' ');
}

/** Les suites de valeurs OBSERVÉES, et les ponts qui les relient.
 *
 *  ⚠️ LE PONT N'EST PAS UN SEGMENT DE LA COURBE, et c'est pour ça qu'il sort à
 *  part : il se dessine plus clair et DROIT. La rectitude dit elle-même qu'on
 *  n'a rien mesuré là — sur les 90 derniers jours, 34 % des paires de pesées
 *  sont des ponts, et le plus large fait 48 jours. Un pont adouci imiterait la
 *  forme des données observées, c'est-à-dire mentirait deux fois.
 *
 *  Une suite d'UN point ne donne pas de tracé : c'est une pastille, à dessiner
 *  par l'appelant. */
export function suitesEtPonts(valeurs: (number | null | undefined)[]): {
  suites: number[][];
  ponts: [number, number][];
} {
  const suites: number[][] = [];
  let courante: number[] = [];
  valeurs.forEach((v, i) => {
    if (typeof v !== 'number') {
      if (courante.length) suites.push(courante);
      courante = [];
    } else courante.push(i);
  });
  if (courante.length) suites.push(courante);

  const ponts: [number, number][] = [];
  for (let k = 0; k < suites.length - 1; k++) {
    ponts.push([suites[k][suites[k].length - 1], suites[k + 1][0]]);
  }
  return { suites, ponts };
}
