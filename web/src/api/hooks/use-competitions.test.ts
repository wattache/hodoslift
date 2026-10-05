import { describe, expect, it } from 'vitest';

import { toWritePayload } from '@/api/hooks/use-competitions';

/** CE QUI PART AU SERVEUR, champ par champ.
 *
 *  L'écriture reconstruit chaque participant plutôt que de renvoyer l'objet lu :
 *  brokkr refuse les champs dérivés (`extra="forbid"`). Le revers : un champ
 *  oublié dans la reconstruction n'arrive jamais, et s'efface au premier
 *  enregistrement, sans erreur ni message.
 *
 *  MUTATION QUI ROUGIT : retirer `weightCategory` de `toParticipantInput`. */
describe('toWritePayload', () => {
  const lu = {
    name: 'Willi', competesOn: null, movements: [], flight: 'B', gender: 'M' as const, weightCategory: '-80',
    score: 150, risTotal: 150, ris: null, projection: { pessimistic: 0, realistic: 0, optimistic: 0 },
  };

  it('porte la catégorie, qui fait le groupe (FRE-204)', () => {
    const [p] = toWritePayload({ participants: [lu] }).participants!;
    expect(p).toMatchObject({ gender: 'M', weightCategory: '-80' });
  });

  it('ne porte AUCUN champ dérivé', () => {
    const [p] = toWritePayload({ participants: [lu] }).participants!;
    // `flight` se déduit de la catégorie : brokkr le refuserait en entrée.
    for (const derive of ['score', 'risTotal', 'ris', 'projection', 'flight']) expect(p).not.toHaveProperty(derive);
  });
});
