import { describe, expect, it } from 'vitest';

import { EVENT_CATEGORIES, draftFromEvent, estModifiable } from '@/lib/evenement-calendrier';
import type { CalendarEvent } from '@/api/types';

/** OUVRIR UN ÉVÉNEMENT NE CHANGE PAS SON TYPE — FRE-140.
 *
 *  ⚠️ LE DÉFAUT : `rest` existe dans l'enum `event_type` du serveur depuis
 *  toujours, sans tuile côté front. `draftFromEvent` retombait donc sur `other`,
 *  et ouvrir un jour de repos en édition le RÉÉCRIVAIT en « autre » à
 *  l'enregistrement — sans erreur, sans trace, et sans que rien à l'écran ne
 *  laisse deviner qu'un type a été perdu.
 *
 *  Latent aujourd'hui : zéro événement `rest` en base sur 28. C'est le genre de
 *  défaut qui attend le premier usage de la fonctionnalité pour se manifester.
 */
const evenement = (type: string): CalendarEvent => ({
  id: 'e1', type, name: 'X', emoji: '📌',
  startDate: '2026-09-07', endDate: '2026-09-07', canTrain: true,
} as CalendarEvent);

describe('le type d’un événement survit à l’édition', () => {
  it.each(['vacation', 'travel', 'rest', 'other'])(
    'garde « %s »', type => {
      expect(draftFromEvent(evenement(type)).type).toBe(type);
    });

  it('⚠️ un type INCONNU retombe sur « autre », et c’est voulu', () => {
    // Le repli n'est pas le défaut — il faut bien afficher quelque chose d'un
    // type que cette version du front ne connaît pas. Le défaut était que
    // `rest`, lui, ÉTAIT connu du serveur et pas d'ici.
    expect(draftFromEvent(evenement('teleportation')).type).toBe('other');
  });
});

/** UNE COMPÉTITION NE SE SAISIT PLUS DEPUIS LE CALENDRIER (William, 16/09).
 *
 *  Elle se définit dans son onglet. L'événement homonyme n'avait qu'un nom et deux
 *  dates, et fabriquait une compétition FANTÔME sur la frise. brokkr refuse
 *  désormais ce type à l'écriture ; il le LIT encore — 13 lignes de production,
 *  dont 11 à venir. */
describe('la compétition héritée du calendrier', () => {
  it('le formulaire ne la propose plus', () => {
    expect(EVENT_CATEGORIES.map(c => c.type)).not.toContain('competition');
  });

  it('elle se lit, mais ne s’ouvre pas en édition — « autre » réécrirait ce qui a été noté', () => {
    /** MUTATION QUI ROUGIT : `estModifiable` toujours vrai. */
    expect(estModifiable(evenement('competition'))).toBe(false);
    expect(estModifiable(evenement('vacation'))).toBe(true);
  });
});
