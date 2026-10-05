import type { BlockBase, Exercise } from '@/api/types';
import { CYCLE_PAR_DEFAUT, joursDuCycle } from '@/lib/constants';

/** Une ligne NEUVE, telle que l'éditeur la crée — donc un BROUILLON.
 *
 *  ⚠️ TOUT EST RENSEIGNÉ SAUF `id`, ET C'EST LA SEULE ABSENCE QUI COMPTE. Une
 *  ligne qui n'a pas encore été enregistrée n'a pas d'identité serveur : c'est
 *  précisément ce qui distingue un ajout d'une modification au moment d'écrire.
 *  Les autres champs valent leur vide — ce qui n'est pas la même chose qu'être
 *  absents, et le type le dit maintenant.
 *
 *  `variant` et les trois tableaux `*BySet` sont des LISTES vides, pas des
 *  chaînes : c'est la
 *  forme que le serveur renvoie aussi (FRE-33), et la faire diverger ici obligeait
 *  l'affichage à gérer deux formes pour la même chose.
 *
 *  `kind: null` vaut « entraînement ». JAMAIS `''` — le contrat d'écriture rejette
 *  la chaîne vide, et un `kind: ''` faisait tomber la semaine ENTIÈRE en 422. */
export function createEmptyExercise(): Omit<Exercise, 'id'> {
  return {
    name: '', variant: [], kind: null, tier: null,
    // Pas de groupe, donc pas de nature (FRE-36). Une ligne neuve n'est liée à
    // rien ; la nature se pose au liage, jamais avant.
    //
    // ⚠️ `null` ET PLUS `''` DEPUIS FRE-137 : le vocabulaire clos ne porte plus
    // de membre vide. Les CHAMPS DE SAISIE, eux, gardent leur `''` — une ligne
    // neuve s'édite, et un champ contrôlé de React qui reçoit `null` bascule en
    // non contrôlé. Le serveur convertit ces `''` en absence à l'écriture.
    groupKind: null,
    // Pas de groupe, donc pas de lien « sans lâcher » vers une suivante (FRE-116).
    unbroken: false,
    format: '', clusterMode: '', clusterRest: '', tempo: '', sets: '', reps: '',
    repsDone: '', repsUnit: 'count', weight: '', weightDone: '', weightLocked: false,
    assistance: '', aimedRPE: '', rest: '', restActual: '',
    feltRPE: '', feltRPEBySet: [], repsDoneBySet: [], weightDoneBySet: [],
    // Les tours d'un AMRAP de groupe (FRE-116) : un nombre, donc `null` — il n'a
    // pas de champ de saisie texte où un `''` servirait.
    toursRealises: null,
    coachNote: '', athleteFeedback: '', link: '',
    groupId: '', increment: '', incrementUnit: 'kg',
    // ⚠️ `null` PARCE QUE LE SCORE NE SE SAISIT PAS (FRE-103). La
    // mécanotransduction est calculée par le serveur (`ff_mechano`) et n'arrive
    // qu'à la relecture : une ligne encore en brouillon n'en a légitimement
    // aucune. Y mettre `0` inventerait un temps sous tension nul, qui est une
    // valeur RÉELLE pour un tempo tout explosif — les deux ne se confondent pas.
    mechano: null,
  };
}

/** BASE vide d'un bloc (un jour par entrée, canonique Lundi→Dimanche).
 *
 *  ⚠️ `selectedPrincipaux: null` ET PAS `[]`, et la différence est réelle : `null`
 *  dit « jamais configuré », ce qui fait retomber l'éditeur sur l'ordre canonique
 *  de la bibliothèque ; `[]` dirait « le coach a tout retiré », et lui présenterait
 *  une BASE vide de ses cinq sections. Une base neuve est dans le premier cas.
 *
 *  Contrairement à l'exercice, rien n'est absent ici : une BASE n'a pas d'`id`
 *  propre — elle appartient au bloc — donc c'est bien une valeur de LECTURE
 *  complète, pas un brouillon. */
export function createEmptyBlockBase(): BlockBase {
  return {
    // Sept jours au départ — la durée la plus courante ; le stepper la change.
    daySplit: joursDuCycle(CYCLE_PAR_DEFAUT).map(day => ({ day, tiers: {} })),
    principles: [],
    accessories: [],
    selectedPrincipaux: null,
    granularity: {},
    s1StartDate: '',
    s1EndDate: '',
  };
}
