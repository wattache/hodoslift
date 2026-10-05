import { describe, expect, it } from 'vitest';
import { abregerMouvements, joursDuCycle, mouvementsDeLaTrame, nomDuJour, normaliseDaySplit, rangDeCycle, sansNomsDeSemaine } from './constants';

describe('joursDuCycle', () => {
  it('rend J1 … Jn', () => {
    expect(joursDuCycle(3)).toEqual(['J1', 'J2', 'J3']);
  });

  it('borne à [1, 14] — le stepper ne propose rien d’autre, le stockage si', () => {
    expect(joursDuCycle(0)).toHaveLength(7);   // 0 = « pas de grille » → le défaut
    expect(joursDuCycle(99)).toHaveLength(14);
    expect(joursDuCycle(-3)).toHaveLength(1);
  });
});

describe('rangDeCycle', () => {
  /** ⚠️ LA RAISON D'ÊTRE DE CETTE FONCTION. Trier les libellés comme du texte
   *  rangerait « J10 » entre « J1 » et « J2 » : un cycle de dix jours ou plus
   *  sortirait dans le désordre, et personne ne le verrait avant d'en configurer
   *  un. C'est le même tri que brokkr (`generation_semaine.rang_de_cycle`). */
  it('ordonne J9 avant J10', () => {
    expect(['J10', 'J2', 'J9', 'J1'].sort((a, b) => rangDeCycle(a) - rangDeCycle(b)))
      .toEqual(['J1', 'J2', 'J9', 'J10']);
  });

  it('range en dernier ce qui n’est pas un jour de cycle', () => {
    expect(rangDeCycle('Lundi')).toBeGreaterThan(rangDeCycle('J14'));
    expect(rangDeCycle('')).toBeGreaterThan(rangDeCycle('J14'));
  });
});

describe('abregerMouvements', () => {
  it('prend les initiales, et garde les noms courts entiers', () => {
    expect(abregerMouvements(['MUSCLE UP', 'PULL UP', 'DIPS', 'SQUAT']))
      .toEqual({ 'MUSCLE UP': 'MU', 'PULL UP': 'PU', DIPS: 'DIPS', SQUAT: 'SQ' });
  });

  /** ⚠️ VU ROUGE AVEC UNE ABRÉVIATION PAR NOM : « PULL UP » et « PUSH UP »
   *  donnaient deux colonnes « PU » sur téléphone — l'écran où la confusion
   *  coûte le plus, et le défaut même que ce ticket corrige côté couleurs. */
  it('sépare deux mouvements qui abrègent pareil', () => {
    const abr = abregerMouvements(['PULL UP', 'PUSH UP']);
    expect(abr['PULL UP']).not.toBe(abr['PUSH UP']);
    expect(Object.values(abr)).toEqual(['PU', 'PUS']);
  });
});

describe('normaliseDaySplit', () => {
  /** ⚠️ CETTE FONCTION DÉCIDE DE CE QUI SURVIT À UN ENREGISTREMENT. Elle
   *  reconstruit la grille jour par jour : tout champ qu'elle ne recopie pas est
   *  perdu au prochain « enregistrer », sans un mot. C'est exactement ainsi que
   *  la répartition d'un bloc a disparu le 20/09 — les jours n'étaient pas
   *  reconnus, donc pas recopiés.
   *
   *  MUTATION QUI ROUGIT : rendre `{ day, tiers }` au lieu de reporter le
   *  libellé — « Haut du corps » disparaît au premier enregistrement. */
  it('garde le LIBELLÉ du jour', () => {
    const grille = normaliseDaySplit(
      [{ day: 'J1', label: 'Haut du corps', tiers: { SQUAT: 1 } }], ['SQUAT'], 2);
    expect(grille[0]).toEqual({ day: 'J1', label: 'Haut du corps', tiers: { SQUAT: 1 } });
  });

  it('un jour neuf n’a pas de libellé, et ce n’est pas une chaîne vide', () => {
    // `''` et `null` diraient la même chose à l'écran et deux choses en base :
    // le défaut le plus répété du projet.
    const grille = normaliseDaySplit([], [], 1);
    expect(grille[0].label ?? null).toBeNull();
  });

  /** ⚠️ CE COMPORTEMENT EST JUSTE, ET IL NE DOIT PLUS SE DÉCLENCHER DEPUIS
   *  L'ÉDITEUR (FRE-198) : la vue lui passe désormais `mouvementsDeLaTrame`,
   *  qui inclut ce que la grille place déjà. Ne pas lire cette spec comme
   *  « jeter est le comportement produit » — c'est le contrat de la fonction,
   *  pas la règle de l'écran. */
  it('laisse tomber les tiers d’un mouvement DÉSÉLECTIONNÉ, libellé intact', () => {
    const grille = normaliseDaySplit(
      [{ day: 'J1', label: 'Jambes', tiers: { SQUAT: 1, DIPS: 2 } }], ['SQUAT'], 1);
    expect(grille[0]).toEqual({ day: 'J1', label: 'Jambes', tiers: { SQUAT: 1 } });
  });
});

describe('mouvementsDeLaTrame', () => {
  /** LA RÈGLE DE FRE-198 : la grille a son mot à dire sur ce qui s'affiche.
   *
   *  ⚠️ LE RETRAIT DÉLIBÉRÉ A SON PROPRE CHEMIN, confirmé, qui nettoie la
   *  grille lui-même. Un mouvement placé sans être sélectionné n'est donc
   *  jamais un geste du coach : c'est une incohérence, et la jeter efface la
   *  seule trace de ce qu'il avait posé. */
  const J = (day: string, tiers: Record<string, number>) => ({ day, tiers });

  it('rend la sélection telle quelle quand la grille n’ajoute rien', () => {
    expect(mouvementsDeLaTrame([J('J1', { SQUAT: 1 })], ['SQUAT', 'DIPS']))
      .toEqual(['SQUAT', 'DIPS']);
  });

  it('rend un mouvement que la grille PLACE et que la sélection ignore', () => {
    // La faute du 19/09, en une ligne : `BENCH` posé, jamais sélectionné.
    expect(mouvementsDeLaTrame([J('J6', { BENCH: 2 })], ['SQUAT']))
      .toEqual(['SQUAT', 'BENCH']);
  });

  /** ⚠️ L'HÉRITÉ VIENT APRÈS, ET CE N'EST PAS COSMÉTIQUE : `generation_semaine`
   *  range un mouvement hors sélection en FIN de séance (`rang_mouvement` rend
   *  `10**6`). L'écran doit dire ce qui sera engendré — sinon le coach voit un
   *  ordre et en génère un autre, le défaut d'origine de FRE-29. */
  it('met l’hérité APRÈS la sélection, dont l’ordre ne bouge pas', () => {
    expect(mouvementsDeLaTrame(
      [J('J1', { BENCH: 1, 'PULL UP': 2 })], ['MUSCLE UP', 'PULL UP', 'SQUAT']))
      .toEqual(['MUSCLE UP', 'PULL UP', 'SQUAT', 'BENCH']);
  });

  it('ne rend jamais deux fois le même mouvement, même placé plusieurs jours', () => {
    expect(mouvementsDeLaTrame([J('J1', { BENCH: 1 }), J('J4', { BENCH: 2 })], []))
      .toEqual(['BENCH']);
  });

  it('garde l’ordre des jours pour départager deux hérités', () => {
    expect(mouvementsDeLaTrame([J('J1', { VELO: 1 }), J('J2', { BENCH: 1 })], []))
      .toEqual(['VELO', 'BENCH']);
  });

  it('ne casse pas sur un jour sans tiers', () => {
    expect(mouvementsDeLaTrame([{ day: 'J1' } as never], ['SQUAT'])).toEqual(['SQUAT']);
  });

  /** ⚠️ LA COMPOSITION EST CE QUE LA VUE FAIT, et c'est elle qui décide de ce
   *  qui survit à un enregistrement. Éprouver les deux fonctions séparément ne
   *  dirait rien de leur assemblage — c'est justement l'assemblage qui perdait. */
  it('composée à normaliseDaySplit, elle ne perd AUCUNE case', () => {
    const grille = [J('J1', { SQUAT: 1, BENCH: 2 }), J('J2', { VELO: 3 })];
    const garde = normaliseDaySplit(grille, mouvementsDeLaTrame(grille, ['SQUAT']), 2);
    expect(garde[0].tiers).toEqual({ SQUAT: 1, BENCH: 2 });
    expect(garde[1].tiers).toEqual({ VELO: 3 });
  });
});

describe('nomDuJour', () => {
  /** ⚠️ LE DÉFAUT A REMPLACÉ LE BOUTON (William, 30/09). Le geste « Nommer comme
   *  la semaine » était oublié presque partout : sur sept jours, le nom de la
   *  semaine s'affiche sans rien cliquer ; il disparaît dès que le cycle change. */
  it('sur sept jours, J1 … J7 s’appellent Lundi … Dimanche', () => {
    /** MUTATION QUI ROUGIT : rendre `jour.day` sans regarder la longueur du cycle. */
    expect(normaliseDaySplit([], [], 7).map(j => nomDuJour(j, 7))).toEqual(
      ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']);
  });

  it('sur tout autre cycle, le jour garde son J<n>', () => {
    expect(normaliseDaySplit([], [], 9).map(j => nomDuJour(j, 9))).toEqual(['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7', 'J8', 'J9']);
    expect(nomDuJour({ day: 'J3' }, 5)).toBe('J3');
  });

  it('le nom posé par le coach prime, à sept jours comme à neuf ; une chaîne d’espaces n’en est pas un', () => {
    expect(nomDuJour({ day: 'J1', label: 'Jambes' }, 7)).toBe('Jambes');
    expect(nomDuJour({ day: 'J1', label: 'Jambes' }, 9)).toBe('Jambes');
    expect(nomDuJour({ day: 'J1', label: '   ' }, 7)).toBe('Lundi');
  });
});

describe('sansNomsDeSemaine', () => {
  /** Le cycle quitte les sept jours : un « Lundi » ÉCRIT par l'ancien bouton n'a
   *  plus de sens sur J1 d'un cycle de huit. Il s'en va ; un nom propre reste. */
  it('retire le nom de semaine écrit sur son jour, quelle que soit sa casse', () => {
    const grille = sansNomsDeSemaine([
      { day: 'J1', label: 'Lundi', tiers: { SQUAT: 1 } },
      { day: 'J2', label: 'MARDI', tiers: {} },
    ]);
    expect(grille.map(j => j.label ?? null)).toEqual([null, null]);
    // ⚠️ `day` ET LES TIERS NE BOUGENT PAS : l'identité du jour n'est pas son nom.
    expect(grille[0]).toEqual({ day: 'J1', tiers: { SQUAT: 1 } });
  });

  it('garde un nom propre au coach, et un nom de semaine posé sur un AUTRE jour', () => {
    /** MUTATION QUI ROUGIT : retirer tout libellé qui est un jour de semaine,
     *  sans regarder le rang — « Lundi » choisi pour J3 partirait aussi. */
    const grille = sansNomsDeSemaine([
      { day: 'J1', label: 'Jambes', tiers: {} },
      { day: 'J3', label: 'Lundi', tiers: {} },
    ]);
    expect(grille.map(j => j.label)).toEqual(['Jambes', 'Lundi']);
  });
});
