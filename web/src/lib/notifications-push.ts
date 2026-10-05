import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/api/client';
import { mockResolve } from '@/api/mock';
import type { AbonnementPush, ClePubliquePush, RetraitPush } from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';

/** LES NOTIFICATIONS PUSH — « me prévenir quand mon coach génère une semaine »
 *  (William, 28/09), activable depuis la page Profil.
 *
 *  ⚠️ UN ABONNEMENT EST PAR NAVIGATEUR, pas par personne : c'est le service de
 *  push du navigateur qui l'émet. Le réglage dit donc l'état de CET appareil,
 *  et brokkr en garde autant que la personne en a activé. Rien n'est stocké
 *  côté front : la vérité est `pushManager.getSubscription()`.
 *
 *  ⚠️ SUR iPHONE, SEULEMENT L'APP INSTALLÉE : Safari n'expose `PushManager` que
 *  dans une app posée sur l'écran d'accueil. Dans l'onglet, l'état est
 *  `indisponible`, et l'écran dit quoi faire. */

export type EtatPush =
  | 'chargement'      // on ne sait pas encore ce que l'appareil porte
  | 'sans-serveur'    // brokkr n'a pas de clé VAPID : rien à proposer
  | 'indisponible'    // le navigateur ne sait pas (Safari dans l'onglet, http, pas de worker)
  | 'refuse'          // la permission est bloquée dans le navigateur
  | 'inactif'
  | 'actif'
  | 'en-cours'
  | 'echec';

/** Ce que ce navigateur sait faire — lu une fois, hors de tout état. */
export function supporteLePush(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** La clé VAPID telle que brokkr la donne (base64url) vers ce que
 *  `pushManager.subscribe` exige (`Uint8Array`). */
export function cleEnOctets(base64url: string): Uint8Array<ArrayBuffer> {
  const complement = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + complement).replace(/-/g, '+').replace(/_/g, '/');
  const brut = atob(base64);
  const octets = new Uint8Array(new ArrayBuffer(brut.length));
  for (let i = 0; i < brut.length; i++) octets[i] = brut.charCodeAt(i);
  return octets;
}

/** L'état qui se déduit sans rien demander à l'appareil. */
export function etatDepuis({ supporte, clePublique, permission, abonne }: {
  supporte: boolean; clePublique: string | null | undefined; permission: NotificationPermission; abonne: boolean | undefined;
}): EtatPush {
  if (clePublique === undefined || abonne === undefined) return 'chargement';
  if (clePublique === null) return 'sans-serveur';
  if (!supporte) return 'indisponible';
  if (abonne) return 'actif';
  if (permission === 'denied') return 'refuse';
  return 'inactif';
}

async function enregistrement(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  // ⚠️ `getRegistration`, pas `ready` : sans worker (en local, ou s'il n'a pas
  // pu s'enregistrer), `ready` ne se résout jamais et l'écran resterait figé.
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export function useNotificationsPush(): { etat: EtatPush; activer: () => Promise<void>; desactiver: () => Promise<void> } {
  const supporte = supporteLePush();
  const { data: cle } = useQuery({
    queryKey: ['push-vapid'],
    queryFn: () => (isFirebaseConfigured ? api.get<ClePubliquePush>('/push/vapid') : mockResolve<ClePubliquePush>({ clePublique: 'mock' })),
    staleTime: Infinity,
  });
  const [abonne, setAbonne] = useState<boolean | undefined>(supporte ? undefined : false);
  const [geste, setGeste] = useState<'repos' | 'en-cours' | 'echec'>('repos');

  useEffect(() => {
    if (!supporte) return;
    let vivant = true;
    enregistrement()
      .then(r => r?.pushManager.getSubscription() ?? null)
      .then(s => { if (vivant) setAbonne(s !== null); })
      .catch(() => { if (vivant) setAbonne(false); });
    return () => { vivant = false; };
  }, [supporte]);

  const activer = useCallback(async () => {
    if (!cle?.clePublique) return;
    setGeste('en-cours');
    try {
      // Le geste de l'utilisateur d'abord : la permission ne se demande qu'ici.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setGeste('repos'); setAbonne(false); return; }
      const reg = await enregistrement();
      if (!reg) throw new Error('pas de service worker');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleEnOctets(cle.clePublique) });
      const json = sub.toJSON();
      const corps: AbonnementPush = { endpoint: json.endpoint ?? sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' } };
      if (isFirebaseConfigured) await api.post<unknown, AbonnementPush>('/users/me/push', corps);
      setAbonne(true);
      setGeste('repos');
    } catch {
      setGeste('echec');
    }
  }, [cle]);

  const desactiver = useCallback(async () => {
    setGeste('en-cours');
    try {
      const reg = await enregistrement();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        // brokkr d'abord : un abonnement retiré du navigateur mais encore en
        // base recevrait des envois vers un endpoint mort.
        if (isFirebaseConfigured) await api.post<unknown, RetraitPush>('/users/me/push/retrait', { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setAbonne(false);
      setGeste('repos');
    } catch {
      setGeste('echec');
    }
  }, []);

  const permission: NotificationPermission = supporte ? Notification.permission : 'default';
  const etat = geste === 'en-cours' ? 'en-cours' : geste === 'echec' ? 'echec'
    : etatDepuis({ supporte, clePublique: cle?.clePublique, permission, abonne });
  return { etat, activer, desactiver };
}
