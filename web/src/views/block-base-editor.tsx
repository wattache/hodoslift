import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronUp, ChevronDown, Dumbbell, Eye, EyeOff, Link2, Link2Off, Lock, LockOpen, ListChecks, Minus, Plus, RotateCw, Settings2, Sparkles, TriangleAlert, Trash2, Wand2 } from 'lucide-react';
import type {
  IncrementUnit, BlockBase, DayTiers, ExerciseKind, Principle, BaseAccessory, OneRepMax } from '@/api/types';
import type { BlockEditing } from '@/api/types';
import { abregerMouvements, couleurDuJour, CYCLE_MAX, CYCLE_MIN, joursDuCycle, mouvementsDeLaTrame, nomDuJour, normaliseDaySplit, sansNomsDeSemaine, rangDeCycle, versJourDeCycle } from '@/lib/constants';
import { datesDeS1 } from '@/lib/program-selection';
import { addDays } from '@/lib/dates';
import { createEmptyBlockBase } from '@/lib/exercise';
import { kindToWrite, parseTier } from '@/lib/exercise-kind';
import { useApercuSemaine } from '@/api/hooks/use-apercu-semaine';
import { orderedPrincipaux } from '@/lib/principaux';
import { AIMED_RPE_OPTIONS } from '@/lib/rpe';
import { champsDeGroupe, estChronometre, leReposSeSaisit, natureDe, type NatureDeGroupe } from '@/lib/groupe';
import { ChoixDeNature } from '@/components/training/choix-de-nature';
import { naviguerAuClavier } from '@/lib/navigation-clavier';
import { WeekOverview } from '@/components/training/week-overview';
import { MovementHistory } from '@/components/training/movement-history';
import { useLocalStorageState } from '@/lib/storage';
import { usePreferenceProgression } from '@/lib/preference-progression';
import { cn } from '@/lib/utils';
import { DatePicker } from '@/components/ui/date-picker';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useTranslation } from 'react-i18next';
import { useEnLigne } from '@/lib/reseau';
import { ComboboxMultiple } from '@/components/ui/combobox';
import { MAX_VARIANTES } from '@/lib/variantes';

/** Éditeur de la trame (BASE) d'un bloc d'entraînement.
 *  Sections : Répartition hebdo (daySplit/tiers) · Principes (par mouvement) ·
 *  Renforcement (accessoires) · Aperçu de la semaine générée.
 *  État local (draft) + persistance via onChange ; génération via onGenerate.
 *  (DnD de réordonnancement + nav clavier spreadsheet = polish différé.) */

export interface CoachLib {
  principaux: string[];
  renforcement: string[];
  variantes: string[];
  assistances: string[];
  tempos: string[];
  formats: string[];
}

interface Props {
  blockLabel: string;
  /** Identités nécessaires à l'APERÇU, qui est calculé par le serveur. */
  programId: string | null | undefined;
  blockId: string;
  base: BlockBase | undefined;
  /** ⚠️ RESTE DANS LE CONTRAT MALGRÉ SA NON-UTILISATION ICI (26/08) : l'écran
   *  ne calcule plus d'incrément en pourcentage — le serveur le fait, sur la
   *  Table RM lue en base. Le retirer des props obligerait l'appelant à savoir
   *  que cet écran a cessé d'en avoir besoin ; il est simplement ignoré. */
  oneRM: OneRepMax;
  lib: CoachLib;
  canGenerate: boolean;
  onChange: (base: BlockBase) => void;
  onGenerate: () => void;
  /** Y a-t-il une écriture locale non encore acquittée par le serveur ?
   *
   *  ⚠️ C'EST LA MÊME QUESTION QUE SE POSE LE RESYNC DE L'ARBRE, et c'est
   *  volontairement la même réponse : `training-editor` la tient déjà pour lui,
   *  on la lui emprunte plutôt que d'en tenir une seconde ici. Deux réponses
   *  divergentes à « peut-on écraser le local ? » seraient exactement le défaut
   *  qu'on répare. */
  hasPendingWrites: () => boolean;
  /** Blocs précédents du macro — pour l'historique de progression par mouvement. */
  pastBlocks?: BlockEditing[];
}

// 'sets' : progresser en VOLUME (3×5 → 4×5), au même titre qu'en charge.
//
// ⚠️ '%' A ÉTÉ RETIRÉ LE 01/09/2026, et la LISTE N'EN EST PAS LA GARDIENNE :
// `IncrementUnit` dérive du contrat brokkr, donc le jour où le serveur a cessé
// d'accepter l'unité, `tsc` a refusé cette ligne. C'est la raison pour laquelle
// elle n'énumère pas des chaînes libres.
//
// Le pourcentage portait sur le 1RM lu au moment de la génération : une même
// « +5 % » donnait une charge différente selon le jour du clic. C'est au coach
// de calculer son pourcentage et d'écrire les kilos — voir `resoudre_increment`
// côté brokkr.
const INCREMENT_UNITS: readonly IncrementUnit[] = ['kg', 'reps', 'rpe', 'sets'];

const COLOR_TONES = {
  gold: {
    border: 'border-gold/35',
    bg: 'bg-gold/10',
    bgSoft: 'bg-gold/5',
    text: 'text-gold',
    dot: 'bg-gold',
    shadow: 'shadow-[inset_3px_0_0_var(--gold)]',
  },
  blue: {
    border: 'border-block-accumulation/35',
    bg: 'bg-block-accumulation/10',
    bgSoft: 'bg-block-accumulation/5',
    text: 'text-block-accumulation',
    dot: 'bg-block-accumulation',
    shadow: 'shadow-[inset_3px_0_0_var(--block-accumulation)]',
  },
  orange: {
    border: 'border-block-intensification/35',
    bg: 'bg-block-intensification/10',
    bgSoft: 'bg-block-intensification/5',
    text: 'text-block-intensification',
    dot: 'bg-block-intensification',
    shadow: 'shadow-[inset_3px_0_0_var(--block-intensification)]',
  },
  red: {
    border: 'border-block-realisation/35',
    bg: 'bg-block-realisation/10',
    bgSoft: 'bg-block-realisation/5',
    text: 'text-block-realisation',
    dot: 'bg-block-realisation',
    shadow: 'shadow-[inset_3px_0_0_var(--block-realisation)]',
  },
  green: {
    border: 'border-success/35',
    bg: 'bg-success/10',
    bgSoft: 'bg-success/5',
    text: 'text-success',
    dot: 'bg-success',
    shadow: 'shadow-[inset_3px_0_0_var(--success)]',
  },
  gray: {
    border: 'border-block-deload/35',
    bg: 'bg-block-deload/10',
    bgSoft: 'bg-block-deload/5',
    text: 'text-muted-foreground',
    dot: 'bg-block-deload',
    shadow: 'shadow-[inset_3px_0_0_var(--block-deload)]',
  },
  violet: {
    border: 'border-violet-400/35',
    bg: 'bg-violet-400/10',
    bgSoft: 'bg-violet-400/5',
    text: 'text-violet-300',
    dot: 'bg-violet-400',
    shadow: 'shadow-[inset_3px_0_0_rgb(167,139,250)]',
  },
} as const;

const TIER_TONES = {
  1: { border: 'border-gold/45', bg: 'bg-gold/15', bgSoft: 'bg-gold/5', text: 'text-gold', dot: 'bg-gold', shadow: 'shadow-[inset_3px_0_0_var(--gold)]' },
  2: { border: 'border-block-accumulation/45', bg: 'bg-block-accumulation/15', bgSoft: 'bg-block-accumulation/5', text: 'text-block-accumulation', dot: 'bg-block-accumulation', shadow: 'shadow-[inset_3px_0_0_var(--block-accumulation)]' },
  3: { border: 'border-block-deload/45', bg: 'bg-block-deload/15', bgSoft: 'bg-block-deload/5', text: 'text-muted-foreground', dot: 'bg-block-deload', shadow: 'shadow-[inset_3px_0_0_var(--block-deload)]' },
} as const;

type ToneKey = keyof typeof COLOR_TONES;

/** ⚠️ PLUS AUCUNE COULEUR PAR JOUR (20/09). Il y en avait une par jour de
 *  semaine, et deux coachs ont confondu jeudi (orange) et vendredi (rouge). Le
 *  fond du défaut n'était pas la nuance : une couleur par jour ne portait aucun
 *  sens, et ne tenait pas au-delà de sept. La couleur est désormais réservée au
 *  TIER, qui, lui, en a un — et le chiffre reste écrit dans la case, pour que la
 *  couleur ne soit jamais la seule information. */
function tierTone(tier: number | undefined) {
  return tier === 1 || tier === 2 || tier === 3 ? TIER_TONES[tier] : null;
}

/** LA TRAME TELLE QU'ON LA LIT — jours de semaine convertis (20/09).
 *
 *  ⚠️ CE QUE LE FRONT NE RECONNAÎT PAS, IL LE GARDE. Sur une base pas encore
 *  migrée, la grille ne porte que des « Lundi » … « Dimanche » : sans cette
 *  conversion, `normaliseDaySplit` n'en retrouve AUCUN, affiche sept lignes
 *  vides, et le premier enregistrement efface la répartition. C'est arrivé le
 *  20/09, sur le bloc de Laura. Converties, elles s'affichent juste et se
 *  réécrivent en jours de cycle — la trame se migre d'elle-même. */
function baseLisible(base: BlockBase): BlockBase {
  return {
    ...base,
    daySplit: base.daySplit.map(d => ({ ...d, day: versJourDeCycle(d.day) })),
    accessories: (base.accessories ?? []).map(a => ({ ...a, day: versJourDeCycle(a.day) })),
  };
}

/** La durée du cycle, lue sur la grille elle-même — pas stockée à côté.
 *
 *  ⚠️ UNE SEULE DÉFINITION, et c'est délibéré : une colonne `cycle_days` en
 *  plus du nombre de lignes, ce sont deux vérités qui finissent par diverger.
 *  Le défaut le plus récurrent du projet est la règle dupliquée ; on compte. */
function dureeDuCycle(split: DayTiers[]): number {
  // ⚠️ LE PLUS GRAND RANG, PAS SEULEMENT LE NOMBRE DE LIGNES. Une grille peut
  // n'écrire que ses jours utiles — « J1 » et « J4 » font un cycle de QUATRE
  // jours, pas de deux, et compter les lignes aurait effacé le J4 au premier
  // rendu. Un libellé qui n'est pas un jour de cycle ne l'étend pas.
  const dernier = split.reduce((max, d) => {
    const rang = rangDeCycle(d.day);
    return rang === Number.MAX_SAFE_INTEGER ? max : Math.max(max, rang);
  }, 0);
  return joursDuCycle(Math.max(split.length, dernier)).length;
}

export function BlockBaseEditor({ blockLabel, programId, blockId, base, lib, canGenerate, onChange, onGenerate, hasPendingWrites, pastBlocks = [] }: Props) {
  // L'historique dessine le rendu de la personne qui regarde (27/09).
  const progression = usePreferenceProgression();
  const { t } = useTranslation();
  // ⚠️ TROIS SUPPRESSIONS DE CET ÉCRAN NE DEMANDAIENT RIEN. Une ligne de principe
  // ou d'accessoire porte toute la prescription d'un mouvement — séries, reps,
  // charge, incrément, note — et partait sur un clic de corbeille, sans retour.
  // La règle de la maison est « toute suppression se confirme » ; l'éditeur de
  // BASE est justement l'écran où l'on écrit le plus longtemps avant de s'en
  // apercevoir, et le seul où une base se reproduit ensuite dans chaque semaine.
  const confirm = useConfirm();
  const [draft, setDraft] = useState<BlockBase>(() => baseLisible(base ?? createEmptyBlockBase()));

  /** ⚠️ LE BROUILLON SE RESYNCHRONISE (FRE-66). Il était semé UNE FOIS au
   *  montage et plus jamais relu — l'éditeur travaillait donc sur une photo,
   *  et la fenêtre de décalage n'avait aucune borne tant que le panneau restait
   *  ouvert.
   *
   *  Ce que ça a produit : le mystère de la « seconde tentative » d'Aubin, le
   *  17/08. Ouvert AVANT la réponse du serveur, l'éditeur montrait le clone
   *  optimiste — des principes que la base n'avait jamais reçus. Refermé,
   *  rouvert : vide. Ce n'était pas son geste qui changeait, c'était le MOMENT
   *  du montage. Et un seul clic dans ce fantôme réécrivait la BASE entière
   *  avec lui, ce qui rendait le fantôme réel.
   *
   *  ⚠️ ET SEULEMENT SI RIEN N'EST EN ATTENTE. `PUT /base` remplace la trame
   *  INTÉGRALEMENT : resemer par-dessus une frappe non acquittée l'effacerait,
   *  c'est-à-dire causerait la perte qu'on veut empêcher. C'est le motif exact
   *  du resync de l'arbre dans `training-editor.ts`, emprunté tel quel.
   *
   *  ⚠️ CETTE GARDE-CI EST REDONDANTE AUJOURD'HUI, et il faut le savoir plutôt
   *  que de s'y fier. Ce qui protège réellement, c'est la MÊME condition un cran
   *  au-dessus : quand une écriture est en vol, l'arbre ne se resynchronise pas,
   *  donc la prop `base` ne change même pas et cet effet ne se déclenche jamais.
   *  Mesuré par mutation — retirer la ligne ci-dessous ne fait rougir aucune
   *  spec, alors que retirer le comptage des écritures de BASE dans
   *  `hasPendingWrites` en fait rougir une immédiatement.
   *
   *  On la garde comme seconde ligne : elle coûte un `if`, elle dit la même
   *  vérité, et elle rattraperait un jour où la garde du dessus changerait. Mais
   *  personne ne doit croire qu'elle est éprouvée.
   *
   *  ⚠️ CE QUE CET ÉTAGE NE COUVRE PAS, sciemment : le serveur qui bouge PENDANT
   *  qu'une édition locale attend. Là, la prochaine écriture écrase toujours, en
   *  silence. Il faut un second écrivain sur le même bloc pour y arriver (autre
   *  onglet, autre coach) — rare aujourd'hui, et le remède serait un bandeau
   *  « la trame a changé ailleurs », pas un blocage : geler un panneau en cours
   *  d'édition détruirait le travail qu'on prétend protéger. */
  const dejaSeme = useRef(base);
  useEffect(() => {
    if (base === dejaSeme.current) return;   // même référence : rien n'a bougé
    dejaSeme.current = base;
    if (hasPendingWrites()) return;
    setDraft(baseLisible(base ?? createEmptyBlockBase()));
  }, [base, hasPendingWrites]);

  // Persiste + met à jour le draft local.
  const commit = (next: BlockBase) => { setDraft(next); onChange(next); };
  const previousBase = useMemo(() => {
    return [...pastBlocks].reverse().find((block) => block.base)?.base;
  }, [pastBlocks]);

  const cloneBase = (src: BlockBase): BlockBase => {
    const cloned = structuredClone(src);
    // La BASE dupliquée ne reprend PAS les dates de son modèle : le bloc copié
    // commencera quand son coach le décidera. `''` et non l'effacement de la clé,
    // parce que c'est ce que le serveur renvoie pour une date non renseignée.
    cloned.s1StartDate = '';
    cloned.s1EndDate = '';
    return cloned;
  };

  // `??` ET NON `?.length` : les deux états sont DISTINCTS, et le repli ne doit
  // valoir que pour l'un.
  //   · absent  → jamais configuré : on propose l'ordre canonique ;
  //   · `[]`    → le coach a retiré ses mouvements un par un. Geste délibéré,
  //               que le repli annulerait en lui rendant toute la bibliothèque.
  //
  // Cette écriture a été un temps accusée à tort : brokkr aplatissait `NULL`
  // en `[]` à la lecture, donc le repli ne se déclenchait jamais et l'éditeur
  // rendait ses cinq sections vides (« 14 principes » comptés, zéro affiché —
  // 48 BASE sur 111). Corrigé À LA FRONTIÈRE (`app/training_tree.py`) plutôt
  // qu'ici : un `?.length` aurait marché en apparence, au prix de confondre les
  // deux états dans l'autre sens.
  // ⚠️ ET CE QUE LA GRILLE PLACE DÉJÀ S'Y AJOUTE (FRE-198). Sans cela,
  // `normaliseDaySplit` jette la case d'un mouvement absent de la sélection, et
  // le premier enregistrement de trame la perd — quatre cases effacées le
  // 19/09 par ce chemin. La colonne réapparaît donc, et se retire par le geste
  // qui la nomme, pas par un effet de bord.
  const movements = useMemo(
    () => mouvementsDeLaTrame(
      draft.daySplit,
      draft.selectedPrincipaux ?? orderedPrincipaux(lib.principaux),
    ),
    [draft.daySplit, draft.selectedPrincipaux, lib.principaux],
  );
  const cycle = dureeDuCycle(draft.daySplit);
  const daySplit = useMemo(() => normaliseDaySplit(draft.daySplit, movements, cycle), [draft.daySplit, movements, cycle]);
  const principles = draft.principles;
  const accessories: BaseAccessory[] = draft.accessories || [];

  const addablePrincipaux = useMemo(() => {
    const selected = new Set(movements);
    const pool = new Set([...lib.principaux, ...lib.renforcement]);
    return [...pool].filter(m => !selected.has(m)).sort((a, b) => a.localeCompare(b));
  }, [movements, lib.principaux, lib.renforcement]);

  const sortedRenforcement = useMemo(
    () => [...new Set([...lib.renforcement, ...lib.principaux])].sort((a, b) => a.localeCompare(b)),
    [lib.renforcement, lib.principaux],
  );

  /** ⚠️ L'APERÇU VIENT DU SERVEUR DEPUIS LE 26/08, et ce n'est pas un détour :
   *  la génération réelle y vit désormais, et deux calculs de la même règle —
   *  un ici, un là-bas — auraient fini par diverger sans que rien ne le signale.
   *  Le serveur répond aux deux, une spec brokkr vérifie qu'ils s'accordent.
   *
   *  Le prix est une latence : l'aperçu suit la frappe à 400 ms au lieu d'être
   *  instantané. `null` tant qu'il n'a pas répondu — au premier montage, et en
   *  maquette où personne ne répond. */
  const previewWeek = useApercuSemaine(draft, blockId, programId);

  /* ---- Handlers (mutations de la base, sur le draft local) ---- */
  /** Le NOM que le coach donne à un jour du cycle (FRE-187).
   *
   *  ⚠️ `day` NE BOUGE JAMAIS. Il identifie le jour — les accessoires s'y
   *  rattachent par égalité de chaîne, le rang du cycle s'en déduit, et la
   *  génération en tire l'identifiant des groupes. Seul le libellé change.
   *
   *  ⚠️ UNE CASE VIDÉE REDEVIENT UNE ABSENCE, pas une chaîne vide : sans ça, la
   *  trame porterait deux écritures du même « pas de nom », et la génération
   *  produirait une séance sans nom que plus rien ne désigne. */
  const setLabel = (day: string, valeur: string) => {
    const propre = valeur.trim();
    const next = daySplit.map(d => (
      d.day !== day ? d : propre ? { ...d, label: valeur } : { day: d.day, tiers: d.tiers }));
    commit({ ...draft, daySplit: next, principles });
  };

  /** Le nom d'un jour tel qu'il s'affiche : son libellé, sinon le jour de la
   *  semaine sur un cycle de sept jours, sinon `J<n>` (`nomDuJour`). Pour les
   *  accessoires, rattachés par `day` : « J2 · Mardi ». */
  const libelleDuJour = (day: string) => {
    const nom = nomDuJour(daySplit.find(d => d.day === day) ?? { day }, cycle);
    return nom === day ? day : `${day} · ${nom}`;
  };

  const setTier = (day: string, movement: string, value: string | null) => {
    const next = daySplit.map(d => {
      if (d.day !== day) return d;
      const tiers = { ...d.tiers };
      if (value === '') delete tiers[movement]; else tiers[movement] = Number(value);
      return { ...d, tiers };
    });
    commit({ ...draft, daySplit: next, principles });
  };

  /** ⚠️ LA CASE TOURNE : – → 1 → 2 → 3 → – (20/09). C'étaient des `<select>` de
   *  48 px dans une grille de sept colonnes : impraticable au doigt, et le menu
   *  déroulant cachait la grille pendant qu'on choisissait. Un toucher suffit. */
  const tierSuivant = (actuel: number | undefined) => (!actuel ? '1' : actuel >= 3 ? '' : String(actuel + 1));

  /** LA DURÉE DU CYCLE DÉPLACE LA FIN DE S1 (décision William, 19/09).
   *
   *  ⚠️ AU GESTE, ET NON EN DÉRIVATION PERMANENTE. La fin de S1 donne la
   *  LONGUEUR appliquée à toutes les semaines du bloc (décision du 09/09), et
   *  20 blocs de production portent une S1 de 29 à 43 jours pour une grille de
   *  sept lignes. La recalculer à chaque rendu ramènerait ces vingt blocs à sept
   *  jours et redaterait leurs semaines — jusqu'à six par bloc — sans que
   *  personne l'ait demandé. Ici, +1 jour de cycle = +1 jour de S1, et un bloc
   *  qu'on ne touche pas garde ses dates.
   *
   *  Sans date de fin, il n'y a rien à déplacer : la trame n'est pas encore
   *  datée, et `base_sans_dates` empêche déjà de la générer. */
  const decalerLaFinDeS1 = (jours: number) => {
    const fin = (draft.s1EndDate ?? '').trim();
    if (!fin) return {};
    // ⚠️ JAMAIS AVANT LE DÉBUT : une S1 d'un jour dont on retire un jour de
    // cycle garderait sa fin, plutôt que de produire la paire inversée que le
    // `CHECK` de `training_weeks` refuserait à la cascade.
    const debut = (draft.s1StartDate ?? '').trim();
    const nouvelle = addDays(fin, jours);
    return { s1EndDate: debut && nouvelle < debut ? debut : nouvelle };
  };

  const ajouterUnJour = () => {
    if (cycle >= CYCLE_MAX) return;
    // Le cycle quitte (ou non) les sept jours : les noms de semaine écrits s'en vont avec.
    commit({ ...draft, principles, ...decalerLaFinDeS1(1),
             daySplit: sansNomsDeSemaine([...daySplit, { day: `J${cycle + 1}`, tiers: {} }]) });
  };

  /** ⚠️ LE DERNIER JOUR EMPORTE SES ACCESSOIRES, et c'est pour ça qu'on demande.
   *  Un accessoire se rattache à son jour par son NOM (`a.day`) : laissé
   *  derrière, il ne serait plus affiché nulle part et continuerait pourtant
   *  d'être écrit — l'orphelin silencieux que ce dépôt passe son temps à
   *  nettoyer. La question dit donc ce qui part, tiers ET accessoires. */
  const retirerUnJour = async () => {
    if (cycle <= CYCLE_MIN) return;
    const dernier = daySplit[cycle - 1];
    const sesAccessoires = accessories.filter(a => a.day === dernier.day && !!a.name);
    const sesTiers = Object.keys(dernier.tiers).length;
    if (sesTiers + sesAccessoires.length > 0 && !await confirm({
      title: t("base.retirerLeJour", { jour: dernier.day }),
      description: t("base.retirerLeJour_detail", { count: sesTiers + sesAccessoires.length }),
      confirmLabel: t("base.retirer"),
    })) return;
    commit({ ...draft, principles, ...decalerLaFinDeS1(-1),
             daySplit: sansNomsDeSemaine(daySplit.slice(0, -1)),
             accessories: accessories.filter(a => a.day !== dernier.day) });
  };

  const tiersUsedForMovement = (movement: string): Set<1 | 2 | 3> => {
    const set = new Set<1 | 2 | 3>();
    for (const d of daySplit) { const t = d.tiers[movement]; if (t === 1 || t === 2 || t === 3) set.add(t); }
    return set;
  };

  const addPrinciple = (movement: string) => {
    const used = tiersUsedForMovement(movement);
    const defaultTier: 1 | 2 | 3 = ([1, 2, 3] as const).find(t => used.has(t)) ?? 1;
    commit({ ...draft, daySplit, principles: [...principles, {
      // ⚠️ `id: ''` PARCE QUE L'IDENTITÉ D'UNE LIGNE DE BASE NE DÉSIGNE RIEN : la
      // trame s'écrit en entier (`PUT /blocks/{id}/base`), jamais ligne à ligne.
      // C'est ce qui la distingue d'une ligne de séance, dont l'id sert à
      // l'adresser et qui reste donc sans id tant que le serveur n'a pas répondu.
      id: '', kind: null,
      name: movement, tier: defaultTier, variant: [], format: '', clusterMode: '', clusterRest: '', tempo: '', sets: '', reps: '', repsUnit: 'count',
      weight: '', weightLocked: false, rest: '', aimedRPE: '', assistance: '', coachNote: '', increment: '', incrementUnit: 'kg',
    }] });
  };

  const updatePrinciple = (index: number, field: keyof Principle, value: string | null | string[] | boolean) => {
    const next = principles.map((p, i) => {
      if (i !== index) return p;
      if (field === 'tier') return { ...p, tier: parseTier(Number(value)) };
      // Frontière du vocabulaire : la valeur vient du <select>, donc
      // d'INCREMENT_UNITS. C'est le SEUL endroit où une chaîne devient une unité.
      if (field === 'incrementUnit') return { ...p, incrementUnit: value as IncrementUnit };
      return { ...p, [field]: value };
    });
    commit({ ...draft, daySplit, principles: next });
  };

  /** Nature d'un principe. SÉPARÉ d'`updatePrinciple` — qui écrirait `kind: ''`
   *  en revenant à « entraînement ». La BASE est opaque côté brokkr et
   *  l'accepterait, mais `generate-from-base` recopie le champ dans la semaine,
   *  elle validée par un Literal : le 422 se déplacerait d'un cran. */
  const setPrincipleKind = (index: number, kind: ExerciseKind) => {
    const next = principles.map((p, i) => {
      if (i !== index) return p;
      const write = kindToWrite(kind);
      const next = { ...p };
      // `null` et pas l'effacement de la clé : c'est ce que le serveur renvoie
      // pour une ligne d'entraînement. Ce qui reste vrai, c'est que `''` est hors
      // du Literal et ferait tomber l'écriture.
      next.kind = write ?? null;
      return next;
    });
    commit({ ...draft, daySplit, principles: next });
  };

  const removePrinciple = async (index: number) => {
    const nom = principles[index]?.name || t("base.sansNom");
    if (!await confirm({ title: t("base.supprimerLePrincipe", { nom }) })) return;
    commit({ ...draft, daySplit, principles: principles.filter((_, i) => i !== index) });
  };

  const addSelectedPrincipal = (movement: string) => {
    if (!movement || movements.includes(movement)) return;
    commit({ ...draft, daySplit, principles, selectedPrincipaux: [...movements, movement] });
  };

  const removeSelectedPrincipal = async (movement: string) => {
    // ⚠️ CE « × » EN EMPORTE PLUS QUE LUI-MÊME, et c'est invisible à l'écran : il
    // retire aussi les LIGNES de principe qui portent ce mouvement, et son rang
    // dans la répartition des jours. La question doit donc dire ce qui part —
    // sinon on confirme une case décochée et on perd une prescription.
    const lignes = principles.filter(p => p.name === movement).length;
    if (!await confirm({
      title: t("base.retirerDesPrincipaux", { mouvement: movement }),
      description: lignes
        ? t("base.retirerDesPrincipaux_detail", { count: lignes })
        : t("base.rangDuJourPartAvec"),
      confirmLabel: t("base.retirer"),
    })) return;

    const cleanedSplit = daySplit.map(d => {
      if (!(movement in d.tiers)) return d;
      const tiers = { ...d.tiers }; delete tiers[movement]; return { ...d, tiers };
    });
    commit({
      ...draft, daySplit: cleanedSplit,
      principles: principles.filter(p => p.name !== movement),
      selectedPrincipaux: movements.filter(m => m !== movement),
    });
  };

  /** ⚠️ LA LIGNE NEUVE ARRIVE EN BAS, LÀ OÙ ON VIENT DE CLIQUER (William,
   *  20/09). La liste est rangée par jour : née sur J1, elle remontait en tête,
   *  loin du bouton « Ajouter » et de la ligne qu'on vient de finir. Elle prend
   *  donc le jour de la DERNIÈRE ligne — on enchaîne là où on travaillait — et
   *  le premier jour du cycle s'il n'y en a aucune. Ce n'est qu'un point de
   *  départ : le jour se change sur la ligne.
   *
   *  ⚠️ ET SURTOUT PLUS « Lundi » : depuis le 20/09 ce n'est plus un jour de la
   *  grille. Une ligne née sur « Lundi » ne se serait rattachée à aucun J#, donc
   *  ne serait jamais sortie dans une séance — l'orphelin silencieux. */
  /** ⚠️ L'ACCESSOIRE SE COMPOSE DANS UN BROUILLON, EN TÊTE DE SECTION (William,
   *  30/09). Ajouté directement, il partait tout en bas de la liste — derrière le
   *  dernier jour — et changer son jour le faisait sauter sous le doigt. Ici on
   *  choisit jour, mouvement, variante… sur une ligne qui ne bouge pas, en or ;
   *  validée, elle rejoint la FIN DE SON JOUR (la liste est triée par jour, et
   *  elle y entre en dernier). Tant qu'elle n'est pas validée, rien n'est écrit :
   *  ni dans la trame, ni chez brokkr. */
  const [brouillonAcc, setBrouillonAcc] = useState<BaseAccessory | null>(null);
  /** Le jour du dernier accessoire validé : on en ajoute souvent plusieurs au même. */
  const [dernierJourAcc, setDernierJourAcc] = useState<string | null>(null);
  const addAccessory = () => setBrouillonAcc((deja) => deja ?? {
    // Voir `addPrinciple` pour `id: ''`. `groupId` vide = pas de groupe (FRE-31),
    // donc pas de nature : elle se pose au liage, jamais avant (FRE-36).
    id: '', kind: null, groupId: '', groupKind: null, unbroken: false,
    day: (dernierJourAcc && joursDuCycle(cycle).includes(dernierJourAcc) ? dernierJourAcc : null) ?? joursDuCycle(cycle)[0],
    name: '', variant: [], format: '', clusterMode: '', clusterRest: '', tempo: '', sets: '', reps: '', repsUnit: 'count',
    weight: '', weightLocked: false, rest: '', aimedRPE: '', assistance: '', coachNote: '', increment: '', incrementUnit: 'kg',
  });
  const validerLAccessoire = () => {
    if (!brouillonAcc || !(brouillonAcc.name ?? '').trim()) return;
    commit({ ...draft, daySplit, principles, accessories: [...accessories, brouillonAcc] });
    setDernierJourAcc(brouillonAcc.day);
    setBrouillonAcc(null);
  };

  const updateAccessory = (index: number, field: keyof BaseAccessory, value: string | null | string[] | boolean) => {
    // ⚠️ CE QUI SE PROPAGE DÉPEND DE LA NATURE (FRE-149), la même règle que la
    // semaine (`champsDeGroupe`) : séries et repos décrivent le tour, et sur un
    // DROPSET le nom décrit le groupe — un dropset n'a qu'un exercice. Le serveur
    // le fait aussi (`normaliser_groupes`) ; ici c'est pour que le brouillon dise
    // ce qui sera écrit.
    const gid = (accessories[index]?.groupId || '').trim();
    const nature: NatureDeGroupe = accessories[index] ? natureDe(accessories[index]) : 'biset';
    const duGroupe = gid && champsDeGroupe(nature).has(field)
      && accessories.filter(x => (x.groupId || '').trim() === gid).length > 1;
    const next = accessories.map((a, i) => {
      if (duGroupe ? (a.groupId || '').trim() !== gid : i !== index) return a;
      if (field === 'incrementUnit') return { ...a, incrementUnit: value as IncrementUnit };
      return { ...a, [field]: value };
    });
    commit({ ...draft, daySplit, principles, accessories: next });
  };

  /** Nature d'un accessoire — voir `setPrincipleKind` pour le pourquoi. */
  const setAccessoryKind = (index: number, kind: ExerciseKind) => {
    const next = accessories.map((a, i) => {
      if (i !== index) return a;
      const write = kindToWrite(kind);
      const next = { ...a };
      // Voir `setPrincipleKind` : `null`, jamais l'absence ni `''`.
      next.kind = write ?? null;
      return next;
    });
    commit({ ...draft, daySplit, principles, accessories: next });
  };

  /** Vide les groupes devenus SEULS. Même invariant que dans la semaine : « pas
   *  de groupe à un membre », et non « on interdit la suppression ». Sans ça, un
   *  accessoire retiré laisse à son partenaire un lien qui ne relie rien — et la
   *  génération le reproduirait dans CHAQUE semaine produite. */
  const sansGroupesSeuls = (liste: BaseAccessory[]): BaseAccessory[] => {
    const compte = new Map<string, number>();
    for (const a of liste) {
      const g = (a.groupId || '').trim();
      if (g) compte.set(g, (compte.get(g) ?? 0) + 1);
    }
    return liste.map(a => {
      const g = (a.groupId || '').trim();
      return g && compte.get(g) === 1 ? { ...a, groupId: '' } : a;
    });
  };

  const removeAccessory = async (index: number) => {
    const a = accessories[index];
    const nom = a?.name || t("base.sansNom");
    // Un accessoire lié à un autre (bi-set) délie son partenaire en partant : le
    // dire, sinon le groupe se défait sans qu'on ait demandé à le défaire.
    const enGroupe = !!(a?.groupId || '').trim();
    if (!await confirm({
      title: t("base.supprimerLAccessoire", { nom }),
      description: enGroupe ? t("base.biSetSeraDelie") : undefined,
    })) return;
    commit({
      ...draft, daySplit, principles,
      accessories: sansGroupesSeuls(accessories.filter((_, i) => i !== index)),
    });
  };

  /** Lie un accessoire au SUIVANT du même jour, ou délie le groupe existant.
   *
   *  ⚠️ Réservé aux ACCESSOIRES — il n'y a délibérément pas d'équivalent sur les
   *  principes. Un bi-set ne concerne que du renforcement (vérifié : aucun des
   *  84 groupes existants ne porte de ligne à tier), et les principes sont de
   *  toute façon retriés par mouvement puis par tier à la génération, ce qui
   *  séparerait deux lignes liées. */
  const toggleAccessoryGroup = (index: number) => {
    const a = accessories[index];
    if (!a) return;
    const actuel = (a.groupId || '').trim();

    // ⚠️ ÉTENDRE UN GROUPE (FRE-116) : sous sa DERNIÈRE ligne, le lien rattache
    // l'accessoire suivant du même jour, avec la nature du groupe. Sous la
    // première, il le défait, comme avant.
    const rang = sortedAccessoryRows.findIndex(r => r.i === index);
    const avant = sortedAccessoryRows[rang - 1]?.a;
    const apres = sortedAccessoryRows[rang + 1];
    if (actuel && (avant?.groupId || '').trim() === actuel
        && apres && apres.a.day === a.day && !(apres.a.groupId || '').trim()) {
      const nature = natureDe(a);
      commit({ ...draft, daySplit, principles,
        accessories: accessories.map((x, i) => i !== apres.i ? x
          : { ...x, groupId: actuel, groupKind: nature,
              ...(estChronometre(nature) ? { format: null, clusterRest: null, clusterMode: a.clusterMode ?? null } : {}) }) });
      return;
    }
    if (actuel) {
      // La nature part avec le groupe : une ligne seule n'est ni bi-set ni
      // dropset. (Le serveur le fait aussi, `normaliser_groupes` ; ici c'est
      // pour que le brouillon dise la même chose que ce qui sera écrit.)
      commit({ ...draft, daySplit, principles,
        accessories: accessories.map(x => (x.groupId || '').trim() === actuel
          ? { ...x, groupId: '', groupKind: null } : x) });
      return;
    }
    // Voisin d'affichage du MÊME jour : c'est l'ordre affiché qui fait foi, et
    // c'est lui que la génération respectera.
    const pos = sortedAccessoryRows.findIndex(r => r.i === index);
    const suivant = sortedAccessoryRows[pos + 1];
    if (!suivant || suivant.a.day !== a.day || (suivant.a.groupId || '').trim()) return;

    const gid = `g${Date.now()}`;
    // ⚠️ LA NATURE SE POSE AVEC L'IDENTIFIANT, PAS APRÈS (FRE-145). Ce geste
    // n'écrivait que `groupId` : la BASE fabriquait donc des groupes à
    // `group_kind` NULL, que la lecture rattrape en « bi-set » sans jamais le
    // corriger en base. Onze en production, tous postérieurs à la reprise du
    // 29/08 — c'est ce chemin-ci qui les créait, et lui seul.
    //
    // `biset` par défaut : la nature se choisit ENSUITE, sur l'en-tête du groupe
    // (`basculerNatureDuGroupe`, FRE-149) — c'est en écrivant les lignes qu'on
    // voit si c'est un enchaînement ou une descente.
    //
    // ⚠️ ET LE SERVEUR LE FAIT AUSSI, DÉLIBÉRÉMENT (`normaliser_groupes`) : une
    // règle qui ne tient qu'au client ne vaut que pour le client qui l'applique.
    // Mesuré par mutation : retirer CETTE ligne seule ne fait rougir personne,
    // le filet serveur rattrape ; retirer les deux fait rougir
    // `e2e-reel/bi-set-dans-la-base`, qui lit la colonne. On la garde parce
    // qu'elle rend le payload honnête — ce qu'on envoie dit ce qu'il est, au
    // lieu de compter sur qui le reçoit.
    commit({ ...draft, daySplit, principles,
      accessories: accessories.map((x, i) => i === index || i === suivant.i
        ? { ...x, groupId: gid, groupKind: 'biset' } : x) });
  };

  /** Bi-set ↔ dropset, sur un groupe EXISTANT — le geste de la semaine (FRE-36),
   *  à l'identique (FRE-149). Zéro dropset sur quinze groupes de BASE en
   *  production le 08/09 : le coach ne pouvait pas le dire dans sa trame.
   *
   *  ⚠️ UNE BASCULE PLUTÔT QUE DEUX BOUTONS DE CRÉATION : la nature se choisit en
   *  écrivant les lignes, et reste réversible.
   *
   *  ⚠️ VERS LE DROPSET, LE PREMIER NOM GAGNE — dans l'ordre du tableau, celui
   *  que suit `normaliser_groupes` à l'écriture. Le serveur l'imposerait de toute
   *  façon ; le faire ici évite un brouillon qui montre un second mouvement que
   *  l'enregistrement effacerait. */
  const choisirNatureDuGroupe = (index: number, suivante: NatureDeGroupe) => {
    const gid = (accessories[index]?.groupId || '').trim();
    if (!gid) return;
    const membres = accessories.filter(x => (x.groupId || '').trim() === gid);
    const nom = membres.map(x => x.name).find(n => (n || '').trim());
    const temps = membres.map(x => x.clusterMode).find(v => (v || '').trim());
    commit({ ...draft, daySplit, principles,
      accessories: accessories.map(x => (x.groupId || '').trim() !== gid ? x
        : { ...x, groupKind: suivante, ...(suivante === 'dropset' && nom ? { name: nom } : {}),
            // Un groupe chronométré n'a plus de format de ligne, et son temps est
            // celui de la PREMIÈRE ligne qui en porte un (FRE-116) — ce que
            // `normaliser_groupes` écrira de toute façon.
            ...(estChronometre(suivante) ? { format: null, clusterRest: null, clusterMode: temps ?? null } : {}) }) });
  };

  /** La règle vit dans `program-selection.ts`, contre la cascade qui en dépend. */
  const setS1Date = (field: 's1StartDate' | 's1EndDate', value: string | null) =>
    commit({ ...draft, daySplit, principles, ...datesDeS1(draft, field, value ?? '') });

  const setGranularity = (movement: string, value: string | null) => {
    const next = { ...(draft.granularity || {}) };
    if ((value ?? '').trim() === '') delete next[movement]; else next[movement] = value!.trim();
    commit({ ...draft, daySplit, principles, granularity: next });
  };

  // DnD réordonnancement des chips principaux + des accessoires (au sein d'un même jour).
  // Afficher/masquer l'historique des mouvements dans la BASE (persisté).
  const [showHistory, setShowHistory] = useLocalStorageState('ff-base-show-history', true);
  const [dragChip, setDragChip] = useState<number | null>(null);
  const reorderPrincipaux = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= movements.length || to >= movements.length) return;
    const next = [...movements]; const [m] = next.splice(from, 1); next.splice(to, 0, m);
    commit({ ...draft, daySplit, principles, selectedPrincipaux: next });
  };
  const [dragAcc, setDragAcc] = useState<number | null>(null);
  const reorderAccessory = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= accessories.length || to >= accessories.length) return;
    if (accessories[from].day !== accessories[to].day) return; // réordonne au sein d'un même jour
    const next = [...accessories]; const [m] = next.splice(from, 1); next.splice(to, 0, m);
    commit({ ...draft, daySplit, principles, accessories: next });
  };
  // Réordonne les principes À L'INTÉRIEUR d'un même mouvement (plusieurs tier 1/2/3
  // possibles). Opère sur le tableau `principles` (index bruts).
  const reorderPrinciple = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= principles.length || to >= principles.length) return;
    if (principles[from].name !== principles[to].name) return; // même mouvement uniquement
    const next = [...principles]; const [p] = next.splice(from, 1); next.splice(to, 0, p);
    commit({ ...draft, daySplit, principles: next });
  };
  // Affichage trié par jour de cycle (J1 → Jn), index original conservé pour
  // les callbacks (update/remove/reorder opèrent sur le tableau `accessories`).
  const sortedAccessoryRows = accessories
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (rangDeCycle(x.a.day) - rangDeCycle(y.a.day)) || (x.i - y.i));

  const hasAnyTier = daySplit.some(d => Object.keys(d.tiers).length > 0);
  const hasContentToGenerate = (hasAnyTier && principles.length > 0) || accessories.some(a => !!a.name);

  /** ⚠️ LA TRAME DOIT PORTER SA DATE DE DÉBUT POUR ÊTRE GÉNÉRÉE (FRE-138), et
   *  c'est brokkr qui tranche — il répond `base_sans_dates` en 409. Ici on ne
   *  fait que ne pas PROPOSER le geste : la règle d'affordance du projet veut que
   *  le front n'offre une écriture que là où le serveur l'accepte.
   *
   *  Pourquoi cette exigence existe : la date de S1 est la seule origine des
   *  dates de semaine, et le suivi projette sur `coalesce(session_date,
   *  week.start_date)`. Une trame sans date produit des semaines sans date, donc
   *  du réalisé qui n'entre dans aucune courbe — 3 687 lignes en production, dont
   *  97 % dans un bloc sans S1.
   *
   *  ⚠️ LES DEUX DATES, ET LA FIN N'EST PAS UN DOUBLON DU DÉBUT (décision
   *  William, 09/09). C'est elle qui donne la LONGUEUR appliquée à toutes les
   *  semaines du bloc, juste en dessous dans `blockWeekDates` : sans elle, le
   *  repli « début + 6 jours » impose sept jours à tout le bloc sans que personne
   *  l'ait demandé — et dix semaines de production n'en font pas sept. Le repli
   *  n'est pas faux, il est MUET, et il décide à la place du coach. */
  const aSesDates = !!(draft.s1StartDate ?? '').trim() && !!(draft.s1EndDate ?? '').trim();

  /** POURQUOI « Générer » est fermé — `null` quand il est ouvert.
   *
   *  ⚠️ CETTE RAISON S'AFFICHE, ELLE NE SE SURVOLE PLUS. Elle vivait dans un
   *  `title`, c'est-à-dire nulle part : signalé par William le 09/09 devant une
   *  trame sans dates — « le bouton est grisé et rien ne dit pourquoi ». Un bouton
   *  fermé sans motif visible est la version silencieuse de la consigne
   *  impossible que FRE-93 avait déjà corrigée sur le panneau vide.
   *
   *  L'ORDRE DES CAS EST CELUI DU BLOCAGE, pas celui de l'importance : le premier
   *  qui s'applique gagne, et il est le seul montré. Deux motifs affichés
   *  ensemble laisseraient le coach corriger le mauvais. */
  // Sans réseau, rien à générer : la semaine se calcule côté brokkr. La trame,
  // elle, se garde et repart — c'est le geste qui manquait à Aubin (25/09).
  const enLigne = useEnLigne();
  const raisonDeNePasGenerer =
    !enLigne ? t("training.disponibleAuRetourDuReseau")
    : !canGenerate ? t("misc.week1HasSessions")
    : !hasContentToGenerate ? t("base.configureAuMoinsUn")
    : !aSesDates ? t("base.poseLaDateDeS1")
    : null;
  // Les jours du cycle qui portent au moins un tier — les autres sont du repos.
  const configuredDays = daySplit.filter(d => Object.keys(d.tiers).length > 0).length;
  const abreges = useMemo(() => abregerMouvements(movements), [movements]);
  const previewSessionCount = previewWeek?.sessions?.length ?? 0;

  return (
    <div className="flex flex-col gap-4" onKeyDown={naviguerAuClavier}>
      <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-[0_18px_46px_rgba(0,0,0,0.18)]">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border/60 px-4 py-4">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded-md border border-gold/35 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold">
                BASE
              </span>
              <span className="truncate text-xs text-muted-foreground">{t("base.trameDuBloc")}</span>
            </div>
            <h2 className="truncate text-xl font-semibold tracking-tight">{blockLabel}</h2>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <SummaryPill icon={<Dumbbell className="h-3.5 w-3.5" />} label={t("base.mouvements")} value={movements.length} />
            <SummaryPill icon={<CalendarDays className="h-3.5 w-3.5" />} label={t("base.jours")} value={configuredDays} />
            <SummaryPill icon={<ListChecks className="h-3.5 w-3.5" />} label={t("base.principes")} value={principles.length} />
            <SummaryPill icon={<Sparkles className="h-3.5 w-3.5" />} label={t("base.seances")} value={previewSessionCount} />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="max-w-2xl text-xs text-muted-foreground">
            {t("base.construisLaSemaineType")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <DateField label={t("base.debutS1")} value={draft.s1StartDate ?? ''} onChange={v => setS1Date('s1StartDate', v)} />
            <DateField label={t("common.fin")} value={draft.s1EndDate ?? ''}
                       min={draft.s1StartDate ?? undefined}
                       onChange={v => setS1Date('s1EndDate', v)} />
          </div>
        </div>
        {!base && previousBase && (
          <div className="border-t border-border/60 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gold/20 bg-gold/5 px-3 py-2">
              <p className="text-xs text-muted-foreground">
                {t("base.pasEncoreDeBase")}
              </p>
              <button
                type="button"
                onClick={() => commit(cloneBase(previousBase))}
                className="rounded-md bg-gold px-3 py-1.5 text-xs font-medium text-gold-foreground hover:bg-gold/90"
              >
                {t("base.reprendreLaBasePrecedente")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Répartition du cycle */}
      <SectionShell
        icon={<RotateCw className="h-3.5 w-3.5" />}
        title={t("base.repartitionDuCycle")}
        meta={`${t("base.nJours", { count: cycle })} · ${t("base.nDEntrainement", { count: configuredDays })} · ${t("base.nDeRepos", { count: cycle - configuredDays })}`}
        tone="blue"
        action={
          <div className="flex items-center gap-2">
            <span className="hidden font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:inline">
              {t("base.dureeDuCycle")}
            </span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => void retirerUnJour()} disabled={cycle <= CYCLE_MIN}
                      aria-label={t("base.retirerUnJour")}
                      className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-background text-foreground transition-colors hover:bg-accent/40 disabled:opacity-40">
                <Minus className="h-4 w-4" />
              </button>
              <span className="min-w-[4.5rem] text-center text-sm font-semibold tabular-nums">
                {t("base.nJours", { count: cycle })}
              </span>
              <button type="button" onClick={ajouterUnJour} disabled={cycle >= CYCLE_MAX}
                      aria-label={t("base.ajouterUnJour")}
                      className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-background text-foreground transition-colors hover:bg-accent/40 disabled:opacity-40">
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        }
      >
        {/* Picker principaux */}
        <div className="flex flex-wrap items-center gap-1.5">
          {movements.map((m, idx) => (
            <span
              key={m}
              draggable
              onDragStart={() => setDragChip(idx)}
              onDragOver={e => { if (dragChip !== null) e.preventDefault(); }}
              onDrop={() => { if (dragChip !== null && dragChip !== idx) reorderPrincipaux(dragChip, idx); setDragChip(null); }}
              className={cn('flex cursor-grab items-center gap-1 rounded-full border border-border/80 bg-background/60 px-2 py-0.5 text-[11px] font-medium text-foreground/85', dragChip === idx && 'opacity-40')}
            >
              {m}
              <button type="button" onClick={() => void removeSelectedPrincipal(m)} className="text-muted-foreground hover:text-destructive">×</button>
            </span>
          ))}
          {addablePrincipaux.length > 0 && (
            <select value="" onChange={e => addSelectedPrincipal(e.target.value)}
              className="h-7 rounded-md border border-dashed border-border bg-background px-2 text-[11px] text-muted-foreground outline-none focus:border-gold">
              <option value="">{t("misc.addPrincipal")}</option>
              {addablePrincipaux.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
        </div>
        {/* La grille du cycle : Jn × mouvements. ⚠️ `table-fixed` et pas de
            défilement horizontal — à 390 px, quatre colonnes doivent tenir. */}
        <div className="rounded-lg border border-border">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="w-[4.5rem] px-2 py-2 text-left font-medium sm:w-24 sm:px-3">{t("base.jour")}</th>
                {movements.map(m => (
                  <th key={m} className="px-1 py-2 text-center font-medium sm:px-2">
                    {/* Le nom entier dès qu'il y a la place ; sinon l'abrégé, qui
                        reste unique dans la liste (`abregerMouvements`). */}
                    <span className="sm:hidden" title={m}>{abreges[m]}</span>
                    <span className="hidden truncate sm:inline">{m}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {daySplit.map(d => {
                const repos = Object.keys(d.tiers).length === 0;
                return (
                <tr key={d.day} className="hover:bg-accent/20">
                  {/* ⚠️ LA COULEUR DU JOUR EST SUR LE LISERÉ ET SUR SON NOM, pas
                      dans les cases : celles-ci portent déjà celle du TIER, et
                      deux langages de couleur dans la même grille se lisent l'un
                      pour l'autre. */}
                  <td className="px-2 py-1.5 sm:px-3"
                      style={{ boxShadow: `inset 3px 0 0 ${couleurDuJour(d.day)}` }}>
                    <span className="block text-sm font-semibold leading-tight"
                          style={{ color: couleurDuJour(d.day) }}>{d.day}</span>
                    {/* ⚠️ LE NOM EST SOUS SON JOUR, JAMAIS À SA PLACE (FRE-187).
                        `J1` reste affiché : c'est lui qui relie la ligne aux
                        accessoires datés du même jour, juste en dessous, et le
                        masquer rendrait ce lien illisible. */}
                    <input
                      value={d.label ?? ''}
                      onChange={e => setLabel(d.day, e.target.value)}
                      // Sur sept jours, le nom par défaut est celui de la semaine : il
                      // s'affiche sans avoir été saisi, et la séance générée le portera.
                      placeholder={nomDuJour({ day: d.day }, cycle) === d.day ? t("base.nomDuJour") : nomDuJour({ day: d.day }, cycle)}
                      aria-label={t("base.nomDuJour") + ' ' + d.day}
                      className={cn("mt-0.5 w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] leading-tight text-foreground hover:border-border focus:border-border focus:outline-none",
                        nomDuJour({ day: d.day }, cycle) === d.day ? "placeholder:text-muted-foreground/50" : "placeholder:text-foreground/80")}
                    />
                    {/* ⚠️ « REPOS » SE DÉDUIT, IL NE SE SAISIT PAS : une ligne sans
                        tier EST un jour de repos, et un interrupteur de plus
                        aurait créé un second état à tenir d'accord avec celui-ci. */}
                    {repos && <span className="block text-[10px] leading-tight text-muted-foreground">{t("base.repos")}</span>}
                  </td>
                  {movements.map(m => {
                    const selectedTier = d.tiers[m];
                    const tone = tierTone(selectedTier);
                    return (
                      <td key={m} className="px-1 py-1.5 text-center sm:px-2">
                        {/* Un vrai bouton : le clavier (Entrée / Espace) le fait
                            tourner comme le doigt, sans une ligne de plus. */}
                        <button
                          type="button"
                          onClick={() => setTier(d.day, m, tierSuivant(selectedTier))}
                          aria-label={t("base.caseDuCycle", {
                            jour: d.day, mouvement: m,
                            tier: selectedTier ? t(`base.tier${selectedTier}`) : t("base.tierAucun"),
                          })}
                          className={cn(
                            'mx-auto flex h-11 w-full max-w-[3.25rem] items-center justify-center rounded-lg border text-sm font-semibold transition-colors',
                            tone ? [tone.border, tone.bg, tone.text]
                                 : 'border-dashed border-border/70 text-muted-foreground/70 hover:border-border hover:text-foreground',
                            selectedTier === 3 && 'border-dashed',
                          )}
                        >
                          {selectedTier ?? '–'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
              })}
            </tbody>
            {/* ⚠️ CE QUE LA GRILLE NE MONTRE PAS SANS ELLE : un principal placé
                NULLE PART. Il a ses lignes de principe, il ne sort dans aucune
                séance, et rien à l'écran ne le disait. */}
            <tfoot className="border-t border-border bg-muted/20">
              <tr>
                <td className="px-2 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:px-3">
                  {t("base.surLeCycle")}
                </td>
                {movements.map(m => {
                  const par = [1, 2, 3].map(tier => ({
                    tier, n: daySplit.filter(d => d.tiers[m] === tier).length,
                  })).filter(x => x.n > 0);
                  return (
                    <td key={m} className="px-1 py-2 sm:px-2">
                      <div className="flex flex-wrap items-center justify-center gap-1">
                        {par.length === 0
                          ? <span className="text-[10px] text-muted-foreground">{t("base.jamais")}</span>
                          : par.map(({ tier, n }) => {
                            const tone = TIER_TONES[tier as 1 | 2 | 3];
                            return (
                              <span key={tier}
                                    aria-label={t("base.foisEnTier", { count: n, tier: t(`base.tier${tier}`) })}
                                    className={cn('rounded-full border px-1.5 text-[10px] font-medium tabular-nums', tone.border, tone.text)}>
                                {n}×
                              </span>
                            );
                          })}
                      </div>
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">{t("base.leCycleRepart", { dernier: `J${cycle}` })}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
          {([1, 2, 3] as const).map(tier => (
            <span key={tier} className="flex items-center gap-1.5">
              <span className={cn('flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold',
                                  TIER_TONES[tier].border, TIER_TONES[tier].text, tier === 3 && 'border-dashed')}>
                {tier}
              </span>
              {t(`base.tier${tier}`)}
            </span>
          ))}
          <span>{t("base.toucheUneCase")}</span>
        </div>
        {/* Granularité (pas d'arrondi des incréments, en kg) par mouvement */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/50 p-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t("base.granulariteKg")}</span>
          {movements.map(m => (
            <label key={m} className="flex items-center gap-1.5 rounded-md border border-border/70 bg-background/45 px-2 py-1 text-[11px] text-muted-foreground">
              {m.slice(0, 6)}
              <input
                value={draft.granularity?.[m] ?? ''}
                onChange={e => setGranularity(m, e.target.value)}
                placeholder={m.toUpperCase() === 'SQUAT' ? '2.5' : '1.25'}
                className="h-6 w-14 rounded-md border border-border bg-background px-1 text-center font-mono text-xs text-foreground outline-none focus:border-gold"
              />
            </label>
          ))}
        </div>
      </SectionShell>

      {/* Principes par mouvement */}
      <SectionShell
        icon={<ListChecks className="h-3.5 w-3.5" />}
        title={t("base.principes")}
        meta={t("base.reglesCount", { count: principles.length })}
        tone="gold"
        action={
          <button type="button" onClick={() => setShowHistory(v => !v)}
            title={showHistory ? t("misc.hideHistory") : t("misc.showHistory")}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground">
            {showHistory ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {t('base.historique')}
          </button>
        }
      >
        {/* ⚠️ L'ÉTAT VIDE MANQUAIT (FRE-106). `movements.map` sur une sélection
            vide ne rend RIEN : la section s'affichait réduite à son titre et son
            compteur à zéro, sans un mot pour dire quoi faire. Ce n'était pas une
            impasse — le sélecteur en pointillés existe — mais il est DEUX
            sections plus haut, et rien n'y renvoyait.

            La condition porte sur `movements`, pas sur `principles` : un
            principe ne peut exister que sous un mouvement sélectionné, donc
            c'est bien l'absence de mouvement qu'il faut nommer. */}
        {movements.length === 0 && (
          <p className="text-[11px] italic text-muted-foreground">{t("base.aucunMouvementSelectionne")}</p>
        )}
        {movements.map(movement => {
          const rows = principles.map((p, i) => ({ p, i })).filter(({ p }) => p.name === movement);
          const usedTiers = tiersUsedForMovement(movement);
          return (
            <div key={movement} className="overflow-hidden rounded-xl border border-border/80 bg-background/35 transition-colors">
              <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/15 px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/50" aria-hidden />
                    <span className="truncate text-sm font-semibold text-foreground">{movement}</span>
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {t('base.principesCount', { count: rows.length })}
                  </div>
                </div>
                <button type="button" onClick={() => addPrinciple(movement)}
                  className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground">
                  <Plus className="h-3 w-3" /> {t('base.principe')}
                </button>
              </div>
              {showHistory && <MovementHistory movement={movement} pastBlocks={pastBlocks} rendu={progression.rendu} onChoisirRendu={progression.choisir} />}
              {rows.length === 0 ? (
                <p className="px-3 py-3 text-[11px] italic text-muted-foreground">{t("base.aucunPrincipeAjouteEn")}</p>
              ) : (
                <div className="flex flex-col gap-2 p-3">
                  {rows.map(({ p, i }, rpos) => {
                    // Voisins dans le MÊME mouvement (rows est déjà filtré) → flèches ▲▼.
                    const upIdx = rpos > 0 ? rows[rpos - 1].i : null;
                    const downIdx = rpos < rows.length - 1 ? rows[rpos + 1].i : null;
                    return (
                      <div key={i} className="flex items-start gap-1">
                        <div className="mt-0.5 flex shrink-0 flex-col">
                          <button type="button" title={t("base.monterDansCeMouvement")} disabled={upIdx === null}
                            onClick={() => upIdx !== null && reorderPrinciple(i, upIdx)}
                            className="flex h-4 w-5 items-center justify-center rounded text-muted-foreground hover:text-gold disabled:opacity-20 disabled:hover:text-muted-foreground">
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" title={t("base.descendreDansCeMouvement")} disabled={downIdx === null}
                            onClick={() => downIdx !== null && reorderPrinciple(i, downIdx)}
                            className="flex h-4 w-5 items-center justify-center rounded text-muted-foreground hover:text-gold disabled:opacity-20 disabled:hover:text-muted-foreground">
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="min-w-0 flex-1">
                          <PrincipleRow
                            p={p} lib={lib} usedTiers={usedTiers}
                            onUpdate={(f, v) => updatePrinciple(i, f, v)} onSetKind={k => setPrincipleKind(i, k)}
                            onRemove={() => void removePrinciple(i)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </SectionShell>

      {/* Renforcement (accessoires) */}
      <SectionShell
        icon={<Settings2 className="h-3.5 w-3.5" />}
        title={t("library.accessory")}
        meta={t("base.accessoiresCount", { count: accessories.length })}
        tone="green"
        action={
          <button type="button" onClick={addAccessory}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground">
            <Plus className="h-3 w-3" /> {t('base.accessoire')}
          </button>
        }
      >
        {brouillonAcc && (
          <div data-accessoire-brouillon
               className="mb-3 rounded-lg border border-gold bg-gold/10 p-2 shadow-[0_0_0_3px_color-mix(in_oklab,var(--gold)_18%,transparent)]">
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 px-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gold">{t('base.nouvelAccessoire')}</span>
              <span className="text-[11px] text-muted-foreground">{t('base.nouvelAccessoireAide', { jour: libelleDuJour(brouillonAcc.day) })}</span>
            </div>
            <AccessoryRow a={brouillonAcc} lib={lib} jours={joursDuCycle(cycle)} libelleDuJour={libelleDuJour} sortedRenforcement={sortedRenforcement}
              ouvreLeGroupe={false} suiteDuGroupe={false} tailleDuGroupe={0} onSetGroupKind={() => {}}
              onUpdate={(f, v) => setBrouillonAcc(b => b && ({ ...b, [f]: v }))}
              onSetKind={k => setBrouillonAcc(b => b && ({ ...b, kind: kindToWrite(k) ?? null }))}
              onRemove={() => setBrouillonAcc(null)} />
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={() => setBrouillonAcc(null)}
                className="rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground">
                {t('base.annulerLAccessoire')}
              </button>
              <button type="button" onClick={validerLAccessoire} disabled={!(brouillonAcc.name ?? '').trim()}
                className="rounded-md border border-gold bg-gold px-2.5 py-1 text-[11px] font-semibold text-gold-foreground hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
                {t('base.ajouterAuJour', { jour: libelleDuJour(brouillonAcc.day) })}
              </button>
            </div>
          </div>
        )}
        {accessories.length === 0 ? (
          brouillonAcc ? null : <p className="text-[11px] italic text-muted-foreground">{t("base.aucunRenforcement")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {sortedAccessoryRows.map(({ a, i }, pos) => {
              const prevDay = pos > 0 ? sortedAccessoryRows[pos - 1].a.day : null;
              const showDayHeader = a.day !== prevDay;
              // Voisins du MÊME jour dans l'affichage trié → cible des flèches ▲▼.
              const upIdx = pos > 0 && sortedAccessoryRows[pos - 1].a.day === a.day ? sortedAccessoryRows[pos - 1].i : null;
              const downIdx = pos < sortedAccessoryRows.length - 1 && sortedAccessoryRows[pos + 1].a.day === a.day ? sortedAccessoryRows[pos + 1].i : null;
              // Bi-set : séries et repos décrivent le TOUR, donc une seule saisie
              // pour le groupe, portée par sa première ligne (FRE-31).
              const gid = (a.groupId || '').trim();
              const membres = gid ? accessories.filter(x => (x.groupId || '').trim() === gid).length : 0;
              const enGroupe = membres > 1;
              const precedent = pos > 0 ? sortedAccessoryRows[pos - 1].a : undefined;
              const estSuiteDeGroupe = enGroupe && (precedent?.groupId || '').trim() === gid;
              const estOuvertureDeGroupe = enGroupe && !estSuiteDeGroupe;
              const suivant = sortedAccessoryRows[pos + 1]?.a;
              const peutLierAuSuivant = !gid && !!suivant && suivant.day === a.day && !(suivant.groupId || '').trim();
              // Sous la dernière ligne d'un groupe : rattacher la suivante (FRE-116).
              const peutEtendre = estSuiteDeGroupe && !!suivant && suivant.day === a.day && !(suivant.groupId || '').trim();
              // Entre deux lignes du même groupe : « sans lâcher » (FRE-116).
              const lienInterne = enGroupe && !!suivant && (suivant.groupId || '').trim() === gid && natureDe(a) !== 'dropset';
              return (
                <div key={i}>
                  {showDayHeader && (
                    <div className="mb-1 mt-2 px-1 text-[10px] font-semibold uppercase tracking-wider first:mt-0"
                         style={{ color: couleurDuJour(a.day) }}>
                      {a.day ? libelleDuJour(a.day) : t("misc.noDay")}
                    </div>
                  )}
                  <div
                    draggable
                    onDragStart={() => setDragAcc(i)}
                    onDragOver={e => { if (dragAcc !== null) e.preventDefault(); }}
                    onDrop={() => { if (dragAcc !== null && dragAcc !== i) reorderAccessory(dragAcc, i); setDragAcc(null); }}
                    className={cn('flex items-start gap-1', dragAcc === i && 'opacity-40')}
                  >
                    <div className="mt-0.5 flex shrink-0 flex-col">
                      <button type="button" title={t("base.monterDansLeJour")} disabled={upIdx === null}
                        onClick={() => upIdx !== null && reorderAccessory(i, upIdx)}
                        className="flex h-4 w-5 items-center justify-center rounded text-muted-foreground hover:text-gold disabled:opacity-20 disabled:hover:text-muted-foreground">
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" title={t("base.descendreDansLeJour")} disabled={downIdx === null}
                        onClick={() => downIdx !== null && reorderAccessory(i, downIdx)}
                        className="flex h-4 w-5 items-center justify-center rounded text-muted-foreground hover:text-gold disabled:opacity-20 disabled:hover:text-muted-foreground">
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>

                    </div>
                    <div className="min-w-0 flex-1">
                      <AccessoryRow a={a} lib={lib} jours={joursDuCycle(cycle)} libelleDuJour={libelleDuJour} sortedRenforcement={sortedRenforcement}
                        ouvreLeGroupe={estOuvertureDeGroupe}
                        suiteDuGroupe={estSuiteDeGroupe}
                        tailleDuGroupe={membres}
                        onSetGroupKind={(nature) => choisirNatureDuGroupe(i, nature)}
                        onUpdate={(f, v) => updateAccessory(i, f, v)} onSetKind={k => setAccessoryKind(i, k)}
                        onRemove={() => void removeAccessory(i)} />

                      {/* Le geste de liaison se lit ENTRE les deux lignes qu'il
                          relie. Première version : une icône de 12 px à 40 %
                          d'opacité, coincée sous les chevrons — introuvable.
                          Un bouton n'existe que si on le voit. */}
                      {(peutLierAuSuivant || peutEtendre || estOuvertureDeGroupe || lienInterne) && (
                        <div className="flex justify-center gap-2 py-0.5">
                          {lienInterne && (
                            <button type="button" aria-pressed={a.unbroken}
                              onClick={() => updateAccessory(i, 'unbroken', !a.unbroken)}
                              title={a.unbroken ? t("session.lacherAvantLaSuivante") : t("session.sansLacherAvecLaSuivante")}
                              className={cn(
                                'rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors',
                                a.unbroken
                                  ? 'border-gold/40 bg-gold/10 text-gold hover:bg-gold/20'
                                  : 'border-dashed border-border text-muted-foreground hover:border-gold/40 hover:text-gold',
                              )}>
                              {t("session.unbroken")}
                            </button>
                          )}
                          {(peutLierAuSuivant || peutEtendre || estOuvertureDeGroupe) && (
                          <button type="button"
                            aria-label={peutEtendre ? t("session.ajouterAuGroupe") : !estOuvertureDeGroupe ? t("base.lierAuSuivant")
                              : a.groupKind === 'dropset' ? t("session.delierLeGroupe") : t("base.defaireLeBiSet")}
                            onClick={() => toggleAccessoryGroup(i)}
                            className={cn(
                              'flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors',
                              estOuvertureDeGroupe
                                ? 'border-gold/40 bg-gold/10 text-gold hover:bg-gold/20'
                                : 'border-dashed border-border text-muted-foreground hover:border-gold/40 hover:text-gold',
                            )}>
                            {estOuvertureDeGroupe
                              ? <><Link2Off className="h-3 w-3" /> {a.groupKind === 'dropset' ? t("session.delierLeGroupe") : t("base.defaireLeBiSet")}</>
                              : <><Link2 className="h-3 w-3" /> {peutEtendre ? t("session.ajouterAuGroupe") : t("base.lierEnBiSet")}</>}
                          </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionShell>

      {/* Aperçu + génération */}
      <SectionShell
        icon={<Sparkles className="h-3.5 w-3.5" />}
        title={t("base.apercuDeLaSemaine")}
        meta={previewSessionCount ? t("base.seancesCount", { count: previewSessionCount }) : t("base.nonConfigure")}
        tone="orange"
        action={
          <button
            type="button"
            disabled={!!raisonDeNePasGenerer}
            onClick={onGenerate}
            className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium',
              raisonDeNePasGenerer ? 'cursor-not-allowed bg-muted text-muted-foreground' : 'bg-gold text-gold-foreground hover:bg-gold/90')}
            title={raisonDeNePasGenerer ?? t("misc.generateWeek1")}
          >
            <Wand2 className="h-3.5 w-3.5" /> {t("base.genererLaSemaine1")}
          </button>
        }
      >
        {raisonDeNePasGenerer && (
          <p role="status"
             className="mb-2 flex items-start gap-2 rounded-lg border border-gold/25 bg-gold/5 px-3 py-2 text-xs text-muted-foreground">
            <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-gold" />
            <span>{raisonDeNePasGenerer}</span>
          </p>
        )}
        <div className="rounded-lg border border-dashed border-border p-3">
          {previewWeek?.sessions?.length ? (
            <WeekOverview week={previewWeek} />
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("base.configureLaRepartitionEt")}</p>
          )}
        </div>
      </SectionShell>
    </div>
  );
}

function SummaryPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/80 bg-background/45 px-2.5 py-1.5">
      <span className="text-gold">{icon}</span>
      <div className="leading-tight">
        <div className="font-mono text-sm font-semibold tabular-nums text-foreground">{value}</div>
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function DateField({ label, value, min, onChange }: {
  label: string; value: string | null; min?: string; onChange: (value: string | null) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 rounded-lg border border-border/80 bg-background/45 px-2 py-1 text-[11px] text-muted-foreground">
      {label}
      <DatePicker value={value ?? ''} title={label} min={min} onChange={onChange} className="h-7" />
    </label>
  );
}

function SectionShell({
  icon,
  title,
  meta,
  tone = 'gold',
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  meta?: string;
  tone?: ToneKey;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const sectionTone = COLOR_TONES[tone];
  return (
    <section className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-[0_14px_36px_rgba(0,0,0,0.14)]">
      <header className={cn('flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3', sectionTone.bgSoft)}>
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md border', sectionTone.border, sectionTone.bg, sectionTone.text)}>
            {icon}
          </span>
          <div className="min-w-0">
            <h3 className={cn('truncate text-xs font-semibold uppercase tracking-wider', sectionTone.text)}>{title}</h3>
            {meta && <p className="text-[10px] text-muted-foreground">{meta}</p>}
          </div>
        </div>
        {action}
      </header>
      <div className="flex flex-col gap-3 p-4">{children}</div>
    </section>
  );
}

/* ---- Ligne de principe ---- */
function PrincipleRow({ p, lib, usedTiers, onUpdate, onSetKind, onRemove }: {
  p: Principle; lib: CoachLib; usedTiers: Set<1 | 2 | 3>;
  /** `string[]` pour le seul champ qui en porte : les variantes (FRE-33). */
  onUpdate: (field: keyof Principle, value: string | null | string[] | boolean) => void;
  onSetKind: (kind: ExerciseKind) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const tierOpts = ([1, 2, 3] as const).filter(t => usedTiers.has(t));
  const tier = tierTone(p.tier);
  const locked = p.weightLocked;
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5 rounded-md border bg-background/40 p-2', tier ? [tier.border, tier.bgSoft, tier.shadow] : 'border-border')}>
      <Field label={t("base.tier")}>
        <select value={String(p.tier)} onChange={e => onUpdate('tier', e.target.value)} className={cn(selCls, 'font-semibold', tier && [tier.border, tier.bg, tier.text])}>
          {(tierOpts.length ? tierOpts : [1, 2, 3]).map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>
      <KindField kind={p.kind} label={p.name || t("base.cePrincipe")} onChange={onSetKind} />
      <Field label={t("session.variantes")}>
        <ComboboxMultiple values={p.variant} options={lib.variantes} max={MAX_VARIANTES}
          label={t("session.variantes")} placeholder="—" className="w-[110px]"
          onCommit={v => onUpdate('variant', v)} />
      </Field>
      <FormatField format={p.format} clusterMode={p.clusterMode} clusterRest={p.clusterRest} formats={lib.formats} onUpdate={onUpdate} />
      <Field label={t("session.tempo")}><ListInput value={p.tempo} options={lib.tempos} onChange={v => onUpdate('tempo', v)} w={64} /></Field>
      <Field label={t("base.series")}><Txt value={p.sets} onChange={v => onUpdate('sets', v)} w={44} /></Field>
      <Field label={t("base.reps")}><Txt value={p.reps} onChange={v => onUpdate('reps', v)} w={44} /></Field>
      <Field label={t("base.unite")}>
        <select value={p.repsUnit === 'sec' ? 'sec' : 'count'} onChange={e => onUpdate('repsUnit', e.target.value)} className={selCls}>
          <option value="count">rep</option>
          <option value="sec">sec</option>
        </select>
      </Field>
      <Field label={t("session.charge")}>
        <div className="flex items-center gap-1">
          <Txt value={p.weight} onChange={v => onUpdate('weight', v)} w={56} />
          <button
            type="button"
            onClick={() => onUpdate('weightLocked', !locked)}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground',
              locked ? 'border-gold/35 bg-gold/10 text-gold' : 'border-border bg-background/40',
            )}
            title={locked ? t('misc.unlockLoad') : t('misc.lockLoad')}
            aria-pressed={locked}
          >
            {locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
          </button>
        </div>
      </Field>
      <Field label={t("base.rpe")}>
        <select value={p.aimedRPE ?? ''} onChange={e => onUpdate('aimedRPE', e.target.value)} className={selCls}>
          {AIMED_RPE_OPTIONS.map(o => <option key={o} value={o}>{o || '—'}</option>)}
        </select>
      </Field>
      <RestField value={p.rest} onChange={v => onUpdate('rest', v)} />
      <Field label={t("base.assistAbrege")}><ListInput value={p.assistance} options={lib.assistances} onChange={v => onUpdate('assistance', v)} w={80} /></Field>
      <Field label={t("base.incrAbrege")}>
        <div className="flex items-center gap-0.5">
          <Txt value={p.increment} onChange={v => onUpdate('increment', v)} w={40} />
          <select value={p.incrementUnit ?? ''} onChange={e => onUpdate('incrementUnit', e.target.value)} className={selCls}>
            {INCREMENT_UNITS.map(u => <option key={u} value={u ?? ''}>{u}</option>)}
          </select>
        </div>
      </Field>
      <Field label={t("base.note")}><Txt value={p.coachNote ?? ''} onChange={v => onUpdate('coachNote', v)} w={160} /></Field>
      <button type="button" onClick={onRemove} className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/15 hover:text-destructive">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ---- Ligne d'accessoire ---- */
function AccessoryRow({ a, lib, jours, libelleDuJour, sortedRenforcement, ouvreLeGroupe, suiteDuGroupe, tailleDuGroupe, onSetGroupKind, onUpdate, onSetKind, onRemove }: {
  a: BaseAccessory; lib: CoachLib;
  /** Les jours du cycle — c'est la grille qui en décide, pas cette ligne. */
  jours: string[];
  /** Le jour tel qu'il s'affiche (« J2 · Mardi ») ; la valeur reste `J2`. */
  libelleDuJour: (day: string) => string;
  sortedRenforcement: string[];
  /** Première ligne d'un groupe : c'est elle qui porte séries et repos. */
  ouvreLeGroupe: boolean;
  /** Ligne suivante d'un groupe : ses cases séries/repos sont muettes. */
  suiteDuGroupe: boolean;
  tailleDuGroupe: number;
  /** Bi-set ↔ dropset (FRE-149). */
  onSetGroupKind: (nature: NatureDeGroupe) => void;
  /** `string[]` pour le seul champ qui en porte : les variantes (FRE-33).
   *  Un champ de groupe (séries, repos, et le nom d'un dropset) va à tous les
   *  membres : c'est `updateAccessory` qui en décide, selon la nature. */
  onUpdate: (field: keyof BaseAccessory, value: string | null | string[] | boolean) => void;
  onSetKind: (kind: ExerciseKind) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const nature: NatureDeGroupe = natureDe(a);
  // Une descente de dropset porte le MÊME exercice : son nom se lit « ↑ ».
  const suiteDeDescentes = nature === 'dropset' && suiteDuGroupe;
  const locked = a.weightLocked;
  // ⚠️ LE LISERÉ DIT LE JOUR (20/09) — « avant il y avait des couleurs et plus
  // maintenant ». Dans une liste de treize accessoires, c'est ce qui donne d'un
  // coup d'œil les paquets d'un même jour. Sur le BORD, pas sur le fond : la
  // ligne reste lisible, et rien n'entre en concurrence avec les tiers.
  return (
    <div className="relative flex flex-wrap items-center gap-1.5 rounded-md border border-border/70 bg-background/40 p-2"
         style={{ boxShadow: `inset 3px 0 0 ${couleurDuJour(a.day)}` }}>
      {(ouvreLeGroupe || suiteDuGroupe) && (
        <span className="absolute -left-px top-0 h-full w-[3px] rounded-l bg-gold/70" aria-hidden />
      )}
      {/* ⚠️ LA NATURE SE CHOISIT ICI, PAS À LA CRÉATION — le geste de la semaine
          (FRE-36), repris à l'identique (FRE-149). */}
      {ouvreLeGroupe && (
        <ChoixDeNature nature={nature} taille={tailleDuGroupe} onChange={onSetGroupKind} className="text-[9px]" />
      )}
      <Field label={t("base.jour")}>
        <select value={a.day} onChange={e => onUpdate('day', e.target.value)}
                className={cn(selCls, 'font-semibold')} style={{ color: couleurDuJour(a.day) }}>
          {jours.map(d => <option key={d} value={d}>{libelleDuJour(d)}</option>)}
        </select>
      </Field>
      <Field label={t("session.mouvement")}>
        {suiteDeDescentes
          ? <span className="flex h-7 w-28 items-center justify-center text-xs text-muted-foreground" title={t("session.definiSurLaPremiereLigneDuGroupe")}>↑</span>
          : <select value={a.name ?? ''} onChange={e => onUpdate('name', e.target.value)} className={cn(selCls, 'w-28 font-medium')}>
              <option value="">{t('base.choisirTiret')}</option>{sortedRenforcement.map(m => <option key={m} value={m}>{m}</option>)}
            </select>}
      </Field>
      <KindField kind={a.kind} label={a.name || t('base.cetAccessoire')} onChange={onSetKind} />
      <Field label={t("session.variantes")}>
        <ComboboxMultiple values={a.variant} options={lib.variantes} max={MAX_VARIANTES}
          label={t("session.variantes")} placeholder="—" className="w-[110px]"
          onCommit={v => onUpdate('variant', v)} />
      </Field>
      <FormatField format={a.format} clusterMode={a.clusterMode} clusterRest={a.clusterRest} formats={lib.formats} onUpdate={onUpdate} />
      <Field label={t("session.tempo")}><ListInput value={a.tempo} options={lib.tempos} onChange={v => onUpdate('tempo', v)} w={64} /></Field>
      <Field label={t("base.series")}>
        {suiteDuGroupe
          ? <span className="flex h-7 w-11 items-center justify-center text-xs text-muted-foreground/40" title={t("session.definiSurLaPremiereLigneDuBiSet")}>↑</span>
          : <Txt value={a.sets} onChange={v => onUpdate('sets', v)} w={44} />}
      </Field>
      <Field label={t("base.reps")}><Txt value={a.reps} onChange={v => onUpdate('reps', v)} w={44} /></Field>
      <Field label={t("base.unite")}>
        <select value={a.repsUnit === 'sec' ? 'sec' : 'count'} onChange={e => onUpdate('repsUnit', e.target.value)} className={selCls}>
          <option value="count">rep</option>
          <option value="sec">sec</option>
        </select>
      </Field>
      <Field label={t("session.charge")}>
        <div className="flex items-center gap-1">
          <Txt value={a.weight} onChange={v => onUpdate('weight', v)} w={56} />
          <button
            type="button"
            onClick={() => onUpdate('weightLocked', !locked)}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground',
              locked ? 'border-gold/35 bg-gold/10 text-gold' : 'border-border bg-background/40',
            )}
            title={locked ? t('misc.unlockLoad') : t('misc.lockLoad')}
            aria-pressed={locked}
          >
            {locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
          </button>
        </div>
      </Field>
      <Field label={t("base.rpe")}>
        <select value={a.aimedRPE ?? ''} onChange={e => onUpdate('aimedRPE', e.target.value)} className={selCls}>
          {AIMED_RPE_OPTIONS.map(o => <option key={o} value={o}>{o || '—'}</option>)}
        </select>
      </Field>
      {/* Un dropset n'a PAS de repos entre ses descentes : c'est sa définition,
          pas un réglage à zéro (FRE-36). La case n'existe donc pas. */}
      {!leReposSeSaisit(nature)
        ? <Field label={t("session.repos")}><span className="flex h-7 w-14 items-center justify-center text-xs text-muted-foreground" title={t("session.dropsetSansRepos")}>—</span></Field>
        : suiteDuGroupe
        ? <Field label={t("session.repos")}><span className="flex h-7 w-14 items-center justify-center text-xs text-muted-foreground/40" title={t("session.definiSurLaPremiereLigneDuBiSet")}>↑</span></Field>
        : <RestField value={a.rest} onChange={v => onUpdate('rest', v.trim())} />}
      <Field label={t("base.incrAbrege")}>
        <div className="flex items-center gap-0.5">
          <Txt value={a.increment} onChange={v => onUpdate('increment', v)} w={40} />
          <select value={a.incrementUnit ?? ''} onChange={e => onUpdate('incrementUnit', e.target.value)} className={selCls}>
            {INCREMENT_UNITS.map(u => <option key={u} value={u ?? ''}>{u}</option>)}
          </select>
        </div>
      </Field>
      <Field label={t("base.note")}><Txt value={a.coachNote ?? ''} onChange={v => onUpdate('coachNote', v)} w={160} /></Field>
      <button type="button" onClick={onRemove} className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/15 hover:text-destructive">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Champ Format + paramètre complémentaire : EMOM/AMRAP → clusterMode,
 *  CLUSTER → clusterMode (schéma) + clusterRest (repos inter-cluster).
 *  Partagé par PrincipleRow et AccessoryRow. */
function FormatField({ format, clusterMode, clusterRest, formats, onUpdate }: {
  format: string | null; clusterMode: string | null; clusterRest: string | null; formats: string[];
  onUpdate: (field: 'format' | 'clusterMode' | 'clusterRest', value: string | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <Field label={t("base.format")}>
      <div className="flex flex-col gap-1">
        <select value={format ?? ''} onChange={e => onUpdate('format', e.target.value)} className={selCls}>
          <option value="">—</option>{formats.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        {format && (
          <Txt value={clusterMode ?? ''} onChange={v => onUpdate('clusterMode', v)} w={90}
            placeholder={format === 'CLUSTER' ? '1/1/1' : '120'} />
        )}
        {format === 'CLUSTER' && (
          <Txt value={clusterRest ?? ''} onChange={v => onUpdate('clusterRest', v)} w={90} placeholder="15s" />
        )}
      </div>
    </Field>
  );
}

/** NATURE de la ligne (FRE-10) — mêmes libellés courts que dans la séance, pour
 *  qu'un coach reconnaisse le même contrôle des deux côtés. Ligne à ligne ici :
 *  c'est le principe de la BASE, et le kind suit dans chaque semaine générée. */
function KindField({ kind, label, onChange }: {
  kind: ExerciseKind | null | undefined; label: string; onChange: (kind: ExerciseKind) => void;
}) {
  // Son propre `t` : ce composant vit hors de l'éditeur.
  const { t } = useTranslation();
  const isTraining = !kind || kind === 'training';
  return (
    <Field label={t("base.nature")}>
      <select
        value={kind ?? 'training'}
        aria-label={t("base.natureDe", { libelle: label })}
        title={t("base.natureDeLaLigne")}
        onChange={e => onChange(e.target.value as ExerciseKind)}
        className={cn(selCls, 'font-semibold uppercase tracking-wide',
          isTraining ? 'text-muted-foreground' : 'border-gold/35 bg-gold/10 text-gold')}
      >
        <option value="training">{t("base.entrainementCourt")}</option>
        <option value="warmup">{t("base.echauffementCourt")}</option>
        <option value="rehab">{t("base.kine")}</option>
      </select>
    </Field>
  );
}

/** Repos inter-séries (secondes). Vide = Libre, et c'est la seule écriture
 *  (FRE-169) : la sentinelle `-1` est refusée par la base.
 *  Partagé par PrincipleRow et AccessoryRow. */
function RestField({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <Field label={t("session.repos")}>
      <Txt value={value ?? ''} onChange={v => onChange(v.trim())} w={56}
           placeholder={t('session.reposLibre')} />
    </Field>
  );
}

const selCls = 'h-7 rounded-md border border-border bg-background px-1 text-xs outline-none focus:border-gold';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Txt({ value, onChange, w, placeholder }: { value: string | null; onChange: (v: string) => void; w: number; placeholder?: string }) {
  return (
    <input value={value ?? ''} onChange={e => onChange(e.target.value)} style={{ width: w }} placeholder={placeholder}
      className="h-7 rounded-md border border-border bg-background px-1.5 text-center font-mono text-xs outline-none focus:border-gold" />
  );
}

/** Input + datalist (suggestions de la lib, valeur libre autorisée). */
function ListInput({ value, options, onChange, w }: { value: string | null; options: string[]; onChange: (v: string) => void; w: number }) {
  const id = useMemo(() => `dl-${Math.round(0)}-${options.length}-${w}`, [options.length, w]);
  return (
    <>
      <input list={id} value={value ?? ''} onChange={e => onChange(e.target.value)} style={{ width: w }}
        className="h-7 rounded-md border border-border bg-background px-1.5 text-xs outline-none focus:border-gold" />
      <datalist id={id}>{options.map(o => <option key={o} value={o} />)}</datalist>
    </>
  );
}
