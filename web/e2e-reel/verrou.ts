import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** UN SEUL HARNAIS RÉEL À LA FOIS.
 *
 *  ⚠️ DEUX CAMPAGNES SUR LE MÊME BAC À SABLE SE MENTENT L'UNE À L'AUTRE. Toutes
 *  les specs écrivent dans `e2e-program` et le vident après elles : le
 *  `nettoyer` de l'une efface les blocs de l'autre en plein milieu — un 404
 *  sur un rejeu ici, une séance disparue là. Vu le 26/09 : un `make livrer` et
 *  une spec jouée à la main en même temps, une dizaine de rouges dans chaque
 *  camp, aucun défaut dans le code.
 *
 *  Le verrou porte le pid : un verrou dont le processus est mort ne bloque
 *  personne — un `Ctrl-C` ne doit pas condamner la campagne suivante. */
const VERROU = join(process.env.TMPDIR ?? tmpdir(), 'e2e-reel', 'verrou');

function vivant(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export default function poserLeVerrou(): void {
  mkdirSync(join(VERROU, '..'), { recursive: true });
  if (existsSync(VERROU)) {
    const pid = Number(readFileSync(VERROU, 'utf8'));
    if (pid && pid !== process.pid && vivant(pid)) {
      throw new Error(`⛔ un harnais réel tourne déjà (pid ${pid}) : les deux se videraient l'un l'autre. Attendre qu'il finisse.`);
    }
  }
  writeFileSync(VERROU, String(process.pid));
  resemer();
}

/** ⚠️ LE TERRAIN DE JEU SE RESÈME À CHAQUE CAMPAGNE, pas seulement quand le
 *  script monte la stack. Une spec laisse un état derrière elle — le compte
 *  `e2e-identite` relié, par exemple — et la campagne suivante, lancée à la
 *  main avec `npx playwright`, rougissait dessus (26/09, deux fois). Le seed
 *  est idempotent et prend moins d'une seconde. */
function resemer(): void {
  // Le fichier est lancé par Playwright depuis `eitri/` : la racine forge est un cran au-dessus.
  const seed = join(process.cwd(), '..', 'seeds', 'e2e.sql');
  execFileSync('docker', ['exec', '-i', 'ff-training', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'ff'],
               { input: readFileSync(seed), stdio: ['pipe', 'ignore', 'inherit'] });
}

export function leverLeVerrou(): void {
  try {
    if (Number(readFileSync(VERROU, 'utf8')) === process.pid) rmSync(VERROU);
  } catch { /* déjà levé */ }
}
