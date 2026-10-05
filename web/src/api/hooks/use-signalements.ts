import { useQuery } from '@tanstack/react-query';

import { api } from '@/api/client';
import { mockResolve, mockSignalements } from '@/api/mock';
import { isFirebaseConfigured } from '@/firebase';
import type { Signalement } from '@/api/types';

const isMock = !isFirebaseConfigured;

/** GET /athletes/signalements — ce que MES athlètes ont rapporté, tous confondus.
 *
 *  Une route et pas un appel par athlète : la question « qui va mal en ce
 *  moment ? » se répond en une requête côté serveur, et le tri chronologique en
 *  fait partie. Rassembler ça côté client demanderait N appels puis un tri, pour
 *  le même résultat en plus lent.
 *
 *  Aucun paramètre d'athlète : c'est le LIEN (`coach_uid` / `kine_uid`) qui
 *  décide, donc quiconque ne staffe personne reçoit une liste vide. */
export function useSignalements(jours = 30) {
  return useQuery<Signalement[]>({
    queryKey: ['signalements', jours],
    queryFn: () => {
      if (isMock) return mockResolve(mockSignalements);
      return api.get<Signalement[]>(`/athletes/signalements?jours=${jours}`);
    },
    staleTime: 30_000,
  });
}
