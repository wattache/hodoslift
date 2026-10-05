import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { ApiError } from '@/api/client';
import { mockGoals, mockResolve } from '@/api/mock';
import type { Goal, GoalsLus, GoalsReplace } from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';

const isMock = !isFirebaseConfigured;

const cle = (athleteId: string | null | undefined) => ['goals', athleteId] as const;

/** ⚠️ LE CACHE PORTE LA LISTE **ET** SA VERSION (FRE-134), et c'est ce qui rend
 *  la garde serveur utilisable sans la faire remonter dans chaque écran.
 *
 *  Le `PUT` remplace la liste entière : brokkr exige donc la version qu'on
 *  croyait remplacer, et refuse (409 `objectifs_perimes`) si la base a bougé
 *  depuis. Cette version ne concerne QUE la paire lecture/écriture — la faire
 *  transiter par le composant l'obligerait à la stocker, à la passer, et à ne
 *  pas l'oublier. Elle reste ici, dans l'entrée de cache qu'elle date. */
export function useGoalsLus(athleteId: string | null | undefined) {
  return useQuery<GoalsLus>({
    queryKey: cle(athleteId),
    queryFn: () =>
      isMock
        ? mockResolve({ goals: mockGoals, version: 'mock' })
        : api.get<GoalsLus>(`/athletes/${athleteId}/goals`),
    enabled: Boolean(athleteId),
    staleTime: 60_000,
  });
}

/** La liste seule — ce dont les écrans ont besoin. */
export function useGoals(athleteId: string | null | undefined) {
  const { data, ...reste } = useGoalsLus(athleteId);
  return { ...reste, data: data?.goals };
}

/** PUT — remplacement complet de la liste (ajout/suppression/réordonnancement
 *  en un appel, sémantique historique du front). */
export function useReplaceGoals(athleteId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (goals: Goal[]) => {
      if (isMock) return mockResolve({ ok: true, count: goals.length });
      const version = qc.getQueryData<GoalsLus>(cle(athleteId))?.version;
      // ⚠️ ÉCRIRE SANS AVOIR LU EST PRÉCISÉMENT LE GESTE QU'ON FERME. Envoyer
      // une version bidon ferait un 409 illisible ; ne rien envoyer, un 422 de
      // contrat. On refuse ici, avec la seule phrase qui dit quoi faire.
      if (!version) throw new ApiError(0, 'objectifs pas encore chargés — recharger la page');
      return api.put<unknown, GoalsReplace>(`/athletes/${athleteId}/goals`, { goals, version });
    },
    // ⚠️ INVALIDER MÊME EN ÉCHEC, et c'est le cas du 409 qui l'impose : la
    // liste a bougé sous nos pieds, donc celle qu'on affiche est FAUSSE. Sans
    // ce refetch, l'utilisateur relirait son propre état périmé, réessaierait,
    // et récolterait le même refus — une garde dont on ne peut pas sortir.
    onSettled: () => void qc.invalidateQueries({ queryKey: cle(athleteId) }),
  });
}
