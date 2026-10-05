import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { mockResolve, mockTracking } from '@/api/mock';
import type { TrackingResponse } from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';

const isMock = !isFirebaseConfigured;

/** Projection analytics `training_sets` (rebuild manuel côté brokkr). */
export function useTracking(athleteId: string | null | undefined, exercise?: string) {
  return useQuery<TrackingResponse>({
    queryKey: ['tracking', athleteId, exercise ?? null],
    queryFn: () =>
      isMock
        ? mockResolve(mockTracking)
        : api.get<TrackingResponse>(
            `/athletes/${athleteId}/tracking${exercise ? `?exercise=${encodeURIComponent(exercise)}` : ''}`,
          ),
    enabled: Boolean(athleteId),
    staleTime: 5 * 60_000,
    // ⚠️ CHANGER DE MOUVEMENT GARDE LE GRAPHE À L'ÉCRAN jusqu'à la réponse
    // (William, 17/09). Sans ça, la clé change, `data` retombe à `undefined`, le
    // graphe cède la place à « Chargement… » : la page raccourcit, le navigateur
    // remonte, et le sélecteur désactivé perd le focus. Pour le MÊME athlète
    // seulement — montrer le graphe d'un autre, même une seconde, serait faux.
    placeholderData: (precedent, requetePrecedente) =>
      requetePrecedente?.queryKey[1] === athleteId ? precedent : undefined,
  });
}
