import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/api/client';
import { mockGuichet, mockGuichetRelire, mockGuichetVu, mockResolve } from '@/api/mock';
import { isFirebaseConfigured } from '@/firebase';
import type { Guichet } from '@/api/types';

const isMock = !isFirebaseConfigured;

/** GET /guichet — la file de travail du coach, en UNE réponse.
 *
 *  Une route et pas un appel par athlète : à trente-cinq athlètes, déduire côté
 *  client « qui a fini sa semaine » voudrait dire trente-cinq appels au
 *  chargement de l'écran d'accueil. La question se répond en requête côté
 *  serveur, et l'ORDRE en fait partie — douleurs, puis séances de la plus
 *  ancienne à la plus récente, puis semaines. L'écran affiche la file telle
 *  qu'elle arrive ; s'il l'improvisait, deux coachs ne verraient pas la même
 *  chose et « suivant » n'aurait plus de sens.
 *
 *  Aucun paramètre d'athlète : c'est le LIEN qui décide, donc quiconque ne
 *  staffe personne reçoit une file vide, sans erreur. */
export function useGuichet() {
  return useQuery<Guichet>({
    queryKey: ['guichet'],
    queryFn: () => (isMock ? mockResolve(mockGuichet()) : api.get<Guichet>('/guichet')),
    staleTime: 30_000,
  });
}

/** POST …/sessions/{id}/relecture — le coach COCHE qu'il a vu la séance.
 *  Idempotent côté serveur : recocher ne déplace pas la date. */
export function useMarquerRelue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ programId, sessionId }: { programId: string; sessionId: string }) =>
      isMock
        ? mockResolve(mockGuichetRelire(sessionId))
        : api.post<unknown, Record<string, never>>(`/programs/${programId}/sessions/${sessionId}/relecture`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['guichet'] }),
  });
}

/** POST /athletes/{id}/signalements/{date}/vu — la coche est PAR LECTEUR : le
 *  kiné qui coche ne vide pas la file du coach. */
export function useMarquerSignalementVu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ athleteId, date }: { athleteId: string; date: string }) =>
      isMock
        ? mockResolve(mockGuichetVu(athleteId, date))
        : api.post<unknown, Record<string, never>>(`/athletes/${athleteId}/signalements/${date}/vu`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['guichet'] }),
  });
}
