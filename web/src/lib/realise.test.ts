import { describe, expect, it } from 'vitest';

import { seanceAOuvrir, seanceEstEntamee } from '@/lib/realise';

/** QUELLE SÉANCE S'OUVRE D'EMBLÉE — William, 20/09 puis 24/09.
 *
 *  Le cas est une semaine RÉELLE (la sienne, 21–27/09) : le muscle up du lundi
 *  a été fait sur la ligne du vendredi, si bien que Lundi n'est pas complétée et
 *  que Vendredi est entamée sans avoir eu lieu. La règle « première non
 *  complétée » ramenait l'écran sur Lundi chaque jour ; la règle pragmatique
 *  ouvre Samedi, la première séance sans aucune trace.
 *
 *  MUTATION QUI ROUGIT : ouvrir la première non COMPLÉTÉE au lieu de la
 *  première non ENTAMÉE — Lundi sort à la place de Samedi. */

const ligne = (feltRPE: string | null = null) => ({ feltRPE, feltRPEBySet: [] as string[] });
const seance = (id: string, faites: number, total: number, sessionDate = '') => ({
  id, sessionDate,
  exercises: Array.from({ length: total }, (_, i) => ligne(i < faites ? '7' : null)),
});

const semaineDeWilliam = [
  seance('lundi', 9, 10),
  seance('mardi', 5, 5),
  seance('mercredi', 4, 4),
  seance('vendredi', 1, 6),
  seance('samedi', 0, 6),
];

describe('seanceEstEntamee', () => {
  it('une seule ligne tracée suffit : beaucoup ne notent que le principal', () => {
    expect(seanceEstEntamee(seance('x', 1, 6))).toBe(true);
    expect(seanceEstEntamee(seance('x', 0, 6))).toBe(false);
  });
  it('le ressenti par série compte comme une trace', () => {
    expect(seanceEstEntamee({ exercises: [{ feltRPE: '', feltRPEBySet: ['8'] }] })).toBe(true);
  });
});

describe('seanceAOuvrir', () => {
  it("ouvre la première séance SANS AUCUNE trace, pas la première non complétée", () => {
    expect(seanceAOuvrir(semaineDeWilliam, '2026-09-24')?.id).toBe('samedi');
  });
  it('saute une séance vide : elle n’est pas « à faire »', () => {
    expect(seanceAOuvrir([seance('vide', 0, 0), seance('pleine', 0, 3)], '2026-09-24')?.id).toBe('pleine');
  });
  it('tout entamé : la date du jour tranche', () => {
    const toutes = [seance('a', 1, 3, '2026-09-21'), seance('b', 1, 3, '2026-09-24'), seance('c', 3, 3, '2026-09-26')];
    expect(seanceAOuvrir(toutes, '2026-09-24')?.id).toBe('b');
  });
  it('tout entamé et rien ce jour-là : la première, comme avant', () => {
    expect(seanceAOuvrir([seance('a', 1, 3), seance('b', 2, 3)], '2026-09-24')?.id).toBe('a');
  });
  it('semaine sans séance : rien', () => {
    expect(seanceAOuvrir([], '2026-09-24')).toBeNull();
  });
});
