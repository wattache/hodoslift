import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/api/client';
import { mockObjectifsTechniques, mockResolve } from '@/api/mock';
import type { ObjectifTechnique, ObjectifTechniqueCorrige, ObjectifTechniqueEcrit } from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';
import { useAthleteSelection } from '@/lib/athlete-selection';

const isMock = !isFirebaseConfigured;

/** LES OBJECTIFS TECHNIQUES D'UN ATHLÈTE (FRE-122).
 *
 *  ⚠️ LA LECTURE EST PLUS LARGE QUE L'ÉCRITURE, et c'est tout le ticket. Le
 *  serveur ouvre la lecture à l'athlète, à son coach ET à son kiné
 *  (`owner_or_staff`) ; il réserve l'écriture au coach (`coach`). Les deux
 *  affordances ci-dessous suivent cette frontière — c'est l'adapter qui tranche,
 *  pas la vue.
 *
 *  ⚠️ TOUT EST CHARGÉ EN UNE FOIS — ouverts et clos, tous mouvements confondus.
 *  Un athlète en a quelques dizaines. Filtrer par mouvement imposerait une clé de
 *  cache par mouvement, donc autant de requêtes que de lignes à l'écran, pour
 *  économiser des octets qu'on ne compte pas. */
export function useObjectifsTechniques(athleteId: string | null | undefined) {
  const { canView, canMedical } = useAthleteSelection();
  const autorise = Boolean(athleteId) && (isMock || canView || canMedical);
  return useQuery<ObjectifTechnique[]>({
    queryKey: ['objectifs-techniques', athleteId],
    queryFn: () => (isMock
      ? mockResolve(mockObjectifsTechniques)
      : api.get<ObjectifTechnique[]>(`/athletes/${athleteId}/objectifs-techniques`)),
    enabled: autorise,
    staleTime: 30_000,
  });
}

/** Regroupe par mouvement, en ne gardant que les objectifs OUVERTS.
 *
 *  ⚠️ LA CLÉ EST LE NOM NORMALISÉ, et il n'en existe qu'UNE définition —
 *  `cleMouvement`. La normalisation existait déjà à deux endroits dans ce front
 *  quand le ticket a été écrit ; en ajouter une troisième ici, c'était la
 *  garantie qu'elles divergent.
 *
 *  ⚠️ ET SEULEMENT LES OUVERTS. Une pastille qui compterait les objectifs clos
 *  s'allumerait pour toujours sur chaque mouvement jamais travaillé — un signal
 *  qui ne s'éteint pas cesse d'en être un. */
export function parMouvementOuverts(
  objectifs: readonly ObjectifTechnique[],
): ReadonlyMap<string, ObjectifTechnique[]> {
  const par = new Map<string, ObjectifTechnique[]>();
  for (const o of objectifs) {
    if (o.closLe !== null) continue;
    const cle = cleMouvement(o.mouvement);
    const liste = par.get(cle);
    if (liste) liste.push(o); else par.set(cle, [o]);
  }
  return par;
}

/** LA définition de « c'est le même mouvement », pour tout ce qui rapproche un
 *  objectif d'une ligne. `trim` + minuscules, comme l'historique de progression.
 *
 *  ⚠️ CÔTÉ SERVEUR LA QUESTION NE SE POSE PAS : le mouvement d'un objectif est
 *  une clé étrangère vers la bibliothèque, et le nom d'une ligne en est une
 *  copie. Les deux sont donc identiques par construction. Cette normalisation
 *  est une CEINTURE — elle rattrape une casse ou une espace, pas une divergence
 *  de fond, qui elle serait le défaut de FRE-123. */
export function cleMouvement(nom: string | null | undefined): string {
  return (nom ?? '').trim().toLowerCase();
}

/** Après toute écriture, le journal se relit : l'ordre vient du serveur, et une
 *  insertion optimiste le devinerait mal. */
function useEcriture<TArgs>(
  athleteId: string | null | undefined,
  appel: (args: TArgs) => Promise<unknown>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: appel,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objectifs-techniques', athleteId] }),
  });
}

export function usePoserObjectif(athleteId: string | null | undefined) {
  return useEcriture<{ mouvement: string; texte: string }>(athleteId, corps => (isMock
    ? mockResolve({ ok: true })
    : api.post<unknown, ObjectifTechniqueEcrit>(`/athletes/${athleteId}/objectifs-techniques`, corps)));
}

export function useCorrigerObjectif(athleteId: string | null | undefined) {
  return useEcriture<{ objectifId: string; texte?: string; clos?: boolean }>(
    athleteId, ({ objectifId, ...corps }) => (isMock
      ? mockResolve({ ok: true })
      : api.patch<unknown, ObjectifTechniqueCorrige>(`/athletes/${athleteId}/objectifs-techniques/${objectifId}`, corps)));
}

export function useSupprimerObjectif(athleteId: string | null | undefined) {
  return useEcriture<string>(athleteId, objectifId => (isMock
    ? mockResolve({ ok: true })
    : api.delete(`/athletes/${athleteId}/objectifs-techniques/${objectifId}`)));
}
