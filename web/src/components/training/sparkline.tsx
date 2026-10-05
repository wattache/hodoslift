import { cheminAdouci, type Point } from "@/lib/courbe";

/** Mini sparkline SVG. Même rendu que FormSparkline ; réutilisée par
 *  la progression d'exercice, l'historique BASE et le tableau du bloc. Renvoie
 *  null si moins de 2 points chiffrés.
 *
 *  ⚠️ PAR DÉFAUT, UN `null` EST IGNORÉ ET LE TRAIT SE REFERME PAR-DESSUS. C'est
 *  le comportement d'origine, et il convient là où un trou est une absence de
 *  mesure sans importance pour la tendance.
 *
 *  ⚠️ MAIS `couperLesTrous` EXISTE POUR LE TABLEAU DU BLOC (FRE-114), où c'est
 *  l'inverse. Un trou y signifie « ce mouvement n'était pas prescrit cette
 *  semaine-là » — la S3 de FRE-150 — et c'est précisément ce que l'écran est
 *  fait pour montrer. Le relier tracerait une progression continue là où la
 *  série s'interrompt, c'est-à-dire le contresens exact.
 *
 *  Opt-in plutôt que changement global : les deux autres appelants ont leur
 *  raison de refermer le trait, et ce n'est pas à cet écran de trancher pour
 *  eux. */
export function Sparkline({
  values,
  tone,
  className = "h-5 w-full",
  couperLesTrous = false,
}: {
  values: (number | null)[];
  tone: string;
  className?: string;
  couperLesTrous?: boolean;
}) {
  const w = 120;
  const h = 22;
  const pad = 2;
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  // X au CENTRE de chaque colonne ((i+0.5)/N) : la sparkline occupe la largeur
  // des N colonnes du tableau, dont les valeurs sont centrées → les points
  // tombent pile sous les chiffres (sinon ils s'étalaient bord-à-bord).
  const xAt = (i: number) => ((i + 0.5) / values.length) * w;
  const point = (v: number, i: number): Point => ({
    x: xAt(i),
    y: pad + ((max - v) / span) * (h - pad * 2),
  });

  // Un segment par suite de points CONSÉCUTIFS présents. Sans coupure il n'y en
  // a qu'un, qui enjambe les trous — le comportement historique.
  const segments: Point[][] = [];
  let courant: Point[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (!couperLesTrous) return;
      if (courant.length > 1) segments.push(courant);
      courant = [];
      return;
    }
    courant.push(point(v, i));
  });
  if (courant.length > 1) segments.push(courant);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} preserveAspectRatio="none">
      {segments.map((pts, i) => (
        <path key={i} d={cheminAdouci(pts)} fill="none" stroke={tone} strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}
