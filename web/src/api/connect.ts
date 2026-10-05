/** Le transport Connect vers sindri, le frère de brokkr en Go.
 *
 *  Le contrat vit dans `proto/` à la racine du monorepo ; `src/gen/` en est la
 *  sortie engendrée (`make gen`). Ici : le jeton Firebase sur chaque appel, et
 *  la traduction des erreurs vers `ApiError`, pour que les vues n'aient qu'UNE
 *  forme d'erreur à lire pendant que les deux serveurs vivent côte à côte.
 *
 *  ⚠️ JSON sur le fil (`useBinaryFormat: false`, le défaut) : lisible dans
 *  l'onglet Réseau, et c'est un choix — rien ici n'est assez gros pour que le
 *  binaire compte. */

import { Code, ConnectError, createClient, type Interceptor } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { BibliothequeService } from '@/gen/hodos/bibliotheque/v1/bibliotheque_pb';
import { ErreurSchema } from '@/gen/hodos/socle/v1/erreur_pb';
import { ApiError, type CodeErreur } from '@/api/client';
import { auth } from '@/firebase';
import { signalerPanneReseau, signalerReseauRevenu } from '@/lib/reseau';

/** Une URL, ou `/` : la même origine que le front, routée par Caddy. */
const SINDRI_URL = (import.meta.env.VITE_SINDRI_URL ?? '').trim();

const porteur: Interceptor = next => async req => {
  if (!SINDRI_URL) throw new ApiError(0, 'VITE_SINDRI_URL non configurée');
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new ApiError(401, 'utilisateur non connecté (pas de token Firebase)');
  req.header.set('Authorization', `Bearer ${token}`);
  return next(req);
};

/** Le `fetch` du transport, qui dit au mode hors ligne si le réseau répond —
 *  la même mesure que `request` dans `client.ts` (`lib/reseau`). Un refus du
 *  serveur est une RÉPONSE, donc un réseau qui marche ; seule la requête qui ne
 *  part pas signale une panne. */
export const fetchMesure: typeof fetch = async (entree, init) => {
  let res: Response;
  try {
    res = await fetch(entree, init);
  } catch (e) {
    signalerPanneReseau();
    throw e;
  }
  signalerReseauRevenu();
  return res;
};

const transport = createConnectTransport({
  baseUrl: SINDRI_URL || 'http://sindri.invalide',
  interceptors: [porteur],
  fetch: fetchMesure,
});

export const bibliotheque = createClient(BibliothequeService, transport);

/** Le statut HTTP qu'un code Connect vaut, quand l'erreur ne porte pas le
 *  détail métier (réseau, serveur tombé…). */
const STATUT: Partial<Record<Code, number>> = {
  [Code.Unauthenticated]: 401,
  [Code.PermissionDenied]: 403,
  [Code.NotFound]: 404,
  [Code.AlreadyExists]: 409,
  [Code.InvalidArgument]: 422,
  [Code.Unavailable]: 503,
};

/** Traduit une erreur Connect en `ApiError` : le détail `Erreur{code, detail,
 *  status}` porte le mot du vocabulaire métier, le même que celui de brokkr. */
export function traduireErreur(e: unknown): never {
  if (e instanceof ConnectError) {
    const detail = e.findDetails(ErreurSchema)[0];
    if (detail) throw new ApiError(detail.status, detail.detail, detail.code as CodeErreur);
    throw new ApiError(STATUT[e.code] ?? 500, e.rawMessage);
  }
  throw e;
}

/** Un appel Connect dont les erreurs sortent en `ApiError`. */
export async function appel<T>(geste: () => Promise<T>): Promise<T> {
  try {
    return await geste();
  } catch (e) {
    return traduireErreur(e);
  }
}
