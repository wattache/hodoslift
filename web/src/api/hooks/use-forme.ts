import { useQuery } from '@tanstack/react-query';

import { api } from '@/api/client';
import { mockResolve, mockTraining } from '@/api/mock';
import type { PointForme } from '@/api/types';
import { addDays, todayISO } from '@/lib/dates-ui';
import { isFirebaseConfigured } from '@/firebase';

const isMock = !isFirebaseConfigured;

/** La forme du jour, servie par brokkr (FRE-119).
 *
 *  ⚠️ ELLE ÉTAIT EXTRAITE DE L'ARBRE D'ENTRAÎNEMENT, dans le navigateur. Trois
 *  écrans — tableau de bord, fiche athlète, Tracker — téléchargeaient donc
 *  l'arbre ENTIER de l'athlète (512 Ko sur le programme le plus fourni, 119 en
 *  médian, mesuré le 02/09) pour en tirer trente points.
 *
 *  C'est la troisième fois que ce motif se règle ainsi : les records, puis le
 *  RIS, maintenant la forme. Un `GROUP BY` déguisé en composant React coûte
 *  toujours deux fois — la bande passante, et une seconde définition de la
 *  règle qui finit par diverger.
 *
 *  ⚠️ ET LA RÈGLE DE DATE EST PARTIE AVEC. Le repli `coalesce(session_date,
 *  week.start_date)` vivait en double, dans l'ETL et ici en TypeScript. Il vit
 *  maintenant dans la requête, une fois. */
export function useFormeParJour(athleteId: string | null | undefined, jours: number) {
  const depuis = addDays(todayISO(), -(jours - 1));
  return useQuery<PointForme[]>({
    queryKey: ['forme-du-jour', athleteId, depuis],
    queryFn: async () => {
      if (isMock) {
        // Dérivée des MÊMES fixtures que l'arbre : deux jeux de données pour un
        // même athlète divergeraient, et le dev-mock cesserait de ressembler à
        // la production. La règle de repli est recopiée ici, et NULLE PART
        // ailleurs dans le code de production.
        const points = mockTraining.flatMap(m => m.blocks.flatMap(b => b.weeks.flatMap(w =>
          (w.sessions ?? []).flatMap(s => {
            const date = s.sessionDate || w.startDate;
            return typeof s.formOfTheDay === 'number' && date && date >= depuis
              ? [{ date, form: s.formOfTheDay }] : [];
          }))));
        return mockResolve(points.sort((a, b) => a.date.localeCompare(b.date)));
      }
      return api.get<PointForme[]>(
        `/athletes/${athleteId}/forme-du-jour?depuis=${depuis}`);
    },
    enabled: Boolean(athleteId),
    staleTime: 60_000,
  });
}
