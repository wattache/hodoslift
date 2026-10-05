import { expect, test } from '@playwright/test';
import { arbre, ATHLETE, BROKKR, nettoyer, poserUnMacro, seConnecter } from './aides';

/** LA SAISIE FAITE HORS LIGNE ARRIVE EN BASE — FRE-118, moitié ÉCRITURE.
 *
 *  ⚠️ C'EST LA SEULE PREUVE QUI VAILLE POUR CETTE PROMESSE. Les 34 specs
 *  unitaires de la file tournent avec des horloges simulées et un disque en
 *  mémoire : elles prouvent la logique, pas qu'une frappe traverse un vrai
 *  navigateur privé de réseau, un vrai IndexedDB, un vrai jeton Firebase, et
 *  atterrisse dans Postgres.
 *
 *  ⚠️ ET LE SERVEUR EST INTERROGÉ DEPUIS NODE, pas depuis la page. C'est ce qui
 *  rend l'assertion possible : le contexte du navigateur est hors ligne, le
 *  harnais ne l'est pas. On voit donc l'état réel de la base pendant que l'app
 *  croit être seule au monde — y compris pour affirmer que rien n'est arrivé
 *  AVANT le retour du réseau, ce qui est la moitié qu'on oublie de vérifier.
 */
test.afterEach(nettoyer);

/** Le réalisé de la première ligne, tel que la base le porte. */
async function realiseEnBase(): Promise<string | undefined> {
  const seance = (await arbre()).macros[0]?.blocks[0]?.weeks[0]?.sessions?.[0];
  return seance?.exercises?.[0]?.repsDone;
}

async function saisirLeRealise(page: import('@playwright/test').Page, valeur: string) {
  // ⚠️ LA SÉANCE EST DÉPLIÉE D'OFFICE (refonte des écrans, 09/2026). Elle s'ouvrait par un clic sur
  // son en-tête ; le repli a disparu avec la cascade — une seule séance est à
  // l'écran (le bandeau la choisit quand il y en a plusieurs), et la replier ne
  // laissait qu'un titre au-dessus du vide. Le nom n'est plus un bouton : on
  // attend qu'il soit là, on ne le clique plus.
  await expect(page.getByText(/^Lundi/).first()).toBeVisible({ timeout: 15_000 });
  await page.getByTitle('Ajouter une note').first().click();
  const reps = page.getByLabel('Rép. réelles').first();
  await reps.fill(valeur);
  await reps.blur();
}

test('saisir sans réseau, puis le retrouver en base au retour', async ({ page }) => {
  await poserUnMacro([{ name: 'SQUAT', sets: '5', reps: '3' }]);

  await seConnecter(page, ATHLETE);
  await page.goto('/training');
  await expect(page.getByText(/^Lundi/).first()).toBeVisible({ timeout: 15_000 });

  await page.context().setOffline(true);
  await saisirLeRealise(page, '4');

  // ⚠️ D'ABORD : RIEN N'EST PARTI, ET LA VIGNETTE LE DIT. Sans cette moitié, la
  // spec passerait aussi avec une app qui écrit normalement — elle ne prouverait
  // que le retour à la normale, pas la garde.
  await expect(page.getByText(/Gardé/)).toBeVisible({ timeout: 10_000 });
  expect(await realiseEnBase()).toBeFalsy();
  // Et la valeur reste à l'écran : l'athlète ne doit pas la retaper.
  await expect(page.getByLabel('Rép. réelles').first()).toHaveValue('4');

  await page.context().setOffline(false);

  await expect.poll(realiseEnBase, { timeout: 20_000 }).toBe('4');
  await expect(page.getByText(/Enregistré/)).toBeVisible({ timeout: 10_000 });
});

test('⚠️ elle survit même à un rechargement de l’app', async ({ page }) => {
  /** LE CAS QUI JUSTIFIE LE DISQUE. Sans persistance, la file vit en mémoire :
   *  fermer l'app — ou simplement recharger — emporte la séance. C'est le geste
   *  le plus banal du monde sur un téléphone, entre deux séries.
   *
   *  ⚠️ ON COUPE BROKKR PAR ROUTE, PAS LE CONTEXTE : le document doit continuer
   *  d'être servi pour que le rechargement ait lieu (en production, c'est le
   *  service worker qui le sert ; ici le serveur de dev en tient lieu). Du point
   *  de vue de l'app, le résultat est le même — la requête ne part pas. */
  await poserUnMacro([{ name: 'SQUAT', sets: '5', reps: '3' }]);

  await seConnecter(page, ATHLETE);
  await page.goto('/training');
  await expect(page.getByText(/^Lundi/).first()).toBeVisible({ timeout: 15_000 });

  await page.route(`${BROKKR}/**`, route => route.abort('failed'));
  await saisirLeRealise(page, '7');
  await expect(page.getByText(/Gardé/)).toBeVisible({ timeout: 10_000 });
  expect(await realiseEnBase()).toBeFalsy();

  await page.reload();
  // Elle est repartie du disque, et brokkr est toujours coupé : elle attend
  // encore, cette fois dans une page qui n'a jamais vu la frappe.
  expect(await realiseEnBase()).toBeFalsy();

  /** ⚠️ ET ELLE EST À L'ÉCRAN (FRE-120). C'est la moitié qui manquait : la
   *  donnée était bien gardée, mais l'écran affichait l'ANCIENNE valeur — celle
   *  de la dernière synchro. L'athlète voyait sa saisie disparaître, la retapait,
   *  et doutait de l'app au moment où elle est censée le rassurer.
   *
   *  Fermer l'app et la rouvrir entre deux séries est le geste le plus ordinaire
   *  du monde : ce n'était pas un cas limite. */
  await expect(page.getByText(/^Lundi/).first()).toBeVisible({ timeout: 20_000 });
  await page.getByTitle('Ajouter une note').first().click();
  await expect(page.getByLabel('Rép. réelles').first()).toHaveValue('7');

  await page.unroute(`${BROKKR}/**`);
  // Un vrai aller-retour hors ligne : c'est le navigateur qui émet `online`,
  // pas nous. Déclencher l'événement à la main prouverait notre écouteur, pas
  // le comportement.
  await page.context().setOffline(true);
  await page.context().setOffline(false);

  await expect.poll(realiseEnBase, { timeout: 20_000 }).toBe('7');
});
