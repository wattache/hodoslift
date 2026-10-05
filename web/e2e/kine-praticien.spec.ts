import { expect, test } from '@playwright/test';
import { choisirAthlete } from './aides-athlete';

/** LE PARCOURS DU PRATICIEN EXISTE ENFIN DANS LE HARNAIS.
 *
 *  ⚠️ CE QUI ÉTAIT CASSÉ, ET POURQUOI PERSONNE NE POUVAIT LE VOIR. `useAthletesSuivis`
 *  portait `enabled: !isMock && …` : la requête était DÉSACTIVÉE en dev-mock, quoi
 *  que rende son `queryFn`. `suivisIds` restait donc vide en toutes circonstances,
 *  `kineDeCetAthlete` toujours faux, et `canMedical` se réduisait à `isSelf`.
 *
 *  Conséquence : **tout le rôle que le chantier kiné construit était le seul
 *  qu'aucun harnais ne traversait.** Le panneau des bilans ne s'y voyait que
 *  parce que l'utilisateur du mock EST Léa — par le chemin de l'athlète, pas
 *  celui du praticien. Et le catalogue de modèles n'apparaissait nulle part.
 *
 *  Repéré par William le 25/08 en cherchant à relire la maquette FRE-97/98 :
 *  « dev-mock n'est pas kiné, donc cette partie passe toujours à la trappe des
 *  tests. » Ces specs sont là pour que ça ne se reproduise pas en silence.
 *
 *  Les deux mondes coexistent maintenant dans la même session, comme chez un
 *  coach-kiné réel : **Léa** est l'athlète que l'utilisateur EST, **Théo** celui
 *  qu'il SUIT.
 */

test('le kiné atteint les bilans d’un athlète qu’il SUIT', async ({ page }) => {
  await page.goto('/dashboard');
  await choisirAthlete(page, /Théo Bernard/);
  await page.goto('/kine');

  // ⚠️ SUR THÉO, ET C'EST TOUT LE POINT. L'utilisateur n'est pas Théo : si le
  // panneau s'affiche, c'est nécessairement par `kineDeCetAthlete`. Le même
  // test sur Léa passerait par `isSelf` et ne prouverait rien du rôle kiné.
  await expect(page.getByText('Bilans', { exact: true })).toBeVisible();

  // ⚠️ ET IL LIT, IL N'ÉCRIT PAS. Le serveur n'accepte la déclaration d'une
  // douleur qu'en `owner` : proposer le bouton au praticien mènerait à un 403.
  // C'est la règle d'affordance du projet, et elle ne se voit que sur un
  // athlète qu'on n'EST pas — sur Léa, `isSelf` la court-circuiterait.
  await expect(page.getByRole('button', { name: /Signaler une douleur|Report a pain/ }))
    .toHaveCount(0);
});

test('le kiné a son catalogue de modèles dans la navigation', async ({ page }) => {
  /** ⚠️ COMPOSER EST UN ACTE DE PRATICIEN — le serveur le tient (`require_kine`)
   *  et la navigation ne doit le proposer qu'à lui. L'entrée n'existait pour
   *  personne en dev-mock, donc cette règle n'était vérifiée nulle part : ni
   *  qu'elle s'affiche au kiné, ni qu'elle se cache aux autres. */
  await page.goto('/dashboard');
  await expect(page.getByRole('link', { name: /Modèles de bilan|Assessment templates/ }))
    .toBeVisible();
});
