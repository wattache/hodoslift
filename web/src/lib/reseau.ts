import { useSyncExternalStore } from 'react';

/** LE RÉSEAU TEL QUE L'APP LE CONSTATE, pas tel que le navigateur le suppose.
 *
 *  ⚠️ `navigator.onLine` DIT « OUI » SUR UN WI-FI SANS INTERNET. C'est le cas
 *  d'Aubin le 25/09 : connecté à sa box, plus rien n'atteignait brokkr, et le
 *  navigateur n'a jamais émis `offline`. La seule mesure fiable est la dernière
 *  requête : partie et répondue, le réseau est là ; jamais partie, il n'y est
 *  pas. Le client HTTP le dit ici, et l'écran s'en sert pour ne proposer un
 *  geste que là où il peut aboutir.
 *
 *  Une panne constatée se lève à la première réponse reçue, ou quand le
 *  navigateur annonce `online` : c'est optimiste, et la requête suivante
 *  tranche. */

let enPanne = false;
const abonnes = new Set<() => void>();

function notifier(): void {
  for (const f of abonnes) f();
}

export function signalerPanneReseau(): void {
  if (enPanne) return;
  enPanne = true;
  notifier();
}

export function signalerReseauRevenu(): void {
  if (!enPanne) return;
  enPanne = false;
  notifier();
}

export function estEnLigne(): boolean {
  return (typeof navigator === 'undefined' || navigator.onLine) && !enPanne;
}

function abonner(f: () => void): () => void {
  abonnes.add(f);
  const revenu = () => { signalerReseauRevenu(); f(); };
  window.addEventListener('online', revenu);
  window.addEventListener('offline', f);
  return () => {
    abonnes.delete(f);
    window.removeEventListener('online', revenu);
    window.removeEventListener('offline', f);
  };
}

/** L'écran suit l'état du réseau : un bouton qui exige le serveur s'éteint
 *  quand il n'y en a pas. */
export function useEnLigne(): boolean {
  return useSyncExternalStore(abonner, estEnLigne, () => true);
}

/** Pour les tests : remet l'état à « rien constaté ». */
export function _reinitialiserPourTest(): void {
  enPanne = false;
}
