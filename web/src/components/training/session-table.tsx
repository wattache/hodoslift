import { Fragment, useState, useLayoutEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Plus, TriangleAlert, Video } from "lucide-react";
import type { ExerciseKind, ObjectifTechnique, SessionEditing, WeekEditing } from '@/api/types';
import { cleMouvement } from "@/api/hooks/use-objectifs-techniques";
import { ObjectifsPastille } from "@/components/training/objectifs-pastille";
import { chargeEtAssistance } from "@/lib/weight";
import { rpeDotColor, RPE_OPTIONS } from "@/lib/rpe";
import { ExerciseProgression } from "./exercise-progression";
import { isFreeRest } from "./rest";
import { champsDuGroupe, formatBadgeSuffix, formatReps, formatRest, talonDuGroupe } from "./format";
import { chaineSansLacher, rangDansLeGroupe, debutDansLEmom, estChronometre, leReposSeSaisit, libelleGroupe, natureDe, tempsDuGroupe, type NatureDeGroupe } from "@/lib/groupe";
import { seriesDeLaLigne, seriesRenseignees } from "@/lib/par-serie";
import { parseSeconds } from "@/lib/time";
import { badgeKind, isTraining } from "@/lib/exercise-kind";
import { cn } from "@/lib/utils";
import { useLocalStorageState } from "@/lib/storage";
import { useTranslation } from 'react-i18next';
import { afficherVariantes } from "@/lib/variantes";
import { EditCell, NoteArea } from "./cellules-coach";
import { CartesCoach } from "./cartes-coach";
import { TableauCoach } from "./tableau-coach";
import { useMediaQuery } from "@/lib/use-mobile";

export interface SessionTableProps {
  session: SessionEditing;
  mode?: "athlete" | "coach";
  canEditSelectedAthlete?: boolean;
  onFeltRPEChange?: (exerciseIndex: number, feltRPE: string) => void;
  /** Le ressenti de la LIGNE depuis la carte : écrit le scalaire ET ferme le
   *  détail par série. Distincte de `onFeltRPEChange`, qui sert le tableau du
   *  coach et ne doit RIEN effacer — il n'a pas de pli, donc pas de geste par
   *  lequel l'athlète aurait dit « oublie le détail ». */
  onFeltRPEGlobal?: (exerciseIndex: number, feltRPE: string) => void;
  onUpdateSetRPE?: (exerciseIndex: number, setIndex: number, value: string | null) => void;
  /** Les reps et la charge de la série active (06/09). */
  onUpdateSetValue?: (exerciseIndex: number, setIndex: number,
                      champ: 'reps' | 'weight', value: string | null) => void;
  /** Édition coach d'un champ d'exercice (séries/reps/charge/RPE cible/notes…). */
  onUpdateField?: (exerciseIndex: number, field: string, value: string | string[] | boolean | number | null) => void;
  /** Nature d'une ligne — callback DÉDIÉE : revenir à « entraînement » supprime
   *  la clé au lieu de la vider (`kind: ''` = 422 sur toute la semaine). */
  onSetExerciseKind?: (exerciseIndex: number, kind: ExerciseKind) => void;
  /** Bascule toute la séance d'un coup. */
  onSetSessionKind?: (kind: ExerciseKind) => void;
  onRemoveExercise?: (exerciseIndex: number) => void;
  /** Duplique la ligne juste dessous ; rend l'identité de la copie. */
  onDuplicateExercise?: (exerciseIndex: number) => Promise<string | null>;
  onMoveExercise?: (from: number, to: number) => void;
  /** Une ligne venue d'une AUTRE séance de la semaine, posée au rang `toIdx` (FRE-188). */
  onMoveExerciseFrom?: (fromSessionId: string, fromIdx: number, toIdx: number) => void;
  onToggleGroup?: (exerciseIndex: number) => void;
  onSetGroupKind?: (exerciseIndex: number, nature: NatureDeGroupe) => void;
  /** Suggestions de noms d'exercice (principaux ∪ renforcement) pour l'édition coach. */
  nameOptions?: string[];
  /** Les objectifs techniques OUVERTS de l'athlète, groupés par mouvement
   *  normalisé (FRE-122). Absent = la pastille ne s'affiche nulle part, ce qui
   *  est l'état correct quand la lecture n'est pas autorisée ou pas chargée. */
  objectifsParMouvement?: ReadonlyMap<string, ObjectifTechnique[]>;
  /** Suggestions de variantes pour l'édition coach. */
  variantOptions?: string[];
  /** Suggestions d'assistances pour l'édition coach. */
  assistanceOptions?: string[];
  /** Suggestions de tempos pour l'édition coach. */
  tempoOptions?: string[];
  /** Toutes les semaines du bloc — pour la mini progression de l'exercice. */
  blockWeeks?: WeekEditing[];
  /** Namespace localStorage pour éviter les collisions entre profils. */
  storageScopeKey?: string;
  /** Bloc courant — bandeau de l'image de progression d'un exercice. */
  shareBlock?: string;
  /** Les AUTRES séances de la semaine, pour « déplacer vers… » au téléphone,
   *  où le glisser-déposer n'a pas d'équivalent (FRE-188). */
  autresSeances?: { id: string; name: string }[];
  onMoveExerciseTo?: (exerciseIndex: number, toSessionId: string) => void;
}

/** UNE TUILE DU RÉEL — répétitions, charge ou repos (maquette 2b, 13/09).
 *
 *  ⚠️ LE TITRE DIT LE CHAMP ET SON UNITÉ — « Répétitions », « Charge (kg) »,
 *  « Repos (s) » —, et le placeholder n'est qu'un NOMBRE (William, 13/09). « Rép.
 *  réelles » sous « Ce que tu as réellement fait » se répétait ; et « 5 kg » en
 *  fond laissait croire qu'il fallait taper l'unité. Le nom ACCESSIBLE du champ,
 *  lui, garde la forme longue (« Charge réelle ») : il est lu seul, hors de
 *  l'étape qui le situe.
 *
 *  ⚠️ PAS DE CIBLE « visé … » DANS LA TUILE (William, 13/09 : « de l'info inutile
 *  quand bien même elle serait juste »). La prescription est déjà deux fois à
 *  l'écran — sur la ligne de l'exercice, et en `placeholder` dans le champ vide.
 *
 *  ⚠️ ET LA TUILE EST PLUS CLAIRE QUE SA ZONE (`bg-muted` sur la carte). Les
 *  champs étaient plus sombres que ce qui les portait : un creux se lit
 *  « désactivé », une surface saillante se lit « tape ici ».
 *
 */
function TuileDuReel({ libelle, children, pied }: {
  libelle: string; children: React.ReactNode; pied?: React.ReactNode;
}) {
  /* ⚠️ UN `<label>`, PAS UNE `<div>` (14/09). Au téléphone la tuile a perdu 20 px
     de haut pour que le pli tienne dans l'écran : le champ n'y fait plus 44 px.
     C'est la TUILE ENTIÈRE qui devient la cible du doigt — un toucher n'importe
     où y pose le curseur. */
  return (
    <label className="block min-w-0 cursor-text rounded-lg border border-gold/40 bg-muted px-2 py-1 focus-within:border-gold sm:px-3 sm:py-2.5">
      <span className="block max-w-full truncate font-display text-[10px] uppercase tracking-[0.14em] text-foreground/90">
        {libelle}
      </span>
      {children}
      {pied}
    </label>
  );
}

/** Le champ dans sa tuile : transparent, la valeur en grand. Ce qui reste à
 *  remplir est GRIS et MAIGRE, ce qui est saisi est OR et GRAS (13/09) — et le
 *  gris est à opacité PLEINE (2b) : à `/45` il tombait vers 2:1, sous le seuil,
 *  donc invisible en salle. C'est l'opacité qui rendait la règle inopérante,
 *  pas la règle. */
const CLASSE_CHAMP_DU_REEL =
  "mt-0 h-7 rounded-none border-0 bg-transparent px-0 text-[19px] font-semibold leading-none text-gold focus:border-0 placeholder:font-normal placeholder:text-muted-foreground sm:mt-1 sm:h-10 sm:text-[26px]";

/** La même tuile en lecture seule : une valeur à la place du champ. */
function ValeurDuReel({ valeur, vide }: { valeur: string | null | undefined; vide: string }) {
  return valeur
    ? <p className="mt-0 flex h-7 items-center font-mono text-[19px] font-semibold leading-none tabular-nums text-gold sm:mt-1 sm:h-10 sm:text-[26px]">{valeur}</p>
    : <p className="mt-0 flex h-7 items-center text-[11px] italic text-muted-foreground sm:mt-1 sm:h-10">{vide}</p>;
}

function exerciseNumbers(exercises: { groupId?: string | null }[]): number[] {
  const numbers: number[] = [];
  let current = 0;

  exercises.forEach((exercise, index) => {
    const previous = exercises[index - 1];
    if (index === 0) {
      numbers.push(current);
    } else if (exercise.groupId && exercise.groupId === previous?.groupId) {
      numbers.push(numbers[index - 1]);
    } else {
      current += 1;
      numbers.push(current);
    }
  });

  return numbers;
}

export function SessionTable(props: SessionTableProps) {
  const { session, mode = "athlete", canEditSelectedAthlete = false, onFeltRPEChange, onFeltRPEGlobal, onUpdateSetRPE, onUpdateSetValue, onUpdateField, onSetSessionKind, objectifsParMouvement, blockWeeks, storageScopeKey, shareBlock } = props;
  const { t } = useTranslation();
  const [openNotes, setOpenNotes] = useState<Record<number, boolean>>({});
  /** DÉPLIER UN EXERCICE L'AMÈNE À L'ÉCRAN, EN ENTIER (16/09, remonté par les
   *  athlètes). Choisir une séance remontait déjà son bandeau en haut ; déplier un
   *  exercice en bas de page laissait le pli sous la ligne de flottaison — on
   *  dépliait, puis on faisait défiler à la main pour trouver le RPE.
   *
   *  ⚠️ LE BAS DU PLI SE CALE EN BAS DE L'ÉCRAN, au-dessus de la barre basse du
   *  téléphone (`--barre-basse`) : le titre reste visible au-dessus, et ce qu'on
   *  vient chercher — la saisie — est entier. Un pli PLUS HAUT que l'écran se cale
   *  par le haut, sous l'en-tête : sinon son titre disparaîtrait.
   *
   *  ⚠️ ET RIEN NE BOUGE S'IL EST DÉJÀ ENTIER : faire sauter la page sous le doigt
   *  pour un pli qui se voyait serait pire que le défaut corrigé.
   *
   *  ⚠️ LA MESURE SE FAIT DANS UN `useLayoutEffect`, PAS DANS UN
   *  `requestAnimationFrame` : c'est le premier instant où le pli ouvert existe
   *  dans le DOM, avant qu'il soit peint. Deux images d'attente marchaient dans un
   *  navigateur au premier plan, et jamais dans un onglet en arrière-plan, où le
   *  navigateur suspend les images. */
  const pliAAmener = useRef<HTMLElement | null>(null);
  const basculerLePli = (i: number, carte: HTMLElement | null) => {
    if (!openNotes[i]) pliAAmener.current = carte;
    // ⚠️ UN SEUL EXERCICE DÉPLIÉ À LA FOIS (FRE-180, William, 16/09). Essayé puis
    // retiré le même jour — « ça empêche d'en avoir deux ouverts » — et redemandé
    // le soir : sur une longue séance, les plis restés ouverts au-dessus
    // repoussaient celui qu'on vient d'ouvrir. L'effet ci-dessous mesure APRÈS
    // le repli des autres, donc il ramène le bon pli à l'écran.
    setOpenNotes((st) => (st[i] ? { ...st, [i]: false } : { [i]: true }));
  };
  useLayoutEffect(() => {
    const carte = pliAAmener.current;
    pliAAmener.current = null;
    if (!carte) return;
    const r = carte.getBoundingClientRect();
    const barre = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--barre-basse')) || 0;
    const haut = (document.querySelector('header')?.getBoundingClientRect().bottom ?? 0) + 8;
    const bas = window.innerHeight - barre - 8;
    if (r.top >= haut && r.bottom <= bas) return;
    const doux = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollBy({ top: r.height > bas - haut ? r.top - haut : r.bottom - bas, behavior: doux ? 'smooth' : 'auto' });
  }, [openNotes]);
  // Le pli du RPE PAR SÉRIE, par exercice. Voir le commentaire au point de
  // bascule : 14 % des lignes s'en servent, et les coachs ne les lisent pas.
  const [parSerieParExercice, setParSerieParExercice] = useState<Record<string, boolean>>({});
  // Le feedback de l'athlète, déplié à la demande (maquette 2b). Il s'affiche
  // d'office dès qu'il porte du texte : replier ce qui est écrit le cacherait.
  const [feedbackOuvert, setFeedbackOuvert] = useState<Record<string, boolean>>({});
  const [activeSetByExercise, setActiveSetByExercise] = useLocalStorageState<Record<string, number>>(
    `ff-training-set-markers:${storageScopeKey || "global"}`,
    {},
  );
  const coachEdit = mode === "coach" && !!onUpdateField;
  const athleteEdit = mode === "athlete" && canEditSelectedAthlete && !!onUpdateField;

  // Le mode coach a deux vues, une par écran (voir le retour plus bas).
  const grandEcran = useMediaQuery('(min-width: 1024px)');

  if (!coachEdit) {
    const numbers = exerciseNumbers(session.exercises);
    // ⚠️ PLUS DE CARTE AUTOUR DE LA SÉANCE. Une séance est une liste homogène —
    // les mêmes grandeurs, une ligne par exercice — pas un objet à isoler du
    // reste de la page. Le cadre, le fond et l'ombre portée disaient « ceci est
    // un widget » ; les filets disent « ceci est une liste », ce qui est vrai.
    // Même grammaire que l'Aperçu.
    return (
      <div>
        <div className="flex flex-col">
          {session.exercises.map((ex, i) => {
            const hasNote = !!ex.coachNote || !!ex.athleteFeedback;
            const isOpen = openNotes[i];
            // BI-SET : la numérotation groupait déjà (deux lignes liées portent le
            // même numéro), mais RIEN ne le montrait dans cette vue — l'athlète,
            // qui est justement celui à qui l'information sert, voyait deux
            // exercices indépendants. La barre existait dans le tableau coach et
            // dans l'Aperçu ; ce chemin de rendu-ci l'avait oubliée.
            //
            // `groupSize > 1` et non `!!groupId` : cinq groupes ORPHELINS d'une
            // seule ligne traînent en base (partenaire supprimé, groupe resté).
            // Une barre de liaison sur une ligne seule ne relierait rien.
            const enGroupe = ex.groupId
              ? session.exercises.filter(o => o.groupId === ex.groupId).length > 1
              : false;
            // Séries et repos décrivent le TOUR du bi-set, pas chaque exercice :
            // les répéter sur la seconde ligne laisse croire à deux prescriptions
            // indépendantes — « 2 × 10 · 2' » deux fois de suite se lit comme deux
            // fois deux minutes de repos. On ne les montre qu'une fois.
            const suiteDuGroupe = enGroupe && session.exercises[i - 1]?.groupId === ex.groupId;
            const ouvreLeGroupe = enGroupe && !suiteDuGroupe;
            const tailleDuGroupe = enGroupe
              ? session.exercises.filter(o => o.groupId === ex.groupId).length
              : 0;
            // ⚠️ LA NATURE VIENT DU SERVEUR RÉSOLUE (FRE-36) : en base l'absence
            // vaut « bi-set », mais connaître cette convention ici en ferait une
            // SECONDE définition de la notion. On lit, on ne déduit pas.
            const natureDuGroupe = natureDe(ex);
            const suiteDeDescentes = natureDuGroupe === 'dropset' && suiteDuGroupe;
            const chaine = enGroupe ? chaineSansLacher(session.exercises, i) : null;
            const rang = enGroupe ? rangDansLeGroupe(session.exercises, i) : 0;
            const fermeLeGroupe = enGroupe && session.exercises[i + 1]?.groupId !== ex.groupId;
            // LA PASTILLE D'OBJECTIFS TECHNIQUES de ce mouvement (FRE-122),
            // calculée UNE fois pour les branches d'affichage de cette ligne.
            //
            // ⚠️ TROIS BRANCHES RENDENT UNE LIGNE — l'athlète (dense, pensée pour
            // le téléphone), le coach en édition, et la lecture seule. La poser
            // dans une seule les laisse muettes, et c'est arrivé : posée d'abord
            // dans la branche d'édition, la pastille ne s'affichait qu'en mode
            // coach — c'est-à-dire jamais pour son destinataire.
            //
            // Masquée sur une suite de descentes, comme le nom lui-même : un
            // dropset décrit un seul mouvement.
            const pastilleObjectifs = suiteDeDescentes ? null : (
              <ObjectifsPastille
                mouvement={ex.name}
                objectifs={objectifsParMouvement?.get(cleMouvement(ex.name)) ?? []}
              />
            );
            // Exercice TENU, pas compté : la ligne est prescrite en secondes.
            const auChrono = ex.repsUnit === "sec";
                  const feltRPEColor = ex.feltRPE ? rpeDotColor(ex.feltRPE) : undefined;
                  const aimedRPEColor = ex.aimedRPE ? rpeDotColor(ex.aimedRPE) : undefined;
                  const mt = ex.mechano ?? null;
                  // ⚠️ UNE ÉTIQUETTE, PLUS UNE GÉLULE. Un fond et un cadre
                  // autour de « EMOM » en font un objet qui concurrence le nom
                  // du mouvement ; la condensée en petites capitales espacées
                  // qualifie sans peser. Une seule constante ici → le changement
                  // porte sur les cinq badges de cette vue d'un coup.
                  const badgeClass = "shrink-0 font-display text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground";
                  const hasFreeRest = isFreeRest(ex.rest);
                  const setCount = parseInt(ex.sets ?? '', 10);
                  const exerciseKey = `${session.id || session.name}:${i}`;
                  const activeSet = activeSetByExercise[exerciseKey] || 0;
                  const setPills = Number.isFinite(setCount) && setCount > 1
                    ? Array.from({ length: setCount }, (_, idx) => idx + 1)
                    : [];
                  // RPE par série : le select édite la série ACTIVE (défaut 1).
                  // Rétrocompat : si pas de feltRPEBySet mais un feltRPE legacy,
                  // on l'affiche comme valeur de la série 1.
                  const effectiveSet = activeSet >= 1 ? activeSet : 1;
                  const rpeBySet = (Array.isArray(ex.feltRPEBySet) && ex.feltRPEBySet.length > 0)
                    ? ex.feltRPEBySet
                    : (ex.feltRPE ? [ex.feltRPE] : []);
                  // ⚠️ LES TROIS TABLEAUX SUIVENT LA MÊME SÉRIE ACTIVE (06/09).
                  // Donner à chacun son propre sélecteur aurait laissé l'athlète
                  // noter son RPE de la série 3 pendant qu'il saisit les reps de
                  // la 1 — trois curseurs pour une seule réalité.
                  const repsBySet = seriesDeLaLigne(ex.repsDoneBySet, ex.repsDone);
                  const chargeBySet = seriesDeLaLigne(ex.weightDoneBySet, ex.weightDone);
                  // Ouvert par le coach/athlète, OU d'office si la ligne porte
                  // déjà des ressentis différents d'une série à l'autre.
                  const dejaParSerie = new Set(rpeBySet.filter(Boolean)).size > 1;
                  const parSerie = parSerieParExercice[exerciseKey] ?? dejaParSerie;
                  // Le pli n'a de sens qu'à partir de deux séries : sur une ligne
                  // à une série, « par série » et « la ligne » sont la même
                  // chose, et le sélecteur serait un clic pour rien.
                  const parSerieOuvert = parSerie && setCount > 1;
                  // ⚠️ CE QUI EST « CHOISI » SUIT CE QU'ON ÉCRIT, et doit donc
                  // se déclarer APRÈS `parSerieOuvert`. Hors du pli on note la
                  // LIGNE : c'est `feltRPE` qui apparaît sélectionné, pas la
                  // case 1 d'un tableau qu'on n'alimente plus.
                  const setRpeValue = parSerieOuvert
                    ? (rpeBySet[effectiveSet - 1] ?? "")
                    : (ex.feltRPE ?? "");
                  // ⚠️ CE QUI MANQUE POUR QUE LE SUIVI VOIE LA LIGNE (FRE-156).
                  // Les tableaux BRUTS, pas ceux de `seriesDeLaLigne` : ce
                  // dernier promeut un scalaire en tableau d'un élément, et une
                  // valeur globale passerait alors pour deux séries oubliées.
                  // 24 lignes de production notent leurs répétitions une seule
                  // fois pour trois charges — elles ont tout dit.
                  const notees = seriesRenseignees(
                    [ex.feltRPEBySet, ex.repsDoneBySet, ex.weightDoneBySet], setCount);
            return (
              <Fragment key={i}>
              {/* En-tête du BLOC : ce qui appartient au tour est annoncé une
                  fois, au-dessus des exercices qui le composent. Masquer les
                  valeurs ligne par ligne ne suffisait pas — un athlète lisait
                  deux exercices voisins sans voir qu'ils s'enchaînent. */}
              {/* L'EN-TÊTE COMMANDE (maquette 2a, FRE-116) : la nature, puis ce
                  qui appartient au tour en champs ÉTIQUETÉS. Une phrase grise
                  en mono — « 3 séries · repos 3' » — se lisait comme une annexe,
                  pas comme ce qui gouverne les lignes du dessous.

                  ⚠️ PAS DE REPOS SUR UN DROPSET, NI SUR UN EMOM OU UN AMRAP :
                  `champsDuGroupe` ne le propose pas, et `leReposSeSaisit` le tait
                  ici. L'or pour les enchaînements, le bleu `--metric` quand le
                  TEMPS appartient au groupe — c'est déjà sa sémantique pour le
                  tempo et le repos. */}
              {ouvreLeGroupe && (
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border/40 px-3 pb-1.5 pt-3">
                  <span className={cn("font-display text-[13px] font-bold uppercase tracking-[0.12em]",
                    estChronometre(natureDuGroupe) ? "text-metric" : "text-gold")}>
                    {libelleGroupe(tailleDuGroupe, natureDuGroupe)}
                  </span>
                  {champsDuGroupe(natureDuGroupe, tailleDuGroupe, ex,
                    leReposSeSaisit(natureDuGroupe) && !hasFreeRest && ex.rest ? formatRest(ex.rest) : "").map((c) => (
                    <span key={c.libelle} className="flex items-baseline gap-1">
                      <span className="font-mono text-sm font-semibold text-foreground">{c.valeur}</span>
                      <span className="font-display text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{c.libelle}</span>
                    </span>
                  ))}
                  {natureDuGroupe === "amrap" && (
                    <span className="font-display text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                      {t("session.maxDeTours")}
                    </span>
                  )}
                </div>
              )}
              {/* SANS LÂCHER, écrit UNE fois au-dessus de la chaîne qu'il couvre
                  (2a) : posé sous une ligne, il semblait la qualifier au lieu
                  de dire le passage à la suivante. */}
              {chaine?.debut && (
                <div className="relative px-3 pt-1">
                  <span className="absolute left-0 top-0 h-full w-[3px] bg-gold/70" aria-hidden />
                  <span className="ml-8 font-display text-[10px] font-bold uppercase tracking-[0.12em] text-gold">
                    {t("session.sansLacherMouvements", { n: chaine.mouvements })}
                  </span>
                </div>
              )}
              <div
                data-pli
                className={cn(
                  "relative",
                  isOpen
                    ? "mb-2 rounded-lg border border-gold/35 bg-gold/5 shadow-[0_10px_24px_rgba(0,0,0,0.12)] first:mt-0"
                    : "border-t border-dotted border-border/60 first:border-t-0",
                )}
              >
                <div className={cn("relative flex gap-3 px-3 py-2.5", isOpen && "border-b border-gold/15 pb-2")}>
                  {/* LE FILET DIT LA NATURE PAR SA FORME (2a) : plein et or pour un
                      enchaînement, bleu quand le temps est au groupe, en tirets
                      pour l'AMRAP (temps ouvert). Il s'ÉPAISSIT sur une chaîne
                      sans lâcher : la coupure avant le mouvement libre se voit
                      sans lire un mot. */}
                  {enGroupe && (
                    <span data-group-marker aria-hidden className={cn(
                      "absolute left-0 top-0 h-full",
                      chaine ? "w-[5px]" : "w-[3px]",
                      natureDuGroupe === "amrap" ? "border-l-[3px] border-dotted border-metric"
                        : natureDuGroupe === "emom" ? "bg-metric" : "bg-gold/70",
                    )} />
                  )}
                  {/* ⚠️ DANS UN EMOM EN ROTATION, LA MINUTE REMPLACE LE NUMÉRO
                      (FRE-116) : c'est ce que l'athlète cherche des yeux, et elle
                      se lit de la PLACE dans le groupe — les tableurs l'écrivaient
                      dans la variante (« MIN 4GOBELET »). */}
                  {enGroupe && natureDuGroupe === "emom" ? (
                    <span className="w-11 shrink-0 pt-0.5 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-metric">
                      {debutDansLEmom(
                        session.exercises.slice(0, i).filter(o => o.groupId === ex.groupId).length,
                        tempsDuGroupe("emom", tailleDuGroupe, ex.sets, ex.clusterMode)?.intervalle ?? null,
                      )}
                    </span>
                  ) : enGroupe ? (
                    /* La PLACE dans le tour, pas le numéro de séance répété (2a). */
                    <span className="w-8 shrink-0 pt-0.5 font-mono text-[11px] text-muted-foreground">
                      {t("session.placeDansLeTour", { rang: rang + 1, total: tailleDuGroupe })}
                    </span>
                  ) : (
                  <span className="w-5 shrink-0 text-center text-[11px] font-medium text-muted-foreground tabular-nums">
                    {numbers[i] + 1}
                  </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                      {/* ⚠️ UN DROPSET N'A QU'UN EXERCICE : le répéter à chaque
                          descente le ferait lire comme plusieurs mouvements, ce
                          qui est exactement ce qu'un dropset n'est pas. Même
                          idiome que les séries et le repos, annoncés une fois
                          pour le groupe. */}
                      {/* ⚠️ PLUS GROS SUR TÉLÉPHONE (§6 de docs/design.md). Ce
                          nom se lit à bout de bras, l'appareil posé sur un banc :
                          14 px y sont trop petits. Le coach, lui, garde sa
                          densité au-dessus de `sm`. */}
                      <span className="min-w-0 truncate text-base font-medium leading-snug sm:text-sm">
                        {suiteDeDescentes
                          ? <span className="text-muted-foreground/50" title={t("session.memeExerciceQueLaDescente")}>↑</span>
                          : (ex.name || "—")}
                      </span>
                      {/* Le libellé, pas la liste : `[]` est TRUTHY en JS —
                          tester `ex.variant` afficherait un badge vide sur
                          chaque exercice sans variante. */}
                      {/* Les deux dernières gélules de cette vue (§4) : une
                          étiquette qualifie le mouvement, elle ne l'encadre pas. */}
                      {afficherVariantes(ex.variant) && (
                        <span className="font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          {afficherVariantes(ex.variant)}
                        </span>
                      )}
                      {!isTraining(ex) && ex.kind && ex.kind !== "training" && (
                        <span className="shrink-0 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-gold">
                          {badgeKind(ex.kind, t)}
                        </span>
                      )}
                      {ex.format && (
                        <span className={badgeClass}>
                          {ex.format}
                          {formatBadgeSuffix(ex)}
                        </span>
                      )}
                      {pastilleObjectifs}
                    </div>

                    {/* La prescription monte d'un cran sur téléphone : c'est CE
                        qu'on relit entre deux séries. Les annexes (tempo, mt,
                        repos, RPE) restent au corps courant — elles se consultent,
                        elles ne se cherchent pas. */}
                    <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 font-mono text-[13px] leading-tight sm:text-xs">
                      <span className="font-medium text-foreground">
                        {enGroupe ? "" : `${ex.sets || "—"}×`}{formatReps(ex.reps, ex.repsUnit)}
                      </span>
                      {/* Le chiffre d'une ligne de groupe porte son unité (2a) :
                          « 3 » seul ne disait pas ce qu'il compte. */}
                      {enGroupe && ex.repsUnit !== "sec" && (ex.reps || "").trim() && (
                        <span className="font-display text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                          {t("session.reps")}
                        </span>
                      )}
                      {chargeEtAssistance(ex).length > 0 && (
                        <span className="text-[15px] font-bold text-gold sm:text-xs sm:font-semibold">
                          {chargeEtAssistance(ex).join(" · ")}
                        </span>
                      )}
                      {/* Méta secondaire (muted, labels discrets, valeurs vides omises) */}
                      {ex.tempo && (
                        <span>
                          <span className="text-muted-foreground/70">· tempo </span>
                          <span className="font-semibold text-metric">{ex.tempo}</span>
                        </span>
                      )}
                      {/* ⚠️ `!== null` ET NON `mt &&` : un tempo tout explosif
                          (« XXX ») vaut 0, ce qui est un temps sous tension nul —
                          pas une absence de score. Le raccourci le ferait
                          disparaître. */}
                      {mt !== null && (
                        <span title={t("session.mecanotransduction")}>
                          <span className="text-muted-foreground/70">· mt </span>
                          <span className="font-semibold text-serie-poids">{mt}</span>
                        </span>
                      )}
                      {ex.rest && !hasFreeRest && !enGroupe && (
                        <span>
                          <span className="text-muted-foreground/70">· repos </span>
                          <span className="font-semibold text-metric">{formatRest(ex.rest)}</span>
                        </span>
                      )}
                      {(ex.aimedRPE || ex.feltRPE) && (
                        <span className="text-muted-foreground">
                          <span className="text-muted-foreground/70">· rpe </span>
                          <span className="font-medium" style={aimedRPEColor ? { color: aimedRPEColor } : undefined}>{ex.aimedRPE || "—"}</span>
                          {ex.feltRPE && (
                            <>
                              <span className="text-muted-foreground/70" aria-hidden> → </span>
                              <span className="font-semibold" style={feltRPEColor ? { color: feltRPEColor } : undefined}>{ex.feltRPE}</span>
                            </>
                          )}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-0.5 self-start">
                    {ex.link && (
                      <a
                        href={ex.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title={t("session.voirLaVideo")}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-gold hover:bg-gold/15"
                      >
                        <Video className="h-3.5 w-3.5" />
                      </a>
                    )}
                    {mode === "coach" && (
                      <select
                        value={ex.feltRPE ?? ''}
                        onChange={(e) => onFeltRPEChange?.(i, e.target.value)}
                        className="h-7 w-16 rounded-md border border-border bg-background pl-1.5 pr-0.5 text-[11px] font-mono outline-none focus:border-gold"
                        style={{
                          boxShadow: feltRPEColor ? `inset 3px 0 0 0 ${feltRPEColor}` : undefined,
                          color: feltRPEColor,
                        }}
                      >
                        {RPE_OPTIONS.map((o) => (
                          <option key={o} value={o}>
                            {o || "—"}
                          </option>
                        ))}
                      </select>
                    )}
                    {/* ⚠️ SUR LA LIGNE, PAS DANS LE PLI DE SAISIE (FRE-156). Il
                        était d'abord posé à côté de la bascule « par série » —
                        donc invisible tant que l'exercice n'est pas déplié,
                        c'est-à-dire précisément quand on survole une séance pour
                        voir ce qui reste à faire.

                        ⚠️ ET IL NE DÉPEND PAS DE LA BASCULE. Un tableau ouvert et
                        troué reste troué même si l'affichage par série est
                        replié : c'est la DONNÉE qui est incomplète, pas la vue. */}
                    {notees && notees.notees < notees.attendues && (
                      <span
                        title={t("session.seriesIncompletes", {
                          notees: notees.notees, total: notees.attendues })}
                        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-gold/40 bg-gold/10 px-1.5 font-mono text-[11px] text-gold"
                      >
                        <TriangleAlert className="h-3 w-3" aria-hidden />
                        {notees.notees}/{notees.attendues}
                      </span>
                    )}
                    {/* ⚠️ LE CHEVRON RESTE AU BORD DROIT. La maquette 2b le collait
                        au titre ; à l'écran, aligné sur des noms de longueurs
                        différentes, il zigzaguait d'une ligne à l'autre (William,
                        13/09 : « pas beau »). */}
                    <button
                      type="button"
                      onClick={(e) => basculerLePli(i, e.currentTarget.closest<HTMLElement>('[data-pli]'))}
                      aria-expanded={!!isOpen}
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent",
                        hasNote && "bg-gold/10 text-gold hover:bg-gold/15",
                      )}
                      title={hasNote ? "Voir notes" : t("session.ajouterUneNote")}
                    >
                      {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                {isOpen && (
                  /* ⚠️ LE PLI SUIT LA FRÉQUENCE DE SAISIE (maquette 2b, 13/09).
                     Mesuré : 10 095 lignes portent un RPE contre 54 un tableau de
                     répétitions, et six valeurs de RPE couvrent 81 % des saisies.
                     Ce qui se saisit dix fois plus souvent arrivait TROISIÈME,
                     sous trois champs et au même poids qu'eux. L'ordre est
                     maintenant celui de la donnée, et les étapes sont numérotées :
                     1 · comment c'était, 2 · ce que tu as fait, puis le feedback,
                     replié.

                     ⚠️ DEUX COLONNES, ET C'EST LE DIAGNOSTIC d'avant (refonte des
                     écrans, 09/2026) qui tient : à gauche ce qu'on écrit, à droite
                     ce qu'on consulte. La grille est en `1.25fr / 1fr` — la saisie
                     est le sujet — et s'empile sous `md`. La zone de gauche perd
                     son fond doré : les tuiles doivent être PLUS CLAIRES que ce
                     qui les porte, pas l'inverse. */
                  <div className="grid gap-4 border-t border-gold/15 px-3 py-3 text-xs sm:gap-5 sm:py-3.5 md:gap-6 md:[grid-template-columns:minmax(0,1.25fr)_minmax(0,1fr)]">
                    <div className="flex min-w-0 flex-col gap-3 sm:gap-4">
                      {/* ⚠️ LA NOTE DU COACH RESTE EN TÊTE de la colonne qu'on
                          écrit, et ne ressemble pas au feedback. L'une se lit AVANT
                          de soulever, l'autre s'écrit APRÈS. Le filet bleu
                          `--metric` la distingue de l'or, couleur de ce qu'on écrit. */}
                      {ex.coachNote && (
                        <div
                          className="rounded-md bg-background/60 px-2.5 py-2 leading-snug text-foreground/90"
                          style={{ boxShadow: "inset 3px 0 0 var(--metric)" }}
                        >
                          <span className="mr-1.5 font-display text-[10px] uppercase tracking-[0.14em] text-metric">
                            {t("session.noteCoach")}
                          </span>
                          {ex.coachNote}
                        </div>
                      )}

                      {/* ---- 1 · COMMENT C'ÉTAIT ---- */}
                      <div>
                        <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 sm:mb-2.5">
                          <span className="font-display text-[13px] font-semibold uppercase tracking-[0.1em] text-foreground">
                            {t("session.etapeRessenti")}
                          </span>
                          {parSerieOuvert && (
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {t("session.serieN", { n: effectiveSet })}
                            </span>
                          )}
                          {/* ⚠️ LE RPE PAR SÉRIE PASSE DERRIÈRE UN PLI, et c'est un
                              arbitrage mesuré : 1 423 lignes sur 10 095 portent des
                              valeurs différentes d'une série à l'autre — 14 % — mais
                              « les coachs ne les regardent même pas » (01/09). Il
                              s'ouvre TOUT SEUL quand la ligne en porte déjà.

                              ⚠️ COLLÉ À SON LIBELLÉ, plus en `ml-auto` : à 640 px
                              de lui, rien ne le rattachait au RPE qu'il
                              commande (2b). */}
                          {athleteEdit && setCount > 1 && (
                            <button
                              type="button"
                              onClick={() => setParSerieParExercice((st) => ({ ...st, [exerciseKey]: !parSerie }))}
                              aria-pressed={parSerie}
                              className={cn(
                                "inline-flex h-7 items-center rounded-md border px-2 font-display text-[11px] uppercase tracking-[0.12em] transition-colors sm:h-6 sm:text-[10px]",
                                parSerie
                                  ? "border-transparent bg-gold font-semibold text-gold-foreground"
                                  : "border-border bg-muted text-foreground hover:border-gold/35",
                              )}
                            >
                              {t("session.parSerie")}
                            </button>
                          )}
                          {/* Le visé prend le bord droit : une indication, pas une commande. */}
                          {ex.aimedRPE && (
                            <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                              {t("session.vise", { valeur: ex.aimedRPE })}
                            </span>
                          )}
                        </div>

                        {athleteEdit ? (
                          <>
                            {parSerieOuvert && (
                              <div className="mb-2 flex flex-wrap gap-1.5 sm:gap-1">
                                {setPills.map((setNumber) => {
                                  const active = effectiveSet === setNumber;
                                  const valeur = rpeBySet[setNumber - 1] ?? "";
                                  return (
                                    <button
                                      key={setNumber}
                                      type="button"
                                      onClick={() => {
                                        setActiveSetByExercise((prev: Record<string, number>) => ({
                                          ...prev,
                                          [exerciseKey]: setNumber,
                                        }));
                                      }}
                                      className={cn(
                                        "inline-flex h-10 items-center gap-1.5 rounded-full border px-2.5 font-mono text-sm transition-colors sm:h-6 sm:px-2 sm:text-[10px]",
                                        active
                                          ? "border-gold text-foreground"
                                          : "border-border text-muted-foreground hover:border-gold/35 hover:text-foreground",
                                      )}
                                      aria-pressed={active}
                                      title={t("session.serieN", { n: setNumber })}
                                    >
                                      <span className="text-muted-foreground">{setNumber}</span>
                                      {/* La valeur déjà saisie se lit SUR la pastille :
                                          sans ça, comparer deux séries obligeait à les
                                          sélectionner l'une après l'autre. */}
                                      <span style={valeur ? { color: rpeDotColor(valeur) } : undefined}>
                                        {valeur || "·"}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                            {/* ⚠️ UN MENU DÉROULANT, PLUS UNE RÉGLETTE (William, 15/09 :
                                « ça fera moins de choses à l'écran »). Treize pastilles
                                sur deux rangées prenaient le pli entier au téléphone.
                                L'échelle complète reste dans le menu, Sub5 et FAIL
                                compris, et le vide pour effacer ; le visé est écrit
                                juste au-dessus. */}
                            <select
                              value={setRpeValue}
                              aria-label={t("session.rpeReel")}
                              /* ⚠️ PLI FERMÉ, C'EST LA LIGNE QU'ON NOTE (10/09). Les
                                 pastilles d'avant appelaient TOUJOURS `onUpdateSetRPE`,
                                 sur la série active qui vaut 1 par défaut — une ligne à
                                 quatre séries repartait avec `['8']`, que le badge
                                 lisait « 1/4 ». `rpe-global-nest-pas-par-serie` (harnais
                                 réel) le garde. */
                              onChange={(e) => {
                                const v = e.target.value;
                                if (parSerieOuvert) onUpdateSetRPE?.(i, effectiveSet, v);
                                else onFeltRPEGlobal?.(i, v);
                              }}
                              className="h-11 w-full rounded-lg border border-border bg-muted px-3 font-mono text-base font-semibold outline-none focus:border-gold sm:h-10 sm:w-48"
                              style={setRpeValue ? { color: rpeDotColor(setRpeValue), boxShadow: `inset 4px 0 0 0 ${rpeDotColor(setRpeValue)}` } : undefined}
                            >
                              {RPE_OPTIONS.map((o) => (
                                <option key={o || "vide"} value={o}>{o || "—"}</option>
                              ))}
                            </select>
                          </>
                        ) : (
                          /* ⚠️ LA LECTURE SEULE REÇOIT LA MÊME STRUCTURE — mêmes
                             étapes, mêmes libellés, mêmes cibles, une valeur à la
                             place du menu. Le coach et son athlète décrivent
                             le même écran. */
                          ex.feltRPE ? (
                            <span
                              className="inline-flex h-[52px] min-w-[52px] items-center justify-center rounded-lg px-2.5 font-mono text-base font-bold text-gold-foreground"
                              style={{ backgroundColor: rpeDotColor(ex.feltRPE) }}
                            >
                              {ex.feltRPE}
                            </span>
                          ) : (
                            <p className="text-[11px] italic text-muted-foreground">{t("session.aucuneSaisie")}</p>
                          )
                        )}
                      </div>

                      {/* ---- 2 · CE QUE TU AS FAIT ---- */}
                      <div className="border-t border-border/70 pt-3 sm:pt-4">
                        <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 sm:mb-2.5">
                          <span className="font-display text-[13px] font-semibold uppercase tracking-[0.1em] text-foreground">
                            {t("session.etapeReel")}
                          </span>
                          {/* Vrai côté serveur : les répétitions et la charge
                              prescrites font foi tant que rien ne les contredit
                              (`records.py`, FRE-160). */}
                          {athleteEdit && (
                            <span className="text-[11px] text-muted-foreground">{t("session.videEgaleConforme")}</span>
                          )}
                          {/* ⚠️ LE FEEDBACK S'OUVRE D'ICI, plus depuis sa propre
                              rangée (14/09) : 75 px pour un bouton facultatif, et le
                              pli déplié ne tenait plus dans l'écran du téléphone
                              avec la progression dessous. Il reste un bouton, et
                              s'ouvre de lui-même dès qu'il porte du texte (2b). */}
                          {athleteEdit && !(feedbackOuvert[exerciseKey] || ex.athleteFeedback) && (
                            <button
                              type="button"
                              onClick={() => setFeedbackOuvert((st) => ({ ...st, [exerciseKey]: true }))}
                              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 text-[12px] text-muted-foreground hover:border-gold/35 hover:text-foreground"
                            >
                              <Plus className="h-3.5 w-3.5" aria-hidden />
                              {t("session.ajouterUnMot")}
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-3 gap-2 sm:gap-3">
                          {/* ⚠️ L'ÉTIQUETTE SUIT L'UNITÉ (FRE-42). Sur un exercice
                              tenu au chrono on demandait une DURÉE en affichant
                              « Rép. réelles » : 253 lignes prescrites en secondes,
                              UNE SEULE avec un temps réalisé (14/08). */}
                          <TuileDuReel
                            libelle={t(parSerieOuvert ? "session.champSerie" : "session.champSeul", {
                              champ: auChrono ? t("session.tuileTemps") : t("session.tuileReps"),
                              n: effectiveSet,
                            })}
                            pied={parSerieOuvert && ex.repsDone ? (
                              <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                                {t("session.moyenneCourte", { valeur: ex.repsDone })}
                              </div>
                            ) : undefined}
                          >
                            {athleteEdit ? (
                              <EditCell
                                key={parSerieOuvert ? `reps-${i}-${effectiveSet}` : `reps-${i}`}
                                value={(parSerieOuvert ? repsBySet[effectiveSet - 1] : ex.repsDone) ?? ""}
                                align="left"
                                label={auChrono ? t("session.tempsReel") : t("session.repsReelles")}
                                /* ⚠️ LA PRESCRIPTION RESTE AUSSI EN `placeholder`. La
                                   cible en dur la DOUBLE, elle ne la remplace pas : le
                                   placeholder situe la saisie dans le champ vide, la
                                   cible survit à la frappe. Trois specs du harnais le
                                   tiennent — vues rouges en ne gardant que la cible
                                   (12/09). */
                                placeholder={ex.reps || (auChrono ? "60" : "12")}
                                inputMode={auChrono ? "numeric" : undefined}
                                onCommit={(v) => (parSerieOuvert
                                  ? onUpdateSetValue?.(i, effectiveSet, "reps", v)
                                  : onUpdateField?.(i, "repsDone", v))}
                                className={CLASSE_CHAMP_DU_REEL}
                              />
                            ) : (
                              <ValeurDuReel valeur={ex.repsDone} vide={t("session.aucuneSaisie")} />
                            )}
                          </TuileDuReel>

                          {/* Toujours proposée, verrou ou non : le verrou interdit à
                              l'athlète de changer la CONSIGNE, pas d'en rendre
                              compte. La saisie va dans `weightDone` — écrire dans
                              `weight` détruirait la prescription. */}
                          <TuileDuReel
                            libelle={t(parSerieOuvert ? "session.champSerie" : "session.champSeul", {
                              champ: t("session.tuileCharge"),
                              n: effectiveSet,
                            })}
                            pied={parSerieOuvert && ex.weightDone ? (
                              <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                                {t("session.moyenneCourte", { valeur: ex.weightDone })}
                              </div>
                            ) : undefined}
                          >
                            {athleteEdit ? (
                              <EditCell
                                key={parSerieOuvert ? `charge-${i}-${effectiveSet}` : `charge-${i}`}
                                value={(parSerieOuvert ? chargeBySet[effectiveSet - 1] : ex.weightDone) ?? ""}
                                align="left"
                                label={t("session.chargeReelle")}
                                placeholder={ex.weight || ""}
                                onCommit={(v) => (parSerieOuvert
                                  ? onUpdateSetValue?.(i, effectiveSet, "weight", v)
                                  : onUpdateField?.(i, "weightDone", v))}
                                className={CLASSE_CHAMP_DU_REEL}
                              />
                            ) : (
                              <ValeurDuReel valeur={ex.weightDone} vide={t("session.aucuneSaisie")} />
                            )}
                          </TuileDuReel>

                          {/* ⚠️ TOUJOURS PROPOSÉ, REPOS PRESCRIT OU NON (FRE-42).
                              Mesuré : 4 395 lignes portent un repos prescrit et
                              AUCUNE un réel, faute de case. Le zéro ne disait pas un
                              désintérêt, il disait une impossibilité. */}
                          <TuileDuReel
                            libelle={t("session.tuileRepos")}
                          >
                            {athleteEdit ? (
                              <EditCell
                                value={ex.restActual}
                                align="left"
                                label={t("session.reposReel")}
                                placeholder={hasFreeRest ? "120" : (parseSeconds(ex.rest) > 0 ? String(parseSeconds(ex.rest)) : "")}
                                inputMode="numeric"
                                onCommit={(v) => onUpdateField?.(i, "restActual", v)}
                                className={CLASSE_CHAMP_DU_REEL}
                              />
                            ) : (
                              <ValeurDuReel valeur={ex.restActual} vide={t("session.aucuneSaisie")} />
                            )}
                          </TuileDuReel>
                        </div>
                      </div>

                      {/* ---- LE FEEDBACK, REPLIÉ TANT QU'IL EST VIDE ---- */}
                      {/* ⚠️ Un champ vide de 56 px, présenté comme les trois
                          chiffres, cessait d'être facultatif au moment où
                          l'athlète veut ranger son téléphone (2b). Il devient un
                          bouton, et s'ouvre de lui-même dès qu'il porte du texte. */}
                      {!(athleteEdit && !(feedbackOuvert[exerciseKey] || ex.athleteFeedback)) && (
                      <div className="flex flex-wrap items-center gap-2.5 border-t border-border/70 pt-3 sm:pt-3.5">
                        {(
                          <div className="w-full">
                            <div className="mb-1 flex items-baseline gap-1.5">
                              <span className="font-display text-[11px] uppercase tracking-[0.14em] text-muted-foreground sm:text-[10px]">
                                {t("session.feedbackAthlete")}
                              </span>
                              <span className="font-mono text-[10px] lowercase text-muted-foreground">
                                {t("session.facultatif")}
                              </span>
                            </div>
                            {athleteEdit ? (
                              <NoteArea
                                value={ex.athleteFeedback}
                                placeholder={t("session.commentCaSEst")}
                                onCommit={(v) => onUpdateField(i, "athleteFeedback", v)}
                              />
                            ) : (
                              <p className="rounded-md border border-border bg-card px-2.5 py-2 text-foreground/90">
                                {ex.athleteFeedback || <span className="italic text-muted-foreground">{t("session.aucunRetour")}</span>}
                              </p>
                            )}
                          </div>
                        )}

                      </div>
                      )}
                    </div>

                    {/* ---- CE QU'ON CONSULTE ---- */}
                    <div className="min-w-0">
                      {/* ⚠️ UN SEUL TITRE. La carte porte déjà le sien, avec le
                          delta et le partage ; en poser un second au-dessus
                          faisait lire « SUR CE BLOC » puis « PROGRESSION SUR LE
                          BLOC » à vingt pixels d'écart. C'est le libellé de la
                          colonne qu'on passe à la carte. */}
                      {blockWeeks && blockWeeks.length >= 1 ? (
                        <ExerciseProgression session={session} exerciseIndex={i} blockWeeks={blockWeeks}
                                             shareBlock={shareBlock} titre={t("session.surCeBloc")} />
                      ) : (
                        <>
                          <div className="mb-2 font-display text-[11px] uppercase tracking-[0.14em] text-muted-foreground sm:text-[10px]">
                            {t("session.surCeBloc")}
                          </div>
                          <p className="rounded-md border border-dashed border-border px-2.5 py-3 text-center text-[11px] italic text-muted-foreground">
                            {t("session.aucuneSaisie")}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {/* LE TALON FERME LE TOUR (2a) : c'est là qu'a lieu le repos, donc
                  là que l'athlète regarde avant de repartir. Sur un AMRAP, il
                  porte les TOURS BOUCLÉS — la saisie descend au pied du groupe,
                  sous les lignes qu'elle résume. */}
              {fermeLeGroupe && (natureDuGroupe === "amrap" ? (
                <div className="flex items-center gap-2 px-3 pb-2 pt-1.5">
                  <span className="h-[3px] w-3 bg-metric" aria-hidden />
                  <span className="font-display text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    {t("session.toursBoucles")}
                  </span>
                  {athleteEdit ? (
                    <span className="ml-auto flex items-center gap-1.5">
                      <button type="button" aria-label="−"
                        disabled={!ex.toursRealises}
                        onClick={() => onUpdateField!(i, "toursRealises", ex.toursRealises ? ex.toursRealises - 1 : null)}
                        className="flex h-9 w-9 items-center justify-center rounded-md border border-border font-mono text-base text-foreground hover:border-gold/35 disabled:text-muted-foreground">−</button>
                      <span className="w-8 text-center font-mono text-lg font-semibold text-gold" aria-label={t("session.toursRealises")}>
                        {ex.toursRealises ?? "—"}
                      </span>
                      <button type="button" aria-label="+"
                        onClick={() => onUpdateField!(i, "toursRealises", (ex.toursRealises ?? 0) + 1)}
                        className="flex h-9 w-9 items-center justify-center rounded-md border border-gold/35 font-mono text-base text-gold hover:bg-gold/15">+</button>
                    </span>
                  ) : (
                    <span className="font-mono text-base font-semibold text-gold">{ex.toursRealises ?? "—"}</span>
                  )}
                </div>
              ) : talonDuGroupe(natureDuGroupe, ex, leReposSeSaisit(natureDuGroupe) && !hasFreeRest && ex.rest ? formatRest(ex.rest) : "") && (
                <div className="flex items-center gap-2 px-3 pb-2 pt-1.5">
                  <span className={cn("h-[3px] w-3", natureDuGroupe === "emom" ? "bg-metric" : "bg-gold/70")} aria-hidden />
                  <span className="font-display text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    {talonDuGroupe(natureDuGroupe, ex, leReposSeSaisit(natureDuGroupe) && !hasFreeRest && ex.rest ? formatRest(ex.rest) : "")}
                  </span>
                </div>
              ))}
            </Fragment>
            );
          })}
        </div>
      </div>
    );
  }

  // Une séance ENTIÈRE d'échauffement est le cas courant (les coachs veulent
  // des séances UPPER / LOWER) : marquer dix lignes une par une serait pénible.
  // Le bouton bascule vers la nature MAJORITAIRE inverse, pour servir aussi de
  // retour arrière sans second contrôle.
  const toutEnEchauffement = session.exercises.length > 0
    && session.exercises.every(ex => ex.kind === "warmup");

  /* ⚠️ UNE SEULE DES DEUX VUES DU COACH EST RENDUE (brief coach, 27/09) : le
     tableau à colonnes essentielles dès `lg` (1024 px — une tablette en
     paysage le tient, c'est la réponse à la question ouverte n° 1 du brief),
     les cartes avec leur stepper en dessous. Rendre les deux et en cacher une
     doublerait chaque champ dans le DOM, et les specs cliqueraient l'invisible. */
  return (
    <div>
      {onSetSessionKind && session.exercises.length > 0 && (
        <div className="flex justify-end border-b border-border/60 px-3 py-1.5">
          <button
            type="button"
            onClick={() => onSetSessionKind(toutEnEchauffement ? "training" : "warmup")}
            className={cn(
              "rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
              toutEnEchauffement
                ? "border-gold/35 bg-gold/10 text-gold"
                : "border-border text-muted-foreground hover:border-gold/40 hover:text-foreground",
            )}
          >
            {toutEnEchauffement ? t("session.repasserEnEntrainement") : t("session.touteEnEchauffement")}
          </button>
        </div>
      )}
      {grandEcran
        ? <TableauCoach {...props} onUpdateField={onUpdateField} />
        : <CartesCoach {...props} onUpdateField={onUpdateField} />}
    </div>
  );
}
