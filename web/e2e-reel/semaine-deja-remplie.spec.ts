import { expect, test } from '@playwright/test';
import { BROKKR, PROGRAMME, arbre, jeton, nettoyer, poserUnMacro } from './aides';

/** ON NE RÉGÉNÈRE PAS PAR-DESSUS LE TRAVAIL D'UN ATHLÈTE (FRE-84).
 *
 *  `PUT /weeks/{id}/content` supprimait les séances puis les réinsérait SANS les
 *  colonnes de réalisé — reps, charge, RPE ressenti, retour de l'athlète. La
 *  seule protection était une condition d'écran (`canGenerate` exige zéro
 *  séance) : la règle tenait au client, et un appel direct la contournait.
 *
 *  ⚠️ POURQUOI CONTRE LA VRAIE PILE. Le défaut vivait précisément dans l'écart
 *  entre ce que l'interface s'interdit et ce que le serveur accepte. Une spec
 *  qui passe par le front ne peut pas le voir — elle emprunte le chemin gardé.
 *  Ici on frappe la route comme le ferait un script : c'est le seul point de vue
 *  d'où le trou était visible.
 */

const AUTH = async () => ({ Authorization: `Bearer ${await jeton()}`, 'Content-Type': 'application/json' });

test.afterEach(nettoyer);

const premiereSemaine = async () => (await arbre()).macros[0].blocks[0].weeks[0].id!;

test('remplir une semaine qui porte déjà des séances est REFUSÉ', async () => {
  await poserUnMacro([{ name: 'SQUAT', sets: '5', reps: '3' }]);
  const semaine = await premiereSemaine();

  const r = await fetch(`${BROKKR}/programs/${PROGRAMME}/weeks/${semaine}/content`, {
    method: 'PUT',
    headers: await AUTH(),
    body: JSON.stringify({ sessions: [{ name: 'Générée', exercises: [] }] }),
  });

  expect(r.status).toBe(409);
  expect((await r.json()).code).toBe('semaine_deja_remplie');

  // ⚠️ ET RIEN N'A BOUGÉ. Un refus qui laisse la semaine à moitié vidée serait
  // pire que pas de refus : le SQUAT du décor doit être encore là.
  const seances = (await arbre()).macros[0].blocks[0].weeks[0].sessions ?? [];
  expect(seances).toHaveLength(1);
  expect(seances[0].exercises).toHaveLength(1);
});

test('une semaine VIDE se remplit — le chemin « + Semaine » reste ouvert', async () => {
  /** Le refus ne doit pas emporter l'usage qui reste : depuis le 22/08 un bloc
   *  neuf naît SANS semaine et la génération la CRÉE (`POST /blocks/{id}/weeks`),
   *  donc `PUT …/content` ne sert plus qu'à une semaine ajoutée à la main
   *  (« + Semaine », zéro séance) puis générée. C'est cet état-là qu'on pose ici
   *  — une semaine existante et vide. Sans cette moitié, la garde pourrait être
   *  bien trop large sans que rien ne le dise. */
  await poserUnMacro([], { sessions: [] });
  const semaine = await premiereSemaine();

  const r = await fetch(`${BROKKR}/programs/${PROGRAMME}/weeks/${semaine}/content`, {
    method: 'PUT',
    headers: await AUTH(),
    body: JSON.stringify({
      sessions: [{ name: 'Générée', exercises: [{ name: 'SQUAT', sets: '5', reps: '5' }] }],
    }),
  });

  expect(r.status, await r.text()).toBe(200);
  const seances = (await arbre()).macros[0].blocks[0].weeks[0].sessions ?? [];
  expect(seances.map(s => s.name)).toEqual(['Générée']);
});
