import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/api/client';
import { mockNotesKine, mockResolve } from '@/api/mock';
import type { NoteKine, NoteKineEcrite } from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';
import { useAthleteSelection } from '@/lib/athlete-selection';

const isMock = !isFirebaseConfigured;

/** LES NOTES DE SUIVI DU KINÉ (FRE-102) — au fil de l'eau, hors bilan.
 *
 *  ⚠️ LA REQUÊTE NE PART QUE POUR LE KINÉ DE CET ATHLÈTE, et c'est la règle
 *  d'affordance du projet : le serveur répond 403 à tout le monde d'autre
 *  (mode `kine`, le plus étroit du produit — ni le coach, ni l'athlète). La
 *  lancer quand même produirait une erreur à chaque affichage de l'onglet, et un
 *  toast rouge pour un refus parfaitement attendu.
 *
 *  ⚠️ `suivisIds` ET NON `canMedical`. Ce dernier vaut `isSelf || kineDeCetAthlete` :
 *  il inclut l'athlète sur son propre suivi, à qui ces notes sont justement
 *  fermées. Confondre les deux ferait partir une requête vouée au 403 — et,
 *  pire, laisserait croire à la lecture du code que l'athlète y a droit. */
export function useNotesKine(athleteId: string | null | undefined) {
  const { suivisIds } = useAthleteSelection();
  const autorise = Boolean(athleteId) && (isMock || suivisIds.has(athleteId ?? ''));
  return useQuery<NoteKine[]>({
    queryKey: ['notes-kine', athleteId],
    queryFn: () => (isMock
      ? mockResolve(mockNotesKine)
      : api.get<NoteKine[]>(`/athletes/${athleteId}/notes-kine`)),
    enabled: autorise,
    staleTime: 30_000,
  });
}

/** Après toute écriture, le journal se relit : l'ordre dépend du serveur (du
 *  plus récent au plus ancien) et une insertion optimiste le devinerait mal. */
function useEcriture<TArgs>(
  athleteId: string | null | undefined,
  appel: (args: TArgs) => Promise<unknown>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: appel,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes-kine', athleteId] }),
  });
}

export function useCreerNoteKine(athleteId: string | null | undefined) {
  return useEcriture<string>(athleteId, contenu => (isMock
    ? mockResolve({ ok: true })
    : api.post<unknown, NoteKineEcrite>(`/athletes/${athleteId}/notes-kine`, { contenu })));
}

export function useCorrigerNoteKine(athleteId: string | null | undefined) {
  return useEcriture<{ noteId: string; contenu: string }>(athleteId, ({ noteId, contenu }) => (isMock
    ? mockResolve({ ok: true })
    : api.patch<unknown, NoteKineEcrite>(`/athletes/${athleteId}/notes-kine/${noteId}`, { contenu })));
}

export function useSupprimerNoteKine(athleteId: string | null | undefined) {
  return useEcriture<string>(athleteId, noteId => (isMock
    ? mockResolve({ ok: true })
    : api.delete(`/athletes/${athleteId}/notes-kine/${noteId}`)));
}
