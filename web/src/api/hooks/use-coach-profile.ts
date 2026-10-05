import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { mockCoachProfile, mockResolve } from '@/api/mock';
import type { CoachProfile, CoachProfilePatch } from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';
import { useAuth } from '@/auth/auth-context';

/** Profil public d'un coach (FRE-30) — édité ici, lu par le site vitrine.
 *
 *  Ce que le coach peut écrire tient en trois champs : accroche, bio, Instagram.
 *  `photoUrl` est posée par l'endpoint d'upload et `oneRm` est une projection
 *  nocturne de la Table RM — les rendre éditables serait proposer une écriture
 *  que brokkr refuse. La frontière vit ici, dans l'adapter, pas dans la vue. */

const KEY = ['coach-profile', 'me'] as const;

/** Profil du coach CONNECTÉ. `null` s'il n'en a pas encore (404 côté serveur) :
 *  c'est un état normal, pas une erreur — la vue affiche alors un formulaire de
 *  création. Distinguer les deux évite d'afficher « une erreur est survenue » à
 *  un coach qui n'a simplement jamais rempli sa page. */
export function useMyCoachProfile() {
  const { user, devMode } = useAuth();
  return useQuery<CoachProfile | null>({
    queryKey: KEY,
    queryFn: async () => {
      if (!isFirebaseConfigured) return mockResolve(mockCoachProfile);
      try {
        return await api.get<CoachProfile>('/coach-profiles/me');
      } catch (err) {
        if ((err as { status?: number }).status === 404) return null;
        throw err;
      }
    },
    enabled: devMode || Boolean(user),
  });
}

export function usePatchMyCoachProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: CoachProfilePatch) =>
      isFirebaseConfigured
        ? api.patch<{ ok: boolean; slug: string }, CoachProfilePatch>('/coach-profiles/me', patch)
        : mockResolve({ ok: true, slug: patch.slug ?? mockCoachProfile.slug }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Téléverse la photo. brokkr écrit dans le bucket public et renvoie l'URL.
 *
 *  ⚠️ L'URL de l'objet ne change JAMAIS (`<slug>/profil.png` est écrasé) : le
 *  navigateur resservirait donc l'ancienne image depuis son cache, et le coach
 *  croirait l'envoi raté. On invalide le profil ET on laisse la vue casser le
 *  cache à l'affichage. */
export function useUploadMyCoachPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) =>
      isFirebaseConfigured
        ? api.upload<{ ok: boolean; photoUrl: string }>('/coach-profiles/me/photo', file)
        : mockResolve({ ok: true, photoUrl: mockCoachProfile.photoUrl ?? '' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
