import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/** Tests UNITAIRES — la logique pure que les e2e ne peuvent pas atteindre.
 *
 *  Les deux suites ne se remplacent pas :
 *   - Playwright vérifie ce qu'un coach VOIT, et c'est irremplaçable ;
 *   - Vitest vérifie ce qui n'est PAS affiché. Le cas qui a motivé son ajout :
 *     un groupe orphelin (`groupId` sur une ligne dont le partenaire a été
 *     supprimé) est invisible par construction — le rendu exige `groupSize > 1`.
 *     Aucun test d'écran ne le distingue d'un groupe sain, et c'est précisément
 *     pour ça que cinq d'entre eux ont survécu des mois en production.
 *
 *  ⚠️ DEPUIS FRE-93, VITEST REND AUSSI DES COMPOSANTS. Le point ci-dessus reste
 *  vrai — ce qui n'est pas affiché ne se teste qu'ici — mais il avait une
 *  réciproque coûteuse : une branche de JSX qu'aucun décor e2e n'atteint
 *  n'était gardée nulle part. C'est ce trou qui a laissé le gate d'accès
 *  affirmer « ton coach ne t'a pas enregistré » à des athlètes hors ligne,
 *  pendant des semaines. Les fichiers `.test.tsx` posent leur environnement
 *  `jsdom` en tête de fichier, un par un : le défaut reste `node`, parce que la
 *  grande majorité des specs sont de la logique pure et n'ont pas à payer le
 *  coût d'un DOM.
 *
 *  `include` reste restreint à `src/` : sans ça Vitest ramasserait les specs
 *  Playwright de `e2e/` et `e2e-reel/`, et les ferait échouer. */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
