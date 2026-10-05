/** Fixtures du mode DEV-MOCK — servies par les hooks quand Firebase n'est pas
 *  configuré (pas de login, pas de backend). MÊME CONTRAT que l'API brokkr :
 *  les types viennent de `api/types.ts`, donc une dérive de shape casse le
 *  build, pas le runtime. Les écritures sont des no-op (le mode mock sert à
 *  vérifier l'UI, pas la persistance).
 */
import type { PoidsSemaines, Guichet } from '@/api/types';
import type {
  CoachAvailability,
  CoachProfile,
  Exercise,
  Athlete, Block, CalendarEvent, Competition, DailyLogs, Goal, Library, Macrocycle, Week,
  CoachCompetitionAvailability,
  ManualPr, Me, Signalement, TrackingResponse, UserRow, WeightCategories,
  BilanModele,
  BilanModeleResume,
  BilanResultat, BilanResume,
  MediaDemo,
  RecordDeForce,
  NoteKine,
  Douleur,
  LogLu,
  ObjectifTechnique,
} from './types';
import { createEmptyExercise } from '@/lib/exercise';

export const isMockDelayMs = 150;

export const mockMe: Me = {
  uid: 'mock-coach',
  email: 'coach@frenchforge.dev',
  displayName: 'Coach Démo',
  isCoach: true,
  // ⚠️ KINÉ AUSSI, DEPUIS LE 25/08 — et ce n'est pas un détail de fixture.
  //
  // Avec `isKine: false` et `useSuivis` qui rendait `[]`, `kineDeCetAthlete`
  // était TOUJOURS faux : `canMedical` se réduisait à `isSelf`. Conséquence,
  // TOUT le parcours du praticien était injouable en dev-mock — le catalogue de
  // modèles n'apparaissait pas dans la navigation, et le panneau des bilans ne
  // se voyait que parce que l'utilisateur du mock EST Léa, par un autre chemin.
  //
  // Autrement dit, le seul rôle que le chantier kiné construit était le seul
  // qu'aucun harnais ne traversait. Repéré par William en cherchant à relire la
  // maquette FRE-97/98 : « dev-mock n'est pas kiné, donc cette partie passe
  // toujours à la trappe des tests. »
  isKine: true,
  isAdmin: true,
  athleteId: 'mock-lea',
  // ⚠️ DEUX STRUCTURES (FRE-13), pour que le menu de choix EXISTE en dev-mock :
  // coach et kiné chez French Forge (avec sa fiche, Léa), coach seulement chez
  // SCAPPULIFT — le cas de Nico, à l'envers. Zoé y est son athlète
  // (`mockStructureDe`).
  structures: [
    { slug: 'french-forge', nom: 'French Forge', isCoach: true, isKine: true, athleteId: 'mock-lea' },
    { slug: 'scappulift', nom: 'SCAPPULIFT', isCoach: true, isKine: false, athleteId: null },
  ],
};

/** La structure de chaque fiche du dev-mock — French Forge sauf mention. */
export const mockStructureDe: Record<string, string> = { 'mock-zoe': 'scappulift' };

/** Profil coach du dev-mock (FRE-30). Renseigné : on veut voir le formulaire
 *  PRÉ-REMPLI, l'état « pas encore de profil » se teste en le passant à null. */
export const mockCoachProfile: CoachProfile = {
  slug: 'coach-demo',
  accroche: 'Coach street & force',
  bio: 'Accompagne des compétiteurs depuis 2019.',
  instagram: 'https://www.instagram.com/frenchforge/',
  photoUrl: 'https://storage.googleapis.com/french-forge-600-public-media/coach-demo/profil.png',
  oneRm: { muscleUp: 40, pullUp: 90, chinUp: 0, dip: 120, squat: 200 },
  langues: ['fr', 'en'],
};

export const mockAthletes: Athlete[] = [
  {
    id: 'mock-lea',
    firstName: 'Léa',
    lastName: 'Martin',
    gender: 'F',
    height: 168,
    weight: 62,
    age: 27,
    birthDate: '1999-03-14',
    coachId: 'mock-coach',
    programId: 'mock-program-lea',
    // ⚠️ LA SEULE À PORTER LES SEPT (FRE-147). Le bench et le deadlift viennent
    // d'entrer dans la Table RM : sans un athlète qui les a, aucune spec ne peut
    // voir un total SBD complet — et les trois autres, qui ne les ont pas,
    // montrent le cas RÉEL du jour de la livraison, où personne ne les a encore.
    currentOneRM: { muscleUp: 12, pullUp: 45, chinUp: 47.5, dip: 60, squat: 120,
                    benchPress: 55, deadlift: 130 },
    email: 'lea@frenchforge.dev',
    linkedUserId: 'mock-coach',
    // ⚠️ SERVI PAR BROKKR (FRE-92), et SEULEMENT pour qui a concouru. Léa a une
    // compétition dans ces fixtures, Théo et Nina n'en ont pas — c'est
    // volontaire : le dev-mock doit montrer les DEUX cas, dont le « — » qui
    // concerne 55 athlètes sur 59 en production.
    //
    // ⚠️ ET LE POIDS DU RIS (61,5) DIFFÈRE DU POIDS ACTUEL (62). C'est toute la
    // règle : un RIS vaut pour le poids auquel il a été réalisé, et l'écart est
    // une information — pas une erreur à corriger en recalculant.
    ris: 47.49,
    risTotal: 119,
    risBodyweight: 61.5,
    risCompetition: 'Open de Paris',
    risDate: iso(-120).slice(0, 10),
  },
  {
    id: 'mock-theo',
    firstName: 'Théo',
    lastName: 'Bernard',
    gender: 'M',
    height: 181,
    weight: 78,
    age: 24,
    birthDate: '2002-05-02',
    coachId: 'mock-coach',
    programId: 'mock-program-theo',
    currentOneRM: { muscleUp: 25, pullUp: 70, chinUp: 72.5, dip: 90, squat: 160 },
    email: 'theo@frenchforge.dev',
    // Compte lié DIFFÉRENT de celui de l'utilisateur mock : c'est lui qui permet
    // de vérifier que le calendrier lit les dispos de l'athlète AFFICHÉ.
    linkedUserId: 'user-1',
  },
  {
    id: 'mock-nina',
    firstName: 'Nina',
    lastName: 'Rousseau',
    gender: 'F',
    height: 164,
    weight: 58,
    age: 31,
    birthDate: '1995-01-20',
    coachId: 'other-coach',
    programId: null,
    currentOneRM: { pullUp: 30, dip: 42.5, squat: 95 },
    email: null,
    linkedUserId: null,
  },
  // ⚠️ UN ATHLÈTE ARCHIVÉ (FRE-127), et il est indispensable : sans lui, le
  // dev-mock ne montre jamais la liste masquée, et aucune spec ne peut vérifier
  // que « voir les archivés » a quelque chose à révéler. Il est chez le MÊME
  // coach que les autres, sinon il ne serait pas dans la liste du tout.
  {
    id: 'mock-paul',
    firstName: 'Paul',
    lastName: 'Suspendu',
    gender: 'M',
    height: 178,
    weight: 76,
    age: 34,
    birthDate: '1992-07-08',
    coachId: 'mock-coach',
    programId: null,
    currentOneRM: { pullUp: 20, dip: 30, squat: 80 },
    email: null,
    linkedUserId: null,
    archiveLe: iso(-45) + 'T09:00:00Z',
  },
  // ⚠️ L'ATHLÈTE SCAPPULIFT (FRE-13) — n'apparaît que dans cette structure
  // (`mockStructureDe`), donc dans aucune liste French Forge : les specs qui
  // comptent les athlètes de French Forge ne la voient pas.
  {
    id: 'mock-zoe',
    firstName: 'Zoé',
    lastName: 'Scappa',
    gender: 'F',
    height: 165,
    weight: 58,
    age: 24,
    birthDate: '2002-02-02',
    coachId: 'mock-coach',
    programId: null,
    currentOneRM: {},
    email: null,
    linkedUserId: null,
    archiveLe: null,
  },
];

/** La ligne d'exemple, DÉRIVÉE de la fabrique plutôt que recopiée.
 *  Elle recopiait les champs un à un, et avait déjà divergé : il lui manquait
 *  `clusterRest`, `repsDone`, `weightDone`, `restActual` et `feltRPEBySet`, et
 *  elle portait encore `linkedPrincipal`, retiré du contrat. */
const EX: Exercise = { ...createEmptyExercise(), id: '' };

/** Le socle d'une ligne de TRAME. Les mêmes champs qu'une ligne de séance moins
 *  le réalisé — la BASE n'a rien à réaliser. */
const BASE_LIGNE = {
  id: '', kind: null, variant: [] as string[], format: '', clusterMode: '',
  clusterRest: '', tempo: '', sets: '', reps: '', repsUnit: null,
  weight: '', weightLocked: false, assistance: '', aimedRPE: '', rest: '',
  coachNote: '', increment: '', incrementUnit: '' as const,
};

function iso(daysFromToday: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

/** UNE SEMAINE DE DÉCOR — des dates, pas de contenu (16/09).
 *
 *  ⚠️ LE CALENDRIER NE LIT QUE LA CHARPENTE (FRE-119) : numéros, dates, objectifs
 *  de bloc. Ces semaines-là lui suffisent, et elles donnent au dev-mock la forme
 *  d'un vrai programme — des blocs de QUATRE semaines, un PEAKING de deux, un
 *  macro passé — sans alourdir les fixtures de séances que les specs visent. */
const semaineDeDecor = (id: string, weekNumber: number, debut: number, jours = 7): Week => ({
  id, weekNumber, name: '', hidden: false,
  startDate: iso(debut), endDate: iso(debut + jours - 1),
  athlete: { firstName: 'Léa', lastName: 'Martin', height: 168, weight: 62 },
  sessions: [],
});

const BASE_VIDE = {
  daySplit: [], principles: [], accessories: [], selectedPrincipaux: null,
  granularity: {}, s1StartDate: '', s1EndDate: '',
};

const blocDeDecor = (id: string, blockNumber: number, name: string, debut: number, semaines: number): Block => ({
  id, blockNumber, name, objectivesVersion: 'mock', startDate: '', endDate: '',
  objectives: [], base: BASE_VIDE,
  weeks: Array.from({ length: semaines }, (_, i) => semaineDeDecor(`${id}-w${i + 1}`, i + 1, debut + i * 7)),
});

export const mockTraining: Macrocycle[] = [
  // Un macro PASSÉ : la frise doit montrer d'où vient l'athlète, pas seulement
  // où il en est.
  {
    id: 'macro-0',
    macroNumber: 1,
    name: 'Reprise',
    trainingFrequency: null,
    coachNotes: null,
    blocks: [
      blocDeDecor('block-0a', 1, 'Accumulation', -175, 4),
      blocDeDecor('block-0b', 2, 'Intensification', -147, 4),
      blocDeDecor('block-0c', 3, 'PEAKING', -119, 2),
    ],
  },
  {
    id: 'macro-1',
    macroNumber: 2,
    name: 'Prépa FNSL',
    trainingFrequency: null,
    coachNotes: null,
    blocks: [
      {
        id: 'block-1',
        blockNumber: 1,
        name: 'Accumulation',
        // Le dev-mock n'a pas de serveur pour refuser une version périmée (FRE-163).
        objectivesVersion: 'mock',
        startDate: '',
        endDate: '',
        objectives: [
          { id: '', exercise: 'MUSCLE UP', variant: 'Strict', format: '', sets: '5', reps: '3', weightMin: '5', weightMax: '8', assistance: '', atteintLe: null },
          // ⚠️ UN OBJECTIF ATTEINT, et il manquait : sans lui le dev-mock ne
          // montre jamais l'état que la coche existe pour dire — ni l'e2e ne
          // peut le viser dans la vue ATHLÈTE, qui est celle qui le lit.
          { id: '', exercise: 'SQUAT', variant: '', format: '', sets: '5', reps: '5', weightMin: '100', weightMax: '100', assistance: '', atteintLe: iso(-12) },
        ],
        weeks: [
          {
            id: 'week-1',
            weekNumber: 1,
            name: '',
            hidden: false,
            startDate: iso(-35),
            endDate: iso(-29),
            athlete: { firstName: 'Léa', lastName: 'Martin', height: 168, weight: 62 },
            sessions: [
              {
                id: 's1',
                name: 'Séance 1 — Haut du corps',
                sessionDate: iso(-18),
                formOfTheDay: 4,
                lignesSansRessenti: 0,
                exercises: [
                  { ...EX, id: 'ex-1', name: 'MUSCLE UP', variant: ['Strict'], tier: 1, tempo: '30X0', sets: '5', reps: '3', weight: '6', aimedRPE: '8', rest: '180', feltRPE: '8', feltRPEBySet: ['7.5', '8', '8', '8', '8.5'] },
                  { ...EX, id: 'ex-2', name: 'PULL UP', variant: ['Lesté'], tier: 2, tempo: '3-0-1-0', sets: '4', reps: '5', weight: '30', aimedRPE: '7.5', rest: '150', feltRPE: '7' },
                  { ...EX, id: 'ex-3', name: 'ROWING', variant: [], sets: '3', reps: '10', weight: '55', aimedRPE: '7', rest: '90', feltRPE: '' },
                  // ⚠️ UN REPOS LIBRE, ET LA SÉANCE N'EN AVAIT AUCUN (FRE-42).
                  // C'est pourtant le cas MAJORITAIRE en production — 7 299 des
                  // 13 501 lignes — et le seul où le repos réel se saisissait
                  // avant l'ouverture du champ. Sans lui ici, la spec du
                  // contre-exemple visait une ligne à repos PRESCRIT et ne
                  // gardait donc rien : elle répétait la spec précédente.
                  // ⚠️ UN EXERCICE AU CHRONO, ET LA MAQUETTE N'EN AVAIT AUCUN
                  // (FRE-42). La production en compte 253 — c'est la deuxième
                  // façon de prescrire une ligne, et aucun écran de test ne la
                  // montrait. `repsUnit: 'sec'` fait dire « Temps réel » à la
                  // saisie du réalisé au lieu de « Rép. réelles ».
                  //
                  // ⚠️ ET IL PORTE UNE CHARGE, comme 121 des 253 lignes réelles.
                  // Son tonnage est NULL À DESSEIN (FRE-20) : 3 × 60 s @ 10 kg
                  // ne déplace rien. Ne pas « réparer » ce vide en le voyant.
                  { ...EX, id: 'ex-3b', name: 'FACE PULL', variant: [], sets: '3', reps: '15', weight: '12', aimedRPE: '7', rest: '', feltRPE: '' },
                  { ...EX, id: 'ex-4b', name: 'CHINESE PLANK', variant: [], sets: '3', reps: '60', repsUnit: 'sec', weight: '10', aimedRPE: '8', rest: '90', feltRPE: '' },
                  // ⚠️ LA SEULE LIGNE « KINÉ » DU MOCK, ET ELLE PORTE UN TEMPO —
                  // sans elle le score de mécanotransduction (FRE-96) n'aurait
                  // aucune ligne où s'afficher ici, exactement comme en
                  // production (4 lignes `rehab`, aucune avec un tempo). Un
                  // écran qu'on ne peut pas voir est un écran qu'on ne garde pas.
                  // 3+0+1+0 = 4, × 12 reps = 48.
                  // ⚠️ `mechano` EST SERVI, PAS DÉDUIT (FRE-103). Le dev-mock
                  // tient le rôle du serveur : depuis que le calcul vit dans
                  // `ff_mechano`, le front ne fait plus que LIRE ce champ — s'il
                  // manquait ici, le score disparaîtrait de l'écran de démo sans
                  // qu'aucun type ne s'en plaigne. 3+0+1+0 = 4, × 12 = 48.
                  { ...EX, id: 'ex-6', name: 'FENTES BULGARE', variant: ['FFE'], kind: 'rehab', tempo: '3010', sets: '3', reps: '12', weight: '0', rest: '60', feltRPE: '', mechano: 48 },
                ],
              },
              {
                id: 's2',
                name: 'Séance 2 — Squat',
                // Datée ET notée : `FormSparkline` exige DEUX points pour tracer,
                // et le mock n'en avait qu'un — la forme du jour ne s'affichait
                // donc nulle part en dev-mock, y compris là où elle est le sujet.
                sessionDate: iso(-16),
                formOfTheDay: 2,
                lignesSansRessenti: 1,
                exercises: [
                  // Deux variantes cumulées (FRE-33).
                  // ⚠️ DES REPS RÉELLES SANS RESSENTI (FRE-160) : le seul trou de saisie
                  // qui se signale, et le mock doit en porter un pour que l'écran
                  // ait quelque chose à dire — une fois, pas partout.
                  { ...EX, id: 'ex-4', name: 'SQUAT', variant: ['HIGH BAR', 'PAUSE'], tier: 1, sets: '5', reps: '5', weight: '95', aimedRPE: '7.5', rest: '180', feltRPE: '', repsDone: '5' },
                  // ⚠️ UNE LIGNE COMMENCÉE PAR SÉRIE ET LAISSÉE À MOITIÉ (FRE-156).
                  // Quatre séries prescrites, deux notées : c'est la forme exacte
                  // de sept lignes de production, et le seul décor où le repère
                  // « 2/4 » de la ligne a quelque chose à dire. Le scalaire vaut
                  // la moyenne des deux notées, comme le serveur la calcule.
                  //
                  // ⚠️ ET LES DEUX RESSENTIS SONT ÉGAUX, à dessein : le mode par
                  // série ne s'ouvre alors PAS tout seul (`dejaParSerie` exige des
                  // valeurs distinctes), ce qui est précisément l'état où le
                  // repère doit se voir quand même — ligne repliée, bascule
                  // fermée, donnée incomplète.
                  { ...EX, id: 'ex-5', name: 'DIPS', variant: ['Lesté'], tier: 2, sets: '4', reps: '6', weight: '40', aimedRPE: '8', rest: '150', feltRPE: '8', feltRPEBySet: ['8', '8', '', ''] },
                ],
              },
            ],
          },
          {
            id: 'week-2',
            weekNumber: 2,
            name: '',
            hidden: false,
            startDate: iso(-28),
            endDate: iso(-22),
            athlete: { firstName: 'Léa', lastName: 'Martin', height: 168, weight: 62 },
            sessions: [
              {
                id: 's1',
                name: 'Séance 1 — Haut du corps',
                sessionDate: iso(-13),
                formOfTheDay: 5,
                lignesSansRessenti: 0,
                exercises: [
                  { ...EX, id: 'ex-6', name: 'MUSCLE UP', variant: ['Strict'], tier: 1, sets: '5', reps: '3', weight: '7', aimedRPE: '8', rest: '180', feltRPE: '' },
                  { ...EX, id: 'ex-7', name: 'PULL UP', variant: ['Lesté'], tier: 2, sets: '4', reps: '5', weight: '32.5', aimedRPE: '7.5', rest: '150', feltRPE: '' },
                  // BI-SET : deux lignes liées par le MÊME groupId. Le mock n'en
                  // contenait aucun, donc rien ne vérifiait son rendu — c'est ce
                  // qui a laissé passer son absence dans la vue « Détail ».
                  { ...EX, id: 'ex-8', name: 'CURL BICEPS', sets: '3', reps: '12', weight: '11.3', rest: '120', groupId: 'biset-s1-2-3', groupKind: 'biset', feltRPE: '' },
                  { ...EX, id: 'ex-9', name: 'EXTENSION TRICEPS', sets: '3', reps: '12', weight: '6.8', rest: '120', groupId: 'biset-s1-2-3', groupKind: 'biset', feltRPE: '' },
                ],
              },
            ],
          },
        ],
        base: {
          // ⚠️ UNE TRAME INCOHÉRENTE, DÉLIBÉRÉMENT (FRE-198) : la grille place
          // DIPS le J4, et la sélection ne le contient PAS. C'est l'état où
          // quatre cases ont disparu le 19/09 — un renommage laisse la grille
          // citer un mouvement que la sélection ne connaît plus. L'éditeur doit
          // le montrer quand même ; le jeter, c'est effacer sans un mot.
          selectedPrincipaux: ['MUSCLE UP', 'PULL UP', 'SQUAT'],
          granularity: {},
          accessories: [],
          s1StartDate: '',
          s1EndDate: '',
          daySplit: [
            { day: 'J1', tiers: { 'MUSCLE UP': 1, 'PULL UP': 2 } },
            { day: 'J4', tiers: { SQUAT: 1, DIPS: 2 } },
          ],
          principles: [
            { ...BASE_LIGNE, name: 'MUSCLE UP', tier: 1, variant: ['Strict'], format: '', clusterMode: '', clusterRest: '', tempo: '', sets: '5', reps: '3', weight: '6', weightLocked: false, rest: '180', aimedRPE: '8', assistance: '', increment: '1', incrementUnit: 'kg' },
          ],
        },
      },
      {
        id: 'block-2',
        blockNumber: 2,
        name: 'Intensification',
        // Le dev-mock n'a pas de serveur pour refuser une version périmée (FRE-163).
        objectivesVersion: 'mock',
        startDate: '',
        endDate: '',
        objectives: [],
        // BASE volontairement PIÉGEUSE (FRE-29) : le vendredi oppose le tier et
        // l'ordre canonique — SQUAT est tier 1, MUSCLE UP tier 2. L'ancien tri
        // sortait le squat en tête. Et PAS de `selectedPrincipaux`, pour exercer
        // le repli sur l'ordre canonique : c'est le cas de 48 des 107 vraies BASE.
        base: {
          selectedPrincipaux: null,
          granularity: {},
          s1StartDate: '',
          s1EndDate: '',
          daySplit: [
            { day: 'J5', tiers: { SQUAT: 1, 'MUSCLE UP': 2 } },
          ],
          // Deux accessoires du MÊME jour : de quoi exercer la liaison bi-set
          // depuis la BASE (FRE-31). Non liés au départ.
          accessories: [
            { ...BASE_LIGNE, groupId: '', groupKind: null, unbroken: false, day: 'J5', name: 'CURL', variant: [], format: '', clusterMode: '', clusterRest: '', tempo: '', sets: '3', reps: '12', repsUnit: 'count', weight: '10', weightLocked: false, rest: '90', aimedRPE: '', assistance: '', increment: '', incrementUnit: 'kg' },
            { ...BASE_LIGNE, groupId: '', groupKind: null, unbroken: false, day: 'J5', name: 'PLANK', variant: [], format: '', clusterMode: '', clusterRest: '', tempo: '', sets: '3', reps: '12', repsUnit: 'count', weight: '7', weightLocked: false, rest: '90', aimedRPE: '', assistance: '', increment: '', incrementUnit: 'kg' },
          ],
          principles: [
            { ...BASE_LIGNE, name: 'SQUAT', tier: 1, variant: [], format: '', clusterMode: '', clusterRest: '', tempo: '', sets: '5', reps: '3', repsUnit: 'count', weight: '140', weightLocked: false, rest: '180', aimedRPE: '8', assistance: '', increment: '', incrementUnit: 'kg' },
            { ...BASE_LIGNE, name: 'MUSCLE UP', tier: 2, variant: [], format: '', clusterMode: '', clusterRest: '', tempo: '', sets: '4', reps: '4', repsUnit: 'count', weight: '12', weightLocked: false, rest: '180', aimedRPE: '8', assistance: '', increment: '', incrementUnit: 'kg' },
          ],
        },
        weeks: [
          {
            id: 'week-3',
            weekNumber: 1,
            name: '',
            hidden: false,
            // ⚠️ NEUF JOURS, ET ELLE CONTIENT AUJOURD'HUI : les programmes réels
            // portent des semaines de 5 à 11 jours, et un mock tout en semaines de
            // 7 laisserait passer n'importe quel découpage `i += 7`.
            startDate: iso(-7),
            endDate: iso(1),
            athlete: { firstName: 'Léa', lastName: 'Martin', height: 168, weight: 62 },
            sessions: [
              {
                id: 's1',
                name: 'Séance 1',
                sessionDate: '',
                formOfTheDay: null,
                lignesSansRessenti: 0,
                exercises: [
                  { ...EX, id: 'ex-10', name: 'MUSCLE UP', variant: ['Strict'], tier: 1, sets: '4', reps: '2', weight: '9', weightLocked: true, aimedRPE: '8.5', rest: '210', feltRPE: '' },
                  // ⚠️ LE DROPSET VIT DANS UN AUTRE BLOC QUE LE BI-SET (FRE-36),
                  // et ce n'est pas de la mise en scène. Posé dans la même
                  // semaine, il changeait les COMPTES sur lesquels les specs du
                  // bi-set s'appuient — une case séries par groupe, une barre par
                  // ligne liée, le tonnage de la séance : trois d'entre elles
                  // sont tombées pour une raison qui n'avait rien à voir avec ce
                  // qu'elles gardent. Une fixture partagée qui bouge fait douter
                  // du produit à la place du décor.
                  //
                  // ⚠️ ET `rest` VAUT `-1` (libre) SUR LES DEUX LIGNES : un
                  // dropset n'a pas de repos entre ses descentes. Y mettre 120
                  // aurait fait passer les specs d'affordance pour une raison qui
                  // n'est pas la bonne — l'écran l'aurait masqué, mais la donnée
                  // aurait menti.
                  //
                  // Copié de la PRODUCTION : BACK EXTENSION 3×30 → 3×8, prescrit
                  // par un coach qui détournait le bi-set faute de mieux.
                  { ...EX, id: 'ex-11', name: 'BACK EXTENSION', sets: '3', reps: '30', weight: '', rest: '', groupId: 'dropset-s1-1-2', groupKind: 'dropset', feltRPE: '' },
                  { ...EX, id: 'ex-12', name: 'BACK EXTENSION', sets: '3', reps: '8', weight: '', rest: '', groupId: 'dropset-s1-1-2', groupKind: 'dropset', feltRPE: '' },
                ],
              },
              // UNE SÉANCE D'ENDURANCE À PART (FRE-116), et pas dans la Séance 1 :
              // posés à côté du dropset, ces groupes changeaient les comptes sur
              // lesquels les specs du dropset et des objectifs techniques s'appuient
              // (un MUSCLE UP et un SQUAT de plus, des cases de repos en plus).
              {
                id: 's2-endurance',
                name: 'Séance 2 — Endurance',
                sessionDate: '',
                formOfTheDay: null,
                lignesSansRessenti: 0,
                exercises: [
                  // CIRCUIT AVEC UNBROKEN (FRE-116) : les trois premiers sans lâcher
                  // la barre, le squat ensuite.
                  { ...EX, id: 'ex-9f', name: 'MUSCLE UP', sets: '3', reps: '3', rest: '180', groupId: 'circuit-s1-a', groupKind: 'circuit', unbroken: true },
                  { ...EX, id: 'ex-9g', name: 'PULL UP', sets: '3', reps: '5', rest: '180', groupId: 'circuit-s1-a', groupKind: 'circuit', unbroken: true },
                  { ...EX, id: 'ex-9h', name: 'DIPS', variant: ['BAR'], sets: '3', reps: '8', rest: '180', groupId: 'circuit-s1-a', groupKind: 'circuit' },
                  { ...EX, id: 'ex-9i', name: 'SQUAT', sets: '3', reps: '10', rest: '180', groupId: 'circuit-s1-a', groupKind: 'circuit' },
                  // EMOM EN ROTATION (FRE-116) — la séance d'endurance d'ELIAS : un
                  // mouvement par minute, trois tours. Le temps est celui du groupe.
                  { ...EX, id: 'ex-9a', name: 'PUSH UPS', sets: '3', reps: '11', clusterMode: '60', groupId: 'emom-s1-4-6', groupKind: 'emom', format: null },
                  { ...EX, id: 'ex-9b', name: 'PULL UP', sets: '3', reps: '6', clusterMode: '60', groupId: 'emom-s1-4-6', groupKind: 'emom', format: null },
                  { ...EX, id: 'ex-9c', name: 'DIPS', sets: '3', reps: '11', clusterMode: '60', groupId: 'emom-s1-4-6', groupKind: 'emom', format: null },
                  // AMRAP DE GROUPE (FRE-116) — le bi-set de Laura tel qu'il aurait dû
                  // s'écrire : des tours de 6 + 6, le plus possible en 5'.
                  { ...EX, id: 'ex-9d', name: 'SQUAT', reps: '6', clusterMode: '300', groupId: 'amrap-s1-7-8', groupKind: 'amrap', format: null, toursRealises: 7 },
                  { ...EX, id: 'ex-9e', name: 'PUSH UPS', reps: '6', clusterMode: '300', groupId: 'amrap-s1-7-8', groupKind: 'amrap', format: null, toursRealises: 7 },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];

/* ⚠️ LE RESTE DU PROGRAMME COURANT, AJOUTÉ APRÈS COUP. Les semaines qui portent
   des SÉANCES restent écrites en toutes lettres plus haut — les specs les visent
   par leur contenu. Celles-ci ne servent qu'à donner au bloc sa vraie longueur
   (quatre semaines), et au macro sa fin (un PEAKING de deux semaines, après deux
   jours hors programme). */
// ⚠️ LA S4 DÉBORDE DE CINQ JOURS SUR L'INTENSIFICATION, EXPRÈS : c'est l'erreur de
// saisie que la frise doit rendre VISIBLE (16/09) — 4 paires de blocs se
// recouvrent en production, et sans marque la seconde bande cachait la première.
mockTraining[1].blocks[0].weeks.push(semaineDeDecor('week-1c', 3, -19), semaineDeDecor('week-1d', 4, -9));
mockTraining[1].blocks[1].weeks.push(
  semaineDeDecor('week-3b', 2, 2), semaineDeDecor('week-3c', 3, 9), semaineDeDecor('week-3d', 4, 16),
);
mockTraining[1].blocks.push(blocDeDecor('block-3', 3, 'PEAKING', 25, 2));

/** Le suivi de poids par semaine (29/09) : Léa, partie de 63 kg il y a trois
 *  semaines, vise la pesée en −57 dans un mois. Trois semaines, la dernière en
 *  cours. Le calcul est celui de brokkr ; ici on ne fait que le figer. */
export const mockPoidsSemaines: PoidsSemaines = {
  depart: { kg: 63, date: iso(-20) },
  cible: { kg: 57, date: iso(30), competition: 'Open de printemps', categorie: '-57' },
  reference: 63,
  semaines: [
    { numero: 1, du: iso(-20), au: iso(-14), jours: 7, moyenne: 62.6, ecartKg: -0.4, ecartPct: -0.63, theorique: 62.28, ecartTheorique: 0.32, resteKg: 5.6, cheminPct: 6.7 },
    { numero: 2, du: iso(-13), au: iso(-7), jours: 5, moyenne: 62.1, ecartKg: -0.9, ecartPct: -1.43, theorique: 61.44, ecartTheorique: 0.66, resteKg: 5.1, cheminPct: 15 },
    { numero: 3, du: iso(-6), au: iso(0), jours: 4, moyenne: 61.7, ecartKg: -1.3, ecartPct: -2.06, theorique: 60.6, ecartTheorique: 1.1, resteKg: 4.7, cheminPct: 21.7 },
  ],
};

export const mockDailyLogs: DailyLogs = Object.fromEntries(
  Array.from({ length: 30 }, (_, i) => {
    const date = iso(-29 + i);
    return [date, {
      weight: Math.round((61.5 + Math.sin(i / 4) * 0.8) * 10) / 10,
      sleep: Math.round((7 + Math.sin(i / 3)) * 2) / 2,
      water: Math.round((2 + Math.cos(i / 5) * 0.5) * 10) / 10,
      ...(i % 3 === 0 ? { calories: 2200 + (i % 5) * 50 } : {}),
      // LA PHASE DU CYCLE (FRE-173) : déclarée quelques jours, pas tous — le
      // fond du graphe doit montrer des jours SANS phase entre deux déclarées,
      // et une phase qui change. Les jours 8 à 11 : menstruation ; 20 et 21 :
      // ovulation. Le reste ne déclare rien.
      ...(i >= 8 && i <= 11 ? { cycle: 'menstruation' as const }
        : i === 20 || i === 21 ? { cycle: 'ovulation' as const } : {}),
    }];
  }),
);

/** Le tableau des signalements — DEUX athlètes, et une intensité qui diverge.
 *  Un mock où tout le monde va bien ne montre pas ce que l'écran sert à voir :
 *  repérer d'un coup d'œil celui qu'il faut appeler. */
export const mockSignalements: Signalement[] = [
  // ⚠️ LÉA A LA MÊME DOULEUR DEUX FOIS, à trois jours d'écart : c'est ce que le
  // modèle sait enfin dire, et ce que l'écran doit montrer comme UNE douleur qui
  // revient — d'où `recurrente` et le compte de logs.
  { athleteId: 'mock-lea', firstName: 'Léa', lastName: 'Martin',
    programId: 'mock-prog-lea', date: iso(0),
    douleurs: [{ id: 'dlr-1', nom: 'Genou droit', zone: 'knees:droite',
                 intensite: 2, commentaire: 'Face externe, en fin de séance',
                 logs: 2, recurrente: true }] },
  // Deux douleurs LE MÊME JOUR : une seule ligne, une seule coche.
  { athleteId: 'mock-theo', firstName: 'Théo', lastName: 'Bernard',
    programId: 'mock-prog-theo', date: iso(0),
    douleurs: [{ id: 'dlr-2', nom: 'Lombaires', zone: 'lower-back:droite',
                 intensite: 8, commentaire: 'Depuis 2 semaines', logs: 1, recurrente: false },
               { id: 'dlr-3', nom: 'Trapèze', zone: 'trapezius:gauche',
                 intensite: 3, commentaire: null, logs: 1, recurrente: false }] },
  { athleteId: 'mock-lea', firstName: 'Léa', lastName: 'Martin',
    programId: 'mock-prog-lea', date: iso(-3),
    douleurs: [{ id: 'dlr-1', nom: 'Genou droit', zone: 'knees:droite',
                 intensite: 5, commentaire: null, logs: 2, recurrente: true }] },
];

export const mockEvents: CalendarEvent[] = [
  { id: 'evt-1', type: 'competition', name: 'Open du club', startDate: iso(21), endDate: iso(22), emoji: '⚔️', canTrain: false },
  { id: 'evt-2', type: 'vacation', name: 'Vacances', startDate: iso(45), endDate: iso(52), emoji: '🌴' },
  { id: 'evt-3', type: 'travel', name: 'Déplacement pro', startDate: iso(-2), endDate: iso(-1), emoji: '💼', canTrain: false },
];

export const mockGoals: Goal[] = [
  { id: 'goal-1', exercise: 'MUSCLE UP', sets: '1', reps: '1', weight: '15', motivation: 'Podium Coupe de France', createdAt: iso(-90) },
  { id: 'goal-2', exercise: 'SQUAT', sets: '1', reps: '1', weight: '130', motivation: '2× poids de corps', createdAt: iso(-60), achievedAt: iso(-10) },
];

export const mockPrs: ManualPr[] = [
  { id: 'pr-1', movement: 'MUSCLE UP', reps: 1, weight: 11, sets: null, format: null, variant: null, performedOn: iso(-120) },
  { id: 'pr-2', movement: 'SQUAT', reps: 3, weight: 110, sets: null, format: null, variant: null, performedOn: iso(-45) },
];

export const mockLibrary: Library = {
  exercices: [
    { id: 'lib-mu', name: 'MUSCLE UP', competition: true },
    { id: 'lib-pu', name: 'PULL UP', competition: true },
    { id: 'lib-cu', name: 'CHIN UP', competition: true },
    { id: 'lib-dips', name: 'DIPS', competition: true },
    { id: 'lib-sq', name: 'SQUAT', competition: true },
    { id: 'lib-row', name: 'ROWING', competition: false, supports: ['PULL UP'] },
    { id: 'lib-curl', name: 'CURL', competition: false, supports: ['CHIN UP'] },
    { id: 'lib-plank', name: 'PLANK', competition: false },
  ],
  variantes: [
    { id: 'lib-v1', name: 'Strict' },
    { id: 'lib-v2', name: 'Lesté' },
    { id: 'lib-v3', name: 'Tempo' },
    { id: 'lib-v4', name: 'Assisté' },
  ],
  assistances: [
    { id: 'lib-a1', name: 'Élastique' },
    { id: 'lib-a2', name: 'Poulie' },
  ],
  tempos: [
    { id: 'lib-t1', name: '30X0' },
    { id: 'lib-t2', name: '3-0-1-0' },
  ],
  formats: [
    { id: 'lib-f1', name: 'EMOM' },
    { id: 'lib-f2', name: 'AMRAP' },
    { id: 'lib-f3', name: 'CLUSTER' },
  ],
};

/** Un inscrit du plateau de démonstration (FRE-204). Chaque mouvement porte ses
 *  trois charges P / R / O, reprises à chaque essai, puis les verdicts des essais
 *  déjà passés — annoncés au R. Score et projection y sont posés comme brokkr
 *  les servirait : le dev-mock n'a pas de serveur pour les calculer. */
function inscritDuPlateau(
  name: string, gender: 'M' | 'F', weightCategory: string, bodyweight: number, flight: string,
  mouvements: [number, number, number, ...('rep' | 'norep')[]][], uid?: string,
): Competition['participants'][number] {
  const noms = ['MUSCLE UP', 'PULL UP', 'DIPS', 'SQUAT'];
  const movements = mouvements.map(([p, r, o, ...verdicts], m) => ({
    name: noms[m],
    attempts: [0, 1, 2].map(k => {
      const plan = { pessimistic: p + k * 2.5, realistic: r + k * 2.5, optimistic: o + k * 2.5 };
      const verdict = verdicts[k];
      return verdict
        ? { weight: plan.realistic, result: verdict, weights: plan, selectedTier: 'realistic' as const }
        : { weight: 0, result: '' as const, weights: plan };
    }),
  }));
  const meilleur = (m: typeof movements[number]) => Math.max(0, ...m.attempts.filter(a => a.result === 'rep').map(a => a.weight));
  const score = movements.reduce((t, m) => t + meilleur(m), 0);
  const vise = (tier: 'pessimistic' | 'realistic' | 'optimistic') => movements.reduce((t, m) =>
    t + Math.max(meilleur(m), ...m.attempts.filter(a => a.result === '').map(a => a.weights[tier])), 0);
  return {
    name, uid, gender, weightCategory, bodyweight, flight, competesOn: null, movements, score,
    projection: { pessimistic: vise('pessimistic'), realistic: vise('realistic'), optimistic: vise('optimistic') },
    risTotal: score, ris: null,
  };
}

export const mockCompetitions: Competition[] = [
  {
    id: 'comp-1',
    editorEmails: [],
    flights: [],
    // Le dev-mock n'a pas de serveur pour refuser une version périmée (FRE-162).
    version: 'mock',
    name: 'FNSL Inter-Région',
    startDate: iso(39),
    endDate: iso(40),
    date: iso(39),
    location: 'Lyon',
    maxAttempts: 3,
    movementNames: ['MUSCLE UP', 'PULL UP', 'DIPS', 'SQUAT'],
    createdBy: 'mock-coach',
    participantUids: ['mock-coach'],
    participants: [
      {
        name: 'Léa Martin',
        uid: 'mock-coach',
        competesOn: iso(39),
        bodyweight: 62,
        gender: 'F',
        weightCategory: '-64',
        score: 0,
        projection: { pessimistic: 134.5, realistic: 134.5, optimistic: 134.5 },
        risTotal: 0,
        ris: null,
        movements: [
          {
            name: 'MUSCLE UP',
            attempts: [
              { weight: 8, result: '', weights: { pessimistic: 6, realistic: 8, optimistic: 9 }, selectedTier: 'realistic' },
              { weight: 10, result: '' },
              { weight: 12, result: '' },
            ],
          },
          { name: 'SQUAT', attempts: [{ weight: 105, result: '' }, { weight: 115, result: '' }, { weight: 122.5, result: '' }] },
        ],
      },
    ],
  },
  {
    id: 'comp-0',
    editorEmails: [],
    flights: [],
    // Le dev-mock n'a pas de serveur pour refuser une version périmée (FRE-162).
    version: 'mock',
    name: 'FNSL Région',
    startDate: iso(-60),
    endDate: iso(-60),
    date: iso(-60),
    location: 'Paris',
    maxAttempts: 3,
    movementNames: ['MUSCLE UP', 'PULL UP', 'DIPS', 'SQUAT'],
    createdBy: 'mock-coach',
    participantUids: ['mock-coach'],
    participants: [
      {
        name: 'Léa Martin',
        uid: 'mock-coach',
        competesOn: null,
        bodyweight: 61.5,
        gender: 'F',
        weightCategory: '-64',
        score: 174,
        projection: { pessimistic: 174, realistic: 174, optimistic: 174 },
        risTotal: 174,
        ris: null,
        movements: [
          { name: 'MUSCLE UP', attempts: [{ weight: 6, result: 'rep' }, { weight: 9, result: 'rep' }, { weight: 11, result: 'norep', norepReason: 'FNSL' }] },
          { name: 'SQUAT', attempts: [{ weight: 100, result: 'rep' }, { weight: 110, result: 'rep' }, { weight: 117.5, result: 'norep' }] },
        ],
      },
    ],
  },
  // FRE-25 — compétition que l'athlète mock N'ENCADRE que : elle n'y concourt
  // pas. C'est le seul cas qui distingue « je suis participant » de « je suis
  // coach déclaré présent », donc le seul qui prouve la fonctionnalité.
  {
    id: 'comp-2',
    editorEmails: [],
    flights: [
      { name: 'A', categories: [{ gender: 'F', weightCategory: '-57' }, { gender: 'M', weightCategory: '-66' }] },
      { name: 'B', categories: [{ gender: 'M', weightCategory: '-80' }] },
    ],
    // Le dev-mock n'a pas de serveur pour refuser une version périmée (FRE-162).
    version: 'mock',
    name: 'FNSL',
    startDate: iso(70),
    endDate: iso(70),
    date: iso(70),
    location: 'Marseille',
    maxAttempts: 3,
    movementNames: ['MUSCLE UP', 'PULL UP', 'DIPS', 'SQUAT'],
    createdBy: 'mock-coach',
    // Participante étrangère aux athlètes du mock, VOLONTAIREMENT : si l'un
    // d'eux y concourait, la compétition apparaîtrait dans son calendrier pour
    // cette raison-là, et plus aucun test ne pourrait distinguer « j'encadre »
    // de « je participe ».
    participantUids: ['user-99'],
    // Le plateau de démonstration (FRE-204) : le groupe A a fini son muscle up,
    // le B en est au deuxième essai.
    participants: [
      { ...inscritDuPlateau('Marta Kowalska', 'F', '-57', 57, 'A', [[5, 7.5, 8.5, 'rep', 'rep', 'rep'], [30, 32.5, 35], [30, 33, 35], [40, 43, 46]], 'user-99'),
        competesOn: iso(70) },
      inscritDuPlateau('Inès Marchal', 'F', '-57', 56.2, 'A', [[7.5, 9, 10, 'rep', 'rep', 'norep'], [34, 37, 40], [32, 36, 40], [42, 46, 50]]),
      inscritDuPlateau('Sofia Renard', 'M', '-66', 65.1, 'A', [[10, 12, 12, 'rep', 'norep', 'rep'], [43, 46, 49], [45, 48, 51], [65, 70, 75]]),
      inscritDuPlateau('Willi Lagachette', 'M', '-80', 79.4, 'B', [[10, 12.5, 15, 'rep'], [60, 62.5, 65], [75, 80, 85], [172.5, 182.5, 192.5]]),
      inscritDuPlateau('Théo Vasseur', 'M', '-80', 78.1, 'B', [[10, 15, 17.5, 'rep'], [57.5, 60, 62.5], [70, 75, 80], [160, 170, 180]]),
      inscritDuPlateau('Karim Belhadj', 'M', '-80', 79.9, 'B', [[17.5, 20, 22.5, 'rep'], [70, 75, 80], [85, 90, 95], [190, 200, 210]]),
    ],
  },
  // L'échéance LOINTAINE : la frise doit la porter sans écraser le programme, et
  // le bandeau ne doit pas l'annoncer à la place de la prochaine.
  {
    id: 'comp-3',
    editorEmails: [],
    flights: [],
    // Le dev-mock n'a pas de serveur pour refuser une version périmée (FRE-162).
    version: 'mock',
    name: 'Final Rep Euro',
    startDate: iso(112),
    endDate: iso(113),
    date: iso(112),
    location: 'Bruxelles',
    maxAttempts: 3,
    movementNames: ['MUSCLE UP', 'PULL UP', 'DIPS', 'SQUAT'],
    createdBy: 'mock-coach',
    participantUids: ['mock-coach'],
    participants: [
      {
        name: 'Léa Martin',
        uid: 'mock-coach',
        competesOn: iso(112),
        bodyweight: 62,
        gender: 'F',
        weightCategory: '-64',
        score: 0,
        projection: { pessimistic: 0, realistic: 0, optimistic: 0 },
        risTotal: 0,
        ris: null,
        movements: [],
      },
    ],
  },
];

/** GET /competitions/coach-availability?coachUid=… — ce qu'UN coach a déclaré.
 *
 *  DEUX coachs, sur DEUX compétitions différentes, qu'aucun des deux ne dispute :
 *  c'est ce qui rend le comportement testable. Si les deux partageaient la même
 *  fixture, rien ne distinguerait « les dispos de l'athlète affiché » de « les
 *  dispos de l'utilisateur connecté » — le défaut corrigé par FRE-25. */
const MOCK_COACHING: Record<string, CoachCompetitionAvailability[]> = {
  // Léa (compte lié de l'utilisateur mock) encadre la FNSL.
  'mock-coach': [{ competitionId: 'comp-2', day: iso(70), status: 'available' }],
  // Théo encadre la FNSL Inter-Région, où il ne concourt pas non plus.
  'user-1': [{ competitionId: 'comp-1', day: iso(39), status: 'available' }],
};

export function mockCoachAvailability(coachUid: string): CoachCompetitionAvailability[] {
  return MOCK_COACHING[coachUid] ?? [];
}

/** ⚠️ CES CODES SONT CEUX DE LA VRAIE BASE, ET ILS NE L'ÉTAIENT PAS (FRE-140).
 *  La maquette servait `-59, -74, -83, -93, -105` côté hommes et `-47, -64, -72`
 *  côté femmes : TROIS codes en commun avec la production sur treize. Une spec
 *  écrite sur la maquette choisissait donc des catégories que la prod REFUSE —
 *  la colonne porte une clé étrangère composite vers `weight_categories`.
 *
 *  La source est `weight_categories`, peuplée par `docs/postgres-schema.sql`.
 *  L'accord est éprouvé par `e2e-reel/categories-de-poids.spec.ts`, qui compare
 *  cette constante à ce que `GET /weight-categories` rend vraiment : c'est le
 *  seul endroit où les deux existent en même temps. */
export const mockWeightCategories: WeightCategories = {
  M: ['-66', '-73', '-80', '-87', '-94', '-101', '+101'],
  F: ['-52', '-57', '-63', '-70', '+70'],
};

export const mockUsers: UserRow[] = [
  { uid: 'mock-coach', email: 'coach@frenchforge.dev', displayName: 'Coach Démo', isCoach: true, isKine: true, isAdmin: true,
    coachStructure: 'french-forge', kineStructure: 'french-forge', athleteStructures: ['french-forge'] },
  { uid: 'other-coach', email: 'autre@frenchforge.dev', displayName: 'Autre Coach', isCoach: true, isKine: false, isAdmin: false,
    coachStructure: 'french-forge', athleteStructures: [] },
  { uid: 'user-1', email: 'lea@frenchforge.dev', displayName: 'Léa Martin', isCoach: false, isKine: false, isAdmin: false,
    athleteStructures: ['french-forge'] },
];

export const mockTracking: TrackingResponse = {
  exercise: 'MUSCLE UP',
  exercises: [
    { name: 'MUSCLE UP', count: 220 },
    { name: 'SQUAT', count: 180 },
    { name: 'PULL UP', count: 160 },
  ],
  lastSessionDate: iso(-3),
  oneRmKg: 12,
  weeks: Array.from({ length: 16 }, (_, i) => ({
    week: iso(-7 * (16 - i)),
    chargeMaxKg: 4 + i * 0.5,
    tonnageAtMaxKg: 60 + i * 5,
    topSetFormat: i % 4 === 3 ? '3×2' : '5×3',
    // ⚠️ LA SEMAINE 10 PORTE UN ÉCHEC (`fails: 1`), et son volume TENU est donc
    // inférieur au PRESCRIT — c'est la seule semaine où le repère de FRE-110 se
    // dessine. Sans elle, le mock ne montrerait jamais le cas que la
    // fonctionnalité existe pour montrer, et l'e2e n'aurait rien à viser.
    tonnageTotalKg: i === 10 ? 220 + i * 12 - 130 : 220 + i * 12,
    tonnagePrevuTotalKg: 220 + i * 12,
    repsTotal: i === 10 ? 40 + (i % 5) * 4 - 12 : 40 + (i % 5) * 4,
    repsPrevuTotal: 40 + (i % 5) * 4,
    feltRpe: 7 + Math.sin(i / 2) * 0.8,
    aimedRpe: 7.5,
    sessions: 2,
    fails: i === 10 ? 1 : 0,
    failsAtMax: i === 10 ? 1 : 0,
    macroNumber: 1,
    blockNumber: i < 8 ? 1 : 2,
  })),
  // UNE COURBE PAR COMBINAISON (FRE-182) — quatre, pour que la légende en montre
  // une ÉTEINTE par défaut (seules les trois plus travaillées s'allument), et
  // qu'une combinaison « sans variante » soit une courbe comme une autre.
  courbes: [
    { variant: ['COMP'], tempo: null, format: null, series: 60, weeks: Array.from({ length: 16 }, (_, i) => ({
      week: iso(-7 * (16 - i)), chargeMaxKg: 4 + i * 0.5, topSetFormat: '5×3', tonnageTotalKg: 120 + i * 6, sessions: 1, fails: i === 10 ? 1 : 0 })) },
    { variant: [], tempo: null, format: null, series: 40, weeks: Array.from({ length: 8 }, (_, k) => ({
      week: iso(-7 * (16 - 2 * k)), chargeMaxKg: 2 + k * 0.8, topSetFormat: '4×4', tonnageTotalKg: 80 + k * 5, sessions: 1, fails: 0 })) },
    { variant: ['RINGS'], tempo: '310', format: null, series: 20, weeks: Array.from({ length: 5 }, (_, k) => ({
      week: iso(-7 * (15 - 3 * k)), chargeMaxKg: k * 1.2, topSetFormat: '3×3', tonnageTotalKg: 30 + k * 4, sessions: 1, fails: 0 })) },
    { variant: ['NO DIPS'], tempo: null, format: 'EMOM', series: 8, weeks: Array.from({ length: 3 }, (_, k) => ({
      week: iso(-7 * (6 - 2 * k)), chargeMaxKg: null, topSetFormat: '10×1', tonnageTotalKg: null, sessions: 1, fails: 0 })) },
  ],
  // LES SÉRIES PAR LIFT (FRE-148) — quatre semaines, et les trois cas de lecture.
  //
  // ⚠️ LE MOCK DOIT PORTER LES TROIS, sinon l'e2e ne peut viser que le cas
  // heureux — et c'est justement le cas heureux qui n'a pas besoin d'être
  // affiché. Semaine 2 : le bench press était au programme et n'a pas été fait
  // (0/3). Semaine 3 : une série de squat est tombée (6/7). Le muscle up
  // n'apparaît pas semaine 1 : rien n'était prévu, la cellule doit rester vide
  // — pas un zéro, qui se lirait comme un manquement.
  setsByMovement: [
    { week: iso(-28), movement: 'SQUAT', setsDone: 7, setsPlanned: 7 },
    { week: iso(-28), movement: 'PULL UP', setsDone: 8, setsPlanned: 8 },

    { week: iso(-21), movement: 'SQUAT', setsDone: 7, setsPlanned: 7 },
    { week: iso(-21), movement: 'PULL UP', setsDone: 8, setsPlanned: 8 },
    { week: iso(-21), movement: 'MUSCLE UP', setsDone: 6, setsPlanned: 6 },
    { week: iso(-21), movement: 'BENCH PRESS', setsDone: 0, setsPlanned: 3 },

    { week: iso(-14), movement: 'SQUAT', setsDone: 6, setsPlanned: 7 },
    { week: iso(-14), movement: 'PULL UP', setsDone: 9, setsPlanned: 9 },
    { week: iso(-14), movement: 'MUSCLE UP', setsDone: 6, setsPlanned: 6 },
    { week: iso(-14), movement: 'BENCH PRESS', setsDone: 3, setsPlanned: 3 },

    { week: iso(-7), movement: 'SQUAT', setsDone: 7, setsPlanned: 7 },
    { week: iso(-7), movement: 'PULL UP', setsDone: 8, setsPlanned: 11 },
    { week: iso(-7), movement: 'MUSCLE UP', setsDone: 5, setsPlanned: 5 },
    { week: iso(-7), movement: 'DEADLIFT', setsDone: 4, setsPlanned: 4 },
  ],
  athleteWeeks: Array.from({ length: 16 }, (_, i) => ({
    week: iso(-7 * (16 - i)),
    feltRpe: 7.2 + Math.sin(i / 2) * 0.6,
    aimedRpe: 7.5,
    sessions: 3,
    macroNumber: 1,
    blockNumber: i < 8 ? 1 : 2,
  })),
  rpeBlocks: [
    { macroNumber: 1, blockNumber: 1, from: iso(-112), to: iso(-57), weeks: 8, feltRpe: 7.1, aimedRpe: 7.4, gap: -0.3, rated: 96 },
    { macroNumber: 1, blockNumber: 2, from: iso(-56), to: iso(-3), weeks: 8, feltRpe: 7.9, aimedRpe: 7.5, gap: 0.4, rated: 88 },
  ],
};

/** Petite latence simulée pour rendre les états de chargement visibles. */
export function mockResolve<T>(data: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(structuredClone(data)), isMockDelayMs));
}

/** Matrice de disponibilité — construite comme le fait le serveur : tous les
 *  coachs × tous les jours de la compétition, `pending` par défaut. */
export function mockAvailability(competitionId: string): CoachAvailability[] {
  const comp = mockCompetitions.find(c => c.id === competitionId);
  if (!comp) return [];
  const days: string[] = [];
  for (let d = new Date(comp.startDate); d.toISOString().slice(0, 10) <= (comp.endDate || comp.startDate); d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  const coaches = [
    { coachUid: 'coach-1', coachName: 'Aubin' },
    { coachUid: 'coach-2', coachName: 'Willi' },
  ];
  return coaches.flatMap(c => days.map(day => ({ ...c, day, status: 'pending' as const })));
}

/* ----------------------------------------------------------------------------
 * Bilan kiné — de quoi voir l'écran sans compte ni réseau.
 *
 * ⚠️ LE RÉFÉRENTIEL MOCK EST VOLONTAIREMENT MINUSCULE. Recopier les 32 tests ici
 * ferait la seconde définition que le contrat cherche justement à éviter : quatre
 * suffisent à exercer les quatre formes d'affichage (aucune mesure, reps
 * bilatéral, secondes bilatéral, secondes de tronc).
 * ------------------------------------------------------------------------- */

export const mockBilanModeles: BilanModeleResume[] = [
  { id: 'modele-complet', nom: 'Bilan complet',
    description: 'Tests généraux, mobilité et activation.', archive: false, nbTests: 32 },
  { id: 'modele-cycliste', nom: 'Cycliste',
    description: 'Bilan court, bas du corps.', archive: false, nbTests: 8 },
];

/** Les résultats d'un bilan de démonstration — AVEC leur instantané, comme le
 *  sert brokkr. Trois formes couvertes : mesuré bilatéral, mesuré sans côté,
 *  non mesuré (le ressenti seul). */
/** UN MODÈLE COMPLET, pour que le COMPOSEUR existe en dev-mock.
 *
 *  ⚠️ IL MANQUAIT, ET C'EST TOUT UN ÉCRAN QUI TOMBAIT DANS LE VIDE. `useBilanModele`
 *  portait `enabled: … && !isMock` : cliquer un modèle du catalogue ouvrait un
 *  composeur sans rubrique ni test, donc une page blanche. Même défaut que celui
 *  d'`useAthletesSuivis` — une requête DÉSACTIVÉE en mock plutôt qu'une fixture
 *  fournie — et au même endroit : le parcours du kiné.
 *
 *  Les deux rubriques et leurs quatre tests reprennent ceux de `mockBilanResultats`,
 *  pour que le catalogue et un bilan passé racontent la même histoire.
 *
 *  ⚠️ UN TEST RETIRÉ dans le lot : c'est un état réel (`retire`), affiché en grisé
 *  et réactivable, que rien ne montrait ici. Un test qu'on ne voit jamais est un
 *  test dont on casse l'affichage sans s'en apercevoir.
 */
/** Le catalogue des médias de démonstration (FRE-99).
 *
 *  ⚠️ UNE ENTRÉE SANS URL, DÉLIBÉRÉMENT. `url` vaut `null` quand le stockage
 *  n'est pas joignable — clé absente en local, ou expirée (FRE-104). C'est un
 *  cas RÉEL que le front doit afficher proprement, et le seul moyen de vérifier
 *  qu'il le fait est d'en avoir un sous la main. */
export const mockMediasDemo: MediaDemo[] = [
  { id: 'media-1', type: 'image', legende: 'Départ, vue de face',
    url: 'https://placehold.co/240x160/1c1917/d6a439?text=Squat+overhead',
    creePar: 'mock-coach', creeLe: iso(-3) + 'T10:00:00Z' },
  { id: 'media-2', type: 'image', legende: null,
    url: 'https://placehold.co/240x160/1c1917/d6a439?text=Grip',
    creePar: 'mock-coach', creeLe: iso(-9) + 'T16:20:00Z' },
  { id: 'media-3', type: 'image', legende: 'Vignette indisponible (stockage injoignable)',
    url: null, creePar: 'mock-coach', creeLe: iso(-30) + 'T08:00:00Z' },
];

/** Les records du dev-mock (FRE-71 §9).
 *
 *  ⚠️ TROIS CASES SEULEMENT, ET C'EST VOULU : la grille en compte cinquante, et
 *  les cases VIDES sont la norme — personne n'a un record à chaque nombre de
 *  répétitions. Les remplir toutes montrerait un écran qui n'existe pas. */
export const mockRecords: RecordDeForce[] = [
  { movement: 'MUSCLE UP', reps: 1, weight: 12, sets: '5', variant: 'Strict',
    format: '', clusterMode: '', rpe: '9', date: iso(-14),
    location: 'Prépa Coupe de France · Accumulation · S1' },
  { movement: 'SQUAT', reps: 3, weight: 140, sets: '5', variant: '',
    format: '', clusterMode: '', rpe: '8', date: iso(-7),
    location: 'Prépa Coupe de France · Intensification · S2' },
  // Une case sans date ni RPE : l'historique d'avant la date de séance, qui
  // existe bel et bien et que l'écran doit afficher sans trou.
  { movement: 'DIPS', reps: 5, weight: 60, sets: '3', variant: 'Lesté',
    format: '', clusterMode: '', rpe: '', date: '',
    location: 'Prépa Coupe de France · Accumulation · S3' },
];

export const mockBilanModele: BilanModele = {
  id: 'modele-1',
  nom: 'Bilan complet',
  description: 'Tests généraux, mobilité et activation',
  archive: false,
  nbTests: 4,
  rubriques: [
    {
      id: 'rub-1', libelle: 'Tests généraux', ordre: 1,
      tests: [
        // ⚠️ UN TEST QUI PORTE DÉJÀ DEUX IMAGES (FRE-99). Une seule ne montrerait
        // pas ce qui fait la fonctionnalité — l'ORDRE, et la numérotation qui le
        // rend lisible ; zéro ne montrerait pas l'état « rattaché » du tout.
        { id: 't1', libelle: 'Squat overhead',
          protocole: '20 squats, bras tendus tenant un bâton',
          mesure: 'aucune', bilateral: false, chargeKg: null, materiel: null,
          vues: ['face', 'profil', 'dos'], cible: null, ordre: 1, retire: false,
          medias: [mockMediasDemo[0], mockMediasDemo[1]] },
      ],
    },
    {
      id: 'rub-2', libelle: "Tests d'activation musculaire", ordre: 2,
      tests: [
        { id: 't3', libelle: 'Grip',
          protocole: 'Tenir un disque du bout des doigts, isométrie jusqu’à l’échec',
          mesure: 'secondes', bilateral: true, chargeKg: 15, materiel: 'disque',
          vues: ['profil'], cible: null, ordre: 1, retire: false,
          medias: [] },
        { id: 't4', libelle: 'Érecteur du rachis',
          protocole: 'GHD, pencher le torse puis remonter. Maintien',
          mesure: 'secondes', bilateral: false, chargeKg: 40, materiel: 'GHD',
          vues: ['profil'], cible: '60 s', ordre: 2, retire: false,
          medias: [] },
        { id: 't5', libelle: 'Gainage latéral (retiré du modèle)',
          protocole: 'Sur le coude, bassin décollé',
          mesure: 'secondes', bilateral: true, chargeKg: null, materiel: null,
          vues: [], cible: null, ordre: 3, retire: true,
          medias: [] },
      ],
    },
  ],
};

export const mockBilanResultats: BilanResultat[] = [
  { id: 'res-1', testId: 't1', testLibelle: 'Squat overhead', rubriqueLibelle: 'Tests généraux',
    protocole: '20 squats, bras tendus tenant un bâton', vues: ['face', 'profil', 'dos'],
    cible: null, mesure: 'aucune', bilateral: false, ordre: 1, ressenti: 'ras', detail: null,
    mesureGauche: null, mesureDroite: null, chargeKg: null, materiel: null,
    // ⚠️ LES IMAGES VIENNENT DE L'INSTANTANÉ DU RÉSULTAT (FRE-99), pas du modèle :
    // sans un résultat qui en porte, l'écran de saisie ne montrerait jamais ce
    // chemin — c'est pourtant le seul endroit où quelqu'un exécute le mouvement.
    medias: [mockMediasDemo[0], mockMediasDemo[1]] },
  { id: 'res-2', testId: 't2', testLibelle: 'Cervicale — rotation', rubriqueLibelle: 'Tests de mobilité',
    protocole: '3 rotations droites, 3 gauches', vues: ['face'], cible: null,
    mesure: 'aucune', bilateral: false, ordre: 2, ressenti: 'gene', detail: 'tire à droite',
    mesureGauche: null, mesureDroite: null, chargeKg: null, materiel: null,
    medias: [] },
  { id: 'res-3', testId: 't3', testLibelle: 'Grip', rubriqueLibelle: "Tests d'activation musculaire",
    protocole: 'Tenir un disque du bout des doigts, isométrie jusqu’à l’échec',
    vues: ['profil'], cible: null, mesure: 'secondes', bilateral: true, ordre: 3, ressenti: null, detail: null,
    mesureGauche: null, mesureDroite: null, chargeKg: 15, materiel: 'disque',
    // ⚠️ RATTACHÉ MAIS SANS URL — le cas d'une clé expirée (FRE-104). L'écran
    // doit le DIRE : sans ça, une panne ressemble à « ce test n'a pas d'image ».
    medias: [mockMediasDemo[2]] },
  { id: 'res-4', testId: 't4', testLibelle: 'Érecteur du rachis', rubriqueLibelle: "Tests d'activation musculaire",
    protocole: 'GHD, pencher le torse puis remonter. Maintien', vues: ['profil'],
    cible: '60 s', mesure: 'secondes', bilateral: false, ordre: 4, ressenti: null, detail: null,
    mesureGauche: null, mesureDroite: null, chargeKg: 40, materiel: 'GHD',
    medias: [] },
];

/** LE JOURNAL DE SUIVI DU KINÉ (FRE-102).
 *
 *  ⚠️ TROIS ENTRÉES ET NON UNE, parce que c'est l'ORDRE qui est la
 *  fonctionnalité : « il sait où il en est » veut dire que l'état courant se lit
 *  en premier. Avec une seule note, rien ne dirait si le tri est le bon.
 *
 *  ⚠️ ET LEUR CONTENU RESSEMBLE À DU SUIVI RÉEL — une hypothèse, une évolution,
 *  une décision — parce que c'est ce qui montre à quoi sert le journal. Des
 *  « note 1 / note 2 » rempliraient l'écran sans rien démontrer. */
/** LES DOULEURS SUIVIES (FRE-195).
 *
 *  ⚠️ LES TROIS CAS QUE L'ÉCRAN DOIT SAVOIR MONTRER, et pas un jeu décoratif :
 *  une douleur RÉCURRENTE (plusieurs logs), une PONCTUELLE (un seul), et une
 *  CLOSE qui garde son historique. Ce sont les trois états que la lecture
 *  distingue — `recurrente` se déduit du compte, côté serveur.
 *
 *  Les zones sont des CODES, côté de l'athlète : `deltoid-anterior:droite` se touche à
 *  GAUCHE de l'écran en vue de face. */
export const mockDouleurs: Douleur[] = [
  { id: 'dlr-1', nom: 'Mon épaule', zone: 'deltoid-anterior:droite',
    debut: '2022-09-01', fin: null, logs: 4, recurrente: true,
    derniere: { date: iso(-1), intensite: 3, commentaire: 'Tire encore aux dips' } },
  { id: 'dlr-2', nom: 'Genou gauche', zone: 'knees:gauche',
    debut: '2026-05-31', fin: null, logs: 1, recurrente: false,
    derniere: { date: iso(-6), intensite: 6, commentaire: 'Fissure au ménisque' } },
  { id: 'dlr-3', nom: 'Le coude qui tire', zone: 'forearm:gauche',
    debut: '2026-03-02', fin: '2026-04-18', logs: 3, recurrente: true,
    derniere: { date: '2026-04-18', intensite: 0, commentaire: null } },
];

/** L'HISTOIRE DE CHAQUE DOULEUR (FRE-197).
 *
 *  ⚠️ UNE INTENSITÉ QUI BOUGE, ET DES TROUS. Un mock où tous les relevés se
 *  suivent jour après jour ne montre pas ce que la courbe sert à voir : une
 *  douleur qui s'améliore, et des jours où personne n'a noté. Les trous sont
 *  le cas que la courbe doit rendre visible SANS l'inventer — relier deux
 *  points distants de trois semaines par une ligne droite raconterait vingt
 *  jours de douleur que personne n'a déclarés. */
export const mockLogsDeDouleur = (id: string): LogLu[] => ({
  'dlr-1': [
    // ⚠️ LES TROIS ÉTATS SONT REPRÉSENTÉS, sinon l'écran n'en montre qu'un :
    // un jour entraîné, un jour de repos qui fait mal quand même — le cas qui
    // a motivé la colonne — et deux relevés d'avant la question.
    { date: iso(-1), intensite: 3, commentaire: 'Tire encore aux dips', entrainement: true },
    { date: iso(-8), intensite: 5, commentaire: 'Échauffement plus long, ça passe mieux',
      entrainement: false },
    { date: iso(-30), intensite: 7, commentaire: 'Réveil difficile, gêne au réveil du bras' },
    { date: iso(-44), intensite: 6, commentaire: null },
  ],
  'dlr-2': [
    { date: iso(-6), intensite: 6, commentaire: 'Fissure au ménisque' },
  ],
  'dlr-3': [
    { date: '2026-04-18', intensite: 0, commentaire: null },
    { date: '2026-04-02', intensite: 2, commentaire: 'Presque plus rien' },
    { date: '2026-03-02', intensite: 6, commentaire: 'Départ après une séance de traction' },
  ],
}[id] ?? []);

export const mockNotesKine: NoteKine[] = [
  { id: 'note-3', kineUid: 'mock-coach', contenu:
      'Reprise du gainage sans douleur. On peut recharger progressivement la semaine prochaine.',
    creeLe: iso(-1) + 'T09:12:00Z', modifieLe: iso(-1) + 'T09:12:00Z' },
  { id: 'note-2', kineUid: 'mock-coach', contenu:
      'Séance de mobilité épaule. Amplitude droite encore limitée, mais plus de douleur en fin de course.',
    creeLe: iso(-8) + 'T18:40:00Z', modifieLe: iso(-8) + 'T18:40:00Z' },
  { id: 'note-1', kineUid: 'mock-coach', contenu:
      'Suspicion de tendinopathie de la coiffe à droite. À surveiller avant de charger.',
    creeLe: iso(-22) + 'T11:05:00Z', modifieLe: iso(-21) + 'T08:30:00Z' },
];

/** LES OBJECTIFS TECHNIQUES (FRE-122) — de vraies corrections de coach.
 *
 *  ⚠️ LE MOCK PORTE LES TROIS CAS QUE L'ÉCRAN DOIT DISTINGUER, sans quoi le
 *  dev-mock ne montrerait jamais ce que la fonctionnalité existe pour montrer :
 *
 *    * MUSCLE UP en porte DEUX ouverts — la pastille doit dire « 2 », pas
 *      seulement s'allumer ;
 *    * SQUAT en porte un ouvert et un CLOS — le clos ne compte pas dans la
 *      pastille, mais reste lisible dans le journal ;
 *    * les autres mouvements n'en ont aucun — le contre-exemple, celui qui
 *      prouve que la pastille ne s'affiche pas partout. */
export const mockObjectifsTechniques: ObjectifTechnique[] = [
  { id: 'obj-4', mouvement: 'MUSCLE UP', texte: 'Garde les coudes hauts à la transition.',
    creePar: 'mock-coach', creeLe: iso(-2) + 'T10:00:00Z', closLe: null },
  { id: 'obj-3', mouvement: 'MUSCLE UP', texte: 'Ne casse pas les poignets en fin de tirage.',
    creePar: 'mock-coach', creeLe: iso(-9) + 'T17:30:00Z', closLe: null },
  { id: 'obj-2', mouvement: 'SQUAT', texte: 'Descends sous la parallèle, même chargé.',
    creePar: 'mock-coach', creeLe: iso(-16) + 'T08:15:00Z', closLe: null },
  // ⚠️ UN CLOS SUR MUSCLE UP, ET IL EST LÀ POUR UNE RAISON PRÉCISE. Le clos de
  // SQUAT ne suffisait pas : SQUAT n'apparaît dans aucune séance du mock, donc
  // une pastille qui aurait compté les objectifs clos serait restée VERTE. La
  // mutation l'a montré. Il faut un clos sur un mouvement RÉELLEMENT AFFICHÉ
  // pour que « la pastille ne compte que les ouverts » soit une promesse tenue.
  { id: 'obj-0', mouvement: 'MUSCLE UP', texte: 'Arrête de tirer en deux temps.',
    creePar: 'mock-coach', creeLe: iso(-75) + 'T09:00:00Z', closLe: iso(-30) + 'T09:00:00Z' },
  { id: 'obj-1', mouvement: 'SQUAT', texte: 'Garde les talons au sol.',
    creePar: 'mock-coach', creeLe: iso(-60) + 'T09:00:00Z', closLe: iso(-20) + 'T09:00:00Z' },
];

export const mockBilans: BilanResume[] = [
  // Un bilan À PEINE OUVERT (0/32) et un bilan entamé : les deux états que
  // l'écran traite différemment — « Finaliser » est refusé sur le premier.
  { id: 'bilan-neuf', date: iso(0).slice(0, 10), statut: 'en_cours', kineUid: 'kine-1',
    modeleNom: 'Bilan complet', testsRenseignes: 0, testsTotal: 4 },
  { id: 'bilan-1', date: iso(-2).slice(0, 10), statut: 'en_cours', kineUid: 'kine-1',
    modeleNom: 'Bilan complet', testsRenseignes: 2, testsTotal: 4 },
  { id: 'bilan-0', date: iso(-120).slice(0, 10), statut: 'finalise', kineUid: 'kine-1',
    modeleNom: 'Bilan complet', testsRenseignes: 4, testsTotal: 4 },
];

/** LE GUICHET DU COACH — les trois types de dossier, ET la file vide.
 *
 *  ⚠️ UN MOCK À ÉTAT, et c'est voulu. Les writers du mock sont des no-op partout
 *  ailleurs (FRE-35), mais ici le geste central est « Vu · suivant » et il doit
 *  faire AVANCER la file : sans état, la moitié de l'écran — le suivant, le
 *  restant, la file vide — ne serait traversée par aucune spec. L'état vit dans
 *  la page ; chaque test Playwright repart d'un chargement neuf. */
let _guichet: Guichet['dossiers'] = [];
function _guichetInitial(): Guichet['dossiers'] {
  const lea = { athleteId: 'mock-lea', firstName: 'Léa', lastName: 'Martin', programId: 'mock-program-lea' };
  const theo = { athleteId: 'mock-theo', firstName: 'Théo', lastName: 'Bernard', programId: 'mock-program-theo' };
  return [
    // La douleur EN TÊTE, toujours. Sur l'échelle déclarée du questionnaire.
    { type: 'douleur', athlete: lea, date: iso(0),
      douleurs: [{ id: 'dlr-1', nom: 'Genou droit', zone: 'knees:droite',
                   intensite: 7, commentaire: 'Face externe, depuis hier',
                   logs: 2, recurrente: true }],
      seanceDuJour: { sessionId: 's1', weekId: 'week-3', programId: 'mock-program-lea', name: 'Séance 1' } },
    // Deux séances : la plus ANCIENNE d'abord, et l'une dépasse son RPE visé.
    { type: 'seance', athlete: theo, programId: 'mock-program-theo', sessionId: 'theo-s1', weekId: 'theo-w1',
      name: 'Lundi — Haut', blockName: 'Accumulation', weekNumber: 1,
      date: iso(-2), seriesTenues: 11, seriesTotal: 12, tonnageKg: 4210,
      rpeRessenti: 8.5, rpeVise: 7,
      exercices: [
        { name: 'MUSCLE UP', charge: '9', rpe: '9', seriesTenues: 4, seriesTotal: 4 },
        { name: 'PULL UP', charge: '30', rpe: '8.5', seriesTenues: 4, seriesTotal: 5 },
        { name: 'DIPS', charge: '40', rpe: '8', seriesTenues: 3, seriesTotal: 3 }],
      retours: ['Coudes qui tirent sur la dernière série de MU.'] },
    { type: 'seance', athlete: lea, programId: 'mock-program-lea', sessionId: 's1', weekId: 'week-3',
      name: 'Séance 1', blockName: 'Intensification', weekNumber: 1,
      date: iso(-1), seriesTenues: 9, seriesTotal: 9, tonnageKg: 2870,
      rpeRessenti: 7.5, rpeVise: 8,
      exercices: [
        { name: 'MUSCLE UP', charge: '9', rpe: '8.5', seriesTenues: 4, seriesTotal: 4 },
        { name: 'BACK EXTENSION', charge: '30', rpe: '7', seriesTenues: 3, seriesTotal: 3 }],
      retours: [] },
    // La semaine à écrire : la S1 est réalisée, rien après (FRE-179). Le dossier
    // porte la RÉALISÉE (`theo-w1`), d'où on prolonge.
    { type: 'semaine', athlete: theo, programId: 'mock-program-theo', blockId: 'theo-b1', weekId: 'theo-w1',
      weekNumber: 2, blockName: 'Accumulation' },
  ];
}
export function mockGuichet(): Guichet {
  if (_guichet.length === 0 && !_guichetEntame) { _guichet = _guichetInitial(); _guichetEntame = true; }
  // `athletes` = les deux du mock, pas la longueur de la file.
  const comptes = { douleur: 0, seance: 0, semaine: 0, athletes: 2 };
  for (const d of _guichet) comptes[d.type]++;
  return { dossiers: [..._guichet], comptes };
}
let _guichetEntame = false;
export function mockGuichetRelire(sessionId: string): { ok: true } {
  _guichet = _guichet.filter(d => !(d.type === 'seance' && d.sessionId === sessionId));
  // ⚠️ RACCOURCI DU MOCK, ET IL EST DIT. Un dossier « semaine » n'a pas de coche :
  // il se ferme quand la semaine reçoit une séance — un FAIT qu'aucun writer du
  // mock ne sait produire. Sans ce raccourci, la file vide (B5) ne serait
  // atteignable par aucune spec. Quand la dernière séance est relue, la
  // semaine part avec : c'est faux au sens du produit, et c'est le seul chemin.
  if (!_guichet.some(d => d.type === 'seance')) _guichet = _guichet.filter(d => d.type !== 'semaine');
  return { ok: true };
}
export function mockGuichetVu(athleteId: string, date: string): { ok: true } {
  _guichet = _guichet.filter(d => !(d.type === 'douleur' && d.athlete.athleteId === athleteId && d.date === date));
  return { ok: true };
}
