import { useEffect, useRef, useState } from "react";
import type { NatureDeGroupe } from "@/lib/groupe";
import { Calendar, Check, ChevronDown, ChevronUp, Dumbbell, Pencil, Trash2, Plus, X } from "lucide-react";
import type { ExerciseKind, ObjectifTechnique, SessionEditing, WeekEditing } from "@/api/types";
import { formatLong, todayISO } from "@/lib/dates-ui";
import { sessionTonnage, formatKg } from "@/lib/tonnage";
import { avancementDeLaSeance, seanceAOuvrir, seanceEstCompletee } from "@/lib/realise";
import { lireSeanceEnCours, noterSeanceEnCours } from "@/lib/seance-en-cours";
import { couleurDeLEcart, ecartDeLaSeance, formatAverageRPE, rpeDotColor, sessionAverageRPE } from "@/lib/rpe";
import { SessionTable } from "./session-table";
import { WeekOverview } from "./week-overview";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ShareSessionDialog } from "@/components/training/share-session-dialog";
import { useTranslation } from 'react-i18next';
import { ligneGlissee, porteUneLigne } from '@/lib/deplacement-de-ligne';

type AthleteViewMode = "detailed" | "simple";
const VIEW_MODE_KEY = "ff-athlete-view-mode";

interface Props {
  week: WeekEditing;
  /** La séance à ouvrir d'emblée — le guichet y mène par l'URL (`?session=`).
   *  Sans elle, la vue choisit celle du jour. */
  sessionInitiale?: string | null;
  mode?: "athlete" | "coach";
  allowCoachMode?: boolean;
  canEditSelectedAthlete?: boolean;
  storageScopeKey?: string;
  onFeltRPEChange?: (id: string, exerciseIndex: number, feltRPE: string) => void;
  onFeltRPEGlobal?: (id: string, exerciseIndex: number, feltRPE: string) => void;
  onUpdateSetRPE?: (id: string, exerciseIndex: number, setIndex: number, value: string | null) => void;
  onUpdateSetValue?: (id: string, exerciseIndex: number, setIndex: number,
                      champ: 'reps' | 'weight', value: string | null) => void;
  onUpdateForm?: (id: string, value: number | null) => void;
  onUpdateField?: (id: string, exerciseIndex: number, field: string, value: string | string[] | boolean | number | null) => void;
  onSetExerciseKind?: (id: string, exerciseIndex: number, kind: ExerciseKind) => void;
  onSetSessionKind?: (id: string, kind: ExerciseKind) => void;
  onAddExercise?: (id: string) => void;
  onRemoveExercise?: (id: string, exerciseIndex: number) => void;
  /** Rend l'identité de la copie, où poser le curseur (Passe 3, constat 05). */
  onDuplicateExercise?: (id: string, exerciseIndex: number) => Promise<string | null>;
  onMoveExercise?: (id: string, from: number, to: number) => void;
  /** D'une séance à une autre de la semaine (FRE-188) : ids de séance, rangs. */
  onMoveExerciseToSession?: (fromId: string, fromIdx: number, toId: string, toIdx: number) => void;
  onToggleGroup?: (id: string, exerciseIndex: number) => void;
  onSetGroupKind?: (id: string, exerciseIndex: number, nature: NatureDeGroupe) => void;
  /** Réordonne les séances de la semaine. Absent ⇒ aucune affordance affichée. */
  onMoveSession?: (from: number, to: number) => void;
  onRenameSession?: (id: string, name: string) => void;
  onDeleteSession?: (id: string) => void;
  nameOptions?: string[];
  /** Objectifs techniques ouverts, par mouvement normalisé (FRE-122). */
  objectifsParMouvement?: ReadonlyMap<string, ObjectifTechnique[]>;
  variantOptions?: string[];
  assistanceOptions?: string[];
  tempoOptions?: string[];
  /** Toutes les semaines du bloc — pour la mini progression par exercice. */
  blockWeeks?: WeekEditing[];
  /** Partage de séance : nom imprimé sur l'image générée. */
  athleteName?: string;
  /** Situe la séance sur l'image de partage (bandeau). */
  shareContext?: string;
  /** Bloc seul — bandeau de l'image de progression d'un exercice. */
  shareBlock?: string;
}

export function WeekView({ week, sessionInitiale, mode = "athlete", allowCoachMode = false, canEditSelectedAthlete = false, storageScopeKey, athleteName, shareContext, shareBlock, onFeltRPEChange, onFeltRPEGlobal, onUpdateSetRPE, onUpdateSetValue, onUpdateForm, onUpdateField, onSetExerciseKind, onSetSessionKind, onAddExercise, onRemoveExercise, onDuplicateExercise, onMoveExercise, onMoveExerciseToSession, onToggleGroup, onSetGroupKind, onMoveSession, onRenameSession, onDeleteSession, nameOptions, objectifsParMouvement, variantOptions, assistanceOptions, tempoOptions, blockWeeks }: Props) {
  const { t } = useTranslation();
  // Athlète : accordéon (une seule séance ouverte). Coach : tout déplié par
  // défaut pour une vue d'ensemble (comme le legacy), chaque séance restant
  // repliable individuellement → on suit les séances explicitement REPLIÉES.
  // Séance en cours de glissement (null = aucune). Même mécanique que le
  // réordonnancement d'exercices dans `session-table`.
  const [dragSessionIdx, setDragSessionIdx] = useState<number | null>(null);
  const viewModeKey = `${VIEW_MODE_KEY}:${storageScopeKey || "global"}`;
  const [viewMode, setViewModeState] = useState<AthleteViewMode>(() => {
    if (typeof window === "undefined") return "detailed";
    return window.localStorage.getItem(viewModeKey) === "simple" ? "simple" : "detailed";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    setViewModeState(window.localStorage.getItem(viewModeKey) === "simple" ? "simple" : "detailed");
  }, [viewModeKey]);
  /* L'échelle de la barre de tonnage : le plus gros jour de LA semaine. Sur une
     semaine sans tonnage, elle vaut 0 et aucune barre ne se dessine — une barre
     pleine partout ne comparerait rien. */
  const tonnageMax = Math.max(0, ...(week.sessions ?? []).map(sessionTonnage));
  const seancesDeLaSemaine = week.sessions ?? [];
  /* ⚠️ CE QUI EST OUVERT À L'ARRIVÉE. La séance du JOUR si l'une d'elles est
     datée d'aujourd'hui, sinon la première : l'écran s'ouvrait auparavant sur
     rien, et le jour courant se trouvait en bas de la pile, sous les séances
     déjà faites. La date sert ici quand elle existe, et son absence ne casse
     rien — c'est tout l'objet du bandeau. */
  /* Ce que l'utilisateur a choisi dans le bandeau ; `null` = rien encore, et
     c'est alors le défaut qui décide. */
  const [seanceChoisie, setSeanceChoisie] = useState<string | null>(sessionInitiale ?? null);
  const refBandeau = useRef<HTMLDivElement>(null);
  // La règle vit dans `seanceAOuvrir` (lib/realise), avec ses specs.
  //
  // ⚠️ ELLE SE DÉCIDE À L'ARRIVÉE DANS LA SEMAINE, PUIS NE BOUGE PLUS. La règle
  // lit les traces : recalculée à chaque rendu, noter un RPE dans la séance
  // ouverte lui donnait une trace, et l'écran sautait à la suivante sous le
  // doigt, pli compris (`chrono`, `saisie-par-frequence` le gardent).
  const calculee = seanceAOuvrir(seancesDeLaSemaine, todayISO(), lireSeanceEnCours(week.id))?.id ?? null;
  const [ouverture, setOuverture] = useState({ semaine: week.id, seance: calculee });
  // Figée seulement si elle est de CETTE semaine et y existe encore.
  const figee = ouverture.semaine === week.id && seancesDeLaSemaine.some(x => x.id === ouverture.seance)
    ? ouverture.seance : null;
  if (figee === null && (ouverture.semaine !== week.id || ouverture.seance !== calculee)) {
    setOuverture({ semaine: week.id, seance: calculee });
  }
  const seanceParDefaut = figee ?? calculee;
  const isAthlete = mode === "athlete";
  const effectiveMode = allowCoachMode ? mode : "athlete";


  /* ⚠️ UNE SEULE SÉANCE À L'ÉCRAN, DANS LES DEUX MODES (William, 12/09). La
     cascade obligeait à faire défiler quatre séances terminées pour atteindre
     celle du jour — sur l'écran qu'on ouvre justement pour saisir. Le bandeau la
     rend inutile.

     ⚠️ ET C'EST CE QUI DONNE UN SENS AU CLIC CÔTÉ COACH. Tant que les quatre
     séances restaient empilées, choisir dans le bandeau ne faisait rien de
     visible : sept boutons qui se coloraient au-dessus d'une liste inchangée.
     Une affordance qui n'agit pas est pire que pas d'affordance.

     L'INDEX D'ORIGINE voyage avec la séance : `SessionCard` s'en sert pour la
     monter et la descendre dans la semaine, et un index recalculé sur une liste
     filtrée réordonnerait la mauvaise. Le filtrage porte sur ce qu'on AFFICHE,
     jamais sur ce qui identifie. */
  const seanceAffichee = seanceChoisie ?? seanceParDefaut;
  // ⚠️ LE COACH VOIT TOUTE LA SEMAINE, DÉPILÉE (FRE-180, William, 16/09) : il la
  // relit d'un bout à l'autre, et le bandeau devient un RACCOURCI qui fait
  // défiler jusqu'au jour. L'ATHLÈTE garde une séance à la fois — c'est pour lui
  // que la cascade avait été retirée le 12/09, et sa raison tient toujours.
  const toutLaSemaine = effectiveMode === "coach";
  const seancesAffichees = (week.sessions ?? [])
    .map((seance, index) => ({ seance, index }))
    .filter(({ seance }) => toutLaSemaine || (seance.id ?? "") === seanceAffichee);
  const refSeances = useRef<HTMLDivElement>(null);
  /** ⚠️ IL N'Y A PLUS DE REPLI, ET C'EST LE BANDEAU QUI L'A RENDU INUTILE
   *  (William, 12/09 : « le collapsible ne sert plus à rien, il reste juste un
   *  clic sans plus-value »). Replier la seule séance affichée ne laissait qu'un
   *  en-tête au-dessus du vide : l'accordéon servait à choisir PARMI plusieurs,
   *  et ce choix se fait maintenant au-dessus. Un geste qui ne mène nulle part
   *  n'a pas à rester parce qu'il existait.
   *
   *  Partent avec lui : `openId`, `collapsedIds` et `toggleSession`. */
  const ouvrirLaSeance = (id: string) => {
    setSeanceChoisie(id);
    noterSeanceEnCours(week.id, id);
    if (toutLaSemaine) {
      // Côté coach, toutes les séances sont là : on descend jusqu'au jour cliqué.
      requestAnimationFrame(() => {
        const doux = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        refSeances.current?.querySelector<HTMLElement>(`[data-seance-id="${CSS.escape(id)}"]`)
          ?.scrollIntoView({ behavior: doux ? 'smooth' : 'auto', block: 'start' });
      });
      return;
    }
    /* ⚠️ ON REMONTE SUR LE BANDEAU, PAS SUR LA SÉANCE. Choisir depuis le bas de
       la page laissait la séance à demi sortie de l'écran — « le bas est
       légèrement coupé » (William, 12/09) : le bandeau restait où il était, et
       la carte s'ouvrait sous la ligne de flottaison.

       C'est le bandeau qu'on aligne en haut, et non la carte : les deux se
       lisent ensemble — on choisit, on voit ce qu'on a choisi — et remonter la
       carte seule ferait disparaître le sélecteur qu'on vient d'utiliser.

       Après le rendu, sinon on mesure la position d'AVANT le changement de
       séance. Et sans animation si l'utilisateur n'en veut pas : la règle vaut
       pour le défilement comme pour le reste. */
    requestAnimationFrame(() => {
      const doux = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      refBandeau.current?.scrollIntoView({ behavior: doux ? 'smooth' : 'auto', block: 'start' });
    });
  };

  const setViewMode = (nextMode: AthleteViewMode) => {
    setViewModeState(nextMode);
    try {
      window.localStorage.setItem(viewModeKey, nextMode);
    } catch {
      // UI preference only.
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* ⚠️ L'EN-TÊTE DE SEMAINE N'EST PLUS ICI (1b, 13/09). Il vit dans la carte
          `EnteteDuProgramme`, avec la navigation qui le désigne : il arrivait
          quatrième sous deux cartes d'objectifs et une barre. La vue démarre
          donc sur la bascule Aperçu/Détail, puis le bandeau des séances. */}
      {isAthlete && (
        <div className="inline-flex w-fit items-center gap-1 rounded-full border border-border bg-card p-1">
          <button
            type="button"
            aria-pressed={viewMode === "simple"}
            onClick={() => setViewMode("simple")}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              viewMode === "simple" ? "bg-gold text-gold-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("common.overview")}
          </button>
          <button
            type="button"
            aria-pressed={viewMode === "detailed"}
            onClick={() => setViewMode("detailed")}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              viewMode === "detailed" ? "bg-gold text-gold-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("common.detail")}
          </button>
        </div>
      )}

      {/* ⚠️ CHOISIR DOIT FAIRE QUELQUE CHOSE : le bandeau OUVRE la séance, il ne
          se contente pas de se colorer. Et côté ATHLÈTE il la montre SEULE — la
          cascade des autres séances n'a plus d'objet une fois qu'un sélecteur
          existe au-dessus (décision de William, 12/09). Le coach, lui, garde sa
          semaine entière : son besoin est la vue d'ensemble, pas la saisie. */}
      {/* La marge de défilement : l'en-tête de l'application est COLLANTE. Sans
          elle, `scrollIntoView` glisse le bandeau juste dessous — c'est-à-dire
          caché par elle. ⚠️ BARRE D'ÉTAT COMPRISE : sur iPhone, l'en-tête la peint
          et mesure 56 px de plus qu'elle ; `scroll-mt-20` seul (80 px) laissait le
          bandeau passer dessous. */}
      <div ref={refBandeau} className="scroll-mt-[calc(5rem+env(safe-area-inset-top))]">
      {effectiveMode === "athlete" && viewMode === "simple" ? null : (
        <BandeauDesSeances
          seances={seancesDeLaSemaine}
          ouverte={seanceAffichee}
          onChoisir={ouvrirLaSeance}
        />
      )}
      </div>

      {effectiveMode === "athlete" && viewMode === "simple" ? (
        <WeekOverview week={week} />
      ) : (
        <div ref={refSeances} className="flex flex-col gap-2">
          {seancesAffichees.map(({ seance: s, index: si }) => (
            /* La marge de défilement : l'en-tête collant de l'app, barre d'état
               comprise — la même que celle du bandeau. */
            <div key={s.id} data-seance-id={s.id ?? ""} className="scroll-mt-[calc(5rem+env(safe-area-inset-top))]">
            <SessionCard
              session={s}
              index={si}
              sessionCount={(week.sessions ?? []).length}
              tonnageMax={tonnageMax}
              onMove={onMoveSession}
              dragIdx={dragSessionIdx}
              setDragIdx={setDragSessionIdx}
              mode={effectiveMode}
              // Noter, c'est être dans cette séance : on la retient (`seance-en-cours`).
              onFeltRPEChange={(idx, v) => { noterSeanceEnCours(week.id, s.id ?? ""); onFeltRPEChange?.(s.id ?? "", idx, v); }}
              onFeltRPEGlobal={(idx, v) => { noterSeanceEnCours(week.id, s.id ?? ""); onFeltRPEGlobal?.(s.id ?? "", idx, v); }}
              onUpdateSetRPE={onUpdateSetRPE ? (idx, set, v) => { noterSeanceEnCours(week.id, s.id ?? ""); onUpdateSetRPE(s.id ?? "", idx, set, v); } : undefined}
              onUpdateSetValue={onUpdateSetValue ? (idx, set, champ, v) => { noterSeanceEnCours(week.id, s.id ?? ""); onUpdateSetValue(s.id ?? "", idx, set, champ, v); } : undefined}
              onUpdateForm={onUpdateForm ? (v) => onUpdateForm(s.id ?? "", v) : undefined}
              onUpdateField={(idx, field, value) => onUpdateField?.(s.id ?? "", idx, field, value)}
              onSetExerciseKind={onSetExerciseKind ? (idx, kind) => onSetExerciseKind(s.id ?? "", idx, kind) : undefined}
              onSetSessionKind={onSetSessionKind ? kind => onSetSessionKind(s.id ?? "", kind) : undefined}
              onAddExercise={onAddExercise ? () => onAddExercise(s.id ?? "") : undefined}
              onRemoveExercise={onRemoveExercise ? (idx) => onRemoveExercise(s.id ?? "", idx) : undefined}
              onDuplicateExercise={onDuplicateExercise ? (idx) => onDuplicateExercise(s.id ?? "", idx) : undefined}
              onMoveExercise={onMoveExercise ? (from, to) => onMoveExercise(s.id ?? "", from, to) : undefined}
              onMoveExerciseToSession={onMoveExerciseToSession ? (fromId, fromIdx, toIdx) => onMoveExerciseToSession(fromId, fromIdx, s.id ?? "", toIdx) : undefined}
              // « Déplacer vers… » au téléphone : la ligne part en FIN de l'autre séance (FRE-188).
              autresSeances={(week.sessions ?? []).filter(o => o.id && o.id !== s.id).map(o => ({ id: o.id!, name: o.name }))}
              onMoveExerciseTo={onMoveExerciseToSession ? (ei, toId) => onMoveExerciseToSession(
                s.id ?? "", ei, toId, (week.sessions ?? []).find(o => o.id === toId)?.exercises.length ?? 0) : undefined}
              onToggleGroup={onToggleGroup ? (idx) => onToggleGroup(s.id ?? "", idx) : undefined}
              onSetGroupKind={onSetGroupKind ? (idx, nature) => onSetGroupKind(s.id ?? "", idx, nature) : undefined}
              onRename={onRenameSession ? (name) => onRenameSession(s.id ?? "", name) : undefined}
              onDelete={onDeleteSession ? () => onDeleteSession(s.id ?? "") : undefined}
              nameOptions={nameOptions}
              objectifsParMouvement={objectifsParMouvement}
              variantOptions={variantOptions}
              assistanceOptions={assistanceOptions}
              tempoOptions={tempoOptions}
              blockWeeks={blockWeeks}
              storageScopeKey={storageScopeKey}
              canEditSelectedAthlete={canEditSelectedAthlete}
              athleteName={athleteName}
              shareContext={shareContext}
              shareBlock={shareBlock}
            />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** LE BANDEAU DES SÉANCES DE LA SEMAINE (refonte des écrans, 09/2026).
 *
 *  ⚠️ IL NE DÉPEND D'AUCUNE DATE, et c'est une décision de William (12/09) après
 *  avoir vu la première version à l'écran : « peu importe le nom, juste pouvoir
 *  les sélectionner dans un bandeau ».
 *
 *  La version précédente posait SEPT JOURS DATÉS, lundi → dimanche. Elle était
 *  juste sur le papier et muette en pratique : mesuré en production le 12/09,
 *  746 séances datées sur 2 718, et 67 semaines sur 621 où la grille aurait eu
 *  un sens. Sur la semaine de William — cinq séances nommées « Lundi », « Mardi »,
 *  « Mercredi »… — elle ne s'affichait pas du tout, puisque le jour vit dans le
 *  NOM et pas dans `session_date`.
 *
 *  Le bandeau ne demande donc rien à la donnée qu'elle n'ait déjà : une séance,
 *  son nom, ce qui y est fait, son RPE moyen. Il marche sur 100 % des semaines.
 *
 *  ⚠️ UNE SEULE MARQUE COLORÉE PAR CELLULE. La première version en portait deux —
 *  un point d'ÉCART (cible↔ressenti) et une pastille de RPE ABSOLU — au même
 *  barème de couleurs, pour une seule question ; elles pouvaient se contredire.
 *  C'est la pastille qui reste, parce qu'elle porte aussi le chiffre. */
function BandeauDesSeances({ seances, ouverte, onChoisir }: {
  seances: SessionEditing[];
  ouverte: string | null;
  onChoisir: (id: string) => void;
}) {
  // Une seule séance : le bandeau ne choisirait rien, il ferait un doublon du
  // titre juste en dessous.
  if (seances.length < 2) return null;
  return (
    /* ⚠️ AU POINTEUR IL DÉFILE PLUTÔT QU'IL NE SE SERRE. Une semaine porte deux
       à six séances ; à sept cellules fixes sur 390 px, chacune tomberait sous
       la largeur d'un nom. `snap` pour que le défilement s'arrête sur une
       cellule entière, `[scrollbar-width:none]` parce qu'une barre de défilement
       de 15 px sous une rangée de 60 la déséquilibre.

       ⚠️ SOUS 640 PX, UNE GRILLE DE TROIS COLONNES, et rien de caché (retour
       utilisateur, 12/09 : « les jours à partir de 4 pareil »). Six séances
       tiennent en deux rangées, la cellule garde la largeur qui lui manquait.
       On perd la lecture de l'ordre « d'un trait » ; on ne perd plus une séance
       à droite. À deux séances la troisième colonne reste vide : une cellule
       étirée à côté d'une normale se lirait comme une différence d'importance. */
    <div className="grid grid-cols-3 gap-1.5 sm:-mx-1 sm:flex sm:snap-x sm:overflow-x-auto sm:px-1 sm:pb-1
                    sm:[scrollbar-width:none] sm:[&::-webkit-scrollbar]:hidden">
      {seances.map((s) => {
        const id = s.id ?? '';
        const active = id === ouverte;
        const moyenne = sessionAverageRPE(s);
        const faits = avancementDeLaSeance(s).faites;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChoisir(id)}
            aria-current={active ? 'true' : undefined}
            className={cn(
              'flex min-h-[56px] min-w-0 flex-col items-start justify-between gap-1 rounded-lg border px-2 py-1.5 text-left transition-colors sm:w-28 sm:shrink-0 sm:snap-start',
              active ? 'border-gold/60 bg-gold/5' : 'border-border bg-card hover:border-gold/35',
            )}
            title={s.name}
          >
            {/* ⚠️ UNE SEULE MARQUE COLORÉE PAR CELLULE (William, 12/09). Un point
                d'écart cible↔ressenti vivait ici, au-dessus d'une pastille de RPE
                absolu déjà colorée au même barème : deux taches de couleur pour
                une seule question, et elles pouvaient se contredire — une séance
                tenue à 9 sur une cible de 9 donnait un point vert sous un badge
                rouge. La pastille reste, elle porte le chiffre. */}
            <span className={cn('w-full truncate text-[11px] font-semibold',
                                active ? 'text-foreground' : 'text-muted-foreground')}>
              {s.name}
            </span>
            {/* ⚠️ LE RPE, PLUS LE TONNAGE (William, 12/09). Un badge de 28 px de
                haut ne porte qu'un chiffre, et entre les deux c'est le ressenti
                qu'on vient lire : le tonnage dit ce que la séance PESAIT, le RPE
                ce qu'elle a COÛTÉ. Le tonnage reste dans l'en-tête de la séance
                affichée, avec sa barre de comparaison.

                ⚠️ ET IL PORTE SA COULEUR (William, 12/09). Un 6 et un 9 écrits
                pareil demandent de les LIRE pour les comparer ; le barème
                vert→ambre→rouge est déjà la convention de l'app partout
                ailleurs, et une rangée de badges est exactement l'endroit où
                l'on balaie sans lire. */}
            <span className="flex w-full items-center justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
              <span>{faits}/{s.exercises.length}</span>
              {moyenne !== null ? (
                <span className="rounded px-1.5 py-0.5 font-semibold text-gold-foreground"
                      style={{ backgroundColor: rpeDotColor(String(moyenne)) }}>
                  {formatAverageRPE(moyenne)}
                </span>
              ) : (
                /* Pas de pastille sans ressenti : un fond neutre se lirait comme
                   une valeur, et « rien noté » n'est pas un degré d'effort. */
                <span className="px-1.5 text-muted-foreground/60">—</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SessionCard({
  session,
  index,
  sessionCount,
  tonnageMax,
  onMove,
  dragIdx,
  setDragIdx,
  mode,
  onFeltRPEChange,
  onFeltRPEGlobal,
  onUpdateSetRPE,
  onUpdateSetValue,
  onUpdateForm,
  onUpdateField,
  onSetExerciseKind,
  onSetSessionKind,
  onAddExercise,
  onRemoveExercise,
  onDuplicateExercise,
  onMoveExercise,
  onMoveExerciseToSession,
  autresSeances,
  onMoveExerciseTo,
  onToggleGroup,
  onSetGroupKind,
  onRename,
  onDelete,
  nameOptions,
  objectifsParMouvement,
  variantOptions,
  assistanceOptions,
  tempoOptions,
  blockWeeks,
  storageScopeKey,
  canEditSelectedAthlete,
  athleteName,
  shareContext,
  shareBlock,
}: {
  session: SessionEditing;
  mode: "athlete" | "coach";
  onFeltRPEChange: (idx: number, v: string) => void;
  onFeltRPEGlobal: (idx: number, v: string) => void;
  onUpdateSetRPE?: (idx: number, setIndex: number, value: string | null) => void;
  onUpdateSetValue?: (idx: number, setIndex: number, champ: 'reps' | 'weight', value: string | null) => void;
  onUpdateForm?: (v: number | null) => void;
  onUpdateField?: (idx: number, field: string, value: string | string[] | boolean | number | null) => void;
  onSetExerciseKind?: (idx: number, kind: ExerciseKind) => void;
  onSetSessionKind?: (kind: ExerciseKind) => void;
  onAddExercise?: () => void;
  onRemoveExercise?: (idx: number) => void;
  onDuplicateExercise?: (idx: number) => Promise<string | null>;
  onMoveExercise?: (from: number, to: number) => void;
  /** Une ligne venue d'une AUTRE séance, posée au rang `toIdx` (FRE-188). */
  onMoveExerciseToSession?: (fromId: string, fromIdx: number, toIdx: number) => void;
  autresSeances?: { id: string; name: string }[];
  onMoveExerciseTo?: (ei: number, toSessionId: string) => void;
  onToggleGroup?: (idx: number) => void;
  onSetGroupKind?: (idx: number, nature: NatureDeGroupe) => void;
  index: number;
  sessionCount: number;
  /** Le tonnage du plus gros jour de la semaine — l'échelle de la barre. */
  tonnageMax: number;
  /** Absent ⇒ séance non déplaçable (athlète, ou writer non fourni). */
  onMove?: (from: number, to: number) => void;
  dragIdx: number | null;
  setDragIdx: (i: number | null) => void;
  onRename?: (name: string) => void;
  onDelete?: () => void;
  nameOptions?: string[];
  /** Objectifs techniques ouverts, par mouvement normalisé (FRE-122). */
  objectifsParMouvement?: ReadonlyMap<string, ObjectifTechnique[]>;
  variantOptions?: string[];
  assistanceOptions?: string[];
  tempoOptions?: string[];
  blockWeeks?: WeekEditing[];
  storageScopeKey?: string;
  canEditSelectedAthlete?: boolean;
  /** Partage de séance : nom affiché sur l'image générée. */
  athleteName?: string;
  /** Situe la séance sur l'image de partage (bandeau). */
  shareContext?: string;
  /** Bloc seul — bandeau de l'image de progression d'un exercice. */
  shareBlock?: string;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  // Renommage EN LIGNE : `window.prompt` était bloquant, hors charte, et
  // invisible sur mobile en PWA. `null` = pas d'édition en cours.
  const [renaming, setRenaming] = useState<string | null>(null);
  const commitRename = () => {
    const name = (renaming ?? "").trim();
    if (name && name !== session.name) onRename?.(name);
    setRenaming(null);
  };
  const ton = sessionTonnage(session);
  /* ⚠️ QUATRE NOMBRES ALIGNÉS NE SE COMPARENT QU'EN LES LISANT UN PAR UN. La
     barre les met à l'échelle du plus gros jour de la semaine : on voit d'un
     regard lequel pèse, et de combien. Pur calcul de vue — aucune donnée
     nouvelle (§5.3). */
  const partTonnage = tonnageMax > 0 ? Math.round((ton / tonnageMax) * 100) : 0;
  const averageRPE = sessionAverageRPE(session);
  const { faites: done, total } = avancementDeLaSeance(session);
  const complete = seanceEstCompletee(session);
  const coachEdit = mode === "coach" && !!onAddExercise;
  const completion = total > 0 ? Math.round((done / total) * 100) : 0;
  /* ⚠️ LA PASTILLE DIT L'ÉCART, PLUS LA VALEUR (refonte des écrans, 09/2026). Elle venait de
     `rpeDotColor(averageRPE)` — correct, mais ce barème ne connaît que la valeur
     ABSOLUE : tout ce qui est sous 7,5 est vert. Un athlète qui tourne à 5,8
     voyait donc une semaine uniformément verte, c'est-à-dire sans information.
     Ce qui renseigne, c'est l'écart au VISÉ, et la règle vit dans `@/lib/rpe`,
     où le tableau du bloc l'interroge aussi. */
  const ecart = ecartDeLaSeance(session);
  const couleurEcart = couleurDeLEcart(ecart);
  const accentColor = couleurEcart ?? (complete ? "var(--success)" : "var(--border)");
  const movable = coachEdit && !!onMove;
  return (
    <div
      draggable={movable}
      // Les lignes d'exercices sont elles aussi déplaçables, À L'INTÉRIEUR de
      // cette carte, et `dragstart` remonte. Sans ce garde-fou, glisser un
      // exercice marquait AUSSI sa séance comme en cours de déplacement : la
      // lâcher sur une autre séance réordonnait les séances au lieu de bouger
      // l'exercice — et ça partait en base. `e.target` est l'élément
      // draggable qui a initié le glissement : s'il n'est pas cette carte,
      // l'événement vient d'un enfant et ne nous concerne pas.
      onDragStart={e => {
        if (e.target !== e.currentTarget) return;
        if (movable) setDragIdx(index);
      }}
      onDragEnd={() => setDragIdx(null)}
      // La carte accepte aussi une LIGNE venue d'une autre séance : posée hors
      // des lignes (séance vide, ou sous la dernière), elle va en fin (FRE-188).
      onDragOver={e => {
        if ((movable && dragIdx !== null) || (coachEdit && !!onMoveExerciseToSession && porteUneLigne(e.dataTransfer))) e.preventDefault();
      }}
      onDrop={e => {
        if (movable && dragIdx !== null) {
          if (dragIdx !== index) onMove?.(dragIdx, index);
          setDragIdx(null);
          return;
        }
        const venue = ligneGlissee(e.dataTransfer);
        if (coachEdit && venue && venue.sessionId !== session.id) {
          onMoveExerciseToSession?.(venue.sessionId, venue.index, session.exercises.length);
        }
      }}
      className={cn(
        "overflow-hidden rounded-lg border border-gold/35 bg-card transition-colors",
        dragIdx === index && "opacity-40",
      )}
      style={{ boxShadow: `inset 4px 0 0 ${accentColor}` }}
    >
      <div className="flex items-center gap-1 pr-3">
        {renaming !== null ? (
          <div className="flex flex-1 items-center gap-1.5 py-2 pl-3">
            <Input
              value={renaming}
              onChange={e => setRenaming(e.target.value)}
              placeholder={t("misc.renameSession")}
              className="h-8 flex-1 text-sm"
              autoFocus
              onKeyDown={e => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setRenaming(null);
              }}
            />
            <button
              type="button" title={t("common.validate")} onClick={commitRename}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-success hover:bg-success/15"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              type="button" title={t("common.cancel")} onClick={() => setRenaming(null)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <>
        {/* ⚠️ UN `div`, PLUS UN BOUTON. Il basculait le repli ; sans repli il ne
            faisait plus rien, et un bouton qui ne fait rien se clique quand
            même — c'est pire qu'un texte. */}
        <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left">
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background/55 ring-1 ring-border/80",
              complete ? "text-success" : "text-muted-foreground",
            )}
            style={averageRPE !== null ? { color: accentColor } : undefined}
          >
            <Dumbbell className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="truncate text-sm font-semibold">{session.name}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {done}/{total} {t("session.exos")}
              </span>
              {/* LE TROU DE SAISIE QUI COMPTE (FRE-160) : du travail noté sans
                  ressenti, donc invisible au suivi et aux records. Compté par
                  le serveur avec la règle de `records.py` — l'écran ne la
                  connaît pas. Muet à zéro : 124 lignes sur 15 575, l'immense
                  majorité des séances n'a rien à dire, et c'est la condition
                  pour que le compteur reste lu. */}
              {session.lignesSansRessenti > 0 && (
                <span className="text-[10px] uppercase tracking-wider text-[var(--warning)]"
                      title={t("session.sansRessentiAide")}>
                  · {t("session.sansRessenti", { count: session.lignesSansRessenti })}
                </span>
              )}
            </div>
            <div className="mt-1 h-1.5 max-w-32 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${completion}%`, background: accentColor }} />
            </div>
            {session.sessionDate && (
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Calendar className="h-3 w-3" />
                {formatLong(session.sessionDate)}
              </div>
            )}
          </div>
          <div className="hidden shrink-0 grid-cols-2 gap-4 text-right sm:grid">
            <div>
              <div className="font-mono text-xs font-semibold tabular-nums text-gold">{formatKg(ton)}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("week.tonnageUnit")}</div>
              {/* ⚠️ LE TONNAGE SE COMPARE (refonte des écrans, 09/2026). Quatre nombres alignés ne se
                  lisent qu'un par un ; la barre les met à l'échelle du plus gros
                  jour de la semaine, et l'écart se voit sans être calculé. */}
              {tonnageMax > 0 && (
                <div className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-gold/70" style={{ width: `${partTonnage}%` }} />
                </div>
              )}
            </div>
            <div>
              <div className="font-mono text-xs font-semibold tabular-nums" style={averageRPE !== null ? { color: accentColor } : undefined}>
                {formatAverageRPE(averageRPE)}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('charts.rpeMoy')}</div>
            </div>
          </div>
        </div>
        {/* ⚠️ LE PARTAGE NE VIT PLUS SUR CHAQUE LIGNE (refonte des écrans, 09/2026). Sept boutons
            permanents pour un geste qu'on fait une fois par séance, c'était du
            bruit sur la rangée la plus dense de l'écran. Il n'apparaît que sur
            le jour OUVERT — celui qu'on regarde est le seul qu'on partage. */}
        <ShareSessionDialog
          session={session}
          athleteName={athleteName ?? ""}
          contextLabel={shareContext}
        />
        {coachEdit && (
          <>
            {/* Repli clavier/tactile du glisser-déposer — même motif que les
                exercices, où le drag seul excluait ces deux usages. */}
            {onMove && (
              <>
                {/* ⚠️ PAS AU TÉLÉPHONE : le plancher du doigt porte chaque bouton à
                    44 px, et cinq actions plus le titre débordaient de la carte
                    (432 px pour 356) — la carte défilait sous le doigt dès qu'un
                    champ prenait le focus. Réordonner les séances est un geste
                    de bureau. */}
                <button
                  type="button" title={t("week.monterLaSeance")} disabled={index === 0}
                  onClick={() => onMove(index, index - 1)}
                  className="hidden h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground sm:flex disabled:pointer-events-none disabled:opacity-30"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button" title={t("week.descendreLaSeance")} disabled={index === sessionCount - 1}
                  onClick={() => onMove(index, index + 1)}
                  className="hidden h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground sm:flex disabled:pointer-events-none disabled:opacity-30"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            <button
              type="button"
              title={t("week.renommerLaSeance")}
              onClick={() => setRenaming(session.name)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title={t("week.supprimerLaSeance")}
              onClick={async () => {
                if (await confirm({
                  title: t("week.supprimerLaSeanceNommee", { nom: session.name }),
                  description: t("week.exercicesPartentAvecElle"),
                })) onDelete?.();
              }}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
          </>
        )}
      </div>
      <div className="border-t border-border/80 bg-background/35 p-2.5 sm:p-3">
          {onUpdateForm && canEditSelectedAthlete && (
            <FormRating value={session.formOfTheDay} onChange={onUpdateForm} />
          )}
          <SessionTable
            session={session}
            mode={mode}
            storageScopeKey={storageScopeKey}
            canEditSelectedAthlete={canEditSelectedAthlete}
            onFeltRPEChange={onFeltRPEChange}
            onFeltRPEGlobal={onFeltRPEGlobal}
            onUpdateSetRPE={onUpdateSetRPE}
            onUpdateSetValue={onUpdateSetValue}
            onUpdateField={onUpdateField}
            onSetExerciseKind={onSetExerciseKind}
            onSetSessionKind={onSetSessionKind}
            onRemoveExercise={onRemoveExercise}
            onDuplicateExercise={onDuplicateExercise}
            onMoveExercise={onMoveExercise}
            onMoveExerciseFrom={onMoveExerciseToSession}
            autresSeances={autresSeances}
            onMoveExerciseTo={onMoveExerciseTo}
            onToggleGroup={onToggleGroup}
            onSetGroupKind={onSetGroupKind}
            nameOptions={nameOptions}
            objectifsParMouvement={objectifsParMouvement}
            variantOptions={variantOptions}
            assistanceOptions={assistanceOptions}
            tempoOptions={tempoOptions}
            blockWeeks={blockWeeks}
            shareBlock={shareBlock}
          />
          {coachEdit && (
            <button
              type="button"
              onClick={onAddExercise}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-2 text-xs text-muted-foreground hover:border-gold/40 hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" /> {t("week.ajouterUnExercice")}
            </button>
          )}
      </div>
    </div>
  );
}

/** Forme du jour — note 1-5 saisie par l'athlète sur la séance.
 *
 *  ⚠️ LE RE-CLIC EFFACE, ET RIEN NE LE DISAIT. Le comportement existe depuis
 *  toujours (`onChange(value === n ? null : n)`) ; personne ne pouvait le
 *  deviner, donc une note posée par erreur restait. La phrase n'apparaît que
 *  quand une note EST posée : avant, il n'y a rien à défaire, et l'annoncer
 *  serait une consigne pour un geste qu'on n'a pas encore fait.
 *
 *  ⚠️ ET LES CIBLES PASSENT À 30 px. Six pastilles de 24 px en rang serré, sur
 *  un téléphone, c'est la ligne où l'on se trompe de chiffre. */
function FormRating({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const { t } = useTranslation();
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t("week.formeDuJour")}</span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(value === n ? null : n)}
            aria-label={`Forme ${n}/5`}
            /* ⚠️ PAS D'`aria-pressed` ICI. Une note de 1 à 5 est un choix
               UNIQUE, pas cinq bascules indépendantes : l'annoncer ainsi ferait
               lire « bouton 3 sur 5, enfoncé » à côté de quatre autres boutons
               au même rang. Le re-clic qui efface est une commodité de saisie,
               pas une sémantique de bascule. L'imprécision avait un coût
               mesurable — `charge-verrouillee.spec` cherche le cadenas par le
               premier `button[aria-pressed]` de la page, et ces cinq-là le lui
               volaient (12/09). */
            className={cn(
              "h-[30px] w-[30px] rounded-md border font-mono text-[12px] tabular-nums transition-colors",
              value === n
                ? "border-gold bg-gold/15 text-gold"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {n}
          </button>
        ))}
      </div>
      {value !== null && (
        <span className="font-mono text-[10px] lowercase text-muted-foreground/70">
          {t("week.reCliquerEfface")}
        </span>
      )}
    </div>
  );
}
