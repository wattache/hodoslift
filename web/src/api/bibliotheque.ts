/** Entre le contrat Connect de la bibliothèque et la forme que les vues
 *  lisent encore (`Library`, héritée du REST de brokkr).
 *
 *  ⚠️ C'EST UN ADAPTATEUR DE TRANSITION, pas une couche. Il traduit deux
 *  vocabulaires — les groupes en enum d'un côté, en codes texte de l'autre —
 *  et les trois gestes du contrat en un `patch`. Il disparaît quand les vues
 *  liront les types engendrés, une fois les routes `/library` de brokkr
 *  retirées. Fonctions pures : testées sans réseau. */

import { create } from '@bufbuild/protobuf';
import {
  Categorie,
  CreerEntreeRequestSchema,
  Groupe,
  type CreerEntreeRequest,
  type Entree,
  type LireBibliothequeResponse,
} from '@/gen/hodos/bibliotheque/v1/bibliotheque_pb';
import type { Library, LibraryCategory, LibraryEntry, LibraryEntryPatch } from '@/api/types';

const CATEGORIE: Record<LibraryCategory, Categorie> = {
  exercices: Categorie.EXERCICES,
  variantes: Categorie.VARIANTES,
  assistances: Categorie.ASSISTANCES,
  tempos: Categorie.TEMPOS,
  formats: Categorie.FORMATS,
};

/** Les groupes tels que la base les épelle — le vocabulaire des `supports`. */
const CODE_DU_GROUPE: Partial<Record<Groupe, string>> = {
  [Groupe.MU]: 'MU',
  [Groupe.PU]: 'PU',
  [Groupe.DIP]: 'DIP',
  [Groupe.SQ]: 'SQ',
};

const GROUPE_DU_CODE: Record<string, Groupe> = Object.fromEntries(
  Object.entries(CODE_DU_GROUPE).map(([g, code]) => [code, Number(g) as Groupe]),
);

/** Un code inconnu devient `UNSPECIFIED`, que le serveur REFUSE (corps_invalide)
 *  — comme brokkr refusait un groupe hors vocabulaire au lieu de l'écarter. */
export const versGroupe = (code: string): Groupe => GROUPE_DU_CODE[code.trim().toUpperCase()] ?? Groupe.UNSPECIFIED;

const versEntree = (e: Entree, exercice: boolean): LibraryEntry => ({
  id: e.id,
  name: e.name,
  // Mêmes omissions que `response_model_exclude_unset` côté brokkr : le
  // marqueur n'existe que sur un exercice, les soutiens que s'il y en a.
  ...(exercice ? { competition: e.competition } : {}),
  ...(e.supports.length ? { supports: e.supports.map(g => CODE_DU_GROUPE[g] ?? '') } : {}),
});

export function versLibrary(res: LireBibliothequeResponse): Library {
  return {
    exercices: res.exercices.map(e => versEntree(e, true)),
    variantes: res.variantes.map(e => versEntree(e, false)),
    assistances: res.assistances.map(e => versEntree(e, false)),
    tempos: res.tempos.map(e => versEntree(e, false)),
    formats: res.formats.map(e => versEntree(e, false)),
  };
}

export type EntreeACreer = { category: LibraryCategory; name: string; competition?: boolean; supports?: string[] };

export function versCreation(input: EntreeACreer, structure: string | null): CreerEntreeRequest {
  return create(CreerEntreeRequestSchema, {
    structure: structure ?? undefined,
    categorie: CATEGORIE[input.category],
    name: input.name,
    competition: input.competition ?? false,
    supports: (input.supports ?? []).map(versGroupe),
  });
}

export type Geste =
  | { geste: 'renommer'; name: string }
  | { geste: 'marquer'; competition: boolean }
  | { geste: 'soutiens'; supports: Groupe[] };

/** Les gestes qu'un `patch` demande, dans l'ordre des clés PRÉSENTES : la
 *  présence tranche, pas la valeur (FRE-185). `supports: []` est un geste. */
export function gestesDuPatch(patch: LibraryEntryPatch): Geste[] {
  const gestes: Geste[] = [];
  if ('name' in patch && patch.name != null) gestes.push({ geste: 'renommer', name: patch.name });
  if ('competition' in patch && patch.competition != null) gestes.push({ geste: 'marquer', competition: patch.competition });
  if ('supports' in patch) gestes.push({ geste: 'soutiens', supports: (patch.supports ?? []).map(versGroupe) });
  return gestes;
}
