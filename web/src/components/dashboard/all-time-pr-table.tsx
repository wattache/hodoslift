import { useEffect, useState } from "react";
import { Dumbbell, Eye, Pencil, Trophy } from "lucide-react";
import type { Competition, RecordDeForce } from "@/api/types";
import { computeCompetitionPRs, type CompetitionPR } from "@/lib/selectors";
import { formatShort } from "@/lib/dates-ui";
import { MOVEMENT_LABELS, PRINCIPAL_MOVEMENTS, type PrincipalMovement } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface Props {
  /** ⚠️ LES RECORDS ARRIVENT CALCULÉS depuis le 26/08 (FRE-71 §9). Le composant
   *  recevait l'arbre d'entraînement ENTIER et le parcourait pour remplir cette
   *  grille — jusqu'à 838 lignes pour cinq colonnes de dix cases. */
  records: RecordDeForce[];
  competitions?: Competition[];
  athleteUids?: Array<string | null | undefined>;
  athleteName?: string;
  manualPRs?: Record<string, Record<number, number>>;
  onUpdateManualPR?: (movement: string, reps: number, weight: number) => void | Promise<void>;
}

const REPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

type ManualPR = {
  weight: number;
  reps: number;
  movement: PrincipalMovement;
};

type MergedPR =
  | (RecordDeForce & { source: "training" })
  | (CompetitionPR & { source: "competition" })
  | (ManualPR & { source: "manual" });

const SOURCE_RANK: Record<MergedPR["source"], number> = {
  competition: 0,
  training: 1,
  manual: 2,
};

export function AllTimePrTable({
  records,
  competitions = [],
  athleteUids = [],
  athleteName,
  manualPRs,
  onUpdateManualPR,
}: Props) {
  const { t } = useTranslation();
  const [editMode, setEditMode] = useState(false);
  // Indexé une fois, par (mouvement, reps) : la grille interroge 50 cases.
  const trainingMatrix = new Map(records.map(r => [`${r.movement}/${r.reps}`, r]));
  const competitionPRs = computeCompetitionPRs(competitions, athleteUids, athleteName);
  const canEdit = !!onUpdateManualPR;
  const editing = canEdit && editMode;

  const getMergedPR = (movement: PrincipalMovement, reps: number): MergedPR | null => {
    const trainingPR = trainingMatrix.get(`${movement}/${reps}`);
    const competitionPR = reps === 1 ? competitionPRs[movement] : undefined;
    const manualWeight = manualPRs?.[movement]?.[reps];
    const manualPR: ManualPR | undefined = typeof manualWeight === "number" && manualWeight > 0
      ? { weight: manualWeight, reps, movement }
      : undefined;

    const candidates: Array<{ weight: number; pr: MergedPR }> = [];
    if (trainingPR) candidates.push({ weight: trainingPR.weight, pr: { ...trainingPR, source: "training" } });
    if (competitionPR) candidates.push({ weight: competitionPR.weight, pr: { ...competitionPR, source: "competition" } });
    if (manualPR) candidates.push({ weight: manualPR.weight, pr: { ...manualPR, source: "manual" } });

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.weight - a.weight || SOURCE_RANK[a.pr.source] - SOURCE_RANK[b.pr.source]);
    return candidates[0].pr;
  };

  const visibleReps = editing
    ? REPS
    : REPS.filter((reps) => reps === 1 || PRINCIPAL_MOVEMENTS.some((movement) => getMergedPR(movement, reps)));

  // The "trophy" goes on the heaviest PR per movement (max weight any reps).
  const heaviestRepByMovement = Object.fromEntries(
    PRINCIPAL_MOVEMENTS.map((m) => {
      const entries = REPS
        .map((reps) => [reps, getMergedPR(m, reps)] as const)
        .filter((entry): entry is readonly [number, MergedPR] => entry[1] !== null);
      if (!entries.length) return [m, null];
      const [reps] = entries.reduce((best, current) => (current[1].weight > best[1].weight ? current : best));
      return [m, reps];
    }),
  ) as Record<string, number | null>;

  /* ⚠️ UNE COLONNE VIDE SUR TOUTE SA HAUTEUR NE DIT QUE « RIEN », et elle le dit
     sur un septième de la largeur. Le bench et le deadlift viennent d'apparaître
     et ne sont renseignés sur AUCUN athlète (mesuré, cf. `rm-percentage-table`) :
     deux colonnes de tirets qui poussent les cinq autres à se serrer.
     Elles se replient — et se ROUVRENT, parce que le jour où le premier record y
     tombe, il ne doit pas rester invisible. En ÉDITION, tout reste ouvert : on
     ne peut pas saisir dans une colonne qu'on a cachée. */
  const [colonnesRepliees, setColonnesRepliees] = useState(true);
  const mouvementsVides = PRINCIPAL_MOVEMENTS.filter(
    m => !REPS.some(r => getMergedPR(m, r)));
  /* ⚠️ ON NE REPLIE QUE CE QUI EST MINORITAIRE, et c'est le harnais réel qui l'a
     trouvé : sur un athlète neuf — un seul record — SIX colonnes sur sept se
     repliaient, et la grille se réduisait à « Reps | Squat | +6 repliées ».
     Elle cessait d'être une grille.

     Replier économise la place quand deux colonnes sur sept disent « rien » ;
     quand c'est la majorité, ce n'est plus du bruit, c'est l'état de l'athlète —
     et le tableau doit montrer les mouvements où il PEUT poser un record. */
  const replier = colonnesRepliees && !editing
    && mouvementsVides.length > 0
    && mouvementsVides.length <= PRINCIPAL_MOVEMENTS.length / 2;
  const colonnes = replier
    ? PRINCIPAL_MOVEMENTS.filter(m => !mouvementsVides.includes(m))
    : [...PRINCIPAL_MOVEMENTS];

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
        {/* Même traitement que la Table RM : deux tableaux voisins doivent porter
            le même titre, sinon l'un paraît plus important que l'autre sans
            raison. */}
        <h3 className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-display text-[19px] font-bold uppercase tracking-[0.01em] text-gold">
          <span className="flex items-center gap-2">
            <Trophy className="h-4 w-4 self-center" /> {t('charts.recordsPersonnels')}
          </span>
          {/* ⚠️ LE FOND DORÉ MARQUAIT LA COMPÉTITION DEPUIS TOUJOURS, ET RIEN NE
              LE DISAIT. Une convention de couleur sans légende n'est pas une
              convention : c'est une décoration que le lecteur interprète comme il
              peut. Deux pastilles, une fois, en tête de tableau. */}
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 font-normal text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-gold" aria-hidden /> {t('charts.enCompetition')}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm border border-border bg-card" aria-hidden /> {t('charts.aLEntrainement')}
            </span>
          </span>
        </h3>
        <div className="flex items-center gap-3">
        {replier && (
          <span className="hidden font-mono text-[10px] text-muted-foreground sm:block">
            {t('charts.colonnesRepliees', {
              mouvements: mouvementsVides.map(m => MOVEMENT_LABELS[m]).join(' · '),
            })}
          </span>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={() => setEditMode((value) => !value)}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
              editing
                ? "bg-gold/15 text-gold hover:bg-gold/20"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {editing ? (
              <>
                <Eye className="h-3 w-3" /> {t("goals.preview")}
              </>
            ) : (
              <>
                <Pencil className="h-3 w-3" /> {t("goals.edit")}
              </>
            )}
          </button>
        )}
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-xs tabular-nums">
          <thead>
            <tr className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <th className="w-16 px-3 py-2 text-left font-normal">Reps</th>
              {colonnes.map((m) => (
                <th key={m} className="px-3 py-2 text-center font-normal">
                  {MOVEMENT_LABELS[m]}
                </th>
              ))}
              {replier && (
                <th className="px-3 py-2 text-right font-medium">
                  <button
                    type="button"
                    onClick={() => setColonnesRepliees(false)}
                    className="h-8 rounded px-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    +{mouvementsVides.length} {t('charts.repliees')}
                  </button>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {visibleReps.map((r) => (
              <tr key={r} className={cn("border-t border-border/40",
                                        // La rangée à 1 rep porte les maxima : c'est
                                        // celle qu'on vient lire en premier.
                                        r === 1 && "bg-gold/5")}>
                <td className={cn("px-3 py-2.5 text-left",
                                  r === 1 ? "font-bold text-foreground" : "text-muted-foreground")}>{r}</td>
                {colonnes.map((m) => {
                  const pr = getMergedPR(m, r);
                  const manualOverride = manualPRs?.[m]?.[r];
                  const isHeaviest = heaviestRepByMovement[m] === r;
                  if (editing) {
                    return (
                      <td
                        key={m}
                        className={cn(
                          "min-w-28 px-2 py-2 text-center",
                          isHeaviest && "bg-gold/5",
                          pr?.source === "competition" && "bg-success/5",
                          pr?.source === "manual" && "bg-gold/5",
                        )}
                      >
                        <PrValue pr={pr} isHeaviest={isHeaviest} />
                        <ManualPrInput
                          value={manualOverride}
                          label={`Record manuel ${m} ${r} rep${r > 1 ? "s" : ""}`}
                          onCommit={(weight) => {
                            onUpdateManualPR?.(m, r, weight);
                          }}
                        />
                      </td>
                    );
                  }

                  if (!pr) {
                    return (
                      <td key={m} className="px-3 py-2.5 text-center text-muted-foreground/30">—</td>
                    );
                  }
                  return (
                    <td
                      key={m}
                      className={cn(
                        "min-w-28 px-3 py-2.5 text-center",
                        isHeaviest && "bg-gold/5",
                        pr.source === "competition" && "bg-success/5",
                        pr.source === "manual" && "bg-gold/5",
                      )}
                    >
                      <PrValue pr={pr} isHeaviest={isHeaviest} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PrValue({ pr, isHeaviest }: { pr: MergedPR | null; isHeaviest: boolean }) {
  if (!pr) {
    return <div className="mb-1.5 text-muted-foreground/30">—</div>;
  }

  return (
    /* ⚠️ LA CHARGE D'ABORD, ET PLUS GROSSE QUE LE RESTE. La cellule empilait trois
       lignes de poids visuel comparable — charge, schéma, lieu — alors qu'on vient
       y chercher UNE chose. 17 px pour le kilo, 10 px pour le contexte : la
       colonne se balaie sans lire. */
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex items-baseline justify-center gap-1 font-mono text-[17px] font-bold leading-none text-gold">
        {isHeaviest && <Trophy className="h-3 w-3 self-center" />}
        <span>{formatWeight(pr.weight)}</span>
        <span className="text-[10px] font-normal text-muted-foreground">kg</span>
      </div>
      <SourceLabel pr={pr} />
    </div>
  );
}

function SourceLabel({ pr }: { pr: MergedPR }) {
  if (pr.source === "competition") {
    return (
      <div className="flex max-w-40 items-center justify-center gap-1 text-[10px] text-success" title={pr.compName}>
        <Trophy className="h-2.5 w-2.5 shrink-0" />
        <span className="break-words">{pr.compName}</span>
        {pr.date && <span className="shrink-0 text-muted-foreground">· {formatShort(pr.date)}</span>}
      </div>
    );
  }

  if (pr.source === "manual") {
    return (
      <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
        <Pencil className="h-2.5 w-2.5 text-gold" />
        <span>historique</span>
      </div>
    );
  }

  const detail = formatTrainingDetail(pr);
  const variant = (pr.variant ?? "").trim();
  return (
    <div className="flex max-w-40 flex-col items-center gap-0.5 text-[10px] text-muted-foreground" title={pr.location}>
      <div className="flex items-center justify-center gap-1">
        <Dumbbell className="h-2.5 w-2.5 shrink-0 text-foreground/70" />
        <span>{detail || pr.location}</span>
        {pr.date && <span className="shrink-0">· {formatShort(pr.date)}</span>}
      </div>
      {variant && (
        <span className="rounded bg-muted/50 px-1 py-px text-[9px] uppercase leading-tight tracking-wide text-foreground/70">
          {variant}
        </span>
      )}
    </div>
  );
}

function ManualPrInput({
  value,
  onCommit,
  label,
}: {
  value: number | undefined;
  onCommit: (weight: number) => void | Promise<void>;
  /** ⚠️ SON SEUL NOM ACCESSIBLE. Les en-têtes de cette grille sont des `th` de
   *  mouvement et de reps, mais rien ne les relie à la case : un lecteur d'écran
   *  n'annonçait qu'un champ « kg » identique sur les cinquante cellules. */
  label: string;
}) {
  const [draft, setDraft] = useState(value != null ? String(value) : "");

  useEffect(() => {
    setDraft(value != null ? String(value) : "");
  }, [value]);

  const commit = () => {
    const raw = draft.replace(",", ".").trim();
    if (raw === "") {
      if (value !== undefined) onCommit(0);
      return;
    }

    const next = parseFloat(raw);
    if (Number.isNaN(next) || next < 0) {
      setDraft(value != null ? String(value) : "");
      return;
    }
    if (next === value) return;
    onCommit(next);
  };

  return (
    <input
      value={draft}
      aria-label={label}
      inputMode="decimal"
      placeholder="kg"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        if (event.key === "Escape") {
          setDraft(value != null ? String(value) : "");
          (event.target as HTMLInputElement).blur();
        }
      }}
      className="mt-1.5 h-7 w-16 rounded-md border border-border bg-background px-1.5 text-center font-mono text-[11px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/45 focus:border-gold"
    />
  );
}

function formatWeight(weight: number): string {
  return Number.isInteger(weight) ? String(weight) : weight.toFixed(1);
}

/** Détail d'exécution SANS la variante : celle-ci a sa propre ligne, parce
 *  qu'elle est souvent longue (« SOFT SLEEVES SQUAT ») et qu'entassée ici elle
 *  faisait tronquer toute la ligne — on perdait alors AUSSI le RPE et la date. */
function formatTrainingDetail(pr: RecordDeForce): string {
  const parts = [
    pr.format,
    pr.sets && `${pr.sets}x${pr.reps}`,
    pr.rpe && `@ ${pr.rpe}`,
  ].filter(Boolean);
  return parts.join(" ");
}
