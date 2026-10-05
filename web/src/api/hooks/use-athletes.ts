import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { mockAthletes, mockResolve, mockStructureDe } from '@/api/mock';
import type { AccesSupportDemande, AccesSupportEcrit, Athlete, AthleteAnnuaire, AthleteArchive, AthleteCoachReassign, AthleteCreate, AthleteKineSet, AthleteProfilePatch } from '@/api/types';
import { useMe } from '@/api/hooks/use-me';
import { useSlugCourant } from '@/api/hooks/use-structure-choisie';
import { isFirebaseConfigured } from '@/firebase';
import { PEREMPTION_HORS_LIGNE_MS } from '@/lib/persistance-hors-ligne';

const isMock = !isFirebaseConfigured;

// ⚠️ `useAthleteDirectory` A ÉTÉ RETIRÉ le 22/08 avec la section Communauté, et
// `GET /athletes` a suivi le 30/08 (FRE-13). Ce commentaire disait l'inverse —
// « le jour où l'annuaire revient, c'est ce hook qu'il faut rétablir, pas
// l'endpoint » — et gardait donc vivante une route que PLUS RIEN n'appelait,
// alors qu'elle servait les 64 fiches à tout membre connecté. Une porte ouverte
// sur une pièce que personne ne visite reste une porte ouverte.
//
// Le type `AthletePublic` reste généré depuis l'OpenAPI : `/athletes/suivis` le
// sert toujours, et `lib/athlete.ts` s'en sert.

/** `?structure=` — la liste bornée à la structure sélectionnée (FRE-13). */
const dans = (slug: string | null) => (slug ? `?structure=${encodeURIComponent(slug)}` : '');
const deLaStructure = (slug: string | null) => (a: Athlete) =>
  !slug || (mockStructureDe[a.id] ?? 'french-forge') === slug;

/** Mes athlètes (coach → gérés, athlète → soi, admin COMPRIS) — champs complets.
 *
 *  ⚠️ LE LIEN, PAS LE RÔLE (FRE-190) : un admin n'y reçoit que ses fiches. Le
 *  sélecteur d'athlète lit cette liste, et une fiche qu'il ne coache pas le
 *  menait à un 403. Toutes les fiches, c'est `useAnnuaireAthletes`.
 *
 *  ⚠️ DANS LA STRUCTURE SÉLECTIONNÉE (FRE-13) : Nico chez SCAPPULIFT reçoit les
 *  fiches qu'il y coache, chez French Forge la sienne. C'est brokkr qui borne
 *  (`?structure=`) ; le slug est dans la clé, donc chaque structure a sa liste
 *  en cache et changer de structure ne mélange rien. */
export function useMyAthletes() {
  const { slug, pret } = useSlugCourant();
  return useQuery<Athlete[]>({
    queryKey: ['athletes', 'mine', slug],
    enabled: pret,
    queryFn: () => (isMock ? mockResolve(mockAthletes.filter(a => a.coachId === 'mock-coach').filter(deLaStructure(slug)))
                           : api.get<Athlete[]>(`/athletes/mine${dans(slug)}`)),
    staleTime: 60_000,
  });
}

/** L'annuaire de l'écran Admin (FRE-190) : TOUTES les fiches de la structure,
 *  et seulement les sept champs qu'il affiche. Admin seul (403 sinon). */
export function useAnnuaireAthletes(enabled: boolean) {
  const { slug, pret } = useSlugCourant();
  return useQuery<AthleteAnnuaire[]>({
    queryKey: ['athletes', 'annuaire', slug],
    enabled: enabled && pret,
    queryFn: () => (isMock
      ? mockResolve(mockAthletes.filter(deLaStructure(slug)).map((a): AthleteAnnuaire => ({
          id: a.id, firstName: a.firstName, lastName: a.lastName ?? '', email: a.email ?? null,
          linkedUserId: a.linkedUserId ?? null, coachId: a.coachId ?? null, kineUid: a.kineUid ?? null,
        })))
      : api.get<AthleteAnnuaire[]>(`/athletes/annuaire${dans(slug)}`)),
    staleTime: 60_000,
  });
}

/** MA PROPRE FICHE D'ATHLÈTE, gardée sur le téléphone — FRE-118.
 *
 *  ⚠️ POURQUOI UNE ENTRÉE DE CACHE À CÔTÉ DE LA LISTE. `/athletes/mine` rend
 *  l'athlète lui-même quand c'est un athlète qui demande, et les soixante d'un
 *  coach sinon. On ne veut pas d'un annuaire sur le disque d'un téléphone ; mais
 *  ne rien garder du tout revient à ce que William a constaté en coupant son
 *  Wi-Fi : « Aucun athlète sélectionné », et aucun à sélectionner. Sa semaine
 *  était bien là, sur le disque, et rien ne pouvait la relier à quelqu'un.
 *
 *  C'était ma règle « jamais plus d'une fiche » qui l'excluait — juste sur
 *  l'intention, fausse sur le monde réel : le premier utilisateur du produit est
 *  coach ET athlète. La borne est la même, un athlète au plus ; c'est le CHOIX
 *  qui change, et il devient explicite : celui qu'on garde, c'est SOI.
 *
 *  ⚠️ ELLE NE VA JAMAIS CHERCHER RIEN. Il n'existe pas de route « mon athlète » —
 *  et il n'en faut pas : la donnée est déjà dans `/athletes/mine`. Cette entrée
 *  n'est qu'une VUE de la liste, recopiée à chaque chargement, et dont la seule
 *  raison d'être est de survivre au disque toute seule. Hors ligne, elle est
 *  tout ce qui reste. */
export const CLE_MON_ATHLETE = ['mon-athlete'] as const;

export function useMonAthlete() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: miens } = useMyAthletes();

  useEffect(() => {
    const mien = miens?.find(a => a.id === me?.athleteId);
    // ⚠️ ON N'ÉCRASE PAS AVEC RIEN. Tant que la liste n'est pas chargée — hors
    // ligne, elle ne le sera jamais — la fiche relue du disque doit rester.
    if (mien) qc.setQueryData(CLE_MON_ATHLETE, mien);
  }, [me?.athleteId, miens, qc]);

  return useQuery<Athlete | null>({
    queryKey: CLE_MON_ATHLETE,
    // Jamais appelée : `enabled: false`. La donnée n'arrive que par l'effet
    // ci-dessus, ou du disque au démarrage.
    queryFn: () => null,
    enabled: false,
    gcTime: PEREMPTION_HORS_LIGNE_MS,
  });
}

/** Les athlètes SUIVIS par l'appelant kiné (athletes.kine_uid = moi).
 *
 *  Requête SÉPARÉE de /mine et FUSIONNÉE par le provider de sélection : un kiné
 *  peut être AUSSI athlète (le cas réel du premier jour) ou coach — le choix
 *  « l'une OU l'autre liste » perdait ses suivis dès qu'il portait un autre
 *  rôle. Vide (et non déclenchée) pour qui n'est pas kiné. */
export function useAthletesSuivis() {
  const { data: me } = useMe();
  const { slug } = useSlugCourant();
  return useQuery<Athlete[]>({
    queryKey: ['athletes', 'suivis', slug],
    // ⚠️ UN SUIVI RÉEL EN DEV-MOCK, PLUS UNE LISTE VIDE. `[]` rendait
    // `kineDeCetAthlete` toujours faux, donc `canMedical` égal à `isSelf` : le
    // parcours du PRATICIEN n'existait nulle part dans le harnais. Théo joue ce
    // rôle — Léa reste le cas « c'est mon propre bilan », et les deux mondes se
    // voient enfin dans la même session, comme chez un coach-kiné réel.
    queryFn: () => (isMock ? mockResolve(mockAthletes.filter(a => a.id === 'mock-theo').filter(deLaStructure(slug)))
                           : api.get<Athlete[]>(`/athletes/suivis${dans(slug)}`)),
    // ⚠️ LE `!isMock` A ÉTÉ RETIRÉ, ET C'ÉTAIT LA VRAIE RACINE DU TROU. La
    // requête était DÉSACTIVÉE en dev-mock : peu importait ce que `queryFn`
    // rendait, elle ne partait jamais. `suivisIds` restait donc vide en toutes
    // circonstances, `kineDeCetAthlete` toujours faux, et le parcours du
    // praticien inatteignable — dans le seul harnais où l'écran est traversé.
    //
    // La condition qui compte est le RÔLE, pas le mode : « vide, et non
    // déclenchée, pour qui n'est pas kiné », dit l'en-tête. Le dev-mock n'avait
    // pas à en être exclu — il devait seulement avoir un kiné à jouer.
    enabled: Boolean(me?.isKine),
    staleTime: 60_000,
  });
}

/** PATCH /athletes/{id}/kine — le coach confie (ou retire) le suivi kiné.
 *  `kineUid: null` détache ; 422 si l'uid n'est pas un kiné déclaré. */
export function useSetAthleteKine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ athleteId, kineUid }: { athleteId: string; kineUid: string | null }) =>
      isMock ? mockResolve({ ok: true }) : api.patch<unknown, AthleteKineSet>(`/athletes/${athleteId}/kine`, { kineUid }),
    onSuccess: () => invalidateAthletes(qc),
  });
}

/** PATCH /athletes/{id}/archive — SON coach uniquement (autz serveur).
 *
 *  ⚠️ ARCHIVER N'EST PAS SUPPRIMER, ni détacher. L'athlète garde son programme,
 *  son historique et son coach — il disparaît des LISTES, et il en revient. Le
 *  geste n'a donc pas besoin de confirmation : il est réversible d'un clic, et
 *  la règle maison « toute suppression demande confirmation » ne le vise pas. */
export function useArchiverAthlete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ athleteId, archive }: { athleteId: string; archive: boolean }) =>
      isMock ? mockResolve({ ok: true }) : api.patch<unknown, AthleteArchive>(`/athletes/${athleteId}/archive`, { archive }),
    onSuccess: () => invalidateAthletes(qc),
  });
}

function invalidateAthletes(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['athletes'] });
}

/** PATCH /athletes/{id}/profile — coach gestionnaire uniquement (autz serveur). */
export function usePatchAthleteProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ athleteId, patch }: { athleteId: string; patch: AthleteProfilePatch }) =>
      isMock ? mockResolve({ ok: true }) : api.patch<unknown, AthleteProfilePatch>(`/athletes/${athleteId}/profile`, patch),
    onSuccess: () => invalidateAthletes(qc),
  });
}

// ⚠️ `useDetacherLeCompte` (DELETE /athletes/{id}/link) A ÉTÉ RETIRÉ le 22/08,
// avec le bouton qui l'appelait : le cas n'est jamais arrivé et se traitera à
// la main. La route reste côté brokkr, sans affordance.

/** POST /athletes — création/invitation (coach). */
export function useCreateAthlete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ firstName, email }: { firstName: string; email: string }) =>
      isMock
        ? mockResolve({ id: 'mock-new', programId: 'mock-new-program' })
        : api.post<{ id: string; programId: string }, AthleteCreate>('/athletes', { firstName, email }),
    onSuccess: () => invalidateAthletes(qc),
  });
}

/** PATCH /athletes/{id}/coach — réassignation (admin). */
/** L'admin s'ouvre un accès support à un athlète, ou le ferme (FRE-202). Tant
 *  qu'il court, l'athlète est dans `/athletes/mine` avec sa fin, et
 *  `athlete-selection` en tire les droits du coach et du kiné. */
export function useAccesSupport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ athleteId, ouvrir }: { athleteId: string; ouvrir: boolean }): Promise<AccesSupportEcrit> =>
      isMock ? mockResolve<AccesSupportEcrit>({ ok: true, supportJusquAu: null })
        : ouvrir ? api.post<AccesSupportEcrit, AccesSupportDemande>(`/athletes/${athleteId}/support`, { heures: 24 })
                 : api.delete<AccesSupportEcrit>(`/athletes/${athleteId}/support`),
    onSuccess: () => invalidateAthletes(qc),
  });
}

export function useReassignCoach() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ athleteId, coachUid }: { athleteId: string; coachUid: string }) =>
      isMock ? mockResolve({ ok: true, programIds: [] }) : api.patch<unknown, AthleteCoachReassign>(`/athletes/${athleteId}/coach`, { coachUid }),
    onSuccess: () => invalidateAthletes(qc),
  });
}
