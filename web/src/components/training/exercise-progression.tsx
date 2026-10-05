import { useMemo, type ReactNode } from "react";
import type { RenduProgression, SessionEditing, WeekEditing } from "@/api/types";
import { cn } from "@/lib/utils";
import { usePreferenceProgression } from "@/lib/preference-progression";
import { buildExerciseProgressionPoints, type ProgressionPoint } from "./exercise-progression-data";
import { useTranslation } from 'react-i18next';
import { ShareExerciseDialog } from "./share-exercise-dialog";
import { afficherVariantes } from "@/lib/variantes";
import { ProgressionBloc, SelecteurDeRendu } from "./progression";
import { bornesDeCharge, kg } from "./progression/socle";

/** Progression d'un exercice sur toutes les semaines du bloc.
 *  Reconstruit la grille séries/reps/charge/RPE réel par semaine.
 *
 *  On rapproche le « même créneau » d'une semaine à l'autre par NOM de séance
 *  (stable : « Pull lourd » revient chaque semaine) puis index d'exercice — les
 *  id, eux, diffèrent d'une semaine à l'autre. Rien n'est affiché s'il
 *  n'y a qu'une seule semaine renseignée. */

interface Props {
  session: SessionEditing;
  exerciseIndex: number;
  blockWeeks: WeekEditing[];
  /** Bloc courant — sert de bandeau à l'image de partage. Absent = pas de
   *  partage proposé : sans contexte l'image ne situerait pas la progression. */
  shareBlock?: string;
  /** Le titre de la carte. Le pli lui passe le sien (« Sur ce bloc ») pour
   *  n'avoir qu'UN intitulé : deux à vingt pixels d'écart se lisent deux fois. */
  titre?: string;
}

/** ⚠️ LE CONTEXTE D'USAGE, PAS LA TAILLE DE L'ÉCRAN (FRE-167). En vue SEMAINE
 *  la carte vit dans le pli ; dans la BASE elle sert de matériau de référence,
 *  une seule dépliée à la fois sous un mouvement. Une requête média se serait
 *  trompée de question : ce n'est pas l'écran qui change, c'est ce qu'on vient y
 *  faire. */
export type ContexteProgression = 'semaine' | 'base';

/** « 7,5 → 15 kg  +7,5 kg » — la réponse d'un créneau en une ligne. En tête de la
 *  carte dans le pli, sur la ligne repliée de l'historique de la BASE : une seule
 *  écriture, puisque c'est la même lecture. */
export function TrajectoireDeCharge({ points }: { points: ProgressionPoint[] }) {
  const { premiere, derniere, delta } = bornesDeCharge(points);
  return (
    <>
      <span className="shrink-0 font-mono text-[12px] tabular-nums text-foreground/90">
        {premiere !== null && derniere !== null
          ? `${kg(premiere)} → ${kg(derniere)} kg`
          : <span className="text-muted-foreground">—</span>}
      </span>
      {/* ⚠️ LARGEUR FIXE ET ALIGNÉ À DROITE : « +15 kg » et « −2,5 kg » ne doivent
          pas décaler la colonne d'une ligne à l'autre. */}
      <span className={cn("min-w-[52px] shrink-0 text-right font-mono text-[12px] font-semibold tabular-nums",
                          delta === null ? "text-muted-foreground"
                            : delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : "text-muted-foreground")}>
        {delta === null || delta === 0 ? "" : `${delta > 0 ? "+" : "−"}${kg(Math.abs(delta))} kg`}
      </span>
    </>
  );
}

export function ExerciseProgressionCard({
  points,
  title,
  subtitle,
  className,
  action,
  contexte = 'semaine',
  semaineCourante,
  rendu = 'courbe',
  onChoisirRendu,
}: {
  points: ProgressionPoint[];
  title?: string;
  subtitle?: string;
  className?: string;
  /** Rendu à droite de l'en-tête (bouton de partage). */
  action?: ReactNode;
  /** Cf. `ContexteProgression`. La vue semaine ne passe rien et ne bouge pas. */
  contexte?: ContexteProgression;
  /** Le `label` de la semaine en cours (« S3 ») — en or en tête de sa colonne.
   *  Absent en contexte `base`, où aucune semaine n'est « en cours ». */
  semaineCourante?: string;
  /** Le rendu choisi par la personne qui regarde ; `courbe` sans préférence. */
  rendu?: RenduProgression;
  /** Présent = le sélecteur rapide s'affiche et écrit la préférence. */
  onChoisirRendu?: (rendu: RenduProgression) => void;
}) {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t("training.progressionSurLeBloc");
  if (points.length === 0) return null;
  const enBase = contexte === 'base';

  const courante = semaineCourante === undefined ? -1 : points.findIndex(p => p.label === semaineCourante);
  const selecteur = onChoisirRendu ? <SelecteurDeRendu rendu={rendu} onChoisir={onChoisirRendu} /> : null;

  /* ⚠️ UNE SEULE CARTE, PARTOUT — dans le pli et dans l'historique de la BASE
     (William, 15/09). Ce qu'elle dessine est au choix de chacun (27/09) : la
     carte porte l'en-tête, le retour de l'athlète, et confie le dessin à
     `ProgressionBloc`. */
  return (
    <div className={className}>
      {/* ⚠️ L'EN-TÊTE NE SERT PLUS EN BASE : titre et trajectoire vivent dans la
          ligne repliée juste au-dessus. Seul le sélecteur y reste. */}
      {enBase ? (selecteur && <div className="mb-1 flex justify-end">{selecteur}</div>) : (
      // Le titre ne se tronque pas pour laisser la place au sélecteur : sur une
      // colonne étroite (le pli), la droite de l'en-tête passe à la ligne.
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="min-w-0">
          <div className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{resolvedTitle}</div>
          {subtitle && <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{subtitle}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <TrajectoireDeCharge points={points} />
          {selecteur}
          {action}
        </div>
      </div>
      )}
      <div className="flex flex-col gap-2.5 rounded-md border border-border bg-card px-2.5 py-2">
        <ProgressionBloc points={points} rendu={rendu} courante={courante} />

        {(() => {
          // Dernier retour athlète saisi sur ce créneau (semaine la plus récente
          // qui en a un) — utile en semaine N quand le retour de N n'est pas
          // encore rempli mais que N-1/N-2 en avaient un.
          const last = [...points].reverse().find((p) => p.feedback.trim());
          if (!last) return null;
          return (
            /* ⚠️ IL PREND LA LARGEUR DU TABLEAU, plus une mesure de lecture à
               lui. Le `max-w-[56ch]` d'origine protégeait la prose d'une carte
               large ; depuis que la progression vit dans la colonne droite du
               pli, c'est la colonne qui borne déjà la ligne — et une boîte plus
               étroite que le tableau juste au-dessus se lisait comme un reste.

               Le filet doré le rattache à la semaine qu'il commente : c'est la
               même marque que porte la ligne courante du tableau. */
            <div className="overflow-hidden rounded-md border border-border/70 bg-muted/20
                            px-2.5 py-2 text-[11px] leading-snug text-foreground/90"
                 style={{ boxShadow: 'inset 3px 0 0 var(--gold)' }}>
              <div className="mb-0.5 font-display text-[10px] uppercase tracking-wider text-gold">
                {last.label}
              </div>
              {last.feedback}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

export function ExerciseProgression({ session, exerciseIndex, blockWeeks, shareBlock, titre }: Props) {
  const points = useMemo(
    () => buildExerciseProgressionPoints(session, exerciseIndex, blockWeeks),
    [blockWeeks, session, exerciseIndex],
  );
  const { rendu, choisir } = usePreferenceProgression();

  /** La semaine où l'on se trouve — celle qui contient CETTE séance. Le point ne
   *  la porte pas : il décrit un créneau vu depuis toutes les semaines, et
   *  « courante » est une propriété de l'écran, pas de la donnée. */
  const semaineCourante = useMemo(() => {
    const w = blockWeeks.find((s) => (s.sessions ?? []).some((x) => (x.id ?? '') === (session.id ?? '')));
    return w ? `S${w.weekNumber}` : undefined;
  }, [blockWeeks, session.id]);

  const ex = session.exercises[exerciseIndex];
  return (
    <ExerciseProgressionCard
      points={points}
      title={titre}
      semaineCourante={semaineCourante}
      rendu={rendu}
      onChoisirRendu={choisir}
      action={ex && shareBlock ? (
        <ShareExerciseDialog
          session={session}
          points={points}
          name={ex.name ?? ''}
          detail={[afficherVariantes(ex.variant), ex.format, ex.tempo, ex.assistance].map(v => (v ?? '').trim()).filter(Boolean).join(' · ')}
          contextLabel={shareBlock}
        />
      ) : undefined}
    />
  );
}
