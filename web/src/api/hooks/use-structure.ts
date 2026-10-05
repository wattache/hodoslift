import { useQuery } from '@tanstack/react-query';

import { api } from '@/api/client';
import { mockResolve, mockTraining } from '@/api/mock';
import type { BlocDeStructure, MacroDeStructure, SemaineDeStructure } from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';
import { PEREMPTION_HORS_LIGNE_MS } from '@/lib/persistance-hors-ligne';

const isMock = !isFirebaseConfigured;

/** La CHARPENTE du programme : macros → blocs → semaines, sans une seule séance.
 *
 *  ⚠️ POURQUOI ELLE EXISTE À CÔTÉ DE `useTraining` (FRE-119). L'arbre complet
 *  pèse 512 Ko sur le programme le plus fourni (33 semaines) et 104 Ko en
 *  médian, mesuré le 02/09 sur les 67 programmes réels — et il grossit d'une
 *  semaine par semaine, sans borne. Le calendrier n'affiche qu'une frise :
 *  numéros, dates, objectifs de bloc. Il téléchargeait 512 Ko pour en utiliser
 *  11.
 *
 *  ⚠️ CLÉ DE CACHE DISTINCTE de `['training', …]`, à dessein : les deux
 *  lectures ont des durées de fraîcheur différentes. La charpente ne bouge que
 *  lorsqu'on ajoute ou renomme un objet — quelques fois par mois — là où le
 *  contenu change à chaque frappe du coach. Les mêler ferait recharger l'un
 *  pour l'autre.
 *
 *  ⚠️ EN DEV-MOCK, ON DÉRIVE LA CHARPENTE DES FIXTURES DE L'ARBRE plutôt que
 *  d'en écrire une seconde : deux jeux de données pour un même programme
 *  divergeraient, et le mock cesserait de ressembler à la production. */
export function useProgramStructure(programId: string | null | undefined) {
  return useQuery<MacroDeStructure[]>({
    queryKey: ['structure', programId],
    queryFn: async () => {
      if (isMock) {
        // Champ par champ, et non par déstructuration soustractive : le mock
        // doit rendre EXACTEMENT la forme du serveur — ni la BASE, ni les
        // séances. Un `...reste` laisserait passer ce que la route n'envoie
        // pas, et le dev-mock cesserait d'éprouver le même contrat.
        //
        // ⚠️ LE TYPE EST ANNOTÉ AUX TROIS NIVEAUX, et pas seulement en sortie :
        // un `MacroDeStructure[]` posé sur le tout ne contrôle que ce qui
        // MANQUE, jamais ce qui est EN TROP. C'est l'annotation sur chaque
        // littéral qui déclenche le contrôle des propriétés excédentaires,
        // c'est-à-dire précisément la promesse du paragraphe ci-dessus.
        return mockResolve(mockTraining.map((m): MacroDeStructure => ({
          id: m.id,
          macroNumber: m.macroNumber,
          name: m.name,
          trainingFrequency: m.trainingFrequency,
          coachNotes: m.coachNotes,
          blocks: m.blocks.map((b): BlocDeStructure => ({
            id: b.id,
            blockNumber: b.blockNumber,
            name: b.name,
            startDate: b.startDate,
            endDate: b.endDate,
            objectives: b.objectives ?? [],
            objectivesVersion: b.objectivesVersion,
            // La règle des quatre morceaux est celle du serveur ; elle est
            // recopiée ICI, et nulle part ailleurs dans le code de production —
            // même convention que le repli de date de `useFormeParJour`.
            hasBase: Boolean(
              (b.base?.daySplit?.length ?? 0) > 0
              || (b.base?.selectedPrincipaux?.length ?? 0) > 0
              || (b.base?.principles?.length ?? 0) > 0
              || (b.base?.accessories?.length ?? 0) > 0,
            ),
            weeks: b.weeks.map((w): SemaineDeStructure => ({
              id: w.id,
              weekNumber: w.weekNumber,
              name: w.name,
              hidden: w.hidden,
              startDate: w.startDate,
              endDate: w.endDate,
              athlete: w.athlete,
              sessionCount: (w.sessions ?? []).length,
            })),
          })),
        })));
      }
      const res = await api.get<{ macros: MacroDeStructure[] }>(`/programs/${programId}/structure`);
      return res.macros;
    },
    enabled: Boolean(programId),
    // Plus longue que celle de l'arbre (30 s) : la charpente change rarement.
    staleTime: 5 * 60_000,
    /** ⚠️ SANS CE `gcTime`, LA PERSISTANCE NE SERT À RIEN — et elle échouerait
     *  EN SILENCE (FRE-118). Le persister ne sauvegarde que ce qui est ENCORE
     *  dans le cache mémoire ; par défaut, une requête sans observateur est
     *  ramassée au bout de 5 minutes, donc disparaît aussi du disque. Un athlète
     *  qui ferme l'app après cinq minutes n'aurait rien retrouvé, et rien
     *  n'aurait signalé la perte. Il doit valoir au moins la péremption. */
    gcTime: PEREMPTION_HORS_LIGNE_MS,

  });
}
