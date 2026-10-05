import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import i18n from '@/i18n';

import { datesEnchainees } from '@/lib/program-selection';
import {
  axeRpeDuBloc, chargeAffichee, courbeDeRangee, presenceDesJours, tableauDuBloc, volumeAffiche,
} from '@/lib/bloc-tableau';
import type {
  BlocLisible, CelluleDuTableau, CourbeDeRangee, RangeeDuTableau, Tonnage,
} from '@/lib/bloc-tableau';
import { verdictDesSemainesRPE, type SemaineRPE } from '@/lib/rpe';
import { aplatsDeDepassement, chargesDeRangee, cx, rpeDeRangee, suitesContigues, yLocal } from '@/lib/pistes';
import { formatShort } from '@/lib/dates-ui';
import { useIsMobile } from '@/lib/use-mobile';
import { cn } from '@/lib/utils';

/** LE BLOC D'UN COUP D'ŒIL — semaines en colonnes, mouvements en lignes (FRE-114).
 *
 *  ⚠️ EN LECTURE SEULE, ET C'EST UNE DÉCISION. Elle répond à « où en est ce
 *  bloc » pour une fraction du coût de l'édition en place — et une grille dense
 *  à double écrivain est exactement la surface où les défauts de concurrence de
 *  FRE-134 reviennent. L'édition se fait où elle se fait déjà : dans la semaine.
 *
 *  ⚠️ CE QU'ELLE RÉPARE. Aucun écran ne met deux semaines côte à côte. FRE-150 a
 *  coûté trois semaines de silence — S1 @50, S2 @55 tapé à la main, S3 sans
 *  charge — parce que le décrochage n'était visible nulle part.
 *
 *  ⚠️ ET LA LIGNE DOIT APPARTENIR À SA RANGÉE. La version précédente posait la
 *  courbe dans la GOUTTIÈRE entre deux rangées, à égale distance de celle du
 *  dessus et de celle du dessous : rien ne disait laquelle elle décrivait. Elle
 *  est maintenant DANS la bande du mouvement, sur la même grille de colonnes que
 *  les valeurs — ses points tombent sous les chiffres qu'ils encodent.
 *
 *  ⚠️ ET C'EST POURQUOI LA `<table>` A SAUTÉ. Une bande arrondie qui enferme les
 *  valeurs ET les deux pistes traverse trois `<tr>` : aucun fond ne peut en faire
 *  le tour. Les rôles ARIA restent (`table`, `row`, `columnheader`,
 *  `rowheader`, `cell`) — c'est eux qui permettent d'annoncer « SQUAT, S3 », pas
 *  les balises.
 *
 *  ⚠️ C'EST UN COMPOSANT, PLUS UNE PAGE, et c'est un retour de William : « mal
 *  placé dans l'UI, la sélection du bloc n'est pas naturelle ». Le bloc lui
 *  arrive en propriété ; il n'en choisit aucun. */
export function BlocTableau({ bloc, semaineCourante }: {
  bloc: BlocLisible;
  /** ⚠️ LE REPÈRE CHANGE AVEC LE LECTEUR, ET C'EST TOUT CE QUI LES SÉPARE. Le
   *  coach compare et projette : la première semaine sert d'origine. L'athlète
   *  se situe : c'est SA semaine qui est accentuée. Une seconde vue aurait
   *  doublé la surface pour cette seule différence. */
  semaineCourante?: number;
}) {
  const { t } = useTranslation();
  const surTelephone = useIsMobile();
  // ⚠️ MÉMOÏSÉ, SINON `?? []` REND UN TABLEAU NEUF À CHAQUE RENDU — et les
  // `useMemo` qui en dépendent se recalculeraient toujours.
  const semaines = useMemo(() => bloc.weeks ?? [], [bloc.weeks]);
  const [jour, setJour] = useState<string | null>(null);

  const tableau = useMemo(() => tableauDuBloc(bloc, jour), [bloc, jour]);
  const presence = useMemo(() => presenceDesJours(bloc), [bloc]);
  /** ⚠️ CALCULÉ SUR LE BLOC ENTIER, PAS SUR LE JOUR AFFICHÉ. Un axe qui changerait
   *  en passant de « Lundi » à « Jeudi » ferait bouger les courbes sans qu'aucune
   *  donnée n'ait changé. */
  const axeRpe = useMemo(() => axeRpeDuBloc(bloc), [bloc]);

  /** ⚠️ LES DATES DE COLONNE S'ENCHAÎNENT DEPUIS S1, elles ne se lisent pas
   *  semaine par semaine — règle de FRE-138 : une semaine sans date propre garde
   *  sa place dans la frise au lieu de laisser un trou qui n'existe pas.
   *
   *  ⚠️ MAIS UNE SEMAINE ÉTIRÉE GARDE SA DURÉE (20/09). `blockWeekDates`
   *  imposait celle de S1 à toutes : dès qu'un coach accordait trois jours de
   *  plus à S3, la frise datait S4 et les suivantes trois jours trop tôt —
   *  faux, et sans rien pour le signaler. `datesEnchainees` lit la durée de
   *  chacune et n'applique la référence qu'à celles qui n'en ont pas. */
  const dates = useMemo(() => {
    const s1 = semaines[0];
    if (!s1?.startDate) return null;
    return datesEnchainees(semaines, s1.startDate, s1.endDate ?? '');
  }, [semaines]);

  if (tableau.jours.length === 0) return <Etat texte={t('blocTableau.aucuneSeance')} />;
  const jourActif = jour && tableau.jours.includes(jour) ? jour : tableau.jours[0];

  const indexAccentue = semaineCourante === undefined
    ? 0
    : tableau.colonnes.findIndex(c => c.semaine.weekNumber === semaineCourante);

  const entete = (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <p className="font-mono text-xs text-muted-foreground">
          {t('blocTableau.resume', { semaines: semaines.length, seances: tableau.jours.length })}
        </p>
        {semaineCourante !== undefined && (
          /* ⚠️ « TU ES EN S4 » ÉTAIT JUSTE POUR L'ATHLÈTE ET FAUX POUR LES DEUX
             AUTRES. Le même écran sert désormais au coach et au kiné, qui
             regardent quelqu'un d'AUTRE : la deuxième personne du singulier les
             désigne eux. Le repère nomme donc la semaine, pas son lecteur. */
          <span className="rounded-md border border-gold px-2.5 py-1 font-display text-[11px] uppercase tracking-[0.12em] text-gold">
            {t('blocTableau.semaineEnCours', { n: semaineCourante })}
          </span>
        )}
      </div>

      {/* Le filtre par JOUR. Un jour à la fois : cinq séances sur six semaines
          feraient trente cases par mouvement, et la comparaison qu'on vient
          chercher disparaîtrait dans le nombre. */}
      <div role="tablist" aria-label={t('blocTableau.choisirLeJour')} className="flex flex-wrap gap-2">
        {tableau.jours.map(j => {
          const presentes = presence.get(j) ?? 0;
          return (
            <button
              key={j}
              type="button"
              role="tab"
              aria-selected={j === jourActif}
              onClick={() => setJour(j)}
              className={cn(
                'flex items-baseline gap-1.5 rounded-lg border px-3.5 py-1.5 font-display text-xs uppercase tracking-[0.12em] transition-colors',
                j === jourActif
                  ? 'border-gold text-gold'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {j}
              {/* ⚠️ SEULEMENT QUAND IL MANQUE UNE SEMAINE. Sur un jour présent
                  partout, « 6/6 » est du bruit — et le bruit finit par masquer
                  le cas où le compte compte vraiment. */}
              {presentes < semaines.length && (
                <span className="font-mono text-[11px] normal-case tracking-normal opacity-70">
                  {t('blocTableau.presenceJour', { presentes, total: semaines.length })}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </header>
  );

  return (
    <div className="flex flex-col gap-5">
      {entete}
      {surTelephone ? (
        <CartesDeMouvement tableau={tableau} indexAccentue={indexAccentue} />
      ) : (
        <GrilleDuBloc tableau={tableau} dates={dates} jourActif={jourActif}
                      indexAccentue={indexAccentue} axeRpe={axeRpe} />
      )}
      <Legende axeRpe={axeRpe} surTelephone={surTelephone} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* CE QU'UNE RANGÉE DONNE À TRACER                                             */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* LA GÉOMÉTRIE DES PISTES                                                     */
/* -------------------------------------------------------------------------- */

const OR = 'oklch(0.80 0.15 75)';
const BLEU = 'oklch(0.76 0.15 240)';
const GRIS = 'oklch(0.78 0.012 270)';
const ECART = 'oklch(0.80 0.15 75 / 0.4)';

/** Le SVG d'une piste : étiré en largeur, donc jamais de `<circle>` ni de trait
 *  dont l'épaisseur suive l'échelle.
 *
 *  ⚠️ `preserveAspectRatio="none"` DÉFORME TOUT CE QU'IL CONTIENT. Un cercle y
 *  devient une ellipse et un trait de 2 px en devient 6 horizontalement : d'où
 *  `vector-effect="non-scaling-stroke"` sur les tracés, et des pastilles en
 *  `<span>` positionnés par-dessus, hors du SVG. */
function Toile({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none"
         className="absolute inset-0 h-full w-full overflow-visible">
      {children}
    </svg>
  );
}

function Pastille({ x, y, couleur, taille = 5 }: {
  x: number; y: number; couleur: string; taille?: number;
}) {
  return (
    <span aria-hidden="true" className="absolute rounded-full"
          style={{
            left: `${x}%`, top: `${y}%`, width: taille, height: taille,
            marginLeft: -taille / 2, marginTop: -taille / 2, background: couleur,
          }} />
  );
}

/** LA PISTE DE CHARGE — toujours dorée, sur toutes les rangées.
 *
 *  ⚠️ Y COMPRIS SUR CELLES QUE LE RPE PILOTE. Une version l'y peignait en gris
 *  neutre : avec le couloir RPE juste en dessous, ça faisait trois traits gris
 *  empilés et plus aucune courbe de charge identifiable. L'or appartient à la
 *  charge, partout — c'est ce qui permet de balayer la colonne des pistes sans
 *  relire les libellés. */
function PisteCharge({ charges }: { charges: (number | null)[] }) {
  const connues = charges.filter((v): v is number => v !== null);
  // ⚠️ MOINS DE DEUX POINTS N'EST PAS UNE COURBE, et la piste ne prend alors pas
  // sa hauteur : sur un bloc d'une semaine, 46 px de vide sous chaque mouvement
  // laissaient croire à un tracé qui n'avait pas chargé. C'est la règle que
  // `courbeDeRangee` applique déjà en rendant `null`.
  if (connues.length < 2) return null;
  const min = Math.min(...connues);
  const max = Math.max(...connues);
  const n = charges.length;
  const y = (v: number) => yLocal(v, min, max);

  return (
    <div aria-hidden="true" className="relative h-[46px]">
      <Toile>
        {suitesContigues(charges).filter(s => s.length >= 2).map((suite, k) => (
          <polyline key={k} fill="none" stroke={OR} strokeWidth="2.25"
                    vectorEffect="non-scaling-stroke" strokeLinejoin="round"
                    points={suite.map(i => `${cx(i, n)},${y(charges[i]!)}`).join(' ')} />
        ))}
      </Toile>
      {charges.map((v, i) => v === null ? null : (
        <Pastille key={i} x={cx(i, n)} y={y(v)} couleur={OR} />
      ))}
    </div>
  );
}

/** LE COULOIR RPE — visé en pointillé, ressenti en trait plein, écart en aplat.
 *
 *  ⚠️ C'EST LE REMPLISSAGE QUI PORTE LA COMPARAISON, PAS LA PAIRE DE LIGNES.
 *  Deux traits à trois pixels l'un de l'autre se lisent comme une seule ligne
 *  texturée ; une première version n'avait qu'eux, et l'information reposait en
 *  fait sur la couleur des pastilles — c'est-à-dire sur rien, pour qui ne
 *  distingue pas le bleu de l'or.
 *
 *  ⚠️ ET L'APLAT S'ARRÊTE AU CROISEMENT EXACT. Une zone qui déborderait sur la
 *  partie tenue affirmerait un dépassement qui n'a pas eu lieu — le même genre
 *  d'invention qu'un « PDC » posé sur une charge vide. */
function CouloirRpe({ semaines, axe }: {
  semaines: SemaineRPE[]; axe: { lo: number; hi: number };
}) {
  const n = semaines.length;
  const y = (v: number) => 88 - ((v - axe.lo) / (axe.hi - axe.lo)) * 76;
  const cibles = semaines.map(s => s.cible);
  const reels = semaines.map(s => s.ressenti);

  const aplats = aplatsDeDepassement(cibles, reels, y);

  return (
    <div aria-hidden="true" className="relative h-[74px] border-t border-border/55 bg-background/45">
      <Toile>
        {aplats.map((points, k) => <polygon key={k} points={points} fill={ECART} />)}
        {suitesContigues(cibles).filter(s => s.length >= 2).map((suite, k) => (
          <polyline key={`c${k}`} fill="none" stroke={GRIS} strokeWidth="2.25"
                    strokeDasharray="7 5" vectorEffect="non-scaling-stroke"
                    points={suite.map(i => `${cx(i, n)},${y(cibles[i]!)}`).join(' ')} />
        ))}
        {suitesContigues(reels).filter(s => s.length >= 2).map((suite, k) => (
          <polyline key={`r${k}`} fill="none" stroke={BLEU} strokeWidth="2.75"
                    vectorEffect="non-scaling-stroke" strokeLinejoin="round"
                    points={suite.map(i => `${cx(i, n)},${y(reels[i]!)}`).join(' ')} />
        ))}
      </Toile>
      {reels.map((v, i) => v === null ? null : (
        <Pastille key={i} x={cx(i, n)} y={y(v)}
                  couleur={cibles[i] != null && v > cibles[i]! ? OR : BLEU} />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* LES TROIS ÉTATS D'UNE CASE                                                  */
/* -------------------------------------------------------------------------- */

type EtatDeCase = 'dite' | 'absente' | 'muette' | 'nonPrescrite';

/** ⚠️ L'ALARME EST RELATIVE À LA RANGÉE, PAS ABSOLUE. Une première version
 *  marquait « charge absente » dès qu'une case n'avait ni charge ni RPE : un
 *  AMRAP de DIPS, qui n'en porte JAMAIS, sortait en six cases rouges. Une
 *  prescription normale se présentait comme six erreurs, et l'alarme cessait de
 *  vouloir dire quelque chose.
 *
 *  Ce qu'on signale est le TROU DANS UNE SÉRIE : la S3 de FRE-150, un squat
 *  chargé partout sauf là. `courbeDeRangee` rend `null` quand la rangée n'a pas
 *  deux valeurs chiffrées — c'est exactement le critère « cette rangée ne parle
 *  pas en nombres ». Sans elle, la case est MUETTE : un état, pas un défaut. */
function etatDeCase(cellule: CelluleDuTableau, rangeeChiffree: boolean): EtatDeCase {
  if (cellule.ligne === null) return 'nonPrescrite';
  if (chargeAffichee(cellule.ligne).texte !== '') return 'dite';
  return rangeeChiffree ? 'absente' : 'muette';
}

/* -------------------------------------------------------------------------- */
/* GRAND ÉCRAN — les bandes                                                    */
/* -------------------------------------------------------------------------- */

const LIBELLE = '250px';

function GrilleDuBloc({ tableau, dates, jourActif, indexAccentue, axeRpe }: {
  tableau: ReturnType<typeof tableauDuBloc>;
  dates: { startDate: string }[] | null;
  jourActif: string;
  indexAccentue: number;
  axeRpe: { lo: number; hi: number };
}) {
  const { t } = useTranslation();
  const n = tableau.colonnes.length;
  const colonnes = { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` };
  const bande = { gridTemplateColumns: `${LIBELLE} minmax(0, 1fr)` };
  const tonnages = tableau.colonnes.map(c => c.tonnage);
  // ⚠️ `null` LÀ OÙ RIEN N'EST COMPTABLE, pas zéro : une semaine dont toutes les
  // lignes sont hors compte n'a pas un tonnage nul, elle n'en a pas.
  const courbeTonnage = tonnages.map(x => (x.lignesComptees > 0 ? x.kg : null));

  return (
    /* ⚠️ LE DÉBORDEMENT EST ICI, ET PAS SUR LA PAGE : le faire remonter
       emporterait l'en-tête et les onglets. */
    <div className="overflow-x-auto">
      <div role="table" aria-label={t('blocTableau.legende', { jour: jourActif })}
           className="flex flex-col gap-[7px]"
           /* ⚠️ LA LARGEUR MINIMALE SUIT LE NOMBRE DE COLONNES, elle n'est pas
              fixe. À une valeur en dur, un bloc d'une ou deux semaines forçait un
              défilement pour une grille qui tenait largement — et le défilement,
              sur un écran large, se lit comme « il manque quelque chose ». */
           style={{ minWidth: `${16 + 7 * n}rem` }}>

        <div role="row" className="grid items-end gap-0 px-0" style={bande}>
          <span role="columnheader" className="pr-4 font-display text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('blocTableau.mouvementDuJour', { jour: jourActif })}
          </span>
          <span className="grid" style={colonnes}>
            {tableau.colonnes.map((colonne, i) => (
              <span key={colonne.semaine.id ?? i} role="columnheader" className="px-2 pb-1.5 text-center">
                <span className={cn('block font-display text-[11px] uppercase tracking-[0.16em]',
                                    i === indexAccentue ? 'text-gold' : 'text-muted-foreground')}>
                  {t('blocTableau.semaineN', { n: colonne.semaine.weekNumber })}
                </span>
                {dates?.[i]?.startDate && (
                  /* ⚠️ 11 px PLANCHER, ICI COMME PARTOUT. Les dates étaient le
                     dernier endroit où le texte descendait plus bas. */
                  <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground/55">
                    {formatShort(dates[i].startDate)}
                  </span>
                )}
              </span>
            ))}
          </span>
        </div>

        {tableau.rangees.map(rangee => (
          <BandeDeRangee key={rangee.cle} rangee={rangee} bande={bande} colonnes={colonnes}
                         indexAccentue={indexAccentue} axeRpe={axeRpe} />
        ))}

        {/* Le tonnage prend la même grammaire que les rangées : c'est la piste de
            charge à l'échelle du bloc, sans une ligne de dépendance de plus. */}
        <div role="row" className="mt-1 grid gap-0 border-t border-border/45 pt-2" style={bande}>
          <span role="rowheader" className="pr-4 pt-1">
            <span className="block font-display text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {t('blocTableau.tonnage')}
            </span>
            <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground/70">
              {t('blocTableau.tonnageAide')}
            </span>
          </span>
          <span className="overflow-hidden rounded-[10px] bg-card/55">
            <span className="grid" style={colonnes}>
              {tonnages.map((tonnage, i) => (
                <span key={tableau.colonnes[i].semaine.id ?? i} role="cell"
                      className={cn('px-2 pb-1 pt-2.5 text-center', i === indexAccentue && 'bg-gold/5')}>
                  <CelluleTonnage tonnage={tonnage} />
                </span>
              ))}
            </span>
            <PisteCharge charges={courbeTonnage} />
          </span>
        </div>
      </div>
    </div>
  );
}

/** UNE BANDE = LE LIBELLÉ, PUIS LES VALEURS ET LEURS DEUX PISTES.
 *
 *  ⚠️ L'ORDRE VERTICAL EST UNE DÉCISION : valeurs → charge → RPE. La charge se
 *  lit directement sous ses propres chiffres, sans rien entre les deux — c'est la
 *  seule position qui n'oblige pas à sauter une bande pour relier un chiffre à
 *  son tracé. Le RPE vient dessous : la charge est ce qu'on programme, le RPE ce
 *  qu'on constate. */
function BandeDeRangee({ rangee, bande, colonnes, indexAccentue, axeRpe }: {
  rangee: RangeeDuTableau;
  bande: React.CSSProperties;
  colonnes: React.CSSProperties;
  indexAccentue: number;
  axeRpe: { lo: number; hi: number };
}) {
  const courbe = courbeDeRangee(rangee);
  const charges = chargesDeRangee(rangee);
  const semainesRpe = rpeDeRangee(rangee);
  // ⚠️ PAS DE COULOIR VIDE, ET DEUX RAISONS DISTINCTES. Une rangée sans aucune
  // cible n'en a pas du tout : un RPE ressenti seul ne dit pas si la séance s'est
  // passée comme prévu. Et une cible SEULE — un bloc d'une semaine — ne trace
  // rien non plus : 74 px de vide se lisent comme un graphique cassé.
  const aUneCible = semainesRpe.some(s => s.cible !== null);
  const traceUnCouloir =
    semainesRpe.filter(s => s.cible !== null).length >= 2
    || semainesRpe.filter(s => s.ressenti !== null).length >= 2;

  return (
    <div role="row" className="grid gap-0" style={bande}>
      <span role="rowheader" className="pr-4 pt-2.5">
        <EnTeteDeRangee rangee={rangee} courbe={courbe} charges={charges}
                        semainesRpe={semainesRpe} aUneCible={aUneCible} />
      </span>
      <span className="overflow-hidden rounded-[10px] bg-card/55">
        <span className="grid" style={colonnes}>
          {rangee.cellules.map((cellule, i) => (
            <span key={i} role="cell"
                  className={cn('px-2 pb-1 pt-2.5 text-center', i === indexAccentue && 'bg-gold/5')}>
              <Case cellule={cellule} courbe={courbe} />
            </span>
          ))}
        </span>
        <PisteCharge charges={charges} />
        {aUneCible && traceUnCouloir && <CouloirRpe semaines={semainesRpe} axe={axeRpe} />}
      </span>
    </div>
  );
}

/** ⚠️ TOUT LE TEXTE EST ICI, ET AUCUN DANS LES COULOIRS. C'est l'erreur commise
 *  trois fois sur cet écran : sur un axe PARTAGÉ, une cible haute passe
 *  exactement à la hauteur où le texte aurait été posé. Sur PULL UP, dont la
 *  cible est plate à 8, le pointillé courait littéralement sous le libellé.
 *  Aucun alignement vertical n'y échappe — il existe toujours une donnée qui
 *  collisionne. Zones disjointes, donc. */
function EnTeteDeRangee({ rangee, courbe, charges, semainesRpe, aUneCible }: {
  rangee: RangeeDuTableau;
  courbe: CourbeDeRangee | null;
  charges: (number | null)[];
  semainesRpe: SemaineRPE[];
  aUneCible: boolean;
}) {
  const connues = charges.filter((v): v is number => v !== null);

  return (
    <>
      <span className="block text-[15px] font-medium leading-tight">{rangee.nom}</span>
      {rangee.variantes.length > 0 && (
        <span className="mt-0.5 block font-display text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          {rangee.variantes.join(' · ')}
        </span>
      )}
      {/* L'amplitude de ce que la piste dorée trace. Sans elle, l'étalement au
          plancher — 12 à 88 % quelle que soit l'étendue réelle — donnerait une
          fausse idée de l'écart. La piste dit le RAPPORT, ceci dit la VALEUR. */}
      {connues.length > 0 ? (
        <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground/70">
          {intervalle(Math.min(...connues), Math.max(...connues))} kg
        </span>
      ) : courbe && courbe.grandeur === 'rpe' ? (
        <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground/70">
          RPE {intervalle(courbe.min, courbe.max)}
        </span>
      ) : null}

      {aUneCible && (
        <span className="mt-1.5 block border-t border-border/45 pt-1.5">
          <CibleEtVerdict semaines={semainesRpe} />
        </span>
      )}
    </>
  );
}

/** ⚠️ « RPE 8 → 8 VISÉ » EST FAUX : une cible constante sur tout le bloc s'écrit
 *  « RPE 8 visé ». La flèche annoncerait une progression inexistante — même règle
 *  partout, une variation nulle rend « = » et jamais « +0 ». */
function CibleEtVerdict({ semaines }: { semaines: SemaineRPE[] }) {
  const { t } = useTranslation();
  const cibles = semaines.map(s => s.cible).filter((v): v is number => v !== null);
  const verdict = verdictDesSemainesRPE(semaines);
  // Une semaine visée dont le ressenti n'est pas encore saisi : le bloc court
  // toujours, et « tenu » n'est pas définitif.
  const aVenir = semaines.filter(s => s.cible !== null && s.ressenti === null).length;

  const texte = !verdict.cible
    ? null
    : verdict.depassements > 0
      ? t('blocTableau.rpeDepasse', { count: verdict.depassements })
      : aVenir > 0
        ? t('blocTableau.rpeTenuReste', { count: aVenir })
        : t('blocTableau.rpeTenu');

  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono text-[11px]">
      <span className="text-muted-foreground/70">
        {t('blocTableau.rpeVise', { borne: intervalle(Math.min(...cibles), Math.max(...cibles)) })}
      </span>
      {texte && (
        /* ⚠️ `warning` ET NON `destructive` : un RPE dépassé est une information
           de programmation, pas une erreur. Le rouge reste au destructif. */
        <span className={verdict.cible && verdict.depassements > 0 ? 'text-warning' : 'text-success'}>
          {texte}
        </span>
      )}
    </span>
  );
}

/** Une case : la valeur, et le volume sous elle en plus discret. */
function Case({ cellule, courbe }: { cellule: CelluleDuTableau; courbe: CourbeDeRangee | null }) {
  const { t } = useTranslation();
  const etat = etatDeCase(cellule, courbe !== null);
  const l = cellule.ligne;
  const charge = l ? chargeAffichee(l) : null;

  if (etat === 'nonPrescrite') {
    return <span aria-label={t('blocTableau.absent')} className="font-mono text-sm text-muted-foreground/40">—</span>;
  }
  return (
    <>
      {etat === 'absente' ? (
        /* ⚠️ UN `?`, PAS UN « PDC » INVENTÉ. 652 lignes de production n'ont ni
           charge ni RPE ; la donnée ne dit nulle part que l'absence de charge
           signifie poids de corps. Le glyphe dit le fait : la séance prescrit,
           la charge n'est pas renseignée. */
        <span aria-label={t('blocTableau.chargeAbsente')}
              className="block font-mono text-[15px] font-medium text-destructive">?</span>
      ) : etat === 'muette' ? (
        <span className="block font-mono text-[15px] text-foreground">{separateurLocal(volumeAffiche(l!))}</span>
      ) : (
        <span className={cn('block font-mono text-[15px]',
                            charge!.estRPE ? 'text-foreground' : 'text-gold')}>
          {separateurLocal(charge!.texte)}
        </span>
      )}
      {etat !== 'muette' && (
        <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">{separateurLocal(volumeAffiche(l!))}</span>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* TÉLÉPHONE — la valeur, et sa barre dans la case                             */
/* -------------------------------------------------------------------------- */

/** ⚠️ LA LIGNE ANCRÉE NE PASSE PAS LE TÉLÉPHONE, et il vaut mieux le dire que le
 *  découvrir. 46 px pour la charge, 74 de plus dès qu'il y a une cible : une
 *  rangée pèse ~185 px. À quatre points sur 340 px de large, la ligne ne dit plus
 *  rien — la pente d'une progression n'est lisible qu'en rapport de la largeur.
 *
 *  ⚠️ UNE BARRE, ELLE, N'A PAS BESOIN DE LARGEUR : six semaines tiennent dans
 *  390 px sans défilement horizontal. C'est le même encodage, à la verticale.
 *
 *  ⚠️ ET LA CASE EST EN `min-height`, PAS EN HAUTEUR FIXE. Avec une hauteur
 *  figée, un libellé qui passe à deux lignes — « 13,75 → 12,5 kg », « 4 lignes
 *  hors compte » — pousse la piste de barre hors de la case, et `overflow-hidden`
 *  la rogne. Le `min-h-0` sur la zone de texte est l'autre moitié de la règle :
 *  sans lui, un enfant de flex refuse de se comprimer. */
function CartesDeMouvement({ tableau, indexAccentue }: {
  tableau: ReturnType<typeof tableauDuBloc>; indexAccentue: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      {tableau.rangees.map(rangee => {
        const courbe = courbeDeRangee(rangee);
        const charges = chargesDeRangee(rangee);
        const connues = charges.filter((v): v is number => v !== null);
        const semainesRpe = rpeDeRangee(rangee);
        const aUneCible = semainesRpe.some(s => s.cible !== null);
        return (
          <section key={rangee.cle} className="rounded-lg border border-border bg-card/40 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[15px] font-medium">{rangee.nom}</span>
              {connues.length > 0 && (
                <span className="font-mono text-[11px] text-muted-foreground">
                  {intervalle(Math.min(...connues), Math.max(...connues))} kg
                </span>
              )}
            </div>
            {rangee.variantes.length > 0 && (
              <span className="mt-0.5 block font-display text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                {rangee.variantes.join(' · ')}
              </span>
            )}
            {aUneCible && (
              <span className="mt-1 block"><CibleEtVerdict semaines={semainesRpe} /></span>
            )}
            <div className="mt-2.5 grid gap-1.5"
                 style={{ gridTemplateColumns: `repeat(${rangee.cellules.length}, minmax(0, 1fr))` }}>
              {rangee.cellules.map((cellule, i) => (
                <CaseTelephone key={i} cellule={cellule} courbe={courbe}
                               charge={charges[i]} montrerLaPiste={connues.length >= 2}
                               min={connues.length ? Math.min(...connues) : 0}
                               max={connues.length ? Math.max(...connues) : 0}
                               semaine={tableau.colonnes[i].semaine.weekNumber}
                               accentuee={i === indexAccentue} />
              ))}
            </div>
          </section>
        );
      })}

      <section className="rounded-lg border border-border bg-card/40 p-3">
        <span className="block font-display text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {t('blocTableau.tonnage')}
        </span>
        <div className="mt-2.5 grid gap-1.5"
             style={{ gridTemplateColumns: `repeat(${tableau.colonnes.length}, minmax(0, 1fr))` }}>
          {tableau.colonnes.map((colonne, i) => (
            <span key={i} className="flex flex-col items-center">
              <CelluleTonnage tonnage={colonne.tonnage} compact />
              <span className={cn('mt-1 font-mono text-[11px]',
                                  i === indexAccentue ? 'text-gold' : 'text-muted-foreground/70')}>
                {t('blocTableau.semaineN', { n: colonne.semaine.weekNumber })}
              </span>
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

function CaseTelephone({ cellule, courbe, charge, montrerLaPiste, min, max, semaine, accentuee }: {
  cellule: CelluleDuTableau; courbe: CourbeDeRangee | null;
  charge: number | null;
  /** ⚠️ MÊME RÈGLE QUE LA PISTE DE GRAND ÉCRAN : une rangée qui n'a pas deux
   *  charges n'a pas de progression à encoder, et les 32 px réservés se lisent
   *  alors comme un graphique qui n'a pas chargé. */
  montrerLaPiste: boolean;
  min: number; max: number;
  semaine: number | undefined; accentuee: boolean;
}) {
  const { t } = useTranslation();
  const etat = etatDeCase(cellule, courbe !== null);
  const affiche = cellule.ligne ? chargeAffichee(cellule.ligne) : null;
  // La valeur NUE : l'unité vit dans l'amplitude, en tête de carte. La répéter
  // six fois sur une colonne de 55 px coûterait la lisibilité — et « RPE 7.5 » à
  // 13 px y passe à la ligne, ce qui désaligne les numéros de semaine (vu à
  // 390 px).
  const nue = separateurLocal((affiche?.texte ?? '').replace(/^RPE\s*/, '').replace(/\s*kg.*$/, ''));
  // Même plancher que sur la piste : la barre dit le rapport, pas la valeur.
  const hauteur = charge === null ? 0 : (max === min ? 60 : 30 + ((charge - min) / (max - min)) * 70);

  return (
    <span className="flex min-h-[58px] flex-col items-center">
      <span className="flex min-h-0 grow items-start justify-center pb-1 text-center">
        {etat === 'nonPrescrite' ? (
          <span aria-label={t('blocTableau.absent')} className="font-mono text-[13px] text-muted-foreground/40">—</span>
        ) : etat === 'absente' ? (
          <span aria-label={t('blocTableau.chargeAbsente')}
                className="font-mono text-[13px] font-medium text-destructive">?</span>
        ) : etat === 'muette' ? (
          /* ⚠️ LES SÉRIES TOMBENT, LES RÉPÉTITIONS RESTENT. « 3 × AMRAP » à
             11 px dans une colonne de 55 px passe à la ligne et casse la
             grille — vu à 390 px. Sans charge, ce qui distingue les semaines
             est « AMRAP » contre « 30 s », pas le nombre de séries. */
          <span className="truncate font-mono text-[11px] text-foreground">
            {separateurLocal((cellule.ligne!.reps ?? '').trim() || volumeAffiche(cellule.ligne!))}
          </span>
        ) : (
          <span className={cn('font-mono text-[13px]', affiche!.estRPE ? 'text-foreground' : 'text-gold')}>
            {nue}
          </span>
        )}
      </span>
      {/* ⚠️ PAS DE BARRE AU SOL POUR UN TROU : une semaine sans charge n'est pas
          une charge nulle, et une barre écrasée la ferait lire comme un
          allègement. Rien du tout, donc — la case reste vide sous la valeur. */}
      {montrerLaPiste && (
        <span aria-hidden="true" className="flex h-8 w-full items-end justify-center">
          {charge !== null && (
            <span className="w-1.5 rounded-[1px] bg-gold/75" style={{ height: `${hauteur}%` }} />
          )}
        </span>
      )}
      <span className={cn('mt-0.5 font-mono text-[11px]',
                          accentuee ? 'text-gold' : 'text-muted-foreground/70')}>
        {t('blocTableau.semaineN', { n: semaine })}
      </span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Fragments partagés                                                          */
/* -------------------------------------------------------------------------- */

/** ⚠️ UN SEUL SÉPARATEUR PAR RANGÉE, ET C'EST CELUI DE LA LANGUE. Les cases
 *  affichaient « 6.25 kg » à côté de « 8,75 → 9 kg » dans la même rangée : la
 *  charge est rendue TELLE QU'ELLE EST SAISIE, et les deux notations coexistent
 *  en base. On ne réécrit pas la donnée — on la présente, et seulement là où il
 *  s'agit sûrement d'un nombre (un chiffre, un séparateur, un chiffre).
 *  « 3 × 5/6 » et « RB15 » passent donc intacts.
 *
 *  ⚠️ ET PAS « LA VIRGULE, TOUJOURS ». L'app est bilingue ; forcer la virgule
 *  écrivait « 1,5 t » à un lecteur anglais, qui y lit mille cinq cents. C'est la
 *  langue affichée qui décide, comme partout ailleurs. */
function separateurLocal(texte: string): string {
  return decimale() === ',' ? texte.replace(/(\d)\.(\d)/g, '$1,$2')
                            : texte.replace(/(\d),(\d)/g, '$1.$2');
}

function decimale(): string {
  return (1.1).toLocaleString(i18n.language).charAt(1);
}

/** ⚠️ « 8 → 8 » EST FAUX : une borne unique s'écrit seule. Une flèche entre deux
 *  valeurs identiques annonce une progression qui n'a pas eu lieu. */
function intervalle(min: number, max: number): string {
  return min === max ? nombreLocal(min) : `${nombreLocal(min)} → ${nombreLocal(max)}`;
}

/** ⚠️ LE FORMATEUR DE LOCALE, PAS `toFixed`, QUI REND TOUJOURS « 1.4 t ». Et la
 *  langue AFFICHÉE, pas `fr-FR` en dur : le tonnage s'écrivait « 1,5 t » à un
 *  lecteur anglais, qui y lit mille cinq cents. */
function nombreLocal(n: number, decimales = 1): string {
  return n.toLocaleString(i18n.language, { maximumFractionDigits: decimales });
}

/** ⚠️ UN TONNAGE PARTIEL LE DIT, ET PAS DANS UNE INFOBULLE. « 5/6 », « AMRAP »
 *  et les secondes ne se multiplient pas ; une somme qui les saute en silence
 *  affiche un chiffre plus petit que la réalité. Le compte vivait dans un
 *  `title` — qui n'existe pas sur un téléphone, alors que l'app est une PWA
 *  installée et s'ouvre en salle. Il est désormais à l'écran, en permanence. */
function CelluleTonnage({ tonnage, compact = false }: { tonnage: Tonnage; compact?: boolean }) {
  const { t } = useTranslation();
  if (tonnage.lignesComptees === 0) {
    return <span className="font-mono text-sm text-muted-foreground/40">—</span>;
  }
  return (
    <>
      {/* ⚠️ LA TONNE EST UNE MAUVAISE UNITÉ EN DESSOUS D'UNE TONNE. Une séance
          d'accessoires à 720 kg s'affichait « 0,7 t » et une à 72 kg « 0,1 t » —
          deux séances de rapport 1 à 10 rendues presque identiques. */}
      <span className={cn('block font-mono normal-case tracking-normal text-gold',
                          compact ? 'whitespace-nowrap text-[12px]' : 'text-[15px]')}>
        {tonnage.kg >= 1000
          ? `${nombreLocal(tonnage.kg / 1000)} t`
          : `${nombreLocal(Math.round(tonnage.kg), 0)} kg`}
      </span>
      {!compact && tonnage.lignesIgnorees > 0 && (
        <span className="mt-0.5 block font-mono text-[11px] normal-case tracking-normal text-muted-foreground">
          {t('blocTableau.horsCompte', { count: tonnage.lignesIgnorees })}
        </span>
      )}
    </>
  );
}

/** ⚠️ LA LÉGENDE MONTRE LES TRAITS, ELLE NE LES NOMME PLUS SEULEMENT. La version
 *  précédente alignait trois libellés derrière des échantillons de 6 px : à cette
 *  taille, un pointillé gris et un trait plein bleu sont la même tache, et le
 *  lecteur ne pouvait pas relier la légende à ce qu'il voyait dans les couloirs
 *  (William, 11/09 : « légende pas claire, on ne voit ni la courbe bleue ni les
 *  pointillés »). Les échantillons font maintenant 34 px, tracés à la même
 *  épaisseur et avec le même pointillé que les vrais.
 *
 *  ⚠️ ET L'AXE DIT SES BORNES. Le couloir RPE est resserré sur la plage du bloc ;
 *  le taire laisserait lire les pentes comme si l'échelle allait de 0 à 10. */
function Legende({ axeRpe, surTelephone }: {
  axeRpe: { lo: number; hi: number }; surTelephone: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2.5 border-t border-border/45 pt-3">
      <p className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px] text-muted-foreground">
        <span className="font-display uppercase tracking-[0.14em]">{t('blocTableau.legendeLire')}</span>
        {!surTelephone && (
          <>
            <span className="flex items-center gap-2">
              <Trait couleur={OR} epaisseur={2.25} />
              {t('blocTableau.legendeCharge')}
            </span>
            <span className="flex items-center gap-2">
              <Trait couleur={BLEU} epaisseur={2.75} />
              {t('blocTableau.legendeRessenti')}
            </span>
            <span className="flex items-center gap-2">
              <Trait couleur={GRIS} epaisseur={2.25} tirets />
              {t('blocTableau.legendeVise')}
            </span>
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="h-3.5 w-[34px] rounded-[2px]"
                    style={{ background: ECART }} />
              {t('blocTableau.legendeEcart')}
            </span>
            <span className="text-muted-foreground/70">
              {t('blocTableau.axePartage', { lo: nombreLocal(axeRpe.lo), hi: nombreLocal(axeRpe.hi) })}
            </span>
          </>
        )}
        {surTelephone && (
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="flex h-4 w-[18px] items-end justify-center gap-[3px]">
              <span className="h-2 w-1.5 rounded-[1px] bg-gold/75" />
              <span className="h-4 w-1.5 rounded-[1px] bg-gold/75" />
            </span>
            {t('blocTableau.legendeCharge')}
          </span>
        )}
      </p>

      <p className="flex flex-wrap items-center gap-x-5 gap-y-2 font-display text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
        <span className="tracking-[0.14em]">{t('blocTableau.legendeEtats')}</span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="font-mono text-[11px] normal-case text-gold">65 kg</span>
          {t('blocTableau.etatDite')}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true"
                /* 11 px ici aussi : l'échantillon est lu, pas seulement vu. */
                className="flex h-[18px] w-6 items-center justify-center rounded-[3px] border-[1.5px] border-dashed border-destructive font-mono text-[11px] text-destructive">
            ?
          </span>
          {t('blocTableau.etatAbsente')}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="font-mono text-muted-foreground/40">—</span>
          {t('blocTableau.etatNonPrescrite')}
        </span>
      </p>
    </div>
  );
}

/** Un échantillon de trait, tracé comme le vrai : même épaisseur, même
 *  pointillé. Un `<div>` bordé n'y suffirait pas — `border-dashed` ne rend pas
 *  le rythme « 7 5 » du couloir. */
function Trait({ couleur, epaisseur, tirets = false }: {
  couleur: string; epaisseur: number; tirets?: boolean;
}) {
  return (
    <svg aria-hidden="true" width="34" height="8" viewBox="0 0 34 8" className="shrink-0">
      <line x1="0" y1="4" x2="34" y2="4" stroke={couleur} strokeWidth={epaisseur}
            strokeDasharray={tirets ? '7 5' : undefined} />
    </svg>
  );
}

function Etat({ texte }: { texte: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
      {texte}
    </div>
  );
}
