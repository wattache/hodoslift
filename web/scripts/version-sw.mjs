// Post-build hook : patche dist/sw.js pour que CACHE_NAME change à chaque build.
//
// Sans ça, l'event `activate` du SW garde l'ancien cache intact et les anciens
// assets continuent d'être servis après un redéploiement. On remplace le
// suffixe par l'identifiant du build : à chaque deploy, le nouveau SW purge
// automatiquement le vieux cache.
//
// CET IDENTIFIANT EST LE SHA DU COMMIT (cf. version.mjs), plus un horodatage.
// Les deux changent à chaque build, donc les deux purgeaient le cache ; mais un
// horodatage ne répond pas à « qu'est-ce qui tourne en prod ? ». Le nom de cache
// est lisible par un simple `curl` sur `sw.js` — c'est devenu la sonde de
// vérification d'après-déploiement (cf. verifier-deploiement.mjs).
//
// Ne tourne PAS en dev (Vite sert public/sw.js direct, pas dist/) — et le
// registration script d'index.html désinscrit de toute façon le SW en local.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { versionDuBuild } from './version.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const swPath = resolve(here, '..', 'dist', 'sw.js');

if (!existsSync(swPath)) {
  console.warn(`[version-sw] ${swPath} introuvable, skip (build dev ?).`);
  process.exit(0);
}

// `BUILD_ID` reste prioritaire : il permet de forcer une valeur (reproduction
// d'un build, environnement sans git).
const version = process.env.BUILD_ID || `${versionDuBuild().nom}-${Date.now()}`;
const original = readFileSync(swPath, 'utf8');
const patched = original.replace(
  /const CACHE_NAME = ['"]eitri-v1['"];/,
  `const CACHE_NAME = 'eitri-${version}';`,
);

if (patched === original) {
  console.warn(`[version-sw] Motif CACHE_NAME non trouvé dans ${swPath} — vérifie public/sw.js.`);
  process.exit(0);
}

writeFileSync(swPath, patched);
console.log(`[version-sw] CACHE_NAME → eitri-${version}`);
