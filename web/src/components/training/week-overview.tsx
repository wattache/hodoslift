import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import type { ExerciseEditing, WeekEditing } from "@/api/types";
import { chaineSansLacher, estChronometre, leReposSeSaisit, libelleGroupe, natureDe, rangDansLeGroupe } from "@/lib/groupe";
import { badgeKind, isTraining } from "@/lib/exercise-kind";
import { afficherVariantes } from "@/lib/variantes";
import { rpeDotColor } from "@/lib/rpe";
import { cn } from "@/lib/utils";
import { champsDuGroupe, formatBadgeSuffix, formatReps, formatRestWithActual } from "./format";
import { chargeEtAssistance } from "@/lib/weight";

/** L'APERÇU D'UNE SEMAINE — un carnet de coach, pas un tableau de bord.
 *
 *  ⚠️ CE QUI A CHANGÉ, ET POURQUOI. La version précédente enfermait la semaine
 *  dans une carte (fond, bordure, ombre portée) et découpait chaque ligne en
 *  pastilles grises : une pastille pour les séries, une pour le tempo, une pour
 *  le repos, une pour le RPE. C'est la grammaire d'un tableau de bord — des
 *  éléments hétérogènes qu'on isole les uns des autres parce qu'ils n'ont rien
 *  à voir entre eux.
 *
 *  Une séance n'est pas ça. C'est une LISTE HOMOGÈNE : les mêmes grandeurs, une
 *  ligne par exercice, qu'on lit en colonne pour comparer. Ce qui la rend
 *  lisible, ce n'est pas de séparer les valeurs — c'est de les ALIGNER. D'où
 *  une grille à colonnes fixes, des filets à la place des cadres, et les
 *  chiffres en chasse fixe : la charge de l'exercice 3 tombe exactement sous
 *  celle de l'exercice 2, et l'œil descend la colonne sans effort.
 *
 *  La hiérarchie ne vient plus des fonds mais de la TYPOGRAPHIE : condensée en
 *  capitales pour les jours, la charge en or et en corps supérieur (c'est le
 *  chiffre qu'on cherche), le reste en gris et plus petit.
 *
 *  ⚠️ `article[aria-label^="Aperçu"]` EST UN POINT D'ANCRAGE DE TEST — trois
 *  specs du harnais réel s'en servent pour dire « l'aperçu est là ». Il reste,
 *  quoi qu'il arrive à la mise en forme.
 */

interface Props {
  week: WeekEditing;
}

function exerciseNumbers(exercises: ExerciseEditing[]): number[] {
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

/** ⚠️ LA MÊME GRILLE POUR TOUTES LES LIGNES, en-tête compris — c'est ce qui
 *  fait tenir l'alignement. En dessous de `sm`, les colonnes annexes passent
 *  sous le nom : sur un téléphone posé sur un banc, on veut le mouvement et la
 *  charge, pas cinq colonnes de 40 pixels. */
const GRILLE = "grid grid-cols-[1.25rem_minmax(0,1fr)_4.25rem] sm:grid-cols-[1.5rem_minmax(0,1fr)_4.5rem_5.5rem_6.5rem] gap-x-3";

export function WeekOverview({ week }: Props) {
  const { t } = useTranslation();

  return (
    <article
      className="mx-auto w-full max-w-[880px] px-1 sm:px-2"
      aria-label={t('week.apercuDe', { nom: week.name || t('week.semaineN', { n: week.weekNumber }) })}
    >
      {/* Le titre de la semaine tient le haut de page comme l'en-tête d'un
          carnet : un filet épais, rien d'autre. Plus de cadre autour du tout. */}
      <header className="mb-7 border-b-2 border-gold pb-2">
        <h3 className="font-display text-2xl font-bold uppercase leading-none tracking-[0.05em]">
          {week.name || t('week.semaineN', { n: week.weekNumber })}
        </h3>
      </header>

      <div className="flex flex-col gap-9">
        {(week.sessions ?? []).map((session, sessionIndex) => {
          const numbers = exerciseNumbers(session.exercises);

          return (
            <section key={session.id || sessionIndex}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h4 className="truncate font-display text-lg font-bold uppercase leading-none tracking-[0.08em] text-gold">
                  {session.name}
                </h4>
                <span className="shrink-0 font-display text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  {session.exercises.length} {t("session.exos")}
                </span>
              </div>

              {/* L'en-tête de colonnes : ce qui remplace les pastilles. Il n'est
                  écrit qu'une fois par séance, au lieu d'être répété sur chaque
                  valeur de chaque ligne — vingt libellés en moins par séance. */}
              <div className={cn(GRILLE, "border-y border-border/70 py-1 font-display text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70")}>
                <span aria-hidden />
                <span>{t("session.mouvement")}</span>
                <span className="text-right">{t("session.series")}</span>
                <span className="hidden text-right sm:block">{t("session.charge")}</span>
                <span className="hidden text-right sm:block">{t("session.annexes")}</span>
              </div>

              <ol className="flex flex-col">
                {session.exercises.map((exercise, exerciseIndex) => {
                  const groupId = exercise.groupId;
                  const groupSize = groupId
                    ? session.exercises.filter((item) => item.groupId === groupId).length
                    : 0;
                  const inGroup = groupSize > 1;
                  // Lue, pas déduite : le serveur rend la nature résolue (FRE-36).
                  const nature = natureDe(exercise);
                  const firstInGroup = inGroup && session.exercises.findIndex((item) => item.groupId === groupId) === exerciseIndex;
                  const continuation = inGroup && !firstInGroup;
                  // La MÊME fonction que le Détail depuis le 20/08 : les deux vues
                  // calculaient ça séparément, et elles avaient divergé.
                  const weightParts = chargeEtAssistance(exercise);
                  const rest = formatRestWithActual(exercise.rest, exercise.restActual);
                  const tempo = exercise.tempo || "";
                  const rpeColor = exercise.aimedRPE ? rpeDotColor(exercise.aimedRPE) : undefined;
                  const repsLabel = formatReps(exercise.reps, exercise.repsUnit, exercise.repsDone);
                  const charge = weightParts.length > 0 ? weightParts.join(" ") : "—";

                  return (
                    <Fragment key={exerciseIndex}>
                    {inGroup && firstInGroup && (
                      <li className={cn(GRILLE, "items-baseline border-b border-border/40 pb-1 pt-3")}>
                        <span aria-hidden />
                        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          {/* Le bloc s'annonce par un mot en lettrage condensé et
                              un filet vertical, pas par une gélule colorée. */}
                          <span className={cn("whitespace-nowrap font-display text-[11px] font-bold uppercase tracking-[0.12em]",
                            estChronometre(nature) ? "text-metric" : "text-gold")}>
                            {libelleGroupe(groupSize, nature)}
                          </span>
                          {/* Les mêmes champs étiquetés que le Détail (2a). Un
                              dropset n'a pas de repos entre ses descentes :
                              l'annoncer ici ferait mentir l'Aperçu, qui doit dire
                              EXACTEMENT ce que la séance contient. */}
                          {champsDuGroupe(nature, groupSize, exercise, leReposSeSaisit(nature) ? rest : "").map((c) => (
                            <span key={c.libelle} className="flex items-baseline gap-1">
                              <span className="font-mono text-[11px] font-semibold text-foreground">{c.valeur}</span>
                              <span className="font-display text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{c.libelle}</span>
                            </span>
                          ))}
                          {nature === "amrap" && (
                            <span className="font-display text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                              {exercise.toursRealises !== null
                                ? t("session.nTours", { n: exercise.toursRealises })
                                : t("session.maxDeTours")}
                            </span>
                          )}
                        </span>
                      </li>
                    )}
                    {inGroup && chaineSansLacher(session.exercises, exerciseIndex)?.debut && (
                      <li className={cn(GRILLE, "relative pt-1.5")}>
                        <span className="absolute bottom-0 left-[0.55rem] top-0 w-[3px] bg-gold/60" aria-hidden />
                        <span aria-hidden />
                        <span className="font-display text-[10px] font-bold uppercase tracking-[0.12em] text-gold">
                          {t("session.sansLacherMouvements", { n: chaineSansLacher(session.exercises, exerciseIndex)!.mouvements })}
                        </span>
                      </li>
                    )}
                    <li
                      className={cn(
                        GRILLE,
                        "relative items-baseline border-b border-border/40 py-2",
                        continuation && "pt-1",
                      )}
                    >
                      {inGroup && (
                        <span aria-hidden className={cn("absolute bottom-0 left-[0.55rem] top-0",
                          chaineSansLacher(session.exercises, exerciseIndex) ? "w-[3px]" : "w-px",
                          nature === "amrap" ? "border-l border-dotted border-metric"
                            : nature === "emom" ? "bg-metric" : "bg-gold/50")} />
                      )}
                      <span className={cn("text-right font-mono text-[11px] leading-6",
                        inGroup && nature === "emom" ? "font-semibold text-metric" : "text-muted-foreground/60")}>
                        {/* Dans un groupe, la place dans le tour — ou la minute
                            d'un EMOM — plutôt qu'un numéro répété (2a). */}
                        {inGroup
                          // Le rang seul : le total est dans l'en-tête, et « 1/4 » ou
                          // « MIN 1 » chevaucheraient le filet dans cette colonne
                          // étroite. Dans un EMOM, sa couleur dit qu'il s'agit de
                          // minutes — l'en-tête donne l'intervalle.
                          ? rangDansLeGroupe(session.exercises, exerciseIndex) + 1
                          : numbers[exerciseIndex] + 1}
                      </span>

                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                          <span className="min-w-0 truncate text-[15px] font-medium leading-6">
                            {/* Un dropset n'a qu'un exercice : le répéter à
                                chaque descente le ferait lire comme plusieurs
                                mouvements. L'Aperçu doit dire EXACTEMENT ce que
                                la séance contient. */}
                            {nature === 'dropset' && continuation
                              ? <span className="text-muted-foreground/50" title={t('session.memeExerciceQueLaDescente')}>↑</span>
                              : (exercise.name || "—")}
                            {/* Le libellé, pas la liste : `[]` est truthy. */}
                            {afficherVariantes(exercise.variant) && <span className="font-normal italic text-muted-foreground"> · {afficherVariantes(exercise.variant)}</span>}
                          </span>
                          {/* NATURE (FRE-10) — sans elle, un coach qui marque une
                              ligne en échauffement dans la BASE ne verrait rien
                              changer dans l'aperçu de la semaine générée.
                              Étiquette au trait, plus pastille pleine : elle
                              qualifie le mouvement, elle ne le concurrence pas. */}
                          {!isTraining(exercise) && exercise.kind && exercise.kind !== "training" && (
                            <span className="shrink-0 font-display text-[10px] font-bold uppercase tracking-[0.12em] text-gold/80">
                              {badgeKind(exercise.kind, t)}
                            </span>
                          )}
                          {exercise.format && (
                            <span className="shrink-0 font-display text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                              {exercise.format}
                              {formatBadgeSuffix(exercise)}
                            </span>
                          )}
                        </div>
                        {/* Sous `sm`, la charge et les annexes reviennent sous le
                            nom — les colonnes ne tiennent pas sur un téléphone,
                            mais l'information reste dans le même ordre. */}
                        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 font-mono text-[11px] text-muted-foreground sm:hidden">
                          <span className="font-semibold text-gold">{charge}</span>
                          {tempo && <span>{tempo}</span>}
                          {rest && !inGroup && <span>{rest}</span>}
                          {exercise.aimedRPE && (
                            <span style={rpeColor ? { color: rpeColor } : undefined}>
                              RPE {exercise.aimedRPE}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Séries et repos décrivent le TOUR du bi-set, pas chaque
                          exercice — les répéter sur la seconde ligne se lit comme
                          deux prescriptions indépendantes. */}
                      <span className="text-right font-mono text-[13px] leading-6">
                        {inGroup ? repsLabel : `${exercise.sets || "—"} × ${repsLabel}`}
                      </span>

                      {/* LA CHARGE — le chiffre qu'on vient chercher. Seule
                          valeur en or et au-dessus du corps courant : la
                          hiérarchie se lit sans qu'aucun cadre ne l'entoure. */}
                      <span className="hidden text-right font-mono text-[15px] font-semibold leading-6 text-gold sm:block">
                        {charge}
                      </span>

                      <span className="hidden justify-end gap-2 text-right font-mono text-[11px] leading-6 text-muted-foreground sm:flex">
                        {tempo && <span>{tempo}</span>}
                        {rest && !inGroup && <span>{rest}</span>}
                        <span
                          className="min-w-[1.75rem] text-right"
                          style={rpeColor ? { color: rpeColor } : undefined}
                        >
                          {exercise.aimedRPE || "—"}
                        </span>
                      </span>
                    </li>
                    </Fragment>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>
    </article>
  );
}
