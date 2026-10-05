import { expect, test } from '@playwright/test';
import { BROKKR, COACH, KINE, colonne, jeton, seConnecter } from './aides';

/** LE MOTEUR DE BILANS, CONTRE LA VRAIE PILE.
 *
 *  ⚠️ CE QUE SEUL CE HARNAIS PEUT PROUVER, et c'est la raison d'être du fichier :
 *  l'INSTANTANÉ (`brokkr/docs/bilan-kine.md` §3.1). La garantie tient en une
 *  phrase — modifier un modèle ne change RIEN aux bilans déjà ouverts — et elle
 *  ne se vérifie qu'en écrivant vraiment : le dev-mock ne persiste rien, donc
 *  « l'écran affiche l'ancienne charge » et « l'ancienne charge est enregistrée »
 *  y sont indiscernables. Or c'est exactement la promesse du chantier.
 *
 *  Si cette spec tombe, ce n'est pas un défaut d'affichage : c'est que la kiné,
 *  en corrigeant une charge, réécrit silencieusement des mesures passées.
 *
 *  ⚠️ ET LA FRONTIÈRE D'ACCÈS. Le bilan est le seul domaine dont le COACH est
 *  exclu — il porte des antécédents et des pathologies. Un mode d'autorisation
 *  élargi par mégarde ne change aucun écran : rien ne le signalerait sans une
 *  spec qui l'essaie pour de bon.
 */

const AUJOURD_HUI = new Date().toISOString().slice(0, 10);

interface TestLu { id: string; libelle: string; chargeKg: number | null; retire: boolean }
interface ModeleLu {
  id: string; nom: string; nbTests: number;
  rubriques: { id: string; libelle: string; tests: TestLu[] }[];
}
interface ResultatLu {
  id: string; testId: string | null; testLibelle: string; protocole: string | null;
  mesure: string; bilateral: boolean; chargeKg: number | null;
  mesureGauche: number | null; mesureDroite: number | null;
}
interface BilanLu {
  id: string; statut: string; modeleNom: string;
  testsRenseignes: number; testsTotal: number; resultats: ResultatLu[];
}

async function api<T>(
  chemin: string,
  options: { methode?: string; corps?: unknown; compte?: typeof COACH } = {},
): Promise<{ statut: number; corps: T }> {
  const { methode = 'GET', corps, compte = KINE } = options;
  const r = await fetch(`${BROKKR}${chemin}`, {
    method: methode,
    headers: {
      Authorization: `Bearer ${await jeton(compte)}`,
      ...(corps ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(corps ? { body: JSON.stringify(corps) } : {}),
  });
  const texte = await r.text();
  return { statut: r.status, corps: (texte ? JSON.parse(texte) : null) as T };
}

/** Un modèle jetable, propre à chaque spec : les specs ne doivent pas se marcher
 *  dessus, et le modèle semé (« Bilan complet ») appartient à la kiné en prod. */
async function modeleJetable(nom: string): Promise<ModeleLu> {
  const { statut, corps } = await api<ModeleLu>('/bilan-modeles', {
    methode: 'POST', corps: { nom },
  });
  expect(statut, JSON.stringify(corps)).toBe(201);
  return corps;
}

async function ajouterTest(
  modele: ModeleLu, rubriqueId: string, corps: Record<string, unknown>,
): Promise<TestLu> {
  const r = await api<TestLu>(`/bilan-modeles/${modele.id}/rubriques/${rubriqueId}/tests`, {
    methode: 'POST', corps,
  });
  expect(r.statut, JSON.stringify(r.corps)).toBe(201);
  return r.corps;
}

async function modeleAvecUnTest(nom: string): Promise<{ modele: ModeleLu; test: TestLu }> {
  const vide = await modeleJetable(nom);
  const avecRubrique = await api<ModeleLu>(`/bilan-modeles/${vide.id}/rubriques`, {
    methode: 'POST', corps: { libelle: 'Activation' },
  });
  const rubriqueId = avecRubrique.corps.rubriques[0].id;
  const test = await ajouterTest(avecRubrique.corps, rubriqueId, {
    libelle: 'Grip', protocole: 'Tenir un disque du bout des doigts',
    mesure: 'secondes', bilateral: true, chargeKg: 15, materiel: 'disque',
    vues: ['profil'],
  });
  const { corps: modele } = await api<ModeleLu>(`/bilan-modeles/${vide.id}`);
  return { modele, test };
}

const ouvrirBilan = (modeleId: string) =>
  api<BilanLu>('/athletes/e2e-athlete/bilans', {
    methode: 'POST', corps: { modeleId, date: AUJOURD_HUI },
  });

test.afterEach(async () => {
  // Les modèles jetables partent avec leurs bilans — sinon chaque run laisse un
  // modèle de plus dans le catalogue, et le suivant les compte.
  //
  // ⚠️ UN BILAN FINALISÉ NE SE SUPPRIME PAS PAR L'API, ET C'EST LA RÈGLE (409
  // `bilan_deja_finalise`, depuis la naissance de la route). La spec « un bilan
  // FINALISÉ ne bouge plus » en laissait donc UN à chaque run, et son modèle avec
  // (`modele_utilise`) : 45 modèles « E2E » comptés le 09/09 dans le bac à sable,
  // et ce ménage — qui relisait la liste des bilans pour CHACUN — dépassait les
  // 30 s. Cinq specs rouges sur leur `afterEach`, pas sur ce qu'elles promettent.
  //
  // Le seul œil qui puisse les retirer est la colonne (cf. `colonne`) : c'est le
  // cas où la réponse et la base diffèrent LÉGITIMEMENT — le contrat refuse, et
  // c'est ce qu'on veut de lui.
  colonne(
    "DELETE FROM bilans b USING athletes a, bilan_modeles m "
    + "WHERE a.id = b.athlete_id AND a.legacy_id = 'e2e-athlete' "
    + "AND m.id = b.modele_id AND m.nom LIKE 'E2E %' AND b.statut = 'finalise'");
  const { corps: modeles } = await api<ModeleLu[]>('/bilan-modeles');
  const { corps: bilans } = await api<{ id: string; modeleNom: string }[]>(
    '/athletes/e2e-athlete/bilans');
  for (const m of modeles.filter(x => x.nom.startsWith('E2E '))) {
    for (const b of bilans.filter(x => x.modeleNom === m.nom)) {
      await api(`/athletes/e2e-athlete/bilans/${b.id}`, { methode: 'DELETE' });
    }
    const complet = await api<ModeleLu>(`/bilan-modeles/${m.id}`);
    for (const r of complet.corps.rubriques) {
      for (const t of r.tests) {
        await api(`/bilan-modeles/${m.id}/tests/${t.id}`, { methode: 'DELETE' });
      }
      await api(`/bilan-modeles/${m.id}/rubriques/${r.id}`, { methode: 'DELETE' });
    }
    await api(`/bilan-modeles/${m.id}`, { methode: 'DELETE' });
  }
});

test('MODIFIER LE MODÈLE NE RÉÉCRIT PAS UN BILAN DÉJÀ OUVERT', async () => {
  const { modele, test: grip } = await modeleAvecUnTest('E2E instantané');
  const { statut, corps: bilan } = await ouvrirBilan(modele.id);
  expect(statut, JSON.stringify(bilan)).toBe(201);

  // Le bilan a COPIÉ le modèle : consignes comprises, sans quoi l'athlète
  // remplirait à l'aveugle (il n'a pas accès au catalogue).
  const avant = bilan.resultats[0];
  expect(avant.testLibelle).toBe('Grip');
  expect(avant.chargeKg).toBe(15);
  expect(avant.bilateral).toBe(true);
  expect(avant.protocole).toContain('disque');

  // La kiné change de disque et corrige son protocole — geste légitime.
  const patch = await api(`/bilan-modeles/${modele.id}/tests/${grip.id}`, {
    methode: 'PATCH',
    corps: { chargeKg: 20, libelle: 'Grip pince', bilateral: false, mesure: 'reps' },
  });
  expect(patch.statut).toBe(200);

  // ⚠️ LE CŒUR DE LA SPEC. Sans l'instantané, ces quatre assertions tomberaient
  // ensemble — et en production, ce serait une courbe devenue fausse sans que
  // rien ne l'ait signalé.
  const { corps: relu } = await api<BilanLu>(`/athletes/e2e-athlete/bilans/${bilan.id}`);
  const apres = relu.resultats[0];
  expect(apres.chargeKg, 'la charge du bilan a suivi le modèle').toBe(15);
  expect(apres.testLibelle, 'le libellé du bilan a suivi le modèle').toBe('Grip');
  expect(apres.bilateral, 'la latéralité du bilan a suivi le modèle').toBe(true);
  expect(apres.mesure, "l'unité du bilan a suivi le modèle").toBe('secondes');
});

test('un test AJOUTÉ ou RETIRÉ après coup ne change pas un bilan ouvert', async () => {
  const { modele, test: grip } = await modeleAvecUnTest('E2E composition');
  const { corps: bilan } = await ouvrirBilan(modele.id);
  expect(bilan.testsTotal).toBe(1);

  const rubriqueId = modele.rubriques[0].id;
  await ajouterTest(modele, rubriqueId, {
    libelle: 'Ajouté après', mesure: 'aucune', bilateral: false,
  });
  await api(`/bilan-modeles/${modele.id}/tests/${grip.id}`, {
    methode: 'PATCH', corps: { retire: true },
  });

  const { corps: relu } = await api<BilanLu>(`/athletes/e2e-athlete/bilans/${bilan.id}`);
  expect(relu.testsTotal, 'le bilan ouvert a bougé sous les doigts').toBe(1);
  expect(relu.resultats[0].testLibelle).toBe('Grip');

  // …mais le PROCHAIN bilan, lui, suit le modèle d'aujourd'hui.
  const { corps: suivant } = await ouvrirBilan(modele.id);
  expect(suivant.testsTotal).toBe(1);
  expect(suivant.resultats[0].testLibelle).toBe('Ajouté après');
});

test('la saisie s’enregistre, et un bilan FINALISÉ ne bouge plus', async () => {
  const { modele } = await modeleAvecUnTest('E2E saisie');
  const { corps: bilan } = await ouvrirBilan(modele.id);
  const resultatId = bilan.resultats[0].id;

  // ⚠️ ZÉRO N'EST PAS NULL, et la distinction doit survivre à l'aller-retour :
  // `0` = échec constaté, `null` = test non réalisé.
  const ecrit = await api<{ testsRenseignes: number }>(
    `/athletes/e2e-athlete/bilans/${bilan.id}/resultats/${resultatId}`,
    { methode: 'PATCH', corps: { ressenti: 'gene', mesureGauche: 0, chargeKg: 12 } });
  expect(ecrit.statut).toBe(200);
  expect(ecrit.corps.testsRenseignes).toBe(1);

  const { corps: relu } = await api<BilanLu>(`/athletes/e2e-athlete/bilans/${bilan.id}`);
  expect(relu.resultats[0].mesureGauche).toBe(0);
  expect(relu.resultats[0].mesureDroite).toBeNull();
  expect(relu.resultats[0].chargeKg, 'la charge RÉELLEMENT utilisée').toBe(12);

  const fige = await api(`/athletes/e2e-athlete/bilans/${bilan.id}`, {
    methode: 'PATCH', corps: { statut: 'finalise' },
  });
  expect(fige.statut, JSON.stringify(fige.corps)).toBe(200);

  const apres = await api<{ code: string }>(
    `/athletes/e2e-athlete/bilans/${bilan.id}/resultats/${resultatId}`,
    { methode: 'PATCH', corps: { mesureGauche: 99 } });
  expect(apres.statut).toBe(409);
  expect(apres.corps.code).toBe('bilan_deja_finalise');

  // ⚠️ NI SA MÉTA (FRE-132) : date, antécédents et notes se réécrivaient sans
  // condition pendant un mois, seul l'écran figeait. La date situe le point sur
  // la courbe ; les antécédents sont la donnée la plus sensible du produit.
  const meta = await api<{ code: string }>(`/athletes/e2e-athlete/bilans/${bilan.id}`,
                                           { methode: 'PATCH', corps: { notes: 'après coup' } });
  expect(meta.statut).toBe(409);
  expect(meta.corps.code).toBe('bilan_deja_finalise');

  // Un bilan finalisé est une mesure datée : on ne l'efface pas d'un clic.
  const suppr = await api<{ code: string }>(`/athletes/e2e-athlete/bilans/${bilan.id}`,
                                            { methode: 'DELETE' });
  expect(suppr.statut).toBe(409);
});

test('le COACH n’atteint ni les bilans, ni la composition', async () => {
  const { modele } = await modeleAvecUnTest('E2E frontière');
  const { corps: bilan } = await ouvrirBilan(modele.id);

  // Le dossier médical : hors de portée, alors qu'il gère bien cet athlète.
  const lecture = await api<{ code: string }>(`/athletes/e2e-athlete/bilans/${bilan.id}`,
                                              { compte: COACH });
  expect(lecture.statut).toBe(403);
  expect(lecture.corps.code).toBe('athlete_hors_perimetre');

  // La composition : un acte de praticien, pas d'entraîneur.
  const catalogue = await api<{ code: string }>('/bilan-modeles', { compte: COACH });
  expect(catalogue.statut).toBe(403);
  expect(catalogue.corps.code).toBe('reserve_aux_kines');
});

test('la kiné compose depuis l’écran, et son modèle existe vraiment', async ({ page }) => {
  await seConnecter(page, KINE);
  await page.goto('/bilan-modeles');

  await expect(page.getByRole('heading', { name: 'Modèles de bilan' })).toBeVisible();

  // ⚠️ DEUX GESTES DEPUIS LE 25/08, ET LE PREMIER EST LE CORRECTIF. « + Modèle
  // vide » était un bouton direct, la duplication vivant dans une icône posée sur
  // chaque ligne — que Thomas n'a pas trouvée, au point de croire la
  // fonctionnalité disparue. Le bouton ouvre désormais un menu où « Modèle vide »
  // et « Dupliquer un modèle » se présentent ensemble.
  await page.getByRole('button', { name: 'Modèle', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Modèle vide' }).click();

  // Le composeur s'ouvre sur le modèle neuf — le créer sans y aller obligerait à
  // le retrouver dans la liste juste après l'avoir demandé.
  await expect(page.getByRole('button', { name: /Ajouter une rubrique/ })).toBeVisible();
  await page.getByRole('button', { name: /Ajouter une rubrique/ }).click();
  await expect(page.getByRole('button', { name: /^Test$/ })).toBeVisible();
  await page.getByRole('button', { name: /^Test$/ }).click();

  // ⚠️ L'ÉCRAN L'AFFICHE ET LA BASE LE PORTE sont deux choses différentes : on
  // vérifie la seconde, c'est tout l'objet de ce harnais.
  await expect(page.getByRole('button', { name: /Nouveau test/ })).toBeVisible();
  const { corps: modeles } = await api<ModeleLu[]>('/bilan-modeles');
  const cree = modeles.find(m => m.nom === 'Nouveau modèle');
  expect(cree, 'le modèle créé à l’écran n’existe pas côté serveur').toBeTruthy();
  expect(cree!.nbTests).toBe(1);

  // Nettoyage : ce modèle-ci ne porte pas le préfixe E2E (l'écran nomme).
  const complet = await api<ModeleLu>(`/bilan-modeles/${cree!.id}`);
  for (const r of complet.corps.rubriques) {
    for (const t of r.tests) await api(`/bilan-modeles/${cree!.id}/tests/${t.id}`, { methode: 'DELETE' });
    await api(`/bilan-modeles/${cree!.id}/rubriques/${r.id}`, { methode: 'DELETE' });
  }
  await api(`/bilan-modeles/${cree!.id}`, { methode: 'DELETE' });
});
