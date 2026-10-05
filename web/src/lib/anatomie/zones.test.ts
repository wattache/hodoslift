import { describe, expect, it } from 'vitest';

import {
  CADRE, codeDeZone, coteDeLEcran, coteDuCorps, estLateralisee, litLeCode,
  nombreDeTraces, slugDuTrace, tousLesSlugs, zonesDeLaVue, zonesTouchables,
  type Cote, type Vue,
} from './zones';
import { FAISCEAUX } from './faisceaux';

/** LE CÔTÉ DU CORPS — la règle que la planche d'origine ne tient pas.
 *
 *  ⚠️ SEPT DES HUIT DOULEURS SIGNALÉES EN PRODUCTION PRÉCISENT UN CÔTÉ
 *  (« Épaule droite », « Gêne pec gauche », « Genou gauche »…). Se tromper de
 *  côté n'est pas un défaut d'affichage : c'est envoyer le kiné sur l'autre
 *  épaule. */
describe('le côté touché est celui de l’athlète, pas celui de l’écran', () => {
  it('de FACE, on lui fait face : sa droite est à notre gauche', () => {
    expect(coteDuCorps('face', 'left')).toBe('droite');
    expect(coteDuCorps('face', 'right')).toBe('gauche');
  });

  it('de DOS, on regarde dans son sens : sa gauche est à notre gauche', () => {
    expect(coteDuCorps('dos', 'left')).toBe('gauche');
    expect(coteDuCorps('dos', 'right')).toBe('droite');
  });

  /** ⚠️ LE DÉFAUT EXACT DE L'ISSUE #88 DE LA PLANCHE D'ORIGINE, ouverte depuis
   *  octobre 2025 : « flipping the body view should mirror the selection ».
   *  Sans conversion, le même côté d'écran rendrait le même côté de corps dans
   *  les deux vues — et l'épaule changerait de camp en tournant la figure.
   *
   *  MUTATION QUI ROUGIT : rendre `coteEcran === 'left' ? 'gauche' : 'droite'`
   *  dans les deux branches — la face et le dos répondent alors pareil. */
  it('la MÊME épaule se touche des deux côtés de l’écran selon la vue', () => {
    const deFace = coteDuCorps('face', 'left');
    const deDos = coteDuCorps('dos', 'right');
    expect(deFace).toBe('droite');
    expect(deDos).toBe('droite');
    expect(deFace).toBe(deDos);
  });

  it('le retour est exact : ce qu’on lit se rallume au bon endroit', () => {
    for (const vue of ['face', 'dos'] as Vue[]) {
      for (const ecran of ['left', 'right'] as const) {
        expect(coteDeLEcran(vue, coteDuCorps(vue, ecran)!)).toBe(ecran);
      }
    }
  });

  /** ⚠️ UN TRACÉ CENTRAL N'A PAS DE CÔTÉ, et ce n'est pas un oubli : la nuque
   *  en porte un au milieu, entre ses deux moitiés. Lui coller « gauche » par
   *  défaut enverrait le kiné chercher une latéralité qui n'existe pas. */
  it('un tracé central ne rend aucun côté, dans les deux vues', () => {
    expect(coteDuCorps('face', 'common')).toBeNull();
    expect(coteDuCorps('dos', 'common')).toBeNull();
  });

  it('une douleur gauche change de côté d’écran quand on retourne la figure', () => {
    // C'est la conséquence visible de la règle, et ce que l'issue #88 décrit.
    expect(coteDeLEcran('face', 'gauche')).toBe('right');
    expect(coteDeLEcran('dos', 'gauche')).toBe('left');
  });
});

describe('le code d’une zone', () => {
  it('porte le côté quand il y en a un, et rien d’autre sinon', () => {
    expect(codeDeZone('chest', 'gauche')).toBe('chest:gauche');
    expect(codeDeZone('lower-back', null)).toBe('lower-back');
  });

  it('se relit tel quel', () => {
    for (const [slug, cote] of [['chest', 'gauche'], ['knees', 'droite'], ['abs', null]] as
         [string, Cote | null][]) {
      expect(litLeCode(codeDeZone(slug, cote))).toEqual({ slug, cote });
    }
  });

  /** ⚠️ UN CODE VENU DE LA BASE PEUT ÊTRE VIEUX. Une zone retirée d'une planche
   *  future ne doit pas faire tomber la lecture : on rend ce qu'on comprend. */
  it('ne casse pas sur un code inconnu', () => {
    expect(litLeCode('petit-pectoral:gauche')).toEqual({ slug: 'petit-pectoral', cote: 'gauche' });
    expect(litLeCode('')).toEqual({ slug: '', cote: null });
  });
});

describe('les planches', () => {
  it('les deux vues portent des zones', () => {
    for (const v of ['face', 'dos'] as Vue[]) {
      expect(zonesDeLaVue(v).length).toBeGreaterThan(8);
    }
  });

  /** ⚠️ LA TÊTE ET LES CHEVEUX SE DESSINENT MAIS NE SE TOUCHENT PAS. Les
   *  retirer du dessin donnerait un corps décapité ; les laisser cliquables
   *  proposerait une réponse qui n'en est pas une. La nuque, elle, est une
   *  vraie zone de douleur — et elle reste. */
  it('le décor est dessiné mais pas proposé', () => {
    for (const v of ['face', 'dos'] as Vue[]) {
      const dessinees = zonesDeLaVue(v).map(z => z.slug);
      const touchables = zonesTouchables(v).map(z => z.slug);
      expect(touchables).not.toContain('hair');
      expect(touchables).not.toContain('head');
      if (dessinees.includes('neck')) expect(touchables).toContain('neck');
    }
  });

  it('la tête est bien DESSINÉE de face — sinon la silhouette est décapitée', () => {
    expect(zonesDeLaVue('face').map(z => z.slug)).toContain('head');
  });

  /** ⚠️ MESURÉ, PAS SUPPOSÉ : la planche latéralise TOUT ce qu'elle trace, y
   *  compris le bas du dos et les abdominaux. On ne propose donc jamais une
   *  zone sans côté — `estLateralisee` reste pour la planche qui ne le ferait
   *  pas, et cette spec dit laquelle on a sous la main. */
  it('toutes les zones touchables sont latéralisées', () => {
    for (const v of ['face', 'dos'] as Vue[]) {
      for (const z of zonesTouchables(v)) {
        expect(estLateralisee(z), `${v}/${z.slug}`).toBe(true);
      }
    }
  });

  /** ⚠️ LA PLANCHE DÉCLARE DES ZONES QU'ELLE NE DESSINE PAS. Une zone sans le
   *  moindre chemin serait proposée, invisible, et intouchable : elle est
   *  écartée par la règle, jamais par son nom. */
  it('une zone déclarée sans tracé n’est jamais rendue', () => {
    for (const v of ['face', 'dos'] as Vue[]) {
      for (const z of zonesDeLaVue(v)) {
        expect(nombreDeTraces(z), `${v}/${z.slug}`).toBeGreaterThan(0);
      }
    }
  });

  /** ⚠️ LE DOS EST CADRÉ PLUS LOIN DANS LE MÊME DESSIN. Un cadre identique pour
   *  les deux vues afficherait la face en croyant montrer le dos. */
  it('le cadre du dos est décalé, celui de la face part de zéro', () => {
    expect(CADRE.face).toBe('0 0 724 1448');
    expect(CADRE.dos).toBe('724 0 724 1448');
  });


});

describe('le vocabulaire', () => {
  it('descend au MUSCLE là où la planche le permet', () => {
    const slugs = tousLesSlugs();
    // ⚠️ LE CAS QUI A LANCÉ LE CHANTIER : « Brachial et brachio radial, dips »
    // est une saisie de production que « Avant-bras » ne savait pas rendre.
    expect(slugs).toContain('brachioradialis');
    expect(slugs).toContain('sartorius');
    expect(slugs).toContain('vastus-medialis');
    expect(slugs).toContain('anconeus');
    expect(slugs).toContain('thumb');
    // Et ce qu'on n'a PAS voulu nommer garde son nom d'ensemble.
    expect(slugs).toContain('obliques');
    expect(slugs).toContain('abs');
    expect(slugs).not.toContain('hair');
    expect(slugs.length).toBeGreaterThanOrEqual(35);
  });

  /** ⚠️ NI `tsc` NI UN COMPTEUR DE CLÉS NE VOIENT UNE TRADUCTION MANQUANTE : le
   *  muscle s'afficherait par son slug, sans que rien ne casse. */
  it('chaque slug a un nom dans les deux langues', async () => {
    const fr = (await import('@/i18n/locales/fr.json')).default.anatomie as Record<string, unknown>;
    const en = (await import('@/i18n/locales/en.json')).default.anatomie as Record<string, unknown>;
    for (const s of tousLesSlugs()) {
      expect(fr[s], `fr · ${s}`).toBeTruthy();
      expect(en[s], `en · ${s}`).toBeTruthy();
    }
  });

  /** ⚠️ CERTAINS LIBELLÉS NE CORRESPONDENT PLUS À AUCUN TRACÉ, ET DOIVENT
   *  RESTER. Des douleurs de production portent un code que la figure ne
   *  produit plus depuis qu'elle descend au muscle : `forearm` est devenu
   *  brachio-radial et deux fléchisseurs, `hands` la paume et cinq doigts, et
   *  `deltoids` se scinde en antérieur et postérieur selon la vue. Les
   *  retirer ferait afficher « FOREARM » sur la carte d'un athlète — ce qui est
   *  arrivé, et que William a vu avant cette spec.
   *
   *  Un code venu de la base peut être vieux : le vocabulaire d'écriture
   *  rétrécit, celui de LECTURE ne rétrécit jamais sans migration. */
  it('les libellés de repli survivent aux codes retirés du vocabulaire', async () => {
    const fr = (await import('@/i18n/locales/fr.json')).default.anatomie as Record<string, unknown>;
    for (const ancien of ['forearm', 'hands', 'deltoids']) {
      expect(fr[ancien], `repli manquant : ${ancien}`).toBeTruthy();
    }
  });

  /** ⚠️ ET PAS DE LIBELLÉ INVENTÉ : un nom qui ne désigne ni un muscle vivant
   *  ni un code encore porté en base est un reste, et il laisse croire que la
   *  zone existe. */
  it('aucun libellé ne survit sans raison', async () => {
    const fr = (await import('@/i18n/locales/fr.json')).default.anatomie as Record<string, unknown>;
    // Ce qui n'est pas un muscle mais vit sous `anatomie.` : les deux vues, les
    // deux côtés, leur abréviation pour les repères du téléphone, le zoom, et
    // les replis des codes encore présents en production.
    const horsMuscles = new Set(['vue', 'gauche', 'droite', 'gaucheCourt', 'droiteCourt',
                                 'zoom', 'changerSilhouette', 'silhouette',
                                 'forearm', 'hands', 'deltoids']);
    const vivants = new Set(tousLesSlugs());
    for (const cle of Object.keys(fr)) {
      if (horsMuscles.has(cle)) continue;
      expect(vivants.has(cle), `libellé orphelin : ${cle}`).toBe(true);
    }
  });
});

/** ⚠️ LA TABLE DES FAISCEAUX PARLE PAR RANGS, et un rang qui dépasse le nombre
 *  de tracés ne lève pas : il rend `undefined`, et le muscle retombe
 *  silencieusement sur le nom de sa zone. C'est le genre de faute qu'on ne voit
 *  qu'en regardant l'écran — donc on la mesure ici. */
describe('la table des faisceaux', () => {
  it('ne nomme que des rangs qui existent', () => {
    for (const [cle, noms] of Object.entries(FAISCEAUX)) {
      const [vue, slug] = cle.split('/') as [Vue, string];
      const zone = zonesDeLaVue(vue).find(z => z.slug === slug);
      expect(zone, `zone inconnue : ${cle}`).toBeDefined();
      const traces = Math.max(zone!.path.left?.length ?? 0, zone!.path.right?.length ?? 0);
      expect(noms.length, `${cle} : ${noms.length} noms pour ${traces} tracés`).toBe(traces);
    }
  });

  it('nomme les deux côtés de la même façon', () => {
    for (const cle of Object.keys(FAISCEAUX)) {
      const [vue, slug] = cle.split('/') as [Vue, string];
      const zone = zonesDeLaVue(vue).find(z => z.slug === slug)!;
      const noms = (cote: 'left' | 'right') =>
        (zone.path[cote] ?? []).map((_, i) => slugDuTrace(vue, zone, cote, i)).sort();
      // ⚠️ LA PLANCHE NE RANGE PAS SES TRACÉS DANS LE MÊME ORDRE à gauche et à
      // droite : sans l'appariement par hauteur, une douleur au semi-membraneux
      // droit s'appellerait « biceps fémoral » à gauche.
      expect(noms('left'), cle).toEqual(noms('right'));
    }
  });
});

/** LE DELTOÏDE — le seul muscle que SEULE la vue distingue.
 *
 *  ⚠️ LA PLANCHE NE DESSINE QU'UNE ÉPAULE PAR CÔTÉ, et c'est ce qui rend ce cas
 *  unique : partout ailleurs, deux faisceaux voisins sont deux TRACÉS. Ici le
 *  tracé est le même ; ce qu'on voit dépend d'où l'on regarde. De face c'est
 *  l'antérieur, de dos le postérieur.
 *
 *  ⚠️ CE QUE CETTE SPEC GARDE : que la vue entre dans le nom. Nommer les deux
 *  `deltoids` redeviendrait vert partout ailleurs — l'épaule se toucherait, se
 *  coderait, s'afficherait — et le kiné lirait « épaule » là où l'athlète a
 *  montré l'avant. C'est la distinction que William a demandée le 23/09, et
 *  les trois douleurs d'alors étaient toutes antérieures.
 *
 *  ⚠️ LE DELTOÏDE MOYEN N'EST PAS NOMMÉ : la planche ne le dessine pas à part.
 *  On ne fabrique pas un muscle que le dessin ne porte pas. */
describe('le deltoïde se lit dans la vue', () => {
  const traceDeLEpaule = (vue: Vue) => {
    const zone = zonesDeLaVue(vue).find(z => z.slug === 'deltoids');
    expect(zone, `la vue ${vue} doit porter l’épaule`).toBeDefined();
    return zone!;
  };

  it('de FACE il est ANTÉRIEUR, de DOS il est POSTÉRIEUR', () => {
    const face = traceDeLEpaule('face');
    const dos = traceDeLEpaule('dos');
    expect(slugDuTrace('face', face, 'left', 0)).toBe('deltoid-anterior');
    expect(slugDuTrace('dos', dos, 'left', 0)).toBe('deltoid-posterior');
  });

  it('les deux ÉPAULES d’une même vue portent le même faisceau', () => {
    // L'ordre des tracés diffère gauche/droite sur plusieurs zones de la
    // planche : c'est le RANG qui nomme, pas l'index brut.
    for (const vue of ['face', 'dos'] as Vue[]) {
      const zone = traceDeLEpaule(vue);
      expect(slugDuTrace(vue, zone, 'left', 0)).toBe(slugDuTrace(vue, zone, 'right', 0));
    }
  });

  it('aucune vue ne rend le nom d’ensemble « deltoids »', () => {
    for (const vue of ['face', 'dos'] as Vue[]) {
      const zone = traceDeLEpaule(vue);
      for (const cote of ['left', 'right'] as const) {
        expect(slugDuTrace(vue, zone, cote, 0)).not.toBe('deltoids');
      }
    }
  });

  it('et le code d’une douleur d’épaule porte le faisceau, pas la région', () => {
    // ⚠️ LE CODE EST CE QUI PART EN BASE. Un code `deltoids:gauche` reviendrait
    // à ranger l'avant et l'arrière de l'épaule ensemble, sans retour possible.
    const face = traceDeLEpaule('face');
    expect(codeDeZone(slugDuTrace('face', face, 'left', 0), coteDuCorps('face', 'left')))
      .toBe('deltoid-anterior:droite');
  });
});
