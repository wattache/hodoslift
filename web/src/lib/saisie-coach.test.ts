import { beforeAll, describe, expect, it } from 'vitest';
import i18n from '@/i18n';

import {
  appliquerLePas, appliquerLeRaccourci, champSuivant, ecrituresDePrescription, pasDuChamp, resumeDuReel,
} from './saisie-coach';

/** LES RÈGLES DE SAISIE DU COACH, hors de toute vue — le tableau et les cartes
 *  du téléphone les partagent (brief coach, 27/09). */

// Les écarts se disent en français : la spec les lit tels quels.
beforeAll(async () => { await i18n.changeLanguage('fr'); });

describe('le stepper du téléphone', () => {
  it('« Champ suivant » parcourt séries → reps → charge → RPE, puis reboucle', () => {
    expect(champSuivant('sets')).toBe('reps');
    expect(champSuivant('reps')).toBe('weight');
    expect(champSuivant('weight')).toBe('aimedRPE');
    expect(champSuivant('aimedRPE')).toBe('sets');
  });

  it('le pas est JUSTE par champ : 2,5 kg, 1 série, 0,5 RPE', () => {
    expect(pasDuChamp('weight')).toBe(2.5);
    expect(pasDuChamp('sets')).toBe(1);
    expect(pasDuChamp('aimedRPE')).toBe(0.5);
  });

  it('un pas ne descend jamais sous zéro, et ne traîne pas de flottant', () => {
    expect(appliquerLePas('80', 2.5)).toBe('82.5');
    expect(appliquerLePas('82,5', -2.5)).toBe('80');
    expect(appliquerLePas('1', -2.5)).toBe('0');
    expect(appliquerLePas('0.1', 0.2)).toBe('0.3');
  });

  it('une fourchette « 6/8 » part de sa borne basse, plutôt que de planter', () => {
    expect(appliquerLePas('6/8', 1)).toBe('7');
    expect(appliquerLePas('', 1)).toBe('1');
  });

  it('un raccourci signé se cumule, un raccourci nu se pose', () => {
    expect(appliquerLeRaccourci('100', '−5')).toBe('95');
    expect(appliquerLeRaccourci('100', '+2.5')).toBe('102.5');
    expect(appliquerLeRaccourci('100', '5')).toBe('5');
  });
});

describe('une consigne périme le réel qu’elle décrivait', () => {
  it('les reps effacent le réel des reps, la charge efface le sien et se verrouille', () => {
    expect(ecrituresDePrescription('reps', '8')).toEqual([['reps', '8'], ['repsDone', '']]);
    expect(ecrituresDePrescription('weight', '80')).toEqual([['weight', '80'], ['weightLocked', true], ['weightDone', '']]);
    expect(ecrituresDePrescription('weight', ' ')).toEqual([['weight', ' '], ['weightLocked', false], ['weightDone', '']]);
  });

  it('le repos se range sans espaces, le RPE cible et les séries tels quels', () => {
    expect(ecrituresDePrescription('rest', ' 180 ')).toEqual([['rest', '180']]);
    expect(ecrituresDePrescription('aimedRPE', '8')).toEqual([['aimedRPE', '8']]);
    expect(ecrituresDePrescription('sets', '4')).toEqual([['sets', '4']]);
  });
});

describe('ce que l’athlète a fait, résumé pour le coach', () => {
  const ligne = { sets: '4', reps: '8', repsUnit: 'count', weight: '40', aimedRPE: '7' } as const;

  it('rien de saisi : rien à résumer — le vide n’affirme pas « conforme »', () => {
    expect(resumeDuReel({ ...ligne, weightDone: '', repsDone: '', feltRPE: '' })).toBeNull();
  });

  it('conforme : la prescription reprise, le RPE ressenti à côté', () => {
    expect(resumeDuReel({ ...ligne, weightDone: '', repsDone: '', feltRPE: '7' })).toEqual({
      texte: '4 × 8 · 40 kg', detail: 'RPE ressenti 7 · conforme', ecart: false,
    });
  });

  it('⚠️ une charge sous la consigne est un ÉCART, dit en kilos', () => {
    const r = resumeDuReel({ ...ligne, weight: '120', weightDone: '115', repsDone: '', feltRPE: '8', aimedRPE: '8' });
    expect(r).toMatchObject({ texte: '4 × 8 · 115 kg', ecart: true });
    expect(r!.detail).toContain('−5 kg');
  });

  it('un RPE ressenti au-dessus du visé est un écart, même à consigne tenue', () => {
    expect(resumeDuReel({ ...ligne, weightDone: '', repsDone: '', feltRPE: '9' })).toMatchObject({ ecart: true });
  });

  it('une ligne au chrono dit ses secondes', () => {
    expect(resumeDuReel({ sets: '3', reps: '20', repsUnit: 'sec', weight: '', weightDone: '', repsDone: '20', feltRPE: '' }))
      .toMatchObject({ texte: '3 × 20 s', ecart: false });
  });
});
