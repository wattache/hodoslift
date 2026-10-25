import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTracking } from '@/api/hooks/use-tracking';
import type { TrackingResponse, TrackingWeek } from '@/api/types';
import i18n from '@/i18n';
import { bandesDeBloc, libelleDeBande } from '@/lib/bandes-de-bloc';
import { cheminAdouci } from '@/lib/courbe';
import {
  COULEURS_DE_SUIVI, debutEtFin, fenetresSansMesure, graduations, reperes, suitesMesurees,
} from '@/lib/progression-tracker';
import { cn } from '@/lib/utils';

/** LA PROGRESSION D'UN MOUVEMENT, fondue dans le Tracker (William, 25/10) : six
 *  cartes de même poids, une mesure et une couleur chacune, les bandes de bloc
 *  pour seul repère commun — et « même charge, même format », le travail refait
 *  à l'identique où seul le RPE change.
 *
 *  ⚠️ RIEN N'EST RECALCULÉ ICI depuis l'arbre : le 1RM estimé, l'intensité, les
 *  séries lourdes et les travaux refaits viennent de brokkr avec le reste du
 *  suivi (la même requête que Charge & RPE, donc déjà en cache). Ce composant
 *  dessine, compare huit semaines à huit, et c'est tout.
 *
 *  ⚠️ `null` EST UN TROU, PAS UN ZÉRO. Une courbe se coupe dessus, la fenêtre
 *  sans mesure se dessine en tireté, et la raison s'écrit — « pas de série de
 *  compétition », pas « arrêtée » : le muscle up de la vraie donnée n'a que du
 *  NO DIPS, du tempo et du CHEST depuis le 31/08, et l'écran a raison de se
 *  taire, à condition de dire pourquoi. */

type Raison = NonNullable<TrackingWeek['e1Raison']>;

type Mesure = {
  cle: 'e1' | 'intensite' | 'lourdes' | 'tonnage' | 'volume' | 'rpe';
  forme: 'ligne' | 'barres';
  couleur: string;
  /** Les barres partent de zéro ; une courbe se cadre sur ses valeurs. */
  depuisZero: boolean;
  valeur: (w: TrackingWeek) => number | null;
  decimales: number;
  /** « meilleur » n'a pas de sens pour un RPE : un seul repère, le dernier. */
  sens: 'haut' | 'aucun';
  /** Les cartes du 1RM : la fenêtre sans mesure se dessine et se nomme. */
  avecFenetre: boolean;
};

/** ⚠️ SIX CARTES DE MÊME TAILLE ET MÊME POIDS — choix de William, assumé :
 *  aucune ne mène, on lit la grille. Les teintes sont celles de Charge & RPE,
 *  une par carte, jamais deux dans un même tracé : le validateur de palette les
 *  refuse comme jeu catégoriel, et c'est ce que le refus annonce. */
const MESURES: Mesure[] = [
  { cle: 'e1', forme: 'ligne', couleur: COULEURS_DE_SUIVI.intensite, depuisZero: false,
    valeur: w => w.e1Kg, decimales: 1, sens: 'haut', avecFenetre: true },
  { cle: 'intensite', forme: 'ligne', couleur: COULEURS_DE_SUIVI.intensite, depuisZero: false,
    valeur: w => w.intensite, decimales: 0, sens: 'haut', avecFenetre: true },
  { cle: 'lourdes', forme: 'barres', couleur: COULEURS_DE_SUIVI.lourd, depuisZero: true,
    valeur: w => w.lourdes, decimales: 0, sens: 'haut', avecFenetre: false },
  { cle: 'tonnage', forme: 'barres', couleur: COULEURS_DE_SUIVI.volume, depuisZero: true,
    valeur: w => w.tonnageTotalKg, decimales: 0, sens: 'haut', avecFenetre: false },
  { cle: 'volume', forme: 'barres', couleur: COULEURS_DE_SUIVI.volume, depuisZero: true,
    valeur: w => w.repsTotal, decimales: 0, sens: 'haut', avecFenetre: false },
  { cle: 'rpe', forme: 'ligne', couleur: COULEURS_DE_SUIVI.rpe, depuisZero: false,
    valeur: w => w.feltRpe, decimales: 1, sens: 'aucun', avecFenetre: false },
];

const nombre = (v: number, decimales = 0): string =>
  v.toLocaleString(i18n.language, { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
const signe = (v: number, decimales = 0): string =>
  `${v > 0 ? '+' : v < 0 ? '−' : ''}${nombre(Math.abs(v), decimales)}`;
const jour = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });

/* ------------------------------------------------------------------------- *
 * Le dessin d'une carte
 * ------------------------------------------------------------------------- */

// Le viewBox est ÉTIRÉ (`preserveAspectRatio="none"`) : les formes se placent
// en unités, les traits gardent leur épaisseur (`vector-effect`), et tout ce
// qui est du texte ou un rond vit en HTML par-dessus, placé en pourcentage.
const VW = 1000;
const VH = 100;
const PAD_T = 12;
const PAD_B = 2;
const INNER_H = VH - PAD_T - PAD_B;

function Graphe({ weeks, mesure, texteFenetre, aria }: {
  weeks: TrackingWeek[]; mesure: Mesure; texteFenetre: string; aria: string;
}) {
  const n = weeks.length;
  const valeurs = weeks.map(mesure.valeur);
  const [lo, mid, hi] = graduations(valeurs, mesure.depuisZero);
  const slot = VW / Math.max(n, 1);
  const x = (i: number) => slot * (i + 0.5);
  const y = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * INNER_H;
  const pct = (unites: number, total: number) => `${(100 * unites) / total}%`;
  const bandes = bandesDeBloc(weeks);
  const fenetres = mesure.avecFenetre ? fenetresSansMesure(valeurs) : [];
  const suites = suitesMesurees(valeurs);
  const points = reperes(valeurs, mesure.sens);
  const barW = Math.max(slot * 0.55, slot - 5);

  return (
    <div className="grid grid-cols-[30px_minmax(0,1fr)] gap-1">
      {/* Les graduations : trois nombres ronds, en retrait. */}
      <div className="relative font-mono text-[9px] text-muted-foreground" aria-hidden>
        {[hi, mid, lo].map((g) => (
          <span key={g} className="absolute right-0 -translate-y-1/2" style={{ top: pct(y(g), VH) }}>
            {nombre(g, g % 1 === 0 ? 0 : 1)}
          </span>
        ))}
      </div>
      <div className="relative h-[124px]">
        <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" role="img" aria-label={aria}
             className="absolute inset-0 h-full w-full overflow-visible">
          {/* Les MÊMES bandes que Charge & RPE : une nuance sur deux, trait doré
              au changement de macro, pointillé au changement de bloc. */}
          {bandes.map((b, i) => {
            const bx = slot * b.from;
            const bw = slot * (b.to - b.from + 1);
            return (
              <g key={`${b.from}-${b.macro}-${b.block}`}>
                {i % 2 === 0 && <rect x={bx} y={PAD_T} width={bw} height={INNER_H} fill="var(--muted)" opacity="0.35" />}
                {i > 0 && (bandes[i - 1].macro !== b.macro
                  ? <line x1={bx} y1={PAD_T} x2={bx} y2={VH - PAD_B} stroke="var(--gold)" strokeWidth="1.5" opacity="0.7" vectorEffect="non-scaling-stroke" />
                  : <line x1={bx} y1={PAD_T} x2={bx} y2={VH - PAD_B} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 3" opacity="0.9" vectorEffect="non-scaling-stroke" />)}
              </g>
            );
          })}
          {/* Grille horizontale en retrait ; pas de quadrillage vertical, les bandes le font. */}
          {[lo, mid, hi].map((g) => (
            <line key={g} x1={0} x2={VW} y1={y(g)} y2={y(g)} stroke="var(--border)" strokeWidth="0.5" opacity="0.5" vectorEffect="non-scaling-stroke" />
          ))}
          {mesure.forme === 'barres' && valeurs.map((v, i) => v == null ? null : (
            <rect key={weeks[i].week} data-barre x={x(i) - barW / 2} y={y(v)} width={barW} height={Math.max(0, VH - PAD_B - y(v))}
                  fill={mesure.couleur} opacity="0.85" rx="1.5" />
          ))}
          {/* UNE SUITE, UN TRACÉ : rien ne relie deux suites, le trou reste un trou. */}
          {mesure.forme === 'ligne' && suites.map((s) => s.length < 2 ? null : (
            <path key={s[0]} data-suite d={cheminAdouci(s.map((i) => ({ x: x(i), y: y(valeurs[i] as number) })))}
                  fill="none" stroke={mesure.couleur} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke" />
          ))}
          {fenetres.map((f) => (
            <rect key={f.from} data-fenetre x={slot * f.from + 1} y={PAD_T + 1} width={slot * (f.to - f.from + 1) - 2} height={INNER_H - 2}
                  fill="none" stroke="var(--border)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {/* Les libellés de bande, en tête. */}
        {bandes.map((b) => {
          const libelle = libelleDeBande(b);
          return libelle ? (
            <span key={`l-${b.from}`} className="absolute top-0 -translate-x-1/2 font-mono text-[9px] font-semibold text-muted-foreground"
                  style={{ left: pct(slot * (b.from + (b.to - b.from + 1) / 2), VW) }} aria-hidden>
              {libelle}
            </span>
          ) : null;
        })}
        {/* Une suite d'UN point ne donne pas de tracé : c'est une pastille. */}
        {mesure.forme === 'ligne' && suites.filter((s) => s.length === 1).map((s) => (
          <span key={`seul-${s[0]}`} className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ left: pct(x(s[0]), VW), top: pct(y(valeurs[s[0]] as number), VH), background: mesure.couleur }} aria-hidden />
        ))}
        {/* Deux repères par courbe : le meilleur et le dernier mesuré. */}
        {mesure.forme === 'ligne' && [points.meilleur, points.dernier].filter((i, k, arr): i is number => i != null && arr.indexOf(i) === k).map((i) => (
          <span key={`r-${i}`} data-repere className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_0_2px_var(--card)]"
                style={{ left: pct(x(i), VW), top: pct(y(valeurs[i] as number), VH), background: mesure.couleur }} aria-hidden />
        ))}
        {/* La fenêtre sans mesure se NOMME, dès qu'elle est assez large pour le lire. */}
        {fenetres.filter((f) => (f.to - f.from + 1) / n >= 0.14).map((f) => (
          <span key={`t-${f.from}`} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-mono text-[9px] text-warning"
                style={{ left: pct(slot * (f.from + (f.to - f.from + 1) / 2), VW) }}>
            {texteFenetre}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Les raisons d'une absence
 * ------------------------------------------------------------------------- */

/** La raison de la DERNIÈRE fenêtre sans estimation, et jusqu'où on a mesuré.
 *  C'est elle que la pastille du titre et le chiffre du haut écrivent. */
function finSansEstimation(weeks: TrackingWeek[]): { raison: Raison | null; depuis: string | null } | null {
  const derniere = weeks[weeks.length - 1];
  if (!derniere || derniere.e1Kg != null) return null;
  let k = weeks.length - 1;
  while (k > 0 && weeks[k - 1].e1Kg == null) k--;
  return { raison: derniere.e1Raison, depuis: k > 0 ? weeks[k - 1].week : null };
}

function texteDeRaison(t: (k: string, o?: Record<string, unknown>) => string, fin: { raison: Raison | null; depuis: string | null }): string {
  const raison = t(`tracker.progression.raison.${fin.raison ?? 'variantes'}`);
  return fin.depuis ? `${raison} · ${t('tracker.progression.depuisLe', { date: jour(fin.depuis) })}` : raison;
}

/* ------------------------------------------------------------------------- *
 * Le composant
 * ------------------------------------------------------------------------- */

function Chiffre({ titre, valeur, unite, pied, alerte }: {
  titre: string; valeur: string; unite?: string; pied: string; alerte?: boolean;
}) {
  return (
    <div data-chiffre className={cn('flex min-w-0 flex-col gap-0.5 rounded-lg border px-3 py-2',
      alerte ? 'border-warning/60' : 'border-border')}>
      <span className="font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{titre}</span>
      <span className="flex items-baseline gap-1.5">
        <span className={cn('font-mono text-xl font-semibold leading-tight', alerte && 'text-warning')}>{valeur}</span>
        {unite && <span className="font-mono text-[11px] text-muted-foreground">{unite}</span>}
      </span>
      <span className={cn('font-mono text-[10px] leading-tight', alerte ? 'text-warning' : 'text-muted-foreground')}>{pied}</span>
    </div>
  );
}

export function ProgressionDuMouvement({ athleteId }: { athleteId: string }) {
  const { t } = useTranslation();
  const [exercise, setExercise] = useState<string | undefined>(undefined);
  const { data, isLoading, isPlaceholderData } = useTracking(athleteId || null, exercise);

  // Même alignement que Charge & RPE : brokkr peut retomber sur un autre
  // mouvement, et pas sur la réponse provisoire (elle est celle d'avant).
  useEffect(() => {
    if (!isPlaceholderData && data?.exercise && data.exercise !== exercise) setExercise(data.exercise);
  }, [data?.exercise, exercise, isPlaceholderData]);
  useEffect(() => { setExercise(undefined); }, [athleteId]);

  const weeks = useMemo(() => data?.weeks ?? [], [data?.weeks]);

  if (isLoading && !data) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{t('common.loading')}</p>;
  }
  if (!data || weeks.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{t('charts.aucuneDonneeEntrainement')}</p>;
  }

  return (
    <section className="flex flex-col gap-3" aria-label={t('tracker.onglet.progression')}>
      <Selecteur data={data} courant={exercise ?? data.exercise ?? ''} onChoisir={setExercise} />
      <Chiffres weeks={weeks} auPoidsDuCorps={data.auPoidsDuCorps} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {MESURES.map((m) => <Carte key={m.cle} mesure={m} weeks={weeks} auPoidsDuCorps={data.auPoidsDuCorps} />)}
      </div>
      <Refaits refaits={data.refaits} auPoidsDuCorps={data.auPoidsDuCorps} />
    </section>
  );
}

function Selecteur({ data, courant, onChoisir }: {
  data: TrackingResponse; courant: string; onChoisir: (e: string) => void;
}) {
  const { t } = useTranslation();
  const weeks = data.weeks;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div role="group" aria-label={t('charts.combinaisons')} className="flex flex-wrap gap-1">
        {data.exercises.map((e) => (
          <button key={e.name} type="button" aria-pressed={e.name === courant} onClick={() => onChoisir(e.name)}
                  className={cn('h-7 rounded-md border px-2.5 font-display text-[11px] font-bold uppercase tracking-[0.06em] transition-colors',
                    e.name === courant ? 'border-gold bg-gold/15 text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}>
            {e.name}
          </button>
        ))}
      </div>
      <span className="ml-auto font-mono text-[10px] text-muted-foreground">
        {t('tracker.progression.semaines', { count: weeks.length, du: jour(weeks[0].week), au: jour(weeks[weeks.length - 1].week) })}
      </span>
    </div>
  );
}

/** LES QUATRE CHIFFRES. L'écart est BRUT, jamais en pourcentage : « +155 % »
 *  sur 1,1 → 2,9 séries par semaine n'informe pas. */
function Chiffres({ weeks, auPoidsDuCorps }: { weeks: TrackingWeek[]; auPoidsDuCorps: boolean }) {
  const { t } = useTranslation();
  const e1 = weeks.map((w) => w.e1Kg);
  const meilleur = reperes(e1).meilleur;
  const fin = finSansEstimation(weeks);
  const comparaison = (valeurs: (number | null)[], decimales: number, unite = '', seuilStable = 0): [string, string] => {
    const c = debutEtFin(valeurs);
    if (!c) return ['—', ''];
    const delta = c.fin - c.debut;
    const pied = Math.abs(delta) <= seuilStable
      ? t('tracker.progression.stableVsPremieres', { count: c.n })
      : t('tracker.progression.vsPremieres', { delta: `${signe(delta, decimales)}${unite}`, count: c.n });
    return [nombre(c.fin, decimales), pied];
  };
  const [tonnage, piedTonnage] = comparaison(weeks.map((w) => w.tonnageTotalKg), 0, ' kg');
  const [lourdes, piedLourdes] = comparaison(weeks.map((w) => w.lourdes), 1);
  const [rpe, piedRpe] = comparaison(weeks.map((w) => w.feltRpe), 1, '', 0.3);
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <Chiffre titre={t(auPoidsDuCorps ? 'tracker.progression.rmEstimeLest' : 'tracker.progression.rmEstime')}
               valeur={meilleur != null ? nombre(e1[meilleur] as number, 1) : '—'} unite="kg"
               alerte={fin != null}
               pied={fin ? texteDeRaison(t, fin)
                 : meilleur != null ? t('tracker.progression.meilleurEstime', { date: jour(weeks[meilleur].week) })
                 : t('tracker.progression.pasDestimation')} />
      <Chiffre titre={t('tracker.progression.tonnageParSemaine')} valeur={tonnage} unite="kg" pied={piedTonnage} />
      <Chiffre titre={t('tracker.progression.lourdesParSemaine')} valeur={lourdes} pied={piedLourdes} />
      <Chiffre titre={t('tracker.progression.rpeMoyen')} valeur={rpe} pied={piedRpe} />
    </div>
  );
}

function Carte({ mesure, weeks, auPoidsDuCorps }: { mesure: Mesure; weeks: TrackingWeek[]; auPoidsDuCorps: boolean }) {
  const { t } = useTranslation();
  const valeurs = weeks.map(mesure.valeur);
  const fin = mesure.avecFenetre ? finSansEstimation(weeks) : null;
  const c = debutEtFin(valeurs);
  const unite = mesure.cle === 'tonnage' || mesure.cle === 'e1' ? ' kg' : mesure.cle === 'intensite' ? ' %' : '';
  const titre = t(`tracker.progression.cartes.${mesure.cle}.titre`);
  return (
    <article data-carte={mesure.cle} className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 className="font-display text-[12px] font-bold uppercase tracking-[0.08em]">{titre}</h3>
        {fin && (
          <span data-pastille className="ml-auto font-mono text-[9px] text-warning">
            {texteDeRaison(t, fin)}
          </span>
        )}
      </div>
      <p className="text-[10.5px] leading-snug text-muted-foreground">
        {t(`tracker.progression.cartes.${mesure.cle}.quoi`, { lest: auPoidsDuCorps ? t('tracker.progression.enLest') : '' })}
      </p>
      <Graphe weeks={weeks} mesure={mesure} texteFenetre={t('tracker.progression.pasDestimation')}
              aria={`${titre} — ${t('tracker.progression.semaines', { count: weeks.length, du: jour(weeks[0].week), au: jour(weeks[weeks.length - 1].week) })}`} />
      <div className="flex justify-between pl-[34px] font-mono text-[9px] text-muted-foreground" aria-hidden>
        <span>{jour(weeks[0].week)}</span>
        <span>{jour(weeks[weeks.length - 1].week)}</span>
      </div>
      {/* « Chez toi » : UNE phrase, pas deux. */}
      {c && (
        <p data-chez-toi className="text-[10.5px] leading-snug text-foreground/85">
          {t('tracker.progression.chezToi', {
            debut: `${nombre(c.debut, mesure.decimales)}${unite}`, fin: `${nombre(c.fin, mesure.decimales)}${unite}`, count: c.n,
          })}
        </p>
      )}
      <details className="text-[10.5px] text-muted-foreground">
        <summary className="cursor-pointer select-none hover:text-foreground">{t('tracker.progression.commentLeLire')}</summary>
        <p className="mt-1 leading-snug">{t(`tracker.progression.cartes.${mesure.cle}.lire`)}</p>
      </details>
    </article>
  );
}

/** « MÊME CHARGE, MÊME FORMAT » — une barre divergente autour de zéro : à gauche
 *  le RPE a baissé (progrès), à droite il a monté. C'est un usage légitime du
 *  divergent — deux pôles et un neutre —, et les couleurs de statut ne servent
 *  qu'à ça : jamais de « série 4 » dans les six cartes. */
function Refaits({ refaits, auPoidsDuCorps }: { refaits: TrackingResponse['refaits']; auPoidsDuCorps: boolean }) {
  const { t } = useTranslation();
  if (refaits.length === 0) return null;
  const maxDelta = Math.max(0.5, ...refaits.map((r) => Math.abs(r.delta)));
  const forme = (r: TrackingResponse['refaits'][number]) => r.competition
    ? t('tracker.progression.refaits.competition')
    : [r.variant.join(' + '), r.tempo ? `tempo ${r.tempo}` : '', r.format ?? ''].filter(Boolean).join(' · ');
  const lignes = (
    <ul className="flex flex-col">
      {refaits.map((r) => {
        const premier = r.points[0];
        const dernier = r.points[r.points.length - 1];
        const couleur = r.delta < 0 ? 'var(--success)' : r.delta > 0 ? 'var(--destructive)' : 'var(--muted-foreground)';
        return (
          <li key={`${forme(r)}-${r.sets}-${r.reps}-${r.lestKg}`} data-refait
              className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-t border-border/40 py-1.5 sm:grid-cols-[112px_minmax(80px,120px)_minmax(0,1fr)_auto_44px]">
            <span className="font-mono text-[11px]">{nombre(r.sets)}×{nombre(r.reps)} @ {nombre(r.lestKg, r.lestKg % 1 ? 2 : 0)} kg</span>
            <span className="truncate font-mono text-[10px] text-muted-foreground">{forme(r)}</span>
            <div className="relative col-span-2 h-3 sm:col-span-1" aria-hidden>
              <div className="absolute left-1/2 top-0 h-3 w-px bg-border" />
              <div className="absolute top-[3px] h-1.5 rounded-sm" style={{
                background: couleur,
                left: r.delta < 0 ? `${50 - (50 * Math.abs(r.delta)) / maxDelta}%` : '50%',
                width: `${(50 * Math.abs(r.delta)) / maxDelta}%`,
              }} />
            </div>
            <span className="font-mono text-[10px] text-muted-foreground sm:text-right">
              {jour(premier.date)} @{nombre(premier.rpe, premier.rpe % 1 ? 1 : 0)} → {jour(dernier.date)} @{nombre(dernier.rpe, dernier.rpe % 1 ? 1 : 0)}
            </span>
            <span data-delta className="text-right font-mono text-[12px] font-semibold" style={{ color: couleur }}>
              {signe(r.delta, r.delta % 1 ? 1 : 0)}
            </span>
          </li>
        );
      })}
    </ul>
  );
  const entete = (
    <>
      <span className="font-display text-[12px] font-bold uppercase tracking-[0.08em]">{t('tracker.progression.refaits.titre')}</span>
      <span className="text-[10.5px] text-muted-foreground">{t('tracker.progression.refaits.sousTitre', { lest: auPoidsDuCorps ? t('tracker.progression.enLest') : '' })}</span>
    </>
  );
  return (
    <section data-refaits className="rounded-lg border border-border bg-card p-3">
      {/* Sous trois lignes, la section se replie plutôt que d'afficher deux lignes seules. */}
      {refaits.length < 3 ? (
        <details>
          <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-2">{entete}
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">{t('tracker.progression.refaits.deplier', { count: refaits.length })}</span>
          </summary>
          {lignes}
        </details>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2">{entete}</div>
          <div className="mt-2">{lignes}</div>
        </>
      )}
      <p className="mt-2 text-[10.5px] text-muted-foreground">{t('tracker.progression.refaits.legende')}</p>
    </section>
  );
}
