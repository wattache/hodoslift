import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { mockMe, mockResolve } from '@/api/mock';
import type { Me } from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';
import { useAuth } from '@/auth/auth-context';
import { PEREMPTION_HORS_LIGNE_MS } from '@/lib/persistance-hors-ligne';
import { structureCourante, useSlugRetenu, vuDepuis } from '@/lib/structure';

/** Profil de l'utilisateur connecté — GET /users/me (get-or-create serveur).
 *
 *  ⚠️ VU DEPUIS LA STRUCTURE SÉLECTIONNÉE (FRE-13) : `isCoach`, `isKine` et
 *  `athleteId` sont ceux qu'il a LÀ (`lib/structure.ts`). Nico chez SCAPPULIFT
 *  est coach sans fiche ; chez French Forge, athlète sans rôle. Le cache garde
 *  la réponse brute — c'est `select` qui applique, donc changer de structure ne
 *  refait aucun appel. */
export function useMe() {
  const { user, devMode } = useAuth();
  const retenue = useSlugRetenu();
  const select = useCallback((me: Me) => vuDepuis(me, structureCourante(me.structures, retenue)), [retenue]);
  return useQuery<Me, Error, Me>({
    select,
    queryKey: ['me'],
    queryFn: () => (isFirebaseConfigured ? api.get<Me>('/users/me') : mockResolve(mockMe)),
    enabled: devMode || Boolean(user),
    staleTime: 5 * 60_000,
    /** ⚠️ PERSISTÉ, DONC GARDÉ EN MÉMOIRE AUSSI LONGTEMPS (FRE-118). Le
     *  persister ne sauvegarde que ce qui est encore dans le cache ; ramassé au
     *  bout de 5 minutes, `me` disparaîtrait du disque et le gate arrêterait
     *  l'athlète hors ligne sur « pas de connexion » — avec sa séance à côté,
     *  sur le même disque, inatteignable. */
    gcTime: PEREMPTION_HORS_LIGNE_MS,
  });
}
