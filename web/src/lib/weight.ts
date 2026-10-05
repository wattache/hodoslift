import type { ExerciseEditing } from '@/api/types';

/** Charge saisie en texte libre → nombre. Les coachs écrivent « 47,5 » aussi
 *  souvent que « 47.5 ». Retourne 0 si ce n'est pas une charge exploitable.
 *
 *  ⚠️ ACCEPTE `null` DEPUIS FRE-137 : le serveur ne déguise plus une absence en
 *  chaîne vide, et cette fonction la traitait déjà (`value || ''`). C'est la
 *  signature qui mentait, pas le corps. */
export function parseWeight(value: string | null | undefined): number {
  const n = parseFloat((value || '').replace(',', '.'));
  return isNaN(n) || n <= 0 ? 0 : n;
}

/** Charge qui fait foi pour tout ce qui relève du RÉALISÉ — tonnage, records,
 *  courbes de progression.
 *
 *  Le réel s'il a été saisi, sinon le prescrit. Le repli n'est pas une
 *  approximation : sans saisie, la séance est réputée faite comme prévue, et
 *  c'est aussi ce qui garde exploitable tout l'historique antérieur à
 *  `weightDone`.
 *
 *  ⚠️ À ne PAS utiliser pour les vues de PRÉVISION (BASE, génération de la
 *  semaine suivante, incréments) : elles raisonnent sur la consigne, et
 *  s'appuyer sur le réel y ferait dériver la programmation toute seule. */
export function effectiveWeight(ex: Pick<ExerciseEditing, 'weight' | 'weightDone'>): number {
  return parseWeight(ex.weightDone) || parseWeight(ex.weight);
}

/** Même règle, forme TEXTE — pour l'affichage, qui doit rendre la saisie telle
 *  qu'elle a été écrite (« 47,5 » reste « 47,5 »). Deux fonctions, une seule
 *  règle : dupliquer le repli ailleurs, c'est prendre le risque qu'il diverge. */
export function effectiveWeightText(ex: Pick<ExerciseEditing, 'weight' | 'weightDone'>): string {
  return parseWeight(ex.weightDone) > 0 ? ex.weightDone!.trim() : (ex.weight ?? '');
}

/** Affichage « prescrit → réel », sur le modèle de `formatReps` (répétitions)
 *  et `formatRestWithActual` (repos) : la consigne reste visible, l'écart se
 *  lit d'un coup d'œil. Rien n'est ajouté quand le réel est absent ou
 *  identique. */
export function formatWeightWithActual(weight: string | null | undefined, weightDone?: string | null): string {
  const prescribed = parseWeight(weight);
  const done = parseWeight(weightDone);
  if (!prescribed && !done) return '';
  if (!done || done === prescribed) return `${weight} kg`;
  if (!prescribed) return `${weightDone} kg`;
  return `${weight} kg → ${weightDone} kg`;
}


/** CE QU'ON AFFICHE dans la colonne « charge » : la charge, l'assistance, ou les
 *  deux — et jamais rien qui soit vide.
 *
 *  ⚠️ UNE SEULE FONCTION POUR LES DEUX VUES, et c'est tout l'objet. L'Aperçu et le
 *  Détail calculaient ça chacun de leur côté, et ils ont divergé : le Détail testait
 *  `ex.weight ? charge : assistance`, un TERNAIRE. Or `'0'` est une chaîne non vide
 *  — donc truthy — alors que `formatWeightWithActual('0')` rend `''`. Un exercice à
 *  charge 0 AVEC une bande n'affichait donc NI l'une NI l'autre, pendant que
 *  l'Aperçu montrait la bande. Signalé en production le 20/08 : deux athlètes avec
 *  la même bande voyaient deux choses différentes selon que le coach avait tapé
 *  « 0 » ou laissé le champ vide.
 *
 *  Les DEUX quand les deux existent : 7 lignes de production portent une vraie
 *  charge ET une assistance (sur 208 avec assistance). Un lesté avec bande est une
 *  prescription réelle, pas une saisie douteuse — en choisir une seule perdrait de
 *  l'information. */
export function chargeEtAssistance(ex: Pick<ExerciseEditing, 'weight' | 'weightDone' | 'assistance'>): string[] {
  return [formatWeightWithActual(ex.weight, ex.weightDone), (ex.assistance ?? '').trim()]
    .filter(Boolean);
}
