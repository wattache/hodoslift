// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18next from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';
import { FicheAthlete } from './fiche-athlete';
import type { Athlete } from '@/api/types';

await i18next.changeLanguage('fr');

/** LE FRONT NE PROPOSE PAS UNE ÉCRITURE QUE BROKKR REFUSE — FRE-131.
 *
 *  ⚠️ L'EMAIL D'UNE FICHE LIÉE EST FIGÉ CÔTÉ SERVEUR (409
 *  `email_fige_par_le_compte`), parce que c'est ce champ qui décide QUI est
 *  propriétaire de la fiche, donc qui lit les bilans kiné. Le coach pouvait y
 *  écrire sa propre adresse, se connecter avec un second compte Google, et
 *  devenir owner.
 *
 *  ⚠️ ET LE CHAMP RESTE LIBRE AVANT LIAISON, ce qui n'est pas un détail : la
 *  correction d'email est le geste d'ONBOARDING le plus courant — mesuré sur 30
 *  jours d'audit, les trois seules écritures d'email précédaient toutes la
 *  liaison, l'une de 72 secondes. Un gel appliqué partout aurait cassé le
 *  parcours normal pour fermer une faille qui ne vit qu'après.
 *
 *  Les deux cas sont donc éprouvés ensemble : sans le témoin, un `readOnly`
 *  posé en dur passerait au vert.
 */
afterEach(cleanup);

const patch = vi.fn();
vi.mock('@/api/hooks/use-athletes', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  usePatchAthleteProfile: () => ({ mutate: patch }),
  useSetAthleteKine: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/api/hooks/use-users', () => ({ useKines: () => ({ data: [] }) }));

const athlete = (linkedUserId: string | null): Athlete => ({
  id: 'a1', firstName: 'Bob', lastName: 'Martin', email: 'bob@x.com',
  linkedUserId, coachId: 'coach-1', programId: 'p1',
  gender: 'M', height: 180, weight: 80, age: 30, birthDate: '1996-03-14', currentOneRM: {},
} as Athlete);

/** La fiche est une page (onglet Profil, 27/09) : les champs sont là d'emblée. */
function ouvrir(a: Athlete) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <FicheAthlete athlete={a} canManage />
    </QueryClientProvider>,
  );
  return screen.getByLabelText('Email') as HTMLInputElement;
}

describe('le champ Email du profil athlète', () => {
  it('⚠️ EST FIGÉ, ET DIT POURQUOI, quand la fiche porte un compte', () => {
    const champ = ouvrir(athlete('bob-uid'));

    // `toBeDisabled` est un matcher jest-dom, absent du projet — et on ne va pas
    // ajouter une dépendance pour un booléen que le DOM porte déjà.
    expect(champ.disabled).toBe(true);

    // ⚠️ LE TEXTE EST LA MOITIÉ DU CORRECTIF (leçon de FRE-138) : un champ grisé
    // sans explication fait chercher une panne. Il est traduit, pas en dur.
    expect(screen.getByText(i18next.t('profile.emailVientDuCompte'))).toBeTruthy();

    // Et rien ne part : le blur ne doit même pas tenter l'écriture.
    patch.mockClear();
    fireEvent.change(champ, { target: { value: 'coach@pirate.com' } });
    fireEvent.blur(champ);
    expect(patch).not.toHaveBeenCalled();
  });

  it('reste ÉCRIVABLE tant que la fiche n’a pas de compte — le geste d’onboarding', () => {
    const champ = ouvrir(athlete(null));

    expect(champ.disabled).toBe(false);
    expect(screen.queryByText(i18next.t('profile.emailVientDuCompte'))).toBeNull();

    patch.mockClear();
    fireEvent.change(champ, { target: { value: 'bob.corrige@x.com' } });
    fireEvent.blur(champ);
    expect(patch).toHaveBeenCalledWith(
      { athleteId: 'a1', patch: { email: 'bob.corrige@x.com' } },
      expect.anything(),
    );
  });
});

/** FRE-168 — ⚠️ LE PANNEAU SAISIT UNE DATE, JAMAIS UN ÂGE. L'âge est calculé
 *  par brokkr ; un `age` envoyé serait ignoré par le serveur, et la saisie du
 *  coach se perdrait sans bruit. « Effacer » envoie `''`, que brokkr lit comme
 *  « effacer » (le patch écarte les `null`).
 *
 *  ⚠️ ET CE N'EST PAS UN `<input type="date">` : son icône de calendrier est
 *  noire, invisible sur le fond sombre (William, 18/09). C'est le `DatePicker`
 *  de l'app ; le choix d'un jour se prouve sur le harnais réel. */
describe('la date de naissance du profil athlète', () => {
  it('affiche la date servie dans le sélecteur de l’app, et « Effacer » envoie `""`', () => {
    ouvrir(athlete(null));
    expect(document.querySelector('input[type="date"]')).toBeNull();
    const declencheur = screen.getByTitle(i18next.t('profile.dateDeNaissance'));
    expect(declencheur.textContent).toMatch(/1996/);
    expect(screen.queryByLabelText(/^âge/i)).toBeNull();

    patch.mockClear();
    fireEvent.click(screen.getByRole('button', { name: i18next.t('profile.effacerLaDate') }));
    expect(patch).toHaveBeenLastCalledWith(
      { athleteId: 'a1', patch: { birthDate: '' } }, expect.anything());
  });
});
