import type { DailyLogs } from '@/api/types';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { PointForme } from '@/api/types';
import { cheminAdouci, cheminDroit, suitesEtPonts } from '@/lib/courbe';
import { PHASES, couleurDePhase } from '@/lib/cycle';
import { FORME_MAX, FORME_MIN } from '@/lib/forme-du-jour';
import { cn } from '@/lib/utils';

/** LE graphe journalier — UNE mesure à la fois, choisie en haut.
 *
 *  Il remplace quatre cartes-sparkline et celle de la forme du jour.
 *
 *  ⚠️ POURQUOI PAS LES CINQ COURBES ENSEMBLE. Première version essayée, puis
 *  jetée : 62 kg, 7 h, 2 L, 2 300 kcal et une forme sur 5 n'ont pas d'échelle
 *  commune. Les superposer oblige à normaliser, donc à retirer l'axe chiffré
 *  (il serait faux), donc à réinjecter les valeurs réelles dans une légende et
 *  une infobulle — beaucoup de mécanique pour un graphe qu'on lit mal. Le
 *  double axe, lui, est pire : il fabrique des croisements qui ne veulent rien
 *  dire, puisque bouger une échelle change qui passe au-dessus de qui.
 *
 *  Une mesure à la fois, c'est un vrai axe avec de vraies valeurs. Et le
 *  sélecteur tient lieu de titre : à série unique, pas de légende à porter. */

interface Props {
  /** Une entrée par jour de la fenêtre, trous compris. */
  jours: { date: string }[];
  // LE TYPE DU CONTRAT, pas une redescription : `DailyLogs` vient de l'OpenAPI
  // de brokkr (FRE-70). Recopier la forme ici la ferait diverger en silence —
  // c'est exactement ce que le ticket cherche à supprimer.
  logs: DailyLogs;
  /** La courbe de forme, servie par brokkr et déjà datée (FRE-119). Ce
   *  composant en faisait la moyenne par jour à partir de l'arbre entier. */
  formePoints: PointForme[];
}

type Cle = 'weight' | 'sleep' | 'water' | 'calories' | 'form';

/** Une couleur par mesure, la même partout sur la page (la carte de saisie les
 *  reprend). Jetons `--serie-*` validés — cf. `index.css`. */
const MESURES: { key: Cle; labelKey: string; unit: string; color: string; decimals: number }[] = [
  { key: 'weight',   labelKey: 'tracker.weight',   unit: 'kg',            color: 'var(--serie-poids)',    decimals: 1 },
  { key: 'sleep',    labelKey: 'tracker.sleep',    unit: 'h',             color: 'var(--serie-sommeil)',  decimals: 1 },
  { key: 'water',    labelKey: 'tracker.water',    unit: 'L',             color: 'var(--serie-eau)',      decimals: 1 },
  { key: 'calories', labelKey: 'tracker.calories', unit: 'kcal',          color: 'var(--serie-calories)', decimals: 0 },
  { key: 'form',     labelKey: 'week.formeDuJour', unit: `/${FORME_MAX}`, color: 'var(--serie-forme)',    decimals: 1 },
];

const W = 900;
const H = 240;
const PAD = { top: 16, right: 16, bottom: 26, left: 52 };

export function DailyChart({ jours, logs, formePoints }: Props) {
  const { t } = useTranslation();
  const [cle, setCle] = useState<Cle>('weight');
  const [survol, setSurvol] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const mesure = MESURES.find(m => m.key === cle)!;

  const table = useMemo(() => {
    // `| null` : le contrat rend ces mesures nullables (FRE-70), et la carte les
    // porte telles quelles. Les convertir ici mélangerait « pas saisi » et « zéro ».
    const parDate = new Map<string, Partial<Record<Cle, number | null>>>();
    for (const j of jours) parDate.set(j.date, { ...logs[j.date] });
    // Plusieurs séances le même jour (ou repliées au même lundi) : on garde la
    // MOYENNE. Prendre la première ferait dépendre le graphe de l'ordre des
    // séances, ce qui n'a aucun sens pour une « forme du jour ».
    const paquets = new Map<string, number[]>();
    for (const p of formePoints) {
      paquets.set(p.date, [...(paquets.get(p.date) ?? []), p.form]);
    }
    for (const [date, formes] of paquets) {
      const ligne = parDate.get(date);
      if (ligne) ligne.form = formes.reduce((a, b) => a + b, 0) / formes.length;
    }
    return jours.map(j => ({ date: j.date, ...parDate.get(j.date) }));
  }, [jours, logs, formePoints]);

  const { min, max, valeurs } = useMemo(() => {
    const vals = table.map(r => r[cle]).filter((v): v is number => typeof v === 'number');
    // La forme garde son échelle ABSOLUE : elle est bornée par nature, et
    // l'étirer sur son min/max ferait passer « 3 puis 4 » pour une envolée.
    if (cle === 'form') return { min: FORME_MIN, max: FORME_MAX, valeurs: vals };
    if (!vals.length) return { min: 0, max: 1, valeurs: vals };
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    // Un peu d'air, et jamais un intervalle nul (une valeur constante tracerait
    // une ligne collée au bord haut).
    const marge = (hi - lo) * 0.15 || Math.max(Math.abs(hi) * 0.05, 1);
    return { min: lo - marge, max: hi + marge, valeurs: vals };
  }, [table, cle]);

  const x = (i: number) =>
    PAD.left + (i * (W - PAD.left - PAD.right)) / Math.max(1, table.length - 1);
  const y = (v: number) =>
    PAD.top + (1 - (v - min) / (max - min || 1)) * (H - PAD.top - PAD.bottom);

  /** Les suites OBSERVÉES, adoucies — et les PONTS qui les relient, droits et
   *  plus clairs.
   *
   *  ⚠️ LE TRACÉ ÉTAIT BRISÉ SUR CHAQUE TROU, et l'intention était juste : relier
   *  deux pesées séparées d'une semaine inventerait une progression qu'on n'a pas
   *  observée. Mais la conséquence l'était moins — sur 90 jours, 34 % des paires
   *  de pesées sont des ponts (largeur moyenne 7,8 jours, la plus large 48) et la
   *  courbe devenait un archipel où l'œil ne suit plus rien. Or la tendance est
   *  exactement ce qu'on vient lire ici.
   *
   *  ⚠️ LE PONT EST DROIT QUAND LE RESTE EST ADOUCI, et ce n'est pas une
   *  coquetterie : c'est ce qui garde l'information du trou. Sa rectitude dit
   *  qu'aucune mesure ne vit là — un pont adouci imiterait la forme des données
   *  observées, et mentirait deux fois. L'opacité réduite le redit en couleur ;
   *  sur le poids, `--serie-poids` est à la teinte de `--gold`, donc « or plus
   *  clair » (refonte des écrans, 09/2026). */
  const { traces, pontsTraces } = useMemo(() => {
    const { suites, ponts } = suitesEtPonts(table.map(r => r[cle]));
    const pt = (i: number) => ({ x: x(i), y: y(table[i][cle] as number) });
    return {
      traces: suites.filter(s => s.length > 1).map(s => cheminAdouci(s.map(pt))),
      pontsTraces: ponts.map(([a, b]) => cheminDroit([pt(a), pt(b)])),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, cle, min, max]);

  /** ⚠️ LES POINTS ISOLÉS SE DESSINENT À PART, SINON ILS SONT INVISIBLES.
   *  Un sous-tracé réduit à un `moveto` ne peint rien, même avec
   *  `strokeLinecap="round"`. Ce n'est pas un cas de bord : la forme du jour
   *  vient des séances — jamais deux jours de suite — et les calories se
   *  saisissent quand on y pense. Vu à l'écran avant correction, la forme
   *  produisait 3 sous-tracés d'UN point et n'affichait rien du tout. */
  const isoles = useMemo(
    () =>
      table.flatMap((r, i) => {
        const v = r[cle];
        if (typeof v !== 'number') return [];
        const seul =
          typeof table[i - 1]?.[cle] !== 'number' && typeof table[i + 1]?.[cle] !== 'number';
        return seul ? [{ i, v }] : [];
      }),
    [table, cle],
  );

  /** LA PHASE DU CYCLE EN FOND, PAS EN COURBE (FRE-173). Ce n'est pas une
   *  mesure : c'est le contexte dans lequel on lit la mesure choisie — « ma forme
   *  baisse-t-elle pendant mes règles ? ». Une bande par jour déclaré, dans la
   *  couleur de la phase ; un jour sans déclaration ne colore rien. */
  const bandes = useMemo(() => {
    const demi = (W - PAD.left - PAD.right) / Math.max(1, table.length - 1) / 2;
    return jours.flatMap((j, i) => {
      const phase = logs[j.date]?.cycle;
      return phase ? [{ i, phase, x0: Math.max(PAD.left, x(i) - demi), x1: Math.min(W - PAD.right, x(i) + demi) }] : [];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jours, logs, table.length]);
  const phasesPresentes = PHASES.filter(p => bandes.some(b => b.phase === p.value));

  const pointe = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const ratio = (e.clientX - box.left) / box.width;
    const i = Math.round(((ratio * W - PAD.left) / (W - PAD.left - PAD.right)) * (table.length - 1));
    setSurvol(Math.max(0, Math.min(table.length - 1, i)));
  };

  const fmt = (v: number) => v.toFixed(mesure.decimals);
  const survolee = survol != null ? table[survol]?.[cle] : undefined;
  const derniere = valeurs[valeurs.length - 1];

  return (
    <section className="rounded-xl border border-border/80 bg-card p-4 shadow-[0_16px_42px_rgba(0,0,0,0.16)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {/* Le sélecteur tient lieu de titre. */}
        <div className="flex flex-wrap gap-1">
          {MESURES.map(m => (
            <button
              key={m.key}
              type="button"
              aria-pressed={m.key === cle}
              onClick={() => { setCle(m.key); setSurvol(null); }}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                m.key === cle ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              <span className="h-0.5 w-3 rounded-full" style={{ background: m.color }} />
              {t(m.labelKey)}
            </button>
          ))}
        </div>
        {/* ⚠️ UN JOUR SURVOLÉ SANS MESURE DIT « N/A », pas la dernière valeur
            (William, 15/09). Le repli `survolee ?? derniere` faisait lire 62.5 kg
            sur chaque jour que le pont enjambe : une pesée inventée, là où il n'y
            en a pas eu. Le pont relie deux mesures, il n'en crée aucune. */}
        <span className="font-mono text-sm tabular-nums" data-valeur-survolee>
          {survol != null
            ? (survolee != null ? `${fmt(survolee)} ${mesure.unit}` : t('tracker.nonMesure'))
            : derniere != null ? `${fmt(derniere)} ${mesure.unit}` : '—'}
          {survol != null && table[survol] && (
            <span className="ml-2 text-[11px] text-muted-foreground">{table[survol].date}</span>
          )}
        </span>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="h-56 w-full touch-none sm:h-64"
        onPointerMove={pointe}
        onPointerLeave={() => setSurvol(null)}
      >
        {/* Le fond d'abord : sous l'axe, sous les courbes. */}
        {bandes.map(b => (
          <rect key={b.i} x={b.x0} y={PAD.top} width={b.x1 - b.x0} height={H - PAD.top - PAD.bottom}
                fill={couleurDePhase(b.phase)} opacity="0.14" />
        ))}

        {/* Axe vertical CHIFFRÉ — c'est tout l'intérêt d'une série à la fois. */}
        {[0, 0.5, 1].map(r => {
          const v = max - r * (max - min);
          const yy = PAD.top + r * (H - PAD.top - PAD.bottom);
          return (
            <g key={r}>
              <line x1={PAD.left} x2={W - PAD.right} y1={yy} y2={yy}
                    stroke="var(--border)" strokeWidth="1" opacity={r === 1 ? 0.9 : 0.35} />
              <text x={PAD.left - 8} y={yy + 4} textAnchor="end"
                    className="fill-muted-foreground text-[11px] tabular-nums">
                {fmt(v)}
              </text>
            </g>
          );
        })}

        {survol != null && (
          <line x1={x(survol)} x2={x(survol)} y1={PAD.top} y2={H - PAD.bottom}
                stroke="var(--muted-foreground)" strokeWidth="1" opacity="0.5" />
        )}

        {/* Les ponts SOUS les suites observées : à un point de raccord, c'est le
            trait plein qui doit rester dessus. */}
        {pontsTraces.map((d, k) => (
          <path key={`pont${k}`} d={d} fill="none" stroke={mesure.color} strokeWidth="2"
                strokeLinecap="round" opacity="0.35" />
        ))}

        {traces.map((d, k) => (
          <path key={k} d={d} fill="none" stroke={mesure.color} strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" />
        ))}

        {isoles.map(({ i, v }) => (
          <circle key={i} cx={x(i)} cy={y(v)} r="3" fill={mesure.color} />
        ))}

        {survolee != null && survol != null && (
          <circle cx={x(survol)} cy={y(survolee)} r="4.5" fill={mesure.color}
                  stroke="var(--card)" strokeWidth="2" />
        )}

        {[0, Math.floor(table.length / 2), table.length - 1].map(i => (
          <text key={i} x={x(i)} y={H - 8}
                textAnchor={i === 0 ? 'start' : i === table.length - 1 ? 'end' : 'middle'}
                className="fill-muted-foreground text-[11px]">
            {table[i]?.date.slice(5).replace('-', '/')}
          </text>
        ))}
      </svg>

      {/* La légende des phases n'apparaît que si une bande est tracée : sans
          déclaration, rien à expliquer. */}
      {phasesPresentes.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground" aria-label={t('tracker.cycle')}>
          {phasesPresentes.map(p => (
            <li key={p.value} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: p.color, opacity: 0.6 }} />
              {t(p.labelKey)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
