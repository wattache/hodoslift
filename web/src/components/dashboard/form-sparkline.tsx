import { useTranslation } from 'react-i18next';
import type { PointForme } from '@/api/types';
import { cheminAdouci } from '@/lib/courbe';
import { FORME_MAX, FORME_MIN } from '@/lib/forme-du-jour';

interface Props {
  /** Servis par brokkr, déjà datés et ordonnés (FRE-119). */
  points: PointForme[];
  /** Sert au libellé (« moyenne sur N jours ») ; la fenêtre elle-même est
   *  décidée par l'appelant, qui la demande au serveur. */
  days?: number;
}

/** Sparkline de la forme du jour sur N derniers jours.
 *
 *  Source : `session.formOfTheDay` (saisie athlète au lancement de séance).
 *  L'ancien front lisait `dailyLogs.form`, champ jamais peuplé → ligne plate
 *  à 5 ; ici on branche la vraie donnée.
 *
 *  ⚠️ CE COMPOSANT NE FOUILLE PLUS L'ARBRE (FRE-119). Il extrayait lui-même les
 *  formes de `macros`, ce qui obligeait trois écrans à télécharger l'arbre
 *  ENTIER de l'athlète — 512 Ko sur le programme le plus fourni — pour trente
 *  points. brokkr les sert désormais, déjà datés et ordonnés, et le repli de
 *  date (`coalesce(session_date, week.start_date)`, sans lequel 306 des 752
 *  séances notées de la production n'apparaîtraient pas) vit dans la requête. */
export function FormSparkline({ points, days = 30 }: Props) {
  const { t } = useTranslation();
  const data = points;

  if (data.length < 2) return null;

  const w = 240;
  const h = 56;
  const pad = 4;
  // ⚠️ L'ÉCHELLE EST 1-5, PAS 1-10. Ce composant traçait sur 1-10 et affichait
  // « /10 » : une forme à 5 — le MAXIMUM — sortait au milieu du graphe et se
  // lisait comme médiocre. Le contraire de ce qu'elle dit.
  //
  // Vérifié sur trois sources concordantes : `FormRating` (week-view.tsx) rend
  // `[1,2,3,4,5]`, la colonne `training_sessions.form_of_the_day` est
  // documentée « 1 à 5 », et le contrat brokkr impose `Literal[1,2,3,4,5]`.
  const min = FORME_MIN;
  const max = FORME_MAX;
  const stepX = (w - pad * 2) / Math.max(1, data.length - 1);
  const trace = cheminAdouci(
    data.map((p, i) => ({
      x: pad + i * stepX,
      y: pad + ((max - p.form) / (max - min)) * (h - pad * 2),
    })),
  );

  const last = data[data.length - 1].form;
  const avg = data.reduce((s, p) => s + p.form, 0) / data.length;

  /* ⚠️ LA COULEUR DISAIT LE MOUVEMENT ET SE POSAIT SUR LA VALEUR (refonte des écrans, 09/2026).
     `tone` valait `delta > 0 ? success : delta < 0 ? destructive : gold`, puis
     colorait LE GRAND CHIFFRE. Un 1/5 précédé d'un 1/5 sortait donc en or
     (« stable »), et un 2/5 précédé d'un 1/5 en vert (« ça monte ») — alors que
     l'athlète va mal dans les deux cas. Un coach qui survole la page lit la
     couleur, pas le calcul.

     Elle dit désormais la VALEUR, sur l'échelle 1–5 : le tiers bas alerte, le
     tiers haut rassure. Les seuils se calculent depuis `FORME_MIN`/`FORME_MAX`
     et non en dur — l'échelle a déjà bougé une fois. */
  const tiers = (max - min) / 3;
  const tone = last <= min + tiers ? 'var(--destructive)'
    : last >= max - tiers ? 'var(--success)'
    : 'var(--gold)';

  /* ⚠️ LE MOUVEMENT PASSE EN MOTS, et ce n'est pas qu'un habillage : « → 0.0 »
     s'affichait dès que deux notes consécutives étaient égales, ce qui
     n'apprenait rien à personne.

     ⚠️ ET ON COMPTE DES SÉANCES, PAS DES JOURS. Les points sont espacés
     irrégulièrement — un point par séance NOTÉE, pas par jour. Écrire « depuis
     3 jours » aurait été faux la plupart du temps. */
  let identiques = 1;
  while (identiques < data.length && data[data.length - 1 - identiques].form === last) identiques++;
  const precedent = data[data.length - 2]?.form ?? last;
  const mouvement = identiques > 1
    ? t('dashboard.stableDepuis', { count: identiques })
    : last > precedent ? t('dashboard.enHausse') : t('dashboard.enBaisse');

  return (
    <div className="overflow-hidden rounded-xl border border-border/80 bg-card p-4 shadow-[0_14px_36px_rgba(0,0,0,0.16)]">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {t('dashboard.dailyForm')}
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {t('dashboard.daysAvg', { days, avg: avg.toFixed(1) })}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-2xl font-semibold tabular-nums leading-none" style={{ color: tone }}>{last}</span>
        <span className="text-sm text-muted-foreground">/{max}</span>
        <span className="ml-2 text-[11px] text-muted-foreground">{mouvement}</span>
      </div>
      {/* ⚠️ `preserveAspectRatio="none"`, ET C'EST TOUT LE DÉFAUT. Le `viewBox`
          fait 240×56 et le SVG est rendu en `w-full` : sans cet attribut, la
          valeur par défaut (`xMidYMid meet`) CONSERVE les proportions et CENTRE
          le dessin — dans une boîte de 1100 px, le tracé occupait un quart de la
          largeur et flottait au milieu. Ça ressemblait à un manque de données ;
          c'était un cadrage. */}
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-3 h-14 w-full">
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line
            key={ratio}
            x1={pad}
            x2={w - pad}
            y1={pad + ratio * (h - pad * 2)}
            y2={pad + ratio * (h - pad * 2)}
            stroke="var(--border)"
            strokeWidth="0.5"
            strokeDasharray="2 3"
            opacity="0.65"
          />
        ))}
        <path
          d={trace}
          fill="none"
          stroke={tone}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {/* Une sparkline sans axe ne dit pas dans quel sens elle se lit. Deux
          bornes suffisent — le détail vit dans le Tracker. */}
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{t('dashboard.ilYaNJours', { count: days })}</span>
        <span>{t('dashboard.aujourdhui')}</span>
      </div>
    </div>
  );
}
