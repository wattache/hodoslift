/** LES FAMILLES DE CLÉS QU'UNE ÉCRITURE PÉRIME (FRE-144).
 *
 *  ⚠️ CE FICHIER NE DÉCLARE PAS LES 30 CLÉS DU FRONT, ET C'EST DÉLIBÉRÉ. Le
 *  ticket proposait une fabrique complète ; la mesure dit que ce n'est pas là
 *  que ça a dérivé. Les `queryKey` des LECTURES vivent à côté de leur `useQuery`,
 *  chacune à un seul endroit, et aucune n'a jamais divergé. Les réécrire toutes
 *  aurait produit trente occasions de faire une faute de frappe qu'aucun test ne
 *  voit — une clé fautive ne casse rien, elle cesse simplement d'être invalidée.
 *
 *  Ce qui a dérivé, c'est l'INVALIDATION : « qu'est-ce que cette écriture
 *  périme ? ». La réponse était répartie entre chaque `onSuccess`, chaque
 *  appelant devant se souvenir des lectures DÉRIVÉES qu'il ne voit pas depuis
 *  son écran. Six l'ont oubliée. C'est cette question-là, et elle seule, qui a
 *  besoin d'une adresse unique.
 */

import type { QueryClient, QueryKey } from '@tanstack/react-query';

/** L'ARBRE D'UN PROGRAMME — les trois lectures que FRE-119 a découpées.
 *
 *  Une création ou une suppression change la FORME de l'arbre, pas seulement son
 *  contenu : la charpente est donc invalidée avec le reste. */
export function clesDeLArbre(programId: string | null | undefined): QueryKey[] {
  return [['structure', programId], ['block-content', programId], ['training', programId]];
}

/** ⚠️ CE QUE LE SERVEUR RECALCULE À PARTIR DES MÊMES LIGNES, et que l'écran ne
 *  redemande jamais tout seul.
 *
 *  Les records et la forme du jour ne sont pas des copies de l'arbre : brokkr
 *  les dérive des tables VIVANTES à chaque appel. Une ligne d'entraînement qui
 *  part modifie donc leur résultat, sans qu'aucun composant de l'écran de saisie
 *  ne le sache — ils sont lus par le tableau de bord, ailleurs.
 *
 *  ⚠️ ET `useRecords` PROMET L'INVERSE DANS SON COMMENTAIRE : « un PR apparaît à
 *  la seconde où l'athlète note son RPE ». C'est vrai du serveur, et c'était faux
 *  de l'écran — avec `staleTime: 60_000` et aucune invalidation, le tableau de
 *  bord montrait les records d'avant la séance pendant une minute. Le commentaire
 *  promettait exactement ce que l'invalidation manquante cassait.
 *
 *  Sans athlète en argument : `invalidateQueries` compare par PRÉFIXE, donc
 *  `['records']` couvre `['records', <n'importe qui>]`. C'est ce qu'on veut ici —
 *  la file d'écritures ne connaît que le programme, pas l'athlète. */
export function clesDeriveesDuRealise(): QueryKey[] {
  // ⚠️ LE CONTENU DU BLOC AUSSI (14/09). Il porte `lignesSansRessenti`, que brokkr
  // compte à la lecture (FRE-160) — et rien ne le relisait après une saisie :
  // Willi a noté ses trois RPE manquants, la base n'avait plus aucun trou, et
  // l'en-tête affichait toujours « 1 sans ressenti » jusqu'au rechargement.
  // Recompter au front aurait dupliqué la règle ; on relit.
  return [['records'], ['forme-du-jour'], ['block-content']];
}

export function clesDuQuotidien(athleteId: string | null | undefined): QueryKey[] {
  return [['daily-logs', athleteId], ['poids-semaines', athleteId]];
}

/** UNE DOULEUR EST LUE SOUS TROIS RACINES : la liste de l'athlète, le tableau
 *  des signalements et la file du guichet — brokkr dérive les deux derniers de
 *  `douleur_logs`. Noter une douleur périme donc les trois.
 *
 *  ⚠️ C'EST LE DÉFAUT DE FRE-144, DÉPLACÉ AVEC LA DONNÉE. Il tenait au journal
 *  quotidien tant que le signalement y vivait ; le suivre ici est ce qui évite
 *  de le redécouvrir par un staff qui voit une file vide après une correction. */
export function clesDUneDouleur(athleteId: string | null | undefined): QueryKey[] {
  // ⚠️ ET SON HISTOIRE (FRE-197) : noter une douleur ajoute un point à sa
  // courbe. Sans cette racine, la carte ouverte garde la veille à l'écran.
  return [['douleurs', athleteId], ['douleur-logs'], ['signalements'], ['guichet']];
}

/** LA DISPONIBILITÉ D'UN COACH, elle aussi lue sous deux racines : la grille
 *  d'une compétition, et le calendrier d'un coach donné. Même table. */
export function clesDeDisponibilite(competitionId: string): QueryKey[] {
  return [['competition-availability', competitionId], ['coach-availability']];
}

/** Invalide une famille. Le `void` est ici plutôt qu'à chaque appel : ces
 *  invalidations ne sont jamais attendues, elles marquent périmé et laissent
 *  TanStack recharger ce qui est monté. */
export function invalider(qc: QueryClient, cles: QueryKey[]): void {
  for (const queryKey of cles) void qc.invalidateQueries({ queryKey });
}
