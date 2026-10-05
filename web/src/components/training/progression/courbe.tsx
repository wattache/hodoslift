import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { useIsMobile } from '@/lib/use-mobile';
import type { ProgressionPoint } from '../exercise-progression-data';
import { kg, lireRepos, lireRpe, lireVolume, prescritQuitte, type Lecture } from './socle';

/** LE RENDU « COURBE » — la carte telle qu'elle est, et le défaut : une courbe
 *  qui porte les charges, puis les rangées Volume, RPE et Repos en
 *  « prescrit → réel », le prescrit en gris devant le réel. */

/** ⚠️ UNE SEULE GÉOMÉTRIE DE COLONNES, PARTAGÉE PAR LA COURBE ET LES RANGÉES
 *  (maquette 6a). Si le SVG divisait la largeur totale pendant que les rangées
 *  divisent ce qui reste après la gouttière, les points dériveraient — jusqu'à
 *  43 px sur S1. Ne jamais changer GOUTTIERE d'un seul côté. */
const GOUTTIERE = 48;   // px — le libellé de rangée
const cols = (n: number) => `${GOUTTIERE}px repeat(${n}, minmax(0, 1fr))`;

/** Centre de la i-ème colonne, en % de la piste. */
const abscisse = (i: number, n: number) => ((i + 0.5) / n) * 100;

/** ⚠️ CADRÉE SUR LES EXTRÊMES DU BLOC, PAS SUR ZÉRO. Un bloc de 7,5 à 15 kg sur
 *  une échelle partant de 0 donne un trait quasi plat. `sol` et `ciel` laissent
 *  la place aux étiquettes au-dessus du plus haut et au-dessous du plus bas.
 *  Les prescrits qui diffèrent entrent dans les bornes : leur point creux doit
 *  tenir dans la bande.
 *
 *  ⚠️ PLUS BASSE AU TÉLÉPHONE (William, 15/09 : « le graphe prend toujours pas
 *  mal de place »). Le pli déplié doit tenir dans l'écran ; la pente se lit
 *  aussi bien sur 36 px d'amplitude, et ce sont les CHIFFRES qui portent la
 *  valeur. La bande est en px (1 unité du viewBox = 1 px), donc les étiquettes
 *  se placent en px : la géométrie change d'un bloc, pas par un facteur. */
interface Geometrie { bande: number; sol: number; ciel: number; auDessus: number; dessous: number }
export const GEOMETRIE_ECRAN: Geometrie = { bande: 118, sol: 96, ciel: 30, auDessus: -24, dessous: 8 };
export const GEOMETRIE_TELEPHONE: Geometrie = { bande: 80, sol: 58, ciel: 24, auDessus: -22, dessous: 7 };

function echelleDesCharges(valeurs: number[], { sol, ciel }: Geometrie): ((v: number) => number) | null {
  if (valeurs.length === 0) return null;
  const min = Math.min(...valeurs), max = Math.max(...valeurs);
  if (min === max) return () => (sol + ciel) / 2;
  return (v: number) => sol - ((v - min) / (max - min)) * (sol - ciel);
}

/** LA COURBE DE CHARGE — le trait en SVG, les chiffres en HTML.
 *
 *  ⚠️ AUCUN <text> DANS CE SVG, ET C'EST STRUCTUREL. Le tracé a besoin de
 *  preserveAspectRatio="none" pour que ses abscisses tombent sur les colonnes ;
 *  ce même réglage étire le texte. Les valeurs sont des <span> posés en %.
 *
 *  ⚠️ LE TRACÉ SE COUPE SUR LES TROUS. Une semaine sans charge = le mouvement
 *  n'était pas programmé (FRE-114) ; relier inventerait une progression.
 *
 *  ⚠️ LES NOMBRES EXACTS SONT NON NÉGOCIABLES : on charge une barre avec de vrais
 *  disques. La courbe porte la valeur, elle ne la remplace jamais. */
function CourbeDeCharge({ points, courante }: { points: ProgressionPoint[]; courante: number }) {
  const n = points.length;
  const g = useIsMobile() ? GEOMETRIE_TELEPHONE : GEOMETRIE_ECRAN;
  const y = echelleDesCharges([
    ...points.map(p => p.kgEffective).filter((v): v is number => v !== null),
    ...points.filter(prescritQuitte).map(p => p.kg),
  ], g);

  const segments: string[] = [];
  let enCours: string[] = [];
  points.forEach((p, i) => {
    if (p.kgEffective === null || !y) { if (enCours.length > 1) segments.push(enCours.join(' ')); enCours = []; return; }
    enCours.push(`${abscisse(i, n)},${y(p.kgEffective)}`);
  });
  if (enCours.length > 1) segments.push(enCours.join(' '));

  return (
    <div className="grid" style={{ gridTemplateColumns: `${GOUTTIERE}px minmax(0, 1fr)` }}>
      <span />
      <div data-courbe className="relative" style={{ height: g.bande }}>
        {courante >= 0 && (
          <div className="absolute inset-y-0 bg-gold/10"
               style={{ left: `${(courante / n) * 100}%`, width: `${100 / n}%` }} />
        )}
        <svg viewBox={`0 0 100 ${g.bande}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
          <line x1="0" y1={g.sol} x2="100" y2={g.sol} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {y && points.map((p, i) => !prescritQuitte(p) ? null : (
            <line key={i} x1={abscisse(i, n)} y1={y(p.kg)} x2={abscisse(i, n)} y2={y(p.kgDone)}
                  stroke="var(--muted-foreground)" strokeWidth="1.2" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          ))}
          {segments.map((pts, i) => (
            <polyline key={i} points={pts} fill="none" stroke="var(--gold)" strokeWidth="2.6"
                      strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>

        {/* Les points sont en HTML aussi : un <circle> dans un SVG étiré devient une ellipse. */}
        {y && points.map((p, i) => {
          if (p.kgEffective === null) return null;
          const left = `${abscisse(i, n)}%`;
          const quitte = prescritQuitte(p);
          return (
            <span key={i}>
              {quitte && (
                <>
                  <span aria-hidden className="absolute h-[8px] w-[8px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.6px] border-muted-foreground bg-card"
                        style={{ left, top: y(p.kg) }} />
                  <span data-prescrit-charge className="absolute whitespace-nowrap font-mono text-[10px] tabular-nums text-muted-foreground"
                        style={{ left: `calc(${left} - 8px)`, top: y(p.kg), transform: 'translate(-100%, -50%)' }}>
                    {kg(p.kg)}
                  </span>
                </>
              )}
              <span aria-hidden className={cn("absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold",
                                              i === courante ? "h-[11px] w-[11px]" : "h-[8px] w-[8px]")}
                    style={{ left, top: y(p.kgEffective) }} />
            </span>
          );
        })}

        {/* LES CHIFFRES — au-dessus du point, ou dessous quand le prescrit est au-dessus. */}
        {points.map((p, i) => {
          const left = `${abscisse(i, n)}%`;
          if (p.kgEffective === null || !y) {
            // Sans charge : l'assistance (« RB15 ») est l'information du jour ; sinon un trou.
            const assistance = p.assistance.trim();
            return (
              <span key={i} data-valeur-charge={assistance ? true : undefined}
                    className={cn("absolute -translate-x-1/2 -translate-y-1/2 font-mono text-[13px]",
                                  assistance ? "text-gold" : "text-muted-foreground")}
                    style={{ left, top: (g.sol + g.ciel) / 2 }}>{assistance || "—"}</span>
            );
          }
          // ⚠️ CE QUI EST COLORÉ ET GRAS EST UN ÉCART AU PRESCRIT. Réel = consigne :
          // un chiffre en encre pleine, rien d'autre.
          const ecart = p.kgDone !== null && p.kgDone !== p.kg;
          const dessous = prescritQuitte(p) && p.kg > p.kgDone;
          return (
            <span key={i} data-valeur-charge
                  className={cn("absolute -translate-x-1/2 whitespace-nowrap font-mono leading-none tabular-nums",
                                i === courante ? "text-[14px] md:text-[16px]" : "text-[13px] md:text-[15px]",
                                ecart ? "font-semibold text-gold" : "text-foreground")}
                  style={{ left, top: y(p.kgEffective) + (dessous ? g.dessous : g.auDessus) }}>
              {kg(p.kgEffective)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** UNE RANGÉE DE LECTURE — « prescrit → réel » sur une ligne (William, 15/09).
 *
 *  Le prescrit s'écrit DEVANT le réel, en gris et plus petit : on le voit
 *  toujours, et le réel reste la valeur qui accroche l'œil. Égal à la consigne,
 *  il n'y a qu'un chiffre en encre pleine.
 *
 *  ⚠️ LES RÉELS PARTAGENT UNE LIGNE DE BASE (`last baseline`). Sur une colonne
 *  étroite, « 3×10/12 → » passe à la ligne au-dessus du réel ; aligner la
 *  DERNIÈRE ligne garde les réels de toutes les semaines sur le même trait — et
 *  c'est la semaine de l'écart, celle qu'on cherche, qui l'aurait cassé sinon.
 *
 *  ⚠️ gridColumn EXPLICITE SUR CHAQUE CELLULE : une cellule qui ne rend rien ne
 *  doit pas décaler les suivantes d'une semaine. */
function RangeeDeLecture({ libelle, points, lire, attribut }: {
  libelle: string;
  points: ProgressionPoint[];
  lire: (p: ProgressionPoint) => Lecture;
  /** Marque les cellules (`data-valeur-rpe`…) : des specs les visent. */
  attribut: string;
}) {
  return (
    <div className="grid" style={{ gridTemplateColumns: cols(points.length), alignItems: 'last baseline' }}>
      <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground"
            style={{ gridColumn: 1 }}>
        {libelle}
      </span>
      {points.map((p, i) => {
        const { reel, prescrit, ton, couleur } = lire(p);
        return (
          <span key={i} {...{ [attribut]: true }}
                className="text-center font-mono leading-[1.2] tabular-nums"
                style={{ gridColumn: i + 2 }}>
            {prescrit !== undefined && (
              <span className="text-[11px] text-muted-foreground">{prescrit} → </span>
            )}
            <span className={cn('whitespace-nowrap text-[15px]', ton ?? 'text-foreground')} style={{ color: couleur }}>
              {reel}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** LES RANGÉES DE LECTURE — une donnée, pas des appels écrits à la main.
 *  La charge n'est PAS ici : elle vit dans la courbe, qui porte ses valeurs.
 *  Le repos ne s'affiche que si une semaine en porte un, prescrit ou pris. */
const LIGNES = [
  { cle: 'volume', libelle: 'progression.volume', lire: lireVolume, attribut: 'data-valeur-volume', montrer: () => true },
  { cle: 'rpe', libelle: 'base.rpe', lire: lireRpe, attribut: 'data-valeur-rpe', montrer: () => true },
  { cle: 'repos', libelle: 'progression.repos', lire: lireRepos, attribut: 'data-valeur-repos',
    montrer: (points: ProgressionPoint[]) => points.some(p => p.rest.trim() || p.restActual.trim()) },
] as const;

export function RenduCourbe({ points, courante }: { points: ProgressionPoint[]; courante: number }) {
  const { t } = useTranslation();
  const aDesCharges = points.some(p => p.kgEffective !== null || p.assistance.trim());
  /* ⚠️ LA HAUTEUR NE DÉPEND PAS DU NOMBRE DE SEMAINES : le pli déplié tient dans
     l'écran du téléphone quelle que soit la longueur du bloc. Trois unités,
     trois traitements : la charge est un NIVEAU (une courbe), le volume un
     COMPTE (du texte), le RPE une CATÉGORIE ORDONNÉE (un chiffre coloré). */
  return (
    <>
      {aDesCharges && <CourbeDeCharge points={points} courante={courante} />}
      {/* Les semaines, sur la MÊME géométrie que la courbe. */}
      <div className="grid border-b border-border pb-1.5" style={{ gridTemplateColumns: cols(points.length) }}>
        <span style={{ gridColumn: 1 }} />
        {points.map((p, i) => (
          <span key={i} data-semaine
                className={cn('text-center font-mono text-[11px]',
                              i === courante ? 'font-semibold text-gold' : 'text-muted-foreground')}
                style={{ gridColumn: i + 2 }}>
            {p.label}
          </span>
        ))}
      </div>
      {LIGNES.filter((l) => l.montrer(points)).map((l) => (
        <RangeeDeLecture key={l.cle} libelle={t(l.libelle)} points={points} lire={l.lire} attribut={l.attribut} />
      ))}
    </>
  );
}
