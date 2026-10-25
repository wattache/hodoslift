import { useState } from "react";
import { Check, ChevronDown, ChevronRight, ChevronUp, Eye, Pencil, Plus, Target } from "lucide-react";

import type { BlockObjective } from "@/api/types";
import { ObjectifDialog } from "./objectif-dialog";
import { formatBadgeSuffix } from "./format";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { formatShort } from "@/lib/dates-ui";
import { cn } from "@/lib/utils";
import { useTranslation } from 'react-i18next';

/**
 * Objectifs du bloc — cibles que le coach fixe pour le bloc en cours
 * (mouvement, variante, format, séries × reps, fourchette de charge, assistance).
 *
 * Portés par le BLOC : table Postgres `block_objectives`, écrite par
 * `PUT .../objectives` (remplacement complet, l'ordre du tableau EST la
 * position). Ils étaient auparavant recopiés sur chaque semaine du bloc.
 *
 * ⚠️ L'ÉCRAN FAISAIT L'INVERSE DE L'USAGE (refonte des écrans, 09/2026). Le coach passe l'essentiel
 * de son temps à LIRE cette liste et une fraction à l'écrire ; elle était rendue
 * en tableau de neuf colonnes à `min-w-[720px]`, avec sept champs de 28 px
 * toujours ouverts sur chaque ligne. Le mouvement — le sujet de l'objectif —
 * avait exactement le même poids visuel qu'« assistance », et le défilement
 * horizontal commençait dès la tablette.
 *
 * ⚠️ ET UN OBJECTIF ATTEINT DEVENAIT ILLISIBLE. `opacity-55` sur la ligne : la
 * réussite effaçait ce qu'elle récompense, sous le seuil de contraste. C'est
 * l'inverse de ce que l'état veut dire, et c'est la même correction que celle
 * déjà passée sur la vue semaine — un état se marque en POSITIF, par un cadre et
 * une couleur, jamais en retirant de la lumière.
 *
 * ⚠️ LES TROIS VUES SONT LA MÊME CARTE. `BlockObjectivesEditor` (coach),
 * `BlockObjectivesList` (ce que l'athlète lit sur sa vue entraînement) et le
 * TABLEAU DE BORD montraient la même donnée au même moment sous trois formes
 * sans rapport — tableau de neuf colonnes, pastilles `flex-wrap`, et pastilles
 * plates grises qui avaient en plus perdu `atteintLe` à la frontière de leur
 * composant (refonte des écrans, 09/2026). Elles partagent désormais `CarteObjectif`, paramétrée par
 * `peutEcrire` — exportée avec `Cadre` et `CompteurAtteints` pour que le tableau
 * de bord la compose sans la recopier. Une seule mise en page à faire évoluer.
 */

interface Props {
  objectives: BlockObjective[];
  blockLabel: string;
  exerciseOptions: string[];
  variantOptions: string[];
  assistanceOptions: string[];
  /** Ajoute un objectif COMPLET — vide, ou pré-rempli depuis une ligne de BASE. */
  onAdd: (o: BlockObjective) => void;
  /** Remplace un objectif par celui de la fenêtre, d'un seul geste. */
  onReplace: (index: number, o: BlockObjective) => void;
  onUpdate: (index: number, field: keyof BlockObjective, value: string | null) => void;
  onRemove: (index: number) => void;
  /** Déplace un objectif — l'ordre de la liste EST sa position en base. */
  onMove?: (from: number, to: number) => void;
}

/** La CHARGE d'un objectif, telle qu'elle se lit : un seul nombre quand les deux
 *  bornes se valent ou que le max manque, une fourchette sinon. Sortie des deux
 *  vues qui l'écrivaient chacune de son côté. */
function charge(o: BlockObjective): string {
  if (!o.weightMin && !o.weightMax) return "";
  const seul = o.weightMin === o.weightMax || !o.weightMax;
  return `${seul ? o.weightMin : `${o.weightMin}–${o.weightMax}`} kg`;
}

/** Le format avec ses options, écrit comme sur une ligne de séance : « EMOM 10' - 60" ». */
export function formatComplet(o: BlockObjective): string {
  if (!o.format) return "";
  return (o.format + formatBadgeSuffix({ format: o.format, clusterMode: o.clusterMode ?? null,
                                         clusterRest: o.clusterRest ?? null, sets: o.sets ?? null })).trim();
}

/** L'objectif en une phrase — ce que la fiche d'édition relit sous les champs.
 *  « squat comp 5×3 à 140–150 kg ». */
export function phrase(o: BlockObjective): string {
  const morceaux = [
    (o.exercise || "").toLowerCase(),
    (o.variant || "").toLowerCase(),
    formatComplet(o),
    o.tempo ? `tempo ${o.tempo}` : "",
    o.sets && o.reps ? `${o.sets}×${o.reps}` : "",
  ].filter(Boolean);
  /* Pas de préposition : la phrase est rendue dans les deux langues du produit,
     et « à » y laissait un mot français au milieu de l'anglais. */
  const kg = charge(o);
  if (kg) morceaux.push(kg);
  if (o.assistance) morceaux.push(`(${o.assistance})`);
  return morceaux.join(" ");
}

const nombre = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

/** Un format MINUTÉ prend le bleu `--metric`, les autres l'or — la règle de
 *  `session-table` et `week-overview` : le bleu dit le temps, pas « un format ». */
function formatMinute(format: string | null | undefined): boolean {
  const f = (format ?? "").toUpperCase();
  return f === "AMRAP" || /^E.*MOM$/.test(f);
}

/** LA TUILE — une par objectif, la même pour le coach, l'athlète et le tableau
 *  de bord (FRE-254).
 *
 *  ⚠️ UN OBJECTIF EST UNE CIBLE ET UNE DISTANCE, PAS UNE CASE. La liste à cocher
 *  portait un bit par ligne ; la tuile porte la cible (le plus gros chiffre, en
 *  or), le chemin fait depuis le début du bloc, et où en est l'athlète. La coche
 *  reste — « une satisfaction, c'est pédagogique » (William, 02/09) —, en coin.
 *
 *  ⚠️ RIEN N'EST INVENTÉ : l'avancement vient de brokkr (`avancement`). Sans
 *  mesure, un rail tireté et on l'écrit ; jamais une jauge à zéro. */
export function CarteObjectif({ o, peutEcrire, onBasculerAtteint }: {
  o: BlockObjective;
  peutEcrire: boolean;
  onBasculerAtteint?: () => void;
}) {
  const { t } = useTranslation();
  const atteint = !!o.atteintLe;
  const kg = charge(o);
  const av = o.avancement;
  const etat = atteint ? "atteint" : (av?.etat ?? (kg ? "sans_mesure" : "sans_cible"));
  const sousTitre = [o.variant, o.tempo, o.assistance].filter(v => (v ?? "").trim()).join(" · ");
  const ou = av?.fait != null && av.semaine != null
    ? t("objectives.faitEnSemaine", { charge: nombre(av.fait), semaine: av.semaine }) : "";
  const jauge = etat === "atteint" || etat === "dans_la_cible" ? 1 : etat === "en_route" ? (av?.jauge ?? 0) : null;
  const libelle = [o.exercise, sousTitre, o.sets && o.reps ? `${o.sets}×${o.reps}` : "",
    kg ? t("objectives.vise", { charge: kg }) : t("objectives.pasDeChargeVisee"), ou,
    etat === "en_route" && av?.reste != null ? t("objectives.resteKg", { reste: nombre(av.reste) }) : ""]
    .filter(Boolean).join(", ");

  return (
    <div className="flex min-w-0 flex-col gap-1.5" aria-label={libelle}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <span className={cn("font-display text-[15px] font-bold uppercase leading-tight tracking-[0.01em]", atteint && "text-gold")}>
              {o.exercise || "—"}
            </span>
            {o.format && (
              <span className={cn("rounded border px-1 font-mono text-[9px] uppercase leading-4",
                                  formatMinute(o.format) ? "border-metric/40 text-metric" : "border-gold/40 text-gold")}>
                {formatComplet(o)}
              </span>
            )}
          </div>
          {sousTitre && <div className="truncate font-mono text-[10px] uppercase text-muted-foreground">{sousTitre}</div>}
        </div>
        {/* La coche garde ses 44 px au doigt par la zone cliquable, pas par le
            carré dessiné. */}
        {peutEcrire ? (
          <button type="button" onClick={onBasculerAtteint} aria-pressed={atteint}
                  title={t(atteint ? "objectives.rouvrir" : "objectives.marquerAtteint")}
                  className="-m-2.5 flex h-11 w-11 shrink-0 items-center justify-center sm:-m-1.5 sm:h-8 sm:w-8">
            <span className={cn("flex h-[22px] w-[22px] items-center justify-center rounded border transition-colors",
                                atteint ? "border-transparent bg-gold text-gold-foreground" : "border-border text-transparent hover:border-gold/50")}>
              <Check className="h-3.5 w-3.5" />
            </span>
          </button>
        ) : (
          <span aria-hidden className={cn("flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded border",
                                          atteint ? "border-transparent bg-gold text-gold-foreground" : "border-border/70 text-transparent")}>
            <Check className="h-3.5 w-3.5" />
          </span>
        )}
      </div>

      <div className="flex items-baseline justify-between gap-2 font-mono tabular-nums">
        <span className="text-[11px] text-muted-foreground">{o.sets && o.reps ? `${o.sets}×${o.reps}` : ""}</span>
        <span className={cn("text-[17px] font-semibold", kg ? "text-gold" : "text-muted-foreground")}>{kg || "—"}</span>
      </div>

      {jauge != null ? (
        <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-muted">
          <span className={cn("block h-full rounded-full", jauge >= 1 ? "bg-gold" : "bg-gold/45")}
                style={{ width: `${Math.round(Math.min(Math.max(jauge, 0), 1) * 100)}%` }} />
        </span>
      ) : (
        <span aria-hidden className="block h-1.5 rounded-full border border-dashed border-border" />
      )}

      <div className="flex min-h-4 items-baseline justify-between gap-2 font-mono text-[10.5px] tabular-nums">
        {etat === "atteint" ? (
          <span className="text-gold">{t("objectives.atteintLe", { date: formatShort(o.atteintLe!) })}</span>
        ) : etat === "sans_cible" ? (
          /* Au téléphone, le geste seul : une phrase tronquée ne dit plus rien. */
          <><span className="hidden truncate text-muted-foreground sm:inline">{t("objectives.pasDeChargeVisee")}</span>
            <span className="ml-auto shrink-0 text-muted-foreground">{t("objectives.aCocher")}</span></>
        ) : etat === "sans_mesure" ? (
          <><span className="hidden truncate text-muted-foreground sm:inline">{t("objectives.rienDeComparable")}</span>
            <span className="truncate text-muted-foreground sm:hidden">{t("objectives.pasDeMesure")}</span></>
        ) : (
          <><span className="truncate text-muted-foreground">{ou}</span>
            <span className="shrink-0 font-semibold text-gold">
              {etat === "dans_la_cible" ? t("objectives.dansLaCible") : `+${nombre(av?.reste ?? 0)}`}
            </span></>
        )}
      </div>
    </div>
  );
}

/** L'en-tête commun : titre, bloc, le COMPTE, et le repli.
 *
 *  ⚠️ RIEN NE COMPTAIT. `goals-list` affiche `n/total` depuis toujours ; ici,
 *  aucun total — il fallait parcourir la liste pour savoir où l'on en était.
 *
 *  ⚠️ ET LA CARTE SE REPLIE, CHEVRON VISIBLE (William, 12/09). Le compte et la
 *  barre vivent dans l'en-tête, donc replié dit encore où l'on en est : c'est ce
 *  qui rend le repli acceptable ici, là où replier une liste de séances ne
 *  laisserait qu'un titre au-dessus du vide. Le chevron est la seule chose qui
 *  ANNONCE le geste — `aria-expanded` ne le dit qu'aux lecteurs d'écran. */
function EnTete({ blockLabel, objectives, action, deplie, onBasculer }: {
  blockLabel: string; objectives: BlockObjective[]; action?: React.ReactNode;
  deplie: boolean; onBasculer: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5">
      <button
        type="button"
        onClick={onBasculer}
        aria-expanded={deplie}
        /* ⚠️ UN NOM EXPLICITE, ET IL RÈGLE HUIT SPECS D'UN COUP. Sans lui, le nom
           accessible est calculé depuis le contenu — « Objectifs du bloc ·
           Intensification 1/2 atteints » — et tout `getByRole('button', { name:
           'Intensification' })` du harnais attrapait AUSSI cet en-tête, en plus de
           l'onglet du bloc. Huit specs sans rapport sont tombées là-dessus.
           Corrigé ici plutôt que dans les specs : un bouton de commande doit dire
           ce qu'il COMMANDE, pas réciter la zone qu'il ouvre. */
        aria-label={t("objectives.objectifsDuBloc")}
        /* `flex-wrap` : sous 360 px, le compte passe à la ligne au lieu d'être
           rogné par le cadre du groupe d'objectifs (1b, 13/09) — replié, c'est
           lui qui dit encore où l'on en est. */
        className="-my-1 flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 rounded py-1 text-left"
      >
        <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                                    deplie && "rotate-90")} aria-hidden />
        <Target className="h-3.5 w-3.5 shrink-0 text-gold" />
        <h3 className="shrink-0 text-sm font-semibold">{t("objectives.objectifsDuBloc")}</h3>
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">· {blockLabel}</span>
        <CompteurAtteints objectives={objectives} />
      </button>
      {action}
    </div>
  );
}

/** Le COMPTE, extrait de l'en-tête pour servir les deux écrans qui montrent
 *  cette liste — la vue entraînement et le tableau de bord. `goals-list` affiche
 *  `n/total` depuis toujours ; ici, aucun total n'existait, ni d'un côté ni de
 *  l'autre. */
export function CompteurAtteints({ objectives }: { objectives: BlockObjective[] }) {
  const { t } = useTranslation();
  if (objectives.length === 0) return null;
  const etat = (o: BlockObjective) => (o.atteintLe ? "atteint" : o.avancement?.etat);
  const atteints = objectives.filter(o => etat(o) === "atteint").length;
  const enRoute = objectives.filter(o => etat(o) === "en_route" || etat(o) === "dans_la_cible").length;
  const sansCible = objectives.filter(o => etat(o) === "sans_cible").length;
  return (
    <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
      {[t("objectives.nAtteints", { count: atteints }),
        enRoute ? t("objectives.nEnRoute", { count: enRoute }) : "",
        sansCible ? t("objectives.nSansCible", { count: sansCible }) : ""].filter(Boolean).join(" · ")}
    </span>
  );
}

/** Le cadre d'un objectif — porte l'état, jamais l'opacité.
 *
 *  ⚠️ EXPORTÉ AVEC `CarteObjectif` (refonte des écrans, 09/2026). Le tableau de bord rendait la MÊME
 *  liste en pastilles plates grises — et y perdait `atteintLe`, jeté à la
 *  frontière de `CycleCard` dont la signature ne le déclarait pas. Trois écrans
 *  montrant la même donnée sous trois formes, c'est le défaut que cette refonte
 *  a déjà corrigé une fois entre le coach et l'athlète. */
export function Cadre({ atteint, className, children }: {
  atteint: boolean; className?: string; children: React.ReactNode;
}) {
  return (
    <li className={cn("rounded-lg border px-3 py-2.5",
                      atteint ? "border-gold/45 bg-gold/[0.07]" : "border-border/70 bg-card/60", className)}
        style={atteint ? { boxShadow: "inset 2px 0 0 var(--gold)" } : undefined}>
      {children}
    </li>
  );
}

/** Ce que l'athlète lit sur sa vue entraînement — la même carte, sans les
 *  gestes d'écriture. */
export function BlockObjectivesList({ objectives, blockLabel }: { objectives: BlockObjective[]; blockLabel: string }) {
  /* ⚠️ REPLIÉ PAR DÉFAUT, des deux côtés (William, 13/09), comme le journal
     technique juste en dessous. Ce fut déplié — « l'écran s'ouvre sur les cibles
     du bloc » —, mais sous l'en-tête fusionné (1b) deux listes ouvertes
     repoussaient la séance sous la ligne de flottaison. Replié ne cache rien
     d'essentiel : la ligne garde le compte et sa barre, qui disent où l'on en
     est. */
  const [deplie, setDeplie] = useState(false);
  if (objectives.length === 0) return null;
  return (
    // ⚠️ SANS CADRE PROPRE (1b, 13/09) : le groupe d'objectifs sous l'en-tête
    // du programme le porte (`training.tsx`), avec le filet entre les deux.
    <section>
      <EnTete blockLabel={blockLabel} objectives={objectives}
              deplie={deplie} onBasculer={() => setDeplie(d => !d)} />
      {deplie && (
        <ul className="grid grid-cols-2 gap-2 px-3.5 pb-3.5 lg:grid-cols-3">
          {objectives.map((o, i) => (
            <Cadre key={i} atteint={!!o.atteintLe}>
              <CarteObjectif o={o} peutEcrire={false} />
            </Cadre>
          ))}
        </ul>
      )}
    </section>
  );
}

export function BlockObjectivesEditor({
  objectives, blockLabel, exerciseOptions, variantOptions, assistanceOptions,
  onAdd, onReplace, onUpdate, onRemove, onMove,
}: Props) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  /* ⚠️ APERÇU PAR DÉFAUT, et c'est le vocabulaire du produit : `goals-list`,
     `all-time-pr-table` et `rm-percentage-table` ont déjà cette bascule. Cet
     éditeur était le seul écran à s'ouvrir en mode saisie, alors qu'on vient
     presque toujours y lire. */
  const [modifier, setModifier] = useState(false);
  /* LA FENÊTRE D'OBJECTIF (FRE-252) : `index` null pour un ajout. La liste reste
     lisible derrière, et rien ne s'écrit avant « Enregistrer ». */
  const [fenetre, setFenetre] = useState<{ index: number | null; o: BlockObjective } | null>(null);
  // Replié par défaut, comme la lecture de l'athlète (voir `BlockObjectivesList`).
  const [deplie, setDeplie] = useState(false);

  const basculerAtteint = (i: number, o: BlockObjective) =>
    /* ⚠️ LA DATE EST POSÉE PAR L'ÉCRAN, PAS SAISIE. Le serveur stocke un jour
       (`atteint_le`) pour parler la même langue que les objectifs d'athlète —
       mais ici on ne demande pas QUAND, on demande SI. Cocher écrit aujourd'hui,
       décocher efface ; l'écriture étant un remplacement complet de la liste,
       les deux gestes passent par le même chemin. */
    onUpdate(i, "atteintLe", o.atteintLe ? "" : new Date().toISOString().slice(0, 10));

  return (
    // ⚠️ SANS CADRE PROPRE (1b, 13/09) : le groupe d'objectifs sous l'en-tête
    // du programme le porte (`training.tsx`), avec le filet entre les deux.
    <section>
      <EnTete
        blockLabel={blockLabel}
        objectives={objectives}
        deplie={deplie}
        onBasculer={() => setDeplie(d => !d)}
        action={deplie && (
          <button
            type="button"
            onClick={() => { setModifier(v => !v); setFenetre(null); }}
            aria-pressed={modifier}
            className={cn(
              "flex h-11 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors sm:h-8",
              modifier
                ? "bg-gold/15 text-gold hover:bg-gold/20"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {modifier
              ? <><Eye className="h-3.5 w-3.5" /> {t("goals.preview")}</>
              : <><Pencil className="h-3.5 w-3.5" /> {t("goals.edit")}</>}
          </button>
        )}
      />

      {/* Le corps déplié porte son propre retrait : la section n'a plus de padding. */}
      {deplie && (
      <div className="px-3.5">
      {objectives.length === 0 ? (
        <p className="mb-3 text-xs text-muted-foreground">{t('objectives.empty')}</p>
      ) : (
        <ul className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-3">
          {objectives.map((o, i) => {
            return (
              <Cadre key={i} atteint={!!o.atteintLe}>
                <div className="flex items-start gap-2">
                  {modifier && onMove && (
                    /* ⚠️ L'ORDRE DE LA LISTE EST LA POSITION EN BASE, et aucun
                       geste ne permettait de le changer — le tableau laissait
                       seulement croire le contraire. Des flèches plutôt qu'une
                       poignée : c'est ce que fait déjà `session-table` pour les
                       exercices, et un dépôt tactile se rate. */
                    <div className="flex shrink-0 flex-col gap-0.5">
                      <button type="button" title={t('objectives.monter')} disabled={i === 0}
                              onClick={() => onMove(i, i - 1)}
                              className="flex h-[18px] w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30">
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" title={t('objectives.descendre')} disabled={i === objectives.length - 1}
                              onClick={() => onMove(i, i + 1)}
                              className="flex h-[18px] w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30">
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}

                  {modifier ? (
                    <button type="button" onClick={() => setFenetre({ index: i, o })}
                            aria-label={t("objectives.modifierLObjectif", { nom: o.exercise || t("objectives.fallbackName") })}
                            className="min-w-0 flex-1 text-left">
                      <CarteObjectif o={o} peutEcrire={false} />
                    </button>
                  ) : (
                    <CarteObjectif o={o} peutEcrire onBasculerAtteint={() => basculerAtteint(i, o)} />
                  )}
                </div>

              </Cadre>
            );
          })}
        </ul>
      )}

      {modifier && (
        <button
          type="button"
          onClick={() => setFenetre({ index: null, o: objectifVide() })}
          className="mb-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border text-xs text-muted-foreground transition-colors hover:border-gold/40 hover:text-foreground sm:h-10"
        >
          <Plus className="h-3.5 w-3.5" /> {t("objectives.add")}
        </button>
      )}
      </div>
      )}

      {fenetre && (
        <ObjectifDialog
          initial={fenetre.o}
          nouveau={fenetre.index === null}
          exerciseOptions={exerciseOptions}
          variantOptions={variantOptions}
          assistanceOptions={assistanceOptions}
          phrase={phrase}
          onClose={() => setFenetre(null)}
          onSave={o => {
            if (fenetre.index === null) onAdd(o); else onReplace(fenetre.index, o);
            setFenetre(null);
          }}
          onRemove={fenetre.index === null ? undefined : async () => {
            const i = fenetre.index!;
            if (await confirm({ title: t('objectives.confirmRemove', { name: fenetre.o.exercise || t('objectives.fallbackName') }) })) {
              setFenetre(null);
              onRemove(i);
            }
          }}
        />
      )}
    </section>
  );
}

/** Un objectif vierge, champs de texte à `''` comme la lecture les rend. */
export function objectifVide(): BlockObjective {
  return { id: '', exercise: '', variant: '', format: '', clusterMode: '', clusterRest: '', tempo: '',
           sets: '', reps: '', weightMin: '', weightMax: '', assistance: '', atteintLe: null };
}
