import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";

import type { BlockEditing, SessionEditing } from "@/api/types";
import { cn } from "@/lib/utils";
import i18n from "@/i18n";
import { formatMinute } from "./format";
import { buildExerciseProgressionPoints, verdictRPE, type ProgressionPoint } from "./exercise-progression-data";
import { bornesDeCharge, chargeEcrite, kg, lireRepos, pasEncoreFaite, rpeEcrit, trajectoireEnMots, volumeEcrit } from "./progression/socle";

/** L'HISTORIQUE D'UN MOUVEMENT SUR LES BLOCS PRÉCÉDENTS, dans la BASE (FRE-167).
 *
 *  ⚠️ CE N'ÉTAIT PAS UN DÉFAUT DE STYLE, C'ÉTAIT UN EMPRUNT. On réutilisait
 *  `ExerciseProgressionCard` — la carte de la vue semaine, où elle est le
 *  contenu principal et où il y en a UNE. Le choix était raisonnable ; il ne
 *  tient plus dès qu'il y a plusieurs blocs passés. Empilée quatre à six fois,
 *  elle donne 100 % du détail à 0 % de hiérarchie : neuf rangées chacune, en 9
 *  et 11 px, sur deux colonnes — une cinquantaine de rangées de chiffres
 *  minuscules sous chaque mouvement, pendant que le coach écrit sa trame.
 *
 *  Mesuré en production le 11/09 : 3 créneaux en moyenne par (macro, mouvement),
 *  19 au maximum.
 *
 *  ⚠️ ET LA LIGNE REPLIÉE DOIT RÉPONDRE, PAS SEULEMENT SE DÉPLIER. Aubin
 *  demandait de pouvoir « dépiler au besoin » — mais un simple titre repliable
 *  ne règle rien : comparer quatre blocs demanderait d'ouvrir les quatre, soit
 *  quatre clics pour revenir au point de départ. La question du coach en
 *  écrivant sa trame est « qu'a-t-il fait la dernière fois, et est-ce que ça
 *  s'est bien passé » : la ligne la porte, alignée en colonnes.
 *
 *  ⚠️ LE PLI EST PAR BLOC, PAS PAR CRÉNEAU. Un mouvement programmé le lundi ET
 *  le vendredi du même bloc donnait deux lignes de même titre à se suivre :
 *  l'unité que le coach lit est le bloc. Mesuré en production le 11/09 sur les
 *  3 079 couples (macro, bloc, mouvement) : 73,5 % n'ont qu'un créneau, 11 %
 *  en ont deux, 26,5 % en ont plusieurs.
 *
 *  ⚠️ DÉPLIÉ, C'EST UN TABLEAU, PLUS UN EMPILEMENT DE CARTES (brief du 25/10).
 *  La carte de la vue semaine coûtait 230 à 250 px par créneau : six créneaux
 *  faisaient 1 500 px, et deux créneaux à comparer ne tenaient plus ensemble.
 *  Une ligne = un créneau, une colonne = une semaine ; chaque case écrit la
 *  charge, puis séries × reps · RPE, avec les écritures de `progression/socle`
 *  — rien n'est recalculé ici. L'or dit seulement que le réel a quitté le
 *  prescrit ; un contour tireté, qu'aucune trace de réalisation n'existe. */

interface Props {
  movement: string;
  pastBlocks: BlockEditing[];
}

interface HistoryCard {
  key: string;
  block: BlockEditing;
  session: SessionEditing;
  exerciseIndex: number;
  points: ProgressionPoint[];
}

interface BlocHistorique {
  key: string;
  block: BlockEditing;
  creneaux: HistoryCard[];
  /** Tous les points du bloc — ce sur quoi le verdict RPE se prononce : la
   *  question « est-ce que ça s'est bien passé » porte sur le bloc entier. */
  tousLesPoints: ProgressionPoint[];
}

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function hasUsefulHistory(points: ProgressionPoint[]): boolean {
  return points.some((p) => (
    p.sets.trim()
    || p.reps.trim()
    || p.repsDone.trim()
    || p.restActual.trim()
    || p.kg !== null
    // Une charge réelle sans prescription reste un historique utile : sinon
    // l'exercice disparaîtrait alors que l'athlète a bien soulevé quelque chose.
    || p.kgDone !== null
    || p.assistance.trim()
    || p.rpe !== null
  ));
}

/** ⚠️ LE NOM SEUL NE DIT PAS L'EXERCICE — c'est la faute que ce libellé répare.
 *  « Lundi » et « Lundi » désignaient deux lignes de SQUAT dont l'une était
 *  neutre en 3010 et l'autre en 10X0 : l'historique les montrait sous le même
 *  intitulé, et les comparer n'avait pas de sens. Mesuré en production le
 *  11/09 : 48,3 % des lignes portent une variante, 24,6 % un tempo.
 *
 *  D'où « Lundi · NEUTRE · 3010 », descriptif et non plus seulement
 *  discriminant : la première version n'affichait que le segment qui suffisait
 *  à départager, donc RIEN dans les 73,5 % de blocs à créneau unique — ceux-là
 *  perdaient la variante et le tempo sans le dire. */
function valeursDistinctes(points: ProgressionPoint[], lire: (p: ProgressionPoint) => string): string {
  // ⚠️ Les semaines qui VARIENT se lisent « 3010 / 20X0 » plutôt que de choisir
  // la première : 0,1 % des créneaux de production, mais afficher l'une des deux
  // affirmerait une constance que la donnée ne porte pas.
  return [...new Set(points.map(lire).filter(Boolean))].join(" / ");
}

function descriptionCreneau(carte: HistoryCard): string {
  return [
    (carte.session.name ?? "").trim(),
    valeursDistinctes(carte.points, p => p.variante),
    valeursDistinctes(carte.points, p => p.tempo),
  ].filter(Boolean).join(" · ");
}

/** Le FORMAT du créneau, au même titre que la variante et le tempo : un 5×1 en
 *  EMOM 60″ et un 5×1 classique ne sont pas le même exercice. Un format qui
 *  change dans le bloc s'écrit « EMOM / — », jamais l'un des deux seulement. */
function formatDuCreneau(carte: HistoryCard): string {
  const formats = [...new Set(carte.points.map(p => p.formatEcrit))];
  if (formats.length === 1) return formats[0];
  return formats.map(f => f || "—").join(" / ");
}

/** Le badge de format : bleu s'il est minuté, or sinon (`formatMinute`). */
function BadgeFormat({ carte }: { carte: HistoryCard }) {
  const texte = formatDuCreneau(carte);
  if (!texte) return null;
  const minute = carte.points.every(p => !p.formatEcrit || formatMinute(p.formatEcrit.split(" ")[0]));
  return (
    <span className={cn("ml-1.5 inline-block whitespace-nowrap rounded border px-1 font-mono text-[10px] leading-4 align-middle",
                        minute ? "border-metric/40 text-metric" : "border-gold/40 text-gold")}>
      {texte}
    </span>
  );
}

/** La trajectoire d'un créneau : la charge, sinon l'aide, sinon rien d'inventé. */
function TrajectoireDuCreneau({ points }: { points: ProgressionPoint[] }) {
  const { t } = useTranslation();
  const { premiere, derniere, delta } = bornesDeCharge(points);
  if (premiere !== null && derniere !== null) {
    return (
      <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
        {kg(premiere)} → {kg(derniere)} kg
        {delta !== null && delta !== 0 && (
          <span className={cn("ml-1.5 font-semibold", delta > 0 ? "text-success" : "text-destructive")}>
            {delta > 0 ? "+" : "−"}{kg(Math.abs(delta))} kg
          </span>
        )}
      </span>
    );
  }
  const aides = points.map(p => p.assistance.trim()).filter(Boolean);
  if (aides.length) {
    const [a, b] = [aides[0], aides[aides.length - 1]];
    return <span className="font-mono text-[12px] text-muted-foreground">{a === b ? a : `${a} → ${b}`}</span>;
  }
  return <span className="font-mono text-[12px] text-muted-foreground">{t("training.sansChargeSurLeBloc")}</span>;
}

/** Ni consigne ni trace cette semaine-là : la case reste vide. « visé » est
 *  réservé à une consigne qui existe sans trace de réalisation. */
const semaineVide = (p: ProgressionPoint): boolean =>
  !p.sets.trim() && !p.reps.trim() && p.kg === null && !p.assistance.trim() && pasEncoreFaite(p);

/** UNE SEMAINE D'UN CRÉNEAU — la charge, puis séries × reps · RPE, et le repos
 *  seulement quand le réel l'a quitté. */
function CaseSemaine({ p }: { p: ProgressionPoint }) {
  const { t } = useTranslation();
  const charge = chargeEcrite(p);
  const aide = p.assistance.trim();
  const rpe = rpeEcrit(p, t);
  const vide = pasEncoreFaite(p);
  const volume = volumeEcrit(p);
  const repos = lireRepos(p);
  return (
    <div className={cn("mx-auto inline-flex min-w-[72px] flex-col items-center rounded px-1.5 py-1 leading-tight",
                       vide && "border border-dashed border-border text-muted-foreground")}>
      <span className={cn("font-mono text-[14.5px] font-semibold tabular-nums",
                          charge.ecart ? "text-gold" : vide ? "text-muted-foreground" : "text-foreground")}>
        {charge.texte || aide || "—"}
      </span>
      <span className="whitespace-nowrap font-mono text-[10.5px] tabular-nums">
        <span className={volume.includes("→") ? "text-gold" : "text-muted-foreground"}>{volume}</span>
        {" · "}
        {vide
          ? <span className="text-muted-foreground">{t("training.vise")}</span>
          : <span style={rpe.couleur ? { color: rpe.couleur } : undefined}>{rpe.texte}</span>}
      </span>
      {repos.prescrit && (
        <span className="whitespace-nowrap font-mono text-[10px] text-gold">
          {t("training.reposEcart", { prescrit: String(repos.prescrit), reel: String(repos.reel) })}
        </span>
      )}
    </div>
  );
}

/** Le jour en encre, ce qui le précise (variante, tempo, tier) en gris : deux
 *  informations de même couleur se lisaient comme une seule. */
function LibelleCreneau({ texte, jour }: { texte: string; jour: string }) {
  if (!jour || !texte.startsWith(jour)) return <span className="text-foreground">{texte}</span>;
  const reste = texte.slice(jour.length).replace(/^\s*·\s*/, "");
  return (
    <>
      <span className="text-foreground">{jour}</span>
      {reste && <span className="ml-1.5 font-mono text-[11px] font-normal uppercase text-muted-foreground">{reste}</span>}
    </>
  );
}

function libelleCreneau(carte: HistoryCard, duMemeBloc: HistoryCard[]): string {
  const base = descriptionCreneau(carte);
  // Deux créneaux que la description ne sépare pas — même jour, même variante,
  // même tempo — existent : on ne les laisse pas se confondre. Tier, puis rang.
  if (!duMemeBloc.some(c => c !== carte && descriptionCreneau(c) === base)) return base;
  const ex = carte.session.exercises[carte.exerciseIndex];
  const departage = ex?.tier
    ? `Tier ${ex.tier}`
    : i18n.t("training.exerciceN", { n: carte.exerciseIndex + 1 });
  return [base, departage].filter(Boolean).join(" · ");
}

function PastilleRPE({ points }: { points: ProgressionPoint[] }) {
  const { t } = useTranslation();
  const v = verdictRPE(points);
  const [texte, teinte] = !v.cible
    ? [t("training.rpeSansCible"), "border-border text-muted-foreground"]
    : v.depassements === 0
      ? [t("training.rpeTenu"), "border-success/40 text-success"]
      // ⚠️ `warning` ET NON `destructive` : un RPE dépassé n'est pas une erreur,
      // c'est une information de programmation. Le rouge reste au destructif.
      : [t("training.rpeDepasse", { count: v.depassements }), "border-warning/40 text-warning"];
  return (
    <span className={cn("shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px]", teinte)}>
      {texte}
    </span>
  );
}

export function MovementHistory({ movement, pastBlocks }: Props) {
  const { t } = useTranslation();
  const target = movement.trim().toUpperCase();
  const [ouverts, setOuverts] = useState<ReadonlySet<string>>(new Set());

  const blocs = useMemo(() => {
    const out: BlocHistorique[] = [];
    for (const block of [...pastBlocks].reverse()) {
      const creneaux: HistoryCard[] = [];
      const seenSlots = new Set<string>();
      for (const week of block.weeks) {
        (week.sessions ?? []).forEach((session, sessionIndex) => {
          const sessionKey = normalize(session.name) || session.id || `session-${sessionIndex}`;
          session.exercises.forEach((exercise, exerciseIndex) => {
            if ((exercise.name ?? "").trim().toUpperCase() !== target) return;
            const slotKey = `${sessionKey}:${exerciseIndex}`;
            if (seenSlots.has(slotKey)) return;
            seenSlots.add(slotKey);

            const points = buildExerciseProgressionPoints(session, exerciseIndex, block.weeks);
            if (!hasUsefulHistory(points)) return;

            creneaux.push({
              key: `${block.id ?? block.blockNumber}:${slotKey}`,
              block,
              session,
              exerciseIndex,
              points,
            });
          });
        });
      }
      if (creneaux.length === 0) continue;
      out.push({
        key: `${block.id ?? block.blockNumber}`,
        block,
        creneaux,
        tousLesPoints: creneaux.flatMap(c => c.points),
      });
    }
    return out;
  }, [pastBlocks, target]);

  if (blocs.length === 0) return null;

  const nbCreneaux = blocs.reduce((n, b) => n + b.creneaux.length, 0);
  // TOUS LES BLOCS PARTAGENT LE NOMBRE DE COLONNES DU PLUS LONG : sans cela, S2
  // d'un bloc à 3 semaines tomberait sous S3 d'un bloc à 4.
  const colonnes = Math.max(...blocs.flatMap(b => b.creneaux.map(c => c.points.length)));
  const tousOuverts = ouverts.size === blocs.length;
  const basculerTout = () =>
    setOuverts(tousOuverts ? new Set() : new Set(blocs.map(b => b.key)));

  return (
    <div className="border-t border-border/60 bg-muted/10 px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('training.historiqueBlocsPrecedents')}
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground/70">
            {t('training.creneaux', { count: nbCreneaux })} · {t('training.blocs', { count: blocs.length })}
          </span>
        </div>
        {/* Quatre plis à ouvrir un par un est le défaut qu'on corrige. */}
        <button type="button" onClick={basculerTout}
                className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          {tousOuverts ? t('training.toutReplier') : t('training.toutDeplier')}
        </button>
      </div>

      {/* ⚠️ UNE COLONNE, PLUS DEUX. `xl:grid-cols-2` mettait deux grilles de
          colonnes différentes à quarante pixels l'une de l'autre : les semaines
          ne s'alignaient pas d'une carte à l'autre. C'est l'empilement en pleine
          largeur qui met les valeurs de droite en colonnes — et c'est tout
          l'intérêt de la ligne repliée. */}
      <div className="flex flex-col gap-[7px]">
        {blocs.map((bloc) => (
          <LigneDeBloc
            colonnes={colonnes}
            key={bloc.key}
            bloc={bloc}
            ouverte={ouverts.has(bloc.key)}
            basculer={() => setOuverts(prev => {
              const suite = new Set(prev);
              if (!suite.delete(bloc.key)) suite.add(bloc.key);
              return suite;
            })}
          />
        ))}
      </div>
    </div>
  );
}

function LigneDeBloc({ bloc, ouverte, basculer, colonnes }: {
  bloc: BlocHistorique; ouverte: boolean; basculer: () => void; colonnes: number;
}) {
  const { t } = useTranslation();
  const idContenu = `historique-${bloc.key}`;
  const seul = bloc.creneaux.length === 1 ? bloc.creneaux[0] : null;
  const titre = [t('training.blocN', { n: bloc.block.blockNumber }), bloc.block.name?.trim()]
    .filter(Boolean).join(' — ');

  return (
    // ⚠️ LE LISERÉ OR FAIT LE TOUR DU BLOC OUVERT. Empilés, quatre plis se
    // ressemblent trop pour qu'on retrouve d'un coup d'œil celui qu'on vient
    // d'ouvrir — et le contenu déplié n'a pas de bord à lui : c'est le même
    // cadre qui doit enfermer la ligne ET ce qu'elle a ouvert.
    <div className={cn("overflow-hidden rounded-md border bg-card/40",
                       ouverte ? "border-gold/50" : "border-border/60")}>
      {/* ⚠️ UN VRAI `<button>`, PAS UN `<div>` CLIQUABLE : c'est `aria-expanded`
          qui porte l'état du pli, et la tabulation qui y donne accès. */}
      <button
        type="button"
        onClick={basculer}
        aria-expanded={ouverte}
        aria-controls={idContenu}
        className="flex w-full items-center gap-3 px-2.5 py-2 text-left hover:bg-accent/40"
      >
        <ChevronRight aria-hidden="true"
                      className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                                    ouverte && "rotate-90")} />
        <span className="min-w-0 grow truncate text-[12px] font-medium">
          {titre}
          {/* Un seul créneau : sa description n'a nulle part ailleurs où vivre —
              le pli, quand il n'en contient qu'un, n'a pas de sous-en-tête. */}
          {seul && descriptionCreneau(seul) && (
            <span className="ml-2 text-[11px] font-normal text-muted-foreground">
              {descriptionCreneau(seul)}
            </span>
          )}
        </span>

        {/* ⚠️ DEUX CRÉNEAUX NE FONT PAS UNE TRAJECTOIRE. Le lundi lourd et le
            vendredi sumo sont deux exercices : les fondre en un seul
            « 80 → 115 kg » inventerait une progression que personne n'a faite.
            La ligne annonce alors leur nombre, et chacun porte la sienne dans le
            pli. Le verdict RPE, lui, s'agrège sans mentir : il compte des
            dépassements, et le bloc entier en est le sujet. */}
        {seul
          ? <TrajectoireDuCreneau points={seul.points} />
          : <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {t('training.creneaux', { count: bloc.creneaux.length })}
            </span>}

        <PastilleRPE points={bloc.tousLesPoints} />
      </button>

      {ouverte && (
        /* UN VRAI TABLEAU : une ligne par créneau, une colonne par semaine. Au
           téléphone, la même grammaire pliée — le libellé sur une ligne, puis
           les cases, chacune coiffée de sa semaine ; rien ne défile en largeur. */
        <table id={idContenu} className="block w-full border-t border-border/60 sm:table">
          <thead className="hidden sm:table-header-group">
            <tr>
              <th scope="col" className="w-[236px]" aria-label={t("training.creneau")} />
              {Array.from({ length: colonnes }, (_, k) => (
                <th key={k} scope="col" className="py-1 text-center font-mono text-[10px] font-normal text-muted-foreground">
                  S{k + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="block sm:table-row-group">
            {bloc.creneaux.map((creneau) => {
              const retour = [...creneau.points].reverse().find(p => p.feedback.trim());
              return (
                <tr key={creneau.key} aria-label={trajectoireEnMots(creneau.points, t)}
                    className="grid grid-cols-4 gap-y-1 border-t border-border/40 px-2.5 py-2 first:border-t-0 sm:table-row">
                  <th scope="row" className="col-span-4 py-1 pr-3 text-left align-top font-normal sm:w-[236px] sm:py-2 sm:pl-3">
                    {/* Créneau unique : jour, variante, tempo et trajectoire sont
                        déjà sur la ligne repliée — on ne les répète pas. */}
                    <div className="text-[12.5px] font-medium">
                      {!seul && <LibelleCreneau texte={libelleCreneau(creneau, bloc.creneaux)} jour={(creneau.session.name ?? "").trim()} />}
                      <BadgeFormat carte={creneau} />
                    </div>
                    {!seul && <TrajectoireDuCreneau points={creneau.points} />}
                    {retour && (
                      <div className="mt-1 border-l-2 border-gold/70 pl-1.5 text-[11px] text-muted-foreground">
                        <span className="mr-1 font-mono text-gold">{retour.label}</span>{retour.feedback}
                      </div>
                    )}
                  </th>
                  {Array.from({ length: colonnes }, (_, k) => {
                    const p = creneau.points[k];
                    return (
                      <td key={k} className="py-1 text-center align-top sm:py-2 sm:last:pr-3">
                        {p && !semaineVide(p) && <>
                          <span className="block font-mono text-[10px] text-muted-foreground sm:hidden">{p.label}</span>
                          <CaseSemaine p={p} />
                        </>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
