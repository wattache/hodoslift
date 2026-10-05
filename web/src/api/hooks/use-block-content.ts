import { useQuery } from '@tanstack/react-query';

import { api } from '@/api/client';
import { mockResolve, mockTraining } from '@/api/mock';
import type { ContenuDeBloc } from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';
import { PEREMPTION_HORS_LIGNE_MS } from '@/lib/persistance-hors-ligne';

const isMock = !isFirebaseConfigured;

/** La clé de cache, et LA REQUÊTE — exportées parce qu'elles servent deux fois.
 *
 *  ⚠️ LE HOOK NE SUFFIT PAS : dupliquer la trame d'un AUTRE bloc a besoin de son
 *  contenu au moment du clic, pas en permanence. C'est un `fetchQuery`
 *  impératif, et il doit viser la MÊME clé et la MÊME requête que le hook —
 *  sinon la trame se retéléchargerait alors qu'elle est peut-être déjà en
 *  cache, et surtout les deux chemins pourraient diverger sur l'URL. */
export const cleContenuDeBloc = (
  programId: string | null | undefined,
  blockId: string | null | undefined,
) => ['block-content', programId, blockId] as const;

export async function contenuDeBloc(
  programId: string | null | undefined,
  blockId: string | null | undefined,
): Promise<ContenuDeBloc> {
  if (isMock) {
    const bloc = mockTraining.flatMap(m => m.blocks).find(b => b.id === blockId);
    // Champ par champ, comme la charpente : le mock doit rendre EXACTEMENT la
    // forme du serveur, pas davantage.
    return mockResolve({
      base: bloc?.base ?? { daySplit: [], principles: [], accessories: [],
                            selectedPrincipaux: null, granularity: {},
                            s1StartDate: '', s1EndDate: '' },
      weeks: (bloc?.weeks ?? []).map(w => ({ id: w.id, sessions: w.sessions ?? [] })),
    } as ContenuDeBloc);
  }
  return api.get<ContenuDeBloc>(`/programs/${programId}/blocks/${blockId}/content`);
}

/** LE CONTENU d'un bloc — sa trame, et les séances de ses semaines (FRE-119).
 *
 *  ⚠️ ELLE SE LIT AVEC `useProgramStructure`, JAMAIS SEULE. La charpente donne
 *  les numéros, les dates et l'athlète ; celle-ci ne donne que ce qui manque, et
 *  les deux se recollent PAR IDENTIFIANT DE SEMAINE. C'est délibéré : redire ici
 *  le numéro d'une semaine en ferait une seconde source pour la même valeur, et
 *  deux sources se contredisent dès que l'une est fraîche et l'autre en cache.
 *
 *  ⚠️ POURQUOI LE BLOC EST LA BONNE MAILLE. L'écran montre une semaine, mais il
 *  COMPARE toutes celles de son bloc — la progression d'un mouvement, son
 *  historique. Servir la semaine seule obligerait à rappeler ses voisines une
 *  par une pour dessiner la même courbe. Le bloc est le plus petit périmètre qui
 *  reste cohérent.
 *
 *  Et surtout : un bloc ne grossit pas. L'arbre, lui, prenait une semaine par
 *  semaine sans fin — c'est ce qui rendait cet écran un peu plus lourd chaque
 *  mois. Mesuré le 02/09 sur les 67 programmes réels : le plus fourni compte 869
 *  lignes sur 9 blocs, dont le plus gros en porte 158 — 18 %.
 *
 *  ⚠️ EN DEV-MOCK, ON DÉCOUPE LES FIXTURES DE L'ARBRE plutôt que d'en écrire
 *  d'autres : deux jeux de données pour un même programme divergeraient, et le
 *  mock cesserait de ressembler à la production. */
export function useBlockContent(
  programId: string | null | undefined,
  blockId: string | null | undefined,
) {
  return useQuery<ContenuDeBloc>({
    queryKey: cleContenuDeBloc(programId, blockId),
    queryFn: () => contenuDeBloc(programId, blockId),
    enabled: Boolean(programId && blockId),
    // La même fraîcheur que l'arbre qu'elle remplace : ce contenu change à
    // chaque frappe du coach, contrairement à la charpente (5 min).
    staleTime: 30_000,
    /** ⚠️ SANS CE `gcTime`, LA PERSISTANCE NE SERT À RIEN — et elle échouerait
     *  EN SILENCE (FRE-118). Le persister ne sauvegarde que ce qui est ENCORE
     *  dans le cache mémoire ; par défaut, une requête sans observateur est
     *  ramassée au bout de 5 minutes, donc disparaît aussi du disque. Un athlète
     *  qui ferme l'app après cinq minutes n'aurait rien retrouvé, et rien
     *  n'aurait signalé la perte. Il doit valoir au moins la péremption. */
    gcTime: PEREMPTION_HORS_LIGNE_MS,

  });
}
