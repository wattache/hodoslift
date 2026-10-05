// LE NUMÉRO AFFICHÉ SE PROMEUT À CHAQUE LIVRAISON (William, 25/09).
//
// Une livraison pose le tag `v<numéro>` et note dedans ce qu'elle a livré : le
// SHA d'eitri, de brokkr et de sindri. Livrer ensuite un AUTRE contenu — l'un
// des trois changé — sous le même numéro est refusé : il faut monter le numéro
// de `package.json`. Republier exactement le même contenu reste permis.
//
//   node scripts/numero-de-version.mjs verifier   refuse (code 1) si le numéro est déjà pris
//   node scripts/numero-de-version.mjs poser      pose le tag après une publication réussie
//
// ⚠️ DANS LE MONOREPO, LE SHA D'UN SERVICE EST CELUI DU DERNIER COMMIT QUI TOUCHE
// SON DOSSIER, comme `version.mjs` et les `SHA ?=` des Makefiles : c'est ce que
// chacun sert, et un commit d'un autre dossier n'y change rien. Le commit taggé,
// lui, est la tête du dépôt — il ne dit donc plus le SHA d'eitri, d'où la note.
// Un tag de l'ancien format (dépôt eitri seul, note `brokkr=` seule) se lit
// encore : eitri = le commit taggé, sindri = inconnu.
//
// `BROKKR_SHA` et `SINDRI_SHA` surchargent la lecture du dépôt.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SERVEURS = ['brokkr', 'sindri'];

/** La décision, sans git : `publie` = ce que porte le tag du numéro, ou `null`.
 *  Un SHA inconnu d'un côté (tag ancien, dossier absent) ne compte pas comme un
 *  changement : on ne refuse que ce qu'on sait avoir changé. */
export function decider({ numero, publie, eitri, brokkr, sindri }) {
  if (!publie) return { ok: true, nouveau: true };
  const courant = { eitri, brokkr, sindri };
  const changes = ['eitri', ...SERVEURS].filter(
    (nom) => publie[nom] && courant[nom] && publie[nom] !== courant[nom],
  );
  if (changes.length === 0) return { ok: true, nouveau: false };
  const change = changes.map((nom) => `${nom} (${publie[nom]} → ${courant[nom]})`).join(' et ');
  return {
    ok: false,
    message: `v${numero} est déjà publiée, et ${change} a changé depuis : monte le numéro dans web/package.json.`,
  };
}

function git(commande) {
  return execSync(commande, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/** Le dernier commit qui touche `dossier` (relatif à web/), ou `null`. */
function shaDu(dossier) {
  try { return git(`git log -1 --format=%h -- ${dossier}`) || null; } catch { return null; }
}

function tagPublie(numero) {
  try {
    const commit = git(`git rev-parse --short "v${numero}^{commit}"`);
    const note = git(`git tag -l --format='%(contents)' "v${numero}"`);
    const lu = (nom) => new RegExp(`${nom}=(\\w+)`).exec(note)?.[1] ?? null;
    return { eitri: lu('eitri') ?? commit, brokkr: lu('brokkr'), sindri: lu('sindri') };
  } catch {
    return null;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const numero = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const eitri = shaDu('.');
  const brokkr = process.env.BROKKR_SHA || shaDu('../api-python');
  const sindri = process.env.SINDRI_SHA || shaDu('../api');
  const decision = decider({ numero, publie: tagPublie(numero), eitri, brokkr, sindri });
  if (process.argv[2] === 'poser') {
    if (decision.ok && decision.nouveau) {
      const livre = `eitri=${eitri ?? 'inconnu'} brokkr=${brokkr ?? 'inconnu'} sindri=${sindri ?? 'inconnu'}`;
      git(`git tag -a "v${numero}" -m "Hodos v${numero}" -m "${livre}"`);
      console.log(`[numéro] v${numero} posé (${livre})`);
    }
  } else if (!decision.ok) {
    console.error(`✗ ${decision.message}`);
    process.exit(1);
  } else {
    console.log(`[numéro] v${numero} — ${decision.nouveau ? 'nouveau numéro' : 'même contenu, republication'}`);
  }
}
