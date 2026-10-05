/** LE NOM DE CHAQUE FAISCEAU D'UNE ZONE — FRE-195.
 *
 *  La planche dessine une zone en plusieurs tracés : trois pour l'avant-bras,
 *  quatre pour les ischio-jambiers. Ces tracés ne portaient aucun nom, et tous
 *  répondaient « Avant-bras » — alors qu'un athlète écrit « brachial et brachio
 *  radial, dips ». Cette table leur en donne un.
 *
 *  ⚠️ ON NE NOMME QUE CE QU'ON RECONNAÎT. Une zone absente d'ici garde son nom
 *  d'ensemble, et c'est voulu : les huit tracés des obliques sont des stries du
 *  même muscle, les quatre des abdominaux les étages d'UN grand droit. Les
 *  nommer séparément inventerait une anatomie que le dessin ne porte pas.
 *
 *  ⚠️ L'INDEX DE LA PLANCHE NE SERT À RIEN : l'ordre des tracés DIFFÈRE entre le
 *  côté gauche et le côté droit sur 7 zones sur 19 (abs, hamstring, calves de
 *  dos, forearm de dos, upper-back, lower-back, hands). Un mapping par index
 *  serait juste d'un côté et faux de l'autre — une douleur au semi-membraneux
 *  droit s'appellerait « biceps fémoral » à gauche.
 *
 *  ON APPARIE DONC PAR LA HAUTEUR DU TRACÉ, décroissante. Mesuré : les deux
 *  côtés donnent la même suite de hauteurs à 2 unités près, sur toutes les
 *  zones. `zones.test.ts` le remesure à chaque passage.
 */

/** Les faisceaux d'une zone, du PLUS HAUT au plus court.
 *
 *  Deux rangs peuvent porter le même nom : le biceps fémoral est dessiné en
 *  deux tracés, le soléaire aussi. C'est un muscle, deux traits.
 */
export const FAISCEAUX: Record<string, readonly string[]> = {
  // ── MEMBRE SUPÉRIEUR ──────────────────────────────────────────────────────
  //
  // ⚠️ LE CAS QUI A LANCÉ TOUT CECI. « Brachial et brachio radial, dips » est
  // une saisie de production ; l'ancienne lecture rendait « Avant-bras » et
  // perdait le muscle. De l'EXTERNE (radial, côté pouce) vers l'INTERNE.
  'face/forearm': ['brachioradialis', 'flexor-carpi-radialis', 'flexor-carpi-ulnaris'],

  // De dos, la face des extenseurs. L'anconé est ce petit triangle sous le
  // coude — le plus court des quatre, et le plus facile à reconnaître.
  'dos/forearm': ['wrist-extensors', 'brachioradialis', 'finger-extensors', 'anconeus'],

  // Longue portion en haut (elle part de l'omoplate), vaste externe en dehors.
  'dos/triceps': ['triceps-medial', 'triceps-lateral', 'triceps-long'],

  // ⚠️ LA VUE SUFFIT À DISTINGUER LES DEUX FAISCEAUX DU DELTOÏDE, et c'est le
  // seul endroit de cette table où elle est l'information : de face on voit
  // l'antérieur, de dos le postérieur. Le tracé est unique de chaque côté, mais
  // il ne montre pas le même muscle selon qu'on regarde devant ou derrière.
  //
  // ⚠️ LE DELTOÏDE MOYEN N'EST PAS DISTINGUABLE : la planche ne le dessine pas
  // à part, il est pris dans les deux autres. On ne le nomme donc pas — c'est
  // la règle de cette table, on ne nomme que ce que le dessin porte.
  'face/deltoids': ['deltoid-anterior'],
  'dos/deltoids': ['deltoid-posterior'],

  // ── TRONC ─────────────────────────────────────────────────────────────────
  'dos/upper-back': ['latissimus-dorsi', 'trapezius', 'infraspinatus'],

  // Les érecteurs longent la colonne ; le carré des lombes est plus dehors.
  'dos/lower-back': ['erector-spinae', 'quadratus-lumborum'],

  // ── MEMBRE INFÉRIEUR ──────────────────────────────────────────────────────
  //
  // ⚠️ « TON ADDUCTEUR C'EST LE SARTORIUS » (William, 22/09). Le plus long
  // tracé de cette zone traverse la cuisse en diagonale : c'est le couturier,
  // pas un adducteur. L'appeler « adducteurs » envoyait le kiné à l'intérieur
  // de la cuisse pour une douleur qui court sur toute sa face antérieure.
  'face/adductors': ['sartorius', 'adductors', 'gracilis'],

  // Le vaste médial est ce renflement bas et interne, juste au-dessus du genou.
  'face/quadriceps': ['rectus-femoris', 'vastus-lateralis', 'vastus-medialis'],

  'face/calves': ['gastrocnemius-lateral', 'gastrocnemius-medial'],

  // Deux tracés pour le biceps fémoral, un par chef ; le soléaire aussi.
  'dos/hamstring': ['biceps-femoris', 'semitendinosus', 'biceps-femoris', 'semimembranosus'],
  'dos/calves': ['gastrocnemius-lateral', 'gastrocnemius-medial', 'soleus', 'soleus'],

  'dos/gluteal': ['gluteus-maximus', 'gluteus-medius'],

  // ── LA MAIN ───────────────────────────────────────────────────────────────
  //
  // ⚠️ CE NE SONT PAS DES MUSCLES, ET C'EST POURTANT CE QU'ON DÉSIGNE. « Douleur
  // sur le coté de la main » est une saisie de production : l'athlète montre un
  // doigt, pas un interosseux. Les six tracés sont la paume et les cinq doigts.
  //
  // ⚠️ IDENTIFIÉS PAR LEUR FORME, PAS PAR LEUR POSITION. Le dessin du dos n'est
  // pas le miroir de celui de face — le pouce y tombe du même côté de l'image —
  // donc se fier au x nommerait un doigt pour un autre sur une des deux vues.
  // Les proportions, elles, se correspondent : pouce court et large (34×40),
  // majeur le plus long (30×57), auriculaire le plus fin (8×41).
  //
  // ⚠️ LE POUCE ET L'AURICULAIRE NE TIENNENT QU'À UN POINT (40 contre 41 de
  // haut), et le rang les sépare par la hauteur. C'est le seul appariement de
  // cette table qui se joue d'aussi peu : si la planche bouge, `faisceaux.spec`
  // les verra s'échanger.
  'face/hands': ['palm', 'middle-finger', 'ring-finger', 'index-finger', 'little-finger', 'thumb'],
  'dos/hands': ['palm', 'middle-finger', 'ring-finger', 'index-finger', 'little-finger', 'thumb'],
};

/** Le rang d'un tracé une fois la zone triée par hauteur DÉCROISSANTE.
 *
 *  ⚠️ C'EST CE TRI QUI REND LES DEUX CÔTÉS COMPARABLES, et rien d'autre : la
 *  planche ne range pas ses tracés dans le même ordre à gauche et à droite.
 *  Les hauteurs, elles, se correspondent à 2 unités près.
 */
export function rangsParHauteur(hauteurs: readonly number[]): number[] {
  const rang = new Array<number>(hauteurs.length);
  [...hauteurs.keys()]
    .sort((a, b) => hauteurs[b] - hauteurs[a])
    .forEach((indexOriginal, position) => { rang[indexOriginal] = position; });
  return rang;
}

/** Le nom du faisceau, ou `null` quand la zone n'est pas détaillée ici. */
export function faisceauDe(vue: string, slug: string, rang: number): string | null {
  return FAISCEAUX[`${vue}/${slug}`]?.[rang] ?? null;
}
