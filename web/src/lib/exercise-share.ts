import type { ProgressionPoint } from '@/components/training/exercise-progression-data';
import i18n from '@/i18n';
import {
  BODY_H, BODY_TOP, C, COL_R, COL_X, MONO, SANS,
  clamp, createShareCanvas, drawBackground, drawBand, drawFooterAndFrame, drawHeader,
  fitText, rpeColor, toPngBlob,
} from '@/lib/share-canvas';

/** Image de partage d'UN exercice : sa progression sur le bloc courant.
 *
 *  Reprend telle quelle la grille de `ExerciseProgression` — séries, reps,
 *  charge, courbe, RPE, une colonne par semaine. Montrer autre chose que ce
 *  que l'athlète a sous les yeux dans l'app lui ferait douter de l'un ou de
 *  l'autre.
 *
 *  Les points viennent de `buildExerciseProgressionPoints` : aucune donnée
 *  n'est recalculée ici. */

export interface ExerciseShareInput {
  points: ProgressionPoint[];
  /** Intitulé du mouvement, sans la variante. */
  name: string;
  /** Variante · format · tempo · assistance. */
  detail?: string;
  /** Ex. « Intensification » — le bloc sur lequel porte la progression. */
  contextLabel?: string;
}

/** Un point ne compte que s'il porte une charge : une semaine sans séance
 *  laisse un TROU dans la courbe, elle ne la ramène pas à zéro. */
function chartable(points: ProgressionPoint[]): { i: number; kg: number }[] {
  return points.map((p, i) => ({ i, kg: p.kgEffective ?? 0 })).filter(p => p.kg > 0);
}

function fmtKg(kg: number): string {
  return (Number.isInteger(kg) ? String(kg) : kg.toFixed(2).replace(/0$/, '')).replace('.', ',');
}

export async function renderExerciseImage(input: ExerciseShareInput): Promise<Blob> {
  const { points, name, detail, contextLabel } = input;
  const { canvas, ctx } = createShareCanvas();

  drawBackground(ctx);

  // Le cartouche porte le DELTA : c'est le chiffre qui donne envie de
  // partager, bien plus qu'une RPE moyenne sur un seul mouvement.
  const chart = chartable(points);
  const first = chart.length ? chart[0].kg : null;
  const last = chart.length ? chart[chart.length - 1].kg : null;
  const delta = first !== null && last !== null ? last - first : null;
  await drawHeader(ctx, delta === null || delta === 0 ? undefined : {
    label: i18n.t('share.bloc'),
    value: `${delta > 0 ? '↑' : '↓'}${fmtKg(Math.abs(delta))}`,
    unit: 'KG',
    color: delta > 0 ? C.success : C.danger,
  });

  drawBand(ctx, contextLabel ?? '', i18n.t('share.semaines', { count: points.length }));

  /* ----- Titre : le mouvement est LE sujet, il occupe la largeur ----- */
  let y = BODY_TOP;
  ctx.font = `700 72px ${SANS}`;
  ctx.fillStyle = C.fg;
  ctx.fillText(fitText(ctx, name.toUpperCase(), COL_R - COL_X), COL_X, y);
  y += 84;
  if (detail) {
    ctx.font = `400 32px ${MONO}`;
    ctx.fillStyle = C.faint;
    ctx.fillText(fitText(ctx, detail.toUpperCase(), COL_R - COL_X), COL_X, y);
    y += 44;
  }

  /* ----- Grille : une colonne par semaine ----- */
  const n = Math.max(1, points.length);
  const GRID_X = 236; // laisse la colonne des libellés à gauche
  const colW = (COL_R - GRID_X) / n;
  const valueSize = clamp(22, colW * 0.30, 34);
  const chargeSize = clamp(26, colW * 0.42, 52);
  const labelSize = 26;

  const gridTop = y + 40;
  const bottom = BODY_TOP + BODY_H;
  const centreOf = (i: number) => GRID_X + colW * (i + 0.5);

  // Les libellés de semaine (S1, S2…) coiffent la grille.
  ctx.font = `500 ${labelSize}px ${MONO}`;
  ctx.fillStyle = C.faint;
  points.forEach((p, i) => {
    const w = ctx.measureText(p.label).width;
    ctx.fillText(p.label, centreOf(i) - w / 2, gridTop);
  });

  /** Une ligne de la grille : libellé à gauche, une valeur par colonne. */
  const row = (label: string, yy: number, size: number, weight: number,
               value: (p: ProgressionPoint) => string,
               color: (p: ProgressionPoint) => string) => {
    ctx.font = `500 ${labelSize}px ${MONO}`;
    ctx.fillStyle = C.faint;
    ctx.fillText(label, COL_X, yy + Math.max(0, (size - labelSize) / 2));
    ctx.font = `${weight} ${size}px ${MONO}`;
    points.forEach((p, i) => {
      const text = value(p);
      const w = ctx.measureText(text).width;
      ctx.fillStyle = color(p);
      ctx.fillText(text, centreOf(i) - w / 2, yy);
    });
  };

  const ySeries = gridTop + 56;
  const yReps = ySeries + valueSize + 22;
  const yCharge = yReps + valueSize + 30;
  // La courbe est une BANDE, pas un remplissage : laissée libre de s'étirer sur
  // tout l'espace restant, elle écrasait la grille et transformait deux points
  // en diagonale spectaculaire.
  const chartTop = yCharge + chargeSize + 30;
  const reservedBelow = valueSize + 34 + (points.some(p => p.feedback) ? 88 : 24);
  const chartBottom = chartTop + clamp(120, bottom - chartTop - reservedBelow, 300);
  const yRpe = chartBottom + 34;

  row(i18n.t('share.series'), ySeries, valueSize, 400, p => p.sets || '—', () => C.fg);
  row('REPS', yReps, valueSize, 400,
      p => (p.repsDone && p.repsDone !== p.reps ? p.repsDone : p.reps) || '—', () => C.fg);
  row(i18n.t('share.charge'), yCharge, chargeSize, 700,
      p => (p.kgEffective ? fmtKg(p.kgEffective) : p.assistance.trim() || '—'),
      p => (p.kgEffective ? C.gold : C.faint));

  /* ----- Courbe : la progression, d'un coup d'œil ----- */
  if (chart.length >= 2 && chartBottom > chartTop + 40) {
    const kgs = chart.map(p => p.kg);
    const min = Math.min(...kgs);
    const max = Math.max(...kgs);
    // Une progression plate doit rester une ligne plate, pas un zigzag amplifié
    // par une échelle auto-ajustée sur un écart nul.
    const span = max - min || 1;
    const yOf = (kg: number) => chartBottom - ((kg - min) / span) * (chartBottom - chartTop);

    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    chart.forEach((p, k) => {
      const px = centreOf(p.i);
      const py = yOf(p.kg);
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    for (const p of chart) {
      ctx.beginPath();
      ctx.arc(centreOf(p.i), yOf(p.kg), 7, 0, Math.PI * 2);
      ctx.fillStyle = C.bgMid;
      ctx.fill();
      ctx.strokeStyle = C.gold;
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  }

  row('RPE', yRpe, valueSize, 400,
      p => p.rpeRaw || '—',
      p => (p.rpeRaw ? rpeColor(p.rpeRaw) : C.faint));

  /* ----- Le dernier retour de l'athlète : ce que les chiffres ne disent pas ----- */
  const withFeedback = [...points].reverse().find(p => p.feedback.trim());
  if (withFeedback) {
    const text = `${withFeedback.label} · ${withFeedback.feedback.trim()}`;
    ctx.font = `400 28px ${SANS}`;
    ctx.fillStyle = C.cartouche;
    ctx.beginPath();
    ctx.roundRect(COL_X, bottom - 70, COL_R - COL_X, 58, 12);
    ctx.fill();
    ctx.fillStyle = C.muted;
    ctx.fillText(fitText(ctx, text, COL_R - COL_X - 48), COL_X + 24, bottom - 70 + 16);
  }

  drawFooterAndFrame(ctx);
  return toPngBlob(canvas);
}
