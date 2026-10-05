import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { mockResolve, mockUsers } from '@/api/mock';
import type { Kine, UserCoachSet, UserKineSet, UserRow } from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';
import { useSlugCourant } from '@/api/hooks/use-structure-choisie';

const isMock = !isFirebaseConfigured;

/** Tous les comptes — admin only (403 sinon).
 *
 *  ⚠️ PAS BORNÉ À LA STRUCTURE, ET C'EST VOULU (William, 19/09) : l'écran Admin
 *  n'y trie personne, il affiche chacun avec son contexte — « coache chez
 *  SCAPPULIFT », « athlète chez French Forge ». Un athlète d'une autre structure
 *  reste trouvable ; la borne le ferait disparaître. */
export function useUsers(enabled: boolean) {
  return useQuery<UserRow[]>({
    queryKey: ['users'],
    queryFn: () => (isMock ? mockResolve(mockUsers) : api.get<UserRow[]>('/users')),
    enabled,
    staleTime: 60_000,
  });
}

/** GET /kines — les kinés déclarés, pour le sélecteur « Suivi kiné » (coach). */
export function useKines(enabled: boolean) {
  // Le slug dans la clé (FRE-13) : brokkr borne aux kinés de la structure du
  // coach ; un coach qui change de structure ne doit pas relire l'autre liste.
  const { slug, pret } = useSlugCourant();
  return useQuery<Kine[]>({
    queryKey: ['kines', slug],
    queryFn: () => (isMock ? mockResolve([]) : api.get<Kine[]>('/kines')),
    enabled: enabled && pret,
    staleTime: 60_000,
  });
}

/** PUT /users/{uid}/kine — déclare/retire un kiné (admin). Le retrait d'un kiné
 *  qui suit encore des athlètes rend 409 : « détache d'abord ses athlètes ». */
export function useSetUserKine() {
  const qc = useQueryClient();
  return useMutation({
    // `structure` : celle où il EXERCE (FRE-13), à la promotion.
    mutationFn: ({ uid, isKine, structure }: { uid: string; isKine: boolean; structure?: string }) =>
      isMock ? mockResolve({ ok: true, isKine })
             : api.put<unknown, UserKineSet>(`/users/${uid}/kine`, structure ? { isKine, structure } : { isKine }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      void qc.invalidateQueries({ queryKey: ['kines'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

/** PUT /users/{uid}/coach — promeut/rétrograde un coach (admin). */
export function useSetUserCoach() {
  const qc = useQueryClient();
  return useMutation({
    // `structure` : celle où il COACHE (FRE-13), à la promotion.
    mutationFn: ({ uid, isCoach, structure }: { uid: string; isCoach: boolean; structure?: string }) =>
      isMock ? mockResolve({ ok: true, isCoach })
             : api.put<unknown, UserCoachSet>(`/users/${uid}/coach`, structure ? { isCoach, structure } : { isCoach }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}
