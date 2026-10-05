import { rpeToNumber } from '@/lib/rpe';

/** LE BLOC EN TABLEAU : semaines en COLONNES, mouvements en LIGNES — FRE-114.
 *
 *  ⚠️ CE N'EST PAS UN HABILLAGE, C'EST UNE STRUCTURE QUE L'APP N'A NULLE PART.
 *  Tous les écrans montrent UNE semaine. La progression d'un bloc — la seule
 *  chose qu'un coach programme réellement — n'est visible sur aucun.
 *
 *  Ce que ça a coûté de ne pas l'avoir : FRE-150. Un incrément oublié dans la
 *  trame a mis TROIS SEMAINES à se voir — S1 @50, S2 @55 tapé à la main, S3 sans
 *  charge du tout. Mis en colonnes, le décrochage se voit à la deuxième.
 *
 *  Ce fichier ne contient QUE la dérivation. La vue le rend ; les specs
 *  l'éprouvent sans DOM. */

/** ⚠️ TYPÉ PAR CE QU'IL LIT, PAS PAR `Block`. L'arbre arrive ici sous la famille
 *  `…Editing` — celle du milieu, identique à la lecture sauf l'identité en
 *  attente — et exiger `Block` faisait échouer la compilation sur `base`, que ce
 *  fichier ne touche jamais. Déclarer la forme MINIMALE rend la dérivation
 *  indépendante des trois familles, et dit du même coup ce qu'elle consomme. */
export interface LigneLisible {
  id?: string;
  name?: string | null;
  variant?: string[] | null;
  sets?: string | null;
  reps?: string | null;
  repsUnit?: string | null;
  weight?: string | null;
  /** ⚠️ CE QUE L'ATHLÈTE A RÉELLEMENT SOULEVÉ. La courbe le suit — cf.
   *  `courbeDeRangee`. */
  weightDone?: string | null;
  aimedRPE?: string | null;
  /** Le RPE RESSENTI, par opposition au visé. Même raison. */
  feltRPE?: string | null;
  assistance?: string | null;
}
export interface SeanceLisible { name?: string | null; exercises?: LigneLisible[] | null }
export interface SemaineLisible {
  /** ⚠️ OPTIONNEL : la famille `…Editing` porte une identité EN ATTENTE. */
  id?: string;
  weekNumber?: number;
  startDate?: string | null;
  endDate?: string | null;
  sessions?: SeanceLisible[] | null;
}
export interface BlocLisible { name?: string | null; weeks?: SemaineLisible[] | null }

/** Une cellule : ce qu'une semaine prescrit pour ce mouvement, ce jour-là. */
export interface CelluleDuTableau {
  /** `null` quand la ligne n'existe pas cette semaine-là — un TROU, et il se
   *  voit. C'est l'information la plus utile du tableau : un mouvement qui
   *  disparaît en S4 sans que personne ne l'ait décidé. */
  ligne: LigneLisible | null;
}

export interface RangeeDuTableau {
  /** Ce qui identifie le mouvement d'une semaine à l'autre. */
  cle: string;
  nom: string;
  /** Les variantes, telles que la ligne les porte — « pendlay », « large ». */
  variantes: string[];
  cellules: CelluleDuTableau[];
}

export interface ColonneDuTableau {
  semaine: SemaineLisible;
  /** La séance de CETTE semaine qui porte le jour demandé, ou rien. */
  seance: SeanceLisible | null;
  /** Tonnage prescrit, et ce qu'il ne compte pas — cf. `tonnage`. */
  tonnage: Tonnage;
}

export interface TableauDuBloc {
  jours: string[];
  colonnes: ColonneDuTableau[];
  rangees: RangeeDuTableau[];
}

/** ⚠️ UN TONNAGE QUI IGNORE LA MOITIÉ DES LIGNES EST UN CHIFFRE FAUX, et il ne
 *  se présente pas comme tel. `sets` et `reps` sont des CHAÎNES : « 5 » se
 *  multiplie, « 5/6 », « AMRAP » et « 10-12 » non. Une somme qui les saute en
 *  silence affiche 7,4 t là où il y a 11 t, et personne ne peut le savoir.
 *
 *  On rend donc les deux : ce qui est compté, et combien de lignes ne l'ont pas
 *  été. La vue le dit à l'écran quand ce n'est pas zéro. */
export interface Tonnage {
  kg: number;
  lignesComptees: number;
  lignesIgnorees: number;
}

/** Un nombre, ou rien. `''` n'est pas 0 — le défaut le plus récurrent du dépôt.
 *
 *  ⚠️ EXPOSÉE SOUS `valeurChiffree` PARCE QUE LA PROJECTION EN A BESOIN AUSSI, et
 *  qu'en écrire une seconde aurait été une règle dupliquée. `parseWeight` ne
 *  peut PAS servir ici : elle replie `''` et `'0'` sur le même 0, alors que 461
 *  lignes de production portent une charge à zéro — une valeur, pas une absence
 *  (cf. la spec du tonnage). */
function nombre(valeur: string | null | undefined): number | null {
  const brut = (valeur ?? '').trim().replace(',', '.');
  if (brut === '') return null;
  const n = Number(brut);
  return Number.isFinite(n) ? n : null;
}

export const valeurChiffree = nombre;

/** ⚠️ LE JOUR EST LE NOM DE LA SÉANCE, ET C'EST MESURÉ. Sur les 2 697 séances de
 *  production, 2 486 — 92 % — s'appellent d'un jour de la semaine. Le reste
 *  porte un nom de coach (« 3LIFT », « Jambes », « Squat 1 »), et ces séances-là
 *  méritent autant leur colonne.
 *
 *  ⚠️ ET SÛREMENT PAS `sessionDate` : elle n'est renseignée que sur 746 séances
 *  sur 2 697. Trier par date écarterait les trois quarts du produit.
 *
 *  ⚠️ NI L'INDEX DANS LA SEMAINE : une semaine à quatre séances suivie d'une à
 *  cinq décalerait toutes les colonnes d'un cran, et le tableau raconterait une
 *  progression qui n'existe pas. */
export function joursDuBloc(bloc: BlocLisible): string[] {
  const vus: string[] = [];
  for (const semaine of bloc.weeks ?? []) {
    for (const seance of semaine.sessions ?? []) {
      const jour = (seance.name ?? '').trim();
      if (jour && !vus.includes(jour)) vus.push(jour);
    }
  }
  return vus;
}

/** Combien de semaines portent chaque jour, sur le total du bloc.
 *
 *  ⚠️ UN JOUR N'EST PAS FORCÉMENT DANS TOUTES LES SEMAINES, et c'est mesuré :
 *  346 semaines de production portent 5 séances, mais 161 en portent 4 et 76 en
 *  portent 3. Un « Jeudi » présent quatre semaines sur six produit donc un
 *  tableau à deux colonnes vides — et rien ne dit si c'est une décharge voulue
 *  ou une saisie oubliée.
 *
 *  C'est le même angle mort que FRE-150 : une absence qui ne se distingue pas
 *  d'un choix. Le compte rend la question posable. */
export function presenceDesJours(bloc: BlocLisible): Map<string, number> {
  const compte = new Map<string, number>();
  for (const semaine of bloc.weeks ?? []) {
    // ⚠️ UN JOUR NE COMPTE QU'UNE FOIS PAR SEMAINE. Neuf semaines de production
    // portent six séances, et rien n'interdit deux « Lundi » : les compter deux
    // fois rendrait « Lundi 7/6 », ce qui ne veut rien dire.
    const vusIci = new Set<string>();
    for (const seance of semaine.sessions ?? []) {
      const jour = (seance.name ?? '').trim();
      if (jour) vusIci.add(jour);
    }
    for (const jour of vusIci) compte.set(jour, (compte.get(jour) ?? 0) + 1);
  }
  return compte;
}

/** L'AXE DU COULOIR RPE — commun à toutes les rangées, resserré sur le bloc.
 *
 *  Les trois propriétés comptent, et chacune répare une lecture fausse :
 *
 *  ⚠️ **SÉPARÉ DES KILOS.** 100 kg et RPE 7 sur un axe commun dessinent un
 *  effondrement là où il n'y a qu'un changement d'unité. C'est déjà pourquoi
 *  `courbeDeRangee` ne trace qu'une grandeur.
 *
 *  ⚠️ **PARTAGÉ PAR LES RANGÉES.** Un 9 doit être à la même hauteur d'un
 *  mouvement à l'autre : avec un axe local, deux rangées aux ressentis opposés
 *  se dessineraient pareil, et la comparaison entre mouvements mentirait.
 *
 *  ⚠️ **RESSERRÉ SUR LA PLAGE RÉELLEMENT UTILISÉE**, et ce n'est pas cosmétique.
 *  Un écart visé/ressenti vaut normalement un demi-point à un point. Étalé sur le
 *  5 → 10 de l'échelle, il mesure 2 à 7 px dans un couloir de 74 px : aucun
 *  remplissage ne le rattrape. Resserré sur la plage du bloc, il en fait 7 à 20.
 *
 *  L'amplitude minimale de 2 points évite l'inverse : un bloc entièrement à 8
 *  donnerait un axe de largeur nulle, où le moindre demi-point sortirait du
 *  couloir. Et la vue ÉCRIT les bornes — un axe resserré qui tairait les siennes
 *  laisserait croire à l'échelle pleine. */
export function axeRpeDuBloc(bloc: BlocLisible): { lo: number; hi: number } {
  const tout: number[] = [];
  for (const semaine of bloc.weeks ?? []) {
    for (const seance of semaine.sessions ?? []) {
      for (const ligne of seance.exercises ?? []) {
        // Le visé comme le ressenti : l'axe doit contenir les deux tracés, et
        // une cible hors champ couperait le pointillé au bord du couloir.
        const vise = nombre(ligne.aimedRPE);
        const ressenti = rpeToNumber(ligne.feltRPE ?? '');
        if (vise !== null) tout.push(vise);
        if (ressenti !== null) tout.push(ressenti);
      }
    }
  }
  // Sans aucun RPE, l'axe ne sert à rien — mais il doit rester bien formé.
  if (tout.length === 0) return { lo: 5, hi: 10 };
  // Arrondi au demi-point : l'échelle RPE n'a pas de graduation plus fine.
  const lo0 = Math.floor((Math.min(...tout) - 0.5) * 2) / 2;
  let hi = Math.max(Math.ceil((Math.max(...tout) + 0.5) * 2) / 2, lo0 + 2);
  // ⚠️ ON ÉLARGIT VERS LE BAS QUAND LE HAUT EST BUTÉ, et c'est le cas qui a
  // failli passer : un bloc entièrement à 10 donne lo 9,5 / hi 11, que le clamp
  // ramène à 10 — soit une amplitude de 0,5, où un demi-point d'écart sort du
  // couloir. Rogner le haut OBLIGE donc à descendre le bas d'autant.
  hi = Math.min(10, hi);
  const lo = Math.max(0, Math.min(lo0, hi - 2));
  return { lo, hi };
}

/** ⚠️ LA CLÉ D'UNE RANGÉE N'INCLUT NI `sets` NI `reps`, et c'est tout le sujet.
 *  `_meme_ligne` côté serveur les compare — pour apparier un incrément, où deux
 *  lignes de volumes différents ne sont pas la même prescription. Ici c'est
 *  l'inverse : ce qui CHANGE d'une semaine à l'autre est précisément ce qu'on
 *  affiche. Les inclure ferait une rangée neuve à chaque progression, et le
 *  tableau deviendrait une liste. */
function cleDeRangee(ligne: LigneLisible): string {
  return [ligne.name ?? '', ...(ligne.variant ?? [])].join(' ');
}

/** La séance d'une semaine portant ce jour. La PREMIÈRE : neuf semaines de
 *  production sur 613 portent six séances, et rien n'interdit deux « Lundi ». */
function seanceDuJour(semaine: SemaineLisible, jour: string): SeanceLisible | null {
  return (semaine.sessions ?? []).find(s => (s.name ?? '').trim() === jour) ?? null;
}

export function tonnageDeLaSeance(seance: SeanceLisible | null): Tonnage {
  let kg = 0;
  let comptees = 0;
  let ignorees = 0;
  for (const ligne of seance?.exercises ?? []) {
    // ⚠️ LES SECONDES NE SONT PAS DES RÉPÉTITIONS. Un gainage de 3 × 30 s avec
    // 20 kg pèserait 1 800 kg dans la somme — un tonnage inventé, et le plus
    // gros de la colonne. 490 lignes de production sont dans ce cas.
    if (ligne.repsUnit === 'sec') { ignorees++; continue; }
    const sets = nombre(ligne.sets);
    const reps = nombre(ligne.reps);
    const charge = nombre(ligne.weight);
    if (sets === null || reps === null || charge === null) { ignorees++; continue; }
    kg += sets * reps * charge;
    comptees++;
  }
  return { kg, lignesComptees: comptees, lignesIgnorees: ignorees };
}

/** Le tableau d'un bloc pour UN jour — le filtre du canevas.
 *
 *  ⚠️ UN JOUR À LA FOIS, ET CE N'EST PAS UNE ÉCONOMIE D'ÉCRAN. Cinq séances par
 *  semaine (346 semaines de production sur 613) sur six colonnes font trente
 *  cases par mouvement : la comparaison qu'on vient chercher — cette ligne-ci,
 *  de semaine en semaine — disparaît dans le nombre. */
export function tableauDuBloc(bloc: BlocLisible, jour: string | null): TableauDuBloc {
  const jours = joursDuBloc(bloc);
  const choisi = jour && jours.includes(jour) ? jour : (jours[0] ?? null);
  const semaines = bloc.weeks ?? [];

  const colonnes: ColonneDuTableau[] = semaines.map(semaine => {
    const seance = choisi ? seanceDuJour(semaine, choisi) : null;
    return { semaine, seance, tonnage: tonnageDeLaSeance(seance) };
  });

  // ⚠️ L'ORDRE DES RANGÉES SUIT LA PREMIÈRE SEMAINE QUI LES PORTE, pas un tri
  // alphabétique : un coach lit sa séance dans l'ordre où il l'a écrite. Un
  // mouvement ajouté en S3 se range donc APRÈS ceux de S1, ce qui se voit — et
  // c'est une information, pas un défaut d'affichage.
  const ordre: string[] = [];
  const parCle = new Map<string, RangeeDuTableau>();
  colonnes.forEach((colonne, index) => {
    for (const ligne of colonne.seance?.exercises ?? []) {
      const cle = cleDeRangee(ligne);
      let rangee = parCle.get(cle);
      if (!rangee) {
        rangee = {
          cle,
          nom: ligne.name ?? '',
          variantes: ligne.variant ?? [],
          cellules: colonnes.map(() => ({ ligne: null })),
        };
        parCle.set(cle, rangee);
        ordre.push(cle);
      }
      // La première ligne gagne : un mouvement répété dans la même séance
      // (deux entrées « SQUAT ») n'ouvre pas deux rangées, il occupe la sienne.
      if (rangee.cellules[index].ligne === null) rangee.cellules[index] = { ligne };
    }
  });

  return { jours, colonnes, rangees: ordre.map(cle => parCle.get(cle)!) };
}

/** La seconde ligne d'une cellule : la CHARGE, ou à défaut le RPE visé.
 *
 *  ⚠️ MESURÉ AVANT DE CHOISIR L'ORDRE. Sur 15 425 lignes de production, 10 039
 *  portent une charge, 4 734 n'ont qu'un RPE visé, et 652 n'ont ni l'un ni
 *  l'autre. Rendre `''` pour ces 652 est la seule réponse juste : inventer un
 *  « PDC » supposerait que l'absence de charge veut dire poids de corps, ce que
 *  la donnée ne dit nulle part. */
export function chargeAffichee(ligne: LigneLisible): { texte: string; estRPE: boolean } {
  const charge = (ligne.weight ?? '').trim();
  const fait = (ligne.weightDone ?? '').trim();
  if (charge !== '' || fait !== '') {
    // ⚠️ « PRESCRIT → RÉEL » DÈS QUE LES DEUX DIFFÈRENT, comme la carte de
    // progression le fait déjà pour les reps et la charge. Afficher le seul
    // prescrit cacherait précisément ce que la courbe, elle, montre.
    const base = charge !== '' ? charge : fait;
    const ecart = fait !== '' && charge !== '' && nombre(fait) !== nombre(charge);
    const suffixe = (ligne.assistance ?? '').trim();
    const valeur = ecart ? `${charge} → ${fait}` : base;
    return { texte: suffixe ? `${valeur} kg · ${suffixe}` : `${valeur} kg`, estRPE: false };
  }
  const vise = (ligne.aimedRPE ?? '').trim();
  const ressenti = (ligne.feltRPE ?? '').trim();
  if (vise === '' && ressenti === '') return { texte: '', estRPE: false };
  const ecartRPE = vise !== '' && ressenti !== '' && vise !== ressenti;
  return {
    texte: `RPE ${ecartRPE ? `${vise} → ${ressenti}` : (vise || ressenti)}`,
    estRPE: true,
  };
}

/** La première ligne d'une cellule : le volume, tel qu'il est écrit.
 *
 *  ⚠️ ON NE NORMALISE PAS. « 5/6 », « 10-12 », « AMRAP » sont ce que le coach a
 *  tapé ; les réécrire ferait dire au tableau autre chose que la séance. */
export function volumeAffiche(ligne: LigneLisible): string {
  const sets = (ligne.sets ?? '').trim();
  const reps = (ligne.reps ?? '').trim();
  const unite = ligne.repsUnit === 'sec' ? ' s' : '';
  if (sets === '' && reps === '') return '';
  if (reps === '') return sets;
  if (sets === '') return `${reps}${unite}`;
  return `${sets} × ${reps}${unite}`;
}

/** LA COURBE D'UNE RANGÉE — ce que la ligne raconte, sans lire les chiffres.
 *
 *  ⚠️ UNE SEULE GRANDEUR PAR RANGÉE, JAMAIS UN MÉLANGE. Une charge en kilos et
 *  un RPE sur dix ne se tracent pas sur la même échelle : la courbe passerait de
 *  100 à 7 entre deux semaines et dessinerait un effondrement là où il n'y a
 *  qu'un changement d'unité. On prend donc la grandeur MAJORITAIRE de la rangée,
 *  et on ignore les points de l'autre.
 *
 *  ⚠️ ET UN POINT MANQUANT N'EST PAS UN ZÉRO. Une semaine où le mouvement n'est
 *  pas prescrit laisse un TROU dans la courbe — c'est précisément le décrochage
 *  de FRE-150. Le tracer à zéro le ferait passer pour une charge allégée.
 *
 *  ⚠️ ET UNE COURBE À MOINS DE DEUX POINTS N'EST PAS UNE COURBE. Rendre `null`
 *  plutôt qu'un trait plat : un segment horizontal se lit comme « stable », ce
 *  qui est une affirmation que la donnée ne porte pas. */
export interface CourbeDeRangee {
  grandeur: 'kg' | 'rpe';
  /** Un par colonne, dans l'ordre ; `null` là où il n'y a rien à tracer. */
  points: (number | null)[];
  min: number;
  max: number;
}

export function courbeDeRangee(rangee: RangeeDuTableau): CourbeDeRangee | null {
  const charges: (number | null)[] = [];
  const rpes: (number | null)[] = [];
  for (const { ligne } of rangee.cellules) {
    // ⚠️ LA COURBE SUIT LE RÉALISÉ, PAS LE PRESCRIT — et c'est la règle que le
    // dépôt applique déjà partout ailleurs : « réel sinon prescrit, ce que
    // suivent la courbe et le delta du bloc ; ils décrivent ce qui a été FAIT,
    // pas ce qui était prévu » (`ProgressionPoint.kgEffective`). Ma première
    // version traçait la consigne : un athlète qui a tenu 12,5 sur 13,75
    // prescrits voyait une progression qu'il n'avait pas faite.
    charges.push(ligne ? (nombre(ligne.weightDone) ?? nombre(ligne.weight)) : null);
    rpes.push(ligne ? (rpeToNumber(ligne.feltRPE ?? '') ?? nombre(ligne.aimedRPE)) : null);
  }
  // ⚠️ LA GRANDEUR SE DÉCIDE SUR LE PRESCRIT, pas sur ce qui est tracé. C'est le
  // coach qui dit en quoi une ligne se programme ; un athlète qui note un
  // ressenti sur une ligne chargée ne la transforme pas en ligne de RPE.
  const compte = (lire: (l: LigneLisible) => unknown) =>
    rangee.cellules.filter(c => c.ligne && (lire(c.ligne) ?? '') !== '').length;
  const grandeur: 'kg' | 'rpe' =
    compte(l => (l.weight ?? '').trim() || null) >= compte(l => (l.aimedRPE ?? '').trim() || null)
      ? 'kg' : 'rpe';
  const points = grandeur === 'kg' ? charges : rpes;
  const valeurs = points.filter((x): x is number => x !== null);
  if (valeurs.length < 2) return null;
  return { grandeur, points, min: Math.min(...valeurs), max: Math.max(...valeurs) };
}
