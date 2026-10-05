import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { mockBilanModele, mockBilanModeles, mockResolve } from '@/api/mock';
import type {
  BilanModele, BilanModeleCree, BilanModelePatch, BilanModeleResume,
  BilanRubriqueCree, BilanRubriquePatch, BilanTest, BilanTestCree, BilanTestPatch,
} from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';

const isMock = !isFirebaseConfigured;

/** LA COMPOSITION DES MODÈLES — réservée à la kiné (`require_kine` côté serveur).
 *
 *  ⚠️ CE QUI EST ÉDITÉ ICI NE RÉÉCRIT JAMAIS UN BILAN PASSÉ. Un bilan copie son
 *  modèle à la création : retoucher un test change les FUTURS bilans, jamais les
 *  anciens. C'est ce qui rend cette page sans danger, et il faut le dire à
 *  l'écran — sinon on n'ose pas y toucher.
 *
 *  ⚠️ TOUTES LES ÉCRITURES RENDENT LE MODÈLE COMPLET (sauf sur un test seul) :
 *  on remplace le cache avec la réponse plutôt que d'invalider, ce qui évite un
 *  aller-retour et un clignotement à chaque frappe. */
const cleModeles = ['bilan-modeles'] as const;
const cleModele = (id: string | null) => ['bilan-modele', id] as const;

export function useBilanModeles(actif = true) {
  return useQuery<BilanModeleResume[]>({
    queryKey: cleModeles,
    queryFn: () => (isMock
      ? mockResolve(mockBilanModeles)
      : api.get<BilanModeleResume[]>('/bilan-modeles')),
    enabled: actif,
    staleTime: 60_000,
  });
}

export function useBilanModele(modeleId: string | null) {
  return useQuery<BilanModele>({
    queryKey: cleModele(modeleId),
    // ⚠️ LE `!isMock` A ÉTÉ RETIRÉ — c'était le même défaut qu'`useAthletesSuivis` :
    // une requête DÉSACTIVÉE en dev-mock plutôt qu'une fixture fournie. Cliquer
    // un modèle du catalogue ouvrait un composeur vide, donc tout l'écran où la
    // kiné compose ses tests échappait au seul harnais qui traverse l'interface.
    queryFn: () => (isMock ? mockResolve(mockBilanModele)
                           : api.get<BilanModele>(`/bilan-modeles/${modeleId}`)),
    enabled: Boolean(modeleId),
  });
}

/** Après toute écriture : le modèle rendu remplace le cache, et le catalogue
 *  s'invalide (le compte de tests y a bougé). */
function useEcritureModele<TCorps>(
  modeleId: string | null,
  envoyer: (corps: TCorps) => Promise<BilanModele>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: envoyer,
    onSuccess: modele => {
      qc.setQueryData(cleModele(modeleId ?? modele.id), modele);
      void qc.invalidateQueries({ queryKey: cleModeles });
      void qc.invalidateQueries({ queryKey: ['bilan-modeles-disponibles'] });
    },
  });
}

export function useCreerModele() {
  return useEcritureModele<BilanModeleCree>(null, corps =>
    api.post<BilanModele, BilanModeleCree>('/bilan-modeles', corps));
}

export function usePatchModele(modeleId: string | null) {
  return useEcritureModele<BilanModelePatch>(modeleId, corps =>
    api.patch<BilanModele, BilanModelePatch>(`/bilan-modeles/${modeleId}`, corps));
}

/** ⚠️ L'IDENTIFIANT VIENT DE L'APPEL, pas de la fermeture du hook : la LISTE
 *  archive un modèle parmi d'autres, elle n'en a pas « un » sous la main. Un
 *  `usePatchModele(null)` construirait l'URL `/bilan-modeles/null`. */
export function useArchiverModele() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ modeleId, archive }: { modeleId: string; archive: boolean }) =>
      api.patch<BilanModele, BilanModelePatch>(`/bilan-modeles/${modeleId}`, { archive }),
    onSuccess: modele => {
      qc.setQueryData(cleModele(modele.id), modele);
      void qc.invalidateQueries({ queryKey: cleModeles });
      void qc.invalidateQueries({ queryKey: ['bilan-modeles-disponibles'] });
    },
  });
}

export function useSupprimerModele() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modeleId: string) => api.delete<void>(`/bilan-modeles/${modeleId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cleModeles });
      void qc.invalidateQueries({ queryKey: ['bilan-modeles-disponibles'] });
    },
  });
}

export function useCreerRubrique(modeleId: string | null) {
  return useEcritureModele<BilanRubriqueCree>(modeleId, corps =>
    api.post<BilanModele, BilanRubriqueCree>(`/bilan-modeles/${modeleId}/rubriques`, corps));
}

export function usePatchRubrique(modeleId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rubriqueId, corps }: { rubriqueId: string; corps: BilanRubriquePatch }) =>
      api.patch<BilanModele, BilanRubriquePatch>(`/bilan-modeles/${modeleId}/rubriques/${rubriqueId}`, corps),
    onSuccess: modele => qc.setQueryData(cleModele(modeleId), modele),
  });
}

export function useSupprimerRubrique(modeleId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rubriqueId: string) =>
      api.delete<BilanModele>(`/bilan-modeles/${modeleId}/rubriques/${rubriqueId}`),
    onSuccess: modele => {
      qc.setQueryData(cleModele(modeleId), modele);
      void qc.invalidateQueries({ queryKey: cleModeles });
    },
  });
}

/** ⚠️ REND LE TEST SEUL, pas le modèle — d'où l'invalidation plutôt que
 *  l'écriture directe du cache. */
export function useCreerTest(modeleId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rubriqueId, corps }: { rubriqueId: string; corps: BilanTestCree }) =>
      api.post<BilanTest, BilanTestCree>(`/bilan-modeles/${modeleId}/rubriques/${rubriqueId}/tests`, corps),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cleModele(modeleId) });
      void qc.invalidateQueries({ queryKey: cleModeles });
    },
  });
}

export function usePatchTest(modeleId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ testId, corps }: { testId: string; corps: BilanTestPatch }) =>
      api.patch<BilanTest, BilanTestPatch>(`/bilan-modeles/${modeleId}/tests/${testId}`, corps),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cleModele(modeleId) });
      void qc.invalidateQueries({ queryKey: cleModeles });
    },
  });
}

export function useSupprimerTest(modeleId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (testId: string) =>
      api.delete<void>(`/bilan-modeles/${modeleId}/tests/${testId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cleModele(modeleId) });
      void qc.invalidateQueries({ queryKey: cleModeles });
    },
  });
}
