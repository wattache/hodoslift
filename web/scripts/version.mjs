// LA VERSION D'UN BUILD — le SHA court du commit, et rien d'autre.
//
// Le numéro AFFICHÉ (`package.json`, « v1.0.0 » au pied de la barre latérale)
// est autre chose : un repère pour les gens, promu à la main. Il ne sert à rien
// de technique, parce qu'il ne désigne pas un commit — le SHA, lui, est exact,
// gratuit, et remonte au commit.
//
// UNE SEULE SOURCE, TROIS CONSOMMATEURS — le nom de cache du service worker, la
// `release` Sentry, et la vérification d'après-déploiement. C'est ce qui rend la
// vérification possible : comparer deux valeurs n'a de sens que si elles ne
// peuvent pas diverger par construction.
//
// ⚠️ LE SUFFIXE `-sale`. Un build depuis un arbre modifié porte un SHA qui MENT
// sur ce qu'il contient — et c'est le genre de mensonge qu'on ne découvre que
// trois jours plus tard, en cherchant pourquoi un correctif « déployé » est
// absent. Le build reste possible (on travaille), il se dénonce simplement ; et
// `make hosting` refuse de publier ce qui se dénonce.
//
// ⚠️ LA VERSION EST LE DERNIER COMMIT QUI TOUCHE CE DOSSIER, pas la tête du
// dépôt : le monorepo porte aussi le serveur, et un commit de brokkr seul ne
// change rien à ce que le front sert. Même règle pour l'arbre sale — un fichier
// modifié dans brokkr/ ne bloque pas la publication du front. Les deux commandes
// s'exécutent depuis eitri/ (npm, make et vite s'y placent).

import { execSync } from 'node:child_process';

function git(commande) {
  return execSync(commande, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

export function versionDuBuild() {
  try {
    const sha = git('git log -1 --format=%h -- .');
    const sale = git('git status --porcelain -- .') !== '';
    return { sha, sale, nom: sale ? `${sha}-sale` : sha };
  } catch {
    // Pas de dépôt git (archive, conteneur sans .git) : on ne peut pas mentir
    // sur une version qu'on ignore, on dit qu'on l'ignore.
    return { sha: '', sale: false, nom: 'inconnue' };
  }
}

// Exécuté directement (`node scripts/version.mjs`) : imprime la version, pour
// qu'un Makefile ou un shell puisse la lire sans dupliquer la logique ci-dessus.
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(versionDuBuild().nom);
}
