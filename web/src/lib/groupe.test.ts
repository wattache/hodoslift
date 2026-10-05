import { beforeAll, describe, expect, it } from 'vitest';

import i18n from '@/i18n';

import type { Exercise, Session } from '@/api/types';
import { blocDe, chaineSansLacher, CHAMPS_DE_GROUPE, champsDeGroupe, grouperExercices, leReposSeSaisit, libelleGroupe, natureDe, nettoyerGroupesSeuls, rangDansLeGroupe, tempsDuGroupe } from '@/lib/groupe';

/** Ce que les e2e ne peuvent PAS atteindre (FRE-31).
 *
 *  Un groupe orphelin — `groupId` resté sur une ligne dont le partenaire a été
 *  supprimé — est INVISIBLE par construction : le rendu exige `groupSize > 1`,
 *  donc il produit exactement le même écran qu'une absence de lien. Aucun test
 *  Playwright ne peut l'attraper, et c'est pour ça que cinq d'entre eux ont
 *  survécu des mois en base avant qu'un inventaire ne les révèle.
 *
 *  Les cas de bord du découpage (groupe en tête, en queue, à trois membres) sont
 *  ici pour la même raison : chacun demanderait un scénario d'interface complet,
 *  lent et fragile, là où trois lignes suffisent. */

const exo = (nom: string, groupId = '', groupKind = ''): Exercise =>
  ({ name: nom, groupId, groupKind, sets: '3', reps: '10' } as Exercise);

const seance = (...exercices: Exercise[]): Session =>
  ({ id: 's', name: 'Test', exercises: exercices } as Session);

describe('grouperExercices', () => {
  it('un exercice isolé donne un bloc à un membre, sans identifiant', () => {
    const blocs = grouperExercices(seance(exo('SQUAT')));
    expect(blocs).toHaveLength(1);
    expect(blocs[0].id).toBeNull();
    expect(blocs[0].exercices).toHaveLength(1);
  });

  it('deux lignes liées ne forment qu’un bloc', () => {
    const blocs = grouperExercices(seance(exo('CURL', 'g1'), exo('TRICEPS', 'g1')));
    expect(blocs).toHaveLength(1);
    expect(blocs[0].id).toBe('g1');
    expect(blocs[0].exercices.map(e => e.exercice.name)).toEqual(['CURL', 'TRICEPS']);
  });

  it('LE CAS INVISIBLE — un groupe ORPHELIN est traité comme un exercice isolé', () => {
    // Un seul membre porte `g1` : son partenaire a été supprimé. À l'écran, ce
    // cas est indistinguable d'une ligne non liée — d'où ce test.
    const blocs = grouperExercices(seance(exo('SQUAT'), exo('CURL', 'g1')));
    expect(blocs).toHaveLength(2);
    expect(blocs[1].id).toBeNull();
  });

  it('les index d’origine sont conservés', () => {
    // Les vues s'en servent pour appeler les callbacks d'édition : un décalage
    // ici ferait éditer la mauvaise ligne, silencieusement.
    const blocs = grouperExercices(seance(exo('A'), exo('B', 'g1'), exo('C', 'g1'), exo('D')));
    expect(blocs.map(b => b.exercices.map(e => e.index))).toEqual([[0], [1, 2], [3]]);
  });

  it('un groupe en TÊTE de séance', () => {
    const blocs = grouperExercices(seance(exo('A', 'g1'), exo('B', 'g1'), exo('C')));
    expect(blocs.map(b => b.id)).toEqual(['g1', null]);
  });

  it('un groupe en QUEUE de séance', () => {
    const blocs = grouperExercices(seance(exo('A'), exo('B', 'g1'), exo('C', 'g1')));
    expect(blocs.map(b => b.id)).toEqual([null, 'g1']);
  });

  it('deux groupes DISTINCTS ne fusionnent pas', () => {
    const blocs = grouperExercices(
      seance(exo('A', 'g1'), exo('B', 'g1'), exo('C', 'g2'), exo('D', 'g2')),
    );
    expect(blocs.map(b => b.id)).toEqual(['g1', 'g2']);
  });

  it('trois membres forment un seul bloc', () => {
    const blocs = grouperExercices(seance(exo('A', 'g1'), exo('B', 'g1'), exo('C', 'g1')));
    expect(blocs).toHaveLength(1);
    expect(blocs[0].exercices).toHaveLength(3);
  });

  it('les séries et le repos du bloc viennent de son PREMIER membre', () => {
    // L'écriture les propage à tous, donc lire le premier suffit — et c'est ce
    // que fait l'affichage.
    const a = { ...exo('A', 'g1'), sets: '4', rest: '120' } as Exercise;
    const b = { ...exo('B', 'g1'), sets: '4', rest: '120' } as Exercise;
    const [bloc] = grouperExercices(seance(a, b));
    expect(bloc.sets).toBe('4');
    expect(bloc.rest).toBe('120');
  });

  it('un groupId fait d’espaces ne lie rien', () => {
    const blocs = grouperExercices(seance(exo('A', '   '), exo('B', '   ')));
    expect(blocs.map(b => b.id)).toEqual([null, null]);
  });
});

describe('libelleGroupe', () => {
  /** ⚠️ LA LANGUE EST FIXÉE : ces libellés sortent des locales depuis FRE-113,
   *  et la langue détectée en test n'est pas celle du navigateur de qui les
   *  lit. Ce que le mot SUIT la langue est épinglé à la fin du bloc. */
  beforeAll(async () => { await i18n.changeLanguage('fr'); });

  it('nomme les tailles courantes', () => {
    expect(libelleGroupe(2)).toBe('BI-SET');
    expect(libelleGroupe(3)).toBe('TRI-SET');
  });

  it('annonce le nombre au-delà — « QUADRI-SET » n’est pas un mot de coach', () => {
    expect(libelleGroupe(4)).toBe('4 EXOS LIÉS');
  });

  /** ⚠️ CES LIBELLÉS ÉTAIENT ÉCRITS DANS LE CODE (FRE-113). « BI-SET » et
   *  « 4 EXOS LIÉS » s'affichaient tels quels sous une interface en anglais —
   *  et « EXOS LIÉS » n'est pas du jargon de salle, c'est du français. */
  it('suit la langue de l’interface', async () => {
    await i18n.changeLanguage('en');
    try {
      expect(libelleGroupe(2)).toBe('SUPERSET');
      expect(libelleGroupe(4)).toBe('4 LINKED EXOS');
    } finally {
      await i18n.changeLanguage('fr');
    }
  });
});

/* ------------------------------------------------------------------------- */
/* L'ÉCRITURE — enfin testable (FRE-45)                                       */
/*                                                                            */
/* ⚠️ CES TROIS-LÀ N'AVAIENT AUCUNE SPEC, et pas par négligence : elles         */
/* vivaient DANS le corps de `useTrainingEditor`, écrites en colonne 0. Les     */
/* atteindre demandait de monter le hook entier. Les sortir n'est donc pas du   */
/* rangement — c'est ce qui les rend vérifiables.                              */
/* ------------------------------------------------------------------------- */

describe('nettoyerGroupesSeuls', () => {
  /** ⚠️ LE DÉFAUT QU'ELLE FERME, ET IL A EXISTÉ : 5 lignes chez un athlète
   *  portaient un `groupId` qui ne reliait plus rien — invisibles à l'écran,
   *  puisque l'affichage exige deux membres, mais bien présentes en base. */
  it('un partenaire supprimé ne laisse pas un lien orphelin', () => {
    const lignes = [exo('SQUAT', 'g1'), exo('DIPS')];
    nettoyerGroupesSeuls(lignes);
    expect(lignes[0].groupId).toBe('');
  });

  it('un groupe à DEUX membres reste intact', () => {
    const lignes = [exo('SQUAT', 'g1'), exo('DIPS', 'g1')];
    nettoyerGroupesSeuls(lignes);
    expect(lignes.map(l => l.groupId)).toEqual(['g1', 'g1']);
  });

  it('un tri-set amputé d’un membre reste un groupe', () => {
    // L'invariant est « pas de groupe à UN membre », pas « on ne délie jamais ».
    const lignes = [exo('A', 'g1'), exo('B', 'g1')];
    nettoyerGroupesSeuls(lignes);
    expect(lignes.every(l => l.groupId === 'g1')).toBe(true);
  });

  it('elle ne touche pas aux lignes jamais groupées', () => {
    const lignes = [exo('SQUAT'), exo('DIPS')];
    nettoyerGroupesSeuls(lignes);
    expect(lignes.map(l => l.groupId)).toEqual(['', '']);
  });

  it('les espaces ne fabriquent pas un groupe', () => {
    const lignes = [exo('SQUAT', '   '), exo('DIPS', '   ')];
    nettoyerGroupesSeuls(lignes);
    // Deux `groupId` blancs ne sont pas deux membres d'un même groupe.
    expect(lignes.map(l => l.groupId)).toEqual(['   ', '   ']);
  });
});

describe('blocDe', () => {
  /** Les membres sont supposés CONSÉCUTIFS : c'est ce que produit l'app, et
   *  intercaler un exercice étranger entre A et B n'aurait aucun sens physique
   *  — on enchaînerait autre chose au milieu du bi-set. */
  it('une ligne isolée est son propre bloc', () => {
    expect(blocDe([exo('A'), exo('B')], 0)).toEqual({ debut: 0, fin: 0 });
  });

  it('un bi-set se déplace d’un seul tenant, depuis n’importe lequel de ses membres', () => {
    const lignes = [exo('X'), exo('A', 'g1'), exo('B', 'g1'), exo('Y')];
    expect(blocDe(lignes, 1)).toEqual({ debut: 1, fin: 2 });
    expect(blocDe(lignes, 2)).toEqual({ debut: 1, fin: 2 });
  });

  it('un tri-set aussi', () => {
    const lignes = [exo('A', 'g1'), exo('B', 'g1'), exo('C', 'g1')];
    expect(blocDe(lignes, 1)).toEqual({ debut: 0, fin: 2 });
  });

  it('deux groupes VOISINS ne se confondent pas', () => {
    const lignes = [exo('A', 'g1'), exo('B', 'g1'), exo('C', 'g2'), exo('D', 'g2')];
    expect(blocDe(lignes, 0)).toEqual({ debut: 0, fin: 1 });
    expect(blocDe(lignes, 2)).toEqual({ debut: 2, fin: 3 });
  });
});

describe('CHAMPS_DE_GROUPE', () => {
  /** ⚠️ CE QUI APPARTIENT AU TOUR, PAS À LA LIGNE. Un bi-set, c'est N exercices
   *  puis UN repos, répété UN nombre de fois : les séries et le repos décrivent
   *  le tour. Deux valeurs différentes au sein d'un groupe n'ont aucun sens
   *  physique — et ça existait, 19 groupes en portaient une. */
  it('les séries et le repos appartiennent au groupe', () => {
    expect(CHAMPS_DE_GROUPE.has('sets')).toBe(true);
    expect(CHAMPS_DE_GROUPE.has('rest')).toBe(true);
  });

  it('les reps, la charge et le RPE restent PROPRES à chaque exercice', () => {
    for (const champ of ['reps', 'weight', 'feltRPE', 'aimedRPE', 'name']) {
      expect(CHAMPS_DE_GROUPE.has(champ)).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------------- */
/* LA NATURE D'UN GROUPE (FRE-36)                                             */
/* ------------------------------------------------------------------------- */

describe('la nature du groupe', () => {
  it('un groupe sans nature annoncée est un bi-set', () => {
    // ⚠️ LE SERVEUR REND LA NATURE RÉSOLUE, donc `''` ne devrait plus arriver
    // ici. On le tient quand même : un contrat n'est vrai que tant que personne
    // ne le contourne, et une maquette, une fixture ou un import le contournent
    // par construction.
    const [bloc] = grouperExercices(seance(exo('CURL', 'g1'), exo('TRICEPS', 'g1')));
    expect(bloc.nature).toBe('biset');
  });

  it('un dropset se lit sur le groupe', () => {
    const [bloc] = grouperExercices(
      seance(exo('BACK EXTENSION', 'g1', 'dropset'), exo('BACK EXTENSION', 'g1', 'dropset')));
    expect(bloc.nature).toBe('dropset');
  });

  it('un exercice ISOLÉ n’hérite d’aucune nature, même s’il en porte une', () => {
    // ⚠️ UN RÉSIDU NE DOIT PAS DÉCIDER. Une ligne déliée peut garder sa nature
    // en base le temps d'un aller-retour ; la lire ferait afficher « DROPSET »
    // sur un exercice seul, c'est-à-dire un groupe qui n'existe pas.
    const [bloc] = grouperExercices(seance(exo('SQUAT', '', 'dropset')));
    expect(bloc.nature).toBe('biset');
    expect(bloc.id).toBeNull();
  });

  it('un groupe ORPHELIN non plus', () => {
    // Même raison : un `groupId` dont le partenaire a été supprimé ne relie
    // rien, donc ne porte pas de nature à afficher.
    const [bloc] = grouperExercices(seance(exo('SQUAT', 'orphelin', 'dropset')));
    expect(bloc.id).toBeNull();
    expect(bloc.nature).toBe('biset');
  });
});

describe('libelleGroupe et la nature', () => {
  it('un dropset ne compte PAS ses membres', () => {
    // « BI-SET » dit deux exercices enchaînés ; un dropset, ce sont des
    // DESCENTES du même exercice, et « 4 EXOS LIÉS » y décrirait une chose qui
    // n'existe pas.
    expect(libelleGroupe(2, 'dropset')).toBe('DROPSET');
    expect(libelleGroupe(4, 'dropset')).toBe('DROPSET');
  });

  it('sans nature précisée, le libellé reste celui du bi-set', () => {
    expect(libelleGroupe(2)).toBe('BI-SET');
    expect(libelleGroupe(2, 'biset')).toBe('BI-SET');
  });
});

describe('leReposSeSaisit', () => {
  it('jamais sur un dropset, toujours sur un enchaînement', () => {
    // ⚠️ RÈGLE D'AFFORDANCE. Un dropset n'a pas de repos entre ses descentes —
    // définition, pas réglage à zéro. Laisser la case ouverte inviterait à y
    // écrire une valeur que rien ne lira, et un coach a déjà encodé « pas de
    // pause » avec un repos à 0 faute de pouvoir le dire autrement (FRE-31).
    expect(leReposSeSaisit('dropset')).toBe(false);
    expect(leReposSeSaisit('biset')).toBe(true);
  });
});

describe('CHAMPS_DE_GROUPE porte la nature', () => {
  it('la nature se propage comme les séries et le repos', () => {
    // ⚠️ SINON LA PROPAGATION S'ÉCRIT UNE SECONDE FOIS, dans la vue, sous forme
    // de boucle sur les membres — c'est-à-dire une règle des groupes hors de ce
    // fichier, exactement ce que FRE-45 est venu défaire.
    expect(CHAMPS_DE_GROUPE.has('groupKind')).toBe(true);
  });
});

describe('champsDeGroupe suit la nature', () => {
  it('un DROPSET partage aussi son EXERCICE', () => {
    // ⚠️ C'EST CE QUI LE DISTINGUE D'UN BI-SET autant que l'absence de repos :
    // « A puis B » contre « le MÊME mouvement, en descente ». Le nom décrit donc
    // le groupe entier, et le modifier sur une descente vaut pour toutes —
    // sinon un dropset se met à porter deux mouvements, ce qui n'existe pas.
    expect(champsDeGroupe('dropset').has('name')).toBe(true);
  });

  it('un BI-SET ne partage PAS son exercice', () => {
    // ⚠️ ET C'EST LE POINT QUI INTERDIT UNE LISTE FIGÉE. Propager le nom sur un
    // bi-set écraserait son second mouvement — la moitié de ce qu'il est.
    expect(champsDeGroupe('biset').has('name')).toBe(false);
  });

  it('les deux natures partagent séries, repos et nature', () => {
    for (const nature of ['biset', 'dropset'] as const) {
      for (const champ of ['sets', 'rest', 'groupKind']) {
        expect(champsDeGroupe(nature).has(champ)).toBe(true);
      }
    }
  });

  it('l’ancienne constante vaut celle d’un bi-set', () => {
    expect([...CHAMPS_DE_GROUPE].sort()).toEqual([...champsDeGroupe('biset')].sort());
  });
});

describe('la variante n’appartient PAS au groupe', () => {
  it('même sur un dropset', () => {
    // ⚠️ LA SYMÉTRIE EST TENTANTE ET FAUSSE : même exercice ne veut pas dire même
    // variante. Un principal à tempo dont le dropset se fait sans tempo, un
    // principal en full ROM dont la descente ne l'est plus — c'est souvent LE
    // point du dropset (William, 29/08). La propager écraserait cette intention.
    expect(champsDeGroupe('dropset').has('variant')).toBe(false);
    expect(champsDeGroupe('biset').has('variant')).toBe(false);
  });
});

/* ------------------------------------------------------------------------- */
/* L'ENDURANCE (FRE-116)                                                      */
/* ------------------------------------------------------------------------- */

describe('natureDe', () => {
  it("une nature VIDE est un bi-set — un patch d'avant FRE-137 peut encore porter ''", () => {
    expect(natureDe({ groupKind: '' as never })).toBe('biset');
    expect(natureDe({ groupKind: null })).toBe('biset');
    expect(natureDe({ groupKind: 'emom' })).toBe('emom');
  });
});

describe('champsDeGroupe, groupes chronométrés', () => {
  it("un EMOM partage ses tours et son intervalle, pas de repos", () => {
    expect([...champsDeGroupe('emom')].sort()).toEqual(['clusterMode', 'groupKind', 'sets']);
  });
  it("un AMRAP partage sa durée et les tours bouclés, ni séries ni repos", () => {
    expect([...champsDeGroupe('amrap')].sort()).toEqual(['clusterMode', 'groupKind', 'toursRealises']);
  });
  it("un bi-set ne partage PAS le temps : deux AMRAP de ligne gardent chacun le leur", () => {
    expect(champsDeGroupe('biset').has('clusterMode')).toBe(false);
  });
});

describe('tempsDuGroupe', () => {
  it("la durée d'un EMOM se CALCULE : mouvements × tours × intervalle", () => {
    expect(tempsDuGroupe('emom', 5, '3', '60')).toEqual({ intervalle: 60, total: 900 });
  });
  it("sans intervalle, on n'invente pas de durée", () => {
    expect(tempsDuGroupe('emom', 5, '3', null)).toBeNull();
  });
  it("un AMRAP dure ce qu'on lui donne", () => {
    expect(tempsDuGroupe('amrap', 2, null, '300')).toEqual({ intervalle: 300, total: 300 });
  });
});

describe('rangDansLeGroupe', () => {
  it('compte depuis le début du GROUPE, pas de la séance', () => {
    const lignes = [exo('MU'), exo('A', 'g'), exo('B', 'g'), exo('C', 'g')];
    expect(lignes.map((_, i) => rangDansLeGroupe(lignes, i))).toEqual([0, 0, 1, 2]);
  });
});

describe('chaineSansLacher', () => {
  const lie = (nom: string, unbroken = false) => ({ ...exo(nom, 'g', 'circuit'), unbroken } as Exercise);

  it('MU → PU → DIPS sans lâcher, puis SQUAT : trois mouvements, une chaîne', () => {
    const lignes = [lie('MU', true), lie('PU', true), lie('DIPS'), lie('SQUAT')];
    expect(chaineSansLacher(lignes, 0)).toEqual({ debut: true, fin: false, mouvements: 3 });
    expect(chaineSansLacher(lignes, 2)).toEqual({ debut: false, fin: true, mouvements: 3 });
    expect(chaineSansLacher(lignes, 3)).toBeNull();
  });

  it("un lien posé sur la DERNIÈRE ligne du groupe ne relie rien", () => {
    const lignes = [lie('MU'), lie('PU', true), exo('SQUAT')];
    expect(chaineSansLacher(lignes, 1)).toBeNull();
  });
});
