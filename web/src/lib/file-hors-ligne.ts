import { del, get, set } from 'idb-keyval';

import { useEffect, useState } from 'react';

import { api } from '@/api/client';
import type { BaseReplace, BlockBase, BlockCreate, ExerciseLineCreate, ExerciseMove, ExerciseOrder, MacroCreate, MacrocycleEditing, SessionCreate, SessionOrder } from '@/api/types';
import { createEmptyBlockBase, createEmptyExercise } from '@/lib/exercise';
import { jamaisParvenueAuServeur } from '@/lib/save-error';

/** LES GESTES QUI ATTENDENT LE RÉSEAU, SUR LE DISQUE — FRE-118.
 *
 *  ⚠️ CE MODULE EXISTE PARCE QUE LA REPRISE NE DOIT DÉPENDRE D'AUCUN ÉCRAN. La
 *  file en mémoire vit dans `usePatchsEnAttente`, donc dans l'éditeur, donc tant
 *  que l'écran d'entraînement est monté. Sa première version rejouait le disque
 *  au même endroit — et c'était un piège : l'athlète qui rouvre l'app tombe sur
 *  le tableau de bord, l'éditeur n'est pas monté, et sa séance dormait sur le
 *  disque en attendant qu'il retourne de lui-même au bon écran. Vu dans le
 *  harnais réel : après rechargement, la valeur n'arrivait jamais.
 *
 *  ⚠️ UNE SEULE CLÉ, ET LE PROGRAMME DANS L'ENTRÉE. Ranger par programme
 *  obligerait le rejeu à savoir d'avance quels programmes ont quelque chose en
 *  attente — c'est-à-dire à tenir un index, c'est-à-dire une seconde source de
 *  vérité sur le contenu de la file.
 *
 *  ⚠️ LA FILE EST UNE SUITE DE GESTES, DANS L'ORDRE OÙ ILS ONT ÉTÉ FAITS, et
 *  le rejeu la parcourt dans cet ordre. Elle a porté longtemps les seules
 *  frappes de l'athlète — des `PATCH` de champ. Elle porte aussi ce que le
 *  coach écrit : sa trame, ses renommages, ses suppressions. Chaque geste est
 *  rejouable sans dommage : un patch réécrit la même valeur, une trame se
 *  remplace en entier, une suppression d'un objet déjà supprimé est refusée et
 *  sort de la file.
 *
 *  ⚠️ UN SEUL ENVOYEUR, `envoyer`, pour l'écriture immédiate comme pour le
 *  rejeu : le chemin et le corps d'un geste ne s'écrivent qu'une fois. */

const CLE = 'eitri-file-ecritures';

export type CiblePatch = 'exercises' | 'sessions' | 'weeks' | 'macros' | 'blocks';

/** Un champ modifié sur un objet qui a une identité serveur. */
export interface PatchEnAttente {
  genre: 'patch';
  programId: string;
  cible: CiblePatch;
  id: string;
  patch: Record<string, unknown>;
}

/** La trame d'un bloc, remplacée en entier : la dernière version gagne. */
export interface BaseEnAttente {
  genre: 'base';
  programId: string;
  /** L'identifiant du bloc. */
  id: string;
  /** La trame telle que l'éditeur la tient — le type de LECTURE, plus strict
   *  que le contrat d'écriture, parce que la surcouche la repose sur le bloc. */
  corps: { base: BlockBase; weekDates?: BaseReplace['weekDates'] };
}

export type CibleSupprimable = 'macros' | 'blocks' | 'weeks' | 'sessions' | 'exercises';

/** Un objet supprimé. Ce qui le visait encore dans la file part avec lui. */
export interface SuppressionEnAttente {
  genre: 'suppression';
  programId: string;
  cible: CibleSupprimable;
  id: string;
}

/** L'ordre des séances d'une semaine, ou des lignes d'une séance : la liste
 *  COMPLÈTE, comme le serveur l'exige. La dernière version gagne. */
export interface OrdreEnAttente {
  genre: 'ordre';
  programId: string;
  cible: 'sessions' | 'exercises';
  /** Le PARENT : la semaine (pour des séances) ou la séance (pour des lignes). */
  id: string;
  ids: string[];
}

/** Une ligne qui change de séance, dans la même semaine (FRE-188). */
export interface DeplacementEnAttente {
  genre: 'deplacement';
  programId: string;
  /** La ligne. */
  id: string;
  sessionId: string;
  position: number;
}

/** Un objet créé. ⚠️ L'IDENTITÉ EST CHOISIE ICI, et c'est ce qui rend le rejeu
 *  sans doublon : brokkr retrouve l'objet du premier envoi (`ON CONFLICT`). Un
 *  `POST` rejoué sans identité fabriquerait un second objet, et personne ne
 *  saurait dire lequel garder — c'est ce qui interdisait toute création ici. */
export type CreationEnAttente = { genre: 'creation'; programId: string; id: string; parent: string } & (
  | { cible: 'macros'; corps: MacroCreate }
  | { cible: 'blocks'; corps: BlockCreate }
  | { cible: 'sessions'; corps: SessionCreate }
  | { cible: 'exercises'; corps: ExerciseLineCreate }
);

export type Geste = PatchEnAttente | BaseEnAttente | SuppressionEnAttente | OrdreEnAttente | DeplacementEnAttente | CreationEnAttente;

/** Un geste rangé porte une CLÉ, l'identité de ce rangement-là.
 *
 *  ⚠️ C'EST CE QUI REND LE REJEU SÛR PENDANT QU'ON ÉCRIT. Le disque se relit à
 *  chaque geste, et deux lectures rendent deux objets : l'identité JavaScript ne
 *  dit rien. Or pendant qu'un geste part, une frappe peut le fusionner — et la
 *  fusion est un geste NEUF, avec une clé neuve : ce que le rejeu a envoyé
 *  s'efface, ce qui s'est ajouté reste, même sur le même objet. */
export type EcritureEnAttente = Geste & { cle: string };

let compteur = 0;
const cleNeuve = () => `${Date.now().toString(36)}-${(++compteur).toString(36)}`;

/** Ce que le disque peut encore porter d'avant : l'entrée sans `genre` ni
 *  `cle`. On la lit comme un patch, avec une clé DÉDUITE de son contenu — la
 *  même à chaque lecture, sinon le rejeu ne saurait jamais l'effacer. */
type EntreeSurLeDisque = EcritureEnAttente | Omit<PatchEnAttente, 'genre'>;

export async function lireLaFile(): Promise<EcritureEnAttente[]> {
  const brut = (await get<EntreeSurLeDisque[]>(CLE)) ?? [];
  return brut.map(e => ('genre' in e ? e : { genre: 'patch', cle: `avant:${e.cible}/${e.id}`, ...e }));
}

/** ⚠️ LA FILE EST AUSSI UNE SOURCE D'AFFICHAGE, PAS SEULEMENT D'ENVOI (FRE-120).
 *  Ce qu'elle porte doit se voir à l'écran tant que ce n'est pas parti — sinon
 *  l'athlète qui rouvre l'app sans réseau retrouve l'ANCIENNE valeur, retape, et
 *  doute de l'app au moment où elle est censée le rassurer. D'où cet événement :
 *  ceux qui l'affichent se remettent à jour quand elle change, sans que ce
 *  module ait à les connaître. */
export const FILE_CHANGEE = 'eitri:file-hors-ligne';

async function ecrire(file: EcritureEnAttente[]): Promise<void> {
  await (file.length ? set(CLE, file) : del(CLE));
  window.dispatchEvent(new Event(FILE_CHANGEE));
}

/** ⚠️ UNE MODIFICATION DU DISQUE À LA FOIS. Chaque geste RELIT la file, la
 *  modifie, la RÉÉCRIT : deux gestes rangés au même instant lisaient tous deux
 *  la même file, et le second écrasait le premier. Vu par `make livrer`, le
 *  26/09 : un bloc renommé et une séance supprimée dans la même seconde sans
 *  réseau — le renommage est arrivé, la suppression jamais. */
let tour: Promise<unknown> = Promise.resolve();
function enSerie<T>(travail: () => Promise<T>): Promise<T> {
  const mien = tour.then(travail, travail);
  tour = mien.catch(() => undefined);
  return mien;
}

/** La file, telle qu'elle est MAINTENANT — pour l'afficher. */
export function useFileHorsLigne(): EcritureEnAttente[] {
  const [file, setFile] = useState<EcritureEnAttente[]>([]);
  useEffect(() => {
    let vivant = true;
    // ⚠️ MÊME CONTENU = MÊME OBJET. Cette valeur entre dans les dépendances de
    // l'effet qui recompose l'arbre : une identité neuve à chaque relecture le
    // relancerait pour rien, et chaque passage est une occasion d'écraser l'état
    // local — c'est comme ça qu'une ligne en cours de création a disparu.
    const relire = () => {
      void lireLaFile().then(f => {
        if (!vivant) return;
        setFile(avant => (JSON.stringify(avant) === JSON.stringify(f) ? avant : f));
      });
    };
    relire();
    window.addEventListener(FILE_CHANGEE, relire);
    return () => { vivant = false; window.removeEventListener(FILE_CHANGEE, relire); };
  }, []);
  return file;
}

/** Pose les gestes en attente PAR-DESSUS l'arbre reçu du serveur.
 *
 *  ⚠️ ON PARCOURT L'ARBRE, JAMAIS LA FILE — et ce n'est pas un détail de style,
 *  c'est ce qui empêche un objet SUPPRIMÉ de ressusciter. Un patch en attente
 *  désigne une ligne par son id ; si le coach l'a effacée depuis un autre
 *  appareil, itérer la file la ferait réapparaître à l'écran — un fantôme que le
 *  serveur ne connaît plus, et dans lequel l'athlète taperait pour rien.
 *
 *  ⚠️ IDEMPOTENTE PAR CONSTRUCTION. Quand la file part au retour du réseau, le
 *  serveur rend la même valeur et cette surcouche devient vide d'elle-même. Il
 *  n'y a aucun état à synchroniser, donc aucun état à désynchroniser.
 *
 *  ⚠️ ET ELLE N'ÉCRASE PAS UNE FRAPPE PLUS RÉCENTE : la file du disque est
 *  toujours au moins aussi fraîche que l'écran, parce que `garderPourPlusTard`
 *  fusionne la nouvelle valeur PAR-DESSUS l'ancienne. Ce qui est ici est donc le
 *  dernier état connu, jamais un état d'avant. */
/** Un bloc tel qu'il naît : nu, sans semaine (22/08). Ses dates ne s'écrivent
 *  pas : brokkr les déduit de ses semaines, et un bloc neuf n'en a aucune. */
function blocNeuf(id: string, numero: number, corps: BlockCreate | null | undefined): MacrocycleEditing['blocks'][number] {
  return {
    id, blockNumber: numero, name: corps?.name ?? '', startDate: '', endDate: '',
    base: (corps?.base as BlockBase | null | undefined) ?? createEmptyBlockBase(),
    objectives: [], objectivesVersion: '', weeks: [],
  };
}

/** Pose les objets CRÉÉS hors ligne dans l'arbre du serveur, sous leur parent.
 *  Un parent absent — d'un autre bloc, pas chargé — ne reçoit rien : l'objet
 *  n'y serait pas montré de toute façon. */
function materialiser(macros: MacrocycleEditing[], creations: CreationEnAttente[]): MacrocycleEditing[] {
  if (!creations.length) return macros;
  // Une copie : on pousse dans des tableaux, et l'arbre reçu appartient au cache.
  let arbre: MacrocycleEditing[] = structuredClone(macros);
  for (const c of creations) {
    if (c.cible === 'macros') {
      const bloc = c.corps.block;
      arbre = [...arbre, {
        id: c.id, macroNumber: arbre.length + 1, name: c.corps.name ?? '',
        trainingFrequency: c.corps.trainingFrequency ?? null, coachNotes: c.corps.coachNotes ?? null,
        blocks: bloc?.id ? [blocNeuf(bloc.id, 1, bloc)] : [],
      }];
    } else if (c.cible === 'blocks') {
      const m = arbre.find(x => x.id === c.parent);
      if (m) m.blocks.push(blocNeuf(c.id, m.blocks.length + 1, c.corps));
    } else if (c.cible === 'sessions') {
      const w = arbre.flatMap(m => m.blocks).flatMap(b => b.weeks).find(x => x.id === c.parent);
      if (w?.sessions) w.sessions.push({
        id: c.id, name: c.corps.name, sessionDate: c.corps.sessionDate ?? '',
        formOfTheDay: c.corps.formOfTheDay ?? null, exercises: [], lignesSansRessenti: 0,
      });
    } else {
      const s = arbre.flatMap(m => m.blocks).flatMap(b => b.weeks).flatMap(w => w.sessions ?? []).find(x => x.id === c.parent);
      if (s) s.exercises.push({ ...createEmptyExercise(), id: c.id, ...(c.corps.name ? { name: c.corps.name } : {}) });
    }
  }
  return arbre;
}

export function appliquerLaFile(
  macros: MacrocycleEditing[],
  file: Geste[],
): MacrocycleEditing[] {
  if (!file.length) return macros;
  const creations = file.filter((e): e is CreationEnAttente => e.genre === 'creation');
  macros = materialiser(macros, creations);
  const patchs = new Map<string, Record<string, unknown>>();
  const bases = new Map<string, BaseEnAttente['corps']>();
  const supprimes = new Set<string>();
  const ordres = new Map<string, string[]>();
  const deplacements: DeplacementEnAttente[] = [];
  for (const e of file) {
    if (e.genre === 'patch') patchs.set(`${e.cible}/${e.id}`, e.patch);
    else if (e.genre === 'base') bases.set(e.id, e.corps);
    else if (e.genre === 'suppression') supprimes.add(e.id);
    else if (e.genre === 'ordre') ordres.set(`${e.cible}/${e.id}`, e.ids);
    else if (e.genre === 'deplacement') deplacements.push(e);
  }
  const patch = (cible: CiblePatch, id: string | undefined) =>
    (id ? patchs.get(`${cible}/${id}`) : undefined);
  const vivant = (o: { id?: string }) => !o.id || !supprimes.has(o.id);
  /** Les objets dans l'ordre demandé ; ceux que la liste ne connaît pas gardent
   *  leur place relative, après. */
  const ordonner = <T extends { id?: string }>(objets: T[], ids: string[] | undefined): T[] => {
    if (!ids) return objets;
    const rang = new Map(ids.map((id, i) => [id, i]));
    return [...objets].sort((a, b) =>
      (a.id && rang.has(a.id) ? rang.get(a.id)! : ids.length) - (b.id && rang.has(b.id) ? rang.get(b.id)! : ids.length));
  };

  return macros.filter(vivant).map(m => ({
    ...m,
    ...patch('macros', m.id),
    blocks: m.blocks.filter(vivant).map(b => {
      const trame = bases.get(b.id);
      const dates = new Map(trame?.weekDates?.map(d => [d.weekId, d]));
      return {
        ...b,
        ...patch('blocks', b.id),
        ...(trame ? { base: trame.base } : {}),
        weeks: b.weeks.filter(vivant).map(w => {
          // Une ligne déplacée d'une séance à l'autre : on la sort, on la repose.
          const sessions = w.sessions?.filter(vivant).map(s => ({ ...s, exercises: s.exercises.filter(vivant) }));
          for (const d of deplacements) {
            if (!sessions) break;
            const source = sessions.find(s => s.exercises.some(e => e.id === d.id));
            const cible = sessions.find(s => s.id === d.sessionId);
            if (!source || !cible) continue;
            const ligne = source.exercises.find(e => e.id === d.id)!;
            source.exercises = source.exercises.filter(e => e.id !== d.id);
            cible.exercises = [...cible.exercises];
            cible.exercises.splice(Math.min(d.position, cible.exercises.length), 0, ligne);
          }
          return {
            ...w,
            ...(w.id && dates.has(w.id)
              ? { startDate: dates.get(w.id)!.startDate, endDate: dates.get(w.id)!.endDate }
              : {}),
            ...patch('weeks', w.id),
            sessions: sessions && ordonner(sessions, w.id ? ordres.get(`sessions/${w.id}`) : undefined).map(s => ({
              ...s,
              ...patch('sessions', s.id),
              exercises: ordonner(s.exercises, ordres.get(`exercises/${s.id}`))
                .map(e => ({ ...e, ...patch('exercises', e.id) })),
            })),
          };
        }),
      };
    }),
  }));
}

/** Deux gestes visent-ils le MÊME objet, de la même façon ? C'est ce qui
 *  décide de la fusion : un patch fusionne sur le patch précédent, une trame
 *  remplace la trame précédente. */
function memeGeste(a: Geste, b: Geste): boolean {
  if (a.genre !== b.genre || a.programId !== b.programId || a.id !== b.id) return false;
  if ('cible' in a && 'cible' in b) return a.cible === b.cible;
  return true;
}

/** Ce geste vise-t-il l'un de ces objets ? Un ordre vise son PARENT : la liste
 *  d'une séance supprimée n'a plus rien à ordonner. */
function vise(e: Geste, ids: Set<string>): boolean {
  return ids.has(e.id)
    || (e.genre === 'deplacement' && ids.has(e.sessionId))
    || (e.genre === 'creation' && ids.has(e.parent));
}

/** Range un geste pour plus tard. Un seul par objet : le plus récent fusionne
 *  sur le précédent (un patch) ou le remplace (une trame, un ordre), et passe
 *  en FIN de file — c'est sa place dans l'ordre des gestes.
 *
 *  `emporte` : les objets que ce geste fait disparaître — une suppression, et
 *  tout ce qu'elle entraîne (les séances d'une semaine, leurs lignes). Ce qui
 *  les visait encore sort de la file : rejoué, ce ne serait qu'un 404. */
export function garderPourPlusTard(geste: Geste, emporte: Iterable<string> = []): Promise<void> {
  return enSerie(() => garder(geste, emporte));
}

async function garder(geste: Geste, emporte: Iterable<string>): Promise<void> {
  const disparus = new Set(emporte);
  const avant = await lireLaFile();
  const file = avant.filter(e => !vise(e, disparus));
  // ⚠️ SUPPRIMER CE QU'ON VENAIT DE CRÉER, SANS RÉSEAU : les deux gestes
  // s'annulent. La création est déjà sortie avec `emporte` ; envoyer la
  // suppression seule ne serait qu'un 404 sur un objet que le serveur n'a
  // jamais vu.
  if (geste.genre === 'suppression' && avant.some(e => e.genre === 'creation' && e.id === geste.id)) {
    await ecrire(file);
    return;
  }
  const ancienne = file.find(e => memeGeste(e, geste));
  const fusion: EcritureEnAttente = geste.genre === 'patch' && ancienne?.genre === 'patch'
    ? { ...geste, cle: cleNeuve(), patch: { ...ancienne.patch, ...geste.patch } }
    : { ...geste, cle: cleNeuve() };
  await ecrire([...file.filter(e => !memeGeste(e, geste)), fusion]);
}

/** Retire tout ce qui visait ces objets. */
export function oublier(ids: Iterable<string>): Promise<void> {
  const vises = new Set(ids);
  return enSerie(async () => {
    const file = await lireLaFile();
    const reste = file.filter(e => !vise(e, vises));
    if (reste.length !== file.length) await ecrire(reste);
  });
}

/** ENVOIE un geste au serveur — le seul endroit qui connaisse le chemin et le
 *  corps de chacun. Lève ce que le client HTTP lève : `ApiError` sur un refus,
 *  autre chose quand la requête n'est jamais partie. */
export async function envoyer(e: Geste): Promise<void> {
  const racine = `/programs/${e.programId}`;
  switch (e.genre) {
    case 'patch':
      // ⚠️ CORPS NON TYPÉ (FRE-144) : ces patchs viennent de `pendingPatches`,
      // où ils sont déjà des sacs de clés. Ils traversent en plus IndexedDB,
      // d'où ils ressortent sans garantie de forme — un modèle posé ici
      // décrirait ce qu'on ESPÈRE avoir rangé, pas ce qu'on relit.
      await api.patch<unknown, Record<string, unknown>>(`${racine}/${e.cible}/${e.id}`, e.patch);
      return;
    case 'base':
      await api.put<unknown, BaseReplace>(`${racine}/blocks/${e.id}/base`, e.corps);
      return;
    case 'suppression':
      await api.delete(`${racine}/${e.cible}/${e.id}`);
      return;
    case 'ordre':
      // On envoie la liste COMPLÈTE des ids : le serveur vérifie qu'il ne
      // manque ni n'entre personne, ce qu'un « déplace X en position 3 » ne
      // permettrait pas.
      if (e.cible === 'sessions') {
        await api.put<unknown, SessionOrder>(`${racine}/weeks/${e.id}/sessions/order`, { ids: e.ids });
      } else {
        await api.put<unknown, ExerciseOrder>(`${racine}/sessions/${e.id}/exercises/order`, { exerciseIds: e.ids });
      }
      return;
    case 'deplacement':
      await api.put<unknown, ExerciseMove>(`${racine}/exercises/${e.id}/seance`,
                                           { sessionId: e.sessionId, position: e.position });
      return;
    case 'creation':
      // Le corps porte l'identité choisie : rejoué, brokkr retrouve l'objet.
      switch (e.cible) {
        case 'macros': await api.post<unknown, MacroCreate>(`${racine}/macros`, e.corps); return;
        case 'blocks': await api.post<unknown, BlockCreate>(`${racine}/macros/${e.parent}/blocks`, e.corps); return;
        case 'sessions': await api.post<unknown, SessionCreate>(`${racine}/weeks/${e.parent}/sessions`, e.corps); return;
        case 'exercises': await api.post<unknown, ExerciseLineCreate>(`${racine}/sessions/${e.parent}/exercises`, e.corps); return;
      }
  }
}

/** Un rejeu à la fois : `online` et le démarrage de l'app peuvent le demander
 *  ensemble, et deux parcours simultanés enverraient chaque geste deux fois. */
let rejeuEnCours: Promise<number> | null = null;

/** Rejoue tout ce qui attend. Rend le nombre de gestes effectivement écrits.
 *
 *  ⚠️ DANS L'ORDRE, ET UNE PAR UNE. Deux frappes sur le même champ doivent
 *  repartir dans l'ordre où elles ont été faites, sinon la valeur d'avant écrase
 *  la correction. `Promise.all` les enverrait en parallèle, et l'ordre
 *  d'arrivée deviendrait celui du réseau.
 *
 *  ⚠️ ET ON S'ARRÊTE AU PREMIER QUI NE PART PAS. Le réseau n'est pas revenu :
 *  continuer enverrait un geste AVANT celui dont il dépend — un renommage avant
 *  la création, qui serait alors refusé et perdu. Ce qui reste garde sa place.
 *
 *  ⚠️ UNE ÉCRITURE REFUSÉE, elle, sort de la file : le serveur a répondu, la
 *  rejouer indéfiniment ferait enfler un fichier que rien ne viderait — et
 *  masquerait le refus au lieu de le traiter. */
export function rejouerLaFile(): Promise<number> {
  if (rejeuEnCours) return rejeuEnCours;
  rejeuEnCours = rejouer().finally(() => { rejeuEnCours = null; });
  return rejeuEnCours;
}

async function rejouer(): Promise<number> {
  const file = await lireLaFile();
  if (!file.length) return 0;

  let ecrites = 0;
  const traitees = new Set<string>();
  for (const e of file) {
    try {
      await envoyer(e);
      ecrites += 1;
    } catch (erreur) {
      if (jamaisParvenueAuServeur(erreur)) break;
      // Un refus : on la laisse tomber, et le toast a déjà eu lieu à la saisie.
    }
    traitees.add(e.cle);
  }
  // ⚠️ RELUE, PAS REPRISE DE MÉMOIRE : un geste a pu s'ajouter — ou fusionner
  // sur l'un de ceux-ci, sous une clé neuve — pendant l'envoi. Il reste.
  await enSerie(async () => {
    const maintenant = await lireLaFile();
    await ecrire(maintenant.filter(e => !traitees.has(e.cle)));
  });
  return ecrites;
}
