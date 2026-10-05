import { expect, test } from '@playwright/test';
import { arbre, BROKKR, modeCoach, nettoyer, poserUnMacro, seConnecter } from './aides';

/** LA TRAME DU COACH SURVIT AU RÉSEAU QUI TOMBE — le cas d'Aubin, 25/09.
 *
 *  Chez lui, en Wi-Fi, il compose le bloc 2 : « Enregistré ». Il veut générer
 *  la semaine 1 : « hors connexion ». Il passe en partage de connexion, revient
 *  sur la page : plus rien. La box était connectée, internet non — le
 *  navigateur n'a jamais dit `offline`, et l'app ne gardait que les frappes de
 *  l'athlète, pas la trame.
 *
 *  ⚠️ BROKKR EST COUPÉ PAR ROUTE, PAS PAR `setOffline`, et c'est le point : le
 *  navigateur continue de se croire en ligne, exactement comme le sien. Ce que
 *  l'app doit constater, elle le constate à la première requête qui ne part
 *  pas — pas à un événement qui n'arrive jamais.
 *
 *  ⚠️ ET LE SERVEUR EST INTERROGÉ DEPUIS NODE, pas depuis la page : on voit
 *  l'état réel de la base pendant que l'app croit être seule au monde — y
 *  compris pour affirmer que rien n'est arrivé AVANT le retour du réseau. */
test.afterEach(nettoyer);

const accessoiresEnBase = async () =>
  (await arbre()).macros[0]?.blocks[0]?.base?.accessories?.map(a => a.name) ?? [];

test('la trame composée sans réseau est gardée, survit au rechargement, et arrive au retour du réseau', async ({ page }) => {
  // Trois traversées de l'écran et un rechargement sans réseau : plus long qu'une spec ordinaire.
  test.setTimeout(90_000);
  await poserUnMacro();                      // un bloc, SANS base

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();
  await expect(page.getByRole('button', { name: 'Accessoire' })).toBeVisible({ timeout: 15_000 });

  // Internet tombe, la box reste : aucune requête n'atteint plus brokkr.
  await page.route(`${BROKKR}/**`, route => route.abort('failed'));

  await page.getByRole('button', { name: 'Accessoire' }).click();
  // Le brouillon d'abord (30/09) : on choisit, PUIS on valide — c'est la validation qui écrit.
  const brouillon = page.locator('[data-accessoire-brouillon]');
  const mouvement = brouillon.getByLabel('Mouvement');
  const choisi = await mouvement.locator('option').nth(1).getAttribute('value');
  await mouvement.selectOption({ index: 1 });
  await brouillon.getByRole('button', { name: /^Ajouter à/ }).click();

  // ⚠️ D'ABORD : RIEN N'EST PARTI, ET LA VIGNETTE LE DIT. C'est ce qu'Aubin
  // n'a pas eu — elle affichait « Enregistré » sur une trame partie dans le
  // vide. Sans cette moitié, la spec passerait aussi avec l'ancienne app.
  await expect(page.getByText(/Gardé/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Enregistré', { exact: true })).toHaveCount(0);
  expect(await accessoiresEnBase()).toEqual([]);

  // Et la génération, qui se calcule côté serveur, ne s'offre pas : la raison
  // se lit, elle ne se devine pas au survol.
  await expect(page.getByRole('button', { name: /Générer la semaine 1/ })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'Disponible au retour du réseau' })).toBeVisible();

  // Il revient sur la page — brokkr toujours injoignable. Le coach ne voit
  // pas son athlète sans réseau (le cache de lecture ne garde qu'UNE fiche, la
  // sienne — une borne voulue, FRE-118) : ce qui compte, c'est que la trame
  // soit sur le DISQUE, hors de tout écran, et reparte d'elle-même.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Déconnexion' })).toBeVisible({ timeout: 20_000 });
  expect(await accessoiresEnBase()).toEqual([]);

  // Le réseau revient : c'est le navigateur qui émet `online`, pas nous.
  await page.unroute(`${BROKKR}/**`);
  await page.context().setOffline(true);
  await page.context().setOffline(false);

  await expect.poll(accessoiresEnBase, { timeout: 20_000 }).toEqual([choisi]);

  // Et il la retrouve à l'écran, servie par le serveur cette fois.
  //
  // ⚠️ LE CACHE DE LECTURE EST VIDÉ D'ABORD. Il porte le bloc tel qu'il était
  // AVANT le rejeu, et son marquage « périmé » n'atteint le disque qu'une
  // seconde plus tard (persister étranglé) : ouvrir avant, c'est ouvrir sur
  // l'ancienne trame — une course, pas un défaut, et `make livrer` l'a perdue
  // sous charge. Ce que cette fin vérifie, c'est ce que le SERVEUR sert.
  await page.evaluate(() => new Promise<void>(resoudre => {
    const ouverture = indexedDB.open('keyval-store');
    ouverture.onsuccess = () => {
      const tx = ouverture.result.transaction('keyval', 'readwrite');
      tx.objectStore('keyval').delete('eitri-cache-hors-ligne');
      tx.oncomplete = () => resoudre();
    };
    ouverture.onerror = () => resoudre();
  }));
  await page.goto('/training');
  await modeCoach(page);
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();
  await expect(page.getByLabel('Mouvement')).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByLabel('Mouvement').last()).toHaveValue(choisi!);
});

/** ⚠️ UN REFUS SE LIT AUSSI SUR LA VIGNETTE, pas seulement dans un toast qui
 *  passe. « Enregistré » après un 500 est le mensonge qu'Aubin a lu. */
test('une trame REFUSÉE par le serveur laisse la vignette sur « Non enregistré »', async ({ page }) => {
  await poserUnMacro();

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();
  await expect(page.getByRole('button', { name: 'Accessoire' })).toBeVisible({ timeout: 15_000 });

  await page.route(`${BROKKR}/programs/*/blocks/*/base`, route => route.fulfill({
    status: 500, contentType: 'application/json',
    body: JSON.stringify({ detail: 'panne fabriquée', code: 'erreur_interne', status: 500 }),
  }));

  await page.getByRole('button', { name: 'Accessoire' }).click();
  await page.locator('[data-accessoire-brouillon]').getByLabel('Mouvement').selectOption({ index: 1 });
  await page.locator('[data-accessoire-brouillon]').getByRole('button', { name: /^Ajouter à/ }).click();

  await expect(page.getByText(/Non enregistré/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Enregistré', { exact: true })).toHaveCount(0);
  // Refusée n'est pas gardée : le disque ne porte rien, et rien ne repartira.
  await expect(page.getByText(/Gardé/)).toHaveCount(0);
});

/** ⚠️ LES AUTRES GESTES DU COACH AUSSI — renommer, supprimer, réordonner. Ils
 *  partaient en direct, comme la trame : sans réseau, un toast et le geste
 *  perdu. Ils entrent dans la même file, à leur place dans l'ordre. */
test('renommer un bloc et supprimer une séance sans réseau : gardés, puis écrits au retour', async ({ page }) => {
  await poserUnMacro([{ name: 'SQUAT', sets: '5', reps: '3' }],
                     { sessions: [{ name: 'Lundi', exercises: [{ name: 'SQUAT' }] }, { name: 'Mardi', exercises: [{ name: 'DIPS' }] }] });

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  await expect(page.getByText(/^Lundi/).first()).toBeVisible({ timeout: 15_000 });

  await page.route(`${BROKKR}/**`, route => route.abort('failed'));

  await page.getByRole('button', { name: /Gérer|Manage/ }).click();
  await page.getByTitle('Renommer le bloc').click();
  await page.getByPlaceholder('Bloc 1').fill('Force');
  await page.keyboard.press('Enter');
  await page.getByTitle('Supprimer la séance').last().click();
  await page.getByRole('button', { name: 'Supprimer', exact: true }).click();

  // Rien n'est parti, et l'écran suit déjà les gestes.
  await expect(page.getByText(/Gardé/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/^Mardi/)).toHaveCount(0);
  const avant = (await arbre()).macros[0].blocks[0];
  expect(avant.name ?? '').not.toBe('Force');
  expect(avant.weeks[0].sessions).toHaveLength(2);

  await page.unroute(`${BROKKR}/**`);
  await page.context().setOffline(true);
  await page.context().setOffline(false);

  await expect.poll(async () => {
    const bloc = (await arbre()).macros[0].blocks[0];
    return [bloc.name, bloc.weeks[0].sessions?.map(s => s.name)];
  }, { timeout: 20_000 }).toEqual(['Force', ['Lundi']]);
  await expect(page.getByText('Enregistré', { exact: true })).toBeVisible({ timeout: 10_000 });
});

/** ⚠️ ET LES CRÉATIONS — le dernier trou, et le plus profond. Un `POST` rejoué
 *  sans identité fabriquait un second objet : c'est le front qui choisit
 *  l'identité, et brokkr retrouve l'objet du premier envoi (`identifiant_pris`
 *  sinon). Ici, ce qu'Aubin aurait voulu faire dans le train : ajouter une
 *  séance, une ligne, la nommer — et retrouver tout ça en base au retour. */
test('une séance et sa ligne créées sans réseau arrivent en base au retour, nommées', async ({ page }) => {
  await poserUnMacro([{ name: 'SQUAT', sets: '5', reps: '3' }]);

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  await expect(page.getByText(/^Lundi/).first()).toBeVisible({ timeout: 15_000 });

  await page.route(`${BROKKR}/**`, route => route.abort('failed'));

  await page.getByRole('button', { name: /^Séance$/ }).click();
  // La séance neuve prend la main ; on lui ajoute une ligne et on la nomme.
  await page.getByRole('button', { name: /Ajouter un exercice|Add an exercise/ }).last().click();
  // Le champ est un combobox : on l'ouvre, on cherche, on valide.
  await page.getByRole('button', { name: 'Exercice', exact: true }).last().click();
  await page.getByPlaceholder('Rechercher…').fill('DIPS');
  await page.getByPlaceholder('Rechercher…').press('Enter');

  await expect(page.getByText(/Gardé/)).toBeVisible({ timeout: 10_000 });
  expect((await arbre()).macros[0].blocks[0].weeks[0].sessions).toHaveLength(1);

  await page.unroute(`${BROKKR}/**`);
  await page.context().setOffline(true);
  await page.context().setOffline(false);

  await expect.poll(async () => {
    const seances = (await arbre()).macros[0].blocks[0].weeks[0].sessions ?? [];
    return seances.map(s => s.exercises.map(e => e.name));
  }, { timeout: 20_000 }).toEqual([['SQUAT'], ['DIPS']]);
  await expect(page.getByText('Enregistré', { exact: true })).toBeVisible({ timeout: 10_000 });
});
