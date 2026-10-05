/** LE RANG DE CHAQUE TRACÉ, par hauteur DÉCROISSANTE — mesuré, pas calculé.
 *
 *  ⚠️ CE FICHIER EST MESURÉ DANS UN VRAI MOTEUR DE RENDU, et il ne peut pas
 *  l'être ailleurs : la hauteur d'un `d` SVG demande `getBBox()`, que jsdom
 *  n'implémente pas. Le parser à la main, sur des courbes de Bézier relatives,
 *  donnerait un à-peu-près — et deux tracés de 180 et 179 s'inverseraient.
 *
 *  ⚠️ IL EST DONC UNE DONNÉE DÉRIVÉE, et une donnée dérivée dérive. La spec
 *  `e2e/faisceaux.spec.ts` la remesure dans le navigateur et rougit si la
 *  planche a bougé sans que ce fichier suive.
 *
 *  Le rang sert à apparier les deux côtés du corps : la planche ne range PAS
 *  ses tracés dans le même ordre à gauche et à droite (7 zones sur 19), mais
 *  les hauteurs, elles, se correspondent.
 */
export const RANGS: Record<string, readonly number[]> = {
  'dos/calves/left': [0, 2, 1, 3],
  'dos/calves/right': [0, 1, 2, 3],
  'dos/forearm/left': [0, 3, 1, 2],
  'dos/forearm/right': [3, 0, 1, 2],
  'dos/gluteal/left': [1, 0],
  'dos/gluteal/right': [1, 0],
  'dos/hamstring/left': [2, 1, 0, 3],
  'dos/hamstring/right': [0, 1, 3, 2],
  'dos/hands/left': [5, 3, 0, 1, 2, 4],
  'dos/hands/right': [0, 5, 3, 1, 4, 2],
  'dos/lower-back/left': [1, 0],
  'dos/lower-back/right': [0, 1],
  'dos/triceps/left': [2, 0, 1],
  'dos/triceps/right': [2, 0, 1],
  'dos/upper-back/left': [1, 0, 2],
  'dos/upper-back/right': [1, 2, 0],
  'face/abs/left': [2, 3, 1, 0],
  'face/abs/right': [1, 2, 3, 0],
  'face/adductors/left': [1, 0, 2],
  'face/adductors/right': [1, 0, 2],
  'face/ankles/left': [1, 0],
  'face/ankles/right': [1, 0],
  'face/calves/left': [0, 1],
  'face/calves/right': [0, 1],
  'face/feet/left': [0, 1],
  'face/feet/right': [0, 1],
  'face/forearm/left': [0, 1, 2],
  'face/forearm/right': [0, 1, 2],
  'face/hands/left': [0, 5, 3, 1, 4, 2],
  'face/hands/right': [0, 5, 3, 1, 4, 2],
  'face/knees/left': [1, 0],
  'face/knees/right': [1, 0],
  'face/neck/left': [0, 1],
  'face/neck/right': [0, 1],
  'face/obliques/left': [7, 6, 3, 4, 5, 2, 1, 0],
  'face/obliques/right': [7, 6, 3, 4, 5, 2, 1, 0],
  'face/quadriceps/left': [0, 1, 2],
  'face/quadriceps/right': [0, 1, 2],
};

/** Le rang d'un tracé, ou son index quand la zone n'est pas mesurée (un seul
 *  tracé : le rang ne veut rien dire, et il n'y a rien à apparier). */
export function rangDuTrace(vue: string, slug: string, cote: string, index: number): number {
  return RANGS[`${vue}/${slug}/${cote}`]?.[index] ?? index;
}
