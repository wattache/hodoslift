import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Check, Clock, ExternalLink, Inbox, PenLine } from 'lucide-react';

import { useGuichet, useMarquerRelue, useMarquerSignalementVu } from '@/api/hooks/use-guichet';
import { useMe } from '@/api/hooks/use-me';
import type { DossierDouleur, DossierDuGuichet, DossierSeance, DossierSemaine, Guichet } from '@/api/types';
import { AthleteAvatar } from '@/components/athlete-avatar';
import { athleteInitials, nomAffiche } from '@/lib/athlete';
import { useAthleteSelection } from '@/lib/athlete-selection';
import { formatLong, formatShort } from '@/lib/dates-ui';
import { couleurDeLEcart } from '@/lib/rpe';
import { useIsMobile } from '@/lib/use-mobile';
import { cn } from '@/lib/utils';
import { tonIntensite } from '@/views/signalements';

/** LE GUICHET DU COACH — la file de travail qui se vide (brief du 12/09).
 *
 *  L'écran sert UN dossier à la fois, avec assez de contexte pour le traiter
 *  sans quitter la page, et un bouton qui le clôt et passe au suivant. Ce n'est
 *  pas un tableau de bord d'état : rien n'y est décoratif, rien n'y est « pour
 *  information ». L'objectif est zéro ligne, et l'écran vide est la réussite.
 *
 *  ⚠️ L'ÉCRAN NE DÉCIDE PAS DE L'ORDRE. Il affiche la file telle que le serveur
 *  la rend — douleurs, puis séances de la plus ancienne à la plus récente, puis
 *  semaines. Le seul réarrangement local est « Plus tard », qui renvoie un
 *  dossier en fin de file sans le marquer, et ne survit pas à la session.
 *
 *  ⚠️ « VU » EST UNE COCHE DU COACH, jamais déduite de l'ouverture de la page.
 *  Ouvrir n'est pas lire.
 */

const CLE_PLUS_TARD = 'eitri-guichet-plus-tard';

/** L'identité d'un dossier, pour « Plus tard ». */
function cleDe(d: DossierDuGuichet): string {
  if (d.type === 'seance') return `seance:${d.sessionId}`;
  if (d.type === 'douleur') return `douleur:${d.athlete.athleteId}:${d.date}`;
  return `semaine:${d.weekId}`;
}

/** ⚠️ `sessionStorage`, RIEN CÔTÉ SERVEUR. « Plus tard » n'est pas une décision
 *  sur le dossier, c'est une décision sur le MOMENT : demain, il revient à sa
 *  place normale. Sans ce bouton, un dossier qu'on ne peut pas traiter
 *  maintenant bloque toute la file — le défaut classique de ce patron. */
function lirePlusTard(): string[] {
  try { return JSON.parse(sessionStorage.getItem(CLE_PLUS_TARD) ?? '[]') as string[]; }
  catch { return []; }
}

/** Les reportés passent en queue, dans l'ordre où on les a reportés ; le reste
 *  garde l'ordre du serveur. */
function ordonner(dossiers: DossierDuGuichet[], plusTard: string[]): DossierDuGuichet[] {
  const reportes = new Map(plusTard.map((k, i) => [k, i]));
  const tete = dossiers.filter(d => !reportes.has(cleDe(d)));
  const queue = dossiers.filter(d => reportes.has(cleDe(d)))
    .sort((a, b) => reportes.get(cleDe(a))! - reportes.get(cleDe(b))!);
  return [...tete, ...queue];
}

/** L'ACCUEIL : PAR DÉFAUT, SA SEMAINE D'ENTRAÎNEMENT (William, 14/09).
 *
 *  | qui                         | téléphone     | grand écran   |
 *  | --------------------------- | ------------- | ------------- |
 *  | a une fiche athlète         | sa semaine    | sa semaine    |
 *  | … et coache                 | sa semaine    | guichet       |
 *  | coache sans fiche athlète   | guichet       | guichet       |
 *  | ni l'un ni l'autre (kiné)   | tableau de bord               |
 *
 *  ⚠️ LE GUICHET ÉTAIT L'ACCUEIL DE TOUT COACH, et au téléphone c'était
 *  « infernal » : on y ouvre l'app pour s'entraîner, le guichet est un travail
 *  de bureau. Un athlète arrivait sur son tableau de bord ; la séance du jour est
 *  ce qu'il vient chercher.
 *
 *  ⚠️ SA FICHE EST SÉLECTIONNÉE D'ABORD. La dernière sélection d'un coach est
 *  souvent un athlète ouvert depuis le guichet : sans ça, « sa semaine » aurait
 *  été celle de quelqu'un d'autre. */
export function Accueil() {
  const { data: me, isLoading } = useMe();
  const telephone = useIsMobile();
  const sel = useAthleteSelection();
  const navigate = useNavigate();
  const versSaSemaine = Boolean(me?.athleteId && (telephone || !me.isCoach));

  useEffect(() => {
    if (!versSaSemaine || !me?.athleteId) return;
    sel.setSelectedId(me.athleteId);
    void navigate('/training', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versSaSemaine, me?.athleteId]);

  if (isLoading || !me || versSaSemaine) return null;
  return <Navigate to={me.isCoach ? '/guichet' : '/dashboard'} replace />;
}

export function GuichetView() {
  const { t } = useTranslation();
  const { data, isLoading } = useGuichet();
  const sel = useAthleteSelection();
  const navigate = useNavigate();
  const relire = useMarquerRelue();
  const vu = useMarquerSignalementVu();
  const [plusTard, setPlusTard] = useState<string[]>(lirePlusTard);
  useEffect(() => {
    try { sessionStorage.setItem(CLE_PLUS_TARD, JSON.stringify(plusTard)); } catch { /* sans stockage, sans mémoire */ }
  }, [plusTard]);

  const dossiers = useMemo(() => ordonner(data?.dossiers ?? [], plusTard), [data, plusTard]);
  const courant = dossiers[0];
  const suivants = dossiers.slice(1);
  // « 4 / 10 » : le rang avance avec les « Plus tard » (les reportés sont
  // derrière), le total recule avec les « Vu ». Le coach voit qu'il y a une fin.
  const cles = new Set(dossiers.map(cleDe));
  const position = { rang: 1 + plusTard.filter(k => cles.has(k)).length, total: dossiers.length };

  /** Vers la séance : l'athlète d'abord (la vue entraînement lit la sélection),
   *  puis la semaine et la séance par l'URL — `training.tsx` les applique. */
  const ouvrir = (athleteId: string, weekId?: string, sessionId?: string) => {
    sel.setSelectedId(athleteId);
    const q = new URLSearchParams();
    if (weekId) q.set('week', weekId);
    if (sessionId) q.set('session', sessionId);
    const query = q.toString();
    void navigate(`/training${query ? `?${query}` : ''}`);
  };
  const reporter = (d: DossierDuGuichet) => setPlusTard(l => [...l.filter(k => k !== cleDe(d)), cleDe(d)]);

  if (isLoading || !data) {
    return <p className="mx-auto max-w-4xl py-8 text-center text-sm text-muted-foreground">{t('guichet.chargement')}</p>;
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <EnTete comptes={data.comptes} courant={courant?.type} />

      {!courant ? (
        <FileVide aJour={data.comptes.athletes} />
      ) : (
        <>
          {courant.type === 'seance' && (
            <CarteSeance d={courant} position={position}
                         onVu={() => relire.mutate({ programId: courant.programId, sessionId: courant.sessionId })}
                         onOuvrir={() => ouvrir(courant.athlete.athleteId, courant.weekId, courant.sessionId)}
                         onPlusTard={() => reporter(courant)} enCours={relire.isPending} />
          )}
          {courant.type === 'douleur' && (
            <CarteDouleur d={courant} position={position}
                          onVu={() => vu.mutate({ athleteId: courant.athlete.athleteId, date: courant.date })}
                          onAdapter={courant.seanceDuJour
                            ? () => ouvrir(courant.athlete.athleteId, courant.seanceDuJour!.weekId, courant.seanceDuJour!.sessionId)
                            : undefined}
                          onPlusTard={() => reporter(courant)} enCours={vu.isPending} />
          )}
          {courant.type === 'semaine' && (
            <CarteSemaine d={courant} position={position}
                          onEcrire={() => ouvrir(courant.athlete.athleteId, courant.weekId)}
                          onPlusTard={() => reporter(courant)} />
          )}
          <Pied suivants={suivants} />
        </>
      )}
    </div>
  );
}

/** L'EN-TÊTE reste en haut en permanence : le titre, et un compte par type en
 *  pilules (maquette du 12/09). Le type du dossier courant est en OR plein, la
 *  douleur garde son rouge, le reste est neutre — c'est la seule chose qui dit
 *  ce qu'il reste. Les trois restent affichées à ZÉRO : sur la file vide, c'est
 *  le bandeau qui dit qu'il n'y a rien de chaque sorte (William, 12/09). */
function EnTete({ comptes, courant }: {
  comptes: Guichet['comptes'];
  courant?: DossierDuGuichet['type'];
}) {
  const { t } = useTranslation();
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <h1 className="flex items-center gap-2 font-display text-[22px] font-bold uppercase leading-none tracking-[0.01em]">
        <Inbox className="h-5 w-5 text-gold" aria-hidden /> {t('guichet.titre')}
      </h1>
      <ul className="flex flex-wrap gap-1.5 font-mono text-[12px]">
        {(['douleur', 'seance', 'semaine'] as const).map(k => (
          <li key={k}
              className={cn('flex h-7 items-center gap-1.5 rounded-md border px-2',
                            courant === k ? 'border-gold bg-gold font-semibold text-gold-foreground'
                            : k === 'douleur' ? 'border-destructive/50 bg-destructive/10 text-destructive'
                            : 'border-border bg-muted/40 text-muted-foreground')}>
            {t(`guichet.${k}`, { count: comptes[k] })} <span className="tabular-nums">{comptes[k]}</span>
          </li>
        ))}
      </ul>
    </header>
  );
}

/** « 4 / 10 » en haut à droite de chaque dossier. */
function Position({ rang, total }: { rang: number; total: number }) {
  const { t } = useTranslation();
  return <p className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{t('guichet.position', { rang, total })}</p>;
}

/** LA FILE VIDE — l'écran que le coach doit voir le plus souvent possible.
 *  Affirmatif, pas un état de chargement raté : ni squelette, ni « aucun élément
 *  à afficher ». */
function FileVide({ aJour }: { aJour: number }) {
  const { t } = useTranslation();
  // `aJour` vient du serveur : les SIENS, par le lien. L'annuaire local porte
  // tout le monde — 67 pour un coach qui en a 3.
  return (
    <section className="rounded-xl border border-gold/40 bg-card p-8 text-center shadow-[0_16px_42px_rgba(0,0,0,0.16)]">
      <Check className="mx-auto h-8 w-8 text-gold" aria-hidden />
      <p className="mt-3 font-display text-[28px] font-bold uppercase leading-none tracking-[0.01em]">
        {t('guichet.rienNeTAttend')}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">{t('guichet.athletesAJour', { count: aJour })}</p>
      <Link to="/dashboard"
            className="mt-4 inline-flex h-11 items-center gap-1.5 px-2 font-mono text-[12px] uppercase tracking-[0.14em] text-gold transition-colors hover:text-gold/80">
        {t('guichet.voirUnAthlete')} <ArrowRight className="h-4 w-4" />
      </Link>
    </section>
  );
}

/** LE PIED : les suivants, et le restant. On voit qu'il y a une fin. */
function Pied({ suivants }: { suivants: DossierDuGuichet[] }) {
  const { t } = useTranslation();
  if (suivants.length === 0) return null;
  return (
    <footer className="flex flex-wrap items-center gap-3 px-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
      <span>{t('guichet.suivants')}</span>
      <span className="flex -space-x-1.5">
        {suivants.slice(0, 4).map(d => (
          <AthleteAvatar key={cleDe(d)} initials={athleteInitials(d.athlete)}
                         alt={`${d.athlete.firstName} ${d.athlete.lastName}`}
                         className={cn('h-7 w-7 border-2 border-background font-mono text-[10px]',
                                       d.type === 'douleur' && 'border-destructive/60')} />
        ))}
      </span>
      <span>{t('guichet.restant', { count: suivants.length })}</span>
    </footer>
  );
}

/** L'identité en tête de chaque dossier : monogramme, nom normalisé, et SOUS le
 *  nom la situation en mono — « Pull lourd · lun. 8 sept. · Volume 1 · S3 ». */
function Identite({ d, situation, className }: { d: DossierDuGuichet; situation: string; className?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <AthleteAvatar initials={athleteInitials(d.athlete)} alt={`${d.athlete.firstName} ${d.athlete.lastName}`}
                     className="h-10 w-10 shrink-0 font-mono text-xs" />
      <div className="min-w-0">
        <p className="truncate font-display text-[22px] font-bold uppercase leading-none tracking-[0.01em]">
          {nomAffiche(d.athlete.firstName)} {nomAffiche(d.athlete.lastName)}
        </p>
        {/* Pas de `truncate` : sur 390 px, « S1 finie depuis 2 jours » se coupait
            juste avant le chiffre qui compte. */}
        <p className={cn('mt-1 font-mono text-[11px] leading-snug', className ?? 'text-muted-foreground')}>{situation}</p>
      </div>
    </div>
  );
}

/** LES ACTIONS — « Vu · suivant » plein or, deux secondaires. Sous `sm`, la
 *  principale passe pleine largeur à 50 px et les secondaires se partagent la
 *  ligne du dessous à 44 : le plancher que `plancher-du-doigt.spec.ts` vérifie
 *  sur chaque écran. */
function Actions({ principale, secondaires }: {
  principale?: { libelle: string; onClick: () => void; enCours?: boolean };
  secondaires: { libelle: string; onClick: () => void; icone?: React.ReactNode }[];
}) {
  return (
    <div className="mt-5 flex flex-col gap-2 border-t border-border/60 pt-4 sm:flex-row sm:items-center">
      {principale && (
        <button type="button" onClick={principale.onClick} disabled={principale.enCours}
                className="flex h-[50px] w-full items-center justify-center gap-2 rounded-md bg-gold px-4 font-display text-[15px] font-bold uppercase tracking-[0.02em] text-gold-foreground transition-colors hover:bg-gold/90 disabled:opacity-60 sm:h-10 sm:w-auto">
          <Check className="h-4 w-4" /> {principale.libelle} <ArrowRight className="h-4 w-4" />
        </button>
      )}
      <div className="grid grid-cols-2 gap-2 sm:contents [&>:only-child]:col-span-2">
        {secondaires.map(s => (
          <button key={s.libelle} type="button" onClick={s.onClick}
                  className="flex h-11 items-center justify-center gap-1.5 rounded-md border border-border px-3 font-display text-[13px] font-bold uppercase tracking-[0.02em] text-muted-foreground transition-colors hover:border-gold/40 hover:text-foreground sm:h-10">
            {s.icone} {s.libelle}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Le tonnage se lit en tonnes passé le millier — « 7,6 t », pas « 7 640 kg ». */
function tonnage(kg: number | null): { valeur: string; unite: string } {
  if (kg == null) return { valeur: '—', unite: '' };
  return kg >= 1000 ? { valeur: nombre(kg / 1000), unite: 't' } : { valeur: String(Math.round(kg)), unite: 'kg' };
}

const nombre = (v: number | null | undefined, decimales = 1) =>
  v == null ? '—' : v.toFixed(decimales).replace(/\.0$/, '');

/** LE DOSSIER « SÉANCE À RELIRE » — le cas le plus fréquent, et celui qui
 *  justifie l'écran. Trois mesures, la liste des exercices, le retour de
 *  l'athlète : de quoi juger sans ouvrir la séance. */
function CarteSeance({ d, position, onVu, onOuvrir, onPlusTard, enCours }: {
  d: DossierSeance; position: { rang: number; total: number };
  onVu: () => void; onOuvrir: () => void; onPlusTard: () => void; enCours: boolean;
}) {
  const { t } = useTranslation();
  // ⚠️ LE MÊME VOCABULAIRE QUE LA VUE SEMAINE, emprunté : un ressenti au-dessus
  // du visé prend le cadre AMBRE de `couleurDeLEcart('depasse')`.
  const depasse = d.rpeRessenti != null && d.rpeVise != null && d.rpeRessenti > d.rpeVise;
  const auDessus = (rpe: string | null) => d.rpeVise != null && rpe != null && parseFloat(rpe) > d.rpeVise;
  const tonnes = tonnage(d.tonnageKg);
  const situation = [d.name, d.date && formatLong(d.date), d.blockName, `S${d.weekNumber}`]
    .filter(Boolean).join(' · ');
  return (
    <section className="rounded-xl border border-border/80 bg-card p-5 shadow-[0_16px_42px_rgba(0,0,0,0.16)]">
      <div className="flex items-start justify-between gap-3">
        <Identite d={d} situation={situation} />
        <Position {...position} />
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2">
        <Mesure libelle={t('guichet.seriesFaites')}>
          <span className="tabular-nums">{d.seriesTenues}<span className="text-muted-foreground">/{d.seriesTotal}</span></span>
        </Mesure>
        <Mesure libelle={t('guichet.tonnage')}>
          <span className="tabular-nums text-gold">{tonnes.valeur}</span><span className="ml-1 text-xs font-normal text-muted-foreground">{tonnes.unite}</span>
        </Mesure>
        <Mesure libelle={t('guichet.rpeMoyen')}
                style={depasse ? { boxShadow: `inset 0 0 0 1px ${couleurDeLEcart('depasse')}` } : undefined}
                sousLibelle={d.rpeVise != null ? t('guichet.vise', { rpe: nombre(d.rpeVise) }) : t('guichet.sansVise')}>
          <span className={cn('tabular-nums', depasse && 'text-[var(--warning)]')}>
            {nombre(d.rpeRessenti)}
            <span className="text-xs font-normal text-muted-foreground sm:hidden">/{nombre(d.rpeVise)}</span>
          </span>
        </Mesure>
      </dl>

      <ul className="mt-4 divide-y divide-border/50 rounded-md border border-border/60">
        {d.exercices.map((x, i) => (
          <li key={i} className="flex items-baseline gap-3 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate font-display text-[14px] font-bold uppercase tracking-[0.01em]">{x.name}</span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {x.seriesTenues != null && x.seriesTotal != null && `${x.seriesTenues}/${x.seriesTotal}`}
            </span>
            <span className="font-mono text-sm font-semibold tabular-nums text-gold">{x.charge ?? '—'}<span className="ml-0.5 text-[10px] font-normal text-muted-foreground">kg</span></span>
            {/* Le RPE de la ligne : ambre au-dessus du visé de la séance, le
                même mot que le cadre de la mesure — pas un second barème. */}
            <span className={cn('w-8 text-right font-mono text-sm font-semibold tabular-nums',
                                auDessus(x.rpe) ? 'text-[var(--warning)]' : 'text-muted-foreground')}>
              {x.rpe ?? ''}
            </span>
          </li>
        ))}
      </ul>

      {d.retours.length > 0 && (
        <div className="mt-4 flex gap-3 rounded-md border-l-2 border-gold/60 bg-muted/30 px-3 py-2">
          <p className="shrink-0 pt-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-gold">{t('guichet.retourDeLAthlete')}</p>
          <div className="min-w-0">
            {d.retours.map((r, i) => <p key={i} className="text-sm leading-snug">{r}</p>)}
          </div>
        </div>
      )}

      <Actions principale={{ libelle: t('guichet.vuSuivant'), onClick: onVu, enCours }}
               secondaires={[
                 { libelle: t('guichet.ouvrirLaSeance'), onClick: onOuvrir, icone: <ExternalLink className="h-4 w-4" /> },
                 { libelle: t('guichet.plusTard'), onClick: onPlusTard, icone: <Clock className="h-4 w-4" /> },
               ]} />
    </section>
  );
}

function Mesure({ libelle, sousLibelle, style, children }: {
  libelle: string; sousLibelle?: string; style?: React.CSSProperties; children: React.ReactNode;
}) {
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2" style={style}>
      <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{libelle}</dt>
      <dd className="mt-0.5 font-display text-[24px] font-bold leading-none">{children}</dd>
      {sousLibelle && <dd className="mt-0.5 hidden font-mono text-[10px] text-muted-foreground sm:block">{sousLibelle}</dd>}
    </div>
  );
}

/** ⚠️ L'ÉCHELLE EST FIXE DEPUIS FRE-195 : 0 à 10, garanti par le contrat
 *  serveur. Elle se lisait dans un questionnaire libre dont la borne haute
 *  pouvait changer — ce n'est plus une question ouverte, donc plus un réglage
 *  à aller chercher. Et `0` est une réponse : « plus mal aujourd'hui ». */
const MAX_INTENSITE = 10;

/** LE DOSSIER « DOULEUR » — en tête de file, toujours. Contour rouge.
 *
 *  ⚠️ IL PARCOURT `QUESTIONNAIRE_KINE` ET NE CONNAÎT AUCUNE CLÉ, comme
 *  `signalements.tsx` : une question ajoutée s'affiche ici sans y toucher. Les
 *  seuils de couleur suivent le `max` déclaré, jamais 10 en dur, et « pas
 *  renseigné » ne colore rien. `depuis` est un texte libre, rendu tel quel. */
function CarteDouleur({ d, position, onVu, onAdapter, onPlusTard, enCours }: {
  d: DossierDouleur; position: { rang: number; total: number };
  onVu: () => void; onAdapter?: () => void; onPlusTard: () => void; enCours: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section className="rounded-xl border border-destructive/60 bg-card p-5 shadow-[0_16px_42px_rgba(0,0,0,0.16)]">
      <div className="flex items-start justify-between gap-3">
        <Identite d={d} situation={t('guichet.signalementLe', { date: formatShort(d.date) })}
                  className="uppercase tracking-[0.12em] text-destructive" />
        <Position {...position} />
      </div>

      {/* ⚠️ TOUTES LES DOULEURS DU JOUR, pas seulement la pire. La coche porte
          le JOUR : en masquer une la ferait disparaître sans avoir été lue. */}
      <dl className="mt-4 flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5">
        {d.douleurs.map(douleur => (
          <div key={douleur.id} className="flex flex-col gap-0.5">
            <div className="flex items-baseline gap-2">
              <dd className={cn('font-display text-[20px] font-bold leading-none tabular-nums',
                                tonIntensite(douleur.intensite, MAX_INTENSITE))}>
                {douleur.intensite}
                <span className="text-sm font-normal text-muted-foreground">/{MAX_INTENSITE}</span>
              </dd>
              <dt className="text-sm font-semibold">{douleur.nom}</dt>
              {/* ⚠️ « ÇA REVIENT » CHANGE LA LECTURE DU COACH : une gêne d'un
                  jour ne se traite pas comme une douleur qui s'installe. Le
                  compte vient du serveur, où la règle vit. */}
              {douleur.recurrente && (
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-destructive">
                  {t('douleurs.recurrente', { count: douleur.logs })}
                </span>
              )}
            </div>
            {douleur.commentaire && (
              <dd className="text-sm leading-snug text-muted-foreground">{douleur.commentaire}</dd>
            )}
          </div>
        ))}
      </dl>

      <div className="mt-4 rounded-md bg-muted/40 px-3 py-2 text-sm">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{t('guichet.seanceDuJour')}</span>
        <p className="mt-0.5 font-semibold">{d.seanceDuJour?.name ?? <span className="font-normal text-muted-foreground">{t('guichet.aucuneSeanceCeJour')}</span>}</p>
      </div>

      <Actions principale={{ libelle: t('guichet.vuSuivant'), onClick: onVu, enCours }}
               secondaires={[
                 ...(onAdapter ? [{ libelle: t('guichet.adapter'), onClick: onAdapter, icone: <PenLine className="h-4 w-4" /> }] : []),
                 { libelle: t('guichet.plusTard'), onClick: onPlusTard, icone: <Clock className="h-4 w-4" /> },
               ]} />
    </section>
  );
}

/** LE DOSSIER « SEMAINE À ÉCRIRE » — la dernière programmée est RÉALISÉE et rien
 *  n'est écrit après (FRE-179). Pas de coche, pas de date : il se ferme quand une
 *  semaine plus loin reçoit une séance.
 *
 *  ⚠️ PAS D'APERÇU DU BLOC (13/09). Il y a eu des pastilles de semaines — la
 *  réalisée en gros chiffre doré, qu'on ne savait pas lire — et les charges de
 *  la réalisée. William : « illisible, autant l'enlever. Tout ce qui est
 *  intéressant, c'est que la semaine manque. » « Écrire » ouvre la réalisée,
 *  d'où on la prolonge : le contexte est là, sur l'écran d'entraînement. */
function CarteSemaine({ d, position, onEcrire, onPlusTard }: {
  d: DossierSemaine; position: { rang: number; total: number }; onEcrire: () => void; onPlusTard: () => void;
}) {
  const { t } = useTranslation();
  const situation = [d.blockName, t('guichet.sAEcrire', { n: d.weekNumber })].filter(Boolean).join(' · ');
  return (
    <section className="rounded-xl border border-border/80 bg-card p-5 shadow-[0_16px_42px_rgba(0,0,0,0.16)]">
      <div className="flex items-start justify-between gap-3">
        <Identite d={d} situation={situation} className="uppercase tracking-[0.12em] text-gold" />
        <Position {...position} />
      </div>
      <Actions principale={{ libelle: t('guichet.ecrireLaS', { n: d.weekNumber }), onClick: onEcrire }}
               secondaires={[{ libelle: t('guichet.plusTard'), onClick: onPlusTard, icone: <Clock className="h-4 w-4" /> }]} />
    </section>
  );
}
