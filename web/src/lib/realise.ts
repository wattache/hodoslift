import type { Exercise } from '@/api/types';

/** ⚠️ LA FORME MINIMALE, PAS `Session` : l'arbre en cours d'édition porte des
 *  lignes `…Editing` (identité en attente), et exiger le type de LECTURE aurait
 *  obligé chaque appelant à convertir — ou, plus probablement, à recopier la
 *  règle à côté. C'est la famille du milieu de FRE-70. */
type LigneFaisable = Pick<Exercise, 'feltRPE' | 'feltRPEBySet'>;
type SeanceFaisable = { exercises: readonly LigneFaisable[] };

/** CE QUI COMPTE COMME FAIT — une seule définition, côté front (20/09).
 *
 *  ⚠️ ELLE EXISTAIT EN DOUBLE, ET PLUS ÉTROITE QUE CELLE DU SERVEUR. Deux
 *  `filter(e => e.feltRPE)` inline dans `week-view` comptaient les lignes
 *  faites ; le serveur, lui, accepte AUSSI le ressenti par série
 *  (`records.py`, `TRACE_ARBRE` : `felt_rpe` non vide OU `felt_rpe_by_set` non
 *  vide). Les deux se rejoignaient par accident — noter un RPE par série
 *  recalcule la moyenne dans `feltRPE` — mais c'est un accident, pas une règle,
 *  et c'est exactement la façon dont ce dépôt fabrique des divergences
 *  silencieuses. Ici la règle est écrite une fois, dans les mêmes termes que le
 *  SQL qui fait autorité.
 *
 *  ⚠️ LE RESSENTI, ET RIEN D'AUTRE (FRE-71). Des reps ou une charge saisies
 *  sans ressenti ne disent PAS que la série a eu lieu : c'est le trou de
 *  saisie que `lignesSansRessenti` signale, et le compter comme fait
 *  masquerait précisément ce qu'on veut voir. */
export function ligneEstFaite(ligne: LigneFaisable): boolean {
  return (ligne.feltRPE ?? '').trim() !== '' || (ligne.feltRPEBySet ?? []).length > 0;
}

/** Combien de lignes portent une trace, sur combien. */
export function avancementDeLaSeance(seance: SeanceFaisable): { faites: number; total: number } {
  const total = seance.exercises.length;
  return { faites: seance.exercises.filter(ligneEstFaite).length, total };
}

/** Une séance COMPLÉTÉE : toutes ses lignes portent une trace.
 *
 *  ⚠️ UNE SÉANCE VIDE N'EST PAS COMPLÉTÉE. Elle n'a rien à faire, mais la dire
 *  finie ferait passer l'écran au-dessus d'une séance que le coach n'a pas
 *  encore remplie — c'est l'inverse de ce qu'on veut montrer. */
export function seanceEstCompletee(seance: SeanceFaisable): boolean {
  const { faites, total } = avancementDeLaSeance(seance);
  return total > 0 && faites === total;
}

/** Une séance ENTAMÉE : au moins une ligne porte une trace.
 *
 *  C'est la mesure PRAGMATIQUE du « fait » (William, 24/09) : beaucoup ne
 *  notent que le principal, et une séance dont le principal est noté a eu
 *  lieu. Ce que « complétée » sert à afficher (l'avancement, la coche), elle
 *  ne le remplace pas ; elle sert là où il faut deviner OÙ l'athlète en est. */
export function seanceEstEntamee(seance: SeanceFaisable): boolean {
  return avancementDeLaSeance(seance).faites > 0;
}

type SeanceOuvrable = SeanceFaisable & { id?: string | null; sessionDate?: string | null };

/** La séance qu'on ouvre d'emblée dans la semaine : la première SANS AUCUNE
 *  trace, pas celle du jour (William, 20/09) — « on ne peut jamais présupposer
 *  de quand l'athlète fera sa séance, mais a priori il fera la prochaine ». Et
 *  pas la première non complétée (24/09) : une ligne oubliée en début de semaine
 *  ramenait l'écran dessus chaque jour.
 *
 *  Une séance VIDE n'est pas « à faire » : on la saute. Quand tout est entamé,
 *  la date garde le dernier mot ; à défaut, la première. */
export function seanceAOuvrir<S extends SeanceOuvrable>(seances: readonly S[], aujourdhui: string): S | null {
  return seances.find((s) => s.exercises.length > 0 && !seanceEstEntamee(s))
    ?? seances.find((s) => (s.sessionDate ?? '') === aujourdhui)
    ?? seances[0]
    ?? null;
}
