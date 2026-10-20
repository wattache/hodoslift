import { ajouterJours, jourDeLaSemaine, type BandeDeBloc, type EvenementDeFrise, type ISO } from '@/lib/frise-periodisation';

/** LE MOIS — six semaines au plus, du lundi au dimanche, jours des mois voisins
 *  compris pour remplir la grille. Les jours sont calendaires (`frise-periodisation`),
 *  sans fuseau. */
export function semainesDuMois(mois: ISO): ISO[][] {
  const premier = `${mois.slice(0, 7)}-01`;
  const debut = ajouterJours(premier, -jourDeLaSemaine(premier));
  const semaines: ISO[][] = [];
  for (let jour = debut; jour.slice(0, 7) <= mois.slice(0, 7) || semaines.length === 0; ) {
    const semaine = Array.from({ length: 7 }, (_, i) => ajouterJours(jour, i));
    semaines.push(semaine);
    jour = ajouterJours(jour, 7);
    if (semaines.length === 6) break;
  }
  return semaines;
}

/** Le mois voisin, au premier du mois. */
export function moisVoisin(mois: ISO, sens: 1 | -1): ISO {
  const [a, m] = mois.split('-').map(Number);
  const total = a * 12 + (m - 1) + sens;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`;
}

/** Le bloc qui couvre ce jour — le premier trouvé quand deux se chevauchent :
 *  la frise montre le chevauchement, la case d'un jour n'a la place que d'un. */
export function blocDuJour(jour: ISO, blocs: BandeDeBloc[]): BandeDeBloc | null {
  return blocs.find(b => b.debut <= jour && jour <= b.fin) ?? null;
}

/** Les évènements qui touchent ce jour, compétitions d'abord. */
export function evenementsDuJour(jour: ISO, evenements: EvenementDeFrise[]): EvenementDeFrise[] {
  return evenements
    .filter(e => e.debut <= jour && jour <= e.fin)
    .sort((a, b) => (a.nature === b.nature ? 0 : a.nature === 'competition' ? -1 : 1));
}
