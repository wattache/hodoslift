import type { MacroDeStructure } from '@/api/types';

/** LA GÉOMÉTRIE DE LA FRISE DE PÉRIODISATION — pure, sans JSX (15/09).
 *
 *  La vue Calendrier montrait douze mini-mois de 42 cases : un calendrier de
 *  JOURS, qui répète 365 fois « quel bloc couvre ce jour » et ne montre pas une
 *  périodisation. La frise montre la charpente — macros → blocs → semaines —,
 *  les compétitions et les événements, sur un axe continu.
 *
 *  ⚠️ UNE SEMAINE EST CE QUE SES DATES DISENT, JAMAIS UNE TRANCHE DE 7 JOURS.
 *  `startDate` / `endDate` viennent de brokkr ; les programmes réels portent des
 *  semaines de 5, 9, 10, 11 jours, et des TROUS entre deux blocs. Aucun `i += 7`,
 *  aucun lundi déduit : la largeur d'une semaine EST sa durée.
 *
 *  ⚠️ LA CHARPENTE, PAS L'ARBRE (FRE-119) : ce module ne lit que des numéros, des
 *  noms et des dates. Il ne connaît pas une séance. */

export type ISO = string;

/** Le type d'un bloc, qui DIT sa couleur (`--block-*`). */
export type TypeDeBloc = 'accumulation' | 'intensification' | 'realisation' | 'deload';

/** Un événement tel que la frise le lit : une compétition de l'athlète, ou un
 *  événement de son calendrier (vacances, déplacement, repos, autre). */
export interface EvenementDeFrise {
  id: string;
  nature: 'competition' | 'evenement';
  /** Le type serveur pour un événement (`vacation`, `travel`…) ; `competition` sinon. */
  type: string;
  nom: string;
  emoji: string;
  debut: ISO;
  fin: ISO;
  /** `false` = jour où l'athlète ne s'entraîne pas. `null` = on ne sait pas. */
  peutSEntrainer: boolean | null;
  /** Présent quand l'entrée vient d'une compétition : elle a une fiche. */
  competitionId?: string;
}

/* --------------------------------------------------------------------------- */
/* Les jours — calendaires, en UTC : un jour n'a pas de fuseau                  */
/* --------------------------------------------------------------------------- */

const MS_JOUR = 86_400_000;
const enJour = (iso: ISO): number => {
  const [a, m, j] = iso.split('-').map(Number);
  return Math.round(Date.UTC(a, m - 1, j) / MS_JOUR);
};
const enISO = (jour: number): ISO => new Date(jour * MS_JOUR).toISOString().slice(0, 10);
export const ajouterJours = (iso: ISO, n: number): ISO => enISO(enJour(iso) + n);
/** Nombre de jours de `a` à `b` (b − a). */
export const ecartEnJours = (a: ISO, b: ISO): number => enJour(b) - enJour(a);
/** Durée INCLUSIVE d'une plage : du lundi au dimanche, 7. */
export const dureeEnJours = (debut: ISO, fin: ISO): number => ecartEnJours(debut, fin) + 1;
/** 0 = lundi … 6 = dimanche. */
export const jourDeLaSemaine = (iso: ISO): number => (new Date(enJour(iso) * MS_JOUR).getUTCDay() + 6) % 7;
const chevauche = (a1: ISO, a2: ISO, b1: ISO, b2: ISO) => a1 <= b2 && b1 <= a2;

/* --------------------------------------------------------------------------- */
/* Le type de bloc                                                              */
/* --------------------------------------------------------------------------- */

/** Le type d'un bloc, dérivé de son NOM.
 *
 *  TODO(brokkr) : le type de bloc n'est pas une donnée du modèle — il faudrait un
 *  champ `training_blocks.kind` (accumulation / intensification / réalisation /
 *  décharge), choisi par le coach. D'ici là, le nom est le seul indice.
 *
 *  ⚠️ LE DÉFAUT EST `deload`, ET IL EST EXPLICITE : un bloc nommé « Bloc 1 » ne dit
 *  pas son type, et le gris est la seule couleur qui n'affirme rien. */
export function typeDeBloc(nom: string): TypeDeBloc {
  const n = nom.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/accu|volume|hypertroph/.test(n)) return 'accumulation';
  if (/intens|force|strength/.test(n)) return 'intensification';
  if (/reali|peak|affut|taper|compet/.test(n)) return 'realisation';
  return 'deload';
}

/* --------------------------------------------------------------------------- */
/* Les semaines réelles                                                         */
/* --------------------------------------------------------------------------- */

export interface SemaineReelle {
  /** L'identité serveur de la semaine : c'est elle qui ouvre l'Entraînement
   *  dessus (`/training?week=…`). */
  id: string;
  numero: number;
  debut: ISO;
  fin: ISO;
  duree: number;
  courante: boolean;
}

/** Un objectif de bloc, tel que la frise le montre au survol. Les champs sont
 *  optionnels côté serveur : `''` plutôt que `null`, pour n'avoir qu'un cas vide. */
export interface ObjectifDeFrise {
  exercice: string;
  variante: string;
  format: string;
  series: string;
  reps: string;
  chargeMin: string;
  chargeMax: string;
  atteint: boolean;
}

/** La semaine par laquelle OUVRIR un bloc : celle d'aujourd'hui s'il est en
 *  cours, la première sinon. */
export const semaineDEntree = (bloc: BandeDeBloc): SemaineReelle | null =>
  bloc.semaines.find(s => s.courante) ?? bloc.semaines[0] ?? null;

export interface BandeDeBloc {
  id: string;
  numero: number;
  nom: string;
  type: TypeDeBloc;
  macroId: string;
  macroNumero: number;
  macroNom: string;
  debut: ISO;
  fin: ISO;
  semaines: SemaineReelle[];
  objectifs: ObjectifDeFrise[];
  courant: boolean;
}

export interface LigneDeMacro {
  id: string;
  numero: number;
  nom: string;
  debut: ISO;
  fin: ISO;
  blocs: BandeDeBloc[];
}

/** La charpente, datée. Un bloc sans aucune date (ni la sienne, ni une semaine)
 *  n'a pas de place sur un axe de temps : il est écarté, pas inventé. */
export function lignesDeMacro(macros: MacroDeStructure[], aujourdhui: ISO): LigneDeMacro[] {
  const lignes: LigneDeMacro[] = [];
  for (const m of macros) {
    const blocs: BandeDeBloc[] = [];
    for (const b of m.blocks) {
      const semaines: SemaineReelle[] = b.weeks
        .filter(w => w.startDate && w.endDate)
        .map(w => ({
          id: w.id,
          numero: w.weekNumber,
          debut: w.startDate!,
          fin: w.endDate!,
          duree: dureeEnJours(w.startDate!, w.endDate!),
          courante: w.startDate! <= aujourdhui && aujourdhui <= w.endDate!,
        }))
        .sort((x, y) => x.debut.localeCompare(y.debut));
      const debut = b.startDate || semaines[0]?.debut || '';
      const fin = b.endDate || semaines.reduce((f, s) => (s.fin > f ? s.fin : f), '');
      if (!debut || !fin) continue;
      const nom = b.name || '';
      blocs.push({
        id: b.id, numero: b.blockNumber, nom, type: typeDeBloc(nom),
        macroId: m.id, macroNumero: m.macroNumber, macroNom: m.name || '',
        debut, fin, semaines,
        objectifs: (b.objectives ?? []).map(o => ({
          exercice: o.exercise ?? '', variante: o.variant ?? '', format: o.format ?? '',
          series: o.sets ?? '', reps: o.reps ?? '',
          chargeMin: o.weightMin ?? '', chargeMax: o.weightMax ?? '',
          atteint: Boolean(o.atteintLe),
        })),
        courant: debut <= aujourdhui && aujourdhui <= fin,
      });
    }
    if (blocs.length === 0) continue;
    blocs.sort((x, y) => x.debut.localeCompare(y.debut));
    lignes.push({
      id: m.id, numero: m.macroNumber, nom: m.name || '',
      debut: blocs[0].debut,
      fin: blocs.reduce((f, b) => (b.fin > f ? b.fin : f), ''),
      blocs,
    });
  }
  return lignes.sort((x, y) => x.debut.localeCompare(y.debut));
}

/* --------------------------------------------------------------------------- */
/* Les chevauchements — une erreur de saisie qui doit SE VOIR                   */
/* --------------------------------------------------------------------------- */

export interface Chevauchement {
  a: BandeDeBloc;
  b: BandeDeBloc;
  debut: ISO;
  fin: ISO;
  jours: number;
}

/** Les paires de blocs dont les dates se recouvrent, dans tout le programme.
 *
 *  ⚠️ CE N'EST PAS UN REFUS, C'EST UN SIGNAL (William, 16/09 : « si ça se recouvre
 *  c'est ok, du moment que visuellement ça se voit »). Un coach qui rattrape ses
 *  dates en oublie ou en inverse : sans marque, deux bandes du même macro se
 *  superposaient, et la seconde cachait la première — l'erreur était invisible.
 *  Mesuré le 16/09 : 4 paires en production, dont 3 dans un même macro.
 *
 *  ⚠️ ENTRE MACROS AUSSI : deux macros ne se déroulent pas en même temps chez un
 *  même athlète, et leurs lignes séparées ne disent pas qu'elles se recouvrent. */
export function chevauchements(lignes: LigneDeMacro[]): Chevauchement[] {
  const blocs = lignes.flatMap(l => l.blocs).sort((x, y) => x.debut.localeCompare(y.debut));
  const out: Chevauchement[] = [];
  for (let i = 0; i < blocs.length; i++) {
    for (let j = i + 1; j < blocs.length; j++) {
      const [a, b] = [blocs[i], blocs[j]];
      if (b.debut > a.fin) continue;
      const debut = b.debut;
      const fin = a.fin < b.fin ? a.fin : b.fin;
      out.push({ a, b, debut, fin, jours: dureeEnJours(debut, fin) });
    }
  }
  return out;
}

/* --------------------------------------------------------------------------- */
/* 2a — l'axe                                                                   */
/* --------------------------------------------------------------------------- */

export interface Axe {
  debut: ISO;
  fin: ISO;
  jours: number;
  /** Le premier jour de chaque mois, et sa position en jours depuis `debut`. */
  mois: { iso: ISO; x: number; largeur: number }[];
}

/** De début de mois à fin de mois : le programme, aujourd'hui, et les
 *  événements à venir dans les quatre mois qui suivent sa fin. Au-delà, une
 *  compétition lointaine étirerait l'axe et écraserait le programme. */
export function axeDeLaFrise(lignes: LigneDeMacro[], evenements: EvenementDeFrise[], aujourdhui: ISO): Axe {
  const bornes = [aujourdhui, ...lignes.flatMap(l => [l.debut, l.fin])];
  let debut = bornes.reduce((a, b) => (b < a ? b : a));
  let fin = bornes.reduce((a, b) => (b > a ? b : a));
  const horizon = ajouterJours(fin, 120);
  for (const e of evenements) {
    if (e.fin >= debut && e.debut <= horizon && e.fin > fin) fin = e.fin;
  }
  debut = `${debut.slice(0, 7)}-01`;
  const [a, m] = fin.slice(0, 7).split('-').map(Number);
  fin = enISO(Math.round(Date.UTC(a, m, 0) / MS_JOUR));   // dernier jour du mois
  const mois: Axe['mois'] = [];
  for (let d = debut; d <= fin;) {
    const [ay, mo] = d.split('-').map(Number);
    const suivant = enISO(Math.round(Date.UTC(ay, mo, 1) / MS_JOUR));
    mois.push({ iso: d, x: ecartEnJours(debut, d), largeur: ecartEnJours(d, suivant) });
    d = suivant;
  }
  return { debut, fin, jours: dureeEnJours(debut, fin), mois };
}

/** Position (en jours depuis le début de l'axe) et largeur (en jours) d'une plage. */
export const placer = (axe: Axe, debut: ISO, fin: ISO) => ({
  x: ecartEnJours(axe.debut, debut),
  largeur: dureeEnJours(debut, fin),
});

/* --------------------------------------------------------------------------- */
/* Le bandeau de situation                                                      */
/* --------------------------------------------------------------------------- */

export interface Situation {
  position: {
    bloc: BandeDeBloc;
    semaine: SemaineReelle | null;
    rangSemaine: number;           // 1-based, parmi les semaines datées du bloc
    nbSemaines: number;
    joursRestants: number;         // aujourd'hui exclu
  } | null;
  prochaineCompetition: { evenement: EvenementDeFrise; dansJours: number; semainesDePrepa: number } | null;
  prochainEvenement: { evenement: EvenementDeFrise; dansJours: number; joursTouches: number } | null;
}

export function situation(lignes: LigneDeMacro[], evenements: EvenementDeFrise[], aujourdhui: ISO): Situation {
  const blocs = lignes.flatMap(l => l.blocs);
  const bloc = blocs.find(b => b.courant) ?? null;
  const position = bloc && (() => {
    const rang = bloc.semaines.findIndex(s => s.courante);
    return {
      bloc,
      semaine: rang >= 0 ? bloc.semaines[rang] : null,
      rangSemaine: rang + 1,
      nbSemaines: bloc.semaines.length,
      joursRestants: ecartEnJours(aujourdhui, bloc.fin),
    };
  })();
  const aVenir = (nature: EvenementDeFrise['nature']) => evenements
    .filter(e => e.nature === nature && e.fin >= aujourdhui)
    .sort((a, b) => a.debut.localeCompare(b.debut))[0] ?? null;
  const compet = aVenir('competition');
  const evt = aVenir('evenement');
  return {
    position,
    // Les semaines de préparation : les semaines réelles qui commencent entre
    // aujourd'hui et la compétition — pas un écart divisé par 7.
    prochaineCompetition: compet && {
      evenement: compet,
      dansJours: Math.max(0, ecartEnJours(aujourdhui, compet.debut)),
      semainesDePrepa: blocs.flatMap(b => b.semaines)
        .filter(s => s.fin >= aujourdhui && s.debut < compet.debut).length,
    },
    prochainEvenement: evt && {
      evenement: evt,
      dansJours: Math.max(0, ecartEnJours(aujourdhui, evt.debut)),
      joursTouches: dureeEnJours(evt.debut, evt.fin),
    },
  };
}

/* --------------------------------------------------------------------------- */
/* 2b — le zoom : une ligne = une semaine réelle                                */
/* --------------------------------------------------------------------------- */

export interface JourDuZoom {
  iso: ISO;
  jourDeSemaine: number;          // 0 = lundi
  weekEnd: boolean;
  aujourdhui: boolean;
  /** Au moins un événement où l'athlète ne s'entraîne pas. */
  indisponible: boolean;
  evenements: EvenementDeFrise[];
}

export type LigneDuZoom =
  | { nature: 'semaine'; bloc: BandeDeBloc; semaine: SemaineReelle; jours: JourDuZoom[]; evenements: EvenementDeFrise[] }
  | { nature: 'trou'; debut: ISO; fin: ISO; duree: number };

/** Les semaines réelles autour d'aujourd'hui — `avant` passées, `apres` à venir
 *  en comptant la courante —, avec les TROUS entre elles. Un trou est un jour
 *  qu'aucune semaine ne couvre : il se montre comme tel, jamais comme un jour
 *  vide indistinct. */
export function zoomDeSemaines(
  lignes: LigneDeMacro[], evenements: EvenementDeFrise[], aujourdhui: ISO, avant = 3, apres = 5,
): LigneDuZoom[] {
  const toutes = lignes
    .flatMap(l => l.blocs.flatMap(bloc => bloc.semaines.map(semaine => ({ bloc, semaine }))))
    .sort((a, b) => a.semaine.debut.localeCompare(b.semaine.debut));
  if (toutes.length === 0) return [];
  let pivot = toutes.findIndex(s => s.semaine.fin >= aujourdhui);
  if (pivot < 0) pivot = toutes.length - 1;
  const fenetre = toutes.slice(Math.max(0, pivot - avant), pivot + apres);

  const lignesZoom: LigneDuZoom[] = [];
  let finPrecedente = null as ISO | null;
  for (const { bloc, semaine } of fenetre) {
    if (finPrecedente && ecartEnJours(finPrecedente, semaine.debut) > 1) {
      const debut = ajouterJours(finPrecedente, 1);
      const fin = ajouterJours(semaine.debut, -1);
      lignesZoom.push({ nature: 'trou', debut, fin, duree: dureeEnJours(debut, fin) });
    }
    const jours: JourDuZoom[] = [];
    for (let i = 0; i < semaine.duree; i++) {
      const iso = ajouterJours(semaine.debut, i);
      const ceJour = evenements.filter(e => e.debut <= iso && iso <= e.fin);
      const dow = jourDeLaSemaine(iso);
      jours.push({
        iso, jourDeSemaine: dow, weekEnd: dow >= 5, aujourdhui: iso === aujourdhui,
        indisponible: ceJour.some(e => e.nature === 'evenement' && e.peutSEntrainer === false),
        evenements: ceJour,
      });
    }
    lignesZoom.push({
      nature: 'semaine', bloc, semaine, jours,
      evenements: evenements.filter(e => chevauche(e.debut, e.fin, semaine.debut, semaine.fin)),
    });
    if (finPrecedente === null || semaine.fin > finPrecedente) finPrecedente = semaine.fin;
  }
  return lignesZoom;
}

/* --------------------------------------------------------------------------- */
/* 2c — les jalons à venir                                                      */
/* --------------------------------------------------------------------------- */

export type Jalon =
  | { nature: 'debut-bloc'; date: ISO; dansJours: number; bloc: BandeDeBloc }
  | { nature: 'fin-bloc'; date: ISO; dansJours: number; bloc: BandeDeBloc }
  | { nature: 'competition' | 'evenement'; date: ISO; dansJours: number; evenement: EvenementDeFrise; blocPendant: BandeDeBloc | null };

/** Les événements STRUCTURELS à venir — un par ligne, pas un jour par ligne. Un
 *  bloc en cours n'a plus de début à venir, mais sa fin l'est. */
export function jalonsAVenir(lignes: LigneDeMacro[], evenements: EvenementDeFrise[], aujourdhui: ISO, max = 8): Jalon[] {
  const blocs = lignes.flatMap(l => l.blocs);
  const dans = (d: ISO) => ecartEnJours(aujourdhui, d);
  const jalons: Jalon[] = [];
  for (const bloc of blocs) {
    if (bloc.debut > aujourdhui) jalons.push({ nature: 'debut-bloc', date: bloc.debut, dansJours: dans(bloc.debut), bloc });
    if (bloc.fin >= aujourdhui) jalons.push({ nature: 'fin-bloc', date: bloc.fin, dansJours: dans(bloc.fin), bloc });
  }
  for (const e of evenements) {
    if (e.debut < aujourdhui) continue;
    jalons.push({
      nature: e.nature, date: e.debut, dansJours: dans(e.debut), evenement: e,
      blocPendant: blocs.find(b => b.debut <= e.debut && e.debut <= b.fin) ?? null,
    });
  }
  // À date égale, la fin d'un bloc précède ce qui commence le lendemain de toute
  // façon ; le début d'un bloc passe avant un événement du même jour.
  const rang: Record<Jalon['nature'], number> = { 'fin-bloc': 0, 'debut-bloc': 1, competition: 2, evenement: 3 };
  return jalons.sort((a, b) => a.date.localeCompare(b.date) || rang[a.nature] - rang[b.nature]).slice(0, max);
}
