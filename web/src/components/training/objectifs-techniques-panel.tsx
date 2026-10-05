import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, Plus, RotateCcw, Target, Trash2, X } from "lucide-react";

import {
  useCorrigerObjectif, usePoserObjectif, useSupprimerObjectif,
} from "@/api/hooks/use-objectifs-techniques";
import type { ObjectifTechnique } from "@/api/types";
import { Combobox } from "@/components/ui/combobox";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { daysBetween, formatShort, todayISO } from "@/lib/dates-ui";
import { cn } from "@/lib/utils";

/** LE JOURNAL DES OBJECTIFS TECHNIQUES (FRE-122).
 *
 *  ⚠️ UNE SECTION, PAS UN ONGLET. Un cinquième onglet dans l'espace athlète
 *  coûterait sa place à tout le monde pour une donnée que l'on consulte en même
 *  temps qu'on lit sa séance. Il vit donc sous l'entraînement, là où le mouvement
 *  tombe — et replié par défaut, parce que la pastille sur la ligne est le chemin
 *  courant ; ceci est le chemin de la revue.
 *
 *  ⚠️ LES GESTES D'ÉCRITURE N'EXISTENT QUE POUR LE COACH, parce que brokkr les
 *  refuse à tout le monde d'autre. C'est la règle d'affordance du projet : la vue
 *  ne propose pas ce que le serveur rejetterait — l'athlète ne voit donc ni le
 *  formulaire, ni les boutons de chaque entrée.
 *
 *  ⚠️ ET C'EST UN JOURNAL, PAS UNE LISTE À COCHER. Le serveur l'avait prévu ainsi
 *  — son propre schéma dit « `closLe` EST UNE DATE, PAS UN BOOLÉEN : "atteint"
 *  sans savoir quand ne raconte rien ». Cet écran lisait pourtant `closLe` comme
 *  un booléen (`!== null`) pour décider d'une OPACITÉ, et jetait la date ; il ne
 *  montrait pas non plus `creeLe`. Il affiche désormais les deux, et l'écart
 *  entre elles — « tenu 7 semaines » —, qui est toute la valeur d'un journal.
 */
export function ObjectifsTechniquesPanel({ athleteId, objectifs, mouvements, peutEcrire }: {
  athleteId: string | null | undefined;
  objectifs: readonly ObjectifTechnique[];
  /** Les mouvements de la bibliothèque — la liste FERMÉE dans laquelle le coach
   *  choisit. Le serveur refuse tout ce qui n'y est pas (clé étrangère). */
  mouvements: readonly string[];
  peutEcrire: boolean;
}) {
  const { t } = useTranslation();
  const [deplie, setDeplie] = useState(false);
  /* ⚠️ LE FORMULAIRE NE S'OUVRE QU'À LA DEMANDE. Il occupait le haut du panneau
     dès que `peutEcrire` : on pose un objectif deux fois par bloc, et on lit le
     journal tous les jours. Le geste rare ne prend plus la place du geste
     courant. */
  const [poserOuvert, setPoserOuvert] = useState(false);
  const [mouvement, setMouvement] = useState("");
  const [texte, setTexte] = useState("");
  const confirm = useConfirm();

  const poser = usePoserObjectif(athleteId);
  const corriger = useCorrigerObjectif(athleteId);
  const supprimer = useSupprimerObjectif(athleteId);

  /** ⚠️ GROUPÉ PAR MOUVEMENT, LES OUVERTS D'ABORD — et les clos restent
   *  visibles. C'est ce qui distingue un journal d'un bloc-notes : « on a réglé
   *  les talons au sol en juillet » est une information, et l'effacer la perd. */
  const groupes = useMemo(() => {
    const par = new Map<string, ObjectifTechnique[]>();
    for (const o of objectifs) {
      const liste = par.get(o.mouvement);
      if (liste) liste.push(o); else par.set(o.mouvement, [o]);
    }
    for (const liste of par.values()) {
      liste.sort((a, b) => Number(a.closLe !== null) - Number(b.closLe !== null));
    }
    return [...par.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [objectifs]);

  const ouverts = objectifs.filter(o => o.closLe === null).length;
  /* ⚠️ LA BARRE REPLIÉE NOMME LES MOUVEMENTS. « 3 en cours » dit combien, pas
     SUR QUOI — et c'est la question qu'on se pose avant de déplier. Trois noms
     au plus : au-delà, la barre déborderait sur téléphone. */
  const mouvementsOuverts = useMemo(() => {
    const noms = [...new Set(objectifs.filter(o => o.closLe === null).map(o => o.mouvement))];
    return noms.length <= 3 ? noms.join(" · ") : `${noms.slice(0, 3).join(" · ")} +${noms.length - 3}`;
  }, [objectifs]);

  return (
    // ⚠️ SANS CADRE PROPRE (1b, 13/09) : le panneau vit dans le groupe
    // d'objectifs sous l'en-tête du programme, qui porte le cadre et le filet
    // entre les deux. Deux cadres identiques de part et d'autre de la
    // navigation se lisaient comme un doublon.
    <section>
      {/* L'en-tête n'est plus un seul bouton : « Poser » vit à côté du repli, et
          un bouton ne s'imbrique pas dans un bouton. */}
      <div className="flex items-center gap-2 pr-2">
        <button
          type="button"
          onClick={() => setDeplie(d => !d)}
          aria-expanded={deplie}
          className="flex min-w-0 flex-1 items-center gap-2 px-3.5 py-2.5 text-left transition-colors hover:bg-accent/30"
        >
          {/* ⚠️ LE CHEVRON EST LA SEULE CHOSE QUI DIT QUE ÇA S'OUVRE. La barre se
              dépliait au clic sans rien l'annoncer : `aria-expanded` le dit aux
              lecteurs d'écran, et à personne d'autre. Il tourne, comme partout
              ailleurs dans le produit. */}
          <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                                      deplie && "rotate-90")} aria-hidden />
          {/* UNE SEULE CIBLE DORÉE À L'ÉCRAN : celle des objectifs du BLOC, qu'on
              lit en ouvrant la semaine. Celle-ci suit l'athlète et se consulte
              moins souvent — elle passe en gris. */}
          <Target className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-sm font-semibold">{t('training.objectifsTechniques')}</span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {ouverts > 0 ? t('training.nEnCours', { count: ouverts }) : t('training.aucunEnCours')}
            {mouvementsOuverts && <span className="text-muted-foreground/70"> · {mouvementsOuverts}</span>}
          </span>
        </button>
        {peutEcrire && deplie && (
          <button
            type="button"
            onClick={() => setPoserOuvert(v => !v)}
            className={cn(
              "flex h-11 shrink-0 items-center gap-1 rounded-md border px-2.5 text-xs font-semibold transition-colors sm:h-8",
              poserOuvert
                ? "border-border text-muted-foreground hover:bg-accent"
                : "border-gold/40 bg-gold/10 text-gold hover:bg-gold/20",
            )}
          >
            {poserOuvert
              ? <><X className="h-3.5 w-3.5" /> {t('common.annuler')}</>
              : <><Plus className="h-3.5 w-3.5" /> {t('training.poser')}</>}
          </button>
        )}
      </div>

      {deplie && (
        <div className="border-t border-border px-3 py-3">
          {peutEcrire && poserOuvert && (
            <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border bg-background/40 p-2.5">
              <div className="min-w-[10rem]">
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t('session.mouvement')}
                </label>
                {/* ⚠️ LISTE FERMÉE, adossée à la bibliothèque : le serveur refuse
                    tout nom qui n'y est pas (clé étrangère). Un champ libre
                    produirait un 422 sur une faute de frappe, là où le choix ne
                    peut pas se tromper. */}
                <Combobox value={mouvement} options={[...mouvements]} label={t('session.mouvement')}
                          placeholder={t('suiviKine.choisirPlaceholder')} onCommit={setMouvement} />
              </div>
              <div className="min-w-[14rem] flex-1">
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t('training.objectif')}
                </label>
                <input
                  value={texte}
                  onChange={e => setTexte(e.target.value)}
                  placeholder={t('training.exempleObjectifTechnique')}
                  aria-label={t('training.texteDeLObjectif')}
                  className="h-11 w-full rounded-md border border-border bg-card px-2.5 text-sm sm:h-[38px] sm:text-xs"
                />
              </div>
              <button
                type="button"
                disabled={!mouvement.trim() || !texte.trim() || poser.isPending}
                onClick={() => poser.mutate(
                  { mouvement, texte },
                  { onSuccess: () => { setTexte(""); } },
                )}
                className="flex h-11 items-center gap-1 rounded-md border border-gold/40 bg-gold/10 px-3 text-xs font-semibold text-gold transition-colors hover:bg-gold/20 disabled:opacity-40 sm:h-[38px]"
              >
                <Plus className="h-3.5 w-3.5" /> {t('training.poser')}
              </button>
            </div>
          )}

          {groupes.length === 0 ? (
            <p className="py-2 text-xs italic text-muted-foreground">
              {t('training.aucunObjectifTechnique')}
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {groupes.map(([nom, liste]) => {
                const enCours = liste.filter(o => o.closLe === null);
                const regles = liste.filter(o => o.closLe !== null);
                return (
                  <li key={nom}>
                    <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-gold">{nom}</p>
                      {/* ⚠️ LE GROUPE PORTE SON COMPTE. Sans lui, « combien me
                          reste-t-il sur le squat » se compte à l'œil. */}
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {t('training.nEnCours', { count: enCours.length })}
                        {regles.length > 0 && ` · ${t('training.nRegles', { count: regles.length })}`}
                      </p>
                    </div>

                    <ul className="flex flex-col gap-1.5">
                      {enCours.map(o => (
                        <Entree key={o.id} o={o} peutEcrire={peutEcrire}
                                corriger={corriger} supprimer={supprimer} confirm={confirm} />
                      ))}
                    </ul>

                    {/* ⚠️ RÉGLÉ N'EST PAS EFFACÉ. Les clos portaient `opacity-50`
                        et `line-through` : le composant affirmait en commentaire
                        que clore n'efface pas, et l'affichage l'effaçait à moitié,
                        sous le seuil de contraste. Ils sont rangés sous leur
                        intitulé, à pleine lisibilité — un état se marque en
                        POSITIF (cadre et coche), jamais en retirant de la lumière.
                        Même correction que sur la vue semaine et les objectifs de
                        bloc. */}
                    {regles.length > 0 && (
                      <>
                        <p className="mb-1 mt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {t('training.regles')}
                        </p>
                        <ul className="flex flex-col gap-1.5">
                          {regles.map(o => (
                            <Entree key={o.id} o={o} peutEcrire={peutEcrire}
                                    corriger={corriger} supprimer={supprimer} confirm={confirm} />
                          ))}
                        </ul>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** ⚠️ `creeLe` ET `closLe` SONT DES HORODATAGES (`…T09:00:00Z`), pas des jours —
 *  et `parseISODate` recolle `T00:00:00Z` derrière ce qu'on lui donne. Passer la
 *  valeur brute produit `Invalid Date`, en silence : on tronque au jour. */
const jour = (iso: string) => iso.slice(0, 10);

/** La durée entre deux jours, dite en semaines dès qu'il y en a une — c'est
 *  l'unité du programme. En deçà, en jours : « 0 semaine » ne dit rien. */
function duree(t: (k: string, o: { count: number }) => string, debut: string, fin: string): string {
  const jours = Math.max(0, daysBetween(jour(debut), jour(fin)));
  return jours >= 7
    ? t('training.nSemaines', { count: Math.floor(jours / 7) })
    : t('training.nJours', { count: jours });
}

function Entree({ o, peutEcrire, corriger, supprimer, confirm }: {
  o: ObjectifTechnique;
  peutEcrire: boolean;
  corriger: { mutate: (v: { objectifId: string; clos: boolean }) => void };
  supprimer: { mutate: (id: string) => void };
  confirm: (o: { title: string }) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const clos = o.closLe !== null;

  return (
    <li className={cn("flex items-start gap-2 rounded-md border px-2.5 py-2",
                      clos ? "border-gold/40" : "border-border/60")}
        style={clos ? { boxShadow: "inset 2px 0 0 var(--gold)" } : undefined}>
      {clos && <Check className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden />}
      <div className="min-w-0 flex-1">
        {/* ⚠️ 15 px, ET C'ÉTAIT LA PLUS PETITE TAILLE DE L'ÉCRAN (`text-xs`).
            L'objectif EST le contenu de ce panneau ; les dates sont l'appareil
            autour, et gardent leur mono 11 px. */}
        <p className="text-[15px] leading-snug">{o.texte}</p>
        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
          {clos ? (
            <>
              {t('training.regleLe', { date: formatShort(jour(o.closLe!)) })}
              {/* La durée tenue est une lecture de COACH ; pour l'athlète, la
                  date suffit — c'est une fierté, pas une mesure. */}
              {peutEcrire && <> · {t('training.tenu')} <span className="text-gold">{duree(t, o.creeLe, o.closLe!)}</span></>}
            </>
          ) : (
            <>
              {t('training.poseLe', { date: formatShort(jour(o.creeLe)) })}
              {/* ⚠️ EN DORÉ : c'est la durée qui dit qu'un objectif traîne, et
                  c'est la seule chose que ce journal sait dire que la liste à
                  cocher ne disait pas. */}
              {' · '}<span className="text-gold">{duree(t, o.creeLe, todayISO())}</span>
            </>
          )}
        </p>
      </div>
      {peutEcrire && (
        /* ⚠️ 32 px AU POINTEUR, 44 AU DOIGT. Ils faisaient 24 px en
           `text-muted-foreground/60` — sous le seuil de contraste ET sous toute
           cible tactile utilisable. */
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            title={clos ? "Rouvrir cet objectif" : "Marquer comme atteint"}
            aria-label={clos ? `Rouvrir « ${o.texte} »` : `Clore « ${o.texte} »`}
            onClick={() => corriger.mutate({ objectifId: o.id, clos: !clos })}
            className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-gold sm:h-8 sm:w-8"
          >
            {clos ? <RotateCcw className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          </button>
          {/* ⚠️ SUPPRIMER DEMANDE CONFIRMATION — règle du projet, sans exception.
              Et c'est le geste RARE : un objectif travaillé se CLÔT, il ne
              s'efface pas. Seul celui posé par erreur n'a pas d'histoire à
              garder. */}
          <button
            type="button"
            title={t('training.supprimerCetObjectif')}
            aria-label={`Supprimer « ${o.texte} »`}
            onClick={async () => {
              if (await confirm({ title: `Supprimer l'objectif « ${o.texte} » ?` })) {
                supprimer.mutate(o.id);
              }
            }}
            className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive sm:h-8 sm:w-8"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    </li>
  );
}
