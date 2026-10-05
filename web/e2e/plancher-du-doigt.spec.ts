import { devices, expect, test } from '@playwright/test';

/** LE PLANCHER DU DOIGT — 44 px de haut sur un écran tactile.
 *
 *  ⚠️ POURQUOI CETTE SPEC EXISTE. Rien n'avait été dimensionné pour une main :
 *  mesuré le 10/09, 216 cibles sur 242 passaient sous 44 px, les pires à 12 × 12.
 *  C'est l'écran de l'athlète à la salle, entre deux séries, les mains moites.
 *  Le plancher vit dans une règle CSS (`index.css`, `@media (pointer: coarse)`),
 *  et une règle sans garde se fait contourner au premier composant qui déclare
 *  sa propre hauteur.
 *
 *  ⚠️ ET C'EST LA HAUTEUR QU'ON GARDE, PAS LA LARGEUR. Trente cibles restent
 *  étroites — en-têtes du tableau RM, numéros de semaine, pastilles de période.
 *  Les élargir casserait des rangées qui doivent tenir sur une ligne, et dans
 *  une rangée c'est la hauteur que le pouce cherche. La spec le dit au lieu de
 *  le taire : elle mesure la HAUTEUR, et compte les étroites sans les refuser.
 *
 *  ⚠️ `pointer: coarse` NE VIENT PAS DE LA TAILLE DE FENÊTRE. Réduire un
 *  navigateur de bureau ne déclenche pas la règle ; il faut un profil tactile,
 *  d'où le `test.use` ci-dessous. Une spec qui se contenterait de rétrécir la
 *  fenêtre serait verte sans rien prouver.
 */

test.use({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 } });

const ROUTES = ['/guichet', '/dashboard', '/training', '/tracker', '/calendar',
                '/competitions', '/library', '/signalements', '/bilan-modeles',
                // ⚠️ LA FIGURE DU CORPS EST MESURÉE AILLEURS, ET PLUS SÉVÈREMENT
                // (`douleurs.spec.ts`) : ses muscles sont des `<g>` dont la
                // hauteur est celle du tracé, et ils ne peuvent pas tenir 44 px
                // à l'échelle 1 — 61 sur 87 passent dessous. Le zoom est leur
                // réponse, et la spec dédiée l'oblige à en être une (×4 : quatre
                // restent). La route reste ici pour le RESTE de l'écran : les
                // cartes, les onze boutons d'intensité, le formulaire.
                '/kine?vue=douleurs'];

for (const route of ROUTES) {
  test(`sur ${route}, aucune cible tactile ne descend sous 44 px de haut`, async ({ page }) => {
    await page.goto(route);
    // L'intro couvre l'écran au premier chargement : on attend qu'elle parte,
    // sinon on mesure des cibles cachées (et `offsetParent` les écarterait
    // toutes, ce qui rendrait la spec verte pour rien).
    await expect(page.locator('#open, #boot')).toHaveCount(0, { timeout: 15_000 });

    const trop = await page.evaluate(() => {
      const cibles = [...document.querySelectorAll('button, a[href], select, [role="button"]')]
        // ⚠️ `offsetParent` N'EXISTE PAS SUR UN ÉLÉMENT SVG : `undefined !== null`
        // est vrai, donc les muscles de la figure passaient ce filtre sans
        // qu'on l'ait voulu. On les écarte par ce qu'ils SONT, pas par leur nom.
        .filter(e => !e.closest('svg'))
        .filter(e => (e as HTMLElement).offsetParent !== null);
      return {
        total: cibles.length,
        basses: cibles
          .map(e => ({ r: e.getBoundingClientRect(),
                       quoi: (e.getAttribute('title') || e.getAttribute('aria-label')
                              || e.textContent || '').trim().slice(0, 30) }))
          .filter(x => x.r.width > 0 && x.r.height < 44)
          .map(x => `${Math.round(x.r.width)}×${Math.round(x.r.height)} « ${x.quoi} »`),
      };
    });

    // Le compte total sert de garde-fou À LA GARDE : une page vide passerait
    // sinon sans rien mesurer.
    expect(trop.total, 'la page doit porter des cibles à mesurer').toBeGreaterThan(3);
    expect(trop.basses, trop.basses.join(' · ')).toEqual([]);
  });
}
