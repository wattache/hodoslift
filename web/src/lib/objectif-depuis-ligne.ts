import type { BaseAccessory, BlockObjective, Principle } from '@/api/types';

/** UNE LIGNE DE BASE DEVIENT UN OBJECTIF PRÉ-REMPLI (FRE-252) — tout ce que la
 *  ligne prescrit et qu'un objectif sait porter : mouvement, variantes, format
 *  ET ses options, tempo, séries, reps, charge, assistance.
 *
 *  Les variantes d'une ligne sont une LISTE, celle d'un objectif une chaîne :
 *  elles se joignent en « CHEST + DS ». La charge devient le bas de la
 *  fourchette, le coach pose le haut s'il en veut une. */
export function objectifDepuisLaLigne(l: Principle | BaseAccessory, source: 'principe' | 'renfo'): BlockObjective {
  const texte = (v: string | null | undefined) => (v ?? '').trim();
  return {
    id: '',
    exercise: texte(l.name),
    variant: (l.variant ?? []).map(v => v.trim()).filter(Boolean).join(' + '),
    format: texte(l.format),
    clusterMode: texte(l.clusterMode),
    clusterRest: texte(l.clusterRest),
    tempo: texte(l.tempo),
    sets: texte(l.sets),
    reps: texte(l.reps),
    weightMin: texte(l.weight),
    weightMax: '',
    assistance: texte(l.assistance),
    atteintLe: null,
    // LE LIEN À LA LIGNE (FRE-254) : l'avancement se lit sur les lignes de
    // semaine de même identité, tier compris pour un principe.
    source,
    tier: source === 'principe' ? ((l as Principle).tier ?? null) : null,
  };
}

const cle = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();
const variantes = (v: string | null | undefined) =>
  (v ?? '').split('+').map(cle).filter(Boolean).sort().join('+');

/** Deux objectifs tiennent-ils à la MÊME ligne de BASE (FRE-255) ? Source, tier,
 *  mouvement, variantes, format, tempo — la clé que brokkr garde (`cle_du_lien`)
 *  et qui lui fait refuser le second. Ici pour ROUVRIR l'existant au lieu d'en
 *  poser un doublon. Un objectif non lié ne tient à aucune ligne. */
export function memeLien(a: BlockObjective, b: BlockObjective): boolean {
  if (!a.source || a.source !== b.source) return false;
  return (a.source !== 'principe' || (a.tier ?? null) === (b.tier ?? null))
    && cle(a.exercise) === cle(b.exercise) && variantes(a.variant) === variantes(b.variant)
    && cle(a.format) === cle(b.format) && cle(a.tempo) === cle(b.tempo);
}
