import { useEffect, useMemo, useRef, useState } from 'react';
import type { MacrocycleEditing } from '@/api/types';
import { addDays, daysBetween, todayIso } from '@/lib/dates';

/** Sélection macro/bloc/semaine « courants » dans un programme.
 *
 *  Portage de la logique v1 (useAthleteData) : au chargement, on atterrit sur
 *  le bloc qui CONTIENT aujourd'hui (sinon le premier à venir, sinon le
 *  dernier), puis sur la semaine courante du bloc — dérivé des dates de
 *  semaines, plus fiables que les dates de bloc. La sélection manuelle est
 *  persistée par programme (localStorage), en IDS (robustes aux insertions).
 */

function isoDateToUtcMs(iso: string): number | null {
  if (!iso) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

/* ⚠️ CE MODULE NE LIT QUE DES DATES ET DES IDS — jamais le contenu. Il l'a
 * toujours fait, mais ses signatures disaient le contraire : elles exigeaient
 * l'arbre COMPLET (`WeekEditing`, ses séances, ses lignes) pour choisir un
 * index. Le tableau de bord téléchargeait donc 512 Ko de séances pour savoir
 * quelle semaine est celle d'aujourd'hui (FRE-119).
 *
 * Les types ci-dessous disent le minimum vrai. La charpente allégée les
 * satisfait, l'arbre complet aussi, et l'appelant récupère SON type en sortie —
 * pas ce minimum : `week` reste une `WeekEditing` dans l'éditeur, et une
 * `SemaineDeStructure` sur le tableau de bord. */
/* `id` est OPTIONNEL ici, et ce n'est pas une facilité : dans la famille
 * d'édition, un nœud tout juste ajouté n'a pas encore d'identité serveur. La
 * sélection le sait déjà — elle compare l'id au lieu de le supposer. */
export interface SemaineSituee {
  id?: string;
  startDate?: string | null;
  endDate?: string | null;
  /** Masquée par le coach. Optionnel : la charpente la porte, la famille
   *  d'édition aussi, mais un nœud tout juste ajouté n'a rien encore. */
  hidden?: boolean;
}
export interface BlocSitue {
  id?: string;
  weeks: SemaineSituee[];
}
export interface MacroSitue {
  id?: string;
  blocks: BlocSitue[];
}

/** L'index, DANS LA LISTE D'ORIGINE, de la semaine à afficher (FRE-158).
 *
 *  ⚠️ LE MASQUAGE N'AGISSAIT QUE SUR LA PASTILLE. La barre filtrait bien les
 *  semaines masquées de ses onglets, mais la sélection, elle, ne regardait
 *  jamais `hidden` : elle retombait dessus par la date et l'écran l'affichait en
 *  entier — séances comprises. Un coach a masqué l'unique semaine d'un bloc et
 *  son athlète a continué de tout voir (signalé le 09/09).
 *
 *  ⚠️ C'EST LE SERVEUR QUI TRANCHE, PAS CE FICHIER. Depuis FRE-158, brokkr ne
 *  sert plus une semaine masquée à qui ne programme pas : un athlète n'en reçoit
 *  aucune, et il n'y a donc rien à filtrer chez lui. Ce qui suit ne sert qu'à
 *  l'APERÇU « Athlète » du coach — le serveur lui répond en tant que coach et
 *  lui sert tout, donc sans ceci son aperçu lui montrerait ce qu'il vient
 *  justement de masquer, et lui ferait croire que rien ne marche.
 *
 *  ⚠️ ET L'INDEX RENDU EST CELUI DE LA LISTE D'ORIGINE. `training-editor` s'en
 *  sert pour écrire dans l'arbre (`weeks[weekIndex]`) : rendre l'index de la
 *  liste filtrée ferait patcher la mauvaise semaine dès qu'une masquée la
 *  précède. */
export function indexDeLaSemaineAffichee(
  weeks: SemaineSituee[], idStocke: string | undefined, ignorerLesMasquees: boolean,
): number {
  const visibles = ignorerLesMasquees ? weeks.filter(w => !w.hidden) : weeks;
  if (visibles.length === 0) return -1;
  let index = visibles.findIndex(w => w.id === idStocke);
  if (index < 0) index = resolveWeekIndexByDate(visibles);
  const choisie = visibles[index];
  return choisie ? weeks.findIndex(w => w === choisie) : -1;
}

/** Un bloc a-t-il encore quelque chose à montrer à ce lecteur ? (FRE-158)
 *
 *  ⚠️ UN BLOC DONT TOUTES LES SEMAINES SONT MASQUÉES N'EST PAS UN BLOC VIDE À
 *  AFFICHER, c'est un bloc que le coach a voulu cacher — décision du 09/09. Les
 *  trois cas de production sont des blocs à UNE seule semaine, masquée. Un bloc
 *  réellement sans semaine tombe pareil : depuis le 22/08 un bloc neuf naît sans
 *  Semaine 1, et l'athlète n'a rien à y voir pendant que le coach le compose. */
export function blocAMontrer(bloc: BlocSitue, ignorerLesMasquees: boolean): boolean {
  return !ignorerLesMasquees || bloc.weeks.some(w => !w.hidden);
}

/** L'index, DANS LA LISTE D'ORIGINE, du bloc à afficher (FRE-158). Même règle
 *  d'index que `indexDeLaSemaineAffichee`, et pour la même raison : l'éditeur
 *  écrit par `blocks[blockIndex]`. */
export function indexDuBlocAffiche(
  blocks: BlocSitue[], idStocke: string | undefined, ignorerLesMasquees: boolean,
): number {
  const visibles = blocks.filter(b => blocAMontrer(b, ignorerLesMasquees));
  if (visibles.length === 0) return -1;
  let index = visibles.findIndex(b => b.id === idStocke);
  if (index < 0) index = resolveBlockIndexByDate(visibles);
  const choisi = visibles[index];
  return choisi ? blocks.findIndex(b => b === choisi) : -1;
}

export function resolveWeekIndexByDate(weeks: SemaineSituee[]): number {
  if (weeks.length === 0) return 0;
  const lastWeek = weeks[weeks.length - 1];
  if (!lastWeek.startDate && !lastWeek.endDate) return weeks.length - 1;

  const todayMs = isoDateToUtcMs(todayIso());
  if (todayMs === null) return weeks.length - 1;

  const dated = weeks
    .map((week, index) => {
      const startMs = isoDateToUtcMs(week.startDate || week.endDate || '');
      const endMs = isoDateToUtcMs(week.endDate || week.startDate || '');
      if (startMs === null || endMs === null) return null;
      return { index, startMs: Math.min(startMs, endMs), endMs: Math.max(startMs, endMs) };
    })
    .filter((w): w is { index: number; startMs: number; endMs: number } => w !== null);

  if (dated.length === 0) return weeks.length - 1;
  const inRange = dated.find(({ startMs, endMs }) => todayMs >= startMs && todayMs <= endMs);
  if (inRange) return inRange.index;
  const firstFuture = dated.find(({ startMs }) => todayMs < startMs);
  if (firstFuture) return firstFuture.index;
  return dated[dated.length - 1].index;
}

export function resolveBlockIndexByDate(blocks: BlocSitue[]): number {
  if (blocks.length === 0) return 0;
  const todayMs = isoDateToUtcMs(todayIso());
  if (todayMs === null) return blocks.length - 1;

  const dated = blocks
    .map((block, index) => {
      let startMs: number | null = null;
      let endMs: number | null = null;
      for (const week of block.weeks) {
        const ws = isoDateToUtcMs(week.startDate || week.endDate || '');
        const we = isoDateToUtcMs(week.endDate || week.startDate || '');
        if (ws !== null) startMs = startMs === null ? ws : Math.min(startMs, ws);
        if (we !== null) endMs = endMs === null ? we : Math.max(endMs, we);
      }
      if (startMs === null || endMs === null) return null;
      return { index, startMs, endMs };
    })
    .filter((b): b is { index: number; startMs: number; endMs: number } => b !== null);

  if (dated.length === 0) return blocks.length - 1;
  const inRange = dated.find(({ startMs, endMs }) => todayMs >= startMs && todayMs <= endMs);
  if (inRange) return inRange.index;
  const firstFuture = dated.find(({ startMs }) => todayMs < startMs);
  if (firstFuture) return firstFuture.index;
  return dated[dated.length - 1].index;
}

/** Poser UNE des deux dates de S1 sans jamais inverser la paire (FRE-138).
 *
 *  ⚠️ ELLE VIT ICI, CONTRE `blockWeekDates`, PARCE QUE C'EST LÀ QU'EST LA
 *  CONSÉQUENCE. Ces deux dates ne restent pas dans la trame : la cascade
 *  ci-dessous en dérive celles de TOUTES les semaines du bloc, et la première
 *  reprend la paire telle quelle. Une fin antérieure au début produit donc une
 *  semaine qui se termine avant d'avoir commencé — deux existent en production,
 *  invisibles jusqu'à l'invariant `dates_inversees`.
 *
 *  ⚠️ ET C'EST DEVENU BLOQUANT, pas seulement faux : depuis le `CHECK` de
 *  `training_weeks`, la base REFUSE l'écriture — `PUT /base` répondrait 500 et
 *  la trame entière deviendrait non enregistrable, ce que garde
 *  `e2e-reel/base-sans-dates`. Poser la contrainte sans cette règle, c'était
 *  rouvrir ce défaut-là.
 *
 *  Le geste est celui des compétitions : reculer le DÉBUT pousse la fin ; la
 *  FIN, elle, ne se pose jamais avant le début (le sélecteur ne le propose pas,
 *  et on ne s'en remet pas au sélecteur). */
export function datesDeS1(
  actuel: { s1StartDate?: string | null; s1EndDate?: string | null },
  champ: 's1StartDate' | 's1EndDate',
  valeur: string,
): { s1StartDate?: string; s1EndDate?: string } {
  const debut = actuel.s1StartDate ?? '';
  const fin = actuel.s1EndDate ?? '';
  if (champ === 's1StartDate') {
    // Vider le début ne touche à rien d'autre : `''` n'est pas une date, et 54
    // blocs sur 125 n'en portent aucune — c'est un état normal, pas une erreur.
    return valeur && fin && fin < valeur
      ? { s1StartDate: valeur, s1EndDate: valeur }
      : { s1StartDate: valeur };
  }
  return valeur && debut && valeur < debut
    ? { s1EndDate: debut }
    : { s1EndDate: valeur };
}

/** LES DATES DES SEMAINES, ENCHAÎNÉES EN GARDANT LEUR PROPRE DURÉE (20/09).
 *
 *  ⚠️ UNE SEMAINE PEUT S'ÉTIRER, ET LA SUIVANTE SUIT. « S1 de 5 jours, S2 de 5,
 *  S3 l'athlète a besoin de 3 jours de plus pour un déplacement professionnel,
 *  S4 dure bien 5 jours mais débute à la date de fin de S3 » (William, 20/09).
 *  `blockWeekDates` impose la MÊME longueur à toutes : elle ramènerait S3 à cinq
 *  jours au premier recalcul. Quinze semaines de production ont déjà une durée
 *  différente de la S1 de leur bloc — les écraser, c'est perdre ce que le coach
 *  a posé.
 *
 *  La durée de RÉFÉRENCE reste celle de la BASE : elle s'applique à S1, et à
 *  toute semaine qui n'a pas encore de dates à elle. Chaque semaine commence au
 *  lendemain de la fin de la précédente — ce que la production fait déjà
 *  (355 semaines enchaînées, aucun chevauchement). */
export function datesEnchainees(
  semaines: readonly { startDate?: string | null; endDate?: string | null }[],
  s1Start: string,
  s1End: string,
  /** ⚠️ ON NE RÉÉCRIT PAS LE PASSÉ. Étirer S3 ne doit pas toucher S1 ni S2 —
   *  même si l'une d'elles porte un trou (deux en production) : la chaîne
   *  repart de la semaine visée, avec SON début, et les précédentes sortent
   *  telles quelles. `0` (le défaut) rechaîne tout depuis la BASE. */
  depuis = 0,
): { startDate: string; endDate: string }[] {
  const reference = Math.max(0, daysBetween(s1Start, s1End || addDays(s1Start, 6)));
  const out: { startDate: string; endDate: string }[] = [];
  let debut = depuis > 0 ? (semaines[depuis]?.startDate || '') : s1Start;
  semaines.forEach((semaine, i) => {
    if (i < depuis) {
      out.push({ startDate: semaine.startDate ?? '', endDate: semaine.endDate ?? '' });
      return;
    }
    // S1 tient sa durée de la BASE — c'est elle qu'on vient d'y lire.
    const sienne = i > 0 && semaine.startDate && semaine.endDate
      ? Math.max(0, daysBetween(semaine.startDate, semaine.endDate))
      : reference;
    const fin = addDays(debut, sienne);
    out.push({ startDate: debut, endDate: fin });
    debut = addDays(fin, 1);
  });
  return out;
}

export interface ProgramSelection<M extends MacroSitue = MacrocycleEditing> {
  macro: M | null;
  block: M['blocks'][number] | null;
  week: M['blocks'][number]['weeks'][number] | null;
  macroIndex: number;
  blockIndex: number;
  weekIndex: number;
  select: (sel: { macroId: string; blockId: string; weekId?: string }) => void;
}

interface StoredSelection {
  macroId: string;
  blockId: string;
  weekId?: string;
}

/** Sélection courante dans un programme chargé. `macros` peut être vide le
 *  temps du chargement. */
export function useProgramSelection<M extends MacroSitue>(
  programId: string | null | undefined,
  macros: M[],
  /** Aperçu « Athlète » du coach : cf. `indexDeLaSemaineAffichee` (FRE-158). */
  ignorerLesMasquees = false,
): ProgramSelection<M> {
  const storageKey = `eitri-program-selection:${programId ?? 'none'}`;
  const [stored, setStored] = useState<StoredSelection | null>(null);
  const restoredFor = useRef<string | null>(null);

  // Restaure la sélection persistée quand le programme change.
  useEffect(() => {
    if (restoredFor.current === storageKey) return;
    restoredFor.current = storageKey;
    try {
      const raw = localStorage.getItem(storageKey);
      setStored(raw ? (JSON.parse(raw) as StoredSelection) : null);
    } catch {
      setStored(null);
    }
  }, [storageKey]);

  const select = (sel: { macroId: string; blockId: string; weekId?: string }) => {
    setStored(sel);
    localStorage.setItem(storageKey, JSON.stringify(sel));
  };

  return useMemo(() => {
    // Macro stocké s'il existe encore, sinon le dernier (le plus récent).
    let macroIndex = macros.findIndex(m => m.id === stored?.macroId);
    if (macroIndex < 0) macroIndex = macros.length - 1;
    const macro = macros[macroIndex] ?? null;

    const blocks = macro?.blocks ?? [];
    const blockIndex = indexDuBlocAffiche(blocks, stored?.blockId, ignorerLesMasquees);
    const block = blocks[blockIndex] ?? null;

    const weeks = block?.weeks ?? [];
    // La semaine stockée ne vaut que pour le bloc stocké : sur un autre bloc,
    // on retombe sur la semaine du jour.
    const weekIndex = indexDeLaSemaineAffichee(
      weeks,
      block && block.id === stored?.blockId ? stored?.weekId : undefined,
      ignorerLesMasquees);
    const week = weeks[weekIndex] ?? null;

    return {
      macro,
      block: block as ProgramSelection<M>['block'],
      week: week as ProgramSelection<M>['week'],
      macroIndex, blockIndex, weekIndex, select,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [macros, stored, storageKey, ignorerLesMasquees]);
}
