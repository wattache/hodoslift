import { expect, test, type Page } from '@playwright/test';

/** DROPSET : un groupe dont la nature change les règles (FRE-36).
 *
 *  Le socle vient de FRE-31 — le lien entre lignes, le bloc d'affichage, la case
 *  unique séries/repos. Il manquait ce que le bi-set n'avait pas besoin d'avoir :
 *  une NATURE. Les données ne montraient qu'une intention (42 groupes, tous des
 *  enchaînements) ; le dropset en introduit une seconde, avec des règles
 *  OPPOSÉES — pas de repos entre les descentes.
 *
 *  ⚠️ ET ELLE EXISTE DÉJÀ EN PRODUCTION, MAL. Deux athlètes portent des dropsets
 *  prescrits en détournant le bi-set : BACK EXTENSION 3×30 → 3×8 chez l'un,
 *  3×20 → 3×10 chez l'autre, charge identique sur les deux lignes. La fixture
 *  reprend le premier — ce n'est pas un décor inventé pour la démonstration.
 *
 *  ⚠️ CE QUE CES SPECS GARDENT, ET QUE LES UNITAIRES NE PEUVENT PAS : les 31
 *  specs de `groupe.test.ts` éprouvent la RÈGLE (quel libellé, le repos se
 *  saisit-il) sans monter d'écran. Elles resteraient vertes si la vue ne lisait
 *  jamais la nature. Ici on vérifie que l'écran l'utilise vraiment.
 *
 *  Fixture : bloc « Intensification », deux BACK EXTENSION liées par
 *  `dropset-s1-1-2`. Délibérément dans un AUTRE bloc que le bi-set — posées dans
 *  la même semaine, elles changeaient les comptes sur lesquels les specs du
 *  bi-set s'appuient. */

const ouvrirLeDropset = async (page: Page) => {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Intensification' }).click();
  // ⚠️ LA SÉANCE EST DÉPLIÉE D'OFFICE (refonte des écrans, 09/2026). Elle s'ouvrait par un clic sur
  // son en-tête ; le repli a disparu avec la cascade — une seule séance est à
  // l'écran, et la replier ne laissait qu'un en-tête au-dessus du vide. Le clic
  // n'a plus de cible : l'en-tête est redevenu un simple titre.
};

const passerEnCoach = async (page: Page) => {
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
};

/** ⚠️ LA SÉANCE DU DROPSET, ET ELLE SEULE : le coach voit toute la semaine depuis
 *  FRE-180, et la semaine porte aussi la séance d'endurance (FRE-116). */
const seanceDuDropset = (page: Page) => page.locator('[data-seance-id="s1"]');

test('un dropset s’annonce comme tel, pas comme un bi-set', async ({ page }) => {
  await ouvrirLeDropset(page);

  // ⚠️ « BI-SET » DIRAIT DEUX EXERCICES ENCHAÎNÉS. Ce sont deux DESCENTES du même
  // exercice, et c'est toute la différence : l'athlète qui lit « BI-SET » cherche
  // un second mouvement qui n'existe pas.
  await expect(page.getByText('DROPSET').first()).toBeVisible();
  await expect(page.getByText('BI-SET')).toHaveCount(0);
});

test('un dropset n’annonce AUCUN repos', async ({ page }) => {
  await ouvrirLeDropset(page);

  // ⚠️ PAS DE REPOS ENTRE LES DESCENTES : c'est la définition d'un dropset, pas
  // un réglage à zéro. L'en-tête d'un bi-set annonce « N séries · repos 2' » ;
  // celui-ci doit s'arrêter aux séries.
  const entete = page.getByText('DROPSET').first().locator('..');
  await expect(entete).toContainText('séries');
  await expect(entete).not.toContainText('repos');
});

test('le coach ne se voit PAS proposer de repos sur un dropset', async ({ page }) => {
  await ouvrirLeDropset(page);
  await passerEnCoach(page);

  // ⚠️ RÈGLE D'AFFORDANCE : le front ne propose une écriture que là où elle a un
  // sens. La séance porte trois lignes — MUSCLE UP, et les deux descentes — donc
  // UNE seule case de repos, celle du MUSCLE UP. Laisser les deux autres
  // ouvertes inviterait à y écrire une valeur que rien ne lira, et un coach a
  // déjà encodé « pas de pause » avec un repos à 0 faute de pouvoir le dire
  // autrement (FRE-31).
  expect(await casesDeReposEnDepliant(page)).toBe(1);
});

/** Le repos vit dans le dépli (brief coach, 27/09), une ligne à la fois : on
 *  déplie chaque ligne du dropset et on compte ce qu'elle offre. */
async function casesDeReposEnDepliant(page: Page): Promise<number> {
  let n = 0;
  for (const rangee of await seanceDuDropset(page).locator('[data-ligne]').all()) {
    n += await rangee.getByLabel('Repos').count();
  }
  return n;
}

async function titresDeDropsetEnDepliant(page: Page): Promise<number> {
  let n = 0;
  for (const rangee of await seanceDuDropset(page).locator('[data-ligne]').all()) {
    n += await rangee.getByTitle("Un dropset s'enchaîne sans repos entre les descentes").count();
  }
  return n;
}

test('le coach bascule le groupe entre enchaînement et dropset', async ({ page }) => {
  await ouvrirLeDropset(page);
  await passerEnCoach(page);

  // ⚠️ UNE BASCULE PLUTÔT QUE DEUX BOUTONS DE CRÉATION : c'est en écrivant les
  // lignes qu'on voit si c'est un enchaînement ou une descente, pas avant. Le
  // choix reste donc réversible — on reclique, on ne délie pas pour relier
  // autrement.
  // ⚠️ UNE LISTE DEPUIS FRE-116 : six natures ne se basculent plus d'un clic.
  const nature = seanceDuDropset(page).getByRole('combobox', { name: 'Nature du groupe' });
  await expect(nature).toHaveValue('dropset');
  await nature.selectOption('biset');

  // Redevenu un enchaînement : le libellé suit, et le repos redevient saisissable
  // sur le groupe — la nature commande les DEUX, sinon l'écran se contredit.
  await expect(nature).toHaveValue('biset');
  expect(await casesDeReposEnDepliant(page)).toBe(2);
});

test('la bascule vaut pour TOUT le groupe, pas pour la ligne cliquée', async ({ page }) => {
  await ouvrirLeDropset(page);
  await passerEnCoach(page);

  // ⚠️ UN GROUPE MI-BI-SET MI-DROPSET N'A AUCUNE LECTURE POSSIBLE : l'en-tête
  // afficherait l'une, les champs proposeraient l'autre.
  //
  // ⚠️ ET IL FAUT OBSERVER UN MEMBRE **SUIVANT**, pas l'en-tête. Écrite sur le
  // libellé, cette spec restait VERTE en retirant la propagation : l'en-tête se
  // lit sur la PREMIÈRE ligne, celle qu'on vient justement de cliquer. Elle
  // aurait gardé une règle qu'elle ne touchait pas.
  //
  // La case de repos de la seconde descente, elle, ne ment pas : tant qu'elle se
  // croit dans un dropset, elle affiche « — » avec ce titre-là.
  expect(await titresDeDropsetEnDepliant(page)).toBe(2);

  const nature = seanceDuDropset(page).getByRole('combobox', { name: 'Nature du groupe' });
  await nature.selectOption('biset');

  expect(await titresDeDropsetEnDepliant(page)).toBe(0);
  await expect(nature).toHaveValue('biset');
});

test('un dropset n’affiche son exercice QU’UNE FOIS', async ({ page }) => {
  await ouvrirLeDropset(page);

  // ⚠️ CE QUI DISTINGUE UN DROPSET D'UN BI-SET, autant que l'absence de repos :
  // « A puis B » contre « le MÊME mouvement, en descente ». Répété à chaque
  // ligne, il se lit comme plusieurs exercices — exactement ce qu'il n'est pas.
  //
  // Deux descentes, un seul « BACK EXTENSION » à l'écran.
  await expect(page.getByText('BACK EXTENSION')).toHaveCount(1);
});

test('renommer une descente renomme TOUT le dropset', async ({ page }) => {
  await ouvrirLeDropset(page);
  await passerEnCoach(page);

  // ⚠️ LE NOM APPARTIENT AU GROUPE, comme les séries. Écrit sur une seule
  // descente, le dropset porterait deux mouvements — ce qui n'existe pas.
  //
  // Et la case ne s'offre QU'UNE FOIS : la seconde descente montre « ↑ ». Il
  // reste donc deux champs « Exercice » dans la séance — celui du MUSCLE UP et
  // la tête du dropset — et non trois.
  const exercices = seanceDuDropset(page).getByRole('button', { name: 'Exercice', exact: true });
  await expect(exercices).toHaveCount(2);

  // Le champ est un combobox : on l'ouvre et on choisit, on ne le remplit pas.
  await exercices.last().click();
  await page.getByRole('button', { name: 'ROWING', exact: true }).click();

  // ⚠️ ET IL FAUT REBASCULER EN BI-SET POUR LE VÉRIFIER. Tant que le groupe est
  // un dropset, la seconde descente affiche « ↑ » : elle garderait BACK EXTENSION
  // sans que rien ne le montre, et cette spec restait VERTE en retirant la
  // propagation — mesuré, pas supposé. Le masquage cache le défaut qu'on cherche.
  //
  // Redevenu un enchaînement, chaque ligne réaffiche SON nom. C'est le seul
  // endroit de l'écran où la seconde ligne parle d'elle-même.
  await seanceDuDropset(page).getByRole('combobox', { name: 'Nature du groupe' }).selectOption('biset');

  await expect(page.getByText('BACK EXTENSION')).toHaveCount(0);
  await expect(seanceDuDropset(page).getByRole('button', { name: 'Exercice', exact: true })).toHaveCount(3);
});
