import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appel, bibliotheque } from '@/api/connect';
import { gestesDuPatch, versCreation, versLibrary, type EntreeACreer } from '@/api/bibliotheque';
import { mockLibrary, mockResolve } from '@/api/mock';
import type { Library, LibraryEntryPatch } from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';
import { useSlugCourant } from '@/api/hooks/use-structure-choisie';

const isMock = !isFirebaseConfigured;

/** La bibliothèque de la structure sélectionnée (FRE-13, 19/09) — servie par
 *  SINDRI (Connect), premier domaine sorti de brokkr.
 *
 *  ⚠️ C'EST AUSSI CELLE DE L'ATHLÈTE AFFICHÉ : les listes d'athlètes sont bornées
 *  à la structure, donc on ne programme jamais un athlète d'une autre structure
 *  que celle dont on lit la bibliothèque — et c'est dans CELLE-LÀ que le serveur
 *  cherche les noms (la clé étrangère porte la structure). */
export function useLibrary() {
  const { slug, pret } = useSlugCourant();
  return useQuery<Library>({
    queryKey: ['library', slug],
    queryFn: () => (isMock
      ? mockResolve(mockLibrary)
      : appel(() => bibliotheque.lireBibliotheque({ structure: slug ?? undefined })).then(versLibrary)),
    enabled: pret,
    staleTime: 5 * 60_000,
  });
}

export function useCreateLibraryEntry() {
  const qc = useQueryClient();
  // Dans la bibliothèque de la structure sélectionnée — le serveur refuse
  // celle d'une structure où l'on ne coache pas.
  const { slug } = useSlugCourant();
  return useMutation({
    mutationFn: (input: EntreeACreer) =>
      isMock ? mockResolve({ id: 'mock-entry' })
             : appel(() => bibliotheque.creerEntree(versCreation(input, slug))).then(r => ({ id: r.id })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['library'] }),
  });
}

/** Un `patch` devient un à trois gestes du contrat (renommer, marquer,
 *  définir les soutiens), joués dans l'ordre ; le premier refus arrête. */
export function usePatchLibraryEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: LibraryEntryPatch }) => {
      if (isMock) return mockResolve({ ok: true, id });
      for (const g of gestesDuPatch(patch)) {
        await appel((): Promise<unknown> => {
          switch (g.geste) {
            case 'renommer': return bibliotheque.renommerEntree({ id, name: g.name });
            case 'marquer': return bibliotheque.marquerCompetition({ id, competition: g.competition });
            case 'soutiens': return bibliotheque.definirSupports({ id, supports: g.supports });
          }
        });
      }
      return { ok: true, id };
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['library'] }),
  });
}
