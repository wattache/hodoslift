import { rpeToNumber } from '@/lib/rpe';
import i18n from '@/i18n';

/** Socle commun aux images de partage (séance, exercice).
 *
 *  Pourquoi du canvas « à la main » plutôt que html2canvas / html-to-image :
 *  l'app est stylée en **oklch** (Tailwind v4) et ces libs ne savent pas le
 *  parser — elles rendraient des aplats noirs. Le canvas nous donne aussi la
 *  maîtrise du format exact exigé par Instagram, sans dépendance.
 *
 *  La palette est FIGÉE en dark/gold : l'image porte l'identité de la marque,
 *  pas la préférence de thème de celui qui partage.
 *
 *  Tout ce qui est ici est partagé : fond, cadre, en-tête, bandeau, pied. Une
 *  seconde implémentation de la charte divergerait au premier ajustement. */

/** Format unique : 4:5, le portrait du feed Instagram (et le plus lisible
 *  quand on republie en story). */
export const IMG_W = 1080;
export const IMG_H = 1350;

/** Colonne utile. Tout s'aligne dessus, en-tête comme corps. */
export const COL_X = 76;
export const COL_R = 1004;
export const COL_W = COL_R - COL_X;

/** Le corps garde une hauteur CONSTANTE : c'est ce qui évite le blanc mort
 *  quand le contenu est court. Les 120 px du haut et du bas restent hors du
 *  corps — l'interface Instagram les recouvre. */
export const BODY_TOP = 380;
export const BODY_H = 850;

export const C = {
  bgTop: '#1d1d25',
  bgMid: '#15151a',
  bgBottom: '#0e0e12',
  cartouche: '#1e1e26',
  border: '#34343d',
  gold: '#d4a843',
  fg: '#f4f4f6',
  muted: '#9a9aa6',
  faint: '#6b6b76',
  success: '#35c07a',
  warning: '#e0a33a',
  danger: '#e5484d',
};

// Inter n'est chargée nulle part dans l'app : la pile système fait foi, ici
// comme à l'écran. Le monospace porte TOUS les chiffres — c'est la signature.
export const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
export const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** Même sémantique que `rpeDotColor`, mais en couleurs littérales (le canvas
 *  ne résout pas les variables CSS). Les seuils sont ceux de l'app : l'image
 *  ne doit pas raconter une autre histoire que l'écran. */
export function rpeColor(rpe: string): string {
  const n = rpeToNumber(rpe);
  if (n === null) return C.faint;
  if (rpe === 'FAIL') return C.danger;
  if (n <= 7.5) return C.success;
  if (n <= 8.5) return C.warning;
  return C.danger;
}

/** Interlettrage dessiné à la main, caractère par caractère.
 *
 *  `ctx.letterSpacing` n'existe pas avant Safari 17 : il y serait ignoré en
 *  silence et les titres perdraient toute leur respiration, sans erreur pour
 *  le signaler. Le coût est négligeable (quelques dizaines de caractères). */
export function tracked(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number): void {
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
}

export function trackedWidth(ctx: CanvasRenderingContext2D, text: string, spacing: number): number {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + spacing;
  return Math.max(0, w - (text.length ? spacing : 0));
}

/** Troncature d'un texte qui sera dessiné AVEC interlettrage.
 *
 *  `measureText` ignore le tracking : mesurer sans lui puis dessiner avec
 *  produit un texte plus large que prévu — c'est ce qui faisait chevaucher le
 *  bandeau de contexte et le compteur d'exercices. */
export function fitTracked(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, spacing: number): string {
  if (trackedWidth(ctx, text, spacing) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && trackedWidth(ctx, `${cut}…`, spacing) > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trim()}…`;
}

export function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trim()}…`;
}

export const clamp = (lo: number, v: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

function loadLogo(): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    // Same-origin : ne « taint » pas le canvas, toBlob reste autorisé.
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // pas de logo ≠ pas d'image
    // Un SVG se dessine dans un canvas À CONDITION de porter des dimensions
    // intrinsèques — `symbole.svg` a bien `width`/`height`. Sans elles,
    // Firefox rend une image de taille nulle, en silence.
    img.src = '/marque/symbole.svg';
  });
}

/** Bruit léger, en tuile répétable : un aplat sombre parfaitement uniforme
 *  fait « capture d'écran ». Le grain lui donne de la matière. */
function noisePattern(ctx: CanvasRenderingContext2D, size = 128, alpha = 0.05): CanvasPattern | null {
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const tctx = tile.getContext('2d');
  if (!tctx) return null;
  const img = tctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = alpha * 255;
  }
  tctx.putImageData(img, 0, 0);
  return ctx.createPattern(tile, 'repeat');
}

export function createShareCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = IMG_W;
  canvas.height = IMG_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponible');
  // Toutes les cotes sont des SOMMETS de texte.
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  return { canvas, ctx };
}

export function drawBackground(ctx: CanvasRenderingContext2D): void {
  const bg = ctx.createLinearGradient(0, 0, 0, IMG_H);
  bg.addColorStop(0, C.bgTop);
  bg.addColorStop(702 / IMG_H, C.bgMid);
  bg.addColorStop(1, C.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, IMG_W, IMG_H);

  const haloTop = ctx.createRadialGradient(400, 130, 0, 400, 130, 680);
  haloTop.addColorStop(0, 'rgba(212, 168, 67, 0.16)');
  haloTop.addColorStop(0.72, 'rgba(212, 168, 67, 0)');
  ctx.fillStyle = haloTop;
  ctx.fillRect(0, 0, IMG_W, IMG_H);

  const haloBottom = ctx.createRadialGradient(540, 1380, 0, 540, 1380, 450);
  haloBottom.addColorStop(0, 'rgba(212, 168, 67, 0.07)');
  haloBottom.addColorStop(0.7, 'rgba(212, 168, 67, 0)');
  ctx.fillStyle = haloBottom;
  ctx.fillRect(0, 0, IMG_W, IMG_H);

  const grain = noisePattern(ctx);
  if (grain) {
    ctx.fillStyle = grain;
    ctx.fillRect(0, 0, IMG_W, IMG_H);
  }
}

export interface HeaderBadge {
  /** Libellé court au-dessus de la valeur (« RPE », « BLOC »…). */
  label: string;
  value: string;
  color: string;
  /** Unité accolée, en petit et en gris (« KG »). Dessinée à part pour que le
   *  chiffre garde sa taille : intégrée à la valeur, elle forçait tout le
   *  cartouche à rétrécir. */
  unit?: string;
}

/** Marque à gauche, cartouche optionnel à droite. Identique sur toutes les
 *  images : c'est ce qui les fait reconnaître comme une série. */
export async function drawHeader(ctx: CanvasRenderingContext2D, badge?: HeaderBadge): Promise<void> {
  const logo = await loadLogo();
  if (logo) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(COL_X, 132, 108, 108, 26);
    ctx.clip();
    ctx.drawImage(logo, COL_X, 132, 108, 108);
    ctx.restore();
  }

  ctx.font = `700 42px ${SANS}`;
  ctx.fillStyle = C.fg;
  tracked(ctx, 'FRENCH FORGE', 212, 140, 4);
  ctx.fillStyle = C.gold;
  tracked(ctx, 'TRAINER', 212, 194, 13);

  if (!badge) return;
  const bx = 820;
  const bw = 184;
  ctx.fillStyle = C.cartouche;
  ctx.strokeStyle = 'rgba(212, 168, 67, 0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(bx, 132, bw, 108, 14);
  ctx.fill();
  ctx.stroke();

  ctx.font = `500 27px ${MONO}`;
  ctx.fillStyle = C.muted;
  tracked(ctx, badge.label, bx + (bw - trackedWidth(ctx, badge.label, 5)) / 2, 146, 5);

  // La valeur rétrécit si elle est large plutôt que de déborder du cartouche.
  const unitRatio = 0.46;
  const groupWidth = (s: number) => {
    ctx.font = `700 ${s}px ${MONO}`;
    let w = ctx.measureText(badge.value).width;
    if (badge.unit) {
      ctx.font = `500 ${Math.round(s * unitRatio)}px ${MONO}`;
      w += 6 + ctx.measureText(badge.unit).width;
    }
    return w;
  };
  let size = 52;
  while (size > 26 && groupWidth(size) > bw - 24) size -= 2;

  const total = groupWidth(size);
  let x = bx + (bw - total) / 2;
  const top = 176 + (52 - size) / 2;
  ctx.font = `700 ${size}px ${MONO}`;
  ctx.fillStyle = badge.color;
  ctx.fillText(badge.value, x, top);
  if (badge.unit) {
    x += ctx.measureText(badge.value).width + 6;
    const us = Math.round(size * unitRatio);
    ctx.font = `500 ${us}px ${MONO}`;
    ctx.fillStyle = C.muted;
    // Aligné sur la BASE du chiffre, pas sur son sommet.
    ctx.fillText(badge.unit, x, top + size - us);
  }
}

/** Filet + bandeau de contexte. `right` est prioritaire : on mesure d'abord ce
 *  qu'il prend, `left` se contente du reste — sinon un libellé long passe
 *  par-dessus. */
export function drawBand(ctx: CanvasRenderingContext2D, left: string, right: string): void {
  const filet = ctx.createLinearGradient(COL_X, 0, COL_R, 0);
  filet.addColorStop(0, 'rgba(212, 168, 67, 0.75)');
  filet.addColorStop(0.62, C.border);
  filet.addColorStop(1, 'rgba(52, 52, 61, 0)');
  ctx.fillStyle = filet;
  ctx.fillRect(COL_X, 284, COL_W, 2);

  ctx.font = `500 30px ${MONO}`;
  const rightW = right ? trackedWidth(ctx, right, 5) : 0;
  if (left) {
    ctx.fillStyle = C.muted;
    tracked(ctx, fitTracked(ctx, left.toUpperCase(), COL_W - rightW - 40, 7), COL_X, 306, 7);
  }
  if (right) {
    ctx.fillStyle = C.faint;
    tracked(ctx, right, COL_R - rightW, 306, 5);
  }
}

/** Pied + cadre. Le pied tombe dans la zone couverte par Instagram : il est
 *  décoratif, jamais porteur d'information. */
export function drawFooterAndFrame(ctx: CanvasRenderingContext2D): void {
  ctx.font = `500 27px ${MONO}`;
  ctx.fillStyle = 'rgba(212, 168, 67, 0.5)';
  const sign = 'FRENCH FORGE TRAINER';
  tracked(ctx, sign, (IMG_W - trackedWidth(ctx, sign, 8)) / 2, 1268, 8);

  ctx.strokeStyle = 'rgba(212, 168, 67, 0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(22, 22, IMG_W - 44, IMG_H - 44, 44);
  ctx.stroke();
}

export function toPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error(i18n.t('share.generationImpossible')))),
      'image/png',
    );
  });
}
