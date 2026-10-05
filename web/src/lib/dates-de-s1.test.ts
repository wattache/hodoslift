import { describe, expect, it } from 'vitest';

import { datesEnchainees, datesDeS1 } from '@/lib/program-selection';

/** UNE SEMAINE NE SE TERMINE PAS AVANT D'AVOIR COMMENCÉ — FRE-138.
 *
 *  ⚠️ CE QUI REND CE FICHIER NÉCESSAIRE N'EST PAS LA SAISIE, C'EST LA CASCADE.
 *  Les deux dates de S1 ne restent pas dans la trame : `blockWeekDates` en dérive
 *  celles de TOUTES les semaines du bloc, et la première reprend la paire telle
 *  quelle. Une fin antérieure au début produit une semaine impossible, et deux
 *  existent en production — invisibles jusqu'à l'invariant `dates_inversees`,
 *  parce qu'aucun écran ne montre qu'une semaine est à l'envers.
 *
 *  ⚠️ ET C'EST BLOQUANT DEPUIS LE `CHECK`. La base refuse désormais la ligne :
 *  sans cette règle, `PUT /base` répondrait 500 et la TRAME ENTIÈRE deviendrait
 *  non enregistrable. Poser la contrainte sans la règle, c'était rouvrir le
 *  défaut de la 3e passe de revue.
 */
describe('poser une date de S1 ne renverse jamais la paire', () => {
  it('reculer le DÉBUT après la fin pousse la fin avec lui', () => {
    expect(datesDeS1({ s1StartDate: '2026-02-16', s1EndDate: '2026-02-22' },
                     's1StartDate', '2026-03-16'))
      .toEqual({ s1StartDate: '2026-03-16', s1EndDate: '2026-03-16' });
  });

  it('poser la FIN avant le début la ramène AU début', () => {
    expect(datesDeS1({ s1StartDate: '2026-02-16', s1EndDate: '2026-02-22' },
                     's1EndDate', '2026-01-05'))
      .toEqual({ s1EndDate: '2026-02-16' });
  });

  it('le cas ordinaire ne touche QUE le champ posé', () => {
    expect(datesDeS1({ s1StartDate: '2026-02-16', s1EndDate: '2026-02-22' },
                     's1EndDate', '2026-02-23'))
      .toEqual({ s1EndDate: '2026-02-23' });
    expect(datesDeS1({ s1StartDate: '2026-02-16', s1EndDate: '2026-02-22' },
                     's1StartDate', '2026-02-10'))
      .toEqual({ s1StartDate: '2026-02-10' });
  });

  it('⚠️ VIDER UNE DATE RESTE POSSIBLE, et n’entraîne rien', () => {
    // 54 blocs sur 125 n'ont aucune date S1 : c'est un état normal, et le
    // `base-sans-dates` du harnais réel existe pour ça. Traiter `''` comme une
    // date ferait « pousser » la fin à vide, ou pire, la refuserait.
    expect(datesDeS1({ s1StartDate: '2026-02-16', s1EndDate: '2026-02-22' }, 's1StartDate', ''))
      .toEqual({ s1StartDate: '' });
    expect(datesDeS1({ s1StartDate: '2026-02-16', s1EndDate: '2026-02-22' }, 's1EndDate', ''))
      .toEqual({ s1EndDate: '' });
  });

  it('une paire sans début se pose telle quelle', () => {
    expect(datesDeS1({}, 's1EndDate', '2026-02-22')).toEqual({ s1EndDate: '2026-02-22' });
    expect(datesDeS1({}, 's1StartDate', '2026-02-22')).toEqual({ s1StartDate: '2026-02-22' });
  });
});

describe('la cascade ne peut alors plus produire de semaine à l’envers', () => {
  it('l’état de production, rejoué : Force S1 devait être 02-16 → 02-22', () => {
    // ⚠️ LE CAS RÉEL, PAS UN CAS D'ÉCOLE. La semaine 1 du bloc « Force » porte
    // `2026-03-16 → 2026-02-22` : la fin est juste, le début a 28 jours de trop.
    // Les semaines 2 à 6 du même bloc, elles, sont contiguës à partir du 02-23 —
    // c'est ce qui prouve que la cascade avait reçu la BONNE paire, et que le
    // début a été renversé après coup.
    const semaines = datesEnchainees(Array.from({ length: 6 }, () => ({})), '2026-02-16', '2026-02-22');
    expect(semaines[0]).toEqual({ startDate: '2026-02-16', endDate: '2026-02-22' });
    expect(semaines[1]).toEqual({ startDate: '2026-02-23', endDate: '2026-03-01' });
    expect(semaines[5]).toEqual({ startDate: '2026-03-23', endDate: '2026-03-29' });
  });

  it('⚠️ AUCUNE SEMAINE À L’ENVERS, quelle que soit la paire que la règle laisse passer', () => {
    // On enchaîne les deux : ce que `datesDeS1` accepte de produire, la cascade
    // doit pouvoir le dériver sans jamais rendre `end < start`. C'est
    // l'assertion qui vaut pour la BASE DE DONNÉES, puisque c'est elle que le
    // `CHECK` refusera.
    const paires: [string, string][] = [
      ['2026-02-16', '2026-02-22'], ['2026-02-16', '2026-02-16'],
      ['2026-02-16', '2026-03-30'], ['', ''],
    ];
    for (const [debut, fin] of paires) {
      const apres = datesDeS1({ s1StartDate: debut, s1EndDate: fin }, 's1EndDate', '2026-01-01');
      const d = apres.s1StartDate ?? debut;
      const f = apres.s1EndDate ?? fin;
      for (const s of datesEnchainees(Array.from({ length: 8 }, () => ({})), d, f)) {
        expect(s.endDate >= s.startDate, `${s.startDate} → ${s.endDate}`).toBe(true);
      }
    }
  });
});

describe('une semaine étirée garde sa durée, et pousse les suivantes', () => {
  /** ⚠️ LE CAS DE WILLIAM (20/09) : « S1 de 5 jours, S2 de 5, S3 l'athlète a
   *  besoin de 3 jours de plus pour déplacement professionnel, S4 dure bien
   *  5 jours mais débute à la date de fin de S3. » La cascade d'avant appliquait
   *  la durée de S1 à toutes : elle ramenait S3 à cinq jours au premier
   *  recalcul, et redatait S4 trois jours trop tôt. */
  it('S3 dure huit jours, S4 en dure cinq et part de sa fin', () => {
    const semaines = [
      { startDate: '2026-03-02', endDate: '2026-03-06' },   // S1, 5 jours
      { startDate: '2026-03-07', endDate: '2026-03-11' },   // S2, 5 jours
      { startDate: '2026-03-12', endDate: '2026-03-19' },   // S3, ÉTIRÉE à 8
      { startDate: '2026-03-20', endDate: '2026-03-24' },   // S4, 5 jours
    ];
    expect(datesEnchainees(semaines, '2026-03-02', '2026-03-06')).toEqual([
      { startDate: '2026-03-02', endDate: '2026-03-06' },
      { startDate: '2026-03-07', endDate: '2026-03-11' },
      { startDate: '2026-03-12', endDate: '2026-03-19' },
      { startDate: '2026-03-20', endDate: '2026-03-24' },
    ]);
  });

  it('une semaine sans dates prend la durée de référence de la BASE', () => {
    const semaines = [{}, { startDate: '2026-03-07', endDate: '2026-03-14' }, {}];
    expect(datesEnchainees(semaines, '2026-03-02', '2026-03-06')).toEqual([
      { startDate: '2026-03-02', endDate: '2026-03-06' },   // S1 : la référence
      { startDate: '2026-03-07', endDate: '2026-03-14' },   // la sienne, 8 jours
      { startDate: '2026-03-15', endDate: '2026-03-19' },   // la référence à nouveau
    ]);
  });

  /** S1 tient sa durée de la BASE : c'est là que le coach la règle (et, depuis
   *  le 20/09, la durée du cycle l'y déplace). La dater à part la ferait mentir. */
  it('S1 suit la BASE, même si ses propres dates disent autre chose', () => {
    const semaines = [{ startDate: '2026-03-02', endDate: '2026-03-30' }];
    expect(datesEnchainees(semaines, '2026-03-02', '2026-03-06'))
      .toEqual([{ startDate: '2026-03-02', endDate: '2026-03-06' }]);
  });
});

describe('rechaîner DEPUIS une semaine ne touche pas celles d’avant', () => {
  /** ⚠️ VU ROUGE SANS `depuis` : rechaîner tout depuis la BASE refermait le trou
   *  de S2 (deux trous existent en production) — et surtout l'éditeur n'aurait
   *  envoyé au serveur que les semaines à partir de la visée : l'écran et la
   *  base auraient divergé sur S1 et S2 sans qu'aucune erreur ne le dise. */
  it('S2 porte un trou ; on étire S3 : S1 et S2 sortent intactes, S4 suit S3', () => {
    const semaines = [
      { startDate: '2026-03-02', endDate: '2026-03-06' },
      { startDate: '2026-03-09', endDate: '2026-03-13' },   // un trou avant elle
      { startDate: '2026-03-14', endDate: '2026-03-21' },   // étirée à 8 jours
      { startDate: '2026-03-19', endDate: '2026-03-23' },   // à décaler
    ];
    expect(datesEnchainees(semaines, '2026-03-02', '2026-03-06', 2)).toEqual([
      { startDate: '2026-03-02', endDate: '2026-03-06' },
      { startDate: '2026-03-09', endDate: '2026-03-13' },
      { startDate: '2026-03-14', endDate: '2026-03-21' },
      { startDate: '2026-03-22', endDate: '2026-03-26' },
    ]);
  });
});
