import { beforeAll, describe, expect, it } from 'vitest';

import i18n from '@/i18n';
import {
  formatBadgeSuffix, formatReps, formatRest, formatRestActual,
  formatRestWithActual, formatSeries, formatTimeValue,
} from './format';

/** ⚠️ LA LANGUE EST FIXÉE, PARCE QUE CES SPECS PARLENT DU FORMAT, PAS DES MOTS.
 *  « Libre », « réel » et « séries » sortaient de littéraux ; ils sortent
 *  maintenant des locales, et la langue détectée en test n'est pas celle du
 *  navigateur de qui les lit. Sans ce point fixe, un changement de détection
 *  ferait rougir des specs qui n'ont rien à voir avec la langue. Ce que les mots
 *  suivent bien la langue est épinglé à part, plus bas. */
beforeAll(async () => { await i18n.changeLanguage('fr'); });

/** LE FORMATAGE D'UNE LIGNE D'EXERCICE — FRE-91.
 *
 *  ⚠️ CES SPECS ONT ÉTÉ ÉCRITES POUR RENDRE UNE FUSION SÛRE, pas après coup.
 *  Ces fonctions vivaient en double — table du coach et aperçu de l'athlète — et
 *  les fusionner touche l'écran le plus utilisé du produit. Elles épinglent donc
 *  ce que chaque cas DOIT rendre, y compris le seul endroit où l'affichage
 *  change délibérément.
 */

describe('les répétitions', () => {
  it('rien à afficher se dit avec un tiret, pas avec du vide', () => {
    expect(formatReps('', 'count')).toBe('—');
  });

  it('des secondes se lisent en minutes quand il y en a assez', () => {
    expect(formatReps('300', 'sec')).toBe("5'");
    expect(formatReps('90', 'sec')).toBe("1'30\"");
    expect(formatReps('45', 'sec')).toBe('45"');
  });

  it('une durée illisible garde sa forme plutôt que de disparaître', () => {
    expect(formatReps('max', 'sec')).toBe('max"');
  });

  /** ⚠️ LE RÉALISÉ NE S'AFFICHE QUE S'IL DIFFÈRE. Un « 3 → 3 » serait du bruit
   *  sur chaque ligne d'une séance faite comme prévu. */
  it('le réalisé apparaît quand il diffère de la consigne', () => {
    expect(formatReps('3', 'count', '2')).toBe('3 → 2');
    expect(formatReps('3', 'count', '3')).toBe('3');
    expect(formatReps('3', 'count', '  ')).toBe('3');
    expect(formatReps('3', 'count')).toBe('3');
  });

  /** ⚠️ C'EST CE QUI A PERMIS LA FUSION : appelée à deux arguments, la version
   *  riche rend EXACTEMENT ce que rendait la version courte de `session-table`.
   *  Un sous-ensemble strict, pas une variante. */
  it('sans réalisé, elle se comporte comme l’ancienne version courte', () => {
    for (const [reps, unite] of [['3', 'count'], ['300', 'sec'], ['', 'count'], ['8-10', 'count']]) {
      expect(formatReps(reps, unite)).toBe(formatReps(reps, unite, undefined));
    }
  });
});

describe('le repos', () => {
  it('un repos libre se nomme, il ne se calcule pas', () => {
    // Vide ou absent : la seule écriture depuis FRE-169 — `-1` ne peut plus arriver.
    expect(formatRest('')).toBe('Libre');
    expect(formatRest(null)).toBe('Libre');
  });

  it('une durée se lit en minutes et secondes', () => {
    expect(formatRest('90')).toBe("1'30\"");
    expect(formatRest('120')).toBe("2'");
  });

  it('ce qui n’est pas une durée passe intact', () => {
    expect(formatRest('à la sensation')).toBe('à la sensation');
  });

  /** ⚠️ CETTE SPEC GRAVAIT LA RÈGLE D'AVANT, et il faut le dire : elle affirmait
   *  « le repos réel ne s'ajoute qu'à un repos LIBRE », donc que `90` prescrit et
   *  `75` pris s'affichait `1'30"` — l'écart disparaissait.
   *
   *  Le raisonnement d'origine était bon sur l'affichage et mauvais sur la
   *  saisie : la case n'existait pas non plus sur un repos prescrit, si bien que
   *  4 395 lignes de production ne portaient AUCUN réel, faute de pouvoir. Une
   *  spec qui grave un défaut le rend indiscutable — c'est la deuxième de la
   *  semaine dans ce cas. */
  it('sur un repos LIBRE, le réel s’ajoute — il est la seule information', () => {
    expect(formatRestWithActual('', '75')).toBe('Libre · réel 75s');
    expect(formatRestWithActual('', '   ')).toBe('Libre');
  });

  it('sur un repos PRESCRIT, le réel s’affiche quand il DIFFÈRE', () => {
    // 3' prescrites, 5' prises : c'est l'écart qui explique la séance.
    expect(formatRestWithActual('180', '300')).toBe("3' → 5'");
  });

  it('… et se tait quand la consigne a été suivie', () => {
    // ⚠️ COMPARÉ SUR LA VALEUR FORMATÉE : « 180 » et « 3' » sont le MÊME repos,
    // et les opposer afficherait un écart qui n'existe pas.
    expect(formatRestWithActual('180', '180')).toBe("3'");
    expect(formatRestWithActual('180', "3'")).toBe("3'");
  });

  it('sans réel saisi, la consigne reste seule', () => {
    expect(formatRestWithActual('90', '')).toBe("1'30\"");
    expect(formatRestWithActual('90')).toBe("1'30\"");
  });

  it('un réel déjà écrit garde sa forme', () => {
    expect(formatRestActual('2min')).toBe('2min');
    expect(formatRestActual('75')).toBe('75s');
    expect(formatRestActual('  ')).toBe('');
  });
});

describe('le suffixe du badge de format', () => {
  const ligne = (o: Partial<{ format: string; clusterMode: string; sets: string; clusterRest: string }>) =>
    ({ format: '', clusterMode: '', sets: '', ...o }) as Parameters<typeof formatBadgeSuffix>[0];

  /** ⚠️ LE SEUL AFFICHAGE QUI CHANGE, ET C'EST VOULU. La table du coach passait
   *  par `formatTimeValue` et rendait `300"` ; l'aperçu de l'athlète passait par
   *  `formatReps(…, "sec")` et rendait `5'`. Même exercice, deux écrans, deux
   *  lectures — sur 22 lignes de production (`300` ×19, `60` ×3).
   *
   *  La version riche l'emporte : `5'` se lit, `300"` demande de compter. */
  it('un AMRAP se lit en minutes des DEUX côtés désormais', () => {
    expect(formatBadgeSuffix(ligne({ format: 'AMRAP', clusterMode: '300' }))).toBe(" 5'");
    expect(formatBadgeSuffix(ligne({ format: 'AMRAP', clusterMode: '60' }))).toBe(" 1'");
  });

  it('un AMRAP sans durée n’ajoute rien — 27 lignes réelles sont dans ce cas', () => {
    expect(formatBadgeSuffix(ligne({ format: 'AMRAP', clusterMode: '' }))).toBe('');
  });

  /** L'EMOM annonce le TOTAL puis l'intervalle : « 10' - 60" » pour dix tours
   *  d'une minute. Le total est ce qu'on veut savoir avant de commencer. */
  it('un EMOM donne le total puis l’intervalle', () => {
    expect(formatBadgeSuffix(ligne({ format: 'EMOM', clusterMode: '60', sets: '10' }))).toBe(" 10' - 60\"");
  });

  it('un EMOM sans séries ne peut pas calculer de total, et n’en invente pas', () => {
    expect(formatBadgeSuffix(ligne({ format: 'EMOM', clusterMode: '60', sets: '' }))).toBe(' 60"');
  });

  it('un CLUSTER joint son motif et son repos', () => {
    expect(formatBadgeSuffix(ligne({ format: 'CLUSTER', clusterMode: '3x2', clusterRest: '20' }))).toBe(' 3x2 · 20"');
    expect(formatBadgeSuffix(ligne({ format: 'CLUSTER', clusterMode: '3x2' }))).toBe(' 3x2');
  });

  it('un exercice sans format n’a pas de suffixe — 11 622 lignes sur 12 040', () => {
    expect(formatBadgeSuffix(ligne({}))).toBe('');
  });
});

describe('une durée brute', () => {
  it('un nombre nu prend la seconde, le reste passe intact', () => {
    expect(formatTimeValue('45')).toBe('45"');
    expect(formatTimeValue('1:30')).toBe('1:30');
    expect(formatTimeValue('')).toBe('');
  });
});

describe('formatSeries', () => {
  it('met le singulier sur UNE série, et sur elle seule', () => {
    // ⚠️ VU SUR UN VRAI DROPSET : l'en-tête annonçait « 1 séries ». Le défaut
    // existait depuis FRE-31, mais aucun bi-set n'était prescrit à une seule
    // série — c'est le dropset qui l'a rendu visible, puisqu'il enchaîne ses
    // descentes en UN tour.
    expect(formatSeries('1')).toBe('1 série');
    expect(formatSeries('3')).toBe('3 séries');
  });

  it('une FOURCHETTE reste au pluriel', () => {
    // ⚠️ `sets` EST DU TEXTE. `Number('3-4')` rend NaN et `parseInt` rend 3 :
    // deux façons différentes de se tromper, dont l'une mettrait « 3-4 » au
    // singulier. Le singulier ne vaut donc que pour la chaîne « 1 ».
    expect(formatSeries('3-4')).toBe('3-4 séries');
    expect(formatSeries('1-2')).toBe('1-2 séries');
  });

  it('rien de prescrit garde le tiret', () => {
    expect(formatSeries('')).toBe('— séries');
    expect(formatSeries('  ')).toBe('— séries');
  });
});

/** ⚠️ LE MOT SUIT LA LANGUE — ET IL NE LA SUIVAIT PAS (FRE-113). « Libre »,
 *  « réel » et « séries » étaient écrits dans le code : un anglophone lisait
 *  `Libre · réel 75s` au milieu d'une interface en anglais, et rien ne le
 *  signalait — `tsc` est aveugle à la langue d'une chaîne.
 *
 *  Cette spec est la seule du fichier qui change de langue, et c'est pour ça
 *  qu'elle est à la fin : elle la remet en français en sortant, sinon les
 *  suivantes hériteraient d'un état qu'elles n'ont pas demandé. */
describe('la langue', () => {
  it('emporte les mots du formatage', async () => {
    await i18n.changeLanguage('en');
    try {
      expect(formatRestWithActual('', '75')).toBe('Free · actual 75s');
      expect(formatSeries('3-4')).toBe('3-4 sets');
      // Ce qui n'est PAS un mot ne bouge pas : le tiret cadratin, la minute.
      expect(formatRest('180')).toBe("3'");
    } finally {
      await i18n.changeLanguage('fr');
    }
  });
});
