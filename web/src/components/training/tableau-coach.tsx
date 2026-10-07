import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ChevronsDownUp, ChevronsUpDown, ChevronDown, ChevronUp, Clock3, CopyPlus, Dumbbell, Flame, HeartPulse, Link2, Link2Off, Lock, LockOpen, Trash2, Video } from "lucide-react";
import { useTranslation } from 'react-i18next';

import type { ExerciseKind, SessionEditing } from '@/api/types';
import { cleMouvement } from "@/api/hooks/use-objectifs-techniques";
import { Combobox, ComboboxMultiple } from "@/components/ui/combobox";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ObjectifsPastille } from "@/components/training/objectifs-pastille";
import { badgeKind, isTraining, kindSuivant, libelleKind } from "@/lib/exercise-kind";
import { chaineSansLacher, debutDansLEmom, estChronometre, leReposSeSaisit, lesSeriesSeSaisissent, libelleGroupe, natureDe, tempsDuGroupe } from "@/lib/groupe";
import { naviguerAuClavier } from "@/lib/navigation-clavier";
import { seriesDeLaLigne } from "@/lib/par-serie";
import { ciblesDeRecopie, type ChampRecopiable } from "@/lib/recopie";
import { useEnLigne } from '@/lib/reseau';
import { rpeDotColor, RPE_OPTIONS } from "@/lib/rpe";
import { ecrituresDePrescription } from "@/lib/saisie-coach";
import { exerciseTonnage, formatKg } from "@/lib/tonnage";
import { cn } from "@/lib/utils";
import { MAX_VARIANTES } from "@/lib/variantes";
import { ligneGlissee, porteUneLigne, poserLaLigneGlissee } from '@/lib/deplacement-de-ligne';

import { EditCell, LinkEdit, NoteArea } from "./cellules-coach";
import { ChoixDeNature } from "./choix-de-nature";
import { ExerciseProgression } from "./exercise-progression";
import { isFreeRest } from "./rest";
import type { SessionTableProps } from "./session-table";

/** LE TABLEAU DU COACH, GRAND ÉCRAN — colonnes essentielles, dépli par ligne
 *  (brief coach, 27/09).
 *
 *  ⚠️ FINI LE DÉFILEMENT HORIZONTAL DE TREIZE COLONNES. Ce que le coach vient
 *  chercher le lundi matin tient en huit : le mouvement, la prescription
 *  (séries, reps, charge, RPE cible) et ce que l'athlète a FAIT. Le reste —
 *  format, tempo, repos, assistance, nature, notes — se lit en gris sous le nom
 *  et se saisit dans le dépli. Une seule ligne dépliée à la fois.
 *
 *  ⚠️ LE VERROU EST À CÔTÉ DU CHAMP, PLUS DEDANS. Posé par-dessus, il masquait
 *  la charge : « 232.5 » devenait « 232 », puis « 16. » (remonté par un coach).
 *
 *  ⚠️ LE RÉEL RESTE EN LECTURE : il vient de l'athlète, le coach le lit, il ne
 *  l'écrit pas. Le pied du tableau le dit. */

/** Une icône par nature : lisible d'un coup d'œil, et tient dans 28 px. */
const KIND_ICONE = { training: Dumbbell, warmup: Flame, rehab: HeartPulse } as const;
const FORMATS = ["", "EMOM", "AMRAP", "CLUSTER"];

/** Huit colonnes, largeurs fixes sauf le nom (brief §2). */
/** ⚠️ TOUT CE QUI SE PRESCRIT TIENT SUR UNE LIGNE (William, 30/09). La refonte
 *  du 27/09 avait rangé format, tempo, repos, assistance et variantes dans le
 *  dépli : sur grand écran, il fallait ouvrir chaque ligne pour écrire une
 *  séance, et une ligne dépliée prenait l'écran. Le dépli ne garde que ce qu'on
 *  ne touche pas à chaque ligne — nature, lien, notes, détail du réel,
 *  progression, actions. La grille a une largeur minimale et défile sur un
 *  écran étroit, comme avant la refonte. */
const COLONNES = "grid-cols-[24px_minmax(200px,1fr)_minmax(108px,0.5fr)_78px_76px_52px_84px_116px_60px_minmax(80px,0.35fr)_104px_34px]";
const LARGEUR_MIN = "min-w-[1100px]";

const LIBELLE = "mb-1 block font-display text-[10px] uppercase tracking-[0.14em] text-muted-foreground";

export function TableauCoach({
  session, onUpdateField, onSetExerciseKind, onRemoveExercise, onDuplicateExercise, onMoveExercise,
  onMoveExerciseFrom, onToggleGroup, onSetGroupKind, nameOptions, objectifsParMouvement, variantOptions,
  assistanceOptions, tempoOptions, blockWeeks, shareBlock,
}: SessionTableProps & { onUpdateField: NonNullable<SessionTableProps['onUpdateField']> }) {
  const { t } = useTranslation();
  const enLigne = useEnLigne();
  const confirm = useConfirm();
  /** Les lignes DÉPLIÉES. Repliées d'office : la prescription entière est dans
   *  la rangée, le dépli ne porte que le reste (notes, progression, actions).
   *
   *  ⚠️ Indexées par la PLACE : quand la séance change de longueur (ajout,
   *  retrait, duplication), tout se referme plutôt que de laisser un dépli
   *  glisser sur la ligne voisine. */
  const [ouvertes, setOuvertes] = useState<ReadonlySet<number>>(new Set());
  const longueur = session.exercises.length;
  useEffect(() => { setOuvertes(new Set()); }, [longueur]);
  const basculer = (i: number) => setOuvertes((avant) => {
    const suite = new Set(avant);
    if (!suite.delete(i)) suite.add(i);
    return suite;
  });
  const toutOuvert = longueur > 0 && ouvertes.size >= longueur;
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const ecrire = (i: number, champ: ChampRecopiable, v: string) => {
    for (const [field, value] of ecrituresDePrescription(champ, v)) onUpdateField(i, field, value);
  };

  /* ----- Recopier une colonne vers le bas (Passe 3, constat 05) ----- */

  /** La recopie en cours : la case d'où l'on tire, et la ligne sous le pointeur.
   *  Le `ref` sert aux gestionnaires, l'état au dessin. */
  const [recopie, setRecopie] = useState<{ champ: ChampRecopiable; depuis: number; jusqua: number } | null>(null);
  const recopieRef = useRef(recopie);
  recopieRef.current = recopie;
  const grilleRef = useRef<HTMLDivElement>(null);
  const cibles = recopie ? ciblesDeRecopie(session.exercises, recopie.champ, recopie.depuis, recopie.jusqua) : [];

  const debuterRecopie = (e: ReactPointerEvent<HTMLElement>, champ: ChampRecopiable, i: number) => {
    if (e.button !== 0) return;
    // ⚠️ LA FRAPPE EN COURS D'ABORD. La case a encore le focus, et sa valeur ne
    // s'écrit qu'au `blur` : sans lui, on recopierait la valeur d'avant.
    (document.activeElement as HTMLElement | null)?.blur();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setRecopie({ champ, depuis: i, jusqua: i });
  };
  const suivreRecopie = (e: ReactPointerEvent<HTMLElement>) => {
    const r = recopieRef.current;
    if (!r) return;
    const sous = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-ligne]");
    if (!sous || !grilleRef.current?.contains(sous)) return;
    const jusqua = Math.max(r.depuis, Number(sous.dataset.ligne));
    if (jusqua !== r.jusqua) setRecopie({ ...r, jusqua });
  };
  const terminerRecopie = () => {
    const r = recopieRef.current;
    setRecopie(null);
    if (!r) return;
    const valeur = String(session.exercises[r.depuis]?.[r.champ] ?? "");
    for (const j of ciblesDeRecopie(session.exercises, r.champ, r.depuis, r.jusqua)) {
      // Une case qui porte déjà la valeur ne s'écrit pas : réécrire la même
      // charge effacerait quand même le réel de la ligne.
      if (String(session.exercises[j]?.[r.champ] ?? "") !== valeur) ecrire(j, r.champ, valeur);
    }
  };

  /** Enveloppe une case de prescription de sa poignée (8 px d'or, en bas à
   *  droite de la case active).
   *
   *  ⚠️ AU POINTEUR FIN SEULEMENT (`pointer-fine:`). Au doigt, un carré de 8 px
   *  est introuvable — le téléphone a ses cartes.
   *
   *  ⚠️ PAS DE POIGNÉE SUR UNE CASE VIDE : tirer du vide effacerait les lignes
   *  traversées, un geste de destruction déguisé en recopie. */
  const recopiable = (champ: ChampRecopiable, i: number, cellule: ReactNode) => {
    const valeur = String(session.exercises[i]?.[champ] ?? "");
    const tiree = recopie?.champ === champ && recopie.depuis === i;
    const cible = recopie?.champ === champ && cibles.includes(i);
    return (
      <div
        data-recopie-cible={cible ? champ : undefined}
        className={cn("group/recopie relative min-w-0", cible && "rounded-md outline-dashed outline-1 outline-offset-1 outline-gold")}
      >
        {cellule}
        {valeur !== "" && (
          <span
            aria-hidden
            data-poignee-recopie={champ}
            draggable={false}
            onPointerDown={(e) => debuterRecopie(e, champ, i)}
            onPointerMove={suivreRecopie}
            onPointerUp={terminerRecopie}
            onPointerCancel={() => setRecopie(null)}
            title={t("session.recopierVersLeBas")}
            className={cn(
              "absolute -bottom-1 -right-1 z-20 hidden h-2 w-2 cursor-crosshair rounded-[1px] bg-gold ring-1 ring-background",
              tiree ? "pointer-fine:block" : "pointer-fine:group-focus-within/recopie:block",
            )}
          />
        )}
        {/* L'aperçu suit le pointeur : sous la DERNIÈRE case écrite. */}
        {cible && i === cibles[cibles.length - 1] && recopie && (
          <span
            role="status"
            className="pointer-events-none absolute right-0 top-full z-30 mt-2 whitespace-nowrap rounded-sm bg-gold px-1.5 py-0.5 font-mono text-[10px] font-semibold text-background"
          >
            {t("session.recopieVers", { valeur: String(session.exercises[recopie.depuis]?.[champ] ?? ""), count: cibles.length })}
          </span>
        )}
      </div>
    );
  };

  /** Après une duplication, le curseur va dans le NOM de la copie — c'est ce
   *  qu'on change presque toujours. La copie n'existe à l'écran qu'à la
   *  relecture : on attend qu'elle y soit. */
  const [curseurSur, setCurseurSur] = useState<string | null>(null);
  useEffect(() => {
    if (!curseurSur) return;
    const nom = grilleRef.current?.querySelector<HTMLElement>(
      `[data-ligne-id="${CSS.escape(curseurSur)}"] [data-nom-exercice] button`);
    if (!nom) return;
    setCurseurSur(null);
    nom.focus();
    nom.click();
  }, [curseurSur, session.exercises]);

  return (
    // Les flèches du clavier passent de case en case, comme dans la BASE (FRE-180).
    <div onKeyDown={naviguerAuClavier} className="overflow-x-auto [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]">
      <div className={LARGEUR_MIN}>
      <div className={cn("grid items-center gap-1.5 border-y border-border/70 px-3 py-1.5 font-display text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70", COLONNES)}>
        <span />
        <span>{t("session.exercice")}</span>
        <span>{t("session.variantes")}</span>
        <span>{t("session.format")}</span>
        <span>{t("session.tempo")}</span>
        <span className="text-right">{t("session.series")}</span>
        <span className="text-right">{t("session.reps")}</span>
        <span className="text-right">{t("session.charge")}</span>
        <span>{t("session.repos")}</span>
        <span>{t("session.assistance")}</span>
        <span className="text-center">{t("session.rpeCibleEtReel")}</span>
        {/* D'un geste : ouvrir le reste de toutes les lignes (notes, progression), ou le refermer. */}
        <button type="button" data-tout-plier
                onClick={() => setOuvertes(toutOuvert ? new Set() : new Set(session.exercises.map((_, k) => k)))}
                aria-label={toutOuvert ? t("training.toutReplier") : t("training.toutDeplier")}
                title={toutOuvert ? t("training.toutReplier") : t("training.toutDeplier")}
                className="ml-auto flex h-6 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
          {toutOuvert ? <ChevronsDownUp className="h-3.5 w-3.5" /> : <ChevronsUpDown className="h-3.5 w-3.5" />}
        </button>
      </div>
      <div ref={grilleRef} className="divide-y divide-border">
        {session.exercises.map((ex, i) => {
          const isOpen = ouvertes.has(i);
          const linked = !!ex.groupId;
          const precedente = session.exercises[i - 1];
          const suivante = session.exercises[i + 1];
          const aimedRPEColor = ex.aimedRPE ? rpeDotColor(ex.aimedRPE) : undefined;
          const isGroupStart = linked && precedente?.groupId !== ex.groupId;
          // Séries et repos décrivent le TOUR, pas chaque exercice (FRE-31) : on
          // ne les saisit qu'une fois, sur la première ligne du groupe ; les
          // suivantes montrent que la valeur vient d'au-dessus. L'écriture, elle,
          // se propage à tous les membres — voir `updateExercise`.
          const membres = ex.groupId ? session.exercises.filter(o => o.groupId === ex.groupId).length : 0;
          const enGroupe = membres > 1;
          const suiteDuGroupe = enGroupe && precedente?.groupId === ex.groupId;
          const natureDuGroupe = natureDe(ex);
          const suiteDeDescentes = natureDuGroupe === 'dropset' && suiteDuGroupe;
          const chaine = enGroupe ? chaineSansLacher(session.exercises, i) : null;
          const canToggleGroupWithNext = !linked && !suivante?.groupId;
          const peutEtendreLeGroupe = linked && !isGroupStart && !!suivante && !suivante.groupId;
          const lienInterne = linked && !!suivante && suivante.groupId === ex.groupId && natureDuGroupe !== 'dropset';
          const lienDeLiage = isGroupStart || canToggleGroupWithNext || peutEtendreLeGroupe;
          const showGroupConnector = !!onToggleGroup && i < session.exercises.length - 1 && (lienDeLiage || lienInterne);
          // Ce qui se lit sans déplier : les annexes en gris (brief §2).
          // Tempo, repos, assistance ont leur colonne : sous le nom, il ne reste
          // que ce qu'aucune colonne ne dit.
          const annexes = [
            enGroupe && suiteDuGroupe ? t("session.suiteDuTour") : null,
          ].filter(Boolean);
          const chrono = linked && estChronometre(natureDuGroupe);
          const pastilleObjectifs = suiteDeDescentes ? null : (
            <ObjectifsPastille mouvement={ex.name} objectifs={objectifsParMouvement?.get(cleMouvement(ex.name)) ?? []} />
          );
          const Icone = KIND_ICONE[ex.kind && !isTraining(ex) ? ex.kind : "training"];
          const suivantKind = kindSuivant(ex.kind);
          const verrouille = !!ex.weightLocked;

          return (
            <div
              key={i}
              draggable={!!onMoveExercise}
              data-pli
              data-ligne={i}
              data-ligne-id={ex.id}
              onDragStart={(e) => {
                if (recopieRef.current) { e.preventDefault(); return; }
                setDragIdx(i);
                if (session.id) poserLaLigneGlissee(e.dataTransfer, { sessionId: session.id, index: i });
              }}
              onDragEnd={() => setDragIdx(null)}
              onDragOver={(e) => { if (dragIdx !== null || porteUneLigne(e.dataTransfer)) e.preventDefault(); }}
              onDrop={(e) => {
                if (dragIdx !== null) {
                  if (dragIdx !== i) onMoveExercise?.(dragIdx, i);
                  setDragIdx(null);
                  return;
                }
                const venue = ligneGlissee(e.dataTransfer);
                if (venue && venue.sessionId !== session.id) {
                  e.stopPropagation();
                  onMoveExerciseFrom?.(venue.sessionId, venue.index, i);
                }
              }}
              className={cn(
                "relative overflow-visible",
                dragIdx === i && "opacity-40",
                isOpen && "mb-2 rounded-lg border border-gold/35 bg-gold/5 shadow-[0_10px_24px_rgba(0,0,0,0.12)]",
              )}
            >
              <div data-rangee className={cn("group relative grid items-center gap-1.5 px-3 py-2 transition-colors hover:bg-accent/30", COLONNES, isOpen && "border-b border-gold/15 bg-gold/5")}>
                {/* Le filet or à gauche reste le marqueur de groupe. */}
                {enGroupe && (
                  <span data-group-marker aria-hidden className={cn("absolute left-0 top-0 h-full",
                    chaine ? "w-[5px]" : "w-[3px]",
                    natureDuGroupe === "amrap" ? "border-l-[3px] border-dotted border-metric" : natureDuGroupe === "emom" ? "bg-metric" : "bg-gold/70")} />
                )}

                {/* ⚠️ DANS UN EMOM EN ROTATION, LA MINUTE REMPLACE LE NUMÉRO (FRE-116). */}
                {enGroupe && natureDuGroupe === "emom" ? (
                  <span className="font-display text-[10px] font-bold uppercase tracking-[0.1em] text-metric">
                    {debutDansLEmom(session.exercises.slice(0, i).filter(o => o.groupId === ex.groupId).length,
                      tempsDuGroupe("emom", membres, ex.sets, ex.clusterMode)?.intervalle ?? null)}
                  </span>
                ) : (
                  <span className="text-center font-mono text-[11px] text-muted-foreground tabular-nums">{i + 1}</span>
                )}

                {/* ---- Exercice : nom, badges, annexes ---- */}
                <div className="flex min-w-0 items-start gap-1.5">
                  {onMoveExercise && (
                    <div className="flex shrink-0 flex-col opacity-40 group-hover:opacity-100 focus-within:opacity-100">
                      <button type="button" title={t('session.monterLExercice')} disabled={i === 0} onClick={() => onMoveExercise(i, i - 1)}
                        className="flex h-4 w-5 items-center justify-center rounded text-muted-foreground hover:text-gold disabled:opacity-20">
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button type="button" title={t('session.descendreLExercice')} disabled={i === session.exercises.length - 1} onClick={() => onMoveExercise(i, i + 1)}
                        className="flex h-4 w-5 items-center justify-center rounded text-muted-foreground hover:text-gold disabled:opacity-20">
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <div data-nom-exercice className="min-w-0 flex-1">
                        {/* Le nom d'un dropset décrit le groupe entier : il se saisit une fois. */}
                        {suiteDeDescentes
                          ? <span className="block text-xs text-muted-foreground/50" title={t("session.memeExerciceQueLaDescente")}>↑</span>
                          : <Combobox value={ex.name} options={nameOptions ?? []} label={t("session.exercice")} placeholder={t("session.exercice")} onCommit={(v) => onUpdateField(i, "name", v)} />}
                      </div>
                      {!isTraining(ex) && ex.kind && ex.kind !== "training" && (
                        <span className="shrink-0 font-display text-[10px] font-bold uppercase tracking-[0.12em] text-gold">{badgeKind(ex.kind, t)}</span>
                      )}
                      {enGroupe && isGroupStart && (
                        <span className={cn("shrink-0 font-display text-[10px] font-bold uppercase tracking-[0.12em]", estChronometre(natureDuGroupe) ? "text-metric" : "text-gold")}>
                          {libelleGroupe(membres, natureDuGroupe)}
                        </span>
                      )}
                      {pastilleObjectifs}
                      {/* NATURE de la ligne (FRE-10) — un bouton qui CYCLE : l'absence
                          vaut entraînement, et 96 % des lignes n'ont rien d'autre. */}
                      {onSetExerciseKind && (
                        <button
                          type="button"
                          aria-label={t("session.natureDeLExercice", {
                            nom: ex.name || t("session.lExercice"),
                            actuelle: libelleKind(ex.kind && !isTraining(ex) ? ex.kind : "training", t),
                            suivante: libelleKind(suivantKind, t),
                          })}
                          title={t("session.natureCliquerPour", {
                            actuelle: libelleKind(ex.kind && !isTraining(ex) ? ex.kind : "training", t),
                            suivante: libelleKind(suivantKind, t).toLocaleLowerCase(),
                          })}
                          onClick={() => onSetExerciseKind(i, suivantKind)}
                          className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md border outline-none transition-colors focus:border-gold",
                            isTraining(ex) ? "border-border text-muted-foreground/70 hover:text-foreground" : "border-gold/35 bg-gold/10 text-gold")}
                        >
                          <Icone className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {(annexes.length > 0 || chaine?.debut) && (
                      <div className="mt-0.5 flex flex-wrap gap-x-2 font-mono text-[11px] text-muted-foreground">
                        {chaine?.debut && <span className="text-gold">{t("session.sansLacherMouvements", { n: chaine.mouvements })}</span>}
                        {annexes.map((a, k) => <span key={k}>{k > 0 || chaine?.debut ? "· " : ""}{a}</span>)}
                      </div>
                    )}
                  </div>
                </div>

                {/* ---- Variantes, format, tempo : dans la rangée ---- */}
                <div className="min-w-0">
                  {suiteDeDescentes ? <span className="text-xs text-muted-foreground/40">↑</span>
                    : <ComboboxMultiple values={ex.variant} options={variantOptions ?? []} max={MAX_VARIANTES} label={t("session.variantes")}
                                        placeholder="—" onCommit={(v) => onUpdateField(i, "variant", v)} />}
                </div>
                <div className="min-w-0">
                  <ChampFormat ex={ex} i={i} chrono={chrono} suiteDuGroupe={suiteDuGroupe} natureDuGroupe={natureDuGroupe} onUpdateField={onUpdateField} />
                </div>
                <div className="min-w-0">
                  <Combobox value={ex.tempo} options={tempoOptions ?? []} label={t("session.tempo")} placeholder="—" onCommit={(v) => onUpdateField(i, "tempo", v)} />
                </div>

                {/* ---- Séries ---- */}
                {linked && !lesSeriesSeSaisissent(natureDuGroupe) ? (
                  <span className="text-center text-xs text-muted-foreground/40" title={t("session.amrapSansSeries")}>—</span>
                ) : suiteDuGroupe ? (
                  <span className="text-center text-xs text-muted-foreground/40" title={t("session.definiSurLaPremiereLigneDuBiSet")}>↑</span>
                ) : (
                  recopiable("sets", i, <EditCell value={ex.sets} label={t("session.series")} onCommit={(v) => ecrire(i, "sets", v)} />)
                )}

                {/* ---- Reps, et l'unité à côté ---- */}
                <div className="flex items-center gap-1">
                  <div className="min-w-0 flex-1">
                    {recopiable("reps", i, <EditCell value={ex.reps} label={t("session.reps")} onCommit={(v) => ecrire(i, "reps", v)} />)}
                  </div>
                  <button
                    type="button"
                    onClick={() => onUpdateField(i, "repsUnit", ex.repsUnit === "sec" ? "count" : "sec")}
                    className={cn("h-7 w-8 shrink-0 rounded-md border text-[9px] font-semibold uppercase tracking-wide",
                      ex.repsUnit === "sec" ? "border-gold/35 bg-gold/10 text-gold" : "border-border bg-background text-muted-foreground hover:text-foreground")}
                    title={t("session.basculerEntreRepetitionsRep")}
                  >
                    {ex.repsUnit === "sec" ? "sec" : "rep"}
                  </button>
                </div>

                {/* ---- Charge : le champ entier, l'unité, le verrou À CÔTÉ ---- */}
                <div className="flex items-center gap-1">
                  <div className="min-w-0 flex-1">
                    {recopiable("weight", i, <EditCell
                      value={ex.weight}
                      label={t("session.charge")}
                      inputMode="decimal"
                      onCommit={(v) => ecrire(i, "weight", v)}
                      className={cn("font-semibold text-gold", verrouille && "border-[var(--warning)]/60")}
                    />)}
                  </div>
                  <span className="shrink-0 text-[9px] text-muted-foreground">kg</span>
                  <button
                    type="button"
                    onClick={() => onUpdateField(i, "weightLocked", !verrouille)}
                    aria-pressed={verrouille}
                    aria-label={verrouille ? t("session.chargeVerrouilleeAria") : t("session.chargeLibreAria")}
                    title={verrouille ? t("misc.unlockLoad") : t("session.verrouillerLaCharge")}
                    className={cn("flex h-7 w-[30px] shrink-0 items-center justify-center rounded-md border transition-colors",
                      verrouille ? "border-[var(--warning)]/60 bg-[var(--warning)]/10 text-[var(--warning)]" : "border-border bg-background text-muted-foreground hover:text-foreground")}
                  >
                    {verrouille ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
                  </button>
                </div>

                {/* ---- Repos, assistance ---- */}
                <div className="min-w-0">
                  <ChampRepos ex={ex} i={i} suiteDuGroupe={suiteDuGroupe} natureDuGroupe={natureDuGroupe} recopiable={recopiable} ecrire={ecrire} />
                </div>
                <div className="min-w-0">
                  <Combobox value={ex.assistance} options={assistanceOptions ?? []} label={t("session.assistance")} placeholder="—" onCommit={(v) => onUpdateField(i, "assistance", v)} />
                </div>

                {/* ---- RPE cible, et le RÉEL noté par l'athlète ----
                    ⚠️ LE RÉEL SE LIT SANS DÉPLIER (William, 05/10) : la colonne Réel
                    est sortie en 1.0.6, et avec elle le seul endroit où le coach
                    voyait le RPE ressenti — quatre lignes sur cinq n'ont pas de
                    détail par série. Rien tant que l'athlète n'a rien noté : une
                    semaine à venir ne montre que la cible. */}
                <div className="flex items-center justify-center gap-1.5">
                  {recopiable("aimedRPE", i, <select
                    value={ex.aimedRPE ?? ''}
                    aria-label={t("session.rpeCible")}
                    onChange={(e) => ecrire(i, "aimedRPE", e.target.value)}
                    className="h-7 w-16 rounded-md border border-border bg-background pl-1.5 pr-0.5 text-[11px] font-mono outline-none focus:border-gold"
                    style={{ boxShadow: aimedRPEColor ? `inset 3px 0 0 0 ${aimedRPEColor}` : undefined, color: aimedRPEColor }}
                  >
                    {RPE_OPTIONS.map((o) => <option key={o} value={o}>{o || "—"}</option>)}
                  </select>)}
                  {ex.feltRPE?.trim() ? (
                    <span data-rpe-reel title={t("session.rpeReelDeLAthlete")}
                          className="w-8 shrink-0 whitespace-nowrap font-mono text-[11px] font-semibold tabular-nums"
                          style={{ color: rpeDotColor(ex.feltRPE.trim()) }}>
                      <span className="text-muted-foreground/60">→</span>{ex.feltRPE.trim()}
                    </span>
                  ) : <span className="w-8 shrink-0" aria-hidden />}
                </div>

                {/* ---- Le dépli ---- */}
                <div className="flex items-center justify-end gap-0.5">
                  {ex.link && (
                    <a href={ex.link} target="_blank" rel="noopener noreferrer" title={t("session.voirLaVideo")}
                       className="flex h-7 w-7 items-center justify-center rounded-md text-gold hover:bg-gold/15">
                      <Video className="h-3.5 w-3.5" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => basculer(i)}
                    aria-expanded={isOpen}
                    aria-label={t("session.deplierLaLigne", { nom: ex.name || t("session.sansNom") })}
                    className={cn("flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent",
                      (ex.coachNote || ex.athleteFeedback) && "bg-gold/10 text-gold hover:bg-gold/15")}
                    title={ex.coachNote || ex.athleteFeedback ? "Voir notes" : t("session.ajouterUneNote")}
                  >
                    {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {/* ⚠️ UN LIEN, PAS UNE NATURE (FRE-116) : entre deux lignes, la bascule
                  de liaison, le « sans lâcher », et la nature du groupe. */}
              {showGroupConnector && (
                <div className="pointer-events-none absolute inset-x-4 top-full z-10 -translate-y-1/2">
                  <div className={cn("absolute inset-x-0 top-1/2 border-t", isGroupStart || lienInterne ? "border-gold/35" : "border-dashed border-border/60")} />
                  {lienInterne && (
                    <button
                      type="button"
                      aria-pressed={!!ex.unbroken}
                      onClick={() => onUpdateField(i, "unbroken", !ex.unbroken)}
                      title={ex.unbroken ? t("session.lacherAvantLaSuivante") : t("session.sansLacherAvecLaSuivante")}
                      className={cn("pointer-events-auto absolute right-1/2 top-1/2 mr-5 -translate-y-1/2 rounded-sm border px-1.5 py-0.5 font-display text-[10px] font-bold uppercase tracking-[0.08em] shadow-sm transition-colors",
                        ex.unbroken ? "border-gold/35 bg-gold/15 text-gold hover:bg-gold/25" : "border-dashed border-border bg-card text-muted-foreground hover:border-gold/35 hover:text-foreground")}
                    >
                      {t("session.unbroken")}
                    </button>
                  )}
                  {lienDeLiage && (
                    <button
                      type="button"
                      onClick={() => onToggleGroup?.(i)}
                      className={cn("pointer-events-auto absolute left-1/2 top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm transition-colors",
                        isGroupStart ? "border-gold/35 bg-gold/10 text-gold hover:bg-gold/15" : "border-border bg-card text-muted-foreground hover:border-gold/35 hover:text-foreground")}
                      title={isGroupStart ? t("session.delierLeGroupe") : peutEtendreLeGroupe ? t("session.ajouterAuGroupe") : t("misc.makeBiset")}
                      aria-pressed={isGroupStart}
                    >
                      {isGroupStart ? <Link2Off className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                    </button>
                  )}
                  {isGroupStart && onSetGroupKind && (
                    <ChoixDeNature nature={natureDuGroupe} taille={membres} onChange={(n) => onSetGroupKind(i, n)}
                                   className="pointer-events-auto absolute left-1/2 top-1/2 ml-5 -translate-y-1/2" />
                  )}
                </div>
              )}

              {isOpen && (
                <DepliDeLaLigne
                  sansPrescription
                  session={session} i={i} suiteDuGroupe={suiteDuGroupe} natureDuGroupe={natureDuGroupe} linked={linked}
                  onUpdateField={onUpdateField} onSetExerciseKind={onSetExerciseKind} recopiable={recopiable} ecrire={ecrire}
                  variantOptions={variantOptions} assistanceOptions={assistanceOptions} tempoOptions={tempoOptions}
                  blockWeeks={blockWeeks} shareBlock={shareBlock}
                  actions={
                    <>
                      {onToggleGroup && (lienDeLiage || isGroupStart) && (
                        <BoutonDAction onClick={() => onToggleGroup(i)}>
                          {isGroupStart ? t("session.delierLeGroupe") : t("session.lierALaLigneSuivante")}
                        </BoutonDAction>
                      )}
                      {onDuplicateExercise && (
                        <BoutonDAction disabled={!enLigne} title={enLigne ? undefined : t("training.disponibleAuRetourDuReseau")}
                          aria-label={t("session.dupliquerLaLigne", { nom: ex.name || t("session.sansNom") })}
                          onClick={async () => { const copie = await onDuplicateExercise(i); if (copie) setCurseurSur(copie); }}>
                          <CopyPlus className="h-3.5 w-3.5" /> {t("session.dupliquer")}
                        </BoutonDAction>
                      )}
                      {onRemoveExercise && (
                        <button
                          type="button"
                          title={t('session.supprimerLExercice')}
                          onClick={async () => {
                            if (!await confirm({ title: t("session.supprimerExercice", { nom: ex.name || t("session.sansNom") }) })) return;
                            onRemoveExercise(i);
                          }}
                          className="ml-auto flex h-8 items-center gap-1 rounded-md border border-destructive/40 px-2.5 text-xs text-destructive hover:bg-destructive/15"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> {t('session.retirer')}
                        </button>
                      )}
                    </>
                  }
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{t("session.lignesEtTonnage", { count: session.exercises.length, tonnage: formatKg(session.exercises.reduce((s, e) => s + exerciseTonnage(e), 0)) })}</span>
      </div>
      </div>
    </div>
  );
}

/** LE FORMAT d'une ligne — la liste, et ce qu'elle appelle (motif, repos du
 *  cluster). Une écriture, deux places : la rangée du grand écran, le dépli du
 *  téléphone.
 *
 *  ⚠️ UN GROUPE CHRONOMÉTRÉ N'A PAS DE FORMAT DE LIGNE (FRE-116) : la case
 *  devient le TEMPS du groupe, saisi une fois, sur la première ligne. */
function ChampFormat({ ex, i, chrono, suiteDuGroupe, natureDuGroupe, onUpdateField }: {
  ex: SessionEditing['exercises'][number]; i: number; chrono: boolean; suiteDuGroupe: boolean;
  natureDuGroupe: ReturnType<typeof natureDe>;
  onUpdateField: NonNullable<SessionTableProps['onUpdateField']>;
}) {
  const { t } = useTranslation();
  if (chrono) {
    return suiteDuGroupe
      ? <span className="text-xs text-muted-foreground/40" title={t("session.definiSurLaPremiereLigneDuGroupe")}>↑</span>
      : <EditCell value={ex.clusterMode} align="left" inputMode="numeric" placeholder={natureDuGroupe === "emom" ? "60" : "300"}
                  label={t(natureDuGroupe === "emom" ? "session.intervalleEnSecondes" : "session.dureeEnSecondes")}
                  onCommit={(v) => onUpdateField(i, "clusterMode", v)} />;
  }
  return (
    <div className="flex flex-col gap-1">
      <select value={ex.format ?? ''} aria-label={t("session.format")} onChange={(e) => onUpdateField(i, "format", e.target.value)}
              className="h-7 w-full rounded-md border border-border bg-background px-1 text-xs outline-none focus:border-gold">
        {FORMATS.map((o) => <option key={o || "empty"} value={o}>{o || t("session.formatLibre")}</option>)}
      </select>
      {ex.format && (
        <EditCell value={ex.clusterMode} label={t("session.motifDuFormat")} align="left"
                  placeholder={ex.format === "CLUSTER" ? "1/1/1" : "120"} onCommit={(v) => onUpdateField(i, "clusterMode", v)} />
      )}
      {ex.format === "CLUSTER" && (
        <EditCell value={ex.clusterRest} label={t("session.reposDuCluster")} align="left" placeholder="15s"
                  onCommit={(v) => onUpdateField(i, "clusterRest", v)} />
      )}
    </div>
  );
}

/** LE REPOS d'une ligne.
 *
 *  ⚠️ RÈGLE D'AFFORDANCE : un dropset n'a PAS de repos entre ses descentes, un
 *  groupe chronométré non plus (FRE-31, FRE-116) ; et dans un groupe, il se
 *  saisit une fois, sur la première ligne. */
function ChampRepos({ ex, i, suiteDuGroupe, natureDuGroupe, recopiable, ecrire }: {
  ex: SessionEditing['exercises'][number]; i: number; suiteDuGroupe: boolean;
  natureDuGroupe: ReturnType<typeof natureDe>;
  recopiable: (champ: ChampRecopiable, i: number, cellule: ReactNode) => ReactNode;
  ecrire: (i: number, champ: ChampRecopiable, v: string) => void;
}) {
  const { t } = useTranslation();
  if (!leReposSeSaisit(natureDuGroupe)) {
    return <span className="text-xs text-muted-foreground/40" title={t(natureDuGroupe === "dropset" ? "session.dropsetSansRepos" : "session.chronoSansRepos")}>—</span>;
  }
  if (suiteDuGroupe) {
    return <span className="text-xs text-muted-foreground/40" title={t("session.definiSurLaPremiereLigneDuGroupe")}>↑</span>;
  }
  return <>{recopiable("rest", i, <EditCell value={isFreeRest(ex.rest) ? "" : ex.rest} align="left" inputMode="numeric"
                                           placeholder={t("session.reposLibre")} label={t("session.repos")} onCommit={(v) => ecrire(i, "rest", v)} />)}</>;
}

function BoutonDAction({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...props}
      className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-foreground hover:border-gold/40 disabled:cursor-not-allowed disabled:opacity-40">
      {children}
    </button>
  );
}

/** Le dépli d'une ligne : ce qui ne tient pas dans les huit colonnes. Le
 *  téléphone s'en sert aussi, sous « + tempo, assistance, note ». */
export function DepliDeLaLigne({
  session, i, suiteDuGroupe, natureDuGroupe, linked, onUpdateField, onSetExerciseKind, recopiable, ecrire,
  variantOptions, assistanceOptions, tempoOptions, blockWeeks, shareBlock, actions, sansPrescription = false,
}: {
  /** La rangée porte déjà format, tempo, repos, assistance et variantes (grand
   *  écran) : le dépli ne les répète pas. Au téléphone, il reste leur seule place. */
  sansPrescription?: boolean;
  session: SessionEditing; i: number; suiteDuGroupe: boolean; natureDuGroupe: ReturnType<typeof natureDe>; linked: boolean;
  onUpdateField: NonNullable<SessionTableProps['onUpdateField']>;
  onSetExerciseKind?: SessionTableProps['onSetExerciseKind'];
  recopiable: (champ: ChampRecopiable, i: number, cellule: ReactNode) => ReactNode;
  ecrire: (i: number, champ: ChampRecopiable, v: string) => void;
  variantOptions?: string[]; assistanceOptions?: string[]; tempoOptions?: string[];
  blockWeeks?: SessionTableProps['blockWeeks']; shareBlock?: string; actions: ReactNode;
}) {
  const { t } = useTranslation();
  const ex = session.exercises[i];
  const chrono = linked && estChronometre(natureDuGroupe);
  const setCount = parseInt(ex.sets ?? '', 10);
  const parSerie = {
    reps: seriesDeLaLigne(ex.repsDoneBySet, ex.repsDone),
    charge: seriesDeLaLigne(ex.weightDoneBySet, ex.weightDone),
    rpe: Array.isArray(ex.feltRPEBySet) ? ex.feltRPEBySet : [],
  };
  const aDuDetail = Number.isFinite(setCount) && setCount > 1
    && (parSerie.reps.length > 1 || parSerie.charge.length > 1 || parSerie.rpe.length > 1);

  return (
    <div className="border-t border-gold/15 px-3 py-3 text-xs">
      {!sansPrescription && (
      <div className="mb-3 grid gap-3 md:grid-cols-[1fr_1fr_1fr_1.4fr]">
        <div>
          <span className={LIBELLE}>{chrono ? t(natureDuGroupe === "emom" ? "session.intervalleEnSecondes" : "session.dureeEnSecondes") : t("session.format")}</span>
          <ChampFormat ex={ex} i={i} chrono={chrono} suiteDuGroupe={suiteDuGroupe} natureDuGroupe={natureDuGroupe} onUpdateField={onUpdateField} />
        </div>
        <div>
          <span className={LIBELLE}>{t("session.tempo")}</span>
          <Combobox value={ex.tempo} options={tempoOptions ?? []} label={t("session.tempo")} placeholder="—" onCommit={(v) => onUpdateField(i, "tempo", v)} />
        </div>
        <div>
          <span className={LIBELLE}>{t("session.repos")}</span>
          <ChampRepos ex={ex} i={i} suiteDuGroupe={suiteDuGroupe} natureDuGroupe={natureDuGroupe} recopiable={recopiable} ecrire={ecrire} />
        </div>
        <div>
          <span className={LIBELLE}>{t("session.assistance")}</span>
          <Combobox value={ex.assistance} options={assistanceOptions ?? []} label={t("session.assistance")} placeholder="—" onCommit={(v) => onUpdateField(i, "assistance", v)} />
        </div>
      </div>
      )}

      <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
        <div>
          <span className={LIBELLE}>{t("session.nature")}</span>
          {onSetExerciseKind ? (
            <select value={ex.kind && !isTraining(ex) ? ex.kind : "training"} aria-label={t("session.nature")}
                    onChange={(e) => onSetExerciseKind(i, e.target.value as ExerciseKind)}
                    className="h-7 w-full rounded-md border border-border bg-background px-1 text-xs outline-none focus:border-gold">
              {(["training", "warmup", "rehab"] as const).map((k) => <option key={k} value={k}>{libelleKind(k, t)}</option>)}
            </select>
          ) : <span className="text-muted-foreground">{libelleKind(ex.kind && !isTraining(ex) ? ex.kind : "training", t)}</span>}
        </div>
        {!sansPrescription && (
        <div>
          <span className={LIBELLE}>{t("session.variantes")}</span>
          <ComboboxMultiple values={ex.variant} options={variantOptions ?? []} max={MAX_VARIANTES} label={t("session.variantes")}
                            placeholder={t("session.variante")} onCommit={(v) => onUpdateField(i, "variant", v)} />
        </div>
        )}
        <div>
          <span className={LIBELLE}>{t("session.lienVideoRessource")}</span>
          <LinkEdit value={ex.link} onCommit={(v) => onUpdateField(i, "link", v)} />
        </div>
        <div>
          <span className={LIBELLE}>{t("session.noteCoach")}</span>
          <NoteArea value={ex.coachNote} label={t("session.noteCoach")} placeholder={t("session.noteCoachPlaceholder")} onCommit={(v) => onUpdateField(i, "coachNote", v)} />
        </div>
        <div>
          <span className={LIBELLE}>{t("session.retourDeLAthlete")}</span>
          <p className="min-h-[2.5rem] rounded-md border border-border bg-card px-2.5 py-2 italic text-foreground/90">
            {ex.athleteFeedback ? `« ${ex.athleteFeedback} »` : <span className="not-italic text-muted-foreground">{t("session.aucunRetour")}</span>}
          </p>
        </div>
      </div>

      {(ex.restActual || aDuDetail) && (
        <div className="mt-3 flex flex-wrap gap-4">
          {ex.restActual && (
            <div>
              <span className={LIBELLE}>{t("session.reposReel")}</span>
              <p className="inline-flex items-center gap-1 rounded-md border border-gold/20 bg-gold/10 px-2.5 py-1.5 font-mono tabular-nums text-gold/90">
                <Clock3 className="h-3 w-3 shrink-0" /><span>{ex.restActual}</span>
              </p>
            </div>
          )}
          {/* LE DÉTAIL PAR SÉRIE, lu : ce que l'athlète a noté série par série. */}
          {aDuDetail && (
            <div>
              <span className={LIBELLE}>{t("session.detailParSerie")}</span>
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: setCount }, (_, k) => (
                  <span key={k} className="rounded-md border border-border bg-card px-2 py-1 font-mono text-[11px] tabular-nums">
                    <span className="text-muted-foreground">{k + 1} · </span>
                    {parSerie.reps[k] || "—"}{ex.repsUnit === "sec" ? " s" : ""}
                    {parSerie.charge[k] ? ` · ${parSerie.charge[k]} kg` : ""}
                    {parSerie.rpe[k] ? <span style={{ color: rpeDotColor(parSerie.rpe[k]) }}> · RPE {parSerie.rpe[k]}</span> : ""}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {blockWeeks && blockWeeks.length >= 1 && (
        <div className="mt-3">
          <ExerciseProgression session={session} exerciseIndex={i} blockWeeks={blockWeeks} shareBlock={shareBlock} />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
        {actions}
      </div>
    </div>
  );
}
