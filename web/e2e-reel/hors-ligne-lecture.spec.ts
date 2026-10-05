import { expect, test } from '@playwright/test';
import { arbre, ATHLETE, BROKKR, jeton, nettoyer, poserUnMacro, PROGRAMME, seConnecter } from './aides';

/** LA SÉANCE SURVIT À LA FERMETURE DE L'APP — FRE-118, moitié LECTURE.
 *
 *  Une salle en sous-sol, un téléphone sans signal, entre deux séries : c'est le
 *  contexte d'usage normal. L'athlète ouvrait l'app, voyait sa coque servie par
 *  le service worker, et **aucune donnée** — le cache de TanStack Query vit en
 *  mémoire et disparaît au rechargement.
 *
 *  ⚠️ CE QUE CES DEUX SPECS PROUVENT, ET CE QU'ELLES NE PROUVENT PAS. Elles
 *  éprouvent le cache DE DONNÉES : qu'il atteint le disque, qu'il en revient, et
 *  qu'un bloc absent du disque le DIT au lieu de faire semblant. Elles ne
 *  prouvent pas que la coque est servie hors ligne : c'est le travail du service
 *  worker, qui ne s'enregistre qu'en build de production (`import.meta.env.PROD`)
 *  et que ce ticket ne touche pas. Ici le serveur de dev en tient lieu.
 *
 *  D'où la coupure par ROUTE plutôt que par `setOffline` dans la première : on
 *  coupe brokkr, pas le document. Couper tout empêcherait le rechargement
 *  lui-même, et la spec ne dirait plus rien du cache — seulement que Chromium
 *  sait échouer sans réseau.
 */
test.afterEach(nettoyer);

/** Un SECOND bloc, garni. ⚠️ Il lui faut ses propres semaines : un bloc neuf
 *  naît sans aucune (22/08), et il afficherait alors le vide « compose la BASE »
 *  quel que soit l'état du réseau — la spec passerait sans rien éprouver. */
async function poserUnSecondBloc(): Promise<void> {
  const macro = (await arbre()).macros[0];
  const r = await fetch(`${BROKKR}/programs/${PROGRAMME}/macros/${macro.id}/blocks`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await jeton()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      week: { sessions: [{ name: 'Mardi', exercises: [{ name: 'MUSCLE UP', sets: '4', reps: '5' }] }] },
    }),
  });
  if (!r.ok) throw new Error(`POST /blocks → ${r.status} ${await r.text()}`);
}

test('recharger sans brokkr : la séance est toujours là, lue du disque', async ({ page }) => {
  /** ⚠️ EN ATHLÈTE, ET PAS EN COACH — ce n'est pas un détail de décor. Le
   *  hors-ligne est promis à l'athlète en salle ; le coach programme au bureau,
   *  et le ticket le met explicitement hors périmètre. Le cache le sait : il ne
   *  garde l'annuaire que s'il ne porte QU'UNE fiche, c'est-à-dire l'athlète
   *  lui-même. Écrire cette spec en coach la ferait échouer — et ce serait la
   *  spec qui aurait tort. */
  await poserUnMacro([{ name: 'SQUAT', sets: '5', reps: '3', weight: '142' }]);

  await seConnecter(page, ATHLETE);
  await page.goto('/training');
  // ⚠️ LA SÉANCE EST DÉPLIÉE D'OFFICE (refonte des écrans, 09/2026). Elle s'ouvrait par un clic sur
  // son en-tête ; le repli a disparu avec la cascade — une seule séance est à
  // l'écran (le bandeau la choisit quand il y en a plusieurs), et la replier ne
  // laissait qu'un titre au-dessus du vide. Le nom n'est plus un bouton : on
  // attend qu'il soit là, on ne le clique plus.
  await expect(page.getByText(/^Lundi/).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('142')).toBeVisible({ timeout: 15_000 });

  // ⚠️ ON ATTEND QUE LE DISQUE AIT ÉTÉ ÉCRIT. Le persister est étranglé à une
  // seconde : recharger tout de suite éprouverait une course, pas une
  // fonctionnalité — et la spec serait instable pour une bonne raison.
  await expect.poll(
    () => page.evaluate(async () => {
      const bases = await indexedDB.databases();
      return bases.some(b => b.name === 'keyval-store');
    }),
    { timeout: 10_000 },
  ).toBe(true);
  await page.waitForTimeout(1500);

  // ⚠️ ET L'ÉCRAN LE DIT, AVANT QU'ON EN AIT BESOIN. C'est tout l'intérêt de
  // l'indicateur : la question « est-ce que ma séance est sur mon téléphone ? »
  // se pose en partant à la salle, pas une fois au sous-sol. Il lit le DISQUE,
  // donc ce qu'il annonce ici est ce que le rechargement va prouver deux lignes
  // plus bas.
  // Le nom accessible, pas le pictogramme : c'est ce qu'un lecteur d'écran
  // annonce, et la seule chose qu'on puisse asserter d'une icône.
  await expect(page.getByText('Sur ton téléphone')).toBeAttached({ timeout: 10_000 });

  // brokkr devient injoignable — le document, lui, reste servi (cf. l'en-tête).
  await page.route(`${BROKKR}/**`, route => route.abort('failed'));
  await page.reload();

  // ⚠️ L'ASSERTION QUI PORTE LE TICKET. Sans persistance, cet écran est vide :
  // le gate s'arrête sur « pas de connexion » faute de `/users/me`, puis il n'y
  // a ni athlète sélectionné, ni charpente, ni séance. Tout ce qui s'affiche
  // ici vient du disque.
  await expect(page.getByText(/^Lundi/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('142')).toBeVisible({ timeout: 15_000 });
});

test('un bloc jamais ouvert le DIT, au lieu de se faire passer pour vide', async ({ page }) => {
  /** ⚠️ LE VIDE LE PLUS TROMPEUR DES TROIS, et le seul qui puisse coûter des
   *  données. Hors ligne, un bloc dont le contenu n'est pas en cache ressemble
   *  trait pour trait à un bloc neuf : la charpente, elle, EST en cache, donc les
   *  semaines existent, l'une est sélectionnée, et l'écran rendait sa table de
   *  séance — vide, avec « + Séance » à côté. Il ne disait pas « je ne sais
   *  pas » : il montrait une semaine réelle comme si elle ne contenait rien.
   *
   *  `useQuery` ne produit AUCUNE erreur ici : hors ligne il MET EN PAUSE. Ni
   *  chargement, ni échec, juste une absence — la forme exacte du trou qui avait
   *  fait accuser le coach à tort le 21/08. */
  await poserUnMacro([{ name: 'SQUAT', sets: '5', reps: '3' }]);
  await poserUnSecondBloc();

  await seConnecter(page, ATHLETE);
  await page.goto('/training');
  // ⚠️ L'ÉCRAN OUVRE SUR LE DERNIER BLOC (aucune date ne départage), donc sur
  // le SECOND — et c'est le PREMIER qui reste inconnu du cache. C'est bien le
  // sens du découpage : seul le bloc regardé descend sur le disque.
  await expect(page.getByText(/^Mardi/).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('MUSCLE UP')).toBeVisible({ timeout: 15_000 });

  await page.context().setOffline(true);

  await page.getByRole('button', { name: /Bloc 1/ }).first().click();

  await expect(page.getByText(/hors ligne/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/n’a pas encore de semaine/)).toHaveCount(0);
});
