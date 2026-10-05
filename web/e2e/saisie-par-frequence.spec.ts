import { expect, test, type Page } from '@playwright/test';

/** LE PLI DE SAISIE SUIT LA FRÉQUENCE (maquette 2b, 13/09).
 *
 *  Mesuré : 10 095 lignes portent un RPE contre 54 un tableau de répétitions, et
 *  six valeurs de RPE couvrent 81 % des saisies. Le pli servait pourtant les trois
 *  champs chiffrés d'abord, le RPE ensuite, le feedback au même poids que tout le
 *  reste. Ce que ces specs gardent :
 *
 *    1. le RPE PRÉCÈDE le réel dans le pli ;
 *    2. le feedback est un BOUTON tant qu'il est vide ;
 *    3. le RPE est un MENU qui porte toute l'échelle, et « — » l'efface ;
 *    4. un champ vide ne se lit pas comme rempli : placeholder gris à opacité
 *       PLEINE, graisse normale — la valeur saisie est or et grasse ;
 *    5. la progression du bloc est une colonne par semaine, comme dans la BASE —
 *       courbe, volume et RPE alignés sur la même semaine ;
 *    6. le pli déplié tient dans l'écran du téléphone.
 */

/** Déplie le premier exercice de la séance du jour (fixture : MUSCLE UP, 9 kg). */
async function ouvrirLePremierExercice(page: Page) {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Détail' }).click();
  await page.getByTitle(/Voir notes|Ajouter une note/).first().click();
}

test('le RPE vient AVANT ce qu’on a fait', async ({ page }) => {
  await ouvrirLePremierExercice(page);
  const etape1 = await page.getByText('1 · Comment c’était'.replace('’', "'")).boundingBox();
  const reps = await page.getByRole('textbox', { name: 'Rép. réelles' }).boundingBox();
  expect(etape1 && reps).toBeTruthy();
  // Empilé ou côte à côte, la réglette du RPE est au-dessus des chiffres.
  expect(etape1!.y).toBeLessThan(reps!.y);
});

test('le feedback est un bouton tant qu’il est vide, et s’ouvre à la demande', async ({ page }) => {
  /** Un champ vide de 56 px présenté comme les trois chiffres cessait d'être
   *  facultatif. MUTATION QUI ROUGIT : rendre `NoteArea` sans condition. */
  await ouvrirLePremierExercice(page);
  const champ = page.getByPlaceholder('Comment ça s’est passé ?'.replace('’', "'"));
  await expect(champ).toHaveCount(0);
  await page.getByRole('button', { name: 'Ajouter un mot' }).click();
  await expect(champ).toBeVisible();
});

test('le RPE est un menu déroulant : toute l’échelle, et « — » l’efface', async ({ page }) => {
  /** Treize pastilles sur deux rangées prenaient le pli entier au téléphone ;
   *  William, 15/09 : « que les RPE ça soit à nouveau un menu déroulant, ça fera
   *  moins de choses à l'écran ». Le menu garde Sub5 et FAIL — des catégories que
   *  l'athlète utilise — et le vide, pour effacer.
   *  MUTATION QUI ROUGIT : le menu sans Sub5, FAIL ni vide (vue rouge le 15/09). */
  await ouvrirLePremierExercice(page);
  const menu = page.getByRole('combobox', { name: 'RPE réel' });

  await menu.selectOption('FAIL');
  await expect(menu).toHaveValue('FAIL');
  await menu.selectOption('6.5');
  await expect(menu).toHaveValue('6.5');
  await menu.selectOption('');
  await expect(menu).toHaveValue('');
  await expect(page.getByRole('button', { name: '6.5', exact: true })).toHaveCount(0);
});

test.describe('à 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('un pli déplié tient dans l’écran, progression comprise', async ({ page }) => {
    /** William, 14-15/09 : « il faut vraiment qu'on voie un pli déplié sur l'écran
     *  du téléphone sans scroll », et « la progression doit être visible ». À
     *  390 × 844, il reste 723 px entre l'en-tête et la barre basse.
     *
     *  La progression est une colonne par semaine (15/09) : sa hauteur ne dépend
     *  plus de la longueur du bloc — `exercise-progression.test.tsx` le garde —,
     *  donc le bloc de deux semaines du dev-mock vaut pour un bloc de six.
     *
     *  MUTATION QUI ROUGIT : une bande de courbe de 300 px au lieu de 118 (la
     *  progression redevenue aussi haute que les deux bandes d'avant 6a). */
    await page.goto('/training');
    await page.getByRole('button', { name: 'Accumulation', exact: true }).click();
    await page.getByRole('button', { name: /Semaine 2/ }).click();
    await page.getByTitle(/Voir notes|Ajouter une note/).first().click();
    await expect(page.locator('[data-valeur-charge]').first()).toBeVisible();

    const m = await page.evaluate(() => {
      const nom = [...document.querySelectorAll('span')].find(s => s.textContent === 'MUSCLE UP')!;
      const carte = nom.closest('.rounded-lg')!.getBoundingClientRect();
      const entete = document.querySelector('header')!.getBoundingClientRect().height;
      const barre = [...document.querySelectorAll('nav')]
        .find(n => getComputedStyle(n).position === 'fixed')!.getBoundingClientRect().height;
      return { pli: carte.height, place: window.innerHeight - entete - barre };
    });
    expect(m.pli, `pli déplié : ${Math.round(m.pli)} px pour ${Math.round(m.place)}`)
      .toBeLessThanOrEqual(m.place);
  });

  test('la courbe de progression est plus basse au téléphone que sur grand écran', async ({ page }) => {
    /** William, 15/09, sur une capture de production : « le graphe prend
     *  toujours pas mal de place ». La pente se lit sur une bande basse ; ce sont
     *  les chiffres qui portent la valeur.
     *  MUTATION QUI ROUGIT : la géométrie du téléphone à la hauteur de l'écran
     *  large (`bande: 118`). */
    const hauteur = async () => {
      await page.goto('/training');
      await page.getByRole('button', { name: 'Accumulation', exact: true }).click();
      await page.getByRole('button', { name: /Semaine 2/ }).click();
      await page.getByTitle(/Voir notes|Ajouter une note/).first().click();
      return (await page.locator('[data-courbe]').first().boundingBox())!.height;
    };
    const telephone = await hauteur();
    await page.setViewportSize({ width: 1280, height: 900 });
    const ecran = await hauteur();
    expect(telephone, `téléphone ${telephone} px, écran ${ecran} px`).toBeLessThan(ecran);
  });

  test('toucher la tuile, n’importe où, pose le curseur dans son champ', async ({ page }) => {
    /** Le champ a perdu sa hauteur de 44 px pour que le pli tienne : c'est la
     *  tuile entière qui est la cible du doigt.
     *  MUTATION QUI ROUGIT : la tuile en `<div>` au lieu de `<label>`. */
    await ouvrirLePremierExercice(page);
    const champ = page.getByRole('textbox', { name: 'Charge réelle' });
    await page.getByText('Charge (kg)', { exact: true }).click();
    await expect(champ).toBeFocused();
  });

  test('un champ vide ne se lit pas comme rempli : gris plein et maigre, contre or et gras', async ({ page }) => {
    /** La règle du 13/09 tenait déjà — gris et maigre pour ce qui reste à
     *  remplir —, mais à `/45` le gris tombait vers 2:1 : invisible en salle.
     *  On compare au gris du jeton, lu sur une sonde : une opacité réduite donne
     *  une autre couleur calculée.
     *  MUTATION QUI ROUGIT : remettre `placeholder:text-muted-foreground/45`. */
    await ouvrirLePremierExercice(page);
    const champ = page.getByRole('textbox', { name: 'Charge réelle' });
    const styles = await champ.evaluate((el) => {
      const sonde = document.createElement('span');
      sonde.className = 'text-muted-foreground';
      document.body.appendChild(sonde);
      const gris = getComputedStyle(sonde).color;
      sonde.remove();
      const ph = getComputedStyle(el, '::placeholder');
      return { gris, couleurPh: ph.color, poidsPh: ph.fontWeight,
               couleur: getComputedStyle(el).color, poids: getComputedStyle(el).fontWeight };
    });
    expect(styles.couleurPh).toBe(styles.gris);
    expect(Number(styles.poidsPh)).toBeLessThan(Number(styles.poids));
    expect(styles.couleurPh).not.toBe(styles.couleur);
  });

  test('la progression est une colonne par semaine : charge, volume et RPE sous leur semaine', async ({ page }) => {
    /** Maquette 6a : la courbe et les rangées divisent la MÊME piste. Si le SVG
     *  occupait la largeur totale pendant que les rangées divisent ce qui reste
     *  après la gouttière des libellés, les points dériveraient (43 px sur S1).
     *  MUTATION QUI ROUGIT : la courbe sans sa gouttière (`GOUTTIERE` à 0 dans la
     *  grille de `CourbeDeCharge` seulement). */
    await page.goto('/training');
    await page.getByRole('button', { name: 'Accumulation', exact: true }).click();
    await page.getByRole('button', { name: /Semaine 2/ }).click();
    await page.getByTitle(/Voir notes|Ajouter une note/).first().click();

    // Le bloc a QUATRE semaines depuis le 16/09 (mock) ; seules S1 et S2 portent
    // des séances, donc une charge — S3 et S4 n'ont qu'un volume et un RPE vides.
    await expect(page.locator('[data-valeur-charge]')).toHaveCount(2);
    const centre = (els: Element[]) => els.map(el => { const b = el.getBoundingClientRect(); return b.left + b.width / 2; });
    const semaines = await page.locator('[data-semaine]').evaluateAll(centre);
    expect(semaines).toHaveLength(4);
    for (const [sel, n] of [['[data-valeur-charge]', 2], ['[data-valeur-volume]', 4], ['[data-valeur-rpe]', 4]] as const) {
      const x = await page.locator(sel).evaluateAll(centre);
      expect(x, sel).toHaveLength(n);
      for (const [k, v] of x.entries()) expect(Math.abs(v - semaines[k]), `${sel} S${k + 1}`).toBeLessThanOrEqual(1);
    }
  });
});
