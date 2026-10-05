import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { ArrowRight, ArrowUpRight, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import i18n from '@/i18n';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  axeDeLaFrise, chevauchements, dureeEnJours, ecartEnJours, jalonsAVenir, lignesDeMacro, placer, situation, zoomDeSemaines,
  type Axe, type BandeDeBloc, type Chevauchement, type EvenementDeFrise, type ISO, type Jalon, type LigneDeMacro, type LigneDuZoom,
  type TypeDeBloc,
} from '@/lib/frise-periodisation';
import type { MacroDeStructure } from '@/api/types';

/** LA FRISE DE PÉRIODISATION — l'onglet Calendrier (15/09).
 *
 *  Trois usages, dans cet ordre : voir où on en est, saisir un événement au jour
 *  près, repérer la prochaine compétition. La géométrie vit dans
 *  `lib/frise-periodisation.ts` ; ce fichier ne fait que dessiner.
 *
 *  ⚠️ LA COULEUR DIT LE TYPE DE BLOC (`--block-*`), plus son rang : l'ancienne
 *  palette tournait par index, et « Bloc 1 » apparaissait en deux couleurs. */

/* --------------------------------------------------------------------------- */
/* Vocabulaire commun                                                           */
/* --------------------------------------------------------------------------- */

const PX_JOUR_MIN = 3.4;      // l'échelle plancher de la frise : ~1 240 px pour une année
const GOUTTIERE = 188;        // la colonne des macros, ET des couloirs
const PAS_JOUR = 34;          // 2b : une case de 30 px + 4 px d'espace

const couleurDuType = (type: TypeDeBloc) => `var(--block-${type})`;
const COULEUR_EVENEMENT = 'var(--evenement)';
const teinte = (couleur: string, pct: number) => `color-mix(in oklch, ${couleur} ${pct}%, transparent)`;
const fondDuType = (type: TypeDeBloc): CSSProperties => ({
  backgroundColor: teinte(couleurDuType(type), 18),
  borderColor: teinte(couleurDuType(type), 45),
});

/** « 17 sept. » — le mois dans la langue de l'écran, le jour en chiffres. */
const jourCourt = (iso: ISO) => new Intl.DateTimeFormat(i18n.language || 'fr', {
  day: 'numeric', month: 'short', timeZone: 'UTC',
}).format(new Date(`${iso}T00:00:00Z`));
const plage = (debut: ISO, fin: ISO) => (debut === fin ? jourCourt(debut) : `${jourCourt(debut)} → ${jourCourt(fin)}`);
/** L M M J V S D, dans la langue de l'écran : l'initiale du jour. */
const lettreDuJour = (iso: ISO) => new Intl.DateTimeFormat(i18n.language || 'fr', {
  weekday: 'narrow', timeZone: 'UTC',
}).format(new Date(`${iso}T00:00:00Z`)).toUpperCase();

function useNomDuBloc() {
  const { t } = useTranslation();
  return (b: Pick<BandeDeBloc, 'nom' | 'numero'>) => b.nom || t('periodization.blocN', { n: b.numero });
}

/** Les clés en toutes lettres : une clé fabriquée dans un gabarit échappe au
 *  relevé des appels de traduction. */
const CLE_DU_TYPE: Record<TypeDeBloc, string> = {
  accumulation: 'periodization.typeAccumulation',
  intensification: 'periodization.typeIntensification',
  realisation: 'periodization.typeRealisation',
  deload: 'periodization.typeDecharge',
};

const ETIQUETTE = 'font-display text-[10px] font-bold uppercase tracking-[0.12em]';

/* --------------------------------------------------------------------------- */
/* L'écran                                                                      */
/* --------------------------------------------------------------------------- */

export function FriseDePeriodisation({
  macros, evenements, aujourdhui, peutSaisir, onSaisir, onCompetition, onBloc, onEvenement,
}: {
  macros: MacroDeStructure[];
  evenements: EvenementDeFrise[];
  aujourdhui: ISO;
  peutSaisir: boolean;
  /** Ouvre le formulaire d'événement, prérempli avec cette plage. */
  onSaisir: (debut: ISO, fin: ISO) => void;
  onCompetition: (competitionId: string) => void;
  /** ⚠️ TOUT CE QUI DÉSIGNE UN OBJET Y MÈNE (William, 16/09). Un bloc ouvre
   *  l'Entraînement sur sa semaine — celle d'aujourd'hui s'il est en cours. */
  onBloc: (bloc: BandeDeBloc) => void;
  /** Un événement du calendrier ouvre son formulaire, en édition. */
  onEvenement: (id: string) => void;
}) {
  const { t } = useTranslation();
  const lignes = useMemo(() => lignesDeMacro(macros, aujourdhui), [macros, aujourdhui]);
  const axe = useMemo(() => axeDeLaFrise(lignes, evenements, aujourdhui), [lignes, evenements, aujourdhui]);
  const sit = useMemo(() => situation(lignes, evenements, aujourdhui), [lignes, evenements, aujourdhui]);
  const zoom = useMemo(() => zoomDeSemaines(lignes, evenements, aujourdhui), [lignes, evenements, aujourdhui]);
  const jalons = useMemo(() => jalonsAVenir(lignes, evenements, aujourdhui), [lignes, evenements, aujourdhui]);

  if (lignes.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        {t('periodization.aucuneSemaineDatee')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Bandeau sit={sit} onBloc={onBloc} onCompetition={onCompetition} onEvenement={onEvenement} />
      <Frise lignes={lignes} axe={axe} evenements={evenements} aujourdhui={aujourdhui}
             onCompetition={onCompetition} onBloc={onBloc} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Zoom lignes={zoom} peutSaisir={peutSaisir} onSaisir={onSaisir} aujourdhui={aujourdhui} onBloc={onBloc} />
        <Jalons jalons={jalons} aujourdhui={aujourdhui} onBloc={onBloc} onCompetition={onCompetition} onEvenement={onEvenement} />
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------- */
/* Le bandeau de situation — trois natures sans rapport : trois cartes (§3)     */
/* --------------------------------------------------------------------------- */

/** Une carte du bandeau. Cliquable quand elle DÉSIGNE quelque chose : la flèche
 *  le dit, et le cadre réagit — l'or reste réservé à la valeur qu'elle porte. */
function Carte({ couleur, etiquette, titre, ligne1, ligne2, onClick, titreDuLien }: {
  couleur: string; etiquette: string; titre: string; ligne1?: string; ligne2?: string;
  onClick?: () => void; titreDuLien?: string;
}) {
  const contenu = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className={cn(ETIQUETTE, 'text-muted-foreground')}>{etiquette}</div>
        {onClick && <ArrowUpRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      </div>
      <div className="mt-1 truncate font-display text-lg font-bold leading-tight">{titre}</div>
      {ligne1 && <div className="mt-0.5 truncate font-mono text-[12px] text-gold">{ligne1}</div>}
      {ligne2 && <div className="truncate font-mono text-[11px] text-muted-foreground">{ligne2}</div>}
    </>
  );
  const classe = 'w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-left';
  const style = { boxShadow: `inset 3px 0 0 ${couleur}` };
  return onClick
    ? <button type="button" onClick={onClick} title={titreDuLien}
              className={cn(classe, 'transition-colors hover:border-gold/60')} style={style}>{contenu}</button>
    : <div className={classe} style={style}>{contenu}</div>;
}

function Bandeau({ sit, onBloc, onCompetition, onEvenement }: {
  sit: ReturnType<typeof situation>;
  onBloc: (bloc: BandeDeBloc) => void;
  onCompetition: (competitionId: string) => void;
  onEvenement: (id: string) => void;
}) {
  const { t } = useTranslation();
  const nomDuBloc = useNomDuBloc();
  const { position: p, prochaineCompetition: c, prochainEvenement: e } = sit;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Carte
        couleur={p ? couleurDuType(p.bloc.type) : 'var(--border)'}
        etiquette={t('periodization.position')}
        onClick={p ? () => onBloc(p.bloc) : undefined}
        titreDuLien={t('periodization.ouvrirLeBloc')}
        titre={p ? `${p.bloc.macroNom || t('periodization.macroN', { n: p.bloc.macroNumero })} · ${nomDuBloc(p.bloc)}` : t('periodization.horsProgramme')}
        ligne1={p ? [
          p.semaine ? t('periodization.semaineSurN', { rang: p.rangSemaine, n: p.nbSemaines }) : t('periodization.entreDeuxSemaines'),
          p.semaine ? t('periodization.nJours', { count: p.semaine.duree }) : null,
          t(CLE_DU_TYPE[p.bloc.type]),
        ].filter(Boolean).join(' · ') : undefined}
        ligne2={p ? t('periodization.joursDeBlocRestants', { count: p.joursRestants }) : undefined}
      />
      <Carte
        couleur="var(--destructive)"
        etiquette={t('periodization.prochaineCompetition')}
        onClick={c?.evenement.competitionId ? () => onCompetition(c.evenement.competitionId!) : undefined}
        titreDuLien={t('periodization.ouvrirLaCompetition')}
        titre={c ? c.evenement.nom : t('periodization.aucune')}
        ligne1={c ? `${jourCourt(c.evenement.debut)} · ${t('periodization.dansNJours', { count: c.dansJours })}` : undefined}
        ligne2={c ? t('periodization.semainesDePrepa', { count: c.semainesDePrepa }) : undefined}
      />
      <Carte
        couleur={COULEUR_EVENEMENT}
        etiquette={t('periodization.prochainEvenement')}
        onClick={e ? () => onEvenement(e.evenement.id) : undefined}
        titreDuLien={t('periodization.ouvrirLEvenement')}
        titre={e ? e.evenement.nom : t('periodization.aucun')}
        ligne1={e ? `${plage(e.evenement.debut, e.evenement.fin)} · ${t('periodization.dansNJours', { count: e.dansJours })}` : undefined}
        ligne2={e ? t('periodization.joursTouches', { count: e.joursTouches }) : undefined}
      />
    </div>
  );
}

/* --------------------------------------------------------------------------- */
/* 2a — la frise                                                                */
/* --------------------------------------------------------------------------- */

/** La colonne gauche — macros et couloirs. Collante : elle reste visible quand la
 *  frise défile sous le téléphone. */
function Gouttiere({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('sticky left-0 z-20 flex shrink-0 flex-col justify-center border-r border-border/60 bg-card px-3', className)}
         style={{ width: GOUTTIERE }}>
      {children}
    </div>
  );
}

function Frise({ lignes, axe, evenements, aujourdhui, onCompetition, onBloc }: {
  lignes: LigneDeMacro[]; axe: Axe; evenements: EvenementDeFrise[]; aujourdhui: ISO;
  onCompetition: (competitionId: string) => void;
  onBloc: (bloc: BandeDeBloc) => void;
}) {
  const { t } = useTranslation();
  const nomDuBloc = useNomDuBloc();
  // L'échelle REMPLIT la carte quand le programme est court — trois semaines sur
  // 1 240 px n'occuperaient qu'un coin —, et défile au-delà d'une année.
  const cadre = useRef<HTMLDivElement>(null);
  const [disponible, setDisponible] = useState(0);
  useEffect(() => {
    const el = cadre.current;
    if (!el) return;
    const mesurer = () => setDisponible(el.clientWidth - GOUTTIERE);
    mesurer();
    const obs = new ResizeObserver(mesurer);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  const pxJour = Math.max(PX_JOUR_MIN, disponible / axe.jours);
  const largeur = axe.jours * pxJour;
  const px = (jours: number) => jours * pxJour;
  const xAujourdhui = ecartEnJours(axe.debut, aujourdhui);
  const recouvrements = useMemo(() => chevauchements(lignes), [lignes]);
  const recouvrementsDe = (blocId: string) => recouvrements.filter(c => c.a.id === blocId || c.b.id === blocId);
  const moisCourant = aujourdhui.slice(0, 7);
  const competitions = evenements.filter(e => e.nature === 'competition' && e.fin >= axe.debut && e.debut <= axe.fin)
    .sort((a, b) => a.debut.localeCompare(b.debut));
  // Les étiquettes se rangent sur des NIVEAUX : la première ligne où elles ne
  // croisent aucune voisine. La largeur est estimée (≈ 6,5 px par caractère,
  // plus l'épingle et la date) ; une erreur de quelques pixels ne se voit pas,
  // un chevauchement si. Dans le dernier cinquième de l'axe, l'étiquette s'ancre
  // à GAUCHE de l'épingle : elle sortirait sinon de la carte.
  const epingles = (() => {
    const occupes: [number, number][][] = [];
    return competitions.map(c => {
      const x = px(ecartEnJours(axe.debut, c.debut));
      const w = c.nom.length * 6.5 + 70;
      const aGauche = x + w > largeur;
      const [g, d] = aGauche ? [x - w, x + 4] : [x - 4, x + w];
      const libre = (niveau: [number, number][]) => niveau.every(([g2, d2]) => d + 8 <= g2 || d2 + 8 <= g);
      let niveau = occupes.findIndex(libre);
      if (niveau < 0) { niveau = occupes.length; occupes.push([]); }
      occupes[niveau].push([g, d]);
      return { c, x, aGauche, niveau };
    });
  })();
  const niveaux = Math.max(1, ...epingles.map(e => e.niveau + 1));
  const autres = evenements.filter(e => e.nature === 'evenement' && e.fin >= axe.debut && e.debut <= axe.fin);

  // Le défilement s'ouvre sur aujourd'hui : sur un programme de deux ans, la
  // frise commencerait sinon il y a deux ans.
  useEffect(() => {
    const el = cadre.current;
    if (el) el.scrollLeft = Math.max(0, GOUTTIERE + px(xAujourdhui) - el.clientWidth * 0.6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axe.debut]);

  return (
    <section className="rounded-xl border border-border bg-card">
      <div ref={cadre} className="overflow-x-auto">
        <div className="relative" style={{ width: GOUTTIERE + largeur }}>
          {/* La réglette des mois */}
          <div className="flex border-b border-border/70">
            <Gouttiere className="h-8"><span /></Gouttiere>
            <div className="relative h-8" style={{ width: largeur }}>
              {axe.mois.map(m => (
                <span key={m.iso}
                      className={cn(ETIQUETTE, 'absolute inset-y-0 flex items-center border-l border-border/60 pl-1.5',
                                    m.iso.slice(0, 7) === moisCourant ? 'text-gold' : 'text-muted-foreground')}
                      style={{ left: px(m.x), width: px(m.largeur) }}>
                  {new Intl.DateTimeFormat(i18n.language || 'fr', { month: 'short', timeZone: 'UTC' }).format(new Date(`${m.iso}T00:00:00Z`))}
                </span>
              ))}
            </div>
          </div>

          {/* Une ligne par macrocycle */}
          {lignes.map(l => {
            const enCours = l.blocs.some(b => b.courant);
            return (
              <div key={l.id} className="flex border-b border-border/40">
                <Gouttiere className="h-14" >
                  <div className="flex items-baseline gap-1.5 truncate">
                    <span className="font-mono text-[11px] text-muted-foreground">M{l.numero}</span>
                    <span className={cn('truncate text-[13px] font-semibold', enCours ? 'text-foreground' : 'text-muted-foreground')}>
                      {l.nom || t('periodization.macroN', { n: l.numero })}
                    </span>
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">{plage(l.debut, l.fin)}</div>
                </Gouttiere>
                <div className="relative h-14" style={{ width: largeur }}>
                  {l.blocs.map((b, i) => {
                    const { x, largeur: j } = placer(axe, b.debut, b.fin);
                    const suivant = l.blocs[i + 1];
                    const trou = suivant ? ecartEnJours(b.fin, suivant.debut) - 1 : 0;
                    return (
                      <div key={b.id}>
                        <BulleDuBloc bloc={b} onOuvrir={() => onBloc(b)} recouvrements={recouvrementsDe(b.id)}
                          className={cn('absolute top-1.5 bottom-1.5 overflow-hidden rounded-md border text-left',
                                        b.courant && 'ring-2 ring-gold')}
                          style={{ left: px(x), width: px(j), ...fondDuType(b.type) }}>
                          <div className="flex h-[22px] items-center gap-1.5 px-1.5">
                            <span aria-hidden className="h-[3px] w-2.5 shrink-0 rounded-full" style={{ backgroundColor: couleurDuType(b.type) }} />
                            <span className="truncate font-display text-[11px] font-bold">{nomDuBloc(b)}</span>
                          </div>
                          {/* Les semaines RÉELLES, depuis leurs dates : une semaine de 9 jours est plus large. */}
                          {b.semaines.map(s => {
                            const sx = ecartEnJours(b.debut, s.debut);
                            const sl = px(s.duree);
                            return (
                              <span key={s.numero}
                                    title={`S${s.numero} · ${plage(s.debut, s.fin)} · ${t('periodization.nJours', { count: s.duree })}`}
                                    className={cn('absolute bottom-0 flex h-[18px] items-center justify-center border-l border-border/60 font-mono text-[10px]',
                                                  s.courante ? 'bg-gold/20 font-semibold text-gold'
                                                    : s.duree !== 7 ? 'text-gold' : 'text-muted-foreground')}
                                    style={{ left: px(sx), width: sl }}>
                                {sl >= 11 ? s.numero : ''}
                              </span>
                            );
                          })}
                        </BulleDuBloc>
                        {/* Un trou entre deux blocs se DESSINE : en tirets, ce qui n'existe pas. */}
                        {trou > 0 && (
                          <span aria-hidden title={t('periodization.nJoursHorsProgramme', { count: trou })}
                                className="absolute top-3 bottom-3 rounded border border-dashed border-border"
                                style={{ left: px(x + j), width: px(trou) }} />
                        )}
                      </div>
                    );
                  })}
                  {/* ⚠️ LE RECOUVREMENT SE VOIT, PAR-DESSUS LES DEUX BANDES (16/09).
                      Hachures rouges sur les jours communs, dessinées sur CHAQUE
                      ligne concernée — deux macros qui se recouvrent se lisent
                      sinon comme deux lignes sans rapport. Ce n'est pas un refus :
                      c'est l'erreur de saisie rendue visible au coach qui rattrape
                      ses dates. */}
                  {recouvrements.filter(c => c.a.macroId === l.id || c.b.macroId === l.id).map(c => {
                    const { x, largeur: j } = placer(axe, c.debut, c.fin);
                    return (
                      <span key={`${c.a.id}-${c.b.id}`} data-chevauchement
                            title={t('periodization.chevauchement', { a: nomDuBloc(c.a), b: nomDuBloc(c.b), count: c.jours })}
                            className="absolute top-0.5 bottom-0.5 z-[5] rounded-sm border-2 border-destructive"
                            style={{
                              left: px(x), width: Math.max(px(j), 6),
                              backgroundImage: 'repeating-linear-gradient(135deg, color-mix(in oklch, var(--destructive) 55%, transparent) 0 3px, transparent 3px 7px)',
                            }} />
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Couloir des compétitions */}
          <div className="flex border-b border-border/40">
            <Gouttiere><span className={cn(ETIQUETTE, 'text-muted-foreground')}>{t('periodization.competitions')}</span></Gouttiere>
            <div data-couloir-competitions className="relative" style={{ width: largeur, height: 16 + niveaux * 22 }}>
              {epingles.map(({ c, x, aGauche, niveau }) => (
                <FicheDeCompetition key={c.id} competition={c} aujourdhui={aujourdhui} onOuvrir={onCompetition}
                                    aGauche={aGauche}
                                    style={{ top: 8 + niveau * 22, left: aGauche ? undefined : x - 4, right: aGauche ? largeur - x - 4 : undefined }} />
              ))}
            </div>
          </div>

          {/* Couloir des événements : la plage réelle, pas une épingle */}
          <div className="flex">
            <Gouttiere className="h-12"><span className={cn(ETIQUETTE, 'text-muted-foreground')}>{t('periodization.evenements')}</span></Gouttiere>
            <div className="relative h-12" style={{ width: largeur }}>
              {autres.map(e => {
                const { x, largeur: j } = placer(axe, e.debut, e.fin);
                return (
                  <span key={e.id} title={`${e.nom} · ${plage(e.debut, e.fin)}`}
                        className="absolute top-3 flex h-6 items-center justify-center overflow-hidden rounded border text-[11px]"
                        style={{ left: px(x), width: Math.max(px(j), 14), backgroundColor: teinte(COULEUR_EVENEMENT, 22), borderColor: teinte(COULEUR_EVENEMENT, 55) }}>
                    {e.emoji}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Aujourd'hui : un trait doré qui traverse tout, sa date en pastille */}
          {xAujourdhui >= 0 && xAujourdhui < axe.jours && (
            <span aria-hidden className="pointer-events-none absolute top-8 bottom-0 z-10 w-px bg-gold"
                  style={{ left: GOUTTIERE + px(xAujourdhui) + pxJour / 2 }} />
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-t border-border/70 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
          {(['accumulation', 'intensification', 'realisation', 'deload'] as TypeDeBloc[]).map(type => (
            <span key={type} className="flex items-center gap-1.5">
              <span aria-hidden className="h-[3px] w-3 rounded-full" style={{ backgroundColor: couleurDuType(type) }} />
              {t(CLE_DU_TYPE[type])}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-full bg-destructive" />{t('periodization.competition')}
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-3.5 rounded-sm border"
                  style={{ backgroundColor: teinte(COULEUR_EVENEMENT, 22), borderColor: teinte(COULEUR_EVENEMENT, 55) }} />
            {t('periodization.evenement')}
          </span>
          {recouvrements.length > 0 && (
            <span className="flex items-center gap-1.5 font-medium text-destructive">
              <span aria-hidden className="h-2.5 w-3.5 rounded-sm border-2 border-destructive"
                    style={{ backgroundImage: 'repeating-linear-gradient(135deg, color-mix(in oklch, var(--destructive) 55%, transparent) 0 2px, transparent 2px 5px)' }} />
              {t('periodization.nChevauchements', { count: recouvrements.length })}
            </span>
          )}
        </div>
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          <span aria-hidden className="h-3 w-px bg-gold" />
          {t('periodization.aujourdhuiLe', { date: jourCourt(aujourdhui) })}
        </span>
      </div>
    </section>
  );
}


/** LES OBJECTIFS DU BLOC, AU SURVOL (William, 16/09). Ils vivaient dans l'onglet
 *  Périodisation, qui disparaît : la frise doit donc les porter. Une infobulle
 *  plutôt qu'une carte dépliée — le bloc fait parfois 20 px de large, et la
 *  frise ne doit pas devenir un mur de texte.
 *
 *  ⚠️ ELLE S'OUVRE AUSSI AU CLAVIER : `TooltipTrigger` sur un `<button>`, donc
 *  au focus. Un survol seul laisserait les objectifs hors d'atteinte de qui
 *  navigue à la tabulation. */
function BulleDuBloc({ bloc, children, className, style, onOuvrir, recouvrements }: {
  bloc: BandeDeBloc; children: ReactNode; className?: string; style?: CSSProperties; onOuvrir: () => void;
  recouvrements: Chevauchement[];
}) {
  const { t } = useTranslation();
  const nomDuBloc = useNomDuBloc();
  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        {/* ⚠️ LE DÉCLENCHEUR EST LA BANDE ELLE-MÊME. Enveloppée dans un
            `display: contents`, elle n'avait pas de boîte à mesurer : l'infobulle
            s'ouvrait dans le coin haut gauche de la page. */}
        <TooltipTrigger asChild>
          <button type="button" data-bloc={bloc.id} className={className} style={style} onClick={onOuvrir}>{children}</button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start"
                        className="max-w-[380px] rounded-lg border border-border bg-card px-3 py-2.5 text-foreground shadow-lg">
          <div className="flex items-center gap-2">
            <span aria-hidden className="h-[3px] w-3 rounded-full" style={{ backgroundColor: couleurDuType(bloc.type) }} />
            <span className="font-display text-[13px] font-bold">{nomDuBloc(bloc)}</span>
            <span className="text-[11px] text-muted-foreground">{t(CLE_DU_TYPE[bloc.type])}</span>
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            {plage(bloc.debut, bloc.fin)} · {t('periodization.nSemaines', { count: bloc.semaines.length })}
          </div>
          {recouvrements.map(c => (
            <p key={`${c.a.id}-${c.b.id}`} className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 text-[12px] font-medium text-destructive">
              <span aria-hidden>⚠</span>
              {t('periodization.chevaucheAvec', { autre: nomDuBloc(c.a.id === bloc.id ? c.b : c.a), count: c.jours })}
              <span className="whitespace-nowrap font-mono text-[11px]">· {plage(c.debut, c.fin)}</span>
            </p>
          ))}
          <div className={cn(ETIQUETTE, 'mt-2 text-muted-foreground')}>{t('periodization.objectifsDuBloc')}</div>
          {bloc.objectifs.length === 0 ? (
            <p className="mt-1 text-[12px] text-muted-foreground">{t('periodization.pasDObjectifsRenseignes')}</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-0.5">
              {bloc.objectifs.map((o, i) => (
                <li key={i} className="flex items-baseline gap-1.5 text-[12px]">
                  {/* Atteint : la marque est un signe, pas une encre pâlie. */}
                  <span aria-hidden className={cn('font-mono text-[11px]', o.atteint ? 'text-success' : 'text-muted-foreground')}>
                    {o.atteint ? '✓' : '·'}
                  </span>
                  <span className="font-medium uppercase tracking-tight">{o.exercice}</span>
                  {o.variante && <span className="text-[11px] text-muted-foreground">{o.variante}</span>}
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {[o.format, o.series && o.reps ? `${o.series}×${o.reps}` : o.reps].filter(Boolean).join(' ')}
                  </span>
                  {(o.chargeMin || o.chargeMax) && (
                    <span className="font-mono text-[11px] text-gold">
                      {o.chargeMax && o.chargeMax !== o.chargeMin ? `${o.chargeMin}-${o.chargeMax}` : o.chargeMin} kg
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 flex items-center gap-1 text-[11px] text-gold">
            <ArrowUpRight aria-hidden className="h-3 w-3" /> {t('periodization.ouvrirLeBloc')}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** UNE COMPÉTITION SE CLIQUE, ET LE DIT (William, 16/09 : « le rendu est
 *  confusant ; un signe que c'est cliquable, puis une popup avec de quoi aller
 *  vers l'élément »). L'épingle porte donc un contour et un soulignement en
 *  pointillés ; le détail et le lien vers la fiche vivent dans la popup, ce qui
 *  raccourcit l'étiquette et desserre le couloir. */
function FicheDeCompetition({ competition: c, aujourdhui, onOuvrir, aGauche, style }: {
  competition: EvenementDeFrise; aujourdhui: ISO; onOuvrir: (id: string) => void;
  aGauche: boolean; style: CSSProperties;
}) {
  const { t } = useTranslation();
  const passee = c.fin < aujourdhui;
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button type="button" style={style}
                className={cn('absolute flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] transition-colors hover:border-gold hover:text-gold',
                              aGauche && 'flex-row-reverse',
                              passee ? 'border-border/70 text-muted-foreground' : 'border-destructive/50 text-foreground')}>
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: passee ? 'var(--muted-foreground)' : 'var(--destructive)' }} />
          <span className="max-w-[160px] truncate font-medium">{c.nom}</span>
          <span className="font-mono text-[10px] text-muted-foreground">{jourCourt(c.debut)}</span>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content side="bottom" align={aGauche ? 'end' : 'start'} sideOffset={6}
                                  className="z-50 w-[248px] rounded-lg border border-border bg-card p-3 shadow-lg">
          <div className="flex items-center gap-2">
            <span aria-hidden>⚔️</span>
            <span className="font-display text-[14px] font-bold leading-tight">{c.nom}</span>
          </div>
          <div className="mt-1 font-mono text-[11px] text-muted-foreground">{plage(c.debut, c.fin)}</div>
          <div className="mt-0.5 font-mono text-[11px] text-gold">
            {passee ? t('periodization.passee')
              : ecartEnJours(aujourdhui, c.debut) === 0 ? t('periodization.aujourdhui')
              : t('periodization.dansNJours', { count: Math.max(0, ecartEnJours(aujourdhui, c.debut)) })}
          </div>
          {c.competitionId ? (
            <button type="button" onClick={() => onOuvrir(c.competitionId!)}
                    className="mt-2.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-gold text-xs font-semibold text-gold-foreground hover:bg-gold/90">
              {t('periodization.ouvrirLaCompetition')} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            // Une compétition SAISIE À LA MAIN dans le calendrier n'a pas de fiche :
            // ne pas proposer un lien qui ne mène nulle part.
            <p className="mt-2 text-[11px] text-muted-foreground">{t('periodization.evenementDuCalendrier')}</p>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/* --------------------------------------------------------------------------- */
/* 2b — le zoom : une ligne = une semaine réelle                                */
/* --------------------------------------------------------------------------- */

function Zoom({ lignes, peutSaisir, onSaisir, aujourdhui, onBloc }: {
  lignes: LigneDuZoom[]; peutSaisir: boolean; onSaisir: (debut: ISO, fin: ISO) => void; aujourdhui: ISO;
  onBloc: (bloc: BandeDeBloc) => void;
}) {
  const { t } = useTranslation();
  const nomDuBloc = useNomDuBloc();

  // Cliquer, ou glisser, sur des jours : la plage choisie ouvre le formulaire.
  const [ancre, setAncre] = useState<ISO | null>(null);
  const [survol, setSurvol] = useState<ISO | null>(null);
  const [d1, d2] = ancre && survol ? [ancre, survol].sort() : [null, null];
  useEffect(() => {
    if (!ancre) return;
    const lacher = () => {
      const [a, b] = [ancre, survol ?? ancre].sort();
      setAncre(null); setSurvol(null);
      onSaisir(a, b);
    };
    window.addEventListener('pointerup', lacher);
    return () => window.removeEventListener('pointerup', lacher);
  }, [ancre, survol, onSaisir]);

  const semaines = lignes.filter((l): l is Extract<LigneDuZoom, { nature: 'semaine' }> => l.nature === 'semaine');
  const horsFormat = semaines.filter(l => l.semaine.duree !== 7).length;

  return (
    <section className="min-w-0 rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <h2 className={cn(ETIQUETTE, 'text-[11px] text-muted-foreground')}>{t('periodization.semainesEnCours')}</h2>
        {peutSaisir && (
          <button type="button" onClick={() => onSaisir(aujourdhui, aujourdhui)}
                  className="flex h-8 items-center gap-1 rounded-md border border-gold/50 px-2.5 text-xs font-medium text-gold hover:bg-gold/10">
            <Plus className="h-3.5 w-3.5" /> {t('periodization.saisirUnEvenement')}
          </button>
        )}
      </header>

      {lignes.length === 0 ? (
        <p className="border-t border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">{t('periodization.aucuneSemaineDatee')}</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-max">
            <div className="grid grid-cols-[200px_1fr_72px] items-center border-y border-border/70 px-4 py-1.5">
              <span className={cn(ETIQUETTE, 'text-muted-foreground')}>{t('periodization.semaineReelle')}</span>
              <span className={cn(ETIQUETTE, 'text-muted-foreground')}>{t('periodization.joursLargeurDuree')}</span>
              <span className={cn(ETIQUETTE, 'text-right text-muted-foreground')}>{t('periodization.evenementsAbrege')}</span>
            </div>
            {lignes.map(l => l.nature === 'trou' ? (
              <div key={`trou-${l.debut}`} className="grid grid-cols-[200px_1fr_72px] items-center border-b border-border/40 px-4 py-2">
                <span className="font-mono text-[11px] text-muted-foreground">{t('periodization.horsProgramme')}</span>
                <span className="flex h-7 w-fit items-center whitespace-nowrap rounded border border-dashed border-border px-2 font-mono text-[10px] text-muted-foreground"
                      style={{ minWidth: l.duree * PAS_JOUR - 4 }}>
                  {t('periodization.nJoursHorsProgramme', { count: l.duree })} — {plage(l.debut, l.fin)}
                </span>
                <span />
              </div>
            ) : (
              <div key={`${l.bloc.id}-${l.semaine.numero}`}
                   className={cn('grid grid-cols-[200px_1fr_72px] items-center border-b border-border/40 px-4 py-2',
                                 l.semaine.courante && 'bg-accent/40')}>
                <div className="min-w-0 border-l-[3px] pl-2.5" style={{ borderColor: couleurDuType(l.bloc.type) }}>
                  <div className="flex items-baseline gap-1.5">
                    {/* Le nom mène au bloc, dans l'Entraînement. */}
                    <button type="button" onClick={() => onBloc(l.bloc)} title={t('periodization.ouvrirLeBloc')}
                            className="truncate text-[13px] font-semibold hover:text-gold">{nomDuBloc(l.bloc)}</button>
                    <span className={cn('font-mono text-[11px]', l.semaine.courante ? 'text-gold' : 'text-muted-foreground')}>S{l.semaine.numero}</span>
                    {/* La durée ÉCRITE, en or quand elle sort du format de 7 jours. */}
                    <span className={cn('rounded-sm border px-1 font-mono text-[10px]',
                                        l.semaine.duree !== 7 ? 'border-gold/60 text-gold' : 'border-border text-muted-foreground')}>
                      {t('periodization.nJours', { count: l.semaine.duree })}
                    </span>
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">{plage(l.semaine.debut, l.semaine.fin)}</div>
                  <div className="text-[10px] text-muted-foreground">{t(CLE_DU_TYPE[l.bloc.type])}</div>
                </div>
                <div className="flex gap-1" style={{ width: l.jours.length * PAS_JOUR - 4 }}>
                  {l.jours.map(j => {
                    const choisi = d1 !== null && d2 !== null && d1 <= j.iso && j.iso <= d2;
                    const couleur = j.indisponible ? COULEUR_EVENEMENT : couleurDuType(l.bloc.type);
                    return (
                      <button key={j.iso} type="button" disabled={!peutSaisir} data-jour={j.iso}
                              title={[jourCourt(j.iso), ...j.evenements.map(e => `${e.emoji} ${e.nom}`)].join(' · ')}
                              onPointerDown={e => { if (!peutSaisir) return; e.preventDefault(); setAncre(j.iso); setSurvol(j.iso); }}
                              onPointerEnter={() => ancre && setSurvol(j.iso)}
                              className={cn('relative flex h-10 w-[30px] shrink-0 select-none flex-col items-center justify-center rounded border',
                                            j.aujourdhui && 'border-2 !border-gold',
                                            choisi && 'ring-2 ring-gold')}
                              style={{ backgroundColor: teinte(couleur, j.indisponible ? 30 : 16), borderColor: teinte(couleur, 50) }}>
                        <span className={cn('font-display text-[9px] font-bold leading-none', j.weekEnd ? 'text-muted-foreground' : 'text-foreground')}>
                          {lettreDuJour(j.iso)}
                        </span>
                        <span className={cn('mt-0.5 font-mono text-[11px] leading-none', j.aujourdhui ? 'font-semibold text-gold' : 'text-foreground')}>
                          {Number(j.iso.slice(8))}
                        </span>
                        {j.evenements.length > 0 && (
                          <span aria-hidden className="absolute -bottom-1.5 text-[9px] leading-none">{j.evenements[0].emoji}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-col items-end gap-0.5 text-[11px]">
                  {l.evenements.map(e => (
                    <span key={e.id} title={e.nom} className="whitespace-nowrap">
                      {e.emoji}{dureeEnJours(e.debut, e.fin) > 1 && (
                        <span className="ml-1 font-mono text-[10px] text-muted-foreground">{t('periodization.nJours', { count: dureeEnJours(e.debut, e.fin) })}</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {horsFormat > 0 && (
        <p className="flex items-center gap-2 px-4 py-2.5 text-[11px] text-muted-foreground">
          <span className="rounded-sm border border-gold/60 px-1 font-mono text-[10px] text-gold">{t('periodization.horsFormat')}</span>
          {t('periodization.dureeHorsFormat', { count: horsFormat, total: semaines.length })}
        </p>
      )}
    </section>
  );
}

/* --------------------------------------------------------------------------- */
/* 2c — les jalons à venir : des éléments homogènes, une liste (§3)             */
/* --------------------------------------------------------------------------- */

function Jalons({ jalons, aujourdhui, onBloc, onCompetition, onEvenement }: {
  jalons: Jalon[]; aujourdhui: ISO;
  onBloc: (bloc: BandeDeBloc) => void;
  onCompetition: (competitionId: string) => void;
  onEvenement: (id: string) => void;
}) {
  const { t } = useTranslation();
  const nomDuBloc = useNomDuBloc();
  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between px-4 py-3">
        <h2 className={cn(ETIQUETTE, 'text-[11px] text-muted-foreground')}>{t('periodization.prochainement')}</h2>
        <span className="font-mono text-[11px] text-muted-foreground">{jourCourt(aujourdhui)}</span>
      </header>
      {jalons.length === 0 ? (
        <p className="border-t border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">{t('periodization.aucunJalon')}</p>
      ) : (
        <ul className="border-t border-border/70">
          {jalons.map(j => {
            const cle = `${j.nature}-${j.date}-${'bloc' in j ? j.bloc.id : j.evenement.id}`;
            let glyphe: ReactNode;
            let titre: string;
            let detail: string;
            if (j.nature === 'debut-bloc' || j.nature === 'fin-bloc') {
              glyphe = <span aria-hidden className={cn('block h-2.5 w-2.5', j.nature === 'fin-bloc' ? 'rounded-sm border-2 bg-transparent' : 'rounded-sm')}
                             style={j.nature === 'fin-bloc' ? { borderColor: couleurDuType(j.bloc.type) } : { backgroundColor: couleurDuType(j.bloc.type) }} />;
              const macro = j.bloc.macroNom || t('periodization.macroN', { n: j.bloc.macroNumero });
              titre = t(j.nature === 'debut-bloc' ? 'periodization.debutDe' : 'periodization.finDe', { nom: nomDuBloc(j.bloc) });
              detail = j.nature === 'debut-bloc'
                ? `${macro} · ${t(CLE_DU_TYPE[j.bloc.type])} · ${t('periodization.nSemaines', { count: j.bloc.semaines.length })}`
                : macro;
            } else {
              glyphe = <span aria-hidden className="text-sm leading-none">{j.evenement.emoji}</span>;
              titre = j.evenement.nom;
              detail = j.nature === 'competition'
                ? (j.blocPendant
                  ? t('periodization.pendant', { bloc: nomDuBloc(j.blocPendant), type: t(CLE_DU_TYPE[j.blocPendant.type]) })
                  : t('periodization.horsBloc'))
                : `${plage(j.evenement.debut, j.evenement.fin)} · ${t('periodization.nJours', { count: dureeEnJours(j.evenement.debut, j.evenement.fin) })}`;
            }
            // Chaque jalon MÈNE à son objet : le bloc dans l'Entraînement, la
            // compétition à sa fiche, l'événement à son formulaire.
            const ouvrir = 'bloc' in j ? () => onBloc(j.bloc)
              : j.evenement.competitionId ? () => onCompetition(j.evenement.competitionId!)
              : j.nature === 'evenement' ? () => onEvenement(j.evenement.id)
              : undefined;
            return (
              <li key={cle}>
              <button type="button" onClick={ouvrir} disabled={!ouvrir}
                      className="flex w-full items-center gap-3 border-b border-border/40 px-4 py-2.5 text-left last:border-b-0 enabled:hover:bg-accent/40">
                <span className="flex w-4 shrink-0 justify-center">{glyphe}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{titre}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{detail}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-[12px]">{jourCourt(j.date)}</div>
                  <div className={cn('font-mono text-[11px]', j.dansJours <= 7 ? 'text-gold' : 'text-muted-foreground')}>
                    {j.dansJours === 0 ? t('periodization.aujourdhui') : t('periodization.dansNJours', { count: j.dansJours })}
                  </div>
                </div>
              </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
