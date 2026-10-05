// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import type { DailyLogs } from '@/api/types';
import { DailyChart } from './daily-chart';

await i18next.changeLanguage('fr');
afterEach(cleanup);

/** LE PONT SUR LES TROUS DE LA COURBE — refonte des écrans, 09/2026.
 *
 *  ⚠️ CETTE SPEC EST AU NIVEAU DU COMPOSANT ET PAS DU HELPER, et c'est délibéré :
 *  `courbe.test.ts` prouve que `suitesEtPonts` calcule les bons indices, il ne
 *  prouve pas que la vue les DESSINE, ni qu'elle les dessine plus clairs. Un
 *  helper juste dont le résultat n'est pas branché est le défaut que ce dépôt
 *  appelle « vert pour la mauvaise raison ». */

const jours = (dates: string[]) => dates.map(date => ({ date }));

function tracesDe(conteneur: HTMLElement) {
  const chemins = [...conteneur.querySelectorAll('path')];
  return {
    pleins: chemins.filter(p => !p.getAttribute('opacity')),
    ponts: chemins.filter(p => p.getAttribute('opacity')),
  };
}

describe('DailyChart — les trous', () => {
  it('RELIE deux pesées non consécutives, par un trait plus clair', () => {
    const dates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'];
    const logs = {
      '2026-09-01': { weight: 62 },
      '2026-09-04': { weight: 64 },
    } as unknown as DailyLogs;

    const { container } = render(
      <DailyChart jours={jours(dates)} logs={logs} formePoints={[]} />,
    );
    const { pleins, ponts } = tracesDe(container);

    expect(ponts, 'le trou doit être enjambé').toHaveLength(1);
    expect(Number(ponts[0].getAttribute('opacity'))).toBeLessThan(1);
    // ⚠️ LE PONT EST DROIT : pas une seule cubique. C'est ce qui le distingue
    // d'un segment observé, et donc ce qui garde l'information du trou.
    expect(ponts[0].getAttribute('d')).not.toContain('C');
    // Deux suites d'UN point chacune : rien à tracer en plein, ce sont les
    // pastilles qui les portent.
    expect(pleins).toHaveLength(0);
    expect(container.querySelectorAll('circle')).toHaveLength(2);
  });

  it('n’enjambe RIEN quand la série est complète, et adoucit le trait', () => {
    const dates = ['2026-09-01', '2026-09-02', '2026-09-03'];
    const logs = {
      '2026-09-01': { weight: 62 },
      '2026-09-02': { weight: 62.5 },
      '2026-09-03': { weight: 63 },
    } as unknown as DailyLogs;

    const { container } = render(
      <DailyChart jours={jours(dates)} logs={logs} formePoints={[]} />,
    );
    const { pleins, ponts } = tracesDe(container);

    expect(ponts).toHaveLength(0);
    expect(pleins).toHaveLength(1);
    expect(pleins[0].getAttribute('d'), 'la courbe doit être adoucie').toContain('C');
  });

  it('garde le trait PLEIN au-dessus du pont', () => {
    // Les deux se touchent au point de raccord : si le pont passait par-dessus,
    // son opacité réduite éclaircirait le bout du trait observé.
    //
    // ⚠️ LE TROU EST UN JOUR SANS PESÉE, PAS UNE DATE ABSENTE DE `jours`. Première
    // rédaction : j'avais retiré le 09-04 de la fenêtre, ce qui ne fait aucun
    // trou — le graphe travaille sur les POSITIONS de `jours`, pas sur la
    // distance en calendrier. La spec passait au vert avec le pont dessiné
    // par-dessus comme en dessous, c'est-à-dire qu'elle n'assertait rien.
    const dates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04',
                   '2026-09-05', '2026-09-06'];
    const logs = {
      '2026-09-01': { weight: 62 },
      '2026-09-02': { weight: 62.4 },
      '2026-09-03': { weight: 62.8 },
      '2026-09-05': { weight: 63.5 },
      '2026-09-06': { weight: 63.2 },
    } as unknown as DailyLogs;

    const { container } = render(
      <DailyChart jours={jours(dates)} logs={logs} formePoints={[]} />,
    );
    const chemins = [...container.querySelectorAll('path')];
    const dernierPont = chemins.map(p => !!p.getAttribute('opacity')).lastIndexOf(true);
    const premierPlein = chemins.map(p => !p.getAttribute('opacity')).indexOf(true);

    expect(dernierPont).toBeLessThan(premierPlein);
  });
});

/** William, 15/09 : survoler un jour que le pont enjambe affichait la DERNIÈRE
 *  pesée (62.5 kg) — une valeur inventée pour un jour sans mesure. */
describe('DailyChart — la valeur d’un jour survolé', () => {
  function survoler(conteneur: HTMLElement, indice: number, total: number) {
    const svg = conteneur.querySelector('svg')!;
    const largeur = Number(svg.getAttribute('viewBox')!.split(' ')[2]);
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: largeur, height: 100 } as DOMRect);
    // Les pastilles des deux extrémités donnent l'abscisse des jours.
    const [premier, dernier] = [...conteneur.querySelectorAll('circle')].map(c => Number(c.getAttribute('cx')));
    const x = premier + ((dernier - premier) * indice) / (total - 1);
    svg.dispatchEvent(new MouseEvent('pointermove', { clientX: x, bubbles: true }));
  }

  it('un jour sans pesée dit « N/A », pas la dernière valeur', async () => {
    /** MUTATION QUI ROUGIT : revenir à `survolee ?? derniere`. */
    const dates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'];
    const logs = { '2026-09-01': { weight: 62 }, '2026-09-04': { weight: 64 } } as unknown as DailyLogs;
    const { container, findByText } = render(<DailyChart jours={jours(dates)} logs={logs} formePoints={[]} />);
    const valeur = () => container.querySelector('[data-valeur-survolee]')!.textContent;

    expect(valeur()).toContain('64.0 kg');          // au repos : la dernière pesée
    const { act } = await import('react');
    act(() => survoler(container, 1, dates.length));
    await findByText('2026-09-02');
    expect(valeur()).toContain('N/A');
    expect(valeur()).not.toContain('kg');

    act(() => survoler(container, 3, dates.length));
    await findByText('2026-09-04');
    expect(valeur()).toContain('64.0 kg');
  });
});
