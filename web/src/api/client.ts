/** Client HTTP brokkr — l'UNIQUE porte d'accès aux données.
 *
 *  - Ajoute l'ID token Firebase (Authorization: Bearer).
 *  - Erreurs typées (ApiError avec status, detail, et CODE machine — FRE-40).
 *  - En mode dev-mock (Firebase non configuré), les hooks n'appellent pas ce
 *    client : ils servent les fixtures de `api/mock.ts` (même contrat).
 */
import type { components } from '@/api/brokkr.gen';
import { auth } from '@/firebase';
import { signalerPanneReseau, signalerReseauRevenu } from '@/lib/reseau';

/** Le vocabulaire CLOS des erreurs serveur, engendré depuis l'OpenAPI.
 *
 *  ⚠️ C'EST CE QUI REND LE BRANCHEMENT VÉRIFIABLE. Tester `code === 'slug_pris'`
 *  (au lieu de `slug_deja_pris`) ne compile pas, et un code retiré côté serveur
 *  fait rougir le front au lieu de laisser une branche morte. */
export type CodeErreur = components['schemas']['Erreur']['code'];

const BASE_URL = (import.meta.env.VITE_BROKKR_URL ?? '').replace(/\/$/, '');

export const isApiConfigured = Boolean(BASE_URL);

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;
  /** ⚠️ LE CODE EST CE SUR QUOI ON DÉCIDE, `detail` ce qu'on montre au support.
   *
   *  Avant FRE-40, seul le statut était exploitable : les SIX 409 du serveur
   *  arrivaient indiscernables, et l'interface ne pouvait que dire « refusé » en
   *  recopiant une phrase française — intraduisible, alors que l'app tourne en
   *  trois langues.
   *
   *  Facultatif parce que deux erreurs ne viennent PAS du serveur : la requête
   *  qui n'est jamais partie (hors-ligne) et l'absence de configuration. Elles
   *  n'ont pas de code, et c'est exact — leur donner un code inventé effacerait
   *  la seule distinction qui compte ici : le serveur a-t-il répondu ? */
  readonly code?: CodeErreur;

  constructor(status: number, detail: string, code?: CodeErreur) {
    super(`[brokkr] ${status}${code ? ` ${code}` : ''} — ${detail}`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.code = code;
  }
}

/** Une réponse d'échec, lue sous la forme UNIQUE que brokkr sert (FRE-40).
 *
 *  ⚠️ UN SEUL ENDROIT, et c'est le sujet. Le corps était démonté à deux endroits,
 *  chacun gérant `detail` en chaîne OU en tableau — l'ancienne sortie de FastAPI
 *  changeait de forme selon la source. Le serveur aplatit désormais lui-même, et
 *  range la structure de validation dans `champs`.
 *
 *  Le repli sur `statusText` reste : un corps non-JSON veut dire que la réponse
 *  ne vient pas de brokkr — un proxy, une passerelle. Mieux vaut le dire mal que
 *  prétendre l'avoir compris. */
async function erreurDe(res: Response): Promise<ApiError> {
  try {
    const corps = await res.json();
    if (typeof corps?.detail === 'string') {
      return new ApiError(res.status, corps.detail, corps.code);
    }
  } catch {
    /* corps non-JSON : voir ci-dessus */
  }
  return new ApiError(res.status, res.statusText);
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new ApiError(401, 'utilisateur non connecté (pas de token Firebase)');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!BASE_URL) throw new ApiError(0, 'VITE_BROKKR_URL non configurée');
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: await authHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    // ⚠️ LA REQUÊTE N'EST JAMAIS PARTIE — le jeton n'a pas pu se rafraîchir, ou
    // `fetch` a échoué. C'est la seule mesure fiable du réseau (`lib/reseau`).
    if (!(e instanceof ApiError)) signalerPanneReseau();
    throw e;
  }
  signalerReseauRevenu();
  if (!res.ok) {
    throw await erreurDe(res);
  }
  // 204 ou corps vide.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Envoi de FICHIER (multipart). Séparé de `request` pour une raison précise :
 *  il ne faut SURTOUT pas poser `Content-Type` soi-même. Le navigateur doit le
 *  générer, parce que lui seul connaît la frontière (`boundary=…`) qui sépare les
 *  parties du corps — la fixer à `multipart/form-data` sans elle rendrait le
 *  corps illisible côté serveur, et `application/json` (le défaut de `request`)
 *  le ferait échouer d'emblée. */
async function upload<T>(path: string, file: File, field = 'file'): Promise<T> {
  if (!BASE_URL) throw new ApiError(0, 'VITE_BROKKR_URL non configurée');
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new ApiError(401, 'utilisateur non connecté (pas de token Firebase)');

  const form = new FormData();
  form.append(field, file);

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }, // pas de Content-Type : cf. ci-dessus
    body: form,
  });
  if (!res.ok) throw await erreurDe(res);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** ⚠️ LE CORPS PORTE UN TYPE, ET IL DOIT ÊTRE NOMMÉ (FRE-144).
 *
 *  Les trois écritures prenaient un `body?: unknown` : le front pouvait donc
 *  envoyer n'importe quelle forme à des modèles qui, côté brokkr, sont tous en
 *  `extra="forbid"`. Une divergence ne se voyait qu'en 422, en production —
 *  c'est ainsi que `ris`/`risTotal` sont partis dans un `PUT /competitions`
 *  (FRE-92), et que toute la requête a été refusée.
 *
 *  ⚠️ `NoInfer` EST CE QUI REND LA RÈGLE EFFECTIVE, pas le défaut `never`. Sans
 *  lui, `TBody` s'INFÈRE de l'argument : `api.post<X>(path, corps)` continuerait
 *  de compiler en déduisant la forme du corps, c'est-à-dire en n'en vérifiant
 *  rien. Avec lui, l'argument n'est plus un site d'inférence : `TBody` retombe
 *  sur `never`, et un corps non nommé ne compile pas.
 *
 *  Corollaire voulu : `api.post<X>('/athletes/link')` — sans corps — reste
 *  parfaitement légal, `never` étant seulement inhabitable, pas interdit. */
export const api = {
  upload,
  get: <T>(path: string) => request<T>('GET', path),
  post: <TRes, TBody = never>(path: string, body?: NoInfer<TBody>) => request<TRes>('POST', path, body),
  put: <TRes, TBody = never>(path: string, body?: NoInfer<TBody>) => request<TRes>('PUT', path, body),
  patch: <TRes, TBody = never>(path: string, body?: NoInfer<TBody>) => request<TRes>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
