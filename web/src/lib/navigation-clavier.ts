import type React from 'react';

/** NAVIGUER AU CLAVIER DANS UNE GRILLE, FAÇON TABLEUR (FRE-180).
 *
 *  ⚠️ SORTIE DE `block-base-editor.tsx`, OÙ ELLE VIVAIT SEULE, et non recopiée :
 *  la semaine en mode coach la demandait à son tour, et deux copies d'une règle
 *  de focus divergent au premier ajustement.
 *
 *  La case voisine se cherche par sa POSITION À L'ÉCRAN, pas par l'ordre du DOM :
 *  la grille du coach a treize colonnes, des cases empilées (reps et son unité,
 *  format et son motif) et des lignes de hauteurs différentes.
 *
 *  - ↑/↓ changent de ligne ; ←/→ de colonne, mais dans un champ texte seulement
 *    quand le curseur est au bord — sinon on ne pourrait plus corriger « 42 ».
 *  - Les champs date sont exclus : leurs flèches changent le jour.
 *  - ⚠️ LES DÉCLENCHEURS DE LISTE (combobox du nom, des variantes, du tempo) en
 *    font partie : sans eux la navigation sautait la moitié des colonnes. Leur
 *    liste ouverte vit dans un portail, hors de la grille, donc ses propres ↑/↓
 *    ne remontent jamais jusqu'ici. */
const CASES = 'input, select, button[aria-haspopup]';

export function naviguerAuClavier(e: React.KeyboardEvent<HTMLElement>): void {
  const t = e.target as HTMLElement;
  const estChamp = t instanceof HTMLInputElement;
  if (!(estChamp || t instanceof HTMLSelectElement || t.matches?.('button[aria-haspopup]'))) return;
  if (t instanceof HTMLInputElement && t.type === 'date') return;
  // Une liste native ouverte garde ses flèches.
  if (t.getAttribute('aria-expanded') === 'true') return;

  let dir: 'left' | 'right' | 'up' | 'down' | null = null;
  const auBord = (fin: boolean) => {
    if (!(t instanceof HTMLInputElement)) return true;
    // `selectionStart` vaut `null` sur un champ numérique : on le traite comme un bord.
    if (t.selectionStart === null) return true;
    return fin
      ? t.selectionStart === t.value.length && t.selectionEnd === t.value.length
      : t.selectionStart === 0 && t.selectionEnd === 0;
  };
  // ⚠️ ↑/↓ QUITTENT AUSSI UN <select>, comme la BASE le faisait avant l'extraction :
  // la valeur se choisit à la souris ou en ouvrant la liste, et changer ce geste
  // ici aurait été une régression silencieuse de la BASE.
  if (e.key === 'ArrowUp') dir = 'up';
  else if (e.key === 'ArrowDown') dir = 'down';
  else if (e.key === 'ArrowLeft' && auBord(false)) dir = 'left';
  else if (e.key === 'ArrowRight' && auBord(true)) dir = 'right';
  if (!dir) return;

  // ⚠️ DE RANGÉE EN RANGÉE. Une grille peut porter, sous chaque rangée, un dépli
  // avec ses propres champs (le tableau du coach, déplié d'office). Depuis une
  // rangée (`[data-rangee]`), ↑/↓ vont à la MÊME colonne de la rangée voisine —
  // pas dans le dépli qui s'intercale : on descend une colonne de séries sans
  // traverser tempo, repos et note à chaque ligne.
  const verticale = dir === 'up' || dir === 'down';
  const deRangee = verticale && t.closest('[data-rangee]') !== null;
  const cases = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(CASES))
    .filter(c => !(c instanceof HTMLInputElement && (c.type === 'date' || c.type === 'hidden')))
    .filter(c => !(c as HTMLInputElement).disabled && c.offsetParent !== null)
    .filter(c => !deRangee || c.closest('[data-rangee]') !== null);
  const cr = t.getBoundingClientRect(); const cx = cr.left + cr.width / 2; const cy = cr.top + cr.height / 2;
  let meilleure: HTMLElement | null = null; let meilleureDistance = Infinity;
  for (const c of cases) {
    if (c === t) continue;
    const r = c.getBoundingClientRect(); const dx = r.left + r.width / 2 - cx; const dy = r.top + r.height / 2 - cy;
    const tolY = (cr.height + r.height) / 2; const tolX = (cr.width + r.width) / 2;
    const ok = (dir === 'right' && dx > 4 && Math.abs(dy) < tolY)
      || (dir === 'left' && dx < -4 && Math.abs(dy) < tolY)
      || (dir === 'down' && dy > 4 && Math.abs(dx) < tolX)
      || (dir === 'up' && dy < -4 && Math.abs(dx) < tolX);
    if (!ok) continue;
    const horizontal = dir === 'left' || dir === 'right';
    const distance = (horizontal ? Math.abs(dx) : Math.abs(dy)) + (horizontal ? Math.abs(dy) : Math.abs(dx)) * 3;
    if (distance < meilleureDistance) { meilleureDistance = distance; meilleure = c; }
  }
  if (meilleure) {
    e.preventDefault();
    meilleure.focus();
    if (meilleure instanceof HTMLInputElement) meilleure.select();
  }
}
