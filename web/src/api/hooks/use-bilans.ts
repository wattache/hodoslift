import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { mockBilanModeles, mockBilanResultats, mockBilans, mockResolve } from '@/api/mock';
import type {
  Bilan, BilanCree, BilanModelesDisponibles, BilanPatch, BilanResultatEcrit, BilanResume,
} from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';

const isMock = !isFirebaseConfigured;

/** Les modèles proposables à la création d'un bilan.
 *
 *  ⚠️ SERVIS PAR BROKKR, JAMAIS RECOPIÉS ICI. Les tests vivent en base depuis
 *  que la kiné les compose : une seconde définition en TypeScript divergerait
 *  sans que rien ne le signale — ce projet l'a déjà payé deux fois.
 *
 *  Sous le préfixe athlète bien qu'ils n'en dépendent pas : c'est ce qui leur
 *  donne leur autorisation. Un catalogue de protocoles kiné n'a pas à être
 *  lisible par n'importe quel compte. */
export function useBilanModelesDisponibles(athleteId: string | null | undefined) {
  return useQuery<BilanModelesDisponibles>({
    queryKey: ['bilan-modeles-disponibles'],
    queryFn: () => (isMock
      ? mockResolve({ modeles: mockBilanModeles })
      : api.get<BilanModelesDisponibles>(`/athletes/${athleteId}/bilans/modeles`)),
    enabled: Boolean(athleteId),
    staleTime: 60_000,
  });
}

export function useBilans(athleteId: string | null | undefined) {
  return useQuery<BilanResume[]>({
    queryKey: ['bilans', athleteId],
    queryFn: () => (isMock
      ? mockResolve(mockBilans)
      : api.get<BilanResume[]>(`/athletes/${athleteId}/bilans`)),
    enabled: Boolean(athleteId),
    staleTime: 60_000,
  });
}

export function useBilan(athleteId: string | null | undefined, bilanId: string | null) {
  return useQuery<Bilan>({
    queryKey: ['bilan', athleteId, bilanId],
    queryFn: () => (isMock
      ? mockResolve({
          ...(mockBilans.find(b => b.id === bilanId) ?? mockBilans[0]),
          antecedents: null, notes: null, resultats: mockBilanResultats,
          creeLe: '2026-08-21T09:00:00Z', modifieLe: '2026-08-21T09:00:00Z',
        } as Bilan)
      : api.get<Bilan>(`/athletes/${athleteId}/bilans/${bilanId}`)),
    enabled: Boolean(athleteId && bilanId),
  });
}

/** ⚠️ REND LE BILAN COMPLET, résultats compris — la route les crée en copiant le
 *  modèle. On peut donc ouvrir l'écran de saisie sans un second aller-retour. */
export function useCreerBilan(athleteId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corps: BilanCree) => (isMock
      ? mockResolve(mockBilans[0] as unknown as Bilan)
      : api.post<Bilan, BilanCree>(`/athletes/${athleteId}/bilans`, corps)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bilans', athleteId] }),
  });
}

export function usePatchBilan(athleteId: string | null | undefined, bilanId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corps: BilanPatch) => (isMock
      ? mockResolve(mockBilans[0])
      : api.patch<BilanResume, BilanPatch>(`/athletes/${athleteId}/bilans/${bilanId}`, corps)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bilans', athleteId] });
      void qc.invalidateQueries({ queryKey: ['bilan', athleteId, bilanId] });
    },
  });
}

/** Renseigne UN résultat. Appelé à chaque validation de champ.
 *
 *  ⚠️ ADRESSÉ PAR L'IDENTIFIANT DU RÉSULTAT, pas par un code de test : la ligne
 *  existe depuis la création du bilan (la copie du modèle). On met à jour, on
 *  ne crée plus.
 *
 *  ⚠️ MISE À JOUR OPTIMISTE DU DÉTAIL — ET C'EST UN CORRECTIF, PAS UN RAFFINEMENT.
 *  La route rend le RÉSUMÉ (« 12 sur 32 »), pas le résultat écrit. En n'invalidant
 *  que la liste, l'écran ne voyait donc jamais sa propre saisie : un bouton de
 *  ressenti restait éteint après le clic, et on cliquait plusieurs fois en croyant
 *  que ça n'avait pas pris. Signalé par William le 21/08.
 *
 *  ⚠️ ET PAS UNE INVALIDATION DU BILAN COMPLET, qui aurait « marché » aussi : elle
 *  refetcherait l'objet entier à chaque champ quitté, et ferait clignoter la
 *  saisie en cours. On écrit donc dans le cache ce qu'on vient d'envoyer, ce qui
 *  est instantané et sans aller-retour.
 *
 *  Le filet : sur ÉCHEC on invalide, pour que le cache ne garde pas une valeur que
 *  le serveur a refusée. Sans ça, l'optimisme deviendrait un mensonge. */
export function useEnregistrerResultat(athleteId: string | null | undefined, bilanId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ resultatId, valeurs }: { resultatId: string; valeurs: BilanResultatEcrit }) =>
      (isMock
        ? mockResolve(mockBilans[0])
        : api.patch<BilanResume, BilanResultatEcrit>(
            `/athletes/${athleteId}/bilans/${bilanId}/resultats/${resultatId}`, valeurs)),
    onMutate: ({ resultatId, valeurs }) => {
      qc.setQueryData<Bilan>(['bilan', athleteId, bilanId], ancien => {
        if (!ancien) return ancien;
        return {
          ...ancien,
          // ⚠️ ON REMPLACE EN PLACE, sans réordonner : la ligne garde son rang
          // dans la rubrique. Une reconstruction par filtre + concaténation la
          // ferait sauter en bas de liste sous les doigts de l'utilisateur.
          resultats: ancien.resultats.map(r =>
            r.id === resultatId ? { ...r, ...valeurs } : r),
        };
      });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bilans', athleteId] }),
    onError: () => void qc.invalidateQueries({ queryKey: ['bilan', athleteId, bilanId] }),
  });
}

export function useSupprimerBilan(athleteId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bilanId: string) => (isMock
      ? mockResolve(mockBilans[0])
      : api.delete<BilanResume>(`/athletes/${athleteId}/bilans/${bilanId}`)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bilans', athleteId] }),
  });
}
