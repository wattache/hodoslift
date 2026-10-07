import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { mockLibrary, mockResolve } from '@/api/mock';
import type { Library, LibraryCategory, LibraryEntryPatch } from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';
import { useSlugCourant } from '@/api/hooks/use-structure-choisie';

const isMock = !isFirebaseConfigured;

/** `?structure=` — la bibliothèque est PAR STRUCTURE depuis le 19/09. */
const dans = (slug: string | null) => (slug ? `?structure=${encodeURIComponent(slug)}` : '');

/** La bibliothèque de la structure sélectionnée (FRE-13, 19/09).
 *
 *  ⚠️ C'EST AUSSI CELLE DE L'ATHLÈTE AFFICHÉ : les listes d'athlètes sont bornées
 *  à la structure (`?structure=`), donc on ne programme jamais un athlète d'une
 *  autre structure que celle dont on lit la bibliothèque — et c'est dans CELLE-
 *  LÀ que brokkr cherche les noms (la clé étrangère porte la structure). */
export function useLibrary() {
  const { slug, pret } = useSlugCourant();
  return useQuery<Library>({
    queryKey: ['library', slug],
    queryFn: () => (isMock ? mockResolve(mockLibrary) : api.get<Library>(`/library${dans(slug)}`)),
    enabled: pret,
    staleTime: 5 * 60_000,
  });
}

/** ⚠️ LE SEUL CORPS D'ÉCRITURE QUI RESTE NON TYPÉ (FRE-144), et la raison n'est
 *  pas un oubli. `LibraryEntryCreate` existe, mais `openapi-typescript` promeut
 *  en OBLIGATOIRE tout champ portant un défaut serveur — juste pour une réponse,
 *  faux pour un corps de requête. `competition` (défaut `false`) tombe dans ce
 *  cas, alors que le front l'omet volontairement hors de la catégorie
 *  « exercices » (cf. `views/library.tsx`), la base ne le portant que là. Le
 *  poser aurait obligé soit à élargir le type, soit à changer ce qui part sur le
 *  fil pour satisfaire le compilateur — deux façons de faire mentir la vérif. */
export function useCreateLibraryEntry() {
  const qc = useQueryClient();
  // Dans la bibliothèque de la structure sélectionnée — brokkr refuse celle
  // d'une structure où l'on ne coache pas.
  const { slug } = useSlugCourant();
  return useMutation({
    mutationFn: (input: { category: LibraryCategory; name: string; competition?: boolean; supports?: string[] }) =>
      isMock ? mockResolve({ id: 'mock-entry' })
             : api.post<{ id: string }, typeof input>(`/library/entries${dans(slug)}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['library'] }),
  });
}

export function usePatchLibraryEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: LibraryEntryPatch }) =>
      isMock ? mockResolve({ ok: true, id }) : api.patch<unknown, LibraryEntryPatch>(`/library/entries/${id}`, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['library'] }),
  });
}
