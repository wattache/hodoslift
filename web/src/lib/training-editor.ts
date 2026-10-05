import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { api } from '@/api/client';
import { clesDeLArbre } from '@/api/cles';
import { cleContenuDeBloc, contenuDeBloc, useBlockContent } from '@/api/hooks/use-block-content';
import { useProgramStructure } from '@/api/hooks/use-structure';
import { useTraining } from '@/api/hooks/use-training';
import type { BlockBase, BlockObjective, ContenuDeBloc, Exercise, ExerciseEditing, ExerciseKind, MacroDeStructure, MacrocycleEditing, OneRepMax, Week, WeekEditing } from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';
import { appliquerLaFile, useFileHorsLigne, type CibleSupprimable, type Geste } from '@/lib/file-hors-ligne';
import { createEmptyBlockBase, createEmptyExercise } from '@/lib/exercise';
import { kindToWrite } from '@/lib/exercise-kind';
import { feltRPEFromSets } from '@/lib/rpe-scale';
import { moyenneDesSeries, seriesDeLaLigne } from '@/lib/par-serie';
import { datesEnchainees, useProgramSelection, type ProgramSelection } from '@/lib/program-selection';
import { toastSaveError } from '@/lib/save-error';
import { estEnCreation, nouvelleIdentite, usePatchsEnAttente, type EtatEnregistrement } from '@/lib/patchs-en-attente';
// ⚠️ LA RÈGLE DES GROUPES VIT DANS `groupe.ts` (FRE-45), avec sa lecture :
// `nettoyerGroupesSeuls` et `blocDe` étaient enfermées dans le corps de ce
// hook, écrites en colonne 0 — donc intestables, et introuvables.
import { blocDe, champsDeGroupe, estChronometre, natureDe, nettoyerGroupesSeuls, type NatureDeGroupe } from '@/lib/groupe';
import { deplacerEntreSeances } from '@/lib/deplacement-de-ligne';

/** Éditeur du programme d'entraînement — le remplaçant du useAthleteData v1.
 *
 *  Modèle : une COPIE LOCALE de l'arbre (state `macros`), mutée en synchrone
 *  pour une UI instantanée, persistée vers brokkr :
 *   - contenu de semaine (sessions/athlete) → PATCH /content, débouncé 400 ms
 *     par semaine (une rafale de frappes = un write) ;
 *   - objectifs de bloc → PUT /objectives, débouncé 400 ms par bloc ;
 *   - méta (renames, hidden, dates) → PATCH immédiat ;
 *   - cycle de vie (create/delete) → POST/DELETE immédiat, ids serveur.
 *  Le refetch (focus, invalidation) ne RESYNC le local que s'il n'y a aucune
 *  écriture en attente — sinon un snapshot périmé écraserait la frappe en cours.
 *
 *  En dev-mock, tout reste local (aucune écriture réseau).
 */

const isMock = !isFirebaseConfigured;

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

/** ⚠️ `id: ''` ET PAS D'ABSENCE, contrairement à une ligne neuve — parce que
 *  l'identité d'un objectif ne DÉSIGNE rien. La liste s'écrit en entier
 *  (`PUT /objectives`), les ids sont même retirés au passage, et l'affichage
 *  clef par index. Il n'y a donc ici aucun risque d'adresser un objet fantôme,
 *  qui est la raison pour laquelle une séance ou une ligne neuve, elles, n'ont
 *  pas d'id du tout. */
function createEmptyObjective(): BlockObjective {
  return { id: '', exercise: '', variant: '', format: '', sets: '', reps: '', weightMin: '', weightMax: '', assistance: '' };
}



/** Les ids réellement connus du serveur, dans l'ordre — pour les `PUT .../order`.
 *  Écarte les vides ET ceux dont la création vole encore : les seconds ne sont
 *  pas moins dangereux que les premiers, ils sont seulement moins visibles. */
function idsEtablis(objets: { id?: string }[]): string[] {
  return objets.map(o => o.id).filter((id): id is string => !!id && !estEnCreation(id));
}

/** Toutes les identités d'une semaine — elle-même, ses séances, ses lignes.
 *  Supprimer une semaine efface les trois niveaux côté serveur : les patchs en
 *  attente des trois niveaux doivent mourir avec. */
function idsDuSousArbre(semaine: WeekEditing): string[] {
  return [
    semaine.id,
    ...(semaine.sessions ?? []).flatMap(s => [s.id, ...s.exercises.map(e => e.id)]),
  ].filter((id): id is string => !!id);
}

/** Recharge TOUT ce que l'écran d'entraînement lit — et il lit désormais à trois
 *  endroits (FRE-119).
 *
 *  ⚠️ ÉCRITE UNE FOIS PARCE QU'ELLE EST APPELÉE DE TROIS ENDROITS. Une clé
 *  oubliée dans l'un d'eux ne se voit pas : l'écran garde simplement une donnée
 *  périmée jusqu'au prochain focus, et c'est le genre de défaut qu'on attribue
 *  au réseau. Le découpage a multiplié les clés — c'est le prix, et le payer ici
 *  une fois est moins cher que de le payer partout.
 *
 *  La charpente est invalidée elle aussi, et pas seulement le contenu : une
 *  création ou une suppression change la FORME de l'arbre, pas son contenu. */
function invalider(qc: ReturnType<typeof useQueryClient>, programId: string | null | undefined): void {
  // La liste vit dans `api/cles.ts` depuis FRE-144 : elle était ici, et les
  // écritures qui ne passent PAS par ce fichier — la file de patchs, les
  // objectifs — devaient s'en souvenir toutes seules. Trois l'ont oubliée.
  for (const queryKey of clesDeLArbre(programId)) void qc.invalidateQueries({ queryKey });
}

/** Recolle la CHARPENTE et le CONTENU d'un bloc en l'arbre que l'éditeur mute.
 *
 *  ⚠️ LA CHARPENTE EST LA SEULE SOURCE DES CHAMPS QU'ELLE PORTE. Le contenu ne
 *  redit ni numéro, ni dates, ni athlète — c'est le contrat serveur qui le
 *  garantit, et c'est ce qui rend cette fusion sûre : il n'existe aucun champ
 *  pour lequel les deux lectures pourraient se contredire quand l'une est
 *  fraîche et l'autre en cache. Le recollement se fait par IDENTIFIANT de
 *  semaine, jamais par position : un bloc peut gagner une semaine entre les deux
 *  requêtes.
 *
 *  ⚠️ ET LES SEMAINES DES AUTRES BLOCS N'ONT PAS DE `sessions` — pas `[]`.
 *  Écrire `[]` dirait « aucune séance » là où la vérité est « on ne sait pas
 *  encore », et cet écran se sert justement de la vacuité d'une semaine pour
 *  l'éteindre dans la barre. Le type porte cette distinction (`sessions?`), donc
 *  le compilateur la fait respecter. */
function fusionner(
  structure: MacroDeStructure[],
  blocId: string | null,
  contenu: ContenuDeBloc | undefined,
): MacrocycleEditing[] {
  const seancesParSemaine = new Map(contenu?.weeks.map(w => [w.id, w.sessions]));
  return structure.map(m => ({
    id: m.id,
    macroNumber: m.macroNumber,
    name: m.name,
    trainingFrequency: m.trainingFrequency,
    coachNotes: m.coachNotes,
    blocks: m.blocks.map(b => {
      const charge = contenu !== undefined && b.id === blocId;
      return {
        id: b.id,
        blockNumber: b.blockNumber,
        name: b.name,
        startDate: b.startDate,
        endDate: b.endDate,
        objectives: b.objectives,
        objectivesVersion: b.objectivesVersion,
        // La BASE n'est servie qu'avec le contenu : un bloc non ouvert n'en a
        // pas ici, et l'éditeur de BASE ne s'ouvre que sur le bloc courant.
        ...(charge ? { base: contenu.base } : {}),
        weeks: b.weeks.map(w => ({
          id: w.id,
          weekNumber: w.weekNumber,
          name: w.name,
          hidden: w.hidden,
          startDate: w.startDate,
          endDate: w.endDate,
          athlete: w.athlete,
          ...(charge ? { sessions: seancesParSemaine.get(w.id) ?? [] } : {}),
        })),
      };
    }),
  }));
}

export interface TrainingEditor {
  macros: MacrocycleEditing[];
  loading: boolean;
  selection: ProgramSelection;

  /* Contenu de la semaine SÉLECTIONNÉE (debounce par semaine) */
  /** `string[]` pour le seul champ qui en porte : les variantes cumulées (FRE-33). */
  updateExercise: (si: number, ei: number, field: keyof Exercise, value: string | string[] | boolean | number | null) => void;
  /** NATURE d'une ligne (FRE-10). Méthode DÉDIÉE et non `updateExercise` : le
   *  retour à « entraînement » doit SUPPRIMER la clé, pas la vider — `kind: ''`
   *  est hors du Literal côté brokkr et ferait tomber la semaine entière. */
  setExerciseKind: (si: number, ei: number, kind: ExerciseKind) => void;
  /** Bascule toute la séance : marquer dix lignes une par une serait pénible. */
  setSessionKind: (si: number, kind: ExerciseKind) => void;
  updateExerciseSetRPE: (si: number, ei: number, setIndex: number, value: string | null) => void;
  /** Le ressenti de la LIGNE ENTIÈRE — et la fermeture du détail par série.
   *
   *  ⚠️ SÉPARÉE DE `updateExercise(…, 'feltRPE', …)`, ET C'EST TOUT L'OBJET DU
   *  CORRECTIF DU 10/09. La carte de l'athlète appelait `updateExerciseSetRPE`
   *  MÊME PLI FERMÉ, sur la série active qui vaut 1 par défaut : un ressenti
   *  global sur une ligne à quatre séries repartait en `['8']`. Personne ne le
   *  voyait — le serveur dérive le scalaire du tableau, et la moyenne d'un
   *  élément vaut cet élément — jusqu'au badge « 1/4 » de FRE-156. */
  updateExerciseFeltRPE: (si: number, ei: number, value: string) => void;
  /** Le réalisé par série pour les RÉPÉTITIONS et la CHARGE (06/09). Une
   *  seule fonction pour les deux : elles suivent la même règle, et deux
   *  copies de cette règle divergeraient au premier correctif. */
  updateExerciseSetValue: (si: number, ei: number, setIndex: number,
                           champ: 'reps' | 'weight', value: string | null) => void;
  updateSessionForm: (si: number, value: number | null) => void;
  addExercise: (si: number) => void;
  /** Rend l'identité de la copie, ou `null` si rien n'a été copié. */
  duplicateExercise: (si: number, ei: number) => Promise<string | null>;
  removeExercise: (si: number, ei: number) => void;
  moveExercise: (si: number, from: number, to: number) => void;
  /** D'une séance à une AUTRE de la même semaine ; le bloc part entier (FRE-188). */
  moveExerciseToSession: (fromSi: number, ei: number, toSi: number, toIdx: number) => void;
  addSession: (name: string) => void;
  removeSession: (si: number) => void;
  renameSession: (si: number, name: string) => void;
  moveSession: (from: number, to: number) => void;

  /* Cycle de vie */
  /** ⚠️ LA SOURCE SE DÉSIGNE PAR SON ID DE BLOC, plus par sa place dans l'arbre
   *  (FRE-119). Un couple d'index n'a de sens que pour qui tient l'arbre entier
   *  en mémoire — et plus personne ne le tient. L'id, lui, suffit à demander au
   *  serveur la trame de ce bloc-là, au moment du clic. */
  addMacro: (options?: { duplicateFrom?: string }) => Promise<void>;
  addBlock: (options?: { duplicateFrom?: string }) => Promise<void>;
  addWeek: () => Promise<void>;
  removeMacro: (index: number) => Promise<void>;
  removeBlock: (index: number) => Promise<void>;
  removeWeek: (index: number) => Promise<void>;

  /* Méta */
  renameMacro: (index: number, name: string) => void;
  renameBlock: (index: number, name: string) => void;
  renameWeek: (index: number, name: string) => void;
  /** Étire ou raccourcit une semaine ; les suivantes se décalent d'autant. */
  decalerLaFinDeSemaine: (index: number, fin: string) => Promise<void>;
  toggleWeekHidden: (macroId: string, blockId: string, weekId: string) => void;

  /* Objectifs du bloc sélectionné */
  addObjective: () => void;
  updateObjective: (index: number, field: keyof BlockObjective, value: string | null) => void;
  removeObjective: (index: number) => void;
  /** Déplace un objectif : l'ordre du tableau EST sa position en base. */
  moveObjective: (from: number, to: number) => void;

  /* BASE du bloc */
  updateBlockBase: (blockIndex: number, base: BlockBase) => Promise<void>;
  generateWeekOneFromBase: (blockIndex: number) => Promise<void>;

  /** L'arbre ENTIER — vide tant que `arbreComplet` n'est pas demandé.
   *
   *  ⚠️ IL NE SERT QU'À CE QUI LIT VRAIMENT À TRAVERS LES BLOCS : l'historique
   *  d'un mouvement et la liste des trames à dupliquer, tous deux dans l'éditeur
   *  de BASE. Le reste de l'écran lit `macros`, qui ne porte que le bloc
   *  courant — et c'est ce qui fait tenir le découpage : s'en servir ailleurs
   *  rendrait le téléchargement de l'arbre à nouveau permanent, sans que rien ne
   *  casse pour le signaler. */
  arbreComplet: MacrocycleEditing[];

  /** Le contenu du bloc courant est-il inatteignable, faute de réseau ? */
  contenuEnPause: boolean;

  /** Les blocs qui PORTENT une trame — de quoi remplir le menu « dupliquer une
   *  base » sans charger une seule ligne.
   *
   *  ⚠️ C'EST LE SERVEUR QUI DIT LESQUELS (`hasBase`), et c'est le point : la
   *  règle des quatre morceaux — grille, sélection, principes, accessoires —
   *  vivait ici en TypeScript, sur un arbre qu'il fallait donc télécharger
   *  ENTIER pour l'appliquer. 512 Ko pour une liste de libellés. */
  basesDisponibles: { blockId: string; label: string }[];

  /** Une écriture locale attend-elle encore son acquittement ?
   *
   *  Exposé pour `BlockBaseEditor` (FRE-66), qui tient son brouillon hors de cet
   *  arbre et doit savoir quand le resemer sans écraser une frappe. */
  hasPendingWrites: () => boolean;

  /** La MÊME question, mais posée par l'écran (FRE-32).
   *
   *  ⚠️ CE N'EST PAS UN DOUBLON DE `hasPendingWrites`. Celle-ci ne lit que des
   *  `ref` et ne provoque aucun rendu — elle sert aux garde-fous, pas à
   *  l'affichage. Les deux viennent de la même source ; c'est le module de la
   *  file qui les tient ensemble, précisément pour qu'elles ne puissent pas
   *  diverger. */
  etatEnregistrement: EtatEnregistrement;
}

export function useTrainingEditor(
  programId: string | null | undefined,
  oneRM: OneRepMax,
  options?: {
    /** Charge l'arbre ENTIER, en plus du bloc courant.
     *
     *  ⚠️ UN SEUL ÉCRAN LE DEMANDE, ET SEULEMENT QUAND IL S'OUVRE : l'éditeur de
     *  BASE. Lui seul lit VRAIMENT à travers les blocs — l'historique d'un
     *  mouvement sur les blocs précédents, et la liste des trames à dupliquer —
     *  et aucune découpe ne peut le lui épargner. C'est un geste de coach, rare
     *  et délibéré ; l'athlète, qui ouvre cet écran tous les jours, ne paie
     *  jamais pour lui. */
    arbreComplet?: boolean;
    /** Aperçu « Athlète » du coach : la semaine affichée ignore les masquées
     *  (FRE-158). Le serveur ne les sert déjà plus à un athlète ; ceci ne rend
     *  honnête que la prévisualisation, à qui il les sert encore. */
    ignorerLesMasquees?: boolean;
  },
): TrainingEditor {
  const qc = useQueryClient();

  /* ----- DEUX LECTURES AU LIEU D'UNE (FRE-119) -----------------------------
   *
   *  L'arbre entier pesait 512 Ko sur le programme le plus fourni et grossissait
   *  d'une semaine par semaine, pour un écran qui n'en montre qu'un bloc. La
   *  charpente arrive une fois (10 Ko) et sert la navigation ; le contenu suit
   *  le bloc regardé.
   *
   *  ⚠️ LA BOUCLE EST VOULUE — la sélection sort de `macros`, qui vient du
   *  contenu, qui vient de la sélection. Elle CONVERGE en deux passes : sans
   *  charpente il n'y a pas de bloc, donc pas de requête ; la charpente arrive,
   *  la sélection se pose sur un bloc, son contenu se demande ; il arrive, la
   *  fusion le pose SANS déplacer la sélection (mêmes ids). */
  const { data: structure, isLoading: chargeCharpente } = useProgramStructure(programId);
  /** ⚠️ CE QUI N'EST PAS ENCORE PARTI DOIT QUAND MÊME S'AFFICHER (FRE-120). Le
   *  cache de lecture porte la semaine telle que le SERVEUR l'a donnée ; la file
   *  porte ce que l'athlète a tapé sans réseau. Au rechargement, seul le premier
   *  était lu — et la saisie disparaissait de l'écran alors qu'elle était bien
   *  gardée. Fermer l'app entre deux séries est le geste le plus ordinaire du
   *  monde ; ce n'était pas un cas limite. */
  const fileHorsLigne = useFileHorsLigne();
  const { data: arbre } = useTraining(options?.arbreComplet ? programId : null);

  const [macros, setMacros] = useState<MacrocycleEditing[]>([]);
  // Miroir synchrone de l'état : deux mutations dans le même handler doivent
  // se voir l'une l'autre (setState est asynchrone).
  const macrosRef = useRef<MacrocycleEditing[]>(macros);

  const selection = useProgramSelection(programId, macros, options?.ignorerLesMasquees ?? false);
  /** Le bloc dont on demande le contenu — VALIDÉ contre la charpente courante.
   *
   *  ⚠️ LA SÉLECTION SORT DE `macros`, QUI EST UN ÉTAT LOCAL, ET IL RETARDE. Le
   *  resync ne le remplace qu'une fois la nouvelle charpente arrivée (`if
   *  (!structure) return`) : entre le changement d'athlète et cette réponse,
   *  `programId` désigne déjà le nouveau programme et `macros` porte encore les
   *  blocs de l'ancien. Le couple demandé n'existe alors nulle part.
   *
   *  `structure`, elle, est indexée sur `programId` par sa clé de requête : la
   *  confronter est ce qui rend les deux moitiés cohérentes. Un bloc absent de
   *  la charpente — d'un autre athlète, ou supprimé — ne se demande pas. */
  const blocSelectionne = selection.block?.id ?? null;
  const blocId = useMemo(
    () => (blocSelectionne && (structure ?? []).some(m => m.blocks.some(b => b.id === blocSelectionne))
      ? blocSelectionne
      : null),
    [blocSelectionne, structure]);
  const contenuDuBloc = useBlockContent(programId, blocId);
  const { data: contenu, isLoading: chargeContenu } = contenuDuBloc;
  /** Hors ligne, sur un bloc jamais ouvert : il n'y a rien à montrer, et il faut
   *  le DIRE (FRE-118).
   *
   *  ⚠️ CET ÉTAT NE RESSEMBLE À AUCUN AUTRE, et c'est le piège. `useQuery` est en
   *  `networkMode: 'online'` : sans réseau il ne lance pas la requête et ne
   *  produit AUCUNE erreur — il MET EN PAUSE. On a donc `isLoading` faux, pas
   *  d'erreur, et un contenu absent : la fusion rend des semaines sans séance, et
   *  l'écran affiche un bloc VIDE avec le bouton « + Séance » à côté. C'est
   *  exactement la forme du trou qui a fait l'incident du 21/08 sur le gate — un
   *  écran qui AFFIRME au lieu de constater. */
  const contenuEnPause = contenuDuBloc.isPending && contenuDuBloc.fetchStatus === 'paused';
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const oneRMRef = useRef(oneRM);
  oneRMRef.current = oneRM;

  /* ----- Persistance : tout ce qui est EN VOL vit dans son module (FRE-45) -----
   *
   *  ⚠️ IL RÉPOND À UNE SEULE QUESTION — « reste-t-il une écriture non
   *  acquittée ? » — et elle a QUATRE sources. Les tenir ensemble rend l'oubli
   *  d'une source visible ; éparpillées dans ce hook, elles ne l'étaient pas, et
   *  la quatrième a effectivement manqué (les écritures de BASE, FRE-66).
   *
   *  Ce module ne connaît pas l'arbre : ni `macros`, ni la sélection, ni le
   *  contenu d'une semaine. C'est ce qui le rend testable sans monter d'écran. */
  const {
    schedulePatch, envoyerMaintenant, oublierPatchs, hasPendingWrites,
    planifierObjectifs, suivreEcritureDirecte, ecrire, signalerEchec, etatEnregistrement,
  } = usePatchsEnAttente(programId);
  // Un refus se dit deux fois : le toast, qui passe, et la vignette, qui reste.
  const saveFailed = useCallback((e: unknown) => { signalerEchec(); toastSaveError(e); }, [signalerEchec]);

  /** Les trames à dupliquer, lues sur la CHARPENTE — aucune ligne chargée. */
  const basesDisponibles = useMemo(
    () => (structure ?? []).flatMap(m => m.blocks
      .filter(b => b.hasBase)
      .map(b => ({
        blockId: b.id,
        label: `${m.name || `Macro ${m.macroNumber}`} · ${b.name || `Bloc ${b.blockNumber}`}`,
      }))),
    [structure]);

  /** Le bloc dont le contenu est DÉJÀ posé dans `macros`. */
  const blocFusionne = useRef<string | null>(null);

  // Resync serveur → local, sauf édition locale non persistée.
  useEffect(() => {
    if (!structure) return;
    // ⚠️ LE GARDE-FOU SAUTE QUAND ON CHANGE DE BLOC, et il le faut. Il existe
    // pour qu'un instantané serveur périmé n'écrase pas une frappe en cours —
    // or une frappe en cours porte sur le bloc PRÉCÉDENT, et le nouveau n'a
    // rien à protéger : son contenu n'est pas encore dans `macros`. Sans cette
    // exception, changer de bloc pendant qu'un patch vole afficherait une
    // semaine vide jusqu'au prochain retour de focus.
    const memeBloc = blocFusionne.current === blocId;
    if (hasPendingWrites() && memeBloc) return;
    const suivant = appliquerLaFile(fusionner(structure, blocId, contenu), fileHorsLigne);
    blocFusionne.current = contenu ? blocId : null;
    setMacros(suivant);
    macrosRef.current = deepClone(suivant);
  }, [hasPendingWrites, structure, contenu, blocId, fileHorsLigne]);

  const commit = useCallback((next: MacrocycleEditing[]) => {
    macrosRef.current = next;
    setMacros(next);
  }, []);

  const updateWeek = useCallback((updater: (week: WeekEditing) => void) => {
    const { macroIndex, blockIndex, weekIndex } = selectionRef.current;
    const next = deepClone(macrosRef.current);
    const week = next[macroIndex]?.blocks[blockIndex]?.weeks[weekIndex];
    if (!week) return;
    updater(week);
    commit(next);
  }, [commit]);

  /** La semaine courante telle qu'elle est APRÈS mutation locale. */
  const semaineCourante = (): WeekEditing | undefined => {
    const { macroIndex, blockIndex, weekIndex } = selectionRef.current;
    return macrosRef.current[macroIndex]?.blocks[blockIndex]?.weeks[weekIndex];
  };

  /** Appel structurel (ajout, suppression, réordonnancement) : immédiat, pas
   *  débouncé — il change la FORME de l'arbre, et le serveur y répond des ids
   *  qu'on ne peut pas inventer localement. En cas d'échec, on resynchronise :
   *  garder un local divergent du serveur est pire que perdre le geste. */
  const appelStructurel = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    if (isMock || !programId) return null;
    try {
      // ⚠️ COMPTÉ COMME UNE ÉCRITURE EN ATTENTE (FRE-120). Sans ça, un resync
      // tombant pendant le `POST` remplace l'arbre local par celui du serveur —
      // qui ne connaît pas encore l'objet qu'on vient de dessiner.
      return await suivreEcritureDirecte(fn);
    } catch (e) {
      saveFailed(e);
      invalider(qc, programId);
      return null;
    }
  }, [programId, qc, saveFailed, suivreEcritureDirecte]);

  /** Un geste qui se GARDE sans réseau — suppression, ordre, déplacement —
   *  et qui, refusé, resynchronise : « garder un local divergent du serveur
   *  est pire que perdre le geste ». Rend `true` si l'écran peut suivre le
   *  geste : le serveur a accepté, ou le geste attend le réseau à sa place
   *  dans la file.
   *
   *  ⚠️ IL RESYNCHRONISE SUR REFUS, ET C'EST CE QUI MANQUAIT (FRE-45). Les trois
   *  suppressions faisaient chacune `catch { saveFailed(e); return; }` : le
   *  toast, pas le rattrapage. Un DELETE peut échouer APRÈS que le serveur a
   *  supprimé, c'est la réponse qui se perd, pas l'effet. L'écran gardait alors
   *  un objet fantôme jusqu'au prochain focus, et chaque frappe dedans partait
   *  sur un identifiant mort. */
  const ecrireOuRattraper = useCallback(async (geste: Geste, emporte: string[] = []): Promise<boolean> => {
    if (isMock || !programId) return true;
    if (await ecrire(geste, emporte)) return true;
    // `invalider` directement et non `invalidate`, déclaré plus bas : les
    // deux font le même appel, et `appelStructurel` procède déjà ainsi.
    invalider(qc, programId);
    return false;
  }, [ecrire, programId, qc]);

  /** Une suppression. `emporte` : ce que l'objet entraîne avec lui — ses
   *  patchs en attente meurent avec, sur le disque comme en mémoire. */
  const supprimer = useCallback(async (cible: CibleSupprimable, id: string, emporte: string[]): Promise<boolean> => {
    if (!programId) return true;
    return ecrireOuRattraper({ genre: 'suppression', programId, cible, id }, emporte);
  }, [ecrireOuRattraper, programId]);

  /* ----- Mutations de contenu ----- */


  const updateExercise = useCallback((si: number, ei: number, field: keyof Exercise, value: string | string[] | boolean | number | null) => {
    let cibles: ExerciseEditing[] = [];
    // La ligne TOUCHÉE, seule à partir sur le réseau — voir plus bas.
    let touchee: ExerciseEditing | undefined;
    updateWeek(week => {
      const exercices = week.sessions?.[si]?.exercises;
      const ex = exercices?.[ei];
      if (!ex) return;

      const gid = (ex.groupId || '').trim();
      // ⚠️ CE QUI SE PROPAGE DÉPEND DE LA NATURE (FRE-36) : un dropset n'a qu'UN
      // exercice, donc son NOM décrit le groupe au même titre que les séries.
      // Une liste figée aurait obligé à choisir laquelle des deux natures on
      // trahit — le nom propagé sur un bi-set écraserait son second mouvement.
      //
      // `> 1` : un groupe ORPHELIN (partenaire supprimé, identifiant resté) ne
      // doit pas déclencher de propagation — il n'y a rien à propager.
      const nature = natureDe(ex);
      const membres = gid && champsDeGroupe(nature).has(field)
        ? exercices!.filter(o => (o.groupId || '').trim() === gid)
        : [ex];
      cibles = membres.length > 1 ? membres : [ex];
      touchee = ex;

      for (const cible of cibles) {
        (cible as unknown as Record<string, string | string[] | boolean | number | null>)[field] = value;
      }
      // ⚠️ UN GROUPE QUI DEVIENT CHRONOMÉTRÉ PERD SES FORMATS DE LIGNE (FRE-116),
      // et prend pour temps celui de sa première ligne. brokkr le fait à
      // l'écriture (`_aligner_un_groupe_chronometre`) ; le faire ici évite un
      // écran qui montre encore « AMRAP 5' » sur chaque ligne jusqu'au rechargement.
      if (field === 'groupKind' && typeof value === 'string' && gid
          && estChronometre(value as NatureDeGroupe)) {
        const temps = cibles.map(c => c.clusterMode).find(v => (v || '').trim()) ?? null;
        for (const cible of cibles) {
          cible.format = null; cible.clusterRest = null; cible.clusterMode = temps;
        }
      }
    });
    // ⚠️ UN SEUL APPEL, MÊME POUR UN CHAMP DE GROUPE (FRE-36). Le local touche
    // TOUS les membres — l'écran doit montrer le groupe entier changé sans
    // attendre l'aller-retour — mais le RÉSEAU n'en porte qu'un : c'est brokkr
    // qui propage aux autres lignes du groupe.
    //
    // Avant, le front envoyait un PATCH par membre. Ça marchait, et c'était le
    // problème : la règle tenait au client, donc elle ne valait que pour lui.
    // Quatre groupes de production portent encore deux valeurs de `rest`, venues
    // d'ailleurs, et cette seconde valeur n'est lue nulle part.
    schedulePatch('exercises', touchee?.id, { [field]: value });
  }, [updateWeek, schedulePatch]);

  /** `training` s'écrit `null`, et PAS par l'absence de la clé — cf. `kindToWrite`.
   *
   *  ⚠️ La nuance a du sens des deux côtés. Sur le FIL, `null` dit « remets à
   *  entraînement » là où l'absence dirait « n'y touche pas » — c'est ce que la
   *  requête envoie déjà quelques lignes plus bas. EN MÉMOIRE, `null` est ce que
   *  le serveur renvoie pour une ligne d'entraînement : effacer la clé faisait
   *  diverger l'objet local de celui qu'un rechargement aurait donné. */
  const applyKind = (ex: ExerciseEditing, kind: ExerciseKind) => {
    ex.kind = kindToWrite(kind) ?? null;
  };

  const setExerciseKind = useCallback((si: number, ei: number, kind: ExerciseKind) => {
    let id: string | undefined;
    updateWeek(week => {
      const ex = week.sessions?.[si]?.exercises[ei];
      if (ex) { applyKind(ex, kind); id = ex.id; }
    });
    // `null` et non l'absence : ici on ÉCRIT le retour à « entraînement », et une
    // colonne se vide avec NULL. C'est l'écriture Firestore qui exigeait de
    // supprimer la clé, parce qu'un `kind: ''` y tombait hors du Literal.
    schedulePatch('exercises', id, { kind: kindToWrite(kind) ?? null });
  }, [updateWeek, schedulePatch]);

  const setSessionKind = useCallback((si: number, kind: ExerciseKind) => {
    let lignes: ExerciseEditing[] = [];
    updateWeek(week => {
      lignes = week.sessions?.[si]?.exercises ?? [];
      for (const ex of lignes) applyKind(ex, kind);
    });
    for (const ex of lignes) schedulePatch('exercises', ex.id, { kind: kindToWrite(kind) ?? null });
  }, [updateWeek, schedulePatch]);

  /** Le ressenti de la LIGNE, pli fermé — et le détail par série qui s'efface.
   *
   *  ⚠️ LE TABLEAU PART VIDE *AVEC* LE SCALAIRE, et l'ordre des deux dans le
   *  même patch n'est pas anodin : brokkr dérive normalement `feltRPE` du
   *  tableau, donc un tableau vide seul rendrait `''` et effacerait la saisie.
   *  Le serveur reconnaît la paire `{tableau: [], scalaire}` comme un RETOUR AU
   *  GLOBAL et laisse passer le scalaire (`training_lines.derivations`).
   *
   *  ⚠️ ET LE DÉTAIL DISPARAÎT POUR DE BON. C'est voulu : fermer le pli puis
   *  répondre pour la ligne entière est la SEULE façon de revenir en arrière
   *  après avoir ouvert le détail par erreur. Le garder ferait vivre deux
   *  vérités sur la même ligne, et c'est exactement ce qui a produit 4 953
   *  tableaux déguisés en production.
   */
  const updateExerciseFeltRPE = useCallback((si: number, ei: number, value: string) => {
    let id: string | undefined;
    updateWeek(week => {
      const ex = week.sessions?.[si]?.exercises[ei];
      if (!ex) return;
      ex.feltRPE = value;
      ex.feltRPEBySet = [];
      id = ex.id;
    });
    schedulePatch('exercises', id, { feltRPE: value, feltRPEBySet: [] });
  }, [updateWeek, schedulePatch]);

  // RPE par série : pose feltRPEBySet[set-1] puis recalcule feltRPE = moyenne.
  // Rétrocompat : un feltRPE legacy sans tableau est semé en série 1.
  const updateExerciseSetRPE = useCallback((si: number, ei: number, setIndex: number, value: string | null) => {
    if (setIndex < 1) return;
    let patch: Record<string, unknown> | null = null;
    let id: string | undefined;
    updateWeek(week => {
      const ex = week.sessions?.[si]?.exercises[ei];
      if (!ex) return;
      const arr = Array.isArray(ex.feltRPEBySet) && ex.feltRPEBySet.length > 0
        ? [...ex.feltRPEBySet]
        : (ex.feltRPE ? [ex.feltRPE] : []);
      while (arr.length < setIndex) arr.push('');
      arr[setIndex - 1] = value ?? '';
      ex.feltRPEBySet = arr;
      // ⚠️ LA MOYENNE RESTE POSÉE ICI, MAIS N'EST PLUS ENVOYÉE (FRE-136). Elle
      // sert l'affichage IMMÉDIAT — le chiffre doit suivre la frappe sans
      // attendre le réseau, et il doit survivre hors ligne. C'est le SERVEUR
      // qui la dérive à l'écriture, avec la même règle portée en SQL
      // (`ff_moyenne_rpe`), parce qu'une colonne dérivée écrite par le client
      // est une règle qui n'existe qu'à un endroit, et pas le bon.
      ex.feltRPE = feltRPEFromSets(arr);
      patch = { feltRPEBySet: arr };
      id = ex.id;
    });
    if (patch) schedulePatch('exercises', id, patch);
  }, [updateWeek, schedulePatch]);

  /** Les RÉPÉTITIONS et la CHARGE série par série.
   *
   *  ⚠️ LE SCALAIRE REÇOIT LA MOYENNE, et c'est ce qui rend le changement
   *  invisible partout ailleurs. `repsDone` et `weightDone` restent ce que
   *  lisent le tableau du coach, l'Aperçu et les images de partage : en y
   *  écrivant la moyenne des séries, la saisie détaillée s'ajoute sans qu'un
   *  seul écran de lecture ait à changer.
   *
   *  ⚠️ MAIS ELLE N'EST PLUS ENVOYÉE AU SERVEUR (FRE-136). Ce qu'on pose ici ne
   *  sert que l'affichage immédiat, pendant la frappe et hors ligne ; le
   *  serveur dérive la colonne lui-même (`ff_moyenne_serie`). La règle vivait
   *  en TypeScript SEUL sur une valeur que la base garde — et deux lignes de
   *  production portaient déjà un `repsDone` qui n'était aucune de leurs
   *  séries (`['8','7','7']` rendu `7.3`).
   *
   *  ⚠️ LA MOYENNE N'EST PAS LE TONNAGE. Le serveur calcule celui-ci comme une
   *  somme de produits (`etl_training_sets.py`), justement parce que le produit
   *  des moyennes s'en écarte dès que la charge varie. Ce qu'on écrit ici est
   *  un RÉSUMÉ d'affichage, jamais une base de calcul.
   *
   *  Le TABLEAU part seul, comme pour le RPE : c'est la seule chose que
   *  l'athlète ait réellement saisie. */
  const updateExerciseSetValue = useCallback((
    si: number, ei: number, setIndex: number, champ: 'reps' | 'weight', value: string | null,
  ) => {
    if (setIndex < 1) return;
    const cleTableau = champ === 'reps' ? 'repsDoneBySet' : 'weightDoneBySet';
    const cleScalaire = champ === 'reps' ? 'repsDone' : 'weightDone';
    let patch: Record<string, unknown> | null = null;
    let id: string | undefined;
    updateWeek(week => {
      const ex = week.sessions?.[si]?.exercises[ei];
      if (!ex) return;
      const arr = seriesDeLaLigne(ex[cleTableau], ex[cleScalaire]);
      while (arr.length < setIndex) arr.push('');
      arr[setIndex - 1] = value ?? '';
      ex[cleTableau] = arr;
      ex[cleScalaire] = moyenneDesSeries(arr);   // affichage immédiat, pas le patch
      patch = { [cleTableau]: arr };
      id = ex.id;
    });
    if (patch) schedulePatch('exercises', id, patch);
  }, [updateWeek, schedulePatch]);

  const updateSessionForm = useCallback((si: number, value: number | null) => {
    let id: string | undefined;
    updateWeek(week => {
      const s = week.sessions?.[si];
      if (s) { s.formOfTheDay = value; id = s.id; }
    });
    schedulePatch('sessions', id, { formOfTheDay: value });
  }, [updateWeek, schedulePatch]);

  const renameSession = useCallback((si: number, name: string) => {
    let id: string | undefined;
    updateWeek(week => {
      const s = week.sessions?.[si];
      if (s) { s.name = name; id = s.id; }
    });
    schedulePatch('sessions', id, { name });
  }, [updateWeek, schedulePatch]);

  /* ----- Gestes STRUCTURELS : immédiats, et l'id vient du serveur ----- */

  const addExercise = useCallback(async (si: number) => {
    const seance = semaineCourante()?.sessions?.[si];
    if (!seance?.id) return;
    // ⚠️ UNE IDENTITÉ DÈS LA PREMIÈRE MILLISECONDE (FRE-86), et c'est celle que
    // brokkr gardera : la frappe a un endroit où se ranger pendant que le
    // `POST` fait l'aller-retour — ou attend le réseau sur le disque.
    const id = nouvelleIdentite();
    updateWeek(week => {
      week.sessions?.[si]?.exercises.push({ ...createEmptyExercise(), id });
    });
    if (isMock || !programId) return;
    await ecrireOuRattraper({ genre: 'creation', programId, cible: 'exercises', id, parent: seance.id, corps: { id, name: '' } });
  }, [ecrireOuRattraper, programId, updateWeek]);

  /** Duplique une ligne JUSTE DESSOUS, prescription comprise (Passe 3, constat 05).
   *  Rend l'identité de la copie, pour que l'écran y pose le curseur.
   *
   *  ⚠️ LA COPIE EST FAITE PAR BROKKR, ET L'ÉCRAN NE LA DESSINE PAS D'AVANCE.
   *  Cloner la ligne ici aurait demandé la liste de ce qui se recopie — la
   *  prescription, pas le réalisé, pas le groupe —, et cette liste existe déjà
   *  côté serveur (`CHAMPS_COPIES`). La copie arrive par la relecture.
   *
   *  ⚠️ LA FRAPPE EN FILE PART D'ABORD. Le serveur copie ce que la base contient :
   *  une charge tapée à l'instant dort encore dans le debounce, et la copie
   *  partait sans elle. */
  const duplicateExercise = useCallback(async (si: number, ei: number): Promise<string | null> => {
    const cible = semaineCourante()?.sessions?.[si]?.exercises[ei];
    if (!cible?.id || estEnCreation(cible.id)) return null;
    const id = cible.id;
    const res = await appelStructurel(async () => {
      await envoyerMaintenant('exercises', id);
      return api.post<{ id: string }>(`/programs/${programId}/exercises/${id}/duplicate`);
    });
    if (!res?.id) return null;
    invalider(qc, programId);
    return res.id;
  }, [appelStructurel, envoyerMaintenant, programId, qc]);

  const removeExercise = useCallback((si: number, ei: number) => {
    const cible = semaineCourante()?.sessions?.[si]?.exercises[ei];
    updateWeek(week => {
      const s = week.sessions?.[si];
      if (!s) return;
      // PAS de garde « on ne supprime pas la dernière » : le serveur, lui,
      // obéissait — et le front gardait la ligne à l'écran tout en l'ayant fait
      // disparaître en base. Chaque frappe dessus partait ensuite en 404, et
      // elle s'évanouissait au resync. Une séance vide est un état légitime :
      // l'interface la rend, avec son bouton « ajouter un exercice ».
      s.exercises.splice(ei, 1);
      nettoyerGroupesSeuls(s.exercises);   // un partenaire retiré ne laisse pas de lien orphelin
    });
    // Le patch en attente meurt avec la ligne : le laisser partir donnerait un
    // 404 et un toast qui envoie chercher au mauvais endroit (FRE-86).
    oublierPatchs([cible?.id]);
    // Sans identité SERVEUR, la ligne n'existe que localement (créée à l'instant,
    // pas encore acquittée) : la retirer de l'écran suffit.
    if (!cible?.id || estEnCreation(cible.id)) return;
    // Le serveur tient le même invariant de son côté : le nettoyage du groupe
    // resté seul y est fait aussi, pour qu'il ne dépende pas du client.
    void supprimer('exercises', cible.id, [cible.id]);
  }, [updateWeek, supprimer, oublierPatchs]);

  /** Déplace le BLOC, pas la ligne (FRE-31, décision William).
   *
   *  Glisser une ligne au milieu d'un groupe séparerait ses membres, alors que
   *  `grouperExercices` les suppose consécutifs — on obtiendrait deux blocs
   *  portant le même identifiant. Deux règles suffisent à l'empêcher : on déplace
   *  le groupe entier, et on ne s'arrête jamais À L'INTÉRIEUR d'un autre.
   *
   *  Réordonner DANS un groupe reste possible : `from` et `to` y appartenant au
   *  même bloc, on retombe sur un déplacement d'une seule ligne. */
  const moveExercise = useCallback((si: number, from: number, to: number) => {
    if (from === to) return;
    updateWeek(week => {
      const exercises = week.sessions?.[si]?.exercises;
      if (!exercises) return;

      const source = blocDe(exercises, from);
      const memeBloc = to >= source.debut && to <= source.fin;
      const morceau = memeBloc ? [from, from] : [source.debut, source.fin];

      // La cible ne doit pas tomber au milieu d'un autre bloc : on se range
      // avant ou après lui, selon le sens du déplacement.
      const cibleBloc = blocDe(exercises, Math.min(to, exercises.length - 1));
      let cible = to;
      if (!memeBloc && cibleBloc.debut !== cibleBloc.fin) {
        cible = to > morceau[0] ? cibleBloc.fin : cibleBloc.debut;
      }

      const extraits = exercises.splice(morceau[0], morceau[1] - morceau[0] + 1);
      const decalage = cible > morceau[0] ? cible - (morceau[1] - morceau[0]) : cible;
      exercises.splice(Math.max(0, Math.min(decalage, exercises.length)), 0, ...extraits);
    });
    // On envoie la liste COMPLÈTE des ids : le serveur vérifie qu'il ne manque
    // ni n'entre personne, ce qu'un « déplace X en position 3 » ne permettrait pas.
    const seance = semaineCourante()?.sessions?.[si];
    const ids = idsEtablis(seance?.exercises ?? []);
    if (seance?.id && ids.length && programId) {
      void ecrireOuRattraper({ genre: 'ordre', programId, cible: 'exercises', id: seance.id, ids });
    }
  }, [updateWeek, ecrireOuRattraper, programId]);

  /** D'une séance à une AUTRE de la semaine (FRE-188). Le bloc part entier,
   *  l'`id` ne change pas, le réalisé suit : c'est `PUT …/seance` qui le
   *  garantit en base, dans une transaction — pas un supprimer-recréer.
   *
   *  Une ligne PROVISOIRE (créée à l'instant, sans identité serveur) ne bouge
   *  pas : son `POST` en vol la ferait naître dans l'ancienne séance. */
  const moveExerciseToSession = useCallback((fromSi: number, ei: number, toSi: number, toIdx: number) => {
    if (fromSi === toSi) { moveExercise(fromSi, ei, toIdx); return; }
    const semaine = semaineCourante();
    const ligneId = semaine?.sessions?.[fromSi]?.exercises[ei]?.id;
    const cibleId = semaine?.sessions?.[toSi]?.id;
    if (!ligneId || estEnCreation(ligneId) || !cibleId) return;
    let position = toIdx;
    updateWeek(week => {
      const src = week.sessions?.[fromSi];
      const dst = week.sessions?.[toSi];
      if (!src || !dst) return;
      position = deplacerEntreSeances(src.exercises, ei, dst.exercises, toIdx);
    });
    if (!programId) return;
    void ecrireOuRattraper({ genre: 'deplacement', programId, id: ligneId, sessionId: cibleId, position });
  }, [updateWeek, ecrireOuRattraper, programId, moveExercise]);

  const addSession = useCallback(async (name: string) => {
    const semaine = semaineCourante();
    // Le bouton est éteint sans semaine ; ceci garde tout autre appelant.
    if (!semaine?.id) return;
    const id = nouvelleIdentite();
    updateWeek(week => {
      (week.sessions ??= []).push({
        id, name, sessionDate: '', formOfTheDay: null, exercises: [], lignesSansRessenti: 0,
      });
    });
    if (isMock || !programId) return;
    await ecrireOuRattraper({ genre: 'creation', programId, cible: 'sessions', id, parent: semaine.id, corps: { id, name } });
  }, [ecrireOuRattraper, programId, updateWeek]);

  const removeSession = useCallback((si: number) => {
    const cible = semaineCourante()?.sessions?.[si];
    updateWeek(week => {
      // Même raison que pour la ligne : garder la dernière séance à l'écran
      // alors que le serveur l'a supprimée faisait diverger les deux.
      if (!week.sessions) return;
      week.sessions.splice(si, 1);
    });
    // La séance emporte ses lignes : leurs patchs en attente aussi (FRE-86).
    const emportes = [cible?.id, ...(cible?.exercises ?? []).map(e => e.id)].filter((id): id is string => !!id);
    oublierPatchs(emportes);
    if (!cible?.id || estEnCreation(cible.id)) return;
    void supprimer('sessions', cible.id, emportes);
  }, [updateWeek, supprimer, oublierPatchs]);

  const moveSession = useCallback((from: number, to: number) => {
    if (from === to) return;
    updateWeek(week => {
      if (!week.sessions) return;
      const [moved] = week.sessions.splice(from, 1);
      week.sessions.splice(to, 0, moved);
    });
    const semaine = semaineCourante();
    const ids = idsEtablis(semaine?.sessions ?? []);
    if (semaine?.id && ids.length && programId) {
      void ecrireOuRattraper({ genre: 'ordre', programId, cible: 'sessions', id: semaine.id, ids });
    }
  }, [updateWeek, ecrireOuRattraper, programId]);

  /* ----- Cycle de vie ----- */

  const invalidate = useCallback(() => {
    invalider(qc, programId);
  }, [qc, programId]);

  const clonedBaseFrom = useCallback(async (blocSource?: string): Promise<BlockBase | undefined> => {
    if (!blocSource) return undefined;
    // ⚠️ DEMANDÉE AU SERVEUR, ICI ET MAINTENANT (FRE-119). `macros` ne porte
    // plus la trame que du bloc COURANT ; y chercher celle d'un autre rendait
    // `undefined`, donc un bloc créé SANS sa trame — en silence, puisque rien
    // n'échoue : la BASE est simplement vide, et le coach recommence en croyant
    // s'être trompé. C'est exactement le défaut de production du 17/08, repris
    // par l'autre bout.
    //
    // `fetchQuery` et non `api.get` : même clé, même requête que le hook, donc
    // le cache sert si le bloc a déjà été ouvert.
    const src = programId
      ? (await qc.fetchQuery({
          queryKey: cleContenuDeBloc(programId, blocSource),
          queryFn: () => contenuDeBloc(programId, blocSource),
          staleTime: 30_000,
        })).base
      : undefined;
    if (!src) return undefined;
    const cloned = deepClone(src);
    // Les dates de la semaine 1 NE SE DUPLIQUENT PAS : le bloc copié commence
    // quand son coach le décidera. `''` et non l'effacement de la clé — c'est
    // ce que le serveur renvoie pour une date non renseignée, et faire diverger
    // les deux formes obligeait l'éditeur à gérer l'absence en plus du vide.
    cloned.s1StartDate = '';
    cloned.s1EndDate = '';
    return cloned;
  }, [programId, qc]);

  /** La trame à dupliquer, ou `undefined` : sans source, ou si elle est
   *  INATTEIGNABLE — auquel cas on ne crée RIEN. Un bloc créé sans sa trame,
   *  en silence, est exactement le défaut du 17/08 : le coach recommence en
   *  croyant s'être trompé. */
  const trameSource = useCallback(async (blocSource?: string): Promise<{ base?: BlockBase } | null> => {
    if (!blocSource) return {};
    try {
      return { base: await clonedBaseFrom(blocSource) };
    } catch (e) {
      saveFailed(e);
      return null;
    }
  }, [clonedBaseFrom, saveFailed]);

  // ⚠️ COMME `addBlock` : le premier bloc du macro naît SANS semaine (22/08).
  // Un macro neuf ouvrait sur une semaine 1 vide que personne n'avait demandée,
  // alors que le geste suivant est de composer la BASE.
  const addMacro = useCallback(async (options?: { duplicateFrom?: string }) => {
    const source = await trameSource(options?.duplicateFrom);
    if (!source) return;
    const clonedBase = source.base;
    const next = deepClone(macrosRef.current);

    // brokkr crée macro + 1er bloc en UN batch atomique — à condition que le
    // bloc soit NICHÉ. `MacroCreate` est en `extra="forbid"` : envoyé à la
    // racine, il faisait échouer tout ajout de macro en 422.
    //
    // ⚠️ LES DEUX IDENTITÉS SONT CHOISIES ICI : c'est ce qui rend la création
    // rejouable sans doublon, et le second bloc qu'un rejeu ajouterait sinon.
    const id = nouvelleIdentite();
    const blocId = nouvelleIdentite();
    // ⚠️ `objectivesVersion: ''` : la version d'un bloc neuf n'existe qu'à la
    // relecture (`invalidate()` juste en dessous). La calculer ici en ferait une
    // seconde définition de l'empreinte ; une écriture partie avant la relecture
    // est refusée en 422, elle n'écrase rien (FRE-163).
    next.push({
      id,
      macroNumber: next.length + 1,
      name: '', trainingFrequency: null, coachNotes: null,
      blocks: [{ id: blocId, blockNumber: 1, name: '', startDate: '', endDate: '', base: clonedBase ?? createEmptyBlockBase(), objectives: [], objectivesVersion: '', weeks: [] }],
    });
    commit(next);
    selectionRef.current.select({ macroId: id, blockId: blocId });
    if (isMock || !programId) return;

    // ⚠️ PAR LA FILE, comme la trame et les suppressions : sans réseau, le
    // macro attend sur le disque, et l'écran le montre déjà.
    const ok = await ecrireOuRattraper({
      genre: 'creation', programId, cible: 'macros', id, parent: programId,
      corps: { id, block: { id: blocId, ...(clonedBase ? { base: clonedBase } : {}) } },
    });
    if (ok) invalidate();
  }, [commit, ecrireOuRattraper, invalidate, programId, trameSource]);

  const addBlock = useCallback(async (options?: { duplicateFrom?: string }) => {
    const { macroIndex } = selectionRef.current;
    const macro = macrosRef.current[macroIndex];
    if (!macro) return;
  // ⚠️ UN BLOC NEUF N'A PLUS DE SEMAINE 1 (22/08). Il en naissait une, vide, et
  // c'était déroutant pour les coachs qui travaillent depuis la BASE : une
  // semaine apparaissait avant qu'ils aient rien décidé, puis « Générer la
  // semaine 1 » la remplissait — deux objets pour un seul geste. Le bloc naît
  // désormais nu ; la génération CRÉE la semaine (`POST /blocks/{id}/weeks`)
  // au lieu de remplir une coquille.
    const source = await trameSource(options?.duplicateFrom);
    if (!source) return;
    const clonedBase = source.base;
    const next = deepClone(macrosRef.current);
    const id = nouvelleIdentite();

    next[macroIndex].blocks.push({ id, blockNumber: macro.blocks.length + 1, name: '', startDate: '', endDate: '',
      base: clonedBase ?? createEmptyBlockBase(), objectives: [], objectivesVersion: '', weeks: [] });
    commit(next);
    selectionRef.current.select({ macroId: macro.id, blockId: id });
    if (isMock || !programId) return;

    const ok = await ecrireOuRattraper({
      genre: 'creation', programId, cible: 'blocks', id, parent: macro.id,
      corps: { id, ...(clonedBase ? { base: clonedBase } : {}) },
    });
    if (ok) invalidate();
  }, [commit, ecrireOuRattraper, invalidate, programId, trameSource]);

  /** ⚠️ LA SEMAINE SUIVANTE A CHANGÉ DE CÔTÉ (26/08), comme la génération depuis
   *  la BASE. Elle se fabriquait ici — réalisé vidé, incréments appliqués,
   *  charges effacées, héritage du RPE cible en remontant le bloc — puis partait
   *  en `POST` du contenu, matérialisation des lignes vides, adoption des ids.
   *
   *  Toutes ses entrées étaient déjà en base : la semaine précédente et son
   *  réalisé, la granularité du bloc, le 1RM de programmation. Le navigateur les
   *  téléchargeait pour calculer ce que le serveur avait sous la main.
   *
   *  ⚠️ ET LE 1RM N'EST PLUS TRANSMIS, il est LU. C'est ce qui fait enfin
   *  fonctionner l'incrément en pourcentage : il porte sur la Table RM du jour. */
  const addWeek = useCallback(async () => {
    const { macroIndex, blockIndex } = selectionRef.current;
    const macro = macrosRef.current[macroIndex];
    const block = macro?.blocks[blockIndex];
    if (!macro || !block) return;

    if (isMock || !programId) return;

    // ⚠️ `Week` ET NON `WeekEditing` (FRE-144) : le serveur rend une semaine
    // ENREGISTRÉE, donc son `id` est garanti. Le type d'édition le donnait
    // facultatif, et le `select({ weekId: res.id })` deux lignes plus bas
    // recevait un `string | undefined` — c'est-à-dire la possibilité de
    // sélectionner « aucune semaine » juste après en avoir créé une.
    // ⚠️ ET PLUS DE `{}` : la route ne déclare AUCUN corps. En envoyer un
    // n'avait aucun effet, mais faisait croire à un contrat qui n'existe pas.
    const res = await appelStructurel(() => api.post<Week>(
      `/programs/${programId}/blocks/${block.id}/next-week`));
    if (!res) return;

    const next = deepClone(macrosRef.current);
    next[macroIndex].blocks[blockIndex].weeks.push(res);
    commit(next);
    selectionRef.current.select({ macroId: macro.id, blockId: block.id, weekId: res.id });
    invalidate();
  }, [appelStructurel, commit, invalidate, programId]);

  const removeMacro = useCallback(async (index: number) => {
    const macro = macrosRef.current[index];
    if (!macro) return;
    const emportes = [macro.id, ...macro.blocks.flatMap(b => [b.id, ...b.weeks.flatMap(idsDuSousArbre)])];
    if (!await supprimer('macros', macro.id, emportes)) return;
    oublierPatchs(emportes);
    const next = deepClone(macrosRef.current);
    next.splice(index, 1);
    next.forEach((m, i) => { m.macroNumber = i + 1; });
    commit(next);
    invalidate();
  }, [commit, invalidate, oublierPatchs, supprimer]);

  const removeBlock = useCallback(async (index: number) => {
    const { macroIndex } = selectionRef.current;
    const macro = macrosRef.current[macroIndex];
    const block = macro?.blocks[index];
    if (!macro || !block) return;
    const emportes = [block.id, ...block.weeks.flatMap(idsDuSousArbre)];
    if (!await supprimer('blocks', block.id, emportes)) return;
    oublierPatchs(emportes);
    // ⚠️ ON OUBLIE SON CONTENU, ON NE L'INVALIDE PAS. `invalidate()` REJOUE les
    // requêtes actives, et celle du bloc qu'on vient de supprimer l'est encore
    // le temps d'un rendu : elle repartait donc chercher un bloc mort, en 404.
    // Invalider demande de relire ; ici il n'y a plus rien à lire.
    qc.removeQueries({ queryKey: cleContenuDeBloc(programId, block.id) });
    const next = deepClone(macrosRef.current);
    next[macroIndex].blocks.splice(index, 1);
    next[macroIndex].blocks.forEach((b, i) => { b.blockNumber = i + 1; });
    commit(next);
    invalidate();
  }, [commit, invalidate, oublierPatchs, programId, qc, supprimer]);

  const removeWeek = useCallback(async (index: number) => {
    const { macroIndex, blockIndex } = selectionRef.current;
    const macro = macrosRef.current[macroIndex];
    const block = macro?.blocks[blockIndex];
    const week = block?.weeks[index];
    if (!macro || !block || !week?.id) return;
    if (!await supprimer('weeks', week.id, idsDuSousArbre(week))) return;
    // ⚠️ APRÈS L'ACCORD DU SERVEUR, et pas avant. Un `DELETE` refusé laisse la
    // semaine en place : oublier ses patchs à ce moment-là perdrait une frappe
    // sur un objet toujours vivant — l'inverse exact de ce qu'on corrige.
    oublierPatchs(idsDuSousArbre(week));
    const next = deepClone(macrosRef.current);
    next[macroIndex].blocks[blockIndex].weeks.splice(index, 1);
    next[macroIndex].blocks[blockIndex].weeks.forEach((w, i) => { w.weekNumber = i + 1; });
    commit(next);
    invalidate();
  }, [commit, invalidate, oublierPatchs, supprimer]);

  /* ----- Méta ----- */

  /** ⚠️ PAR LA FILE DE PATCHS, comme une frappe (25/09). Renommer, masquer,
   *  dater partaient en `PATCH` direct : sans réseau, un toast et le geste
   *  perdu. Ils fusionnent désormais par objet, attendent le réseau sur le
   *  disque, et la charpente est relue à l'acquittement — le calendrier et le
   *  tableau de bord la lisent sous `['structure']` (FRE-144). */

  const renameMacro = useCallback((index: number, name: string) => {
    const macro = macrosRef.current[index];
    if (!macro) return;
    const next = deepClone(macrosRef.current);
    next[index].name = name;
    commit(next);
    schedulePatch('macros', macro.id, { name: name || '' });
  }, [commit, schedulePatch]);

  const renameBlock = useCallback((index: number, name: string) => {
    const { macroIndex } = selectionRef.current;
    const macro = macrosRef.current[macroIndex];
    const block = macro?.blocks[index];
    if (!macro || !block) return;
    const next = deepClone(macrosRef.current);
    next[macroIndex].blocks[index].name = name;
    commit(next);
    schedulePatch('blocks', block.id, { name: name || '' });
  }, [commit, schedulePatch]);

  const renameWeek = useCallback((index: number, name: string) => {
    const { macroIndex, blockIndex } = selectionRef.current;
    const macro = macrosRef.current[macroIndex];
    const block = macro?.blocks[blockIndex];
    const week = block?.weeks[index];
    if (!macro || !block || !week) return;
    const next = deepClone(macrosRef.current);
    next[macroIndex].blocks[blockIndex].weeks[index].name = name;
    commit(next);
    schedulePatch('weeks', week.id, { name: name || '' });
  }, [commit, schedulePatch]);

  /** ÉTIRER (OU RACCOURCIR) UNE SEMAINE — et pousser celles d'après (20/09).
   *
   *  ⚠️ LA DURÉE DE RÉFÉRENCE NE BOUGE PAS. « S3 l'athlète a besoin de 3 jours
   *  de plus pour déplacement professionnel ; S4 dure bien 5 jours mais débute à
   *  la date de fin de S3 » (William). La BASE continue donc de dire ce que dure
   *  un tour ; cette fin-là n'est qu'une exception, portée par la semaine.
   *
   *  ⚠️ PAR `PATCH /weeks/{id}`, PAS PAR LA CASCADE DE LA BASE. `PUT /base`
   *  réécrit la trame ENTIÈRE (principes et accessoires supprimés puis
   *  réinsérés) pour bouger deux dates, et il exige une BASE — que 17 blocs de
   *  production datés n'ont pas : le geste y aurait changé l'écran sans rien
   *  écrire. Le contrat de semaine porte déjà `startDate`/`endDate` ; il n'avait
   *  simplement aucun appelant. Les semaines partent dans l'ordre, la visée
   *  d'abord : une coupure au milieu laisse au pire une suivante pas encore
   *  décalée, jamais une semaine à l'envers. */
  const decalerLaFinDeSemaine = useCallback(async (index: number, fin: string) => {
    const { macroIndex, blockIndex } = selectionRef.current;
    const macro = macrosRef.current[macroIndex];
    const block = macro?.blocks[blockIndex];
    const semaine = block?.weeks[index];
    const debut = semaine?.startDate ?? '';
    if (!macro || !block || !semaine || !debut || !fin || fin < debut) return;

    // La semaine visée prend sa nouvelle fin ; les suivantes s'enchaînent en
    // gardant la leur. Celles d'avant ne bougent pas : on ne réécrit pas le passé.
    const avecLaNouvelleFin = block.weeks.map((w, i) => (i === index ? { ...w, endDate: fin } : w));
    const s1 = block.base?.s1StartDate || block.weeks[0]?.startDate || '';
    const s1Fin = block.base?.s1EndDate || block.weeks[0]?.endDate || '';
    if (!s1) return;
    const dates = datesEnchainees(avecLaNouvelleFin, s1, s1Fin, index);

    const next = deepClone(macrosRef.current);
    const b = next[macroIndex]?.blocks[blockIndex];
    if (b) b.weeks.forEach((w, i) => {
      if (i >= index) { w.startDate = dates[i].startDate; w.endDate = dates[i].endDate; }
    });
    commit(next);

    // Une semaine sans identité serveur n'a rien à patcher : `schedulePatch`
    // l'écarte. La charpente est relue à l'acquittement (cf. « Méta »).
    for (let i = index; i < block.weeks.length; i++) {
      schedulePatch('weeks', block.weeks[i].id, { startDate: dates[i].startDate, endDate: dates[i].endDate });
    }
  }, [commit, schedulePatch]);

  const toggleWeekHidden = useCallback((macroId: string, blockId: string, weekId: string) => {
    const mi = macrosRef.current.findIndex(m => m.id === macroId);
    const bi = mi >= 0 ? macrosRef.current[mi].blocks.findIndex(b => b.id === blockId) : -1;
    const wi = bi >= 0 ? macrosRef.current[mi].blocks[bi].weeks.findIndex(w => w.id === weekId) : -1;
    if (mi < 0 || bi < 0 || wi < 0) return;
    const newHidden = !macrosRef.current[mi].blocks[bi].weeks[wi].hidden;
    const next = deepClone(macrosRef.current);
    next[mi].blocks[bi].weeks[wi].hidden = newHidden;
    commit(next);
    schedulePatch('weeks', weekId, { hidden: newHidden });
  }, [commit, schedulePatch]);

  /* ----- Objectifs du bloc sélectionné (PUT complet, débouncé) ----- */

  const saveObjectives = useCallback((updater: (objectives: BlockObjective[]) => void) => {
    const { macroIndex, blockIndex } = selectionRef.current;
    const next = deepClone(macrosRef.current);
    const macro = next[macroIndex];
    const block = macro?.blocks[blockIndex];
    if (!macro || !block) return;
    block.objectives = block.objectives ?? [];
    updater(block.objectives);
    commit(next);

    if (isMock || !programId) return;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const objectives = deepClone(block.objectives).map(({ id: _id, ...rest }) => rest);
    const blocId = block.id;
    /** Le bloc tel qu'il est MAINTENANT dans l'arbre — pas celui de la frappe. */
    const trouver = (arbre: MacrocycleEditing[]) =>
      arbre.flatMap(m => m.blocks).find(b => b.id === blocId);
    planifierObjectifs(blocId, `${macro.id}/${blocId}`, objectives,
      () => trouver(macrosRef.current)?.objectivesVersion ?? '',
      version => {
        const suivant = deepClone(macrosRef.current);
        const cible = trouver(suivant);
        if (!cible) return;
        cible.objectivesVersion = version;
        commit(suivant);
      });
  }, [commit, planifierObjectifs, programId]);

  const addObjective = useCallback(() => {
    saveObjectives(objectives => { objectives.push(createEmptyObjective()); });
  }, [saveObjectives]);

  const updateObjective = useCallback((index: number, field: keyof BlockObjective, value: string | null) => {
    saveObjectives(objectives => {
      if (objectives[index]) (objectives[index] as unknown as Record<string, string | null | undefined>)[field] = value;
    });
  }, [saveObjectives]);

  const removeObjective = useCallback((index: number) => {
    saveObjectives(objectives => { objectives.splice(index, 1); });
  }, [saveObjectives]);

  /** ⚠️ L'ORDRE DU TABLEAU *EST* LA POSITION EN BASE. `PUT .../objectives`
   *  remplace la liste entière et la colonne `position` se dérive de l'index :
   *  déplacer, c'est donc réécrire la liste, exactement comme ajouter ou
   *  supprimer. Rien de nouveau sur le fil — même chemin, même débounce.
   *
   *  Le tableau à neuf colonnes laissait croire que cet ordre se manipulait ;
   *  il ne se manipulait pas, il n'existait aucun geste pour le changer. Les
   *  cartes ne retirent donc rien, elles rendent le geste explicite (refonte des écrans, 09/2026). */
  const moveObjective = useCallback((from: number, to: number) => {
    saveObjectives(objectives => {
      if (from === to || from < 0 || to < 0 || from >= objectives.length || to >= objectives.length) return;
      const [deplace] = objectives.splice(from, 1);
      objectives.splice(to, 0, deplace);
    });
  }, [saveObjectives]);

  /* ----- BASE ----- */

  const updateBlockBase = useCallback(async (blockIndex: number, base: BlockBase) => {
    const { macroIndex } = selectionRef.current;
    const macro = macrosRef.current[macroIndex];
    const block = macro?.blocks[blockIndex];
    if (!macro || !block) return;

    // Re-datation cascade quand la date S1 change (y compris posée après coup).
    const prevBase = block.base;
    const s1Changed = !!base.s1StartDate && (
      base.s1StartDate !== (prevBase?.s1StartDate ?? '')
      || (base.s1EndDate ?? '') !== (prevBase?.s1EndDate ?? '')
    );
    // ⚠️ LES SEMAINES GARDENT LEUR DURÉE (20/09). La cascade appliquait celle de
    // S1 à toutes : une semaine que le coach avait étirée revenait à la longueur
    // de référence au premier changement de date de S1, sans un mot. Quinze
    // semaines de production sont dans ce cas. Ce qui se propage, c'est le
    // DÉCALAGE ; la durée propre de chacune lui appartient.
    const dates = s1Changed && block.weeks.length > 0
      ? datesEnchainees(block.weeks, base.s1StartDate!, base.s1EndDate ?? '')
      : null;

    const next = deepClone(macrosRef.current);
    const b = next[macroIndex]?.blocks[blockIndex];
    if (b) {
      b.base = base;
      if (dates) b.weeks.forEach((w, i) => { w.startDate = dates[i].startDate; w.endDate = dates[i].endDate; });
    }
    commit(next);

    if (isMock || !programId) return;
    // Base + dates des semaines en UNE écriture atomique (batch serveur).
    //
    // ⚠️ LES SEMAINES SANS IDENTITÉ SERVEUR SORTENT DE LA LISTE (FRE-144), et
    // c'est le type de corps qui l'a révélé : `WeekEditing.id` est facultatif,
    // `WeekDate.weekId` ne l'est pas. Une semaine pas encore enregistrée
    // produisait `{ weekId: undefined }`, que `JSON.stringify` efface — le
    // serveur recevait une entrée SANS son identifiant et refusait TOUTE la
    // requête en 422, trame comprise. Même règle qu'`idsEtablis` : ce qui n'a
    // pas d'identité ne part pas, plutôt que de faire tomber le reste avec lui.
    const weekDates = dates
      ? block.weeks
          .map((w, i) => ({ weekId: w.id, ...dates[i] }))
          .filter((d): d is { weekId: string; startDate: string; endDate: string } => !!d.weekId)
      : undefined;
    // ⚠️ PAR LA FILE, COMME UNE FRAPPE. Sans réseau, la trame est GARDÉE et
    // repart au retour, entière : la dernière version gagne. Elle partait en
    // direct, toastait « pas de connexion », et le serveur repeignait la
    // version d'avant au retour du réseau (Aubin, 25/09).
    const acceptee = await ecrire({
      genre: 'base', programId, id: block.id,
      corps: { base, ...(weekDates?.length ? { weekDates } : {}) },
    });
    if (!acceptee) {
      // RESYNCHRONISER SUR REFUS — la règle qu'`appelStructurel` porte déjà :
      // « garder un local divergent du serveur est pire que perdre le geste ».
      invalidate();
      return;
    }
    // ⚠️ SUR LE SUCCÈS AUSSI, MAIS SEULEMENT QUAND LES DATES ONT BOUGÉ (FRE-144).
    // `weekDates` REDATE les semaines côté serveur : c'est de la charpente, lue
    // par le calendrier et la frise sous `['structure']`, cinq minutes de
    // `staleTime`. L'éditeur de BASE, lui, ne montre pas ces dates — le décalage
    // était donc invisible depuis l'écran qui le produit. C'est la REDATATION
    // qui périme, pas l'écriture de trame.
    //
    // ⚠️ ET INVALIDER À CHAQUE ÉCRITURE CASSAIT L'AJOUT D'ACCESSOIRE, en
    // production comme dans le harnais (`base-sans-dates`, rouge du 08/09) :
    // la relecture rendait une trame sans la ligne encore sans nom, `dejaSeme`
    // resemait le brouillon, et la ligne DISPARAISSAIT avant que le coach ait
    // pu la nommer. brokkr GARDE désormais une ligne de BASE sans nom
    // (`SANS_NOM_ACCEPTE`) ; ce que la portée vaut encore par elle-même : trois
    // `GET` à CHAQUE frappe dans la trame, pour relire ce qu'on vient d'envoyer.
    if (weekDates?.length) invalidate();
  }, [commit, ecrire, invalidate, programId]);

  /** ⚠️ LA GÉNÉRATION A CHANGÉ DE CÔTÉ (26/08). Elle vivait ici : fabriquer la
   *  semaine depuis la BASE, l'envoyer en `PUT /content`, patcher la méta,
   *  matérialiser les lignes vides une par une, adopter les ids rendus. Trois à
   *  N allers-retours, et un `catch` qui resynchronisait tout parce qu'un échec
   *  AU MILIEU laissait l'écran ignorant de ce que le serveur avait déjà écrit.
   *
   *  Un appel, une transaction, et la réponse est la semaine telle qu'elle
   *  EXISTE — plus rien à adopter ni à deviner.
   *
   *  ⚠️ ET PLUS RIEN À OUBLIER NON PLUS : le défaut corrigé ce matin (un patch
   *  en attente qui partait sur une ligne que le `PUT` venait de détruire)
   *  disparaît avec le chemin qui le portait. Les anciennes lignes ne
   *  transitent plus par ici. */
  const generateWeekOneFromBase = useCallback(async (blockIndex: number) => {
    const { macroIndex } = selectionRef.current;
    const macro = macrosRef.current[macroIndex];
    const block = macro?.blocks[blockIndex];
    if (!macro || !block) return;

    if (isMock || !programId) {
      // En maquette, la génération n'a pas de serveur à qui demander. On ne la
      // simule pas : ce serait réécrire en TypeScript ce qu'on vient d'en
      // retirer — et la maquette mentirait sur la seule chose qui compte ici.
      return;
    }

    // Les patchs en attente sur la semaine remplacée meurent avec elle.
    const remplacee = block.weeks[0];
    // Même contrat que `next-week` : semaine enregistrée en réponse, pas de corps.
    const res = await appelStructurel(() => api.post<Week>(
      `/programs/${programId}/blocks/${block.id}/generate-week`));
    if (!res) return;
    if (remplacee) oublierPatchs(idsDuSousArbre(remplacee));

    const next = deepClone(macrosRef.current);
    const semaines = next[macroIndex].blocks[blockIndex].weeks;
    if (remplacee) semaines[0] = res; else semaines.unshift(res);
    commit(next);
    selectionRef.current.select({ macroId: macro.id, blockId: block.id, weekId: res.id });
    invalidate();
  }, [appelStructurel, commit, invalidate, oublierPatchs, programId]);

  return {
    macros,
    arbreComplet: arbre ?? [],
    contenuEnPause,
    basesDisponibles,
    // ⚠️ LA CHARPENTE **ET** LE CONTENU. N'attendre que la première montrerait
    // le bloc courant sans ses séances — c'est-à-dire une semaine vide, avec le
    // bouton « + Séance » à côté. Un coach qui clique là dessus crée un doublon.
    loading: chargeCharpente || chargeContenu,
    selection,
    updateExercise,
    setExerciseKind,
    setSessionKind,
    updateExerciseSetRPE,
    updateExerciseFeltRPE,
    updateExerciseSetValue,
    updateSessionForm,
    addExercise,
    duplicateExercise,
    removeExercise,
    moveExercise,
    moveExerciseToSession,
    addSession,
    removeSession,
    renameSession,
    moveSession,
    addMacro,
    addBlock,
    addWeek,
    removeMacro,
    removeBlock,
    removeWeek,
    renameMacro,
    renameBlock,
    renameWeek,
    decalerLaFinDeSemaine,
    toggleWeekHidden,
    addObjective,
    updateObjective,
    removeObjective,
    moveObjective,
    updateBlockBase,
    generateWeekOneFromBase,
    // ⚠️ EXPOSÉ POUR L'ÉDITEUR DE BASE (FRE-66), qui tient son propre brouillon
    // hors de cet arbre et doit savoir quand il peut le resemer sans écraser une
    // frappe. C'est la MÊME question que se pose le resync ci-dessus ; la poser
    // deux fois avec deux réponses différentes serait le début de la divergence
    // qu'on essaie justement d'empêcher.
    hasPendingWrites,
    etatEnregistrement,
  };
}
