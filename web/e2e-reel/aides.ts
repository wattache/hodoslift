import { execFileSync } from 'node:child_process';

import { expect, type Page } from '@playwright/test';

export const BROKKR = process.env.E2E_BROKKR_URL ?? 'http://127.0.0.1:8082';
export const EMULATEUR = process.env.E2E_AUTH_EMULATOR ?? '127.0.0.1:9099';
export const PROGRAMME = 'e2e-program';

/** Les DEUX comptes du harnais : le coach qui programme, l'athlète qui saisit
 *  son réalisé. Deux rôles, parce qu'un refus d'autorisation (403 sur la méta)
 *  ne se prouve pas avec un seul compte. Les `sub` correspondent aux
 *  `provider_data.uid` importés par `scripts/seed_e2e_auth.py`. */
export const COACH = { sub: 'e2e-coach-google', email: 'e2e@french-forge.test' };
export const ATHLETE = { sub: 'e2e-athlete-user-google', email: 'athlete-e2e@french-forge.test' };
export const KINE = { sub: 'e2e-kine-google', email: 'kine-e2e@french-forge.test' };
/** Le compte dont l'IDENTITÉ a changé (FRE-76) : son adresse est celle de la
 *  fiche `e2e-identite`, mais cette fiche est rattachée à `e2e-identite-ancien`
 *  — un uid sans compte Firebase en face, l'état que laisse un compte Google
 *  recréé. `seed_e2e.sql` remet cet état à chaque lancement du harnais. */
export const IDENTITE = { sub: 'e2e-identite-google', email: 'identite-e2e@french-forge.test' };
/** ⚠️ LE COACH QUI EST AUSSI ATHLÈTE (FRE-142) — coach de SON PROPRE programme,
 *  `e2e-program-double`, comme William. Mesuré le 09/09 : les 4 coachs de
 *  production sont athlètes. Le seul compte pour lequel brokkr résout DEUX rôles
 *  sur un même programme ; jusqu'ici, toute règle branchée sur le rôle lui
 *  passait au vert sans être éprouvée. Son programme est séparé : `nettoyer`
 *  vide `e2e-program` après chaque spec, et un décor partagé ferait mentir les
 *  deux. */
export const COACH_ATHLETE = { sub: 'e2e-coach-athlete-google', email: 'coach-athlete-e2e@french-forge.test' };
export const PROGRAMME_DOUBLE = 'e2e-program-double';

/** Un jeton d'un compte de test, obtenu par l'API de l'émulateur.
 *
 *  Sert aux assertions et au nettoyage : on interroge brokkr DIRECTEMENT plutôt
 *  que de relire le DOM. C'est le point qui distingue ces tests des 77 autres —
 *  « l'écran l'affiche » et « c'est écrit » sont deux choses différentes, et
 *  seule la seconde nous intéresse ici. */
export async function jeton(compte: { sub: string; email?: string } = COACH): Promise<string> {
  const r = await fetch(
    `http://${EMULATEUR}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postBody: `id_token=${encodeURIComponent(JSON.stringify(compte))}&providerId=google.com`,
        requestUri: 'http://localhost',
        returnSecureToken: true,
      }),
    },
  );
  const d = await r.json();
  if (!d.idToken) throw new Error(`émulateur : pas de jeton (${JSON.stringify(d).slice(0, 200)})`);
  return d.idToken;
}

/** Ce que la lecture rend, réduit à ce dont les assertions ont besoin.
 *
 *  Volontairement DÉCLARÉ ICI plutôt qu'importé de `@/api/types` : ces tests
 *  vérifient la réponse du SERVEUR, pas la façon dont le front la type. Importer
 *  le type du produit ferait passer une divergence pour une conformité. */
interface SemaineLue {
  id?: string;
  sessions?: { id?: string; name?: string; formOfTheDay?: number | string; exercises: Record<string, unknown>[] }[];
}
interface BaseLue {
  s1StartDate?: string; s1EndDate?: string;
  principles: Record<string, unknown>[]; accessories: Record<string, unknown>[];
}
interface BlocLu { id: string; base: BaseLue; weeks: SemaineLue[] }
interface MacroLu { id: string; blocks: BlocLu[] }

/** L'arbre TEL QUE LE SERVEUR LE REND — la source de vérité des assertions.
 *  Par défaut le programme du coach de test ; le coach-athlète lit le sien. */
export async function arbre(
  programme = PROGRAMME, compte: { sub: string; email?: string } = COACH,
): Promise<{ macros: MacroLu[] }> {
  const r = await fetch(`${BROKKR}/programs/${programme}/training`, {
    headers: { Authorization: `Bearer ${await jeton(compte)}` },
  });
  if (!r.ok) throw new Error(`GET /training → ${r.status}`);
  return r.json();
}

/** LA COLONNE, PAS LA RÉPONSE — le seul œil qui voit ce que la lecture rattrape.
 *
 *  ⚠️ POURQUOI `arbre()` NE SUFFIT PAS TOUJOURS, appris en écrivant FRE-145. La
 *  lecture applique des filets : `training_tree._sortie` rend « biset » pour tout
 *  groupe dont la colonne est NULL, en séance COMME dans la BASE. Une spec qui
 *  interroge `GET /training` est donc structurellement incapable de voir un
 *  groupe sans nature — la première version de `bi-set-dans-la-base` restait
 *  verte avec les DEUX moitiés du correctif retirées. Un test qui ne peut pas
 *  rougir est pire que pas de test : il atteste.
 *
 *  ⚠️ N'EN FAIRE UN USAGE QUE POUR CETTE RAISON-LÀ. Interroger la base court-
 *  circuite le contrat, qui est ce que ce harnais est là pour éprouver. Le
 *  critère : la RÉPONSE ET LA COLONNE DIFFÈRENT-ELLES légitimement ? Si oui,
 *  c'est ici ; sinon, `arbre()`.
 *
 *  `docker exec` plutôt qu'un client Postgres : le harnais exige déjà le
 *  conteneur (`scripts/e2e-reel.sh` s'arrête net s'il ne répond pas), et ça
 *  n'ajoute aucune dépendance au dépôt. */
export function colonne(sql: string): string {
  return execFileSync(
    'docker', ['exec', '-i', 'ff-training', 'psql', '-tAqc', sql, '-U', 'postgres', '-d', 'ff'],
    { encoding: 'utf8' },
  ).trim();
}

/** Remet le programme de test à zéro. Appelé en `afterEach`, donc exécuté même
 *  quand le test échoue — sinon un échec laisserait le terrain sale pour le
 *  suivant, et on ne saurait plus lequel a menti. */
export async function nettoyer(): Promise<void> {
  await nettoyerLeProgramme(PROGRAMME, COACH);
}

/** Le même ménage, sur un AUTRE programme — celui du coach-athlète. Séparé de
 *  `nettoyer` parce que `test.afterEach(nettoyer)` lui passe les fixtures en
 *  premier argument : un paramètre optionnel y recevrait `{ page }`. */
export async function nettoyerLeProgramme(
  programme: string, compte: { sub: string; email?: string },
): Promise<void> {
  const t = await jeton(compte);
  const { macros } = await arbre(programme, compte);
  for (const m of macros) {
    await fetch(`${BROKKR}/programs/${programme}/macros/${m.id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${t}` },
    });
  }
}

/** LA SESSION FIREBASE, TELLE QU'ELLE EST VRAIMENT STOCKÉE — et ce n'est pas
 *  là où le harnais la cherchait.
 *
 *  ⚠️ ELLE VIT DANS INDEXEDDB (`firebaseLocalStorageDb`), PAS DANS localStorage.
 *  Mesuré le 10/09 en dumpant les deux après une connexion réussie :
 *
 *      localStorage : ff-language, eitri-rm-selection, eitri-theme
 *      indexedDB    : firebaseLocalStorageDb, firebase-heartbeat-database
 *
 *  Le diagnostic d'échec de `seConnecter` interrogeait `localStorage` : il
 *  rendait donc « session Firebase : NON » MÊME QUAND LA CONNEXION AVAIT
 *  MARCHÉ. C'est ce message qui figure dans FRE-164 comme s'il était une
 *  preuve — toutes les enquêtes sur ce flaky sont parties d'un indice faux. */
const BASE_SESSION = 'firebaseLocalStorageDb';
const MAGASIN_SESSION = 'firebaseLocalStorage';

type EnregistrementSession = { fbase_key: string; value: unknown };

function lireLaSession(page: Page): Promise<EnregistrementSession[]> {
  return page.evaluate(([base, magasin]) => new Promise<EnregistrementSession[]>((resoudre) => {
    const ouverture = indexedDB.open(base);
    ouverture.onerror = () => resoudre([]);
    ouverture.onsuccess = () => {
      const db = ouverture.result;
      if (!db.objectStoreNames.contains(magasin)) return resoudre([]);
      const tout = db.transaction(magasin, 'readonly').objectStore(magasin).getAll();
      tout.onsuccess = () => resoudre(tout.result as EnregistrementSession[]);
      tout.onerror = () => resoudre([]);
    };
  }), [BASE_SESSION, MAGASIN_SESSION] as const);
}

function ecrireLaSession(page: Page, records: EnregistrementSession[]): Promise<void> {
  return page.evaluate(([base, magasin, lignes]) => new Promise<void>((resoudre, rejeter) => {
    const ouverture = indexedDB.open(base);
    // ⚠️ `onupgradeneeded` EST OBLIGATOIRE ICI. Sur un contexte neuf la base
    // n'existe pas encore : sans créer le magasin nous-mêmes, la transaction
    // ci-dessous échoue et la session ne s'écrit jamais — en silence.
    ouverture.onupgradeneeded = () => {
      const db = ouverture.result;
      if (!db.objectStoreNames.contains(magasin)) db.createObjectStore(magasin, { keyPath: 'fbase_key' });
    };
    ouverture.onerror = () => rejeter(new Error('indexedDB.open a échoué'));
    ouverture.onsuccess = () => {
      const db = ouverture.result;
      if (!db.objectStoreNames.contains(magasin)) return rejeter(new Error('magasin absent'));
      const tx = db.transaction(magasin, 'readwrite');
      for (const ligne of lignes) tx.objectStore(magasin).put(ligne);
      tx.oncomplete = () => resoudre();
      tx.onerror = () => rejeter(new Error('écriture de session refusée'));
    };
  }), [BASE_SESSION, MAGASIN_SESSION, records] as const);
}

/** ⚠️ UNE SEULE VRAIE CONNEXION PAR COMPTE, POUR TOUTE LA CAMPAGNE (FRE-164).
 *
 *  Le geste de connexion était le seul point instable du harnais : 10 specs sur
 *  71 rouges le 09/09, toutes sur la popup de l'émulateur, aucune sur une
 *  assertion métier. Rejouées en isolé, elles repassaient au vert — ce n'est
 *  pas un sous-ensemble de specs fragiles, c'est le geste lui-même, répété
 *  soixante-douze fois.
 *
 *  ⚠️ ET CE QU'ON RÉPÉTAIT N'EST PAS DU PRODUIT. La popup de l'émulateur est un
 *  écran de choix de compte qui remplace celui de Google : la cliquer éprouve
 *  l'UI d'un DOUBLE de test. Ce que le produit fait, lui — `signInWithPopup`,
 *  le jeton qui revient, `onAuthStateChanged`, l'en-tête `Authorization` —
 *  reste traversé À CHAQUE PREMIÈRE connexion de chaque compte.
 *
 *  Le cache ne remplace donc pas la voie réelle, il arrête de la répéter : 4
 *  connexions au lieu de 72. Une connexion cassée reste rouge, une seule fois
 *  et bruyamment, au lieu de rougir au hasard dans dix specs sans rapport. */
const SESSIONS = new Map<string, EnregistrementSession[]>();

/** Connexion réelle : l'app appelle `signInWithPopup`, l'émulateur sert son
 *  écran de choix de compte, on clique le compte de test.
 *
 *  On passe par la popup et non par une session injectée : c'est le chemin que
 *  l'app emprunte vraiment — `signInWithPopup` → `currentUser.getIdToken()` →
 *  en-tête `Authorization` → `verify_id_token`. Injecter une session testerait
 *  notre injection, pas le produit. */
export async function seConnecter(page: Page, compte: { email: string } = COACH): Promise<void> {
  const enCache = SESSIONS.get(compte.email);
  if (enCache?.length && await rejouerLaSession(page, compte, enCache)) return;

  await page.goto('/');
  // Le clic peut partir AVANT que le SDK Firebase n'ait fini de s'initialiser :
  // `signInWithPopup` n'est alors pas appelé et aucune popup ne vient. On
  // re-clique tant qu'elle n'apparaît pas, plutôt que d'attendre 30 s un
  // événement qui ne viendra jamais.
  let p: Page | null = null;
  for (let essai = 0; essai < 4 && !p; essai++) {
    const popup = page.waitForEvent('popup', { timeout: 4000 }).catch(() => null);
    await page.getByRole('button', { name: /connexion|connecter|sign in|google/i }).first().click();
    p = await popup;
  }
  if (!p) throw new Error('la popup de connexion n’est jamais venue (4 essais)');
  await p.waitForLoadState();

  // ⚠️ LE CLIC PEUT TOMBER DANS LE VIDE, et c'était LA cause du flaky (FRE-61).
  // `waitForLoadState()` attend les ressources, pas que le script de l'émulateur
  // ait attaché ses gestionnaires : la ligne du compte est visible et cliquable,
  // Playwright rend la main, et rien ne se passe.
  //
  // Le signal fiable n'est pas « j'ai cliqué » mais « la popup s'est FERMÉE » :
  // c'est ce que fait l'émulateur quand il a rendu son jeton. On reclique tant
  // qu'elle est ouverte — un clic de trop sur une popup déjà partie est sans
  // effet, un clic manquant coûte la campagne.
  //
  // ⚠️ LE BUDGET DE CETTE BOUCLE EST SERRÉ, ET C'EST DÉLIBÉRÉ. La première version
  // laissait 5 tentatives à 5 s : 25 s ici, plus 15 s d'attente ensuite, soit 40 s
  // pour un test qui expire à 30. Elle transformait donc un flaky en DÉPASSEMENT —
  // un échec plus lent, et qui ne dit plus rien puisque la page est déjà morte
  // quand le diagnostic s'exécute. 4 × 2 s laissent 22 s au total, sous la limite.
  for (let essai = 0; essai < 4 && !p.isClosed(); essai++) {
    await p.getByText(compte.email).first().click({ timeout: 1500 }).catch(() => {});
    if (p.isClosed()) break;
    await p.waitForEvent('close', { timeout: 500 }).catch(() => null);
  }

  await attendreLApp(page, compte, p);

  // ⚠️ ON NE GARDE QUE CE QUI A MARCHÉ. La lecture vient APRÈS l'attente : une
  // session capturée avant que l'app ne confirme serait un cache empoisonné,
  // rejoué par toutes les specs suivantes du même compte.
  SESSIONS.set(compte.email, await lireLaSession(page));
}

/** Rejoue une session capturée. Rend `false` si elle n'a pas pris — l'appelant
 *  repart alors sur la vraie popup.
 *
 *  ⚠️ ON ATTEND L'ÉCRAN DE CONNEXION AVANT D'ÉCRIRE, et c'est tout le correctif.
 *  Au chargement, Firebase lit IndexedDB, ne trouve personne, et EFFACE la clé
 *  en se résolvant « déconnecté ». Écrire pendant ce ménage se faisait balayer :
 *  la première version passait 62 specs sur 72 et en perdait 10, toutes avec
 *  « session : NON » — le même chiffre que le flaky qu'elle venait corriger.
 *  L'écran de connexion visible est le signal que Firebase a fini.
 *
 *  ⚠️ ET LE REPLI EST CE QUI REND LE CACHE SÛR. Un cache qui échoue rendrait le
 *  harnais PIRE que sans lui — on remplacerait un flaky par un autre. Ici il ne
 *  peut que faire gagner du temps : s'il rate, la voie réelle reprend la main et
 *  la spec ne le sait même pas.
 *
 *  ⚠️ IndexedDB EST CLOISONNÉ PAR ORIGINE : on charge l'app d'abord, sinon on
 *  écrirait dans la base d'une autre origine et l'app ne verrait rien. */
async function rejouerLaSession(
  page: Page, compte: { email: string }, session: EnregistrementSession[],
): Promise<boolean> {
  await page.goto('/');
  const bouton = page.getByRole('button', { name: /connexion|connecter|sign in|google/i }).first();
  await bouton.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await ecrireLaSession(page, session).catch(() => {});
  await page.reload();
  try {
    await expect(entree(page)).toBeVisible({ timeout: 10_000 });
    return true;
  } catch {
    // Le rejeu a raté — on efface le cache pour ce compte plutôt que de le
    // rejouer en boucle, et l'appelant repart sur la popup.
    SESSIONS.delete(compte.email);
    return false;
  }
}

/** LE SIGNE QUE L'APP EST ENTRÉE : le bouton « Déconnexion » de la sidebar.
 *
 *  ⚠️ PAS LE LIEN « ENTRAÎNEMENT ». Il l'était jusqu'au 12/09 : depuis le
 *  guichet, un coach atterrit sur `/guichet`, où ce lien n'existe pas (il
 *  appartient à l'espace athlète), et l'athlète atterrit toujours sur son
 *  tableau de bord. Le bouton de déconnexion est le seul repère commun aux deux
 *  atterrissages — et il n'apparaît qu'une fois l'utilisateur connu. */
const entree = (page: Page) => page.getByRole('button', { name: /Déconnexion|Log out/i }).first();

/** L'app est-elle entrée ? Et si non, POURQUOI — en trois mesures.
 *
 *  ⚠️ L'ÉCHEC DOIT PARLER. Ce point est le seul instable du harnais (FRE-61,
 *  FRE-164) : plusieurs campagnes l'ont vu rougir, jamais une assertion métier.
 *  Tant qu'on ne sait pas ce qui le fait tomber, il doit au moins dire ce qu'il
 *  a trouvé — sinon chaque occurrence recommence l'enquête à zéro.
 *
 *  ⚠️ ET LA PREMIÈRE DES TROIS MESURAIT LA MAUVAISE CHOSE. Elle comptait les
 *  clés `authUser` de `localStorage` ; la session vit dans IndexedDB (mesuré le
 *  10/09). Elle rendait donc « NON » sur une connexion PARFAITEMENT réussie, et
 *  ce faux négatif est cité tel quel dans FRE-164 comme s'il était une preuve. */
async function attendreLApp(page: Page, compte: { email: string }, popup: Page | null): Promise<void> {
  try {
    await expect(entree(page)).toBeVisible({ timeout: 15_000 });
  } catch (e) {
    const session = (await lireLaSession(page).catch(() => [])).length;
    const affiche = (await page.locator('body').innerText().catch(() => '?'))
      .replace(/\s+/g, ' ').slice(0, 200);
    // ⚠️ ET LE CONTENU DE LA POPUP, pas seulement son URL. Deux enquêtes ont
    // tourné court faute de savoir ce qu'elle montrait.
    const popupTexte = !popup ? '(pas de popup — session rejouée depuis le cache)'
      : popup.isClosed() ? '(fermée)'
      : (await popup.locator('body').innerText().catch(() => '?')).replace(/\s+/g, ' ').slice(0, 220);
    throw new Error(
      `connexion (${compte.email}) : le bouton Déconnexion n'est jamais apparu.\n`
      + `  session Firebase (IndexedDB) : ${session > 0 ? `OUI (${session} enregistrement(s))` : 'NON'}\n`
      + `  popup : ${!popup ? 'sans objet' : popup.isClosed() ? 'fermée' : `encore ouverte sur ${popup.url().slice(0, 80)}`}\n`
      + `  popup affiche : "${popupTexte}"\n`
      + `  écran : "${affiche}"\n`
      + `  (cause d'origine : ${(e as Error).message.split('\n')[0]})`,
    );
  }
}

/** Pose un macro AVEC une ligne nommée, par l'API.
 *
 *  Le décor se monte par le serveur, pas par l'interface : ces tests portent sur
 *  UN geste précis, et le faire précéder de dix clics de préparation les rendrait
 *  lents et fragiles — un test qui échoue dans son décor ne dit rien de ce qu'il
 *  prétend vérifier. */
/** Une S1 datée, pour les specs qui ajoutent une semaine (FRE-138). */
export const S1_DATEE = { debut: '2026-09-07', fin: '2026-09-13' };

export async function poserUnMacro(
  exercices: Record<string, unknown>[] = [{ name: 'SQUAT', sets: '5', reps: '3' }],
  options: {
    sessions?: Record<string, unknown>[]; sansSemaine?: boolean;
    /** Les dates de S1 dans la BASE. ⚠️ EXIGÉES pour ajouter une semaine depuis
     *  FRE-138 (« + Semaine » refuse en 409 `base_sans_dates`, comme la
     *  génération). Absentes par défaut : c'est l'état de 84 blocs réels. */
    datesDeS1?: { debut: string; fin: string };
    /** Le programme et le compte qui le pose — par défaut celui du coach de test. */
    programme?: string; compte?: { sub: string; email?: string };
  } = {},
): Promise<void> {
  const programme = options.programme ?? PROGRAMME;
  const compte = options.compte ?? COACH;
  const base = options.datesDeS1
    ? { base: { s1StartDate: options.datesDeS1.debut, s1EndDate: options.datesDeS1.fin } }
    : {};
  // ⚠️ `sansSemaine` REPRODUIT LE BLOC NEUF (22/08). Depuis que l'interface ne
  // crée plus de semaine 1 d'office, c'est l'état par lequel passe tout coach
  // qui compose une BASE — donc celui que les specs de génération doivent
  // partir. Le décor par défaut garde sa semaine : la plupart des specs ont
  // besoin d'un arbre déjà debout.
  if (options.sansSemaine) {
    const r = await fetch(`${BROKKR}/programs/${programme}/macros`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await jeton(compte)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ block: { ...base } }),
    });
    if (!r.ok) throw new Error(`POST /macros (sans semaine) → ${r.status}`);
    return;
  }
  const sessions = options.sessions ?? [{ name: 'Lundi', exercises: exercices }];
  const r = await fetch(`${BROKKR}/programs/${programme}/macros`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await jeton(compte)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ block: { ...base, week: { sessions } } }),
  });
  // Le CORPS du refus, pas seulement son code : un 422 muet a coûté une enquête.
  if (!r.ok) throw new Error(`POST /macros → ${r.status} ${await r.text()}`);
}

/** Pose la trame d'un bloc par l'API — le décor de la spec de génération.
 *  SANS dates S1, volontairement : c'est l'état de 54 blocs réels sur 125. */
export async function poserUneBase(blockId: string, base: Record<string, unknown>): Promise<void> {
  const r = await fetch(`${BROKKR}/programs/${PROGRAMME}/blocks/${blockId}/base`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${await jeton()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ base }),
  });
  if (!r.ok) throw new Error(`PUT /base → ${r.status}`);
}

/** PATCH direct par l'API, avec le compte qu'on veut — pour prouver un refus
 *  d'autorisation (403), ce que l'interface ne peut pas montrer : elle n'offre
 *  simplement pas le geste. Le périmètre, lui, est une règle SERVEUR. */
export async function patchBrut(
  compte: { sub: string; email: string }, chemin: string, corps: Record<string, unknown>,
  programme = PROGRAMME,
): Promise<number> {
  const r = await fetch(`${BROKKR}/programs/${programme}${chemin}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${await jeton(compte)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corps),
  });
  return r.status;
}

/** Pose un RÉALISÉ sur les lignes de la SEMAINE 1, par leur nom.
 *
 *  ⚠️ LA CRÉATION NE L'ACCEPTE PLUS (FRE-75, 21/08) : une charge réelle vit là où
 *  elle a été saisie, jamais dans ce qu'on crée — 37 lignes de production
 *  portaient une perf que personne n'avait faite. Les specs qui glissaient
 *  `weightDone` dans `poserUnMacro` s'en trouvaient donc silencieusement
 *  privées : le montage passait, l'assertion tombait.
 *
 *  Le réalisé se pose désormais comme un athlète le pose : par `PATCH` sur une
 *  ligne qui EXISTE. C'est plus fidèle, en plus d'être la seule voie ouverte. */
export async function poserDuRealise(
  parNom: Record<string, Record<string, unknown>>,
): Promise<void> {
  const { macros } = await arbre();
  const lignes = macros[0].blocks[0].weeks[0].sessions![0].exercises;
  for (const ligne of lignes) {
    const champs = parNom[String(ligne.name)];
    if (!champs) continue;
    const statut = await patchBrut(COACH, `/exercises/${String(ligne.id)}`, champs);
    if (statut !== 200) {
      throw new Error(`PATCH réalisé sur ${String(ligne.name)} → ${statut}`);
    }
  }
}

/** Les séries de chaque ligne, semaine par semaine — de quoi dire d'un coup
 *  d'œil si une frappe a atterri au bon endroit. */
export async function seriesParSemaine(): Promise<string[][]> {
  const { macros } = await arbre();
  return macros[0].blocks[0].weeks.map(
    w => (w.sessions?.[0]?.exercises ?? []).map(e => (e as { sets?: string }).sets ?? ''));
}

/** Le mode ÉDITION du coach — le cadenas, les champs de saisie et les boutons
 *  d'ajout n'existent que là. */
export async function modeCoach(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
}
