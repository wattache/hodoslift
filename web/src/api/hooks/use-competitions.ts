import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import { clesDeDisponibilite, invalider } from '@/api/cles';
import { mockAthletes, mockAvailability, mockCoachAvailability, mockCompetitions, mockResolve, mockWeightCategories } from '@/api/mock';
import type { AthleteInscriptible, CoachAvailability, CoachAvailabilityPut, CoachAvailabilityStatus, CoachCompetitionAvailability, Competition, CompetitionCreate, CompetitionEcrite, CompetitionInput, CompetitionPatch, CompParticipant, WeightCategories } from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';
import { useSlugCourant } from '@/api/hooks/use-structure-choisie';

const isMock = !isFirebaseConfigured;

/** Id façon Firestore pour une nouvelle compétition (le PUT est par id). */
export function newCompetitionId(): string {
  return `comp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Les compétitions de la structure sélectionnée (FRE-13) — brokkr borne
 *  (`?structure=`) à ce que l'appelant a le droit de voir, puis à la structure. */
export function useCompetitions() {
  const { slug, pret } = useSlugCourant();
  return useQuery<Competition[]>({
    queryKey: ['competitions', slug],
    enabled: pret,
    queryFn: () => (isMock ? mockResolve(mockCompetitions)
                           : api.get<Competition[]>(`/competitions${slug ? `?structure=${encodeURIComponent(slug)}` : ''}`)),
    staleTime: 30_000,
  });
}

export function useWeightCategories() {
  return useQuery<WeightCategories>({
    queryKey: ['weight-categories'],
    queryFn: () => (isMock ? mockResolve(mockWeightCategories) : api.get<WeightCategories>('/weight-categories')),
    staleTime: 24 * 60 * 60_000,
  });
}

/** Ne renvoie au serveur QUE les champs du contrat d'écriture.
 *
 *  Le GET enrichit chaque participant de champs calculés côté serveur — `score`,
 *  depuis FRE-92 `ris` et `risTotal`, depuis FRE-203 `projection`. Cet objet-là repart tel quel à
 *  l'écriture, et brokkr — `extra="forbid"` sur `Participant` — refuse TOUTE la
 *  requête en 422.
 *
 *  `Omit<CompParticipant, …>` ne protège de rien ici : TypeScript ne
 *  retire pas la propriété à l'exécution, et un objet venant du serveur n'est
 *  pas un littéral, donc l'excès n'est pas signalé à la compilation. La seule
 *  garantie est de RECONSTRUIRE l'objet champ par champ. */
type ParticipantEcrit = Omit<CompParticipant, 'score' | 'ris' | 'risTotal' | 'projection' | 'flight'>;

function toParticipantInput(p: ParticipantEcrit): ParticipantEcrit {
  return {
    name: p.name,
    uid: p.uid,
    competesOn: p.competesOn,
    bodyweight: p.bodyweight,
    gender: p.gender,
    weightCategory: p.weightCategory,
    // ⚠️ RECONSTRUIT CHAMP PAR CHAMP : un champ oublié ici n'arrive jamais au
    // serveur, et s'efface au premier enregistrement (FRE-204). Le `flight`, lui,
    // se déduit de la catégorie : il ne repart pas.
    movements: p.movements,
  };
}

/** Idem au niveau de la compétition : `participants` est le seul sous-arbre
 *  enrichi à la lecture, mais on passe par un point unique pour que tout futur
 *  champ dérivé soit filtré ici et nulle part ailleurs. */
// ⚠️ LA CONTRAINTE PORTE SUR LA FORME D'ÉCRITURE, pas sur celle de lecture. Un
// participant LU porte `score`, `ris` et `risTotal` ; un participant ÉCRIT n'en
// porte aucun — le serveur les refuse en 422. Contraindre sur `CompParticipant`
// obligeait donc l'appelant à fournir des champs qu'il n'a pas le droit
// d'envoyer, ce qui ne se voyait pas tant que `score` était marqué optionnel par
// erreur dans le contrat écrit à la main.
export function toWritePayload<T extends { participants?: ParticipantEcrit[] }>(input: T): T {
  return input.participants
    ? { ...input, participants: input.participants.map(toParticipantInput) }
    : input;
}

/** PUT — create-or-replace complet.
 *
 *  ⚠️ DANS LA STRUCTURE SÉLECTIONNÉE (`?structure=`, 19/09). Pour un coach, c'est
 *  la sienne de toute façon ; pour l'admin, c'est celle qu'il REGARDE — sans
 *  ça, William créait depuis la vue French Forge une compétition rangée chez
 *  ElGustoLift, invisible de la liste où il venait de la créer. */
export function usePutCompetition() {
  const qc = useQueryClient();
  const { slug } = useSlugCourant();
  return useMutation({
    mutationFn: ({ id, competition }: { id: string; competition: CompetitionInput }) =>
      isMock ? mockResolve({ ok: true, id })
             : api.put<unknown, CompetitionCreate>(
                 `/competitions/${id}${slug ? `?structure=${encodeURIComponent(slug)}` : ''}`, toWritePayload(competition)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['competitions'] }),
  });
}

/** Les écritures d'une compétition, À LA FILE, une par compétition (FRE-162).
 *
 *  ⚠️ SANS FILE, UN PLATEAU SE REFUSERAIT LUI-MÊME. Chaque PATCH présente la
 *  version qu'il croit modifier et reçoit la suivante ; le plateau en envoie un
 *  toutes les 600 ms pendant la saisie. Deux envois partis avant le retour du
 *  premier présenteraient la même version, et le serveur refuserait le second
 *  — contre son propre auteur. Chaque écriture attend donc la précédente, et
 *  lit la version APRÈS elle. */
const fileParCompetition = new Map<string, Promise<unknown>>();

/** PATCH — partiel (nom, dates, lieu, mouvements, participants).
 *
 *  ⚠️ LA VERSION N'EST PAS À L'APPELANT (FRE-162) : elle vient de l'entrée de
 *  cache `['competitions']` qu'elle date, et y retourne à chaque succès. La faire
 *  transiter par l'écran l'obligerait à la stocker, la passer, et ne pas
 *  l'oublier — même choix que les objectifs d'athlète (`use-goals.ts`). */
export function usePatchCompetition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: CompetitionPatch }): Promise<CompetitionEcrite> => {
      if (isMock) return mockResolve<CompetitionEcrite>({ ok: true, written: [], version: 'mock' });
      const precedente = fileParCompetition.get(id) ?? Promise.resolve();
      const envoi = precedente.catch(() => undefined).then(async () => {
        // ⚠️ `getQueriesData`, PAS `getQueryData` : la liste est rangée par
        // structure (`['competitions', slug]`, FRE-13), et une clé exacte
        // `['competitions']` ne trouvait plus rien — « pas encore chargée ».
        const version = qc.getQueriesData<Competition[]>({ queryKey: ['competitions'] })
          .flatMap(([, liste]) => liste ?? []).find(c => c.id === id)?.version;
        // ⚠️ ÉCRIRE SANS AVOIR LU EST PRÉCISÉMENT LE GESTE QU'ON FERME.
        if (!version) throw new ApiError(0, 'compétition pas encore chargée — recharger la page');
        const res = await api.patch<CompetitionEcrite, CompetitionPatch & { version: string }>(
          `/competitions/${id}`, toWritePayload({ ...patch, version }));
        // La version suivante, DANS le cache, avant que la prochaine écriture de
        // la file ne la lise.
        qc.setQueriesData<Competition[]>({ queryKey: ['competitions'] }, liste =>
          liste?.map(c => c.id === id ? { ...c, version: res.version } : c));
        return res;
      });
      fileParCompetition.set(id, envoi);
      return envoi;
    },
    // ⚠️ RELIRE MÊME EN ÉCHEC, et c'est le 409 qui l'impose : la compétition a
    // bougé sous nos pieds, donc celle qu'on affiche est FAUSSE. Sans relecture,
    // le coach réessaierait sur son état périmé et récolterait le même refus.
    onSettled: () => void qc.invalidateQueries({ queryKey: ['competitions'] }),
  });
}

export function useDeleteCompetition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      isMock ? mockResolve({ ok: true }) : api.delete(`/competitions/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['competitions'] }),
  });
}

/** Matrice coach × jour d'une compétition. Le serveur la renvoie COMPLÈTE,
 *  `pending` compris — le front n'a donc ni à connaître la liste des coachs ni
 *  à combler les trous. */
export function useCompetitionAvailability(competitionId: string | undefined) {
  return useQuery<CoachAvailability[]>({
    queryKey: ['competition-availability', competitionId],
    queryFn: () => (isMock
      ? mockResolve(mockAvailability(competitionId!))
      : api.get<CoachAvailability[]>(`/competitions/${competitionId}/availability`)),
    enabled: Boolean(competitionId),
    staleTime: 30_000,
  });
}

/** Les athlètes qu'on peut inscrire à cette compétition : TOUS ceux de sa
 *  structure, pour tout coach (FRE-190). Sur un plateau, tous les coachs gèrent
 *  tous les inscrits — la liste ne se limite pas aux athlètes de l'appelant. */
export function useAthletesInscriptibles(competitionId: string | undefined) {
  return useQuery<AthleteInscriptible[]>({
    queryKey: ['competition-athletes', competitionId],
    queryFn: () => (isMock
      ? mockResolve(mockAthletes.map((a): AthleteInscriptible => ({
          id: a.id, firstName: a.firstName, lastName: a.lastName ?? '',
          linkedUserId: a.linkedUserId ?? null, weight: a.weight ?? null, gender: a.gender ?? null,
        })))
      : api.get<AthleteInscriptible[]>(`/competitions/${competitionId}/athletes`)),
    enabled: Boolean(competitionId),
    staleTime: 60_000,
  });
}

/** Les disponibilités déclarées par UN coach, toutes compétitions confondues.
 *
 *  L'autre hook répond à « qui vient à cette compétition ? » ; celui-ci à « à
 *  quelles compétitions va CE coach ? » — la question du calendrier, qui décrit
 *  l'athlète affiché et jamais l'utilisateur connecté. Le serveur ne renvoie que
 *  les lignes déclarées, avec leur statut : c'est à l'appelant de ne retenir que
 *  les `available`. */
export function useCoachAvailability(coachUid: string | null | undefined) {
  return useQuery<CoachCompetitionAvailability[]>({
    queryKey: ['coach-availability', coachUid],
    queryFn: () => (isMock
      ? mockResolve(mockCoachAvailability(coachUid!))
      : api.get<CoachCompetitionAvailability[]>(
          `/competitions/coach-availability?coachUid=${encodeURIComponent(coachUid!)}`,
        )),
    enabled: Boolean(coachUid),
    staleTime: 30_000,
  });
}

export function useSetCoachAvailability(competitionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entry: { coachUid: string; day: string; status: CoachAvailabilityStatus }) =>
      isMock ? mockResolve({ ok: true })
             : api.put<unknown, CoachAvailabilityPut>(`/competitions/${competitionId}/availability`, entry),
    // ⚠️ DEUX RACINES POUR UNE SEULE TABLE (FRE-144) : le calendrier d'un coach
    // lit `['coach-availability', uid]`, qui restait périmé 30 s.
    onSuccess: () => invalider(qc, clesDeDisponibilite(competitionId)),
  });
}
