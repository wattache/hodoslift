import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { del, get, set } from 'idb-keyval';
import type { QueryKey } from '@tanstack/react-query';

/** LE CACHE QUI SURVIT À LA FERMETURE — pour s'entraîner hors ligne (FRE-118).
 *
 *  ⚠️ LE PROBLÈME N'ÉTAIT PAS LE SERVICE WORKER. Il sert déjà la coque hors
 *  ligne, et il ne cache QUE le même domaine — l'API brokkr est cross-origin, et
 *  c'est un bon choix qu'on ne change pas : un cache HTTP servirait des séances
 *  périmées à un athlète sans qu'il puisse le savoir. Ce qui manquait, c'est que
 *  le cache de TanStack Query vit EN MÉMOIRE : il disparaît au rechargement.
 *  L'athlète ouvrait donc l'app en salle, voyait sa coque, et aucune donnée.
 *
 *  ⚠️ ON NE PERSISTE QUE L'ÉCRAN D'ENTRAÎNEMENT, et c'est le périmètre qui
 *  protège, pas une précaution à se rappeler. Un coach a soixante athlètes ; son
 *  annuaire, ses bilans, ses compétitions ne touchent jamais le disque de son
 *  téléphone. Ce qu'on garde tient à ce qu'il faut pour SAISIR une séance.
 *
 *  Ce périmètre est devenu tenable grâce à FRE-119 : l'écran lisait l'arbre
 *  ENTIER du programme (512 Ko sur le plus fourni, et une semaine de plus chaque
 *  semaine), il lit maintenant la charpente et le bloc courant — 66 à 104 Ko. Le
 *  découpage à faire sur le disque était déjà fait en amont, il n'y a donc aucun
 *  élagage à écrire ici. */

/** Les clés que l'on garde, et la raison de chacune.
 *
 *  ⚠️ UNE LISTE BLANCHE, JAMAIS UNE LISTE NOIRE. Une requête neuve n'est pas
 *  persistée tant que personne ne l'a décidé : c'est ce qui empêche qu'un
 *  domaine ajouté dans six mois se retrouve sur le disque parce que personne
 *  n'aura pensé à l'exclure. */
const CLES_PERSISTEES = new Set([
  // ⚠️ MA PROPRE FICHE, ET ELLE SEULE. Sans elle, le hors-ligne ne sert à rien :
  // c'est de là que vient le `programId`, donc la charpente et le contenu. Avec
  // l'annuaire entier, ce serait soixante fiches sur le téléphone d'un coach.
  //
  // La première version persistait `['athletes','mine']` quand la liste ne
  // portait qu'un nom — bornée par la TAILLE. Juste sur l'intention, fausse sur
  // le monde réel : le premier utilisateur du produit est coach ET athlète, sa
  // liste en compte soixante, et couper son Wi-Fi lui donnait « Aucun athlète
  // sélectionné » avec sa semaine sur le disque à côté. Même borne — un athlète
  // au plus — mais le choix est désormais EXPLICITE : c'est soi.
  'mon-athlete',
  // La charpente du programme : la barre, les blocs, les semaines et leurs
  // dates. 10 Ko, et elle ne grossit que de quelques centaines d'octets par
  // semaine ajoutée.
  'structure',
  // Le contenu du bloc regardé — les séances et leurs lignes. C'est ce qu'on
  // vient saisir.
  'block-content',
  // ⚠️ SANS `me`, TOUT LE RESTE NE SERT À RIEN. Le gate d'authentification
  // interroge `/users/me` avant de laisser passer ; hors ligne, `useQuery` MET
  // EN PAUSE (networkMode 'online') et l'écran s'arrête sur « pas de
  // connexion ». L'athlète aurait sa séance sur le disque et ne l'atteindrait
  // jamais. C'est le même trou qui, en ligne, avait produit l'incident du 21/08.
  'me',
]);

/** ⚠️ LA BORNE TIENT EN UNE PHRASE : le disque ne porte jamais plus d'UNE fiche
 *  d'athlète, et c'est la sienne. Elle n'est plus vérifiée à l'exécution mais
 *  garantie par la CLÉ elle-même — `mon-athlete` ne peut en contenir qu'une, là
 *  où `['athletes','mine']` en portait soixante chez un coach. Une borne qu'on
 *  ne peut pas franchir vaut mieux qu'une borne qu'on teste. */
export function estPersistee(cle: QueryKey): boolean {
  return typeof cle[0] === 'string' && CLES_PERSISTEES.has(cle[0]);
}

/** ⚠️ EXPORTÉE PARCE QU'ON LA RELIT (FRE-118). L'indicateur « disponible hors
 *  ligne » interroge le DISQUE au lieu de supposer que l'écriture a eu lieu ; il
 *  lui faut donc la même clé, et il n'y en a qu'une définition. */
export const CLE_DU_CACHE = 'eitri-cache-hors-ligne';

export const persisterHorsLigne = createAsyncStoragePersister({
  storage: {
    getItem: async (cle: string) => (await get<string>(cle)) ?? null,
    setItem: (cle: string, valeur: string) => set(cle, valeur),
    removeItem: (cle: string) => del(cle),
  },
  key: CLE_DU_CACHE,
  // Les écritures partent au plus une fois par seconde : une rafale de frappes
  // ne doit pas produire une rafale d'écritures disque.
  throttleTime: 1000,
});

/** Combien de temps une donnée non rafraîchie reste affichable — sept jours.
 *
 *  ⚠️ CE N'EST PAS LA FRAÎCHEUR, C'EST LA PÉREMPTION. Le `staleTime` de chaque
 *  requête décide quand REDEMANDER ; celui-ci décide quand JETER. Un athlète qui
 *  part une semaine en vacances doit retrouver son programme au retour, même
 *  sans réseau à l'ouverture. Au-delà, une séance affichée serait plus
 *  trompeuse qu'utile. */
export const PEREMPTION_HORS_LIGNE_MS = 7 * 24 * 60 * 60 * 1000;
