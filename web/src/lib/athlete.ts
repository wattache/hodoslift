import type { Athlete, AthleteDirectoryEntry, Competition } from '@/api/types';
import { todayIso } from '@/lib/dates';

export function athleteInitials(a: Pick<Athlete, 'firstName' | 'lastName'>): string {
  return `${a.firstName[0] ?? ''}${a.lastName[0] ?? ''}`.toUpperCase() || '?';
}

export function athleteFullName(a: Pick<Athlete, 'firstName' | 'lastName'>): string {
  return `${a.firstName} ${a.lastName}`.trim();
}

/** La casse d'un nom TELLE QU'ON L'AFFICHE — « WILLI LAGACHETTE » → « Willi
 *  Lagachette ».
 *
 *  ⚠️ EN VUE SEULEMENT, JAMAIS EN BASE. `firstName`/`lastName` restent ce que la
 *  personne a saisi : la casse est une décision d'AFFICHAGE, et la réécrire en
 *  base perdrait une graphie qu'on ne sait pas reconstruire (« McDonald »,
 *  « van der Berg »). Une barre latérale où un nom sur trois crie n'est pas un
 *  problème de donnée.
 *
 *  ⚠️ TROIS SÉPARATEURS, PAS UN. Couper sur l'espace seul rendrait « Jean-pierre »
 *  et « O'brien » : le tiret et l'apostrophe ouvrent un segment exactement comme
 *  l'espace. Le reste de chaque segment tombe en bas-de-casse — c'est ce qui
 *  défait les capitales d'origine. */
export function nomAffiche(valeur: string): string {
  return valeur.toLocaleLowerCase().replace(
    /(^|[\s\-'’])(\p{L})/gu,
    (_, separateur: string, lettre: string) => separateur + lettre.toLocaleUpperCase(),
  );
}

/** Le pli de comparaison des noms : sans accent, sans casse.
 *  « ele » doit trouver « Éléonore », et « LAG » « Lagachette ». */
export function pliDeRecherche(valeur: string): string {
  return valeur.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase().trim();
}

/* ⚠️ `SEUIL_RECHERCHE_ATHLETES` ET `railBorne` ONT DISPARU (Passe 3, constat 07,
 * 14/09). Ils faisaient tenir 35 athlètes dans la barre latérale — borne à
 * 248 px, rail à six monogrammes, champ de recherche au-delà de huit, ligne
 * « n autres ». Le choix d'athlète est sorti de la colonne pour un sélecteur
 * dans l'en-tête, sans borne : les quatre réglages n'avaient plus rien à faire
 * tenir, ils se sont supprimés plutôt que conservés. */

/** Les morceaux d'un nom, avec ce que la frappe y retrouve — pour le surligner.
 *
 *  ⚠️ LA COMPARAISON SE FAIT SUR LE PLI (sans accent, sans casse), MAIS LE TEXTE
 *  RENDU EST L'ORIGINAL. « ele » doit surligner « Élé » dans « Éléonore » : on
 *  replie caractère par caractère en gardant, pour chacun, sa position d'origine.
 *  Replier la chaîne entière d'un coup décalerait les indices dès qu'un accent
 *  décomposé change la longueur. Seule la PREMIÈRE occurrence est marquée. */
export function segmentsDeRecherche(texte: string, recherche: string): { texte: string; trouve: boolean }[] {
  const q = pliDeRecherche(recherche);
  if (!q) return [{ texte, trouve: false }];
  const caracteres = Array.from(texte);
  let plie = '';
  const origine: number[] = [];
  caracteres.forEach((c, i) => {
    const pc = c.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();
    for (let k = 0; k < pc.length; k++) { plie += pc[k]; origine.push(i); }
  });
  const debut = plie.indexOf(q);
  if (debut < 0) return [{ texte, trouve: false }];
  const de = origine[debut];
  const fin = origine[debut + q.length - 1] + 1;
  return [
    { texte: caracteres.slice(0, de).join(''), trouve: false },
    { texte: caracteres.slice(de, fin).join(''), trouve: true },
    { texte: caracteres.slice(fin).join(''), trouve: false },
  ].filter(m => m.texte !== '');
}

/** Où aller quand on change d'athlète depuis l'en-tête (constat 07).
 *
 *  ⚠️ ON RESTE SUR LA VUE QUAND ELLE DÉCRIT UN ATHLÈTE. Passer de Willi à Kévin
 *  depuis son Programme doit montrer le Programme de Kévin — pas le renvoyer au
 *  tableau de bord, comme le faisait la liste latérale. Les PARAMÈTRES tombent
 *  (`?week=`, `?session=`) : ils désignent la semaine d'un autre.
 *
 *  Un bilan (`/kine/bilans/:id`) appartient à UN athlète : on revient au suivi
 *  kiné du nouveau. Tout le reste — guichet, bibliothèque, compétitions — ne
 *  décrit personne : on ouvre le tableau de bord de celui qu'on vient de choisir. */
export function routeApresChangementDAthlete(pathname: string): string {
  if (pathname.startsWith('/kine/bilans/')) return '/kine';
  return vueDeLEspaceAthlete(pathname) ?? '/dashboard';
}

/** La vue de l'espace athlète que décrit ce chemin, ou `null` hors de l'espace. */
export function vueDeLEspaceAthlete(pathname: string): string | null {
  return ['/dashboard', '/training', '/tracker', '/calendar', '/kine']
    .find(v => pathname === v || pathname.startsWith(`${v}/`)) ?? null;
}

/** Un athlète répond-il à une recherche ? Sur le prénom OU le nom — et sur les
 *  deux accolés, pour que « willi lag » marche comme on le tape. */
export function correspondALaRecherche(
  a: Pick<Athlete, 'firstName' | 'lastName'>,
  recherche: string,
): boolean {
  const q = pliDeRecherche(recherche);
  if (!q) return true;
  return pliDeRecherche(`${a.firstName} ${a.lastName}`).includes(q)
    || pliDeRecherche(a.lastName).includes(q);
}

function normalized(value: string | undefined | null): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/** Compétitions où figure cet athlète (par uid, sinon rapprochement par nom). */
export function athleteCompetitions(
  competitions: Competition[],
  athlete: Athlete | AthleteDirectoryEntry | null,
): Competition[] {
  if (!athlete) return [];
  const uid = 'linkedUserId' in athlete ? athlete.linkedUserId : null;
  const name = normalized(athleteFullName(athlete));
  return competitions.filter(c =>
    c.participants.some(p => (p.uid && p.uid === uid) || (!!name && normalized(p.name) === name)),
  );
}

/** Une compét reste « à venir » tant que son DERNIER jour n'est pas passé. */
export function isUpcoming(c: Competition, today = todayIso()): boolean {
  return (c.endDate || c.startDate) >= today;
}

/** Prochaine compétition de l'athlète (la plus proche à venir). */
export function nextCompetitionOf(
  competitions: Competition[],
  athlete: Athlete | AthleteDirectoryEntry | null,
): Competition | undefined {
  const today = todayIso();
  return athleteCompetitions(competitions, athlete)
    .filter(c => isUpcoming(c, today))
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
}

/** BlockKind UI — inféré du NOM du bloc (couleurs de périodisation). */
export type BlockKind = 'accumulation' | 'intensification' | 'realisation' | 'deload' | 'volume' | 'peaking';

export function inferBlockKind(name?: string): BlockKind {
  if (!name) return 'accumulation';
  const n = name.toLowerCase();
  if (n.includes('intens')) return 'intensification';
  if (n.includes('peak') || n.includes('realisa')) return 'realisation';
  if (n.includes('volume')) return 'volume';
  if (n.includes('deload') || n.includes('décharg')) return 'deload';
  return 'accumulation';
}
