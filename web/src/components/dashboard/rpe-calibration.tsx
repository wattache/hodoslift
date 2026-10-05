import { cn } from "@/lib/utils";
import type { TrackingRpeBlock as RpeBlock } from "@/api/types";
import { useTranslation } from 'react-i18next';
import i18n from "@/i18n";

/* ============================================================
 * Calibrage RPE par BLOC — graphe autonome, TOUS mouvements confondus.
 *
 * Répond à « sur quel bloc ça a pêché ? ». L'écart (ressenti − prescrit) est
 * porté par des barres divergentes autour de zéro : au-dessus, le bloc a été
 * plus dur que programmé ; en dessous, il restait de la marge.
 *
 * Volontairement DÉTACHÉ du graphe par mouvement : le RPE se saisit largement
 * sur le renfo, donc le filtrer sur un exercice sous-estime la charge vécue —
 * et affiché sous un graphe « DIPS », un RPE prescrit venant du renfo se lit à
 * tort comme une cible de DIPS.
 *
 * Les blocs sans aucune ligne « ressenti + prescrit » sont absents (rien à
 * comparer), plutôt qu'affichés à zéro.
 * ============================================================ */

const C_HARD = "#EF4444";  // plus dur que prévu
const C_EASY = "#22C55E";  // de la marge
const C_OK = "#64748B";    // bien calibré

const SEUIL = 0.3;         // en deçà, l'écart n'est pas signifiant

function tone(gap: number): string {
  if (gap > SEUIL) return C_HARD;
  if (gap < -SEUIL) return C_EASY;
  return C_OK;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso + "T00:00:00").toLocaleDateString(i18n.language, { day: "2-digit", month: "short" });
}

export function RpeCalibration({ blocks }: { blocks: RpeBlock[] }) {
  const { t } = useTranslation();
  if (blocks.length === 0) return null;

  const W = Math.max(880, 120 + blocks.length * 110);
  const H = 210;
  const PAD_L = 40, PAD_R = 16, PAD_T = 24, PAD_B = 52;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  // Échelle symétrique autour de 0 : un écart de +0,4 et un de −0,4 doivent
  // produire des barres de même longueur, sinon la comparaison ment.
  const maxAbs = Math.max(0.5, ...blocks.map((b) => Math.abs(b.gap ?? 0)));
  const slot = innerW / blocks.length;
  const barW = Math.min(48, slot * 0.5);
  const y0 = PAD_T + innerH / 2;
  const y = (g: number) => y0 - (g / maxAbs) * (innerH / 2);

  const last = blocks[blocks.length - 1];

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("charts.calibrageRpeParBloc")}</h3>
        <span className="text-[11px] text-muted-foreground">
          {i18n.t("charts.allMovements")}
        </span>
      </div>
      <p className="mb-2 text-[11px] text-muted-foreground">
        {i18n.t("charts.aboveZero")}
      </p>

      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-48 w-full">
          {/* Mêmes repères de phase que les graphes du dessus : bande alternée
              par bloc, trait doré au changement de MACRO — sans ça, rien ne
              montre que M1B1 et M1B2 appartiennent au même cycle. */}
          {blocks.map((b, i) => {
            const x = PAD_L + slot * i;
            const prev = blocks[i - 1];
            const newMacro = i > 0 && prev.macroNumber !== b.macroNumber;
            return (
              <g key={`ph-${i}`}>
                {i % 2 === 0 && (
                  <rect x={x} y={PAD_T} width={slot} height={innerH}
                        fill="var(--muted)" opacity="0.3" />
                )}
                {i > 0 && (
                  newMacro ? (
                    <line x1={x} y1={PAD_T} x2={x} y2={PAD_T + innerH}
                          stroke="var(--gold)" strokeWidth="1.5" opacity="0.7" />
                  ) : (
                    <line x1={x} y1={PAD_T} x2={x} y2={PAD_T + innerH}
                          stroke="var(--border)" strokeWidth="1" strokeDasharray="3 3" opacity="0.9" />
                  )
                )}
                {/* Libellé du MACRO, une fois par cycle */}
                {(i === 0 || newMacro) && b.macroNumber != null && (
                  <text x={x + 4} y={PAD_T + 10} className="fill-gold" fontSize="9" fontWeight="600">
                    M{b.macroNumber}
                  </text>
                )}
              </g>
            );
          })}

          {/* Repères ±0,5 / ±1 point de RPE */}
          {[-1, -0.5, 0.5, 1].filter((g) => Math.abs(g) <= maxAbs).map((g) => (
            <g key={g}>
              <line x1={PAD_L} y1={y(g)} x2={PAD_L + innerW} y2={y(g)}
                    stroke="var(--border)" strokeWidth="0.5" opacity="0.4" strokeDasharray="2 3" />
              <text x={PAD_L - 6} y={y(g) + 3} textAnchor="end"
                    className="fill-muted-foreground" fontSize="9">
                {g > 0 ? `+${g}` : g}
              </text>
            </g>
          ))}
          {/* Ligne du zéro — la référence */}
          <line x1={PAD_L} y1={y0} x2={PAD_L + innerW} y2={y0}
                stroke="var(--border)" strokeWidth="1.5" />
          <text x={PAD_L - 6} y={y0 + 3} textAnchor="end"
                className="fill-muted-foreground" fontSize="9">0</text>

          {blocks.map((b, i) => {
            const gap = b.gap ?? 0;
            const cx = PAD_L + slot * (i + 0.5);
            const top = gap >= 0 ? y(gap) : y0;
            const h = Math.abs(y(gap) - y0);
            return (
              <g key={`${b.macroNumber}-${b.blockNumber}-${i}`}>
                <rect x={cx - barW / 2} y={top} width={barW} height={Math.max(h, 1)}
                      fill={tone(gap)} opacity="0.8" rx="2" />
                {/* Valeur : DANS la barre si elle est assez haute (sinon elle
                    chevauchait les libellés d'axe), juste au bout sinon. */}
                {h >= 18 ? (
                  <text x={cx} y={gap >= 0 ? top + 13 : top + h - 5} textAnchor="middle"
                        fill="var(--background)" fontSize="10" fontWeight="700">
                    {gap > 0 ? "+" : ""}{gap.toFixed(1)}
                  </text>
                ) : (
                  <text x={cx} y={gap >= 0 ? top - 5 : top + h + 12} textAnchor="middle"
                        fill={tone(gap)} fontSize="10" fontWeight="600">
                    {gap > 0 ? "+" : ""}{gap.toFixed(1)}
                  </text>
                )}
                <text x={cx} y={H - PAD_B + 16} textAnchor="middle"
                      className="fill-foreground" fontSize="10" fontWeight="600">
                  M{b.macroNumber}B{b.blockNumber}
                </text>
                <text x={cx} y={H - PAD_B + 28} textAnchor="middle"
                      className="fill-muted-foreground" fontSize="8">
                  {fmtDate(b.from)} · {i18n.t("charts.semAbrege", { count: b.weeks })}
                </text>
                <text x={cx} y={H - PAD_B + 39} textAnchor="middle"
                      className="fill-muted-foreground" fontSize="8" opacity="0.75">
                  {b.feltRpe?.toFixed(1)} / {b.aimedRpe?.toFixed(1)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {last?.gap != null && (
        <p className={cn("mt-1 text-right text-[11px]",
          last.gap > SEUIL ? "text-destructive"
            : last.gap < -SEUIL ? "text-[var(--success)]" : "text-muted-foreground")}>
          {i18n.t("charts.lastBlock", { block: `M${last.macroNumber}B${last.blockNumber}` })}{" "}
          {last.gap > SEUIL ? i18n.t("charts.harderThanPlanned")
            : last.gap < -SEUIL ? i18n.t("charts.marginCanRise")
              : i18n.t("charts.calibrated")}
        </p>
      )}
    </div>
  );
}
