import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import path from 'node:path';
import { versionDuBuild } from './scripts/version.mjs';
import paquet from './package.json' with { type: 'json' };

/** ⚠️ LES SOURCE MAPS NE SONT PAS UN CONFORT : sans elles, une trace de
 *  production pointe sur du code minifié — `a.b is not a function`, ligne 1,
 *  colonne 48012 — et Sentry ne sert à rien.
 *
 *  Elles sont générées, envoyées à Sentry, PUIS SUPPRIMÉES du bundle par le
 *  plugin (`filesToDeleteAfterUpload`). Les publier sur l'hébergement
 *  exposerait le code source de l'application à qui ouvre les outils de
 *  développement.
 *
 *  ⚠️ ET L'UPLOAD NE SE FAIT QUE SI L'ON PUBLIE. La CI construit eitri pour
 *  vérifier qu'il compile ; une vérification de compilation n'a pas à publier une
 *  version, sinon le suivi des régressions se remplit de versions fantômes.
 *
 *  Cette condition portait sur la PRÉSENCE DU JETON jusqu'au 27/08 (FRE-83), ce
 *  qui protégeait la CI — elle n'en a pas — mais pas le poste du développeur, où
 *  le jeton vit en permanence dans `.env.local` : chaque build local publiait
 *  donc une release. Elle porte désormais sur `FF_PUBLICATION`, une intention
 *  explicite que seul `make hosting` pose. */
export default defineConfig(({ mode }) => {
  // ⚠️ `loadEnv` ET NON `process.env`, ET LA NUANCE EST TRAÎTRESSE. Vite charge
  // les fichiers `.env*` pour l'APPLICATION (`import.meta.env`), pas pour ce
  // fichier-ci, qui s'exécute dans Node avant. Lire `process.env` directement ne
  // voit donc que ce que le shell a exporté — et un jeton posé dans `.env.local`
  // reste invisible.
  //
  // L'échec aurait été SILENCIEUX : le build passe, le plugin ne s'active pas,
  // aucune source map ne part, et les traces de production restent illisibles
  // sans que rien ne le signale. Vérifié avant de livrer, pas supposé.
  //
  // Le troisième argument `''` charge TOUTES les variables, pas seulement celles
  // préfixées `VITE_` — et `SENTRY_AUTH_TOKEN` n'a justement pas ce préfixe,
  // puisqu'il ne doit jamais entrer dans le bundle.
  const jetonSentry = loadEnv(mode, process.cwd(), '').SENTRY_AUTH_TOKEN;

  // ⚠️ LA PRÉSENCE DU JETON N'EST PAS UNE INTENTION DE PUBLIER (FRE-83). Le jeton
  // vit dans `.env.local`, donc il est là en permanence : CHAQUE `npm run build`
  // local créait une release Sentry et y téléversait des source maps — arbre sale
  // compris, d'où les versions `…-sale` observées deux fois le 21/08.
  //
  // Ce n'est pas qu'une nuisance de comptage : la liste des releases sert à dire
  // « cette erreur est apparue à telle version ». Une release par build local, y
  // compris pour des états jamais déployés, rend cette lecture fausse — et c'est
  // exactement le service qu'on attend de Sentry.
  //
  // On téléverse donc quand on PUBLIE, et le jeton reste nécessaire mais ne
  // suffit plus. `make hosting` pose `FF_PUBLICATION=prod` ; `make preview` pose
  // `preview` et n'entre pas ici — un canal temporaire tolère un arbre sale, donc
  // sa version ne désigne pas forcément un commit.
  const publierSurSentry = process.env.FF_PUBLICATION === 'prod' && !!jetonSentry;

  // ⚠️ LA MÊME VALEUR DES DEUX CÔTÉS, ET C'EST TOUT L'ENJEU. Les source maps
  // sont téléversées SOUS UN NOM DE VERSION, et les événements en portent un
  // aussi. S'ils diffèrent, Sentry a les cartes et les traces sans pouvoir les
  // rapprocher : les traces restent illisibles, exactement comme sans source
  // maps — mais en donnant l'illusion que tout est branché. D'où la source
  // unique, `versionDuBuild()`, injectée ici pour l'upload et là pour le SDK.
  const version = versionDuBuild().nom;

  return {
    // Le SDK lit cette valeur au démarrage (cf. src/lib/observabilite.ts).
    // `define` plutôt qu'un fichier `.env` : la version se calcule au build,
    // elle n'a rien à faire dans une configuration que quelqu'un pourrait
    // éditer — et surtout, elle serait fausse dès le lendemain.
    define: {
      'import.meta.env.VITE_GIT_SHA': JSON.stringify(version),
      // Le numéro qu'on AFFICHE, comme toute app (William, 25/09). Il se promeut à
      // la main dans `package.json` ; le SHA ci-dessus reste la version technique.
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(paquet.version),
    },
    plugins: [
    react(),
    tailwindcss(),
    ...(publierSurSentry
      ? [sentryVitePlugin({
          // ⚠️ LES SLUGS SENTRY, PAS LES NOMS DU DÉPÔT — et la divergence est
          // VOULUE. Le dépôt s'appelle `eitri` ; le projet Sentry s'appelle
          // `fft-react-frontend` parce que c'est ce nom-là qui s'affiche dans les
          // alertes et la liste des incidents, où un nom de code ne dit rien à
          // personne. « French Forge Trainer, le front React » se lit ; « eitri »
          // demande de savoir.
          //
          // Ne PAS « harmoniser » les deux : l'upload échouerait en silence — le
          // build passe, les source maps ne partent pas, et les traces de
          // production redeviennent illisibles sans que rien ne le signale.
          org: 'french-forge-trainer',
          project: 'fft-react-frontend',
          authToken: jetonSentry,
          release: { name: version },
          sourcemaps: { filesToDeleteAfterUpload: ['**/*.js.map'] },
        })]
      : []),
    ],
    // ⚠️ LA MÊME CONDITION QUE LE PLUGIN, ET C'EST UNE OBLIGATION, PAS UNE
    // SYMÉTRIE ESTHÉTIQUE. Ce sont les `filesToDeleteAfterUpload` du plugin qui
    // retirent les `.js.map` du bundle une fois envoyées. Générer les cartes sans
    // activer le plugin les laisserait donc DANS `dist/`, et le déploiement
    // publierait le code source de l'application à qui ouvre les outils de
    // développement — précisément ce que l'en-tête de ce fichier interdit.
    //
    // Le cas concret que ça évite : `make preview` a le jeton (il est dans
    // `.env.local`) mais ne publie pas sur Sentry. Adossé au jeton seul, il
    // aurait déposé les source maps sur le canal de prévisualisation.
    build: { sourcemap: publierSurSentry },
    resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    },
    server: {
      port: 5174,
    },
  };
});
