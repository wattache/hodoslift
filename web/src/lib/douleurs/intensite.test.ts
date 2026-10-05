import { describe, expect, it } from 'vitest';

import { cleDIntensite, couleurDIntensite, GRIS_LIBRE, OR_SELECTION, VALEURS } from './intensite';

/** L'ÉCHELLE D'INTENSITÉ — trois écrans la lisent, une seule table la définit.
 *
 *  ⚠️ POURQUOI UNE SPEC ALORS QUE `tsc` PASSE : rien ici n'a de type qui
 *  contraigne. Un seuil déplacé d'un cran, une couleur recopiée, une clé
 *  renommée — tout compile, et l'écran ment sans rien casser. */
describe('zéro est une RÉPONSE, pas une absence', () => {
  /** ⚠️ LA CORRECTION DE WILLIAM, LE 23/09 : « le commentaire qui va avec
   *  "0/10" ne doit pas être "plus mal" mais "pas mal" ». Les deux se
   *  ressemblent et ne disent pas la même chose : « plus mal » suppose qu'on
   *  avait mal AVANT. C'est faux le jour où l'on déclare une douleur en la
   *  notant zéro — et c'est le cas d'Aghiles, dont la première note est un
   *  zéro. */
  it('se dit « pas mal », et ne suppose pas un avant', () => {
    expect(cleDIntensite(0)).toBe('douleurs.intensite.pasMal');
  });

  it('se propose à la saisie', () => {
    expect(VALEURS).toContain(0);
  });

  /** ⚠️ ET IL EST VERT. Le peindre comme « rien noté » effacerait la seule
   *  bonne nouvelle que cet écran sache afficher. */
  it('porte sa propre couleur — ni celle du pire, ni celle du muscle libre', () => {
    expect(couleurDIntensite(0)).not.toBe(couleurDIntensite(10));
    expect(couleurDIntensite(0)).not.toBe(GRIS_LIBRE);
    expect(couleurDIntensite(0)).not.toBe(OR_SELECTION);
  });
});

/** ⚠️ L'OR DE LA SÉLECTION CONTRE L'OR DU PALIER 1–3 : sur la figure, ce qu'on
 *  vient de toucher et ce qui fait un peu mal sont deux états distincts. Les
 *  rapprocher rendrait indécidable ce qu'on regarde. */
describe('les états de la figure ne se confondent pas', () => {
  it('sélection, muscle libre et tous les paliers sont distincts deux à deux', () => {
    const couleurs = [OR_SELECTION, GRIS_LIBRE, ...VALEURS.map(couleurDIntensite)];
    for (const reference of [OR_SELECTION, GRIS_LIBRE]) {
      expect(VALEURS.map(couleurDIntensite)).not.toContain(reference);
    }
    expect(new Set(couleurs).size).toBeGreaterThanOrEqual(3);
  });
});

/** ⚠️ LES SEUILS SE DÉCALENT SANS UN BRUIT. Un `<=` devenu `<` glisserait toute
 *  l'échelle d'un cran : 3 deviendrait « limitant », 6 « fort ». Chaque BORNE
 *  est nommée ici, avec celle qui la suit. */
describe('les bornes de l’échelle', () => {
  const attendu: Array<[number, string]> = [
    [0, 'pasMal'],
    [1, 'genant'], [3, 'genant'],
    [4, 'limitant'], [6, 'limitant'],
    [7, 'fort'], [8, 'fort'],
    [9, 'insupportable'], [10, 'insupportable'],
  ];

  it.each(attendu)('%i/10 se dit « %s »', (valeur, mot) => {
    expect(cleDIntensite(valeur)).toBe(`douleurs.intensite.${mot}`);
  });

  it('monte sans jamais redescendre', () => {
    // La gravité ne peut pas s'alléger quand le chiffre grandit : deux paliers
    // intervertis passeraient les bornes ci-dessus si on en oubliait une.
    const rang = (v: number) =>
      ['pasMal', 'genant', 'limitant', 'fort', 'insupportable']
        .indexOf(cleDIntensite(v).split('.').pop()!);
    for (let v = 1; v <= 10; v++) expect(rang(v)).toBeGreaterThanOrEqual(rang(v - 1));
  });
});

/** ⚠️ NI `tsc` NI UN COMPTEUR DE CLÉS NE VOIENT UNE TRADUCTION MANQUANTE : le
 *  palier s'afficherait par sa clé — « douleurs.intensite.fort » — à côté du
 *  chiffre, sans que rien ne casse. Le même piège que les noms de muscles. */
describe('chaque palier se dit dans les deux langues', () => {
  it('fr et en portent les cinq clés', async () => {
    const fr = (await import('@/i18n/locales/fr.json')).default.douleurs.intensite as Record<string, string>;
    const en = (await import('@/i18n/locales/en.json')).default.douleurs.intensite as Record<string, string>;
    const utilisees = new Set(VALEURS.map(v => cleDIntensite(v).split('.').pop()!));
    expect(utilisees.size).toBe(5);
    for (const cle of utilisees) {
      expect(fr[cle], `fr.douleurs.intensite.${cle}`).toBeTruthy();
      expect(en[cle], `en.douleurs.intensite.${cle}`).toBeTruthy();
    }
  });
});
