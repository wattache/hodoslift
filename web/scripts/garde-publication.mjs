/** CE QUI DOIT ÊTRE VRAI D'UN BUNDLE QU'ON SERT À QUELQU'UN D'AUTRE (FRE-83).
 *
 *  ⚠️ IL N'Y A PAS DE `.env.production`. Vite charge `.env.local` dans TOUS les
 *  modes, y compris le build de publication — donc la configuration de la prod
 *  est le fichier dans lequel on bascule pour développer. `.env.example` invite
 *  lui-même à y mettre `http://localhost:8080`.
 *
 *  ⚠️ CE GARDE EST PRÉVENTIF, PAS CURATIF, et la nuance mérite d'être écrite :
 *  au 27/08 `.env.local` pointe correctement sur Cloud Run. Rien n'est cassé. Ce
 *  qui manque est qu'aucune vérification ne l'exige — le build contrôle le SHA
 *  et refuse l'émulateur d'authentification, jamais la cible de l'API. Basculer
 *  ce fichier sur localhost pour développer est un geste normal et fréquent ; le
 *  seul rempart aujourd'hui est de penser à le rebasculer.
 *
 *  ⚠️ ET LA PANNE AURAIT ÉTÉ MUETTE AU BUILD, bruyante chez les athlètes : le
 *  bundle se construit parfaitement, se déploie, et échoue à la première requête
 *  — sur tous les écrans à la fois, sans une ligne dans les journaux du serveur,
 *  puisque aucune requête ne l'atteint.
 *
 *  ⚠️ POURQUOI CE CONTRÔLE NE S'APPLIQUE PAS À TOUT BUILD. `npm run build` sert
 *  aussi à vérifier que le code compile — en CI, où aucune variable n'est posée,
 *  et ici quand on veut juste voir passer `tsc`. Exiger l'URL de prod à chaque
 *  fois ferait échouer la CI pour une raison qui n'a rien à voir avec elle. Le
 *  contrôle se déclenche donc sur une INTENTION explicite, `FF_PUBLICATION`, que
 *  seules les cibles de déploiement du Makefile posent.
 */

import { loadEnv } from 'vite';

const publication = process.env.FF_PUBLICATION;
if (!publication) process.exit(0);

// ⚠️ `loadEnv` ET NON `process.env`, ET C'EST LE PIÈGE DE CE FICHIER. Vite charge
// les `.env*` pour l'APPLICATION ; un script Node lancé à côté ne voit que ce que
// le shell a exporté. Lire `process.env.VITE_BROKKR_URL` ici rendrait TOUJOURS
// vide — le garde crierait au loup à chaque publication, et on apprendrait à le
// contourner. Le même piège est consigné dans `vite.config.ts` pour le jeton
// Sentry ; c'est la deuxième fois qu'il se pose.
const env = loadEnv('production', process.cwd(), '');
const url = (env.VITE_BROKKR_URL ?? '').trim();
const urlSindri = (env.VITE_SINDRI_URL ?? '').trim();

const refuser = (raison, detail) => {
  console.error(
    `\n⛔ Publication refusée — ${raison}.\n` +
    `   VITE_BROKKR_URL = ${url || '(vide)'}\n` +
    `   ${detail}\n` +
    `   Corrige .env.local, puis relance.\n`,
  );
  process.exit(1);
};

if (!url) {
  refuser("l'URL de brokkr n'est pas définie",
          "Sans elle, le front n'a aucune API à appeler.");
}

// Un CHEMIN (`/api`) désigne la même origine que le front : Caddy le route
// (`Caddyfile`). Rien à refuser — ni machine locale, ni texte en clair.
const memeOrigine = (u) => u.startsWith('/');

let cible;
try {
  cible = new URL(url, 'https://meme-origine.invalide');
} catch {
  refuser("l'URL de brokkr est illisible", "Une URL absolue, ou un chemin de la même origine, est attendu.");
}

// ⚠️ ON REFUSE CE QUI EST FAUX, ON N'IMPOSE PAS UNE VALEUR. Épingler l'URL exacte
// de Cloud Run ici obligerait à modifier ce script le jour où brokkr déménage —
// et ce jour-là, c'est justement le déménagement qu'on veut réussir, pas un
// garde-fou à contourner. Les deux formes qui trompent sont l'oubli (localhost)
// et le texte en clair (http), et elles se reconnaissent sans connaître la cible.
if (!memeOrigine(url) && ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(cible.hostname)) {
  refuser("l'URL de brokkr est LOCALE",
          "Ce bundle parlerait à une machine que personne d'autre n'a.");
}

if (!memeOrigine(url) && cible.protocol !== 'https:') {
  refuser("l'URL de brokkr n'est pas en https",
          'Le jeton d\'authentification y circule à chaque requête.');
}

// ⚠️ SINDRI AUSSI, MÊMES RÈGLES : la bibliothèque n'a plus d'autre serveur.
let cibleSindri;
try {
  if (!urlSindri) throw new Error('vide');
  cibleSindri = new URL(urlSindri, 'https://meme-origine.invalide');
} catch {
  refuser("l'URL de sindri est absente ou illisible", `VITE_SINDRI_URL = ${urlSindri || '(vide)'} — la bibliothèque n'aurait aucun serveur.`);
}
if (!memeOrigine(urlSindri) && (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(cibleSindri.hostname) || cibleSindri.protocol !== 'https:')) {
  refuser("l'URL de sindri est locale ou en clair", `VITE_SINDRI_URL = ${urlSindri}`);
}

const dire = (u, c) => (memeOrigine(u) ? `${u} (même origine)` : c.origin);
console.log(`· publication (${publication}) — brokkr : ${dire(url, cible)} · sindri : ${dire(urlSindri, cibleSindri)}`);
