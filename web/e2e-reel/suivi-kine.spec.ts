import { expect, test } from '@playwright/test';
import { ATHLETE, COACH, KINE, colonne, jeton, seConnecter, BROKKR } from './aides';

/** LES DOULEURS SUIVIES, DE BOUT EN BOUT : l'athlète rapporte, son staff voit.
 *
 *  C'est LA spec qui manquerait sans qu'on s'en aperçoive. Le harnais mock ne
 *  persiste rien — ses écritures sont des no-op — donc « l'écran affiche un
 *  formulaire » et « ce qui y est saisi arrive chez le kiné » y sont
 *  indiscernables. Or c'est exactement la promesse de la fonctionnalité.
 *
 *  TROIS CHOSES SE JOUENT ICI, et aucune ne se voit ailleurs :
 *    1. la douleur traverse le contrat, deux tables neuves et leurs GRANT ;
 *    2. le KINÉ la lit, ce qui ne marche que depuis l'ouverture de ses droits
 *       (`owner_or_staff`) — avant, il n'aurait rien vu de ce qu'on lui destine ;
 *    3. le tableau des signalements la remonte, avec le bon athlète.
 *
 *  ⚠️ CE QUI A CHANGÉ (FRE-195) : le signalement ne passe plus par le bloc
 *  `kine` du journal quotidien. Il a une IDENTITÉ — une douleur qu'on renote —
 *  et c'est ce que la deuxième spec éprouve : DEUX notes, UNE ligne au tableau.
 *  L'ancien modèle ne savait pas le dire, chaque jour y était un signalement
 *  sans lien avec la veille.
 */

const AUJOURD_HUI = new Date().toISOString().slice(0, 10);
const HIER = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

const entete = async (compte: typeof COACH) => ({
  Authorization: `Bearer ${await jeton(compte)}`,
  'Content-Type': 'application/json',
});

const URL_DOULEURS = `${BROKKR}/athletes/e2e-athlete/douleurs`;

/** Les douleurs de l'athlète E2E, remises à zéro. Ces tables survivent aux
 *  macros (elles n'y sont pas rattachées), donc le `nettoyer` habituel ne les
 *  touche pas — sans ça, la spec passerait sur les restes du run précédent.
 *
 *  ⚠️ PAR LA COLONNE, PARCE QU'AUCUNE ROUTE NE SUPPRIME — et c'est voulu : une
 *  douleur se CLÔT, elle ne s'efface pas. Son historique est de la donnée de
 *  santé, et le produit n'offre nulle part de la perdre. Le ménage du bac à
 *  sable n'est pas une raison d'ouvrir ce geste en production. */
function effacerLesDouleurs() {
  colonne("DELETE FROM douleurs WHERE athlete_id = "
        + "(SELECT id FROM athletes WHERE legacy_id = 'e2e-athlete')");
}

/** Déclare une douleur et rend son id. */
async function declarer(nom: string, zone: string) {
  const r = await fetch(URL_DOULEURS, {
    method: 'POST', headers: await entete(ATHLETE),
    body: JSON.stringify({ nom, zone }),
  });
  if (r.status !== 201) throw new Error(`POST /douleurs → ${r.status}`);
  return ((await r.json()) as { id: string }).id;
}

async function noter(id: string, jour: string, intensite: number, commentaire?: string,
                     entrainement?: boolean) {
  const r = await fetch(`${URL_DOULEURS}/${id}/logs/${jour}`, {
    method: 'PUT', headers: await entete(ATHLETE),
    body: JSON.stringify({ intensite, commentaire: commentaire ?? null,
                           ...(entrainement === undefined ? {} : { entrainement }) }),
  });
  if (r.status !== 200) throw new Error(`PUT /logs/${jour} → ${r.status}`);
}

type Signalement = {
  athleteId: string; date: string;
  douleurs: { nom: string; zone: string; intensite: number; commentaire: string | null;
              logs: number; recurrente: boolean }[];
};

const signalements = async (compte: typeof COACH) => {
  const r = await fetch(`${BROKKR}/athletes/signalements?jours=2`, {
    headers: { Authorization: `Bearer ${await jeton(compte)}` },
  });
  if (!r.ok) throw new Error(`GET /signalements → ${r.status}`);
  return r.json() as Promise<Signalement[]>;
};

test.beforeEach(() => effacerLesDouleurs());
test.afterEach(() => effacerLesDouleurs());

test('l’athlète rapporte, le kiné ET le coach le voient', async () => {
  // AVANT : rien. Sans cette assertion, un tableau qui rendrait tout et
  // n'importe quoi passerait — c'est le piège du « ça affiche quelque chose ».
  expect(await signalements(KINE)).toEqual([]);

  const id = await declarer('Mes lombaires', 'lower-back:gauche');
  await noter(id, AUJOURD_HUI, 8, 'Depuis 2 semaines');

  for (const compte of [KINE, COACH]) {
    const lu = await signalements(compte);
    expect(lu).toHaveLength(1);
    expect(lu[0].athleteId).toBe('e2e-athlete');
    expect(lu[0].date).toBe(AUJOURD_HUI);
    // ⚠️ LE CÔTÉ ARRIVE ENTIER, et c'est ce que le texte libre perdait : sept
    // des huit saisies historiques précisaient un côté qu'aucune requête ne
    // savait retrouver. `lower-back:gauche` est une valeur, plus une phrase.
    expect(lu[0].douleurs).toEqual([{
      id: expect.any(String), nom: 'Mes lombaires', zone: 'lower-back:gauche',
      intensite: 8, commentaire: 'Depuis 2 semaines', logs: 1, recurrente: false,
    }]);
  }
});

test('deux notes sur LA MÊME douleur ne font pas deux signalements distincts', async () => {
  /** ⚠️ LA PROMESSE DU TICKET, et ce que l'ancien modèle ne savait pas dire.
   *  Notée hier puis aujourd'hui, c'est UNE douleur qui dure — le staff doit
   *  lire « revient » et non deux alertes sans lien. Le compte `logs` et le
   *  drapeau `recurrente` se DÉDUISENT au serveur : les vérifier ici est ce qui
   *  garde la règle à un seul endroit. */
  const id = await declarer('Mon épaule', 'deltoid-anterior:droite');
  await noter(id, HIER, 6);
  await noter(id, AUJOURD_HUI, 4);

  const lu = await signalements(KINE);
  // Deux JOURS rapportés — la ligne du tableau est (athlète, jour) — mais une
  // seule douleur, qui se sait notée deux fois des deux côtés.
  expect(lu.map((s) => s.date)).toEqual([AUJOURD_HUI, HIER]);
  for (const s of lu) {
    expect(s.douleurs).toHaveLength(1);
    expect(s.douleurs[0].nom).toBe('Mon épaule');
    expect(s.douleurs[0].logs).toBe(2);
    expect(s.douleurs[0].recurrente).toBe(true);
  }
  expect(lu[0].douleurs[0].intensite).toBe(4);
});

test('l’histoire d’une douleur se relit ENTIÈRE, le plus récent en tête', async () => {
  /** ⚠️ CE QUE LE MOCK NE PEUT PAS DIRE (FRE-197). Ses écritures sont des no-op
   *  et sa lecture rend une constante : seul le circuit réel prouve que trois
   *  jours notés ressortent tous les trois, dans l'ordre, avec leur texte.
   *
   *  ⚠️ ET QU'UNE CORRECTION NE FAIT PAS DEUX POINTS : renoter le même jour
   *  REMPLACE. Deux points le même jour sur une courbe raconteraient une
   *  douleur qui varie dans la journée — une histoire que personne n'a dite. */
  const id = await declarer('Mon épaule', 'deltoid-anterior:droite');
  // ⚠️ HIER ÉTAIT UN JOUR ENTRAÎNÉ, AUJOURD'HUI NON DIT : les deux traversent,
  // et `null` n'est pas `false`. Une douleur qui fait mal un jour de repos est
  // ce que le kiné cherche en premier, et seul l'athlète peut le dire.
  await noter(id, HIER, 6, 'ça tire', true);
  await noter(id, AUJOURD_HUI, 4, 'mieux');
  await noter(id, AUJOURD_HUI, 2, 'en fait beaucoup mieux');

  const r = await fetch(`${URL_DOULEURS}/${id}/logs`, { headers: await entete(ATHLETE) });
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual([
    { date: AUJOURD_HUI, intensite: 2, commentaire: 'en fait beaucoup mieux', entrainement: null },
    { date: HIER, intensite: 6, commentaire: 'ça tire', entrainement: true },
  ]);

  // Le STAFF la lit aussi — c'est le point de la fonctionnalité.
  const vu = await fetch(`${URL_DOULEURS}/${id}/logs`, { headers: await entete(KINE) });
  expect(vu.status).toBe(200);
  expect((await vu.json()).length).toBe(2);
});

test('clore une douleur la range, sans effacer ce qui a été signalé', async () => {
  /** ⚠️ CE QUE L'ANCIEN MODÈLE PERDAIT. Le signalement vivait dans le journal du
   *  jour : dire « ça va mieux » l'effaçait, et le staff qui ne l'avait pas
   *  encore lu ne le lisait jamais. Une douleur close sort de la liste VIVANTE
   *  de l'athlète ; le jour où il a eu mal reste un fait, et reste lisible. */
  const id = await declarer('Mon genou', 'knees:droite');
  await noter(id, AUJOURD_HUI, 7);

  const r = await fetch(`${URL_DOULEURS}/${id}`, {
    method: 'PATCH', headers: await entete(ATHLETE),
    body: JSON.stringify({ fin: AUJOURD_HUI }),
  });
  expect(r.status).toBe(200);

  const liste = await fetch(URL_DOULEURS, { headers: await entete(ATHLETE) });
  expect(await liste.json()).toMatchObject([{ nom: 'Mon genou', fin: AUJOURD_HUI }]);

  const lu = await signalements(KINE);
  expect(lu).toHaveLength(1);
  expect(lu[0].douleurs[0].nom).toBe('Mon genou');
});

test('le kiné voit le suivi de son athlète à l’écran', async ({ page }) => {
  const id = await declarer('Mes lombaires', 'lower-back:gauche');
  await noter(id, AUJOURD_HUI, 8, 'Depuis 2 semaines');

  await seConnecter(page, KINE);
  await page.goto('/signalements');

  await expect(page.getByRole('link', { name: /Athlète E2E/i })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('8/10')).toBeVisible();
});
