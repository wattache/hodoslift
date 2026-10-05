import type { CalendarEvent, CalendarEventInput } from '@/api/types';

/** LES CATÉGORIES D'ÉVÉNEMENT, ET LA LECTURE QUI EN DÉPEND.
 *
 *  ⚠️ ELLES VIVENT ICI PLUTÔT QUE DANS LA VUE (FRE-140) parce que la règle se
 *  teste : `draftFromEvent` traduit ce que le serveur rend en ce que le
 *  formulaire édite, et c'est là qu'un type se perdait en silence. Exportée
 *  depuis `calendar.tsx`, elle faisait rougir le lint — une vue n'exporte que
 *  des composants — ce qui était le bon signal.
 */

/** Le vocabulaire d'ÉCRITURE du serveur, engendré depuis le contrat — jamais
 *  recopié.
 *
 *  ⚠️ CELUI DE L'ÉCRITURE, ET PLUS CELUI DE LA LECTURE (16/09). Les deux ont
 *  divergé le jour où la compétition a cessé de se saisir depuis le calendrier :
 *  elle se lit encore (13 lignes de production, dont 11 à venir), elle ne
 *  s'écrit plus. Les tuiles décrivent ce qu'on peut ÉCRIRE — les accrocher à la
 *  lecture rouvrirait le formulaire sur une valeur que le serveur refuse.
 *
 *  Plus de `cycle` non plus : la phase du cycle est un fait du jour, dans le
 *  Tracker (FRE-173), et la valeur a quitté l'enum le 13/09. */
type TypeAvecTuile = NonNullable<CalendarEventInput['type']>;

/** Catégories d'événement → emoji. */
export const EVENT_CATEGORIES = [
  // ⚠️ PLUS DE TUILE `competition` (William, 16/09) : « une compétition n'est
  // définie que dans l'onglet dédié, plus en standalone depuis le calendrier ».
  // Elle y porte un lieu, des mouvements, des essais, des participants ; ici elle
  // n'avait qu'un nom et deux dates, et fabriquait une compétition FANTÔME —
  // affichée comme telle sur la frise, sans fiche à ouvrir derrière.
  { type: 'vacation', emoji: '🌴', cle: 'calendar.categorieVacances' },
  { type: 'travel', emoji: '💼', cle: 'calendar.categorieDeplacement' },
  // ⚠️ `rest` EXISTAIT CÔTÉ SERVEUR SANS TUILE ICI (FRE-140). L'enum
  // `event_type` le connaît depuis toujours ; le front, non. Conséquence :
  // `draftFromEvent` retombait sur `other`, donc ouvrir un jour de repos en
  // édition le RÉÉCRIVAIT en « autre » à l'enregistrement, sans erreur.
  //
  // Ajouter la tuile plutôt que retirer la valeur : c'est additif et réversible,
  // là où retirer une valeur d'un enum Postgres demande de recréer le type. Et
  // zéro événement `rest` existe en base (sur 28) — le choix ne reprend rien.
  { type: 'rest', emoji: '😴', cle: 'calendar.categorieRepos' },
  { type: 'other', emoji: '📌', cle: 'calendar.categorieAutre' },
] as const satisfies readonly { type: TypeAvecTuile; emoji: string; cle: string }[];

/** ⚠️ LA GARDE QUI REND LE DÉFAUT `rest` IMPOSSIBLE (FRE-157).
 *
 *  Le `satisfies` ci-dessus refuse une tuile INVENTÉE ; il ne dit rien d'une
 *  tuile MANQUANTE, et c'est précisément ce qui s'était passé — `rest` existait
 *  au serveur, la liste ne le portait pas, et un jour de repos ouvert en édition
 *  se réécrivait en « autre » sans la moindre erreur.
 *
 *  Cette ligne compare les deux sens : si le serveur gagne une valeur d'enum que
 *  la liste n'a pas, le type devient `never` et le fichier ne compile plus. La
 *  prochaine valeur se voit donc à la régénération du contrat, pas dans six mois
 *  sur le calendrier d'un athlète.
 *
 *  ⚠️ ET UNE SPEC NE POUVAIT PAS LE FAIRE : celle qui existe recopie la même
 *  liste (`it.each([...])`), donc elle manque exactement ce que la liste manque. */
const _TOUTES_LES_TUILES_EXISTENT: TypeAvecTuile extends (typeof EVENT_CATEGORIES)[number]['type']
  ? true : never = true;
void _TOUTES_LES_TUILES_EXISTENT;

export type DraftType = (typeof EVENT_CATEGORIES)[number]['type'];

export interface DraftEvent {
  id?: string;
  type: DraftType;
  name: string;
  emoji: string;
  startDate: string;
  endDate: string;
  canTrain: boolean;
}

export function draftFromEvent(ev: CalendarEvent): DraftEvent {
  // ⚠️ LA LISTE SE DÉRIVE DES TUILES, elle ne se recopie pas (FRE-140) : c'est
  // la recopie qui avait laissé `rest` de côté. Ajouter une catégorie suffit
  // désormais — ici il n'y a plus rien à penser.
  // ⚠️ UN TYPE SANS TUILE NE SE RÉÉCRIT PAS EN SILENCE (la leçon de `rest`,
  // FRE-140) : `draftFromEvent` n'est plus appelée sur un événement de type
  // `competition`, et l'écran ne propose pas de l'éditer — voir `estModifiable`.
  const rawType = EVENT_CATEGORIES.some(c => c.type === ev.type)
    ? ev.type as DraftEvent['type']
    : 'other';
  const category = EVENT_CATEGORIES.find(c => c.type === rawType);

  return {
    id: ev.id,
    type: rawType,
    name: ev.name,
    emoji: category?.emoji ?? '📌',
    startDate: ev.startDate,
    endDate: ev.endDate ?? ev.startDate,
    canTrain: ev.canTrain ?? true, // défaut optimiste pour les events historiques sans le champ
  };
}

/** Un événement se modifie-t-il depuis le calendrier ?
 *
 *  ⚠️ NON POUR UNE COMPÉTITION (16/09) : le serveur refuse désormais ce type à
 *  l'écriture, donc le front ne doit pas proposer le geste — règle d'affordance.
 *  Et l'ouvrir « en autre » pour contourner le refus réécrirait ce que l'athlète
 *  a noté. Elle reste SUPPRIMABLE : c'est le seul geste qui ne ment pas. */
export const estModifiable = (ev: CalendarEvent): boolean => ev.type !== 'competition';
