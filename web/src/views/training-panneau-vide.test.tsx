// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import { PanneauSansSemaine } from './training';

await i18next.changeLanguage('fr');

/** LE PANNEAU VIDE DU 22/08 — FRE-93.
 *
 *  ⚠️ CE DÉFAUT A ÉTÉ TROUVÉ À L'ŒIL, DANS LE NAVIGATEUR. Un bloc neuf ne crée
 *  plus de semaine 1 (décision produit du 22/08) ; le panneau de droite servait
 *  alors « Sélectionne une semaine dans le programme » — une consigne impossible
 *  à suivre, exactement au moment où le coach découvre le nouveau comportement.
 *  Et il n'a été vu que parce qu'on a re-regardé après un premier passage
 *  interrompu. Aucun test ne l'a signalé, et aucun n'aurait pu : la branche
 *  vivait au fond d'une vue de 400 lignes, derrière une dizaine de hooks.
 *
 *  ⚠️ CE QUE CE FICHIER GARDE N'EST PAS « un texte s'affiche », c'est QU'ON NE
 *  DONNE PAS UNE CONSIGNE IMPOSSIBLE. Les deux vides se ressemblent à l'écran et
 *  ne se ressemblent pas du tout pour la personne qui les lit : dans l'un il y a
 *  quelque chose à sélectionner, dans l'autre il n'y a rien.
 */
afterEach(cleanup);

describe('les trois vides ne disent pas la même chose', () => {
  it('bloc sans aucune semaine : on dit comment en obtenir une', () => {
    render(<PanneauSansSemaine blocSansSemaine />);
    expect(screen.getByText(/n’a pas encore de semaine/)).toBeTruthy();
    // ⚠️ L'ASSERTION QUI PORTE LE FICHIER : la consigne impossible ne doit pas
    // reparaître. Sans elle, inverser le booléen laisserait la spec verte.
    expect(screen.queryByText(/Sélectionne une semaine/)).toBeNull();
  });

  it('des semaines existent mais aucune n’est choisie : on invite à choisir', () => {
    render(<PanneauSansSemaine blocSansSemaine={false} />);
    expect(screen.getByText(/Sélectionne une semaine/)).toBeTruthy();
    expect(screen.queryByText(/n’a pas encore de semaine/)).toBeNull();
  });

  it('le message du bloc neuf NOMME les deux gestes possibles', () => {
    // Il ne suffit pas de constater le vide : le coach doit savoir quoi faire, et
    // il y a deux chemins (générer depuis la BASE, ou ajouter à la main).
    render(<PanneauSansSemaine blocSansSemaine />);
    const texte = screen.getByText(/n’a pas encore de semaine/).textContent ?? '';
    expect(texte).toMatch(/BASE/);
    expect(texte).toMatch(/\+ Semaine/);
  });

  /* ── LE TROISIÈME VIDE, ajouté avec le hors-ligne (FRE-118) ───────────────
   *
   * ⚠️ C'EST LE PLUS TROMPEUR DES TROIS. Hors ligne, un bloc jamais ouvert n'a
   * simplement pas de contenu en cache : il ressemble trait pour trait à un bloc
   * neuf. On lui aurait donc dit de « composer la BASE » alors que ses douze
   * semaines existent, à l'autre bout d'un réseau absent — et le coach aurait pu
   * les recréer par-dessus.
   *
   * C'est la même faute que celle du 22/08, d'un cran plus grave : là on donnait
   * une consigne impossible, ici on en donne une DESTRUCTRICE. */
  it('hors ligne, on ne dit PAS que le bloc n’a pas de semaine', () => {
    render(<PanneauSansSemaine blocSansSemaine horsLigne />);
    expect(screen.queryByText(/n’a pas encore de semaine/)).toBeNull();
    expect(screen.queryByText(/Sélectionne une semaine/)).toBeNull();
  });

  it('hors ligne, on dit POURQUOI c’est vide et quoi faire', () => {
    render(<PanneauSansSemaine blocSansSemaine horsLigne />);
    const texte = screen.getByText(/hors ligne/).textContent ?? '';
    // Le constat — les séances existent, elles ne sont pas ici.
    expect(texte).toMatch(/serveur/);
    // Et les deux sorties : un bloc déjà consulté, ou le réseau.
    expect(texte).toMatch(/déjà consulté/);
    expect(texte).toMatch(/reconnecte/i);
  });

  it('EN LIGNE, le hors-ligne ne se déclenche pas', () => {
    // Le défaut symétrique : un panneau qui invoquerait le réseau alors qu'il est
    // là ferait chercher une panne inexistante.
    render(<PanneauSansSemaine blocSansSemaine />);
    expect(screen.getByText(/n’a pas encore de semaine/)).toBeTruthy();
  });
});
