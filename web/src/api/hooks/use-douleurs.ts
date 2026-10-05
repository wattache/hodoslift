import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/api/client';
import { clesDUneDouleur, invalider } from '@/api/cles';
import { mockDouleurs, mockLogsDeDouleur, mockResolve } from '@/api/mock';
import type { Douleur, DouleurDeclaree, DouleurModifiee, LogDeDouleur, LogLu } from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';

const isMock = !isFirebaseConfigured;

const cle = (athleteId: string | null | undefined) => ['douleurs', athleteId] as const;

/** LES DOULEURS SUIVIES D'UN ATHLÈTE (FRE-195).
 *
 *  ⚠️ LE STAFF LIT, L'ATHLÈTE ÉCRIT. Le serveur sert la liste en
 *  `owner_or_staff` — kiné ET coach, comme le guichet — mais n'accepte les
 *  écritures qu'en `owner`. Le front ne doit donc proposer la saisie qu'à
 *  l'athlète lui-même : c'est la règle d'affordance du projet, un bouton qui
 *  mène à un 403 n'existe pas. */
export function useDouleurs(athleteId: string | null | undefined) {
  return useQuery<Douleur[]>({
    queryKey: cle(athleteId),
    queryFn: () => (isMock
      ? mockResolve(mockDouleurs)
      : api.get<Douleur[]>(`/athletes/${athleteId}/douleurs`)),
    enabled: Boolean(athleteId),
    staleTime: 30_000,
  });
}

/** L'HISTOIRE D'UNE DOULEUR (FRE-197).
 *
 *  ⚠️ UN APPEL À PART, ET SEULEMENT QUAND LA CARTE S'OUVRE. La liste des
 *  douleurs se lit à chaque ouverture de l'écran ; y embarquer les relevés de
 *  toutes les douleurs ferait payer l'historique à qui vient juste voir où il a
 *  mal. `enabled` porte cette règle. */
export function useLogsDeDouleur(athleteId: string | null | undefined,
                                 douleurId: string | null) {
  return useQuery<LogLu[]>({
    queryKey: ['douleur-logs', athleteId, douleurId],
    queryFn: () => (isMock
      ? mockResolve(mockLogsDeDouleur(douleurId!))
      : api.get<LogLu[]>(`/athletes/${athleteId}/douleurs/${douleurId}/logs`)),
    enabled: Boolean(athleteId && douleurId),
    staleTime: 30_000,
  });
}

function useEcriture<TArgs>(
  athleteId: string | null | undefined,
  appel: (args: TArgs) => Promise<unknown>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: appel,
    // ⚠️ ON RELIT PLUTÔT QUE DE DEVINER. L'ordre vient du serveur (vivantes
    // d'abord, puis la plus fraîche), et `recurrente` se DÉDUIT du nombre de
    // logs : une insertion optimiste devrait recalculer les deux, donc
    // réécrire la règle ici. Une seule définition, et elle est côté serveur.
    onSuccess: () => invalider(qc, clesDUneDouleur(athleteId)),
  });
}

export function useDeclarerDouleur(athleteId: string | null | undefined) {
  return useEcriture(athleteId, (corps: DouleurDeclaree) =>
    api.post<unknown, DouleurDeclaree>(`/athletes/${athleteId}/douleurs`, corps));
}

export function useModifierDouleur(athleteId: string | null | undefined) {
  return useEcriture(athleteId, ({ id, ...corps }: DouleurModifiee & { id: string }) =>
    api.patch<unknown, DouleurModifiee>(`/athletes/${athleteId}/douleurs/${id}`, corps));
}

/** Noter une douleur un jour donné. Réécrire le même jour REMPLACE — la seconde
 *  saisie est une correction, pas un fait de plus. */
export function useNoterDouleur(athleteId: string | null | undefined) {
  return useEcriture(athleteId,
    ({ id, jour, ...corps }: LogDeDouleur & { id: string; jour: string }) =>
      api.put<unknown, LogDeDouleur>(`/athletes/${athleteId}/douleurs/${id}/logs/${jour}`, corps));
}
