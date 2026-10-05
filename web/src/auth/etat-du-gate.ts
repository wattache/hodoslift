import type { LiaisonAthlete, Me } from '@/api/types';

/** Ce que le gate d'accès doit montrer, et rien d'autre.
 *
 *  ⚠️ POURQUOI CETTE DÉCISION EST SORTIE DU COMPOSANT. Elle tenait en une
 *  condition booléenne au milieu du JSX, et cette condition a menti à des
 *  athlètes pendant des semaines sans que rien ne puisse le voir : le projet n'a
 *  pas d'environnement de test de composant, donc ce `if` n'était couvert par
 *  aucune spec. Ici, il l'est.
 *
 *  ⚠️ LA RÈGLE, EN UNE PHRASE : **on n'accuse que sur une réponse REÇUE.**
 *
 *  « Ton coach ne t'a pas enregistré » est une affirmation sur le compte. Elle
 *  n'est légitime que si le serveur a répondu et que sa réponse ne donne aucun
 *  accès. Tant qu'on n'a pas de réponse — erreur, réseau absent, requête jamais
 *  partie — la seule chose vraie est « je ne sais pas ». */
export type EtatDuGate =
  /** Personne n'est connecté : page de connexion. */
  | { quoi: 'login' }
  /** On attend : Firebase, le profil, ou le rattachement automatique. */
  | { quoi: 'chargement'; rattachement: boolean }
  /** Le serveur a répondu, et il a répondu une ERREUR. */
  | { quoi: 'erreur' }
  /** Aucune réponse — et on distingue « hors ligne » du reste, parce que le geste
   *  à faire n'est pas le même : attendre le réseau, ou réessayer. */
  | { quoi: 'sans-reponse'; horsLigne: boolean }
  /** Réponse reçue, et elle n'ouvre rien : LÀ, on peut le dire. `motif` dit
   *  QUOI dire — voir `motifDuRattachement` ci-dessous. */
  | { quoi: 'non-autorise'; motif: MotifDeRefus }
  | { quoi: 'ok' };

/** Pourquoi `POST /athletes/link` n'a rattaché personne (FRE-76).
 *
 *  ⚠️ CETTE DISTINCTION EST TOUT LE TICKET. Le gate n'avait qu'un booléen, donc
 *  une seule phrase — « ton coach ne t'a pas encore enregistré » — servie aussi
 *  bien à qui n'est pas athlète (vrai) qu'à un athlète dont l'uid Firebase a
 *  changé (faux, et il accuse son coach). Le second est en plus bloqué
 *  définitivement : aucun geste de sa part n'y change rien.
 *
 *  `null` = le rattachement n'a pas été tenté (pas encore, ou pas nécessaire).
 *
 *  ⚠️ DÉRIVÉ DU CONTRAT, PAS RECOPIÉ. Le vocabulaire est clos et il appartient à
 *  brokkr : un motif ajouté côté serveur arrive ici tout seul, et un motif
 *  renommé fait rougir la compilation au lieu de laisser l'écran choisir la
 *  mauvaise phrase. Le `| null` en revanche est bien local — il dit « pas
 *  tenté », qui n'est pas une réponse du serveur. */
export type MotifDeRefus = NonNullable<LiaisonAthlete['motif']> | null;

export interface EntreesDuGate {
  devMode: boolean;
  /** L'utilisateur Firebase — `null` tant qu'il n'est pas connecté. */
  user: unknown;
  authLoading: boolean;
  me: Me | undefined;
  meLoading: boolean;
  meError: unknown;
  /** Le rattachement automatique est en cours (`POST /athletes/link`). */
  linking: boolean;
  /** `navigator.onLine`, via `onlineManager` de TanStack Query. */
  enLigne: boolean;
  /** Ce que `POST /athletes/link` a répondu, s'il a été tenté. */
  motifDuRattachement?: MotifDeRefus;
}

export function etatDuGate(e: EntreesDuGate): EtatDuGate {
  if (e.devMode) return { quoi: 'ok' };
  if (e.authLoading || (e.user && e.meLoading) || e.linking) {
    return { quoi: 'chargement', rattachement: e.linking };
  }
  if (!e.user) return { quoi: 'login' };

  // ⚠️ LE CAS QUI A FAIT L'INCIDENT DU 21/08, et il n'a rien d'exotique.
  //
  // `useQuery` tourne en `networkMode: 'online'` (le défaut de TanStack). Hors
  // ligne, il ne lance PAS la requête et ne produit AUCUNE erreur : il MET EN
  // PAUSE. On se retrouve donc avec `me` undefined, `meError` null et
  // `meLoading` false — trois signaux qui, pris ensemble, ne veulent pas dire
  // « compte inconnu » mais « je n'ai rien demandé ».
  //
  // La condition d'avant était `!me || (aucun rôle)`, et ce `!me` envoyait droit
  // sur « ton coach ne t'a pas encore enregistré ». Sur une app qu'on utilise en
  // salle, c'est-à-dire là où le réseau tombe, le message accusait le coach à
  // tort. Vécu par Kévin, puis par un second athlète dont la phrase a donné la
  // clé : « ça m'arrive quand je n'ai pas de connexion ». Côté serveur il n'y
  // avait rien à voir — pas une erreur, pas même une requête.
  // ⚠️ UN PROFIL EN MAIN BAT UNE ERREUR DE RAFRAÎCHISSEMENT (FRE-121), et
  // l'ORDRE de ces deux tests est tout le correctif.
  //
  // L'erreur était regardée en PREMIER. C'était sans conséquence tant qu'un
  // échec voulait dire « pas de profil » — les deux allaient ensemble. Depuis
  // que le profil est persisté sur le disque (FRE-118), il survit à l'échec :
  // on a alors une donnée valable ET une erreur, et le gate barrait la route
  // en montrant l'erreur.
  //
  // Vécu par William, hors ligne, avec sa semaine sur le téléphone :
  // « Serveur injoignable », `auth/network-request-failed`. Le jeton Firebase
  // expire au bout d'une heure et son rafraîchissement demande le réseau ; sans
  // réseau il échoue, et cet échec suffisait à masquer un profil parfaitement
  // bon. C'est exactement ce que le hors-ligne promet de ne PAS faire.
  //
  // La règle du fichier ne change pas — on n'accuse que sur une réponse reçue.
  // Elle se complète : une réponse reçue AUTREFOIS reste une réponse reçue.
  if (!e.me) {
    if (e.meError) return { quoi: 'erreur' };
    return { quoi: 'sans-reponse', horsLigne: !e.enLigne };
  }

  if (!e.me.isCoach && !e.me.isAdmin && !e.me.isKine && !e.me.athleteId) {
    return { quoi: 'non-autorise', motif: e.motifDuRattachement ?? null };
  }
  return { quoi: 'ok' };
}

/** Faut-il tenter le rattachement automatique (`POST /athletes/link`) ?
 *
 *  ⚠️ IL FAUT UN PROFIL, pas seulement l'absence d'`athleteId`. Sans réponse on
 *  ne sait pas s'il y a quelque chose à rattacher : on partait alors tenter un
 *  POST voué à échouer, en affichant « Bienvenue ! » à quelqu'un qui n'a pas de
 *  réseau. */
export function doitTenterLeRattachement(e: {
  devMode: boolean; user: unknown; apiConfiguree: boolean;
  linking: boolean; linkChecked: boolean; meLoading: boolean; me: Me | undefined;
}): boolean {
  if (e.devMode || !e.user || !e.apiConfiguree) return false;
  if (e.linking || e.linkChecked || e.meLoading) return false;
  return Boolean(e.me) && !e.me!.athleteId;
}
