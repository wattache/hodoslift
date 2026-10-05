import { expect, test } from '@playwright/test';
import { ATHLETE, BROKKR, COACH, KINE, jeton } from './aides';

/** LA GARDE, LE FILET ET LE RIS — contre la vraie pile (FRE-78, FRE-79, FRE-92).
 *
 *  ⚠️ POURQUOI CE FICHIER EXISTE. Les trois chantiers étaient couverts par
 *  pytest et par l'e2e mock, et pourtant l'un d'eux ne tenait pas sa promesse :
 *  le filet 500 rendait bien du JSON au contrat, mais SANS en-tête CORS — donc
 *  invisible au navigateur, qui est le seul destinataire qui compte. Quatre
 *  specs unitaires le disaient vert.
 *
 *  La leçon est le sujet de ce fichier : une promesse qui traverse des couches
 *  (CORS, middlewares, sérialisation, SQL) ne se prouve qu'en partant d'où part
 *  le vrai client. Ici : un jeton d'émulateur, un `Origin:` réel, et un serveur
 *  branché sur un vrai Postgres.
 *
 *  ⚠️ CHAQUE SPEC A ÉTÉ VUE ROUGE, par une mutation qui vise ce qu'elle PROMET :
 *
 *    · `require_membre` → `verify_token` ............ le compte étranger entre
 *    · `require_membre` → `require_coach` ........... l'athlète est mis dehors
 *    · `/library` rendu à `verify_token` ............ l'étranger lit la biblio
 *    · `/weight-categories` idem .................... l'étranger lit les codes
 *    · `/users/me` passé sous `require_membre` ...... on ne peut plus rien dire
 *                                                     à qui n'est pas du club
 *    · `cs.total_bareme_kg` → `cs.score` ............ le chin up compte deux fois
 *    · barème, pivot `V` 74.777 → 75.777 ............ le RIS dérive
 *    · un RIS absent servi comme `0` ................ l'athlète devient dernier
 *
 *  ⚠️ ET CE QUE CE FICHIER NE PROUVE PAS, faute de déclencheur : le filet 500
 *  lui-même. Aucune requête ne provoque plus d'exception imprévue depuis
 *  l'extérieur — c'est le but — donc son placement SOUS `CORSMiddleware` reste
 *  épinglé par `brokkr/tests/test_forme_erreur.py`, qui fait exploser `/health`
 *  par monkeypatch sur l'application RÉELLE, en-tête `Origin` compris. Déplacer
 *  `erreurs.installer(app)` après `add_middleware` fait rougir cette spec-là, et
 *  aucune d'ici. La couverture est donc à deux endroits, sciemment.
 */

const ORIGINE = 'https://trainer.french-forge.com';

/** Un compte Google VALIDE mais totalement étranger au club. L'émulateur le crée
 *  à la volée : c'est exactement le cas de FRE-78 — Firebase n'impose aucun
 *  domaine, donc n'importe qui obtient un jeton recevable. */
const ETRANGER = { sub: 'e2e-etranger-google', email: 'etranger@ailleurs.test' };

async function appel(chemin: string, compte = COACH, options: RequestInit = {}) {
  return fetch(`${BROKKR}${chemin}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${await jeton(compte)}`,
      // ⚠️ L'EN-TÊTE QUI CHANGE TOUT. Sans `Origin`, le serveur ne pose aucun
      // en-tête CORS et la spec passerait sans rien prouver — c'est précisément
      // ainsi que la faute de FRE-79 est restée invisible.
      Origin: ORIGINE,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
}

// --------------------------------------------------------------------------- //
// FRE-78 — la garde « membre »
// --------------------------------------------------------------------------- //

/** ⚠️ CES DEUX SPECS PASSAIENT PAR L'ANNUAIRE, SUPPRIMÉ LE 30/08 (FRE-13). La
 *  route ne servait plus AUCUN écran depuis le 22/08, mais elle portait encore
 *  des gardes vivantes — ici, et à deux autres niveaux. Une route morte qui reste
 *  branchée finit par être ce sur quoi les tests s'appuient : la supprimer les
 *  emporte, et on croit avoir perdu la règle alors qu'on a perdu la porte.
 *
 *  La garde « membre » protège toujours la bibliothèque et les catégories de
 *  poids. C'est là qu'on l'éprouve désormais. */
test('un compte Google SANS LIEN avec le club est refusé', async () => {
  const r = await appel('/library', ETRANGER);
  expect(r.status).toBe(403);
  expect((await r.json()).code).toBe('reserve_aux_membres');
});

test('un membre passe — la bibliothèque reste ouverte à tous ceux du club', async () => {
  for (const compte of [COACH, ATHLETE]) {
    const r = await appel('/library', compte);
    expect(r.status, `${compte.email} devrait entrer`).toBe(200);
  }
});

/** Les lectures fermées le 22/08, après relevé de TOUT ce qu'un compte sans lien
 *  pouvait encore lire. La bibliothèque était le vrai trou — 230 entrées, le
 *  référentiel construit par les coachs ; les catégories de poids n'y sont que
 *  par cohérence, une porte ouverte au milieu de deux fermées finissant par ne
 *  plus se justifier. */
for (const route of ['/library', '/weight-categories']) {
  test(`${route} est réservé aux membres`, async () => {
    expect((await appel(route, ETRANGER)).status).toBe(403);
    expect((await appel(route, ATHLETE)).status, 'un athlète du club lit').toBe(200);
  });
}

test('/users/me reste ouvert à tout authentifié — sinon on ne peut plus rien lui dire', async () => {
  /** ⚠️ LA LECTURE À NE PAS FERMER. C'est sa réponse qui permet à `AuthGate`
   *  d'annoncer « ton coach ne t'a pas encore enregistré ». La refuser aussi
   *  rendrait ce message impossible : l'app ne saurait plus distinguer
   *  « inconnu du club » de « profil pas chargé », et on retomberait dans
   *  l'incident du 21/08 — accuser le coach quand on ne sait pas. */
  const r = await appel('/users/me', ETRANGER);
  expect(r.status).toBe(200);
  const moi = await r.json();
  expect([moi.isCoach, moi.isKine, moi.isAdmin], 'aucun rôle').toEqual([false, false, false]);
});

// --------------------------------------------------------------------------- //
// FRE-79 — le filet, et surtout ses en-têtes
// --------------------------------------------------------------------------- //

/** Les familles de refus ATTEIGNABLES depuis un navigateur, chacune sortant par
 *  un gestionnaire différent — routage Starlette, validation Pydantic, métier.
 *  C'est cette diversité qui fait la spec : le défaut de FRE-79 tenait à ce
 *  qu'UN chemin de sortie contournait la pile de middlewares. */
const REFUS: [string, () => Promise<Response>, number, string][] = [
  ['route inconnue', () => appel('/cette-route-nexiste-pas'), 404, 'route_introuvable'],
  ['verbe interdit', () => appel('/health', COACH, { method: 'DELETE' }), 405, 'methode_non_autorisee'],
  // Le cast `CAST('abc' AS uuid)` levait une `DataError` — un 500 en texte brut.
  // La contrainte est remontée dans la signature de la route (FRE-39). Le KINÉ
  // et pas le coach : le bilan est à lui (FRE-65), et la garde tranche AVANT la
  // validation du chemin — le coach n'atteindrait jamais le 422.
  ['uuid mal formé', () => appel('/athletes/e2e-athlete/bilans/pas-un-uuid', KINE),
    422, 'identifiant_invalide'],
];

for (const [quoi, envoyer, statut, code] of REFUS) {
  test(`un refus « ${quoi} » se nomme, ET porte ses en-têtes CORS`, async () => {
    /** ⚠️ LA SPEC QUE LA REVUE A RÉCLAMÉE. Un corps JSON au contrat ne sert à
     *  rien si la réponse ne traverse pas `CORSMiddleware` : `fetch` rejette
     *  avant même de la lire, et le front accuse la connexion pour une erreur
     *  qu'il aurait su nommer. C'est exactement ce qui arrivait au filet 500
     *  jusqu'au 22/08 — et ce qu'aucune spec unitaire ne voyait.
     *
     *  ⚠️ ET LE REFUS EST INTRINSÈQUE, jamais le 403 de FRE-78 : une spec de
     *  CORS qui emprunte la garde d'un autre ticket rougit quand cette garde
     *  bouge, pour une raison qui n'a rien à voir avec CORS. */
    const r = await envoyer();
    expect(r.status).toBe(statut);
    expect((await r.json()).code).toBe(code);
    expect(r.headers.get('access-control-allow-origin')).toBe(ORIGINE);
  });
}

// --------------------------------------------------------------------------- //
// FRE-92 — le RIS, de la vue SQL jusqu'à la charge utile
// --------------------------------------------------------------------------- //

interface AthleteLu {
  id: string; ris?: number; risTotal?: number; risBodyweight?: number;
  risCompetition?: string;
}

const COMPET = 'e2e-ris';

async function poserLaCompetition(essais: Record<string, number>, poids = 80) {
  const mouvements = Object.keys(essais);
  const r = await appel(`/competitions/${COMPET}`, COACH, {
    method: 'PUT',
    body: JSON.stringify({
      name: 'Open E2E', date: '2026-05-01', maxAttempts: 1,
      movementNames: mouvements,
      participants: [{
        name: 'Athlète E2E',
        // ⚠️ C'EST `uid` QUI RATTACHE, PAS LE NOM. Sans lui, le participant est
        // un invité (`athlete_id` NULL) et son RIS n'atteint jamais l'annuaire —
        // la spec passerait pour un motif qui n'a rien à voir avec le barème.
        uid: 'e2e-athlete-user',
        bodyweight: poids, gender: 'M',
        movements: mouvements.map(m => ({
          name: m, attempts: [{ weight: essais[m], result: 'rep' }],
        })),
      }],
    }),
  });
  expect(r.status, await r.text()).toBe(200);
}

/** ⚠️ PAR `/athletes/mine` DEPUIS LE 30/08 : l'annuaire, qui servait ici, a été
 *  supprimé (FRE-13). Le RIS est calculé par la même fonction pour les deux
 *  routes — la garde change de porte, pas de sujet. */
const athleteE2E = async (): Promise<AthleteLu> => {
  const r = await appel('/athletes/mine', COACH);
  const tous = (await r.json()) as AthleteLu[];
  return tous.find(a => a.id === 'e2e-athlete')!;
};

test.afterEach(async () => {
  await appel(`/competitions/${COMPET}`, COACH, { method: 'DELETE' });
});

test('le RIS traverse la vue SQL, le barème et le contrat', async () => {
  /** ⚠️ CE QUE SEULE LA VRAIE PILE PROUVE. Le total est agrégé par une VUE
   *  Postgres, le barème appliqué en Python, le tout sérialisé par un
   *  `response_model` — trois couches qu'aucun test unitaire ne traverse
   *  ensemble.
   *
   *  ⚠️ MAIS ELLE NE SUFFIT PAS. Sur ces quatre mouvements, le score de
   *  l'épreuve et le total du barème valent la MÊME chose : servir l'un pour
   *  l'autre laisse cette spec verte. C'est la suivante qui les sépare — d'où
   *  son existence. */
  await poserLaCompetition({ 'MUSCLE UP': 25, 'PULL UP': 70, DIPS: 90, SQUAT: 160 });

  const a = await athleteE2E();
  expect(a.risTotal).toBe(345);
  // Valeur de référence, la même que dans `test_ris.py` et `ris-score.test.ts`.
  expect(a.ris).toBeCloseTo(68.8442612136, 6);
  expect(a.risCompetition).toBe('Open E2E');
  expect(a.risBodyweight).toBe(80);
});

test('le pull up et le chin up se disputent une place, jusque dans la réponse', async () => {
  /** La règle de la fédération, éprouvée de bout en bout : le front l'ignorait
   *  (il écartait le chin up), la vue la porte désormais. Ici le chin up est le
   *  plus lourd — c'est LUI qui doit compter, et une seule fois.
   *
   *  ⚠️ LA COMPÉTITION DOIT ÊTRE UNE STREET COMPLÈTE, et cette spec l'ignorait.
   *  Elle en posait une à trois mouvements et attendait quand même un barème.
   *  Depuis FRE-147 (07/09), `total_bareme_kg` ne s'applique QU'AUX épreuves
   *  qui portent les quatre places du barème street — sinon une SBD y entrerait
   *  avec le squat seul, et serait classée sur un quart de son total.
   *
   *  ⚠️ ET ELLE PASSAIT QUAND MÊME PENDANT CINQ JOURS. Le bac à sable portait la
   *  vue d'AVANT le bornage : `verifier_schema` l'annonçait à chaque démarrage
   *  du harnais, sans que personne le lise. C'est la troisième fois que ce
   *  décalage fait mentir une spec — cf. l'en-tête de `scripts/e2e-reel.sh`. */
  await poserLaCompetition({
    'MUSCLE UP': 40, DIPS: 80, SQUAT: 100, 'PULL UP': 60, 'CHIN UP': 70,
  });

  const a = await athleteE2E();
  // 40 + 80 + 100 = 220, plus UNE seule des deux tractions — la plus lourde.
  expect(a.risTotal, 'le chin up gagne la place, le pull up ne s’ajoute pas').toBe(290);
});

test('un participant SANS POIDS n’a pas de RIS — et surtout pas un zéro', async () => {
  /** `null`, pas `0` : un athlète qu'on ne sait pas classer n'est pas dernier.
   *  Le champ est ABSENT de la réponse (`response_model_exclude_unset`), donc le
   *  front n'a rien à défendre. */
  const r = await appel(`/competitions/${COMPET}`, COACH, {
    method: 'PUT',
    body: JSON.stringify({
      name: 'Open E2E', date: '2026-05-01', maxAttempts: 1,
      movementNames: ['SQUAT'],
      participants: [{
        name: 'Athlète E2E', uid: 'e2e-athlete-user',
        movements: [{ name: 'SQUAT', attempts: [{ weight: 160, result: 'rep' }] }],
      }],
    }),
  });
  expect(r.status, await r.text()).toBe(200);

  const a = await athleteE2E();
  expect(a.ris).toBeUndefined();
});
