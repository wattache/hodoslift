import { useEffect, useMemo, useState } from "react";
import { aireEntreCourbes, cheminAdouci } from "@/lib/courbe";
import { cn } from "@/lib/utils";
import { useTracking } from "@/api/hooks/use-tracking";
import type { TrackingResponse, TrackingWeek } from "@/api/types";
import { RpeCalibration } from "@/components/dashboard/rpe-calibration";
import { SeriesParLift } from "@/components/dashboard/series-par-lift";
import { useTranslation } from 'react-i18next';
import i18n from "@/i18n";

/* ============================================================
 * Suivi de progression — intensité vs volume, par semaine.
 *
 * Trois mesures qui, ensemble, racontent ce que la charge max seule cache :
 *   • charge max      — l'intensité de pointe atteinte dans la semaine
 *   • tonnage AU max  — le volume accumulé À cette charge (le vrai travail lourd)
 *   • tonnage total   — tout le volume du mouvement sur la semaine
 * Deux vagues peuvent monter aux mêmes charges max avec un tonnage au top set
 * du simple au double : c'est là que se voit la progression réelle.
 *
 * Les bandes de fond marquent les BLOCS (et un trait plein les changements de
 * MACRO) : sans ce repère, une rupture de courbe est illisible.
 *
 * Données : projection `training_sets` via brokkr (rebuild par ETL) → d'où la
 * mention de fraîcheur sous le graphe.
 * ============================================================ */

const C_MAX = "#F5B841";      // gold — charge max (ligne)
const C_AT_MAX = "#3B82F6";   // bleu — tonnage au top set (barre)
const C_TOTAL = "#64748B";    // ardoise — volume total (barre)
const C_RPE = "#A855F7";      // violet — RPE ressenti (bandeau)
const C_FAIL = "#EF4444";     // rouge — série échouée (« FAIL »)

/** UNE COURBE PAR COMBINAISON (FRE-182) — la palette catégorielle VALIDÉE
 *  d'`index.css` (`--serie-*`), pas des couleurs choisies ici. Cinq teintes, donc
 *  cinq courbes allumées au plus : au-delà, deux combinaisons se confondraient. */
const C_COURBES = ["var(--serie-poids)", "var(--serie-eau)", "var(--serie-forme)",
  "var(--serie-sommeil)", "var(--serie-calories)"] as const;
/** Allumées d'office : les plus travaillées. Les autres s'allument à la légende. */
const COURBES_PAR_DEFAUT = 3;

type Courbe = TrackingResponse["courbes"][number];

const cleDeCourbe = (c: Courbe) => JSON.stringify([c.variant, c.tempo, c.format]);

/** « BARBELL + PAUSE · 310 · EMOM », ou « sans variante » quand la combinaison
 *  ne dit rien — une combinaison comme une autre (FRE-182). */
function libelleDeCourbe(c: Courbe): string {
  const morceaux = [c.variant.join(" + "), c.tempo ?? "", c.format ?? ""].filter(Boolean);
  return morceaux.length ? morceaux.join(" · ") : i18n.t("charts.sansVariante");
}

/** Le tonnage est NULL sur tout travail au poids du corps : sur ces mouvements
 *  (LEG RAISE, POMPES…) il masque la moitié du travail → on compte les reps. */
export type VolumeMode = "tonnage" | "reps";

// Largeur de base ; le viewBox s'élargit avec le nombre de semaines pour que
// les barres et les libellés gardent de l'air (le conteneur défile alors
// horizontalement plutôt que de tout écraser).
const W_MIN = 880;
const W_PER_WEEK = 46;
const H = 320;
const PAD_L = 46;
const PAD_R = 46;
const PAD_T = 16;
const PAD_B = 44;

function chartWidth(n: number): number {
  return Math.max(W_MIN, PAD_L + PAD_R + n * W_PER_WEEK);
}

function fmtWeek(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  // ⚠️ LA LANGUE VIENT D'i18n, elle n'est pas figée — « 06 août » sous une
  // interface anglaise, c'est l'axe qui trahit ce que tout le reste traduit.
  return d.toLocaleDateString(i18n.language, { day: "2-digit", month: "short" });
}

function fmtKg(v: number | null): string {
  if (v == null) return "—";
  return v >= 1000 ? `${(v / 1000).toFixed(1)} t` : `${Math.round(v)} kg`;
}

/** Tranches contiguës de semaines partageant le même (macro, bloc). Générique :
 *  sert au graphe par mouvement ET au bandeau RPE (timelines différentes). */
function phaseBands(weeks: { macroNumber: number | null; blockNumber: number | null }[]) {
  const bands: { from: number; to: number; macro: number | null; block: number | null }[] = [];
  weeks.forEach((w, i) => {
    const last = bands[bands.length - 1];
    if (last && last.macro === w.macroNumber && last.block === w.blockNumber) {
      last.to = i;
    } else {
      bands.push({ from: i, to: i, macro: w.macroNumber, block: w.blockNumber });
    }
  });
  return bands;
}

/** Infobulle : toutes les valeurs de la semaine survolée. En HTML (pas en SVG)
 *  pour hériter du thème et rester lisible quelle que soit l'échelle du viewBox. */
/** « 1 500 kg → 2 000 kg » quand des séries ont échoué, la seule valeur sinon.
 *
 *  ⚠️ LA MÊME FORME QUE PARTOUT AILLEURS DANS L'APP — `2' → 1'45"` sur le repos,
 *  `prescrit → réel` sur les reps et la charge. Le sens de la flèche va toujours
 *  du CONSTAT vers la CONSIGNE ici, parce que c'est le constat qui est la
 *  mesure : le prescrit n'est qu'un repère.
 *
 *  Rien n'est affiché en double quand rien n'a échoué : le serveur rend les deux
 *  valeurs égales, il n'y a donc pas de cas à filtrer, juste une comparaison. */
function volumeTenuPuisPrevu(w: TrackingWeek, volumeMode: VolumeMode): string {
  const tenu = volumeMode === "reps" ? w.repsTotal : w.tonnageTotalKg;
  const prevu = volumeMode === "reps" ? w.repsPrevuTotal : w.tonnagePrevuTotalKg;
  const fmt = (v: number | null) => volumeMode === "reps"
    ? (v != null ? `${Math.round(v)}` : "—")
    : fmtKg(v);
  if (tenu == null) return fmt(prevu);
  if (prevu == null || Math.round(prevu) <= Math.round(tenu)) return fmt(tenu);
  return `${fmt(tenu)} → ${fmt(prevu)}`;
}

function Tooltip({ w, leftPct, volumeMode, oneRmKg, courbes }: {
  w: TrackingWeek; leftPct: number; volumeMode: VolumeMode; oneRmKg: number | null;
  courbes: { courbe: Courbe; couleur: string }[];
}) {
  const pctRm = w.chargeMaxKg != null && oneRmKg ? Math.round((100 * w.chargeMaxKg) / oneRmKg) : null;
  // ⚠️ QUAND DES COURBES SONT ALLUMÉES, LA CHARGE SE LIT PAR COMBINAISON (FRE-182) :
  // la charge max du mouvement entier y serait celle d'une AUTRE ligne que celle
  // qu'on survole. Le volume, les séances et le RPE restent ceux du mouvement.
  const parCourbe = courbes.flatMap(({ courbe, couleur }) => {
    const s = courbe.weeks.find((x) => x.week === w.week);
    return s ? [{ cle: cleDeCourbe(courbe), couleur, libelle: libelleDeCourbe(courbe), s }] : [];
  });
  const rows: [string, string][] = [
    ...(courbes.length === 0 ? [
      [i18n.t("charts.maxLoad"), w.chargeMaxKg != null
        ? `${Math.round(w.chargeMaxKg)} kg${pctRm != null ? ` · ${pctRm} %` : ""}` : "—"],
      [i18n.t("charts.formatDuTopSet"), w.topSetFormat ?? "—"],
    ] as [string, string][] : []),
    [i18n.t("charts.tonnageTopSet"), fmtKg(w.tonnageAtMaxKg)],
    [volumeMode === "reps" ? i18n.t("charts.repsTotal") : i18n.t("charts.tonnageTotal"),
     volumeTenuPuisPrevu(w, volumeMode)],
    [i18n.t("misc.sessionsCount"), `${w.sessions}`],
    ...(w.fails > 0
      ? [[i18n.t("misc.failures"), `${w.fails}${w.failsAtMax > 0 ? ` (dont ${w.failsAtMax} au top set)` : ""}`] as [string, string]]
      : []),
    ["RPE ressenti", w.feltRpe != null ? w.feltRpe.toFixed(1) : "—"],
    ["RPE prescrit", w.aimedRpe != null ? w.aimedRpe.toFixed(1) : "—"],
  ];
  return (
    <div
      role="tooltip"
      className={cn("pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-lg border border-border bg-card p-2 shadow-[0_12px_32px_rgba(0,0,0,0.28)]",
        courbes.length ? "w-56" : "w-44")}
      // Bornée pour ne pas déborder du cadre sur les semaines extrêmes.
      style={{ left: `${Math.min(88, Math.max(12, leftPct))}%` }}
    >
      <div className="mb-1 flex items-baseline justify-between border-b border-border/60 pb-1">
        <span className="text-[11px] font-semibold">{fmtWeek(w.week)}</span>
        {w.macroNumber != null && (
          <span className="text-[9px] font-semibold text-gold">
            M{w.macroNumber}{w.blockNumber != null ? `B${w.blockNumber}` : ""}
          </span>
        )}
      </div>
      {parCourbe.length > 0 && (
        <div className="mb-1 border-b border-border/60 pb-1">
          {parCourbe.map(({ cle, couleur, libelle, s }) => (
            <div key={cle} className="flex items-baseline justify-between gap-2 text-[10px] leading-relaxed">
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: couleur }} />
                <span className="truncate">{libelle}</span>
              </span>
              <span className="shrink-0 font-mono text-foreground">
                {s.chargeMaxKg != null ? `${Math.round(s.chargeMaxKg)} kg` : "—"}
                {s.topSetFormat ? ` · ${s.topSetFormat}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2 text-[10px] leading-relaxed">
          <span className="text-muted-foreground">{k}</span>
          <span className="font-mono text-foreground">{v}</span>
        </div>
      ))}
    </div>
  );
}

function Chart({ weeks, volumeMode, hover, onHover, oneRmKg, courbes }: {
  weeks: TrackingWeek[]; volumeMode: VolumeMode;
  hover: string | null; onHover: (week: string | null) => void;
  oneRmKg: number | null;
  /** Les combinaisons ALLUMÉES, avec leur couleur. Vide : la ligne du mouvement entier. */
  courbes: { courbe: Courbe; couleur: string }[];
}) {
  const n = weeks.length;
  const W = chartWidth(n);
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  // En mode « reps », les barres comptent les répétitions : le tonnage est nul
  // sur tout ce qui se fait au poids du corps, il masquerait le travail réel.
  const volTotal = (w: TrackingWeek) =>
    volumeMode === "reps" ? w.repsTotal : w.tonnageTotalKg;
  const volAtMax = (w: TrackingWeek) =>
    volumeMode === "reps" ? null : w.tonnageAtMaxKg;

  /** Le volume PRESCRIT — ce que la semaine aurait pesé si aucune série n'avait
   *  échoué (FRE-110).
   *
   *  ⚠️ IL EXISTE POUR QU'UN ÉCHEC NE RESSEMBLE PAS À UNE ABSENCE. Depuis que le
   *  serveur ne compte que les séries TENUES, 51 lignes de production tombent à
   *  zéro : sans second repère, la barre s'effondre et se lit « il n'est pas
   *  venu » — alors que l'athlète était là, sous une barre trop lourde. C'est
   *  l'ÉCART qui porte l'information, comme `2' → 1'45"` sur le repos.
   *
   *  Les deux unités du graphe en ont un : `sets` multiplie le tonnage comme il
   *  multiplie les répétitions. */
  const volPrevu = (w: TrackingWeek) =>
    volumeMode === "reps" ? w.repsPrevuTotal : w.tonnagePrevuTotalKg;

  // Deux échelles : le volume à gauche (barres), la charge max à droite
  // (ligne) — sans ça, 200 kg face à 7000 kg écrase la courbe d'intensité.
  // ⚠️ LE PRESCRIT ENTRE DANS L'ÉCHELLE, sans quoi le repère d'une semaine
  // entièrement ratée sortirait par le haut du cadre — précisément la semaine
  // qu'il sert à expliquer.
  const maxTonnage = Math.max(
    1, ...weeks.map((w) => Math.max(volTotal(w) ?? 0, volPrevu(w) ?? 0)));
  // L'échelle droite englobe le 1RM : sinon la ligne de référence sortirait du
  // cadre dès que l'athlète travaille loin de son max.
  const maxCharge = Math.max(1, oneRmKg ?? 0, ...weeks.map((w) => w.chargeMaxKg ?? 0));

  const slot = innerW / Math.max(n, 1);
  const barW = Math.min(16, slot * 0.30);
  const xCenter = (i: number) => PAD_L + slot * (i + 0.5);
  const yTonnage = (v: number) => PAD_T + innerH - (v / maxTonnage) * innerH;
  const yCharge = (v: number) => PAD_T + innerH - (v / maxCharge) * innerH * 0.92;

  // Un libellé sur k pour que les dates ne se chevauchent jamais (~46 px chacune).
  const labelEvery = Math.max(1, Math.ceil(46 / (innerW / Math.max(n, 1))));
  const hoverIdx = hover == null ? -1 : weeks.findIndex((w) => w.week === hover);
  const bands = phaseBands(weeks);
  const linePts = cheminAdouci(
    weeks.flatMap((w, i) =>
      w.chargeMaxKg == null ? [] : [{ x: xCenter(i), y: yCharge(w.chargeMaxKg) }]),
  );
  // Les semaines d'une combinaison sont un SOUS-ENSEMBLE de celles du mouvement :
  // elles se placent sur le même axe, par leur date.
  const indexDeSemaine = new Map(weeks.map((w, i) => [w.week, i] as const));
  const tracesDesCourbes = courbes.map(({ courbe, couleur }) => ({
    cle: cleDeCourbe(courbe), couleur,
    points: courbe.weeks.flatMap((w) => {
      const i = indexDeSemaine.get(w.week);
      return i === undefined || w.chargeMaxKg == null ? [] : [{ x: xCenter(i), y: yCharge(w.chargeMaxKg), fails: w.fails }];
    }),
  }));

  return (
    <div className="relative overflow-x-auto">
      {hoverIdx >= 0 && (
        <Tooltip w={weeks[hoverIdx]} leftPct={(xCenter(hoverIdx) / W) * 100}
                 volumeMode={volumeMode} oneRmKg={oneRmKg} courbes={courbes} />
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="h-80 w-full"
           onMouseLeave={() => onHover(null)}>
        {/* Bandes de bloc : une nuance sur deux, + libellé M/B */}
        {bands.map((b, i) => {
          const x = PAD_L + slot * b.from;
          const w = slot * (b.to - b.from + 1);
          const label = b.macro != null ? `M${b.macro}${b.block != null ? `B${b.block}` : ""}` : "";
          return (
            <g key={`${b.from}-${b.macro}-${b.block}`}>
              <rect
                x={x} y={PAD_T} width={w} height={innerH}
                fill={i % 2 === 0 ? "var(--muted)" : "transparent"}
                opacity={i % 2 === 0 ? 0.35 : 0}
              />
              {/* Séparateurs, deux niveaux de lecture : trait doré plein au
                  changement de MACRO (rupture forte), pointillé discret au
                  simple changement de BLOC. */}
              {i > 0 && (
                bands[i - 1].macro !== b.macro ? (
                  <line x1={x} y1={PAD_T} x2={x} y2={PAD_T + innerH}
                        stroke="var(--gold)" strokeWidth="1.5" opacity="0.7" />
                ) : (
                  <line x1={x} y1={PAD_T} x2={x} y2={PAD_T + innerH}
                        stroke="var(--border)" strokeWidth="1" strokeDasharray="3 3" opacity="0.9" />
                )
              )}
              {label && (
                <text x={x + w / 2} y={PAD_T + 11} textAnchor="middle"
                      className="fill-muted-foreground" fontSize="9" fontWeight="600">
                  {label}
                </text>
              )}
            </g>
          );
        })}

        {/* Axes */}
        <line x1={PAD_L} y1={PAD_T + innerH} x2={PAD_L + innerW} y2={PAD_T + innerH}
              stroke="var(--border)" strokeWidth="1" />

        {/* Graduations tonnage (gauche) */}
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD_L} y1={yTonnage(maxTonnage * f)} x2={PAD_L + innerW} y2={yTonnage(maxTonnage * f)}
                  stroke="var(--border)" strokeWidth="0.5" opacity="0.5" />
            <text x={PAD_L - 6} y={yTonnage(maxTonnage * f) + 3} textAnchor="end"
                  className="fill-muted-foreground" fontSize="9">
              {volumeMode === "reps" ? Math.round(maxTonnage * f) : fmtKg(maxTonnage * f)}
            </text>
          </g>
        ))}

        {/* Graduations charge max (droite) */}
        {[0, 0.5, 1].map((f) => (
          <text key={f} x={PAD_L + innerW + 6} y={yCharge(maxCharge * f) + 3}
                className="fill-muted-foreground" fontSize="9">
            {Math.round(maxCharge * f)}
          </text>
        ))}

        {/* Barres : tonnage total (fond) puis tonnage au top set (devant) */}
        {weeks.map((w, i) => {
          const cx = xCenter(i);
          const xVol = volAtMax(w) != null ? cx - barW - 1 : cx - barW / 2;
          // Le repère ne se dessine que s'il DIT quelque chose : le serveur rend
          // prescrit = tenu partout où rien n'a échoué. `Math.round` parce que
          // ces sommes traînent des flottants — un liseré d'un demi-kilo serait
          // du bruit, pas une information.
          const tenu = volTotal(w), prevu = volPrevu(w);
          const manque = tenu != null && prevu != null
                         && Math.round(prevu) > Math.round(tenu)
            ? { tenu, prevu } : null;
          return (
            <g key={w.week}>
              {/* Le manque : la part prescrite qui n'a pas tenu. Dessinée AVANT
                  la barre pleine, en creux — c'est un repère, pas une mesure. */}
              {manque != null && (
                <>
                  <rect x={xVol} y={yTonnage(manque.prevu)} width={barW}
                        height={yTonnage(manque.tenu) - yTonnage(manque.prevu)}
                        fill={C_TOTAL} opacity="0.16" rx="2" />
                  <line x1={xVol} x2={xVol + barW}
                        y1={yTonnage(manque.prevu)} y2={yTonnage(manque.prevu)}
                        stroke={C_TOTAL} strokeWidth="1" strokeDasharray="3 2"
                        opacity="0.75" />
                </>
              )}
              {volTotal(w) != null && (
                <rect x={xVol}
                      y={yTonnage(volTotal(w)!)} width={barW}
                      height={PAD_T + innerH - yTonnage(volTotal(w)!)}
                      fill={C_TOTAL} opacity="0.55" rx="2" />
              )}
              {volAtMax(w) != null && (
                <rect x={cx + 1} y={yTonnage(volAtMax(w)!)} width={barW}
                      height={PAD_T + innerH - yTonnage(volAtMax(w)!)}
                      fill={C_AT_MAX} rx="2" />
              )}
              {i % labelEvery === 0 && (
                <text x={cx} y={H - PAD_B + 16} textAnchor="middle"
                      className="fill-muted-foreground" fontSize="10">
                  {fmtWeek(w.week)}
                </text>
              )}
            </g>
          );
        })}

        {/* 1RM de référence : les charges se lisent alors en % du max. */}
        {oneRmKg != null && (
          <g>
            <line x1={PAD_L} y1={yCharge(oneRmKg)} x2={PAD_L + innerW} y2={yCharge(oneRmKg)}
                  stroke={C_MAX} strokeWidth="1" strokeDasharray="6 4" opacity="0.55" />
            <text x={PAD_L + innerW - 2} y={yCharge(oneRmKg) - 4} textAnchor="end"
                  fill={C_MAX} fontSize="9" opacity="0.85">
              1RM {Math.round(oneRmKg)} kg
            </text>
          </g>
        )}

        {/* UNE LIGNE PAR COMBINAISON ALLUMÉE (FRE-182) : la charge max de CHAQUE
            (variante, tempo, format), plutôt qu'une moyenne qui mêle l'haltère et
            la barre de compétition. */}
        {tracesDesCourbes.map((t) => (
          <g key={t.cle} data-courbe={t.cle}>
            {t.points.length > 1 && (
              <path d={cheminAdouci(t.points)} fill="none" stroke={t.couleur} strokeWidth="2"
                    strokeLinejoin="round" strokeLinecap="round" />
            )}
            {t.points.map((p) => (
              <circle key={`${p.x}`} cx={p.x} cy={p.y} r={p.fails > 0 ? 4.5 : 3}
                      fill={p.fails > 0 ? C_FAIL : "var(--card)"} stroke={t.couleur} strokeWidth="2" />
            ))}
          </g>
        ))}

        {/* Ligne charge max du mouvement ENTIER (axe droit) — quand aucune
            combinaison n'est allumée. */}
        {courbes.length === 0 && linePts && (
          <path d={linePts} fill="none" stroke={C_MAX} strokeWidth="2"
                    strokeLinejoin="round" strokeLinecap="round" />
        )}
        {courbes.length === 0 && weeks.map((w, i) =>
          w.chargeMaxKg == null ? null : (
            // Rouge quand l'échec est SUR la charge max : la prescription a
            // dépassé. Un échec sur une série plus légère ne teinte pas le
            // point (ce serait imputer la faute au top set).
            <circle key={w.week} cx={xCenter(i)} cy={yCharge(w.chargeMaxKg)}
                    r={w.failsAtMax > 0 ? 4.5 : 3}
                    fill={w.failsAtMax > 0 ? C_FAIL : "var(--card)"}
                    stroke={w.failsAtMax > 0 ? C_FAIL : C_MAX} strokeWidth="2" />
          ),
        )}

        {/* Échec sans charge (mouvement au poids du corps) : pas de point sur la
            courbe où le montrer → petit repère en pied de colonne. */}
        {weeks.map((w, i) =>
          w.fails > 0 && w.chargeMaxKg == null ? (
            <circle key={`f-${w.week}`} cx={xCenter(i)} cy={PAD_T + innerH - 4} r="3"
                    fill={C_FAIL} opacity="0.85" />
          ) : null,
        )}

        {/* Survol : une bande de capture par semaine (invisible), au-dessus de
            tout le reste pour que le pointeur ne « tombe » pas entre deux barres. */}
        {weeks.map((w, i) => (
          <g key={`hit-${w.week}`}>
            {hover === w.week && (
              <rect x={PAD_L + slot * i} y={PAD_T} width={slot} height={innerH}
                    fill="var(--foreground)" opacity="0.06" />
            )}
            <rect x={PAD_L + slot * i} y={PAD_T} width={slot} height={innerH}
                  fill="transparent"
                  onMouseEnter={() => onHover(w.week)}
                  onTouchStart={() => onHover(w.week)} />
          </g>
        ))}
      </svg>
    </div>
  );
}

/** Bandeau RPE : même axe X que le graphe, échelle fixe 0–10. Séparé plutôt
 *  qu'empilé — une 4e série sur deux axes rendrait le graphe illisible. */
type RpeWeek = {
  week: string; feltRpe: number | null; aimedRpe: number | null; sessions: number;
  macroNumber: number | null; blockNumber: number | null;
};

function RpeStrip({ weeks, hover, onHover }: {
  weeks: RpeWeek[]; hover: string | null; onHover: (week: string | null) => void;
}) {
  const { t } = useTranslation();
  const hasRpe = weeks.some((w) => w.feltRpe != null);
  if (!hasRpe) return null;

  const HS = 110;
  const W = chartWidth(weeks.length);
  const innerW = W - PAD_L - PAD_R;
  const slot = innerW / Math.max(weeks.length, 1);
  const xCenter = (i: number) => PAD_L + slot * (i + 0.5);

  // Échelle CADRÉE sur les valeurs réelles (± 0,5 point) au lieu d'un 0–10 fixe :
  // des RPE entre 5 et 8 donnaient une ligne plate. Les graduations restent
  // étiquetées, donc la valeur absolue se lit toujours.
  const vals = weeks.flatMap((w) => [w.feltRpe, w.aimedRpe].filter((v): v is number => v != null));
  const lo = Math.max(0, Math.floor(Math.min(...vals) * 2) / 2 - 0.5);
  const hi = Math.min(10, Math.ceil(Math.max(...vals) * 2) / 2 + 0.5);
  const span = Math.max(1, hi - lo);
  const PT = 16, PB = 16;
  const y = (v: number) => PT + (1 - (v - lo) / span) * (HS - PT - PB);
  // Graduations aux valeurs « rondes » comprises dans la plage.
  const ticks = [0, 2, 4, 5, 6, 7, 8, 9, 10].filter((t) => t >= lo && t <= hi);

  const feltPts = weeks.flatMap((w, i) =>
    w.feltRpe == null ? [] : [{ x: xCenter(i), y: y(w.feltRpe) }]);
  const pts = cheminAdouci(feltPts);
  // Prescrit en pointillé : l'écart avec le ressenti EST l'information
  // (au-dessus = plus dur que prévu, en dessous = trop facile).
  const aimedPts = cheminAdouci(
    weeks.flatMap((w, i) => (w.aimedRpe == null ? [] : [{ x: xCenter(i), y: y(w.aimedRpe) }])),
  );

  // Aire fermée entre les deux courbes, sur les semaines où les DEUX existent.
  const paired = weeks
    .map((w, i) => ({ i, felt: w.feltRpe, aimed: w.aimedRpe }))
    .filter((d): d is { i: number; felt: number; aimed: number } => d.felt != null && d.aimed != null);
  // L'aire suit les MÊMES courbes adoucies que les deux traits : bords droits
  // sous traits courbes, le remplissage dépasserait dans chaque creux.
  const gapPath = aireEntreCourbes(
    paired.map((d) => ({ x: xCenter(d.i), y: y(d.felt) })),
    paired.map((d) => ({ x: xCenter(d.i), y: y(d.aimed) })),
  );
  const rpeBands = phaseBands(weeks);
  const avgGap = paired.length
    ? paired.reduce((acc, d) => acc + (d.felt - d.aimed), 0) / paired.length
    : null;

  return (
    <div className="overflow-x-auto">
      <div className="mt-1 flex items-baseline gap-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <span>{t("charts.rpeRessentiPleinVs")}</span>
        {avgGap != null && (
          <span className={cn("normal-case tracking-normal",
            avgGap > 0.3 ? "text-destructive" : avgGap < -0.3 ? "text-[var(--success)]" : "text-muted-foreground")}>
            {i18n.t("charts.avgGap", { gap: `${avgGap > 0 ? "+" : ""}${avgGap.toFixed(1)}` })}
            {" · " + (avgGap > 0.3 ? i18n.t("charts.harder") : avgGap < -0.3 ? i18n.t("charts.margin") : i18n.t("charts.calibrated"))}
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${HS}`} className="h-28 w-full"
           onMouseLeave={() => onHover(null)}>
        {/* Mêmes repères de phase que le graphe du dessus : bandes alternées,
            trait doré au changement de MACRO, pointillé au changement de BLOC. */}
        {rpeBands.map((b, i) => {
          const x = PAD_L + slot * b.from;
          const bw = slot * (b.to - b.from + 1);
          return (
            <g key={`ph-${b.from}-${b.macro}-${b.block}`}>
              {i % 2 === 0 && (
                <rect x={x} y={0} width={bw} height={HS} fill="var(--muted)" opacity="0.35" />
              )}
              {i > 0 && (
                rpeBands[i - 1].macro !== b.macro ? (
                  <line x1={x} y1={0} x2={x} y2={HS} stroke="var(--gold)"
                        strokeWidth="1.5" opacity="0.7" />
                ) : (
                  <line x1={x} y1={0} x2={x} y2={HS} stroke="var(--border)"
                        strokeWidth="1" strokeDasharray="3 3" opacity="0.9" />
                )
              )}
            </g>
          );
        })}

        {ticks.map((g) => (
          <g key={g}>
            <line x1={PAD_L} y1={y(g)} x2={PAD_L + innerW} y2={y(g)}
                  stroke="var(--border)" strokeWidth="0.5" opacity="0.5" />
            <text x={PAD_L - 6} y={y(g) + 3} textAnchor="end"
                  className="fill-muted-foreground" fontSize="9">{g}</text>
          </g>
        ))}
        {/* Aire entre prescrit et ressenti : l'ÉCART est l'information — au-dessus
            du prescrit = plus dur que prévu, en dessous = de la marge. */}
        {gapPath && <path d={gapPath} fill={C_RPE} opacity="0.13" />}
        {aimedPts && <path d={aimedPts} fill="none" stroke={C_RPE} strokeWidth="1.5"
                               strokeDasharray="4 3" opacity="0.5"
                               strokeLinejoin="round" strokeLinecap="round" />}
        {pts && <path d={pts} fill="none" stroke={C_RPE} strokeWidth="2"
                          strokeLinejoin="round" strokeLinecap="round" />}
        {weeks.map((w, i) =>
          w.feltRpe == null ? null : (
            <circle key={w.week} cx={xCenter(i)} cy={y(w.feltRpe)} r="3"
                    fill="var(--card)" stroke={C_RPE} strokeWidth="1.5" />
          ),
        )}

        {/* Survol partagé avec le graphe principal (même index de semaine). */}
        {weeks.map((w, i) => (
          <g key={`hit-rpe-${w.week}`}>
            {hover === w.week && (
              <rect x={PAD_L + slot * i} y={0} width={slot} height={HS}
                    fill="var(--foreground)" opacity="0.06" />
            )}
            <rect x={PAD_L + slot * i} y={0} width={slot} height={HS}
                  fill="transparent"
                  onMouseEnter={() => onHover(w.week)}
                  onTouchStart={() => onHover(w.week)} />
          </g>
        ))}
      </svg>
    </div>
  );
}

/** Mini-graphe en barres, échelle propre — sert les indicateurs secondaires
 *  (part au top set, volume par séance, fréquence). */
function MiniBars({
  values, labels, format, color = C_AT_MAX, max,
}: {
  values: (number | null)[];
  labels: string[];
  format: (v: number) => string;
  color?: string;
  max?: number;
}) {
  const w = 320, h = 72, padB = 14, padT = 12;
  const top = max ?? Math.max(1, ...values.map((v) => v ?? 0));
  const slot = w / Math.max(values.length, 1);
  const bw = Math.min(14, slot * 0.5);
  const last = [...values].reverse().find((v) => v != null) ?? null;
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[72px] w-full">
        {values.map((v, i) => {
          if (v == null) return null;
          const bh = ((h - padB - padT) * v) / top;
          const x = slot * (i + 0.5) - bw / 2;
          return (
            <g key={i}>
              <rect x={x} y={h - padB - bh} width={bw} height={bh} fill={color} opacity="0.75" rx="2" />
              {(i === 0 || i === values.length - 1) && (
                <text x={slot * (i + 0.5)} y={h - 3} textAnchor="middle"
                      className="fill-muted-foreground" fontSize="8">{labels[i]}</text>
              )}
            </g>
          );
        })}
      </svg>
      {last != null && (
        <div className="text-right font-mono text-xs text-foreground">{format(last)}</div>
      )}
    </div>
  );
}

/** Récap par MACRO : une ligne par macro, ses blocs alignés dedans. Le tonnage
 *  au top set y figure parce que deux blocs peuvent afficher la même charge max
 *  et un tonnage total voisin tout en ayant doublé le travail lourd. */
function MacroRecap({ weeks, volumeMode }: { weeks: TrackingWeek[]; volumeMode: VolumeMode }) {
  const macros = useMemo(() => {
    type Blk = {
      key: string; label: string; weeks: number; maxKg: number | null;
      atMax: number | null; total: number | null; rpe: number | null; rpeN: number;
    };
    const rows: { macro: number | null; blocks: Blk[] }[] = [];
    for (const w of weeks) {
      let row = rows[rows.length - 1];
      if (!row || row.macro !== w.macroNumber) {
        row = { macro: w.macroNumber, blocks: [] };
        rows.push(row);
      }
      const label = w.blockNumber != null ? `B${w.blockNumber}` : "—";
      let blk = row.blocks[row.blocks.length - 1];
      if (!blk || blk.label !== label) {
        blk = { key: `${w.macroNumber}-${label}-${row.blocks.length}`, label, weeks: 0,
                maxKg: null, atMax: null, total: null, rpe: null, rpeN: 0 };
        row.blocks.push(blk);
      }
      blk.weeks += 1;
      if (w.chargeMaxKg != null) blk.maxKg = Math.max(blk.maxKg ?? 0, w.chargeMaxKg);
      if (w.tonnageAtMaxKg != null) blk.atMax = (blk.atMax ?? 0) + w.tonnageAtMaxKg;
      const v = volumeMode === "reps" ? w.repsTotal : w.tonnageTotalKg;
      if (v != null) blk.total = (blk.total ?? 0) + v;
      if (w.feltRpe != null) { blk.rpe = (blk.rpe ?? 0) + w.feltRpe; blk.rpeN += 1; }
    }
    return rows;
  }, [weeks, volumeMode]);

  if (macros.length === 0) return null;

  // Deltas au top set : d'un bloc au précédent, tous macros confondus.
  const flat = macros.flatMap((m) => m.blocks);

  return (
    <div className="flex flex-col gap-3">
      {macros.map((m, mi) => (
        <div key={`${m.macro}-${mi}`} className="flex flex-wrap items-stretch gap-2">
          <div className="flex w-10 shrink-0 items-center justify-center rounded-lg border border-gold/30 bg-gold/10 text-xs font-semibold text-gold">
            M{m.macro ?? "?"}
          </div>
          {m.blocks.map((b) => {
            const idx = flat.indexOf(b);
            const prev = flat[idx - 1];
            const delta = prev && b.atMax != null && prev.atMax != null ? b.atMax - prev.atMax : null;
            return (
              <div key={b.key} className="min-w-[150px] flex-1 rounded-lg border border-border bg-background/40 p-2.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-semibold">{b.label}</span>
                  <span className="text-[10px] text-muted-foreground">{i18n.t("charts.semAbrege", { count: b.weeks })}</span>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                  <span>{i18n.t('charts.max')}</span>
                  <span className="text-right font-mono text-foreground">{b.maxKg != null ? `${Math.round(b.maxKg)} kg` : "—"}</span>
                  <span>{i18n.t('charts.volume')}</span>
                  <span className="text-right font-mono text-foreground">
                    {b.total == null ? "—" : volumeMode === "reps" ? `${Math.round(b.total)} reps` : fmtKg(b.total)}
                  </span>
                  <span>{i18n.t('charts.auTopSet')}</span>
                  <span className="text-right font-mono text-foreground">{fmtKg(b.atMax)}</span>
                  <span>RPE</span>
                  <span className="text-right font-mono text-foreground">{b.rpeN ? (b.rpe! / b.rpeN).toFixed(1) : "—"}</span>
                </div>
                {delta != null && delta !== 0 && (
                  <div className={cn("mt-1 text-[10px] font-medium",
                    delta > 0 ? "text-[var(--success)]" : "text-muted-foreground")}>
                    {delta > 0 ? "+" : "−"}{fmtKg(Math.abs(delta))} au top set
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** ⚠️ DÉFINI AU NIVEAU DU MODULE, PAS DANS LE RENDU (FRE-91). Ce composant vivait
 *  dans le corps de `SecondaryCharts` : React voyait donc un TYPE DIFFÉRENT à
 *  chaque rendu, démontait les trois cartes et les remontait — au lieu de les
 *  mettre à jour. L'état interne et le DOM des graphes étaient jetés à chaque
 *  fois. Il ne ferme sur rien, donc le sortir ne coûte rien. */
function Card({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="text-[11px] font-semibold">{title}</div>
      <div className="mb-1 text-[10px] text-muted-foreground">{hint}</div>
      {children}
    </div>
  );
}

/** Indicateurs secondaires — chacun répond à une question que le graphe
 *  principal ne tranche pas. */
function SecondaryCharts({ weeks }: { weeks: TrackingWeek[] }) {
  const { t } = useTranslation();
  const labels = weeks.map((w) => fmtWeek(w.week));
  const share = weeks.map((w) =>
    w.tonnageAtMaxKg != null && w.tonnageTotalKg ? (100 * w.tonnageAtMaxKg) / w.tonnageTotalKg : null,
  );
  const perSession = weeks.map((w) =>
    w.tonnageTotalKg != null && w.sessions ? w.tonnageTotalKg / w.sessions : null,
  );
  const freq = weeks.map((w) => w.sessions || null);

  return (
    <div className="grid gap-2 md:grid-cols-3">
      <Card title={t("charts.partAuTopSet")} hint={i18n.t("misc.volumeAtMax")}>
        <MiniBars values={share} labels={labels} max={100} color={C_AT_MAX}
                  format={(v) => `${Math.round(v)} %`} />
      </Card>
      <Card title={t("charts.volumeParSeance")} hint={i18n.t("misc.moreWorkOrSessions")}>
        <MiniBars values={perSession} labels={labels} color={C_TOTAL} format={fmtKg} />
      </Card>
      <Card title={t("charts.frequence")} hint={i18n.t("misc.sessionsWithMovement")}>
        <MiniBars values={freq} labels={labels} color={C_MAX}
                  format={(v) => i18n.t("charts.parSemaine", { valeur: Math.round(v) })} />
      </Card>
    </div>
  );
}

/** Le graphe suit l'athlète qu'on lui DONNE — il n'en choisit plus.
 *
 *  Il portait son propre sélecteur, ouvert à tout l'annuaire (exploration
 *  ouverte, décision produit du 28/07). En rejoignant le Tracker, qui suit
 *  l'athlète de la barre latérale, deux sélecteurs auraient cohabité sur la
 *  même page en pouvant diverger — le haut montrant les données de l'un, le bas
 *  le graphe d'un autre. Décision de William : un seul, celui de la barre.
 *
 *  ⚠️ L'autorisation élargie côté brokkr n'a PAS été resserrée pour autant : la
 *  route accepte toujours n'importe quel athlète pour un coach vérifié. Plus
 *  aucune surface ne s'en sert — à trancher séparément (c'est une décision de
 *  sécurité, et la resserrer changerait le comportement d'une API déployée). */
export function TrackingChart({ athleteId }: { athleteId: string }) {
  const { t } = useTranslation();
  const [exercise, setExercise] = useState<string | undefined>(undefined);
  const [volumeOverride, setVolumeOverride] = useState<VolumeMode | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  // Survol partagé, repéré par DATE de semaine (pas par index) : les deux
  // graphes n'ont plus le même axe — le bandeau RPE couvre TOUTES les semaines
  // d'entraînement, le graphe principal seulement celles du mouvement choisi.
  const [hover, setHover] = useState<string | null>(null);

  const { data, isLoading: loading, isPlaceholderData, error: queryError } = useTracking(athleteId || null, exercise);
  const error = queryError ? (queryError instanceof Error ? queryError.message : "Erreur de chargement") : null;

  // brokkr peut retomber sur un autre mouvement (celui demandé n'existe pas
  // pour cet athlète) : on aligne le sélecteur sur sa réponse.
  // ⚠️ PAS SUR LA RÉPONSE PROVISOIRE : pendant le chargement, `data` est encore
  // celle du mouvement précédent — s'y aligner annulerait le choix qu'on vient
  // de faire.
  useEffect(() => {
    if (!isPlaceholderData && data?.exercise && data.exercise !== exercise) setExercise(data.exercise);
  }, [data?.exercise, exercise, isPlaceholderData]);

  // Changer d'athlète : on repart sur son mouvement principal plutôt que de
  // garder un exo qu'il ne pratique peut-être pas.
  //
  // C'était un gestionnaire de `onChange` du temps où le sélecteur vivait ici.
  // L'athlète venant maintenant d'en haut, c'est un EFFET — sinon changer
  // d'athlète dans la barre latérale garderait le mouvement du précédent, et
  // la semaine survolée d'un athlète se rapporterait aux données d'un autre.
  useEffect(() => {
    setExercise(undefined);
    setVolumeOverride(null);
    setHover(null);
  }, [athleteId]);

  const weeks = data?.weeks ?? [];
  const toutesLesCourbes = useMemo(() => data?.courbes ?? [], [data?.courbes]);

  // Les combinaisons allumées. `null` = rien choisi : les plus travaillées, et
  // aucune quand il n'y en a qu'une — sa courbe EST celle du mouvement.
  const [choisies, setChoisies] = useState<string[] | null>(null);
  useEffect(() => { setChoisies(null); }, [athleteId, data?.exercise]);
  const allumees = choisies ?? (toutesLesCourbes.length > 1
    ? toutesLesCourbes.slice(0, COURBES_PAR_DEFAUT).map(cleDeCourbe) : []);
  // La couleur suit la PLACE dans la liste du serveur, pas l'ordre d'allumage :
  // BARBELL garde sa teinte quand on éteint DUMBBELL.
  const couleurDe = (cle: string) => C_COURBES[allumees.indexOf(cle) % C_COURBES.length];
  const basculerCourbe = (cle: string) => setChoisies((avant) => {
    const actuelles = avant ?? allumees;
    if (actuelles.includes(cle)) return actuelles.filter((k) => k !== cle);
    return actuelles.length >= C_COURBES.length ? actuelles : [...actuelles, cle];
  });

  // Mouvement majoritairement au poids du corps → le tonnage est vide la moitié
  // du temps : on bascule d'office sur les reps (l'utilisateur peut forcer).
  const autoMode: VolumeMode = useMemo(() => {
    if (weeks.length === 0) return "tonnage";
    const withTonnage = weeks.filter((w) => w.tonnageTotalKg != null).length;
    return withTonnage / weeks.length < 0.6 ? "reps" : "tonnage";
  }, [weeks]);
  const volumeMode = volumeOverride ?? autoMode;
  const totals = useMemo(() => {
    const withCharge = weeks.filter((w) => w.chargeMaxKg != null);
    const first = withCharge[0]?.chargeMaxKg ?? null;
    const last = withCharge[withCharge.length - 1]?.chargeMaxKg ?? null;
    return { first, last, delta: first != null && last != null ? last - first : null };
  }, [weeks]);

  return (
    <>
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={exercise ?? data?.exercise ?? ""}
          onChange={(e) => { setExercise(e.target.value); setVolumeOverride(null); setHover(null); }}
          disabled={!data?.exercises.length}
          className="h-8 rounded-md border border-border bg-background px-2 text-sm disabled:opacity-50"
        >
          {data?.exercises.map((e) => (
            <option key={e.name} value={e.name}>{e.name} ({e.count})</option>
          ))}
        </select>

        {totals.delta != null && (
          <span className={cn("ml-auto text-xs font-medium",
            totals.delta > 0 ? "text-[var(--success)]" : totals.delta < 0 ? "text-destructive" : "text-muted-foreground")}>
            {i18n.t("charts.kgSurLaPeriode", { signe: totals.delta > 0 ? "+" : "", kg: Math.round(totals.delta) })}
          </span>
        )}
      </div>

      {/* LES COMBINAISONS DU MOUVEMENT (FRE-182) — une par (variante, tempo,
          format), la plus travaillée d'abord. Cliquer allume ou éteint sa courbe ;
          cinq au plus, le nombre de teintes validées. */}
      {toutesLesCourbes.length > 1 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5" aria-label={i18n.t("charts.combinaisons")}>
          {toutesLesCourbes.map((c) => {
            const cle = cleDeCourbe(c);
            const allumee = allumees.includes(cle);
            return (
              <button key={cle} type="button" aria-pressed={allumee} onClick={() => basculerCourbe(cle)}
                disabled={!allumee && allumees.length >= C_COURBES.length}
                className={cn("flex items-center gap-1.5 rounded-md border px-2 py-1 font-display text-[11px] font-bold uppercase tracking-[0.08em] transition-colors disabled:cursor-not-allowed",
                  allumee ? "border-foreground/30 text-foreground" : "border-dashed border-border text-muted-foreground hover:text-foreground")}>
                <span className={cn("h-2 w-2 rounded-full", !allumee && "border border-muted-foreground")}
                      style={allumee ? { background: couleurDe(cle) } : undefined} />
                {libelleDeCourbe(c)}
                <span className="font-mono font-medium tracking-normal text-muted-foreground">{c.series}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {allumees.length === 0 && (
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: C_MAX }} /> {i18n.t("charts.maxLoad")}</span>
        )}
        {volumeMode === "tonnage" && (
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: C_AT_MAX }} /> {i18n.t("charts.tonnageTopSet")}</span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: C_TOTAL }} />
          {volumeMode === "reps" ? i18n.t("charts.repsTotal") : i18n.t("charts.tonnageTotal")}
        </span>
        {weeks.some((w) => w.fails > 0) && (
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: C_FAIL }} /> {i18n.t("misc.failedSet")}</span>
        )}
        {/* ⚠️ LA LÉGENDE DU REPÈRE NE S'AFFICHE QUE S'IL EST DESSINÉ — même
            condition que le tracé, sinon elle annoncerait un liseré introuvable
            dans le graphe. La pastille est CREUSE et pointillée, comme lui : une
            pastille pleine l'aurait rangé parmi les mesures, alors qu'il n'en
            est pas une. */}
        {weeks.some((w) => {
          const tenu = volumeMode === "reps" ? w.repsTotal : w.tonnageTotalKg;
          const prevu = volumeMode === "reps" ? w.repsPrevuTotal : w.tonnagePrevuTotalKg;
          return tenu != null && prevu != null && Math.round(prevu) > Math.round(tenu);
        }) && (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full border border-dashed"
                  style={{ borderColor: C_TOTAL }} />
            {i18n.t("charts.volumePrescribed")}
          </span>
        )}
        <button
          type="button"
          onClick={() => setVolumeOverride(volumeMode === "tonnage" ? "reps" : "tonnage")}
          className="ml-auto rounded border border-border px-1.5 py-0.5 text-[10px] normal-case tracking-normal hover:bg-accent"
          title={t("charts.leTonnageIgnoreLe")}
        >
          {i18n.t("charts.viewAs", { mode: volumeMode === "tonnage" ? i18n.t("charts.modeReps") : i18n.t("charts.modeTonnage") })}
        </button>
      </div>

      {error ? (
        <p className="py-10 text-center text-sm text-destructive">{error}</p>
      ) : loading && !data ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{i18n.t("common.loading")}</p>
      ) : weeks.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {i18n.t("charts.aucuneDonneeEntrainement")}
        </p>
      ) : (
        <>
          <Chart weeks={weeks} volumeMode={volumeMode} hover={hover} onHover={setHover}
                 oneRmKg={data?.oneRmKg ?? null}
                 courbes={toutesLesCourbes.filter((c) => allumees.includes(cleDeCourbe(c)))
                   .map((c) => ({ courbe: c, couleur: couleurDe(cleDeCourbe(c)) }))} />
          <RpeStrip weeks={data?.athleteWeeks ?? []} hover={hover} onHover={setHover} />

          {/* Détails repliés par défaut : le graphe principal doit rester le
              premier regard, pas noyé sous les indicateurs secondaires. */}
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-1.5 text-[11px] text-muted-foreground hover:border-gold/40 hover:text-foreground"
          >
            {showDetails ? i18n.t("charts.hide") : i18n.t("charts.detailsByBlock")}
          </button>
          {showDetails && (
            <div className="mt-3 flex flex-col gap-3">
              <MacroRecap weeks={weeks} volumeMode={volumeMode} />
              <SecondaryCharts weeks={weeks} />
            </div>
          )}
        </>
      )}

      {data?.lastSessionDate && (
        <p className="mt-2 text-right text-[10px] text-muted-foreground">
          {/* La clé `dataUpTo` porte DÉJÀ « · les séances les plus récentes
              peuvent manquer ». Cette ligne le réajoutait en dur : doublon en
              français, et phrase française collée à une phrase anglaise quand
              l'app est en EN ou PL. */}
          {i18n.t("charts.dataUpTo", { date: new Date(data.lastSessionDate + "T00:00:00").toLocaleDateString(i18n.language || "fr") })}
        </p>
      )}
    </div>

    {/* Carte AUTONOME : calibrage global de l'athlète, indépendant du mouvement
        sélectionné ci-dessus (le RPE se saisit surtout sur le renfo). */}
    <RpeCalibration blocks={data?.rpeBlocks ?? []} />

    </>
  );
}

/** LES SÉRIES PAR SEMAINE, dans leur propre sous-onglet du Tracker (17/09).
 *
 *  ⚠️ LA MÊME RÉPONSE QUE LE GRAPHE, pas une route de plus : ces séries voyagent
 *  avec le suivi (FRE-148) et ne dépendent pas du mouvement choisi — elles les
 *  comparent TOUS. Sans mouvement demandé, brokkr prend le plus travaillé ; la
 *  requête est la même que l'ouverture du graphe, donc déjà en cache. */
export function SeriesDeLAthlete({ athleteId }: { athleteId: string }) {
  const { data } = useTracking(athleteId || null, undefined);
  return <SeriesParLift lignes={data?.setsByMovement ?? []} />;
}
