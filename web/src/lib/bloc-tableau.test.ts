import { describe, expect, it } from 'vitest';

import {
  chargeAffichee, courbeDeRangee, joursDuBloc, presenceDesJours, tableauDuBloc, tonnageDeLaSeance, volumeAffiche,
} from '@/lib/bloc-tableau';
import type { BlocLisible, LigneLisible, SeanceLisible, SemaineLisible } from '@/lib/bloc-tableau';

/** CE QUE LE TABLEAU DOIT DIRE, ET CE QU'IL NE DOIT PAS INVENTER — FRE-114. */

/** ⚠️ DES FIXTURES MINIMALES, ET C'EST LE BÉNÉFICE DES TYPES ÉTROITS. Elles
 *  recopiaient les trente champs de `LigneDeSeance` — dont vingt-cinq que la
 *  dérivation ne lit pas. Chaque champ ajouté au contrat aurait fait rougir ce
 *  fichier sans qu'aucun comportement ne change. */
const ligne = (p: Partial<LigneLisible> = {}): LigneLisible =>
  ({ name: 'SQUAT', variant: [], sets: '', reps: '', weight: '', aimedRPE: '', ...p });

const seance = (nom: string, lignes: LigneLisible[]): SeanceLisible =>
  ({ name: nom, exercises: lignes });

const semaine = (n: number, seances: SeanceLisible[]): SemaineLisible =>
  ({ id: `w${n}`, weekNumber: n, sessions: seances });

const bloc = (semaines: SemaineLisible[]): BlocLisible => ({ weeks: semaines });

describe('les jours du bloc', () => {
  it('⚠️ VIENNENT DU NOM DE LA SÉANCE, pas d’un calendrier codé en dur', () => {
    // 92 % des séances de production portent un jour de semaine — mais 8 %
    // portent un nom de coach, et elles méritent autant leur colonne. Une liste
    // figée Lundi→Dimanche les ferait disparaître de l'écran.
    const b = bloc([
      semaine(1, [seance('Lundi', []), seance('3LIFT', [])]),
      semaine(2, [seance('Lundi', []), seance('Jambes', [])]),
    ]);
    expect(joursDuBloc(b)).toEqual(['Lundi', '3LIFT', 'Jambes']);
  });

  it('les rend dans l’ordre de première apparition, sans doublon', () => {
    const b = bloc([semaine(1, [seance('Mardi', []), seance('Lundi', [])]),
                    semaine(2, [seance('Lundi', [])])]);
    expect(joursDuBloc(b)).toEqual(['Mardi', 'Lundi']);
  });
});

describe('le tableau', () => {
  it('⚠️ APPARIE LES MOUVEMENTS MÊME QUAND LE VOLUME CHANGE', () => {
    // C'est la raison d'être de l'écran : voir une charge PROGRESSER. Si la clé
    // de rangée incluait sets/reps — comme le fait `_meme_ligne` côté serveur,
    // pour un autre usage — chaque semaine ouvrirait sa propre rangée et le
    // tableau redeviendrait une liste.
    const b = bloc([
      semaine(1, [seance('Lundi', [ligne({ id: 'a', sets: '5', reps: '3', weight: '100' })])]),
      semaine(2, [seance('Lundi', [ligne({ id: 'b', sets: '6', reps: '2', weight: '105' })])]),
    ]);
    const t = tableauDuBloc(b, 'Lundi');
    expect(t.rangees).toHaveLength(1);
    expect(t.rangees[0].cellules.map(c => c.ligne?.weight)).toEqual(['100', '105']);
  });

  it('⚠️ LAISSE UN TROU QUAND LE MOUVEMENT DISPARAÎT, et c’est l’information', () => {
    // Le cas de FRE-150 : S1 @50, S2 @55, S3 plus rien. Trois semaines pour le
    // voir sur l'écran d'aujourd'hui ; ici la case vide saute aux yeux.
    const b = bloc([
      semaine(1, [seance('Lundi', [ligne({ name: 'DIPS', weight: '50' })])]),
      semaine(2, [seance('Lundi', [ligne({ name: 'DIPS', weight: '55' })])]),
      semaine(3, [seance('Lundi', [])]),
    ]);
    const t = tableauDuBloc(b, 'Lundi');
    expect(t.rangees[0].cellules.map(c => c.ligne === null)).toEqual([false, false, true]);
  });

  it('sépare deux mouvements de même nom par leurs variantes', () => {
    const b = bloc([semaine(1, [seance('Lundi', [
      ligne({ id: 'a', name: 'ROWING', variant: ['PENDLAY'] }),
      ligne({ id: 'b', name: 'ROWING', variant: ['HALTERE'] }),
    ])])]);
    expect(tableauDuBloc(b, 'Lundi').rangees).toHaveLength(2);
  });

  it('⚠️ NE DÉCALE PAS LES COLONNES quand une semaine a moins de séances', () => {
    // Apparier par INDEX de séance ferait glisser « Mardi » sous « Lundi » dès
    // qu'une semaine en saute une — et le tableau raconterait une progression
    // qui n'a pas eu lieu.
    const b = bloc([
      semaine(1, [seance('Lundi', [ligne({ weight: '100' })]), seance('Mardi', [ligne({ weight: '60' })])]),
      semaine(2, [seance('Mardi', [ligne({ weight: '65' })])]),
    ]);
    const t = tableauDuBloc(b, 'Mardi');
    expect(t.rangees[0].cellules.map(c => c.ligne?.weight)).toEqual(['60', '65']);
  });

  it('retombe sur le premier jour quand celui demandé n’existe pas', () => {
    const b = bloc([semaine(1, [seance('Lundi', [ligne({})])])]);
    expect(tableauDuBloc(b, 'Vendredi').colonnes[0].seance?.name).toBe('Lundi');
  });
});

describe('le tonnage', () => {
  it('multiplie séries × répétitions × charge', () => {
    const t = tonnageDeLaSeance(seance('Lundi', [
      ligne({ sets: '5', reps: '3', weight: '100' }),   // 1500
      ligne({ sets: '3', reps: '10', weight: '20' }),   // 600
    ]));
    expect(t).toEqual({ kg: 2100, lignesComptees: 2, lignesIgnorees: 0 });
  });

  it('⚠️ COMPTE CE QU’IL IGNORE, au lieu de rendre un total qui ment', () => {
    // `sets` et `reps` sont des CHAÎNES : « 5/6 » et « AMRAP » ne se multiplient
    // pas. Les sauter en silence afficherait 1,5 t là où il y en a davantage, et
    // rien à l'écran ne permettrait de s'en douter.
    const t = tonnageDeLaSeance(seance('Lundi', [
      ligne({ sets: '5', reps: '3', weight: '100' }),
      ligne({ sets: '3', reps: '10/12', weight: '20' }),
      ligne({ sets: '4', reps: 'AMRAP', weight: '15' }),
    ]));
    expect(t.kg).toBe(1500);
    expect(t.lignesIgnorees).toBe(2);
  });

  it('⚠️ NE COMPTE PAS LES SECONDES COMME DES RÉPÉTITIONS', () => {
    // Un gainage 3 × 30 s lesté de 20 kg vaudrait 1 800 kg — le plus gros poste
    // de la colonne, entièrement inventé. 490 lignes de production sont en `sec`.
    const t = tonnageDeLaSeance(seance('Lundi', [
      ligne({ sets: '3', reps: '30', repsUnit: 'sec', weight: '20' }),
    ]));
    expect(t).toEqual({ kg: 0, lignesComptees: 0, lignesIgnorees: 1 });
  });

  it('une charge à zéro est une VALEUR, pas une absence', () => {
    // 461 lignes de production portent `weight = '0'`. `''` et `0` ne se
    // confondent pas : le premier n'est pas comptable, le second vaut zéro.
    const zero = tonnageDeLaSeance(seance('Lundi', [ligne({ sets: '3', reps: '10', weight: '0' })]));
    expect(zero).toEqual({ kg: 0, lignesComptees: 1, lignesIgnorees: 0 });
    const vide = tonnageDeLaSeance(seance('Lundi', [ligne({ sets: '3', reps: '10', weight: '' })]));
    expect(vide.lignesIgnorees).toBe(1);
  });
});

describe('ce qu’une cellule affiche', () => {
  it('la charge quand il y en a une, le RPE visé sinon', () => {
    expect(chargeAffichee(ligne({ weight: '100', aimedRPE: '8' }))).toEqual({ texte: '100 kg', estRPE: false });
    expect(chargeAffichee(ligne({ weight: '', aimedRPE: '6.5' }))).toEqual({ texte: 'RPE 6.5', estRPE: true });
  });

  it('⚠️ ET RIEN QUAND IL N’Y A NI L’UN NI L’AUTRE', () => {
    // 652 lignes de production. Écrire « PDC » supposerait que l'absence de
    // charge veut dire poids de corps — la donnée ne le dit nulle part.
    expect(chargeAffichee(ligne({}))).toEqual({ texte: '', estRPE: false });
  });

  it('le volume est rendu TEL QU’IL EST ÉCRIT', () => {
    expect(volumeAffiche(ligne({ sets: '5', reps: '3' }))).toBe('5 × 3');
    expect(volumeAffiche(ligne({ sets: '3', reps: '10/12' }))).toBe('3 × 10/12');
    expect(volumeAffiche(ligne({ sets: '3', reps: '30', repsUnit: 'sec' }))).toBe('3 × 30 s');
    expect(volumeAffiche(ligne({}))).toBe('');
  });
});

describe('la courbe d’une rangée', () => {
  const rangeeDe = (lignes: (LigneLisible | null)[]) => ({
    cle: 'k', nom: 'SQUAT', variantes: [],
    cellules: lignes.map(l => ({ ligne: l })),
  });

  it('⚠️ NE MÉLANGE PAS LES KILOS ET LE RPE sur la même échelle', () => {
    // Une charge à 100 et un RPE à 7 tracés ensemble dessineraient un
    // effondrement entre deux semaines — là où il n'y a qu'un changement
    // d'unité. La grandeur majoritaire gagne, l'autre est ignorée.
    const c = courbeDeRangee(rangeeDe([
      ligne({ weight: '100' }), ligne({ weight: '105' }), ligne({ aimedRPE: '7' }),
    ]))!;
    expect(c.grandeur).toBe('kg');
    expect(c.points).toEqual([100, 105, null]);
    expect([c.min, c.max]).toEqual([100, 105]);
  });

  it('bascule sur le RPE quand c’est lui qui porte la rangée', () => {
    const c = courbeDeRangee(rangeeDe([
      ligne({ aimedRPE: '6' }), ligne({ aimedRPE: '7' }), ligne({ aimedRPE: '8' }),
    ]))!;
    expect(c.grandeur).toBe('rpe');
    expect(c.points).toEqual([6, 7, 8]);
  });

  it('⚠️ LAISSE UN TROU là où le mouvement n’est pas prescrit', () => {
    // Le tracer à zéro ferait passer une semaine SANS ce mouvement pour une
    // semaine allégée — exactement le contresens que l'écran doit éviter.
    const c = courbeDeRangee(rangeeDe([ligne({ weight: '50' }), null, ligne({ weight: '60' })]))!;
    expect(c.points).toEqual([50, null, 60]);
  });

  it('⚠️ REND `null` À MOINS DE DEUX POINTS : un trait plat AFFIRME une stabilité', () => {
    expect(courbeDeRangee(rangeeDe([ligne({ weight: '50' }), null, null]))).toBeNull();
    expect(courbeDeRangee(rangeeDe([ligne({}), ligne({})]))).toBeNull();
  });
});

describe('la présence des jours', () => {
  it('⚠️ COMPTE LES SEMAINES QUI PORTENT CHAQUE JOUR, pas les séances', () => {
    // Un « Jeudi » présent 2 semaines sur 3 laisse une colonne vide : sans ce
    // compte, rien ne dit si c'est une décharge voulue ou un oubli de saisie.
    const b = bloc([
      semaine(1, [seance('Lundi', []), seance('Jeudi', [])]),
      semaine(2, [seance('Lundi', [])]),
      semaine(3, [seance('Lundi', []), seance('Jeudi', [])]),
    ]);
    expect(Object.fromEntries(presenceDesJours(b))).toEqual({ Lundi: 3, Jeudi: 2 });
  });

  it('⚠️ NE COMPTE UN JOUR QU’UNE FOIS PAR SEMAINE', () => {
    // Neuf semaines de production portent six séances, et rien n'interdit deux
    // « Lundi » : les compter deux fois rendrait « Lundi 2/1 ».
    const b = bloc([semaine(1, [seance('Lundi', []), seance('Lundi', [])])]);
    expect(presenceDesJours(b).get('Lundi')).toBe(1);
  });

  it('ignore les séances sans nom', () => {
    const b = bloc([semaine(1, [seance('', []), seance('Lundi', [])])]);
    expect(Object.fromEntries(presenceDesJours(b))).toEqual({ Lundi: 1 });
  });
});

describe('le réalisé, pas le prescrit', () => {
  const rangeeDe2 = (lignes: (LigneLisible | null)[]) => ({
    cle: 'k', nom: 'SQUAT', variantes: [], cellules: lignes.map(l => ({ ligne: l })),
  });

  it('⚠️ LA COURBE SUIT LA CHARGE RÉELLEMENT SOULEVÉE', () => {
    // Signalé par William le 11/09 : « les graphes prennent le prescrit et pas
    // le réalisé ». Un athlète qui a tenu 12,5 sur 13,75 prescrits voyait une
    // progression qu'il n'avait pas faite. C'est la règle que le dépôt applique
    // déjà partout — `ProgressionPoint.kgEffective`.
    const c = courbeDeRangee(rangeeDe2([
      ligne({ weight: '100' }),
      ligne({ weight: '110', weightDone: '105' }),
    ]))!;
    expect(c.points).toEqual([100, 105]);
    expect(c.max).toBe(105);
  });

  it('retombe sur le prescrit quand rien n’a été saisi', () => {
    const c = courbeDeRangee(rangeeDe2([ligne({ weight: '100' }), ligne({ weight: '110' })]))!;
    expect(c.points).toEqual([100, 110]);
  });

  it('⚠️ ET LE RPE TRACÉ EST LE RESSENTI, pas le visé', () => {
    // Même règle, même raison : la courbe décrit ce qui a eu lieu. `Sub5` et
    // `FAIL` se lisent en nombres par `rpeToNumber` — la courbe ne les perd pas.
    const c = courbeDeRangee(rangeeDe2([
      ligne({ aimedRPE: '8', feltRPE: '8.5' }),
      ligne({ aimedRPE: '8', feltRPE: 'FAIL' }),
    ]))!;
    expect(c.grandeur).toBe('rpe');
    expect(c.points).toEqual([8.5, 10]);
  });

  it('⚠️ MAIS LA GRANDEUR SE DÉCIDE SUR LE PRESCRIT', () => {
    // C'est le coach qui dit en quoi une ligne se programme. Un athlète qui note
    // un ressenti sur une ligne chargée ne la transforme pas en ligne de RPE —
    // et la courbe basculerait d'une échelle à l'autre sans le dire.
    const c = courbeDeRangee(rangeeDe2([
      ligne({ weight: '100', feltRPE: '8' }),
      ligne({ weight: '105', feltRPE: '9' }),
    ]))!;
    expect(c.grandeur).toBe('kg');
    expect(c.points).toEqual([100, 105]);
  });

  it('la case affiche « prescrit → réel » dès que les deux diffèrent', () => {
    expect(chargeAffichee(ligne({ weight: '13.75', weightDone: '12.5' })).texte).toBe('13.75 → 12.5 kg');
    expect(chargeAffichee(ligne({ weight: '100', weightDone: '100' })).texte).toBe('100 kg');
    expect(chargeAffichee(ligne({ weight: '100' })).texte).toBe('100 kg');
    expect(chargeAffichee(ligne({ aimedRPE: '8', feltRPE: '9.5' })).texte).toBe('RPE 8 → 9.5');
  });

  it('une charge saisie SANS prescription reste un historique utile', () => {
    // Sinon la ligne disparaîtrait de la courbe alors que l'athlète a bien
    // soulevé quelque chose — c'est le cas que `hasUsefulHistory` protège déjà
    // dans l'historique de la BASE.
    expect(chargeAffichee(ligne({ weightDone: '80' })).texte).toBe('80 kg');
    const c = courbeDeRangee(rangeeDe2([ligne({ weightDone: '80' }), ligne({ weightDone: '85' })]))!;
    expect(c.points).toEqual([80, 85]);
  });
});
