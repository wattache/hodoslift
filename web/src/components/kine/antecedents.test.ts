import { describe, expect, it } from 'vitest';
import { decouper, rejoindre } from '@/components/kine/antecedents-texte';

/** Le découpage des antécédents — un par ligne.
 *
 *  ⚠️ POURQUOI CES SPECS EXISTENT. La colonne est un `text` et l'interface une
 *  LISTE : tout le contrat entre les deux tient dans ces deux fonctions. Une
 *  virgule oubliée dans un `split` et un antécédent se coupe en deux, ou deux se
 *  collent — sur un champ médical, et sans que rien ne le signale.
 */
describe('antécédents — texte ↔ liste', () => {
  it('découpe sur les retours à la ligne', () => {
    expect(decouper('Entorse 2024\nLombalgie chronique')).toEqual(['Entorse 2024', 'Lombalgie chronique']);
  });

  it('ne coupe PAS sur une virgule', () => {
    // ⚠️ LE CAS QUI DÉCIDE DU SÉPARATEUR. « Entorse cheville droite, 2024 » est
    // UN antécédent : découper sur la virgule en ferait deux, dont un « 2024 »
    // qui ne veut rien dire.
    expect(decouper('Entorse cheville droite, 2024')).toEqual(['Entorse cheville droite, 2024']);
  });

  it('écarte les lignes vides et les espaces', () => {
    expect(decouper('  Entorse  \n\n   \nLombalgie')).toEqual(['Entorse', 'Lombalgie']);
  });

  it('rend NULL et non une chaîne vide quand il n’y a rien', () => {
    // ⚠️ `null` = aucun antécédent connu, ce que la colonne exprime en NULL.
    // Écrire `''` créerait un troisième état, indiscernable à la relecture.
    expect(rejoindre([])).toBeNull();
    expect(rejoindre(['', '   '])).toBeNull();
  });

  it('fait l’aller-retour sans rien perdre', () => {
    const source = ['Entorse cheville droite, 2024', 'Lombalgie chronique'];
    expect(decouper(rejoindre(source))).toEqual(source);
  });

  it('tolère un texte hérité d’une saisie libre', () => {
    // L'ancienne zone de texte permettait tout ; ce qui existe déjà doit se relire.
    expect(decouper('  \n Entorse \n')).toEqual(['Entorse']);
    expect(decouper(null)).toEqual([]);
    expect(decouper(undefined)).toEqual([]);
  });
});
