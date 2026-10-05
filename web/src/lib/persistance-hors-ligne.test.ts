import { describe, expect, it } from 'vitest';

import { estPersistee } from '@/lib/persistance-hors-ligne';

/** CE QUI TOUCHE LE DISQUE, ET CE QUI N'Y TOUCHE JAMAIS — FRE-118.
 *
 *  ⚠️ CE FICHIER GARDE UNE RÈGLE DE CONFIDENTIALITÉ, pas une optimisation. Le
 *  cache persisté vit sur le téléphone, en clair, et survit à la fermeture de
 *  l'app. Un coach a soixante athlètes : son annuaire, ses bilans kiné, ses
 *  compétitions n'ont rien à y faire.
 *
 *  ⚠️ ET C'EST UNE LISTE BLANCHE. La spec qui compte n'est pas « `structure` est
 *  gardée » — c'est qu'une clé INCONNUE ne l'est pas. Une liste noire aurait
 *  laissé passer, dans six mois, le domaine que personne n'aura pensé à exclure ;
 *  et l'oubli ne se verrait sur aucun écran.
 */
describe('la liste blanche du cache hors ligne', () => {
  it('garde ce qu’il faut pour saisir une séance', () => {
    expect(estPersistee(['structure', 'prog-1'])).toBe(true);
    expect(estPersistee(['block-content', 'prog-1', 'bloc-3'])).toBe(true);
    // Sans `me`, le gate arrête l'athlète sur « pas de connexion » et le reste
    // du cache devient inatteignable.
    expect(estPersistee(['me'])).toBe(true);
  });

  it('⚠️ JAMAIS PLUS D’UNE FICHE D’ATHLÈTE, et c’est la CLÉ qui le garantit', () => {
    // La borne de confidentialité du ticket. Elle était d'abord vérifiée à
    // l'exécution — on persistait `['athletes','mine']` si la liste ne portait
    // qu'un nom. Juste sur l'intention, fausse sur le monde réel : le premier
    // utilisateur est coach ET athlète, sa liste en compte soixante, et couper
    // son Wi-Fi lui donnait « Aucun athlète sélectionné » avec sa semaine sur le
    // disque à côté.
    //
    // `mon-athlete` ne peut en contenir qu'une par construction. Une borne qu'on
    // ne peut pas franchir vaut mieux qu'une borne qu'on teste.
    expect(estPersistee(['mon-athlete'])).toBe(true);
    expect(estPersistee(['athletes', 'mine'])).toBe(false);
    expect(estPersistee(['athletes', 'suivis'])).toBe(false);
  });

  it('⚠️ ne garde RIEN d’autre, y compris ce qui n’existe pas encore', () => {
    for (const cle of [
      ['bilans', 'ath-1'], ['athletes'], ['athletes', 'mine'], ['competitions'], ['library'],
      ['tracking', 'ath-1'], ['records', 'ath-1'], ['forme-du-jour', 'ath-1'],
      ['bilan-modeles'], ['kines'], ['events', 'ath-1'],
      // L'arbre entier : il reste servi à l'éditeur de BASE, mais 512 Ko de
      // séances d'un autre bloc n'ont aucune raison de dormir sur le téléphone.
      ['training', 'prog-1'],
      // Le domaine qu'on n'a pas encore inventé.
      ['un-domaine-de-2027'],
    ]) {
      expect(estPersistee(cle), `${cle[0]} ne doit pas toucher le disque`).toBe(false);
    }
  });

  it('une clé qui n’est pas une chaîne ne passe pas', () => {
    // Défensif, mais pas décoratif : une clé peut légitimement commencer par un
    // objet de filtres, et `Set.has` sur un objet rendrait toujours faux — on
    // veut que ce soit VRAI par construction, pas par accident.
    expect(estPersistee([{ scope: 'structure' }])).toBe(false);
    expect(estPersistee([])).toBe(false);
  });
});
