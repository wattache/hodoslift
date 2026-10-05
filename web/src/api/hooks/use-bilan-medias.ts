import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/api/client';
import { mockMediasDemo, mockResolve } from '@/api/mock';
import type { MediaDemo } from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';

const isMock = !isFirebaseConfigured;

/** LE CATALOGUE DES MÉDIAS DE DÉMONSTRATION (FRE-99).
 *
 *  ⚠️ `staleTime` COURT MALGRÉ UN CATALOGUE QUI BOUGE PEU, et c'est l'URL signée
 *  qui l'impose : elle expire au bout de quelques heures. Un cache long
 *  finirait par servir des adresses mortes, et les vignettes tomberaient sans
 *  raison visible. C'est le prix du seau privé, assumé le 25/08. */
export function useMediasDemo(actif: boolean) {
  return useQuery<MediaDemo[]>({
    queryKey: ['bilan-medias-demo'],
    queryFn: () => (isMock ? mockResolve(mockMediasDemo)
                           : api.get<MediaDemo[]>('/bilan-medias-demo')),
    enabled: actif,
    staleTime: 5 * 60_000,
  });
}

/** ⚠️ `api.upload` ET NON `api.post` : la route attend du MULTIPART, et c'est ce
 *  qui permet au serveur de vérifier les OCTETS avant d'écrire. Ce helper existe
 *  déjà pour la photo de coach — il pose le `FormData` et, surtout, s'abstient
 *  de fixer `Content-Type` pour que le navigateur écrive lui-même la frontière
 *  multipart. */
export function useTeleverserMedia() {
  const qc = useQueryClient();
  return useMutation({
    // ⚠️ LE MOCK REND UN MÉDIA, PAS UN `{ok: true}`. Un type de retour différent
    // selon le mode ferait diverger le contrat que le reste du code croit avoir —
    // et TypeScript s'en plaindrait à la première utilisation du résultat.
    mutationFn: (fichier: File): Promise<MediaDemo> => (isMock
      ? mockResolve(mockMediasDemo[0])
      : api.upload<MediaDemo>('/bilan-medias-demo', fichier)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bilan-medias-demo'] }),
  });
}
