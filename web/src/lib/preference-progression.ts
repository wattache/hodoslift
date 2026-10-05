import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/api/client';
import { useMe } from '@/api/hooks/use-me';
import { mockResolve } from '@/api/mock';
import type { Me, Preferences, PreferencesPatch, RenduProgression } from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';

/** LE RENDU DE LA PROGRESSION, AU CHOIX DE CHACUN (brief progression, 27/09).
 *
 *  UNE préférence d'AFFICHAGE par personne, vue partout — dans ses séances,
 *  chez ses athlètes, dans la BASE (William, 28/09 : « plus de distinction »).
 *  Elle suit la personne qui regarde, pas l'athlète regardé.
 *
 *  ⚠️ BROKKR PORTE LA PRÉFÉRENCE, `localStorage` NE FAIT QUE L'AVANCER : elle
 *  doit suivre la personne d'un appareil à l'autre. Le disque local sert de
 *  repli hors ligne et évite un rendu qui saute pendant que `me` se charge. */

export const RENDUS = ['courbe', 'chiffres'] as const satisfies readonly RenduProgression[];
export const RENDUS_AU_CHOIX: readonly RenduProgression[] = RENDUS;

/** ⚠️ `courbe` PAR DÉFAUT : la carte telle qu'elle est. Sans préférence,
 *  personne ne voit rien changer — le choix reste un choix. */
export const RENDU_PAR_DEFAUT: RenduProgression = 'courbe';

export const estUnRendu = (v: unknown): v is RenduProgression => (RENDUS as readonly unknown[]).includes(v);

const CLE = 'eitri-progression';

function luSurLeDisque(): RenduProgression | null {
  try {
    const v = localStorage.getItem(CLE);
    return estUnRendu(v) ? v : null;
  } catch { return null; }
}

function poserSurLeDisque(rendu: RenduProgression) {
  try { localStorage.setItem(CLE, rendu); } catch { /* privé, plein : le serveur porte */ }
}

/** Le rendu retenu : brokkr d'abord, le disque en repli, le défaut sinon.
 *  Ordre STABLE : le disque ne l'emporte jamais sur ce que le serveur dit. */
export function renduRetenu(me: Me | undefined): RenduProgression {
  const serveur = me?.preferences?.progression;
  if (estUnRendu(serveur)) return serveur;
  return luSurLeDisque() ?? RENDU_PAR_DEFAUT;
}

/** Où en est l'écriture : `enregistre` une fois que brokkr a répondu, `echec`
 *  si le réseau manque — la préférence est alors sur cet appareil seulement. */
export type EtatDeLaPreference = 'repos' | 'enregistrement' | 'enregistre' | 'echec';

export function usePreferenceProgression(): {
  rendu: RenduProgression; choisir: (rendu: RenduProgression) => void; etat: EtatDeLaPreference;
} {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const { mutate, status } = useMutation({
    mutationFn: (patch: PreferencesPatch) =>
      isFirebaseConfigured ? api.patch<Preferences, PreferencesPatch>('/users/me/preferences', patch)
                           : mockResolve<Preferences>({ progression: patch.progression ?? null }),
    // Le cache `me` prend la réponse : la même valeur partout, sans re-lecture.
    onSuccess: (preferences) => {
      qc.setQueryData<Me>(['me'], (ancien) => ancien ? { ...ancien, preferences: { ...ancien.preferences, ...preferences } } : ancien);
    },
  });
  const choisir = useCallback((rendu: RenduProgression) => {
    poserSurLeDisque(rendu);
    // Optimiste : le dessin change sous le doigt, la réponse confirme.
    qc.setQueryData<Me>(['me'], (ancien) => ancien ? { ...ancien, preferences: { ...ancien.preferences, progression: rendu } } : ancien);
    mutate({ progression: rendu });
  }, [mutate, qc]);
  return { rendu: renduRetenu(me), choisir, etat: status === 'pending' ? 'enregistrement' : status === 'success' ? 'enregistre' : status === 'error' ? 'echec' : 'repos' };
}
