import { useQuery } from '@tanstack/react-query';

import { api } from '@/api/client';
import { mockResolve, mockTraining } from '@/api/mock';
import type { Macrocycle, TrainingResponse } from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';

const isMock = !isFirebaseConfigured;

/** Tout le programme d'un athlète (macros → blocks → weeks) en un appel. */
export function useTraining(programId: string | null | undefined) {
  return useQuery<Macrocycle[]>({
    queryKey: ['training', programId],
    queryFn: async () => {
      // Plus de normalisation : la lecture vient de Postgres, où `variant` est
      // une colonne text[] et ne PEUT pas être une chaîne. La tolérance qui
      // vivait ici couvrait la donnée Firestore, convertie à la bascule.
      if (isMock) return mockResolve(mockTraining);
      const res = await api.get<TrainingResponse>(`/programs/${programId}/training`);
      return res.macros;
    },
    enabled: Boolean(programId),
    staleTime: 30_000,
  });
}

/* ⚠️ CE FICHIER NE PORTE PLUS QUE LA LECTURE, et c'est le résultat d'un ménage.
 *
 * Il contenait douze hooks d'écriture — patch de contenu, de méta, de BASE,
 * création et suppression de macro/bloc/semaine — dont AUCUN n'était appelé.
 * Ils visaient les routes documentaires `/programs/{p}/macrocycles/{m}/blocks/…`,
 * supprimées de brokkr avec la bascule Postgres (FRE-12) : leur grain était celui
 * du document Firestore, c'est-à-dire la semaine ENTIÈRE, et c'est ce grain qui a
 * fait tomber trois semaines le 11 août.
 *
 * Les écritures vivent depuis dans `lib/training-editor.ts`, au grain de la ligne
 * et de l'objet (`/macros`, `/blocks`, `/weeks`, `/sessions`, `/exercises`).
 *
 * Les garder ne coûtait rien tant que personne ne les rappelait — mais c'est
 * exactement le piège : ils avaient l'air d'une API disponible, et le premier qui
 * s'en serait servi aurait obtenu un 404 sans comprendre pourquoi.
 */
