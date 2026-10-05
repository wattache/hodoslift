import { useTranslation } from 'react-i18next';

import { useLogsDeDouleur } from '@/api/hooks/use-douleurs';
import { cheminAdouci, cheminDroit, suitesEtPonts } from '@/lib/courbe';
import { cleDIntensite, couleurDIntensite } from '@/lib/douleurs/intensite';

type Props = { athleteId: string; douleurId: string };

const W = 900;
const H = 200;
const PAD = { top: 14, right: 14, bottom: 26, left: 32 };

/** L'HISTOIRE D'UNE DOULEUR — FRE-197.
 *
 *  La feature promet de suivre une douleur DANS LE TEMPS : c'est ce qui la
 *  distingue du signalement ponctuel qu'elle remplace. La carte ne montrait
 *  que la dernière note, alors que dix relevés de production sur dix portent
 *  un commentaire — et que c'est le texte que le kiné vient lire.
 *
 *  ⚠️ L'AXE DES ABSCISSES EST LE TEMPS RÉEL, PAS LE RANG DU RELEVÉ. Première
 *  version : un bâton par relevé, tous de même largeur. Deux notes à un mois
 *  d'écart y ressemblaient trait pour trait à deux notes consécutives — « on
 *  voit pas la différence de dates » (William, 22/09), et c'est exactement ce
 *  qu'une douleur suivie doit montrer.
 *
 *  ⚠️ ET ON NE COMPLÈTE PAS L'ESPACE VIDE. Les jours sans relevé sont des
 *  TROUS, pas des zéros : le zéro est une réponse — « plus mal aujourd'hui » —
 *  et il est vert. C'est la convention que `lib/courbe` porte déjà pour le
 *  tracker : les segments observés s'adoucissent, les ponts restent DROITS et
 *  plus clairs, parce que leur rectitude dit elle-même qu'on n'a rien mesuré
 *  là. Un pont adouci imiterait la forme des données observées et mentirait
 *  deux fois.
 */
export function HistoireDeLaDouleur({ athleteId, douleurId }: Props) {
  const { t } = useTranslation();
  const { data: logs = [], isLoading } = useLogsDeDouleur(athleteId, douleurId);

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">{t('suiviKine.chargement')}</p>;
  }
  // Un seul relevé ne fait pas une histoire : la carte le montre déjà en grand.
  if (logs.length < 2) return null;

  // Du plus ancien au plus récent : une courbe se lit dans le sens du temps,
  // alors que l'API sert le plus frais en tête (ce dont la carte a besoin).
  const suite = [...logs].reverse();
  const jour = (d: string) => Math.round(Date.parse(d) / 86_400_000);
  const premier = jour(suite[0].date);
  const dernier = jour(suite[suite.length - 1].date);
  const etendue = Math.max(1, dernier - premier);

  // ⚠️ UNE CASE PAR JOUR DE LA FENÊTRE, ET `null` PARTOUT AILLEURS. C'est ce
  // que `suitesEtPonts` attend, et c'est ce qui fait apparaître les trous :
  // construire le tableau sur les seuls relevés les effacerait.
  const parJour: (number | null)[] = Array.from({ length: etendue + 1 }, () => null);
  for (const l of suite) parJour[jour(l.date) - premier] = l.intensite;

  const x = (i: number) => PAD.left + (i * (W - PAD.left - PAD.right)) / etendue;
  const y = (v: number) => PAD.top + (1 - v / 10) * (H - PAD.top - PAD.bottom);
  const pt = (i: number) => ({ x: x(i), y: y(parJour[i] as number) });

  const { suites, ponts } = suitesEtPonts(parJour);
  const traces = suites.filter(s => s.length > 1).map(s => cheminAdouci(s.map(pt)));
  const pontsTraces = ponts.map(([a, b]) => cheminDroit([pt(a), pt(b)]));

  return (
    <section className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
      <h4 className="text-xs uppercase tracking-wider text-muted-foreground">
        {t('douleurs.histoire', { count: logs.length })}
      </h4>

      {/* ⚠️ `aria-hidden` : UNE COURBE NE SE LIT PAS À VOIX HAUTE. C'est la
          liste datée, plus bas, qui porte le contenu — et elle porte en plus
          les commentaires, que le graphe ne peut pas montrer. */}
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden className="h-32 w-full">
        {/* ⚠️ LE FOND D'ABORD, sous l'axe et sous la courbe — même convention
            que les phases du cycle sur le tracker.

            ⚠️ ET SEULS LES JOURS ENTRAÎNÉS PORTENT UNE BANDE. L'absence de
            bande ne dit RIEN : ni « repos », ni « pas répondu ». Les colorer
            tous les deux demanderait au lecteur de distinguer deux teintes
            pâles pour une nuance que la liste, juste dessous, énonce en toutes
            lettres. Une bande qui voudrait dire « repos » là où personne n'a
            répondu inventerait des journées entières. */}
        {suite.filter(l => l.entrainement).map(l => {
          const cx = x(jour(l.date) - premier);
          return (
            <rect key={`e${l.date}`} x={cx - 7} y={PAD.top} width={14}
                  height={H - PAD.top - PAD.bottom}
                  fill="var(--gold, #d4a843)" opacity="0.16" rx="3" />
          );
        })}

        {/* Les repères de l'échelle : 0 en bas, 10 en haut, 5 au milieu. */}
        {[0, 5, 10].map(v => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)}
                  stroke="var(--border)" strokeWidth="1" opacity={v === 0 ? 0.9 : 0.35} />
            <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end"
                  className="fill-muted-foreground" style={{ fontSize: 13 }}>{v}</text>
          </g>
        ))}

        {/* Les ponts SOUS les suites observées : à un point de raccord, c'est
            le trait plein qui doit rester dessus. */}
        {pontsTraces.map((d, k) => (
          <path key={`pont${k}`} d={d} fill="none" stroke="var(--muted-foreground)"
                strokeWidth="2" strokeLinecap="round" opacity="0.35" />
        ))}
        {traces.map((d, k) => (
          <path key={k} d={d} fill="none" stroke="var(--muted-foreground)"
                strokeWidth="2" strokeLinecap="round" opacity="0.7" />
        ))}

        {/* ⚠️ CHAQUE POINT PREND LA COULEUR DE SA PROPRE INTENSITÉ. La ligne ne
            peut pas la porter — elle traverse plusieurs paliers — et c'est le
            point qui dit la valeur, comme la pastille de la carte. */}
        {suite.map(l => (
          <circle key={l.date} r="6"
                  cx={x(jour(l.date) - premier)} cy={y(l.intensite)}
                  fill={couleurDIntensite(l.intensite)} />
        ))}

        {/* Les bornes de la fenêtre, qui donnent son échelle au temps. */}
        <text x={PAD.left} y={H - 6} className="fill-muted-foreground" style={{ fontSize: 13 }}>
          {suite[0].date}
        </text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end"
              className="fill-muted-foreground" style={{ fontSize: 13 }}>
          {suite[suite.length - 1].date}
        </text>
      </svg>

      {/* ⚠️ LA BANDE NE SE LIT PAS SEULE : sans ce mot, un fond doré derrière un
          point n'est qu'une décoration. Elle n'apparaît que s'il y a au moins
          un jour entraîné à expliquer. */}
      {suite.some(l => l.entrainement) && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: 'var(--gold, #d4a843)', opacity: 0.4 }} />
          {t('douleurs.jourEntraine')}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {logs.map(l => (
          <li key={l.date} className="flex flex-wrap gap-2 text-xs">
            <span className="tabular-nums text-muted-foreground">{l.date}</span>
            <span className="font-semibold tabular-nums"
                  style={{ color: couleurDIntensite(l.intensite) }}>
              {l.intensite}/10
            </span>
            <span className="text-muted-foreground">· {t(cleDIntensite(l.intensite))}</span>
            {/* ⚠️ RIEN QUAND LA QUESTION N'A PAS ÉTÉ POSÉE. `null` n'est pas
                « repos » : les onze relevés d'avant cette colonne n'ont jamais
                eu l'occasion de répondre, et les afficher « repos » inventerait
                onze journées que personne n'a déclarées. */}
            {l.entrainement != null && (
              <span className="rounded-full border border-border px-2 text-[11px] text-muted-foreground">
                {l.entrainement ? t('douleurs.jourEntraine') : t('douleurs.jourSans')}
              </span>
            )}
            {l.commentaire && (
              <span className="flex-1 italic text-muted-foreground">« {l.commentaire} »</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
