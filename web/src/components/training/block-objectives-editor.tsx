import { useState } from "react";
import { Check, ChevronDown, ChevronRight, ChevronUp, Eye, Pencil, Plus, Target, Trash2 } from "lucide-react";

import type { BlockObjective } from "@/api/types";
import { Input } from "@/components/ui/input";
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
  onAdd: () => void;
  onUpdate: (index: number, field: keyof BlockObjective, value: string | null) => void;
  onRemove: (index: number) => void;
  /** Déplace un objectif — l'ordre de la liste EST sa position en base. */
  onMove?: (from: number, to: number) => void;
}

/** Mêmes valeurs que le format d'un exercice de séance (`session-table`). */
const EXERCISE_FORMATS = ["", "EMOM", "AMRAP", "CLUSTER"];

const SELECT_CLASS =
  "h-11 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold sm:h-[38px] sm:text-xs";

/** La CHARGE d'un objectif, telle qu'elle se lit : un seul nombre quand les deux
 *  bornes se valent ou que le max manque, une fourchette sinon. Sortie des deux
 *  vues qui l'écrivaient chacune de son côté. */
function charge(o: BlockObjective): string {
  if (!o.weightMin && !o.weightMax) return "";
  const seul = o.weightMin === o.weightMax || !o.weightMax;
  return `${seul ? o.weightMin : `${o.weightMin}–${o.weightMax}`} kg`;
}

/** L'objectif en une phrase — ce que la fiche d'édition relit sous les champs.
 *  « squat comp 5×3 à 140–150 kg ». */
function phrase(o: BlockObjective): string {
  const morceaux = [
    (o.exercise || "").toLowerCase(),
    (o.variant || "").toLowerCase(),
    o.format || "",
    o.sets && o.reps ? `${o.sets}×${o.reps}` : "",
  ].filter(Boolean);
  /* Pas de préposition : la phrase est rendue dans les deux langues du produit,
     et « à » y laissait un mot français au milieu de l'anglais. */
  const kg = charge(o);
  if (kg) morceaux.push(kg);
  if (o.assistance) morceaux.push(`(${o.assistance})`);
  return morceaux.join(" ");
}

/** LA CARTE — une par objectif, la même pour le coach et pour l'athlète.
 *
 *  ⚠️ UN OBJECTIF EST UNE PHRASE, PAS UNE LIGNE DE CELLULES. Le mouvement porte
 *  la typographie d'affichage, la charge est en doré parce que c'est la donnée
 *  qu'on cherche des yeux, et le reste s'efface derrière. En cellules de même
 *  poids, il fallait lire les neuf pour retrouver laquelle comptait. */
export function CarteObjectif({ o, peutEcrire, onBasculerAtteint }: {
  o: BlockObjective;
  peutEcrire: boolean;
  onBasculerAtteint?: () => void;
}) {
  const { t } = useTranslation();
  const atteint = !!o.atteintLe;
  const kg = charge(o);
  return (
    /* ⚠️ UNE SEULE LIGNE, ET LA MARQUE À GAUCHE. Trois formes se sont succédé ici,
       et chacune a été mesurée à l'écran : la ligne de neuf cellules (illisible),
       la carte de quatre lignes à 100 px (« c'est un peu gros, ça écrase tout le
       reste » — William, 12/09), puis celle-ci. L'état se lit AVANT le mouvement,
       comme dans toute liste à cocher ; les chiffres s'alignent à droite, où
       l'œil les compare d'une carte à l'autre.

       ⚠️ LE MOUVEMENT ET LA CHARGE SONT LES DEUX SEULS ÉLÉMENTS QUI PORTENT DU
       POIDS. Variante, format, assistance et date d'atteinte s'effacent derrière
       — ce sont des précisions, pas le sujet. */
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      {/* ⚠️ LE GESTE LE PLUS CHARGÉ DE SENS ÉTAIT LE PLUS PETIT ÉLÉMENT DE
          L'ÉCRAN : une case de 16 px au bout de neuf cellules. Décision de
          William, 02/09 — « c'est une satisfaction, c'est pédagogique ; pas pour
          du tracking, le tableau des PR le fait ». Il garde ses 44 px au doigt
          (le plancher tactile de `index.css`), et se resserre au pointeur fin. */}
      {peutEcrire ? (
        <button
          type="button"
          onClick={onBasculerAtteint}
          aria-pressed={atteint}
          title={t(atteint ? "objectives.rouvrir" : "objectives.marquerAtteint")}
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded border transition-colors sm:h-6 sm:w-6",
            atteint
              ? "border-transparent bg-gold text-gold-foreground"
              : "border-border text-muted-foreground hover:border-gold/40 hover:text-foreground",
          )}
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      ) : (
        /* Côté athlète, une marque STATIQUE — et la case vide reste un carré
           dessiné : « pas encore » doit se voir autant que « fait ». */
        <span aria-hidden
              className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                            atteint ? "border-transparent bg-gold text-gold-foreground" : "border-border/70 text-transparent")}>
          <Check className="h-3 w-3" />
        </span>
      )}

      <span className="min-w-0 flex-1 truncate">
        <span className={cn("font-display text-[15px] font-bold uppercase tracking-[0.01em]",
                            atteint && "text-gold")}>
          {o.exercise || "—"}
        </span>
        {o.variant && (
          <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">{o.variant}</span>
        )}
        {/* Le format prend la pastille bleue `--metric`, comme partout ailleurs
            dans le produit : c'est une nature d'exercice, pas une mesure. */}
        {o.format && (
          <span className="ml-1.5 rounded px-1 font-display text-[9px] uppercase tracking-wider text-metric"
                style={{ backgroundColor: 'color-mix(in oklab, var(--metric) 15%, transparent)' }}>
            {o.format}
          </span>
        )}
        {o.assistance && (
          <span className="ml-1.5 text-[10px] text-muted-foreground">{o.assistance}</span>
        )}
        {atteint && (
          <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
            {t("objectives.atteintLe", { date: formatShort(o.atteintLe!) })}
          </span>
        )}
      </span>

      <span className="flex shrink-0 items-baseline gap-2 font-mono text-[11px] tabular-nums">
        {o.sets && o.reps && (
          <span className="text-muted-foreground">{o.sets}×{o.reps}</span>
        )}
        {kg && <span className="font-bold text-gold">{kg}</span>}
      </span>
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
function EnTete({ blockLabel, atteints, total, action, deplie, onBasculer }: {
  blockLabel: string; atteints: number; total: number; action?: React.ReactNode;
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
        <CompteurAtteints atteints={atteints} total={total} />
      </button>
      {action}
    </div>
  );
}

/** Le COMPTE, extrait de l'en-tête pour servir les deux écrans qui montrent
 *  cette liste — la vue entraînement et le tableau de bord. `goals-list` affiche
 *  `n/total` depuis toujours ; ici, aucun total n'existait, ni d'un côté ni de
 *  l'autre. */
export function CompteurAtteints({ atteints, total }: { atteints: number; total: number }) {
  const { t } = useTranslation();
  if (total === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
        {t("objectives.atteintsSur", { n: atteints, total })}
      </span>
      <span className="h-1 w-[78px] overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full bg-gold"
              style={{ width: `${Math.round((atteints / total) * 100)}%` }} />
      </span>
    </div>
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
    <li className={cn("rounded-md border bg-card/60 px-3 py-2",
                      atteint ? "border-gold/45" : "border-border/70", className)}
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
  const atteints = objectives.filter(o => o.atteintLe).length;
  return (
    // ⚠️ SANS CADRE PROPRE (1b, 13/09) : le groupe d'objectifs sous l'en-tête
    // du programme le porte (`training.tsx`), avec le filet entre les deux.
    <section>
      <EnTete blockLabel={blockLabel} atteints={atteints} total={objectives.length}
              deplie={deplie} onBasculer={() => setDeplie(d => !d)} />
      {deplie && (
        <ul className="flex flex-col gap-1.5 px-3.5 pb-3.5">
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
  onAdd, onUpdate, onRemove, onMove,
}: Props) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  /* ⚠️ APERÇU PAR DÉFAUT, et c'est le vocabulaire du produit : `goals-list`,
     `all-time-pr-table` et `rm-percentage-table` ont déjà cette bascule. Cet
     éditeur était le seul écran à s'ouvrir en mode saisie, alors qu'on vient
     presque toujours y lire. */
  const [modifier, setModifier] = useState(false);
  /* ⚠️ UNE SEULE FICHE OUVERTE — c'est l'avantage décisif sur le tableau : les
     autres objectifs restent LISIBLES pendant qu'on en corrige un. */
  const [ouvert, setOuvert] = useState<number | null>(null);
  // Replié par défaut, comme la lecture de l'athlète (voir `BlockObjectivesList`).
  const [deplie, setDeplie] = useState(false);
  const atteints = objectives.filter(o => o.atteintLe).length;

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
        atteints={atteints}
        total={objectives.length}
        deplie={deplie}
        onBasculer={() => setDeplie(d => !d)}
        action={deplie && (
          <button
            type="button"
            onClick={() => { setModifier(v => !v); setOuvert(null); }}
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
        <ul className="mb-3 flex flex-col gap-1.5">
          {objectives.map((o, i) => {
            const enEdition = modifier && ouvert === i;
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
                    <button type="button" onClick={() => setOuvert(enEdition ? null : i)}
                            className="min-w-0 flex-1 text-left">
                      <CarteObjectif o={o} peutEcrire={false} />
                    </button>
                  ) : (
                    <CarteObjectif o={o} peutEcrire onBasculerAtteint={() => basculerAtteint(i, o)} />
                  )}
                </div>

                {enEdition && (
                  <div className="mt-3 border-t border-border/60 pt-3">
                    {/* ⚠️ LES LIBELLÉS SONT EN DUR, AU-DESSUS. Un `placeholder`
                        s'efface à la frappe — au moment exact où l'on a besoin de
                        savoir ce qu'on remplit. Même leçon que le pli de saisie. */}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <Champ libelle={t('objectives.mouvement')}>
                        <select className={SELECT_CLASS} value={o.exercise ?? ''}
                                onChange={e => onUpdate(i, "exercise", e.target.value)}>
                          <option value="">—</option>
                          {exerciseOptions.map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </Champ>
                      <Champ libelle={t('objectives.variant')}>
                        <select className={SELECT_CLASS} value={o.variant ?? ''}
                                onChange={e => onUpdate(i, "variant", e.target.value)}>
                          <option value="">—</option>
                          {variantOptions.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      </Champ>
                      <Champ libelle={t('objectives.format')}>
                        <select className={SELECT_CLASS} value={o.format ?? ''}
                                onChange={e => onUpdate(i, "format", e.target.value)}>
                          {EXERCISE_FORMATS.map(f => <option key={f} value={f}>{f || "—"}</option>)}
                        </select>
                      </Champ>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Champ libelle={t('objectives.series')}>
                        <Input value={o.sets ?? ''} className="h-11 w-full text-sm sm:h-[38px] sm:text-xs"
                               onChange={e => onUpdate(i, "sets", e.target.value)} />
                      </Champ>
                      <Champ libelle={t('objectives.reps')}>
                        <Input value={o.reps ?? ''} className="h-11 w-full text-sm sm:h-[38px] sm:text-xs"
                               onChange={e => onUpdate(i, "reps", e.target.value)} />
                      </Champ>
                      <Champ libelle={t('objectives.chargeKg')} className="col-span-2">
                        <div className="flex items-center gap-1.5">
                          {/* Le liseré doré des champs de charge, comme dans le
                              pli de saisie : c'est la valeur qu'on vient poser. */}
                          <Input value={o.weightMin ?? ''} className="h-11 w-full border-gold/25 text-sm sm:h-[38px] sm:text-xs"
                                 onChange={e => onUpdate(i, "weightMin", e.target.value)} />
                          <span className="text-xs text-muted-foreground">–</span>
                          <Input value={o.weightMax ?? ''} className="h-11 w-full border-gold/25 text-sm sm:h-[38px] sm:text-xs"
                                 onChange={e => onUpdate(i, "weightMax", e.target.value)} />
                        </div>
                      </Champ>
                    </div>

                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <Champ libelle={t('objectives.assistance')}>
                        <select className={SELECT_CLASS} value={o.assistance || ""}
                                onChange={e => onUpdate(i, "assistance", e.target.value)}>
                          <option value="">—</option>
                          {assistanceOptions.map(a => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </Champ>
                    </div>

                    {/* ⚠️ LA PHRASE EN RELECTURE. Elle vérifie d'un coup d'œil que
                        l'objectif dit bien ce qu'on voulait, sans repasser en
                        Aperçu — sept champs remplis ne se relisent pas tout
                        seuls. */}
                    {phrase(o) && (
                      <p className="mt-2.5 text-[11px] italic text-muted-foreground">
                        {t('objectives.seLit', { phrase: phrase(o) })}
                      </p>
                    )}

                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => basculerAtteint(i, o)}
                        aria-pressed={!!o.atteintLe}
                        className={cn(
                          "flex h-11 items-center gap-1.5 rounded-md border px-3 text-xs transition-colors sm:h-[38px]",
                          o.atteintLe
                            ? "border-transparent bg-gold font-semibold text-gold-foreground"
                            : "border-border text-muted-foreground hover:border-gold/40 hover:text-foreground",
                        )}
                      >
                        <Check className="h-3.5 w-3.5" />
                        {o.atteintLe
                          ? t("objectives.atteintLe", { date: formatShort(o.atteintLe) })
                          : t("objectives.marquerAtteint")}
                      </button>
                      <button
                        type="button"
                        title={t('objectives.removeTitle')}
                        onClick={async () => {
                          if (await confirm({ title: t('objectives.confirmRemove', { name: o.exercise || t('objectives.fallbackName') }) })) {
                            setOuvert(null);
                            onRemove(i);
                          }
                        }}
                        className="ml-auto flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/15 hover:text-destructive sm:h-[38px] sm:w-[38px]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </Cadre>
            );
          })}
        </ul>
      )}

      {modifier && (
        <button
          type="button"
          onClick={onAdd}
          className="mb-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border text-xs text-muted-foreground transition-colors hover:border-gold/40 hover:text-foreground sm:h-10"
        >
          <Plus className="h-3.5 w-3.5" /> {t("objectives.add")}
        </button>
      )}
      </div>
      )}
    </section>
  );
}

function Champ({ libelle, className, children }: {
  libelle: string; className?: string; children: React.ReactNode;
}) {
  return (
    <label className={cn("block min-w-0", className)}>
      <span className="mb-1 block font-display text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {libelle}
      </span>
      {children}
    </label>
  );
}
