import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";

import type { BlockEditing, RenduProgression, SessionEditing } from "@/api/types";
import { cn } from "@/lib/utils";
import i18n from "@/i18n";
import { ExerciseProgressionCard, TrajectoireDeCharge } from "./exercise-progression";
import { buildExerciseProgressionPoints, verdictRPE, type ProgressionPoint } from "./exercise-progression-data";

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
 *  en ont deux, 26,5 % en ont plusieurs. */

interface Props {
  movement: string;
  pastBlocks: BlockEditing[];
  /** Le rendu de la personne qui regarde, et le geste qui l'écrit. Sans les deux, la carte dessine le défaut, sans
   *  sélecteur. */
  rendu?: RenduProgression;
  onChoisirRendu?: (rendu: RenduProgression) => void;
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

export function MovementHistory({ movement, pastBlocks, rendu, onChoisirRendu }: Props) {
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
            rendu={rendu} onChoisirRendu={onChoisirRendu}
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

function LigneDeBloc({ bloc, ouverte, basculer, rendu, onChoisirRendu }: {
  bloc: BlocHistorique; ouverte: boolean; basculer: () => void;
  rendu?: RenduProgression; onChoisirRendu?: (rendu: RenduProgression) => void;
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
          ? <TrajectoireDeCharge points={seul.points} />
          : <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {t('training.creneaux', { count: bloc.creneaux.length })}
            </span>}

        <PastilleRPE points={bloc.tousLesPoints} />
      </button>

      {ouverte && (
        <div id={idContenu} className="flex flex-col gap-2 border-t border-border/60 px-2.5 py-2">
          {bloc.creneaux.map((creneau) => (
            <div key={creneau.key}>
              {/* Le sous-en-tête n'existe que là où il y a plusieurs créneaux à
                  distinguer — sinon il répéterait la ligne juste au-dessus. */}
              {!seul && (
                <div className="mb-1 flex items-center gap-3 px-0.5">
                  <span className="min-w-0 grow truncate text-[11px] font-medium text-muted-foreground">
                    {libelleCreneau(creneau, bloc.creneaux)}
                  </span>
                  <TrajectoireDeCharge points={creneau.points} />
                </div>
              )}
              <ExerciseProgressionCard points={creneau.points} contexte="base" rendu={rendu} onChoisirRendu={onChoisirRendu} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
