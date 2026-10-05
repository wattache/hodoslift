import type { ExerciseEditing, SessionEditing } from '@/api/types';
import { effectiveWeightText, parseWeight } from '@/lib/weight';
import { sessionAverageRPE } from '@/lib/rpe';
import { afficherVariantes } from '@/lib/variantes';
import {
  BODY_H, BODY_TOP, C, COL_R, COL_X, MONO, SANS,
  clamp, createShareCanvas, drawBackground, drawBand, drawFooterAndFrame, drawHeader,
  fitText, rpeColor, toPngBlob, tracked,
} from '@/lib/share-canvas';

/** Image de partage d'une SÉANCE : la liste des exercices, un par ligne.
 *
 *  Le corps garde une hauteur constante et c'est la ligne qui se dilate : un
 *  exercice occupe les 850 px, douze se les partagent. Un seul gabarit, dont
 *  les corps de texte se déduisent de la hauteur de ligne — rien ne saute d'un
 *  palier à l'autre, et le rendu reste déterministe (pas de boucle
 *  d'ajustement qui rétrécit la police jusqu'à ce que ça rentre).
 *
 *  Le fond, le cadre, l'en-tête et le pied vivent dans `share-canvas.ts` :
 *  ils sont communs à toutes les images de partage. */

/** Au-delà, la ligne passerait sous le plancher de lisibilité (27 px). La
 *  dernière ligne devient alors un report. 1 séance sur 1705 est concernée. */
const MAX_ROWS = 12;

/** Notation de programmation, telle qu'un coach l'écrit : « 3×5 @ 85 KG ».
 *  Vrai signe multiplié, espaces autour du `@`. */
function schemeOf(ex: ExerciseEditing): string {
  const sets = (ex.sets ?? '').trim();
  const reps = (ex.reps ?? '').trim();
  const unit = ex.repsUnit === 'sec' ? 'S' : '';
  const volume = sets && reps ? `${sets}×${reps}${unit}` : reps ? `${reps}${unit}` : sets ? `${sets}×` : '';

  // La charge RÉELLEMENT soulevée : l'image est un compte rendu de séance.
  const raw = effectiveWeightText(ex).trim();
  let load = '';
  if (/^(pdc|bw)$/i.test(raw)) {
    // On garde le `@` pour ne pas casser le rythme de la colonne.
    load = '@ PDC';
  } else if (raw && parseWeight(raw) > 0) {
    load = `@ ${raw.replace('.', ',').toUpperCase()} KG`;
  }
  return [volume, load].filter(Boolean).join(' ');
}

/** L'intitulé SEUL. La variante descend sur la ligne de détail : accolée au
 *  nom elle le rallongeait au point de le faire entrer en collision avec le
 *  schéma, alors qu'elle qualifie l'exécution au même titre que le tempo. */
function nameOf(ex: ExerciseEditing): string {
  return (ex.name ?? '').trim().toUpperCase();
}

/** Tout ce qui qualifie l'exécution : variante, format, tempo, assistance. */
function detailOf(ex: ExerciseEditing): string {
  return [afficherVariantes(ex.variant), ex.format, ex.tempo, ex.assistance]
    .map(v => (v ?? '').trim()).filter(Boolean).join(' · ').toUpperCase();
}

export interface SessionShareInput {
  session: SessionEditing;
  /** Situe la séance, en bandeau discret. Ex. « Intensification · Semaine 1 ».
   *  Volontairement PAS un titre : ces noms restent souvent ceux par défaut. */
  contextLabel?: string;
}

export async function renderSessionImage(input: SessionShareInput): Promise<Blob> {
  const { session, contextLabel } = input;
  const { canvas, ctx } = createShareCanvas();

  drawBackground(ctx);

  // Cartouche absent quand la séance n'a aucune RPE ressentie : un cartouche
  // vide attirerait l'œil sur ce qui manque.
  const avgRpe = sessionAverageRPE(session);
  await drawHeader(ctx, avgRpe === null ? undefined : {
    label: 'RPE',
    value: Number.isInteger(avgRpe) ? String(avgRpe) : avgRpe.toFixed(1).replace('.', ','),
    color: rpeColor(String(avgRpe)),
  });

  const exercises = session.exercises.filter(ex => (ex.name ?? '').trim());
  const overflow = Math.max(0, exercises.length - MAX_ROWS);
  const shown = overflow > 0 ? exercises.slice(0, MAX_ROWS - 1) : exercises;

  drawBand(ctx, contextLabel ?? '', `${exercises.length} EXO${exercises.length > 1 ? 'S' : ''}`);

  const rowCount = Math.max(1, shown.length + (overflow > 0 ? 1 : 0));
  const h = BODY_H / rowCount;

  // Sans les numéros d'ordre, le texte récupère leur colonne : c'est autant de
  // largeur gagnée contre la troncature des noms. Le rail coloré porte déjà
  // l'ordre ET l'intensité.
  const TEXT_X = 120;
  // Ratios calés pour REMPLIR la hauteur de ligne : à 6 exercices, une ligne
  // fait 141 px et le texte n'en occupait que 78 — d'où l'impression de vide.
  const nameSize = clamp(34, h * 0.38, 72);
  const schemeSize = clamp(32, h * 0.36, 68);
  const detailSize = clamp(24, h * 0.19, 34);
  const gap = Math.round(detailSize * 0.5);

  // Le détail n'est dessiné que s'il tient : au-delà d'une dizaine de lignes il
  // déborderait sur l'exercice suivant.
  const headH = Math.max(nameSize, schemeSize);
  const withDetail = headH + gap + detailSize <= h - 12;
  const contentH = withDetail ? headH + gap + detailSize : headH;

  for (const [i, ex] of shown.entries()) {
    const top = BODY_TOP + i * h;
    const y = top + Math.max(6, (h - contentH) / 2);
    const tone = ex.feltRPE ? rpeColor(ex.feltRPE) : C.faint;

    ctx.fillStyle = tone;
    ctx.beginPath();
    ctx.roundRect(COL_X, top + 6, 8, Math.max(4, h - 12), 3);
    ctx.fill();

    // Le schéma est mesuré EN PREMIER : c'est lui qui dicte la place restante
    // pour le nom. L'inverse (nom borné à une largeur fixe) faisait chevaucher
    // les deux dès qu'une charge était longue — « 3×8/10 @ 16,5 KG ».
    const scheme = schemeOf(ex);
    ctx.font = `700 ${schemeSize}px ${MONO}`;
    const schemeW = ctx.measureText(scheme).width;
    ctx.fillStyle = C.gold;
    ctx.fillText(scheme, COL_R - schemeW, y);

    ctx.font = `600 ${nameSize}px ${SANS}`;
    ctx.fillStyle = C.fg;
    ctx.fillText(fitText(ctx, nameOf(ex), COL_R - TEXT_X - schemeW - 28), TEXT_X, y);

    if (!withDetail) continue;

    const yDetail = y + headH + gap;
    const rpeLabel = ex.feltRPE ? `RPE ${ex.feltRPE}` : '';
    let rpeW = 0;
    if (rpeLabel) {
      ctx.font = `400 ${detailSize}px ${MONO}`;
      rpeW = ctx.measureText(rpeLabel).width;
      ctx.fillStyle = tone;
      ctx.globalAlpha = 0.85;
      ctx.fillText(rpeLabel, COL_R - rpeW, yDetail);
      ctx.globalAlpha = 1;
    }

    const detail = detailOf(ex);
    if (detail) {
      ctx.font = `400 ${detailSize}px ${MONO}`;
      ctx.fillStyle = C.faint;
      ctx.fillText(fitText(ctx, detail, COL_R - TEXT_X - rpeW - 28), TEXT_X, yDetail);
    }
  }

  if (overflow > 0) {
    const top = BODY_TOP + shown.length * h;
    ctx.font = `500 ${detailSize}px ${MONO}`;
    ctx.fillStyle = C.faint;
    tracked(ctx, `+ ${overflow} AUTRE${overflow > 1 ? 'S' : ''}`, TEXT_X, top + Math.max(6, (h - detailSize) / 2), 4);
  }

  drawFooterAndFrame(ctx);
  return toPngBlob(canvas);
}

/* ----- Sortie : partage natif / presse-papier / téléchargement ----- */

export function canShareFiles(): boolean {
  if (typeof navigator === 'undefined' || !navigator.canShare) return false;
  try {
    return navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

export function canCopyImage(): boolean {
  return typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;
}

/** `subject` distingue les images d'une même séance (nom d'exercice pour un
 *  partage de progression), sinon les fichiers s'écraseraient entre eux. */
export function shareFileName(session: SessionEditing, subject?: string): string {
  const slug = (subject || session.name || 'seance')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return `${session.sessionDate || 'seance'}-${slug || 'seance'}.png`;
}

/** Partage natif (iOS/Android) : c'est LE chemin vers Instagram — la feuille
 *  de partage du système propose Stories directement. */
export async function shareImage(blob: Blob, fileName: string, title: string): Promise<void> {
  const file = new File([blob], fileName, { type: 'image/png' });
  await navigator.share({ files: [file], title });
}

export async function copyImage(blob: Blob): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

export function downloadImage(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
