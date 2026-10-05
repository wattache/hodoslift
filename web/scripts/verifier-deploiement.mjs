// LE DÉPLOIEMENT SE PROUVE — il ne se raconte pas.
//
// Le 2026-08-16, un `make deploy` côté brokkr a servi une image périmée sans
// que rien ne le signale : la commande réussissait, la prod tournait sur du
// vieux code, et le diagnostic a coûté une soirée en pleine bascule. La leçon
// n'est pas « faire attention » — c'est qu'une commande de déploiement doit
// VÉRIFIER ce qu'elle prétend avoir fait, sinon personne ne le fera.
//
// Ici : on récupère le `sw.js` RÉELLEMENT SERVI par la production et on
// vérifie qu'il porte la version qu'on vient de construire. Le nom de cache du
// service worker est le seul marqueur public de version côté front (cf.
// version-sw.mjs) — et c'est un choix, pas un hasard : il est lisible sans
// authentification, par un simple `curl`, donc vérifiable par n'importe qui,
// depuis n'importe où, y compris des mois plus tard en cherchant ce qui tourne.
//
// ⚠️ CETTE SONDE PEUT MENTIR PAR CACHE. `sw.js` est servi en `no-cache` (cf.
// firebase.json) : la réponse est revalidée à chaque fois. On ajoute malgré
// tout un paramètre unique pour court-circuiter tout intermédiaire, et on
// laisse au CDN quelques secondes de propagation avant d'échouer pour de bon.

import { versionDuBuild } from './version.mjs';

const URL_PROD = process.env.URL_PROD || 'https://trainer.french-forge.com';
const ATTENTE_MAX_MS = 30_000;
const PAS_MS = 3_000;

const attendue = versionDuBuild().nom;

async function versionServie() {
  const reponse = await fetch(`${URL_PROD}/sw.js?verif=${Date.now()}`, { cache: 'no-store' });
  if (!reponse.ok) throw new Error(`${URL_PROD}/sw.js → HTTP ${reponse.status}`);
  const source = await reponse.text();
  const trouve = source.match(/const CACHE_NAME = ['"]eitri-([^'"]+)['"]/);
  if (!trouve) throw new Error("sw.js servi sans nom de cache reconnaissable");
  return trouve[1];
}

const debut = Date.now();
let derniere = null;

while (Date.now() - debut < ATTENTE_MAX_MS) {
  try {
    derniere = await versionServie();
    // Le nom de cache porte la version PUIS un horodatage (`<version>-<ms>`) :
    // on compare le préfixe, seul porteur de l'identité du commit.
    if (derniere.startsWith(attendue)) {
      console.log(`[verif] OK — la production sert bien ${attendue}`);
      process.exit(0);
    }
  } catch (e) {
    derniere = `illisible (${e.message})`;
  }
  await new Promise((r) => setTimeout(r, PAS_MS));
}

console.error(`
[verif] ÉCHEC — la production ne sert PAS ce qui vient d'être construit.
        attendu : ${attendue}
        servi   : ${derniere}

  Le déploiement a peut-être échoué en silence, ou publié un autre dossier.
  Ne pas annoncer cette version comme livrée tant que ceci ne passe pas.
`);
process.exit(1);
