import { useEffect, useMemo, useState } from "react";
import { Eye, Pencil } from "lucide-react";
import type { OneRepMax } from "@/api/types";
import { MOVEMENT_LABELS, MOVEMENT_SHORT, MOVEMENT_TO_ORM, PLACE_DISPUTEE,
         PRINCIPAL_MOVEMENTS, SOCLE_SBD, SOCLE_STREET,
         type PrincipalMovement } from "@/lib/constants";
import { useLocalStorageState } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface Props {
  oneRM: OneRepMax;
  /** Coach : édite le 1RM d'un mouvement (clé OneRepMax) → persistance. */
  onUpdateOneRM?: (key: keyof OneRepMax, value: number) => void;
  /** L'athlète regardé — la sélection du TOTAL est mémorisée par athlète
   *  (FRE-126). Absent : la sélection ne survit pas, ce qui vaut mieux que de la
   *  ranger sous une clé partagée. */
  athleteId?: string | null;
}

/** Cellule 1RM éditable (commit au blur). */
function OneRMCell({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value || ""));
  useEffect(() => { setDraft(String(value || "")); }, [value]);
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { const n = parseFloat(draft.replace(",", ".")); if (!Number.isNaN(n) && n !== value) onCommit(n); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="h-6 w-12 rounded-md border border-gold/40 bg-background text-center font-mono text-xs font-semibold text-gold outline-none focus:border-gold"
    />
  );
}

const PCTS = [100, 95, 90, 85, 80, 75, 70, 65, 60, 55];

// ⚠️ DES CONSTANTES DE MODULE, PAS DES LITTÉRAUX EN LIGNE. `useLocalStorageState`
// relit le stockage quand `key`, `initial` ou `validate` changent : un tableau ou
// une fonction recréés à chaque rendu relanceraient l'effet en boucle.
const TOUS: PrincipalMovement[] = [...PRINCIPAL_MOVEMENTS];

/** ⚠️ REJETTE UNE SÉLECTION PÉRIMÉE, et il y a deux façons de l'être : un
 *  mouvement qui n'existe plus (la liste des principaux a bougé), ou une
 *  sélection VIDE — que l'interface interdit déjà, mais qu'un stockage bricolé à
 *  la main pourrait porter. Un total à zéro n'est pas une préférence. */
function selectionValide(v: unknown): v is PrincipalMovement[] {
  return Array.isArray(v) && v.length > 0
    && v.every(m => (PRINCIPAL_MOVEMENTS as readonly string[]).includes(m));
}

function round05(n: number) {
  return Math.round(n * 2) / 2;
}

export function RmPercentageTable({ oneRM, onUpdateOneRM, athleteId }: Props) {
  const { t } = useTranslation();
  const [editMode, setEditMode] = useState(false);
  const canEdit = !!onUpdateOneRM;
  /* ⚠️ LE TROPHÉE A SAUTÉ, et ce n'était pas un ornement mais une information
     fausse. `maxKey` désignait le plus gros 1RM EN VALEUR ABSOLUE — donc le
     squat, pour tout le monde, toujours. Comparer un squat à un muscle-up
     n'apprend rien : ce sont deux mouvements, pas deux performances. */

  /* Les mouvements qu'on ne peut pas calculer, nommés une fois pour toutes :
     la colonne est en tirets, et le rappel sous le tableau dit lesquels. */
  const sansOneRM = PRINCIPAL_MOVEMENTS.filter(m => !(oneRM[MOVEMENT_TO_ORM[m]] ?? 0));

  // LE TOTAL : la somme des mouvements retenus, et cette sélection SURVIT
  // (FRE-126). Elle vivait dans un `useState` : le coach qui retirait le
  // chin-up de son total le recliquait à chaque changement d'onglet, d'athlète
  // ou de rechargement.
  //
  // ⚠️ PAR ATHLÈTE, PAS GLOBALEMENT. « Je ne compte pas le chin-up » est une
  // décision qui porte sur UN athlète, pas sur la façon de lire l'application.
  // Une clé partagée ferait basculer le total de tout le monde d'un seul clic,
  // sans que rien ne le dise.
  //
  // ⚠️ UN TABLEAU EN STOCKAGE, UN `Set` À L'USAGE : `JSON.stringify` d'un `Set`
  // rend `{}`. La sélection serait relue vide à chaque fois, donc perdue — en
  // silence, puisque le repli est « tout sélectionné » et qu'il a l'air normal.
  const [retenus, setRetenus] = useLocalStorageState<PrincipalMovement[]>(
    `eitri-rm-selection:${athleteId ?? "none"}`, TOUS, selectionValide,
  );
  const selected = useMemo(() => new Set(retenus), [retenus]);
  const toggle = (m: PrincipalMovement) => {
    setRetenus((liste) => {
      const n = new Set(liste);
      if (n.has(m)) n.delete(m); else n.add(m);
      // Tout décocher ne veut rien dire : le dernier mouvement reste.
      if (n.size === 0) n.add(m);
      return PRINCIPAL_MOVEMENTS.filter(x => n.has(x));
    });
  };
  const total = Array.from(selected).reduce((t, m) => t + (oneRM[MOVEMENT_TO_ORM[m]] ?? 0), 0);

  /** LES TOTAUX NOMMÉS (FRE-147) — deux de street, un de SBD.
   *
   *  ⚠️ ILS NE SONT PAS UNE SÉLECTION, et c'est ce qui les distingue du total
   *  libre juste en dessous. Le total libre répond à « qu'est-ce que je veux
   *  compter pour CET athlète » ; ceux-ci répondent à « que vaut son total de
   *  street », question dont la réponse ne se règle pas par des bascules.
   *
   *  ⚠️ UN 1RM MANQUANT NE VAUT PAS ZÉRO. Le chin up n'est renseigné que sur 11
   *  athlètes sur 70, et le bench et le deadlift sur AUCUN — ils viennent
   *  d'apparaître. Afficher `MU + DIPS + SQUAT + 0` donnerait un nombre qui se
   *  lit comme un total et n'en est pas un. On dit ce qui manque.
   *
   *  ⚠️ LES PLACES SONT PASSÉES, PAS DÉDUITES. Cette fonction recevait le seul
   *  mouvement disputé et complétait avec « tous les autres » : ajouter le bench
   *  et le deadlift aux mouvements principaux les aurait glissés dans le total
   *  de street sans un mot. */
  const totalDe = (places: readonly PrincipalMovement[]) => ({
    valeur: places.reduce((t, m) => t + (oneRM[MOVEMENT_TO_ORM[m]] ?? 0), 0),
    manquants: places.filter(m => !(oneRM[MOVEMENT_TO_ORM[m]] ?? 0)),
  });

  const totauxStreet = PLACE_DISPUTEE.map((dispute) => ({
    cle: dispute as string,
    libelle: t(dispute === "PULL UP" ? "charts.streetAvecPullUp" : "charts.streetAvecChinUp"),
    ...totalDe([...SOCLE_STREET, dispute]),
  }));
  /** ⚠️ LE PLUS GRAND FAIT FOI, ET SEULEMENT S'IL EST COMPLET. C'est la règle du
   *  barème (`max(PU, CU)`), mais un total amputé ne peut pas gagner : il serait
   *  déclaré officiel en étant faux.
   *
   *  ⚠️ ET SEULEMENT ENTRE LES DEUX TOTAUX DE STREET. Le SBD n'est pas un
   *  concurrent : c'est une autre question, pas une autre réponse à la même.
   *  Les mettre en compétition désignerait « officiel » le plus gros des deux
   *  disciplines, ce qui ne veut rien dire. */
  const officiel = totauxStreet
    .filter(t => t.manquants.length === 0)
    .reduce<typeof totauxStreet[number] | null>((a, b) => (a && a.valeur >= b.valeur ? a : b), null);

  const cartes = [
    ...totauxStreet,
    { cle: "SBD", libelle: t("charts.totalSbd"), ...totalDe(SOCLE_SBD) },
  ];

  /** Ce que chaque total ADDITIONNE, dérivé des mêmes constantes que la somme :
   *  recopier la liste à la main la ferait mentir au premier changement de
   *  socle — c'est exactement ce que `PLACE_DISPUTEE` avait déjà évité. */
  const abrege = (places: readonly PrincipalMovement[]) =>
    places.map(m => MOVEMENT_SHORT[m]).join(' + ');
  const composition: Record<string, string> = {
    ...Object.fromEntries(PLACE_DISPUTEE.map(d => [d as string, abrege([...SOCLE_STREET, d])])),
    SBD: abrege(SOCLE_SBD),
  };

  return (
    <section className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-[0_16px_42px_rgba(0,0,0,0.16)]">
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
        {/* ⚠️ UN TITRE, PAS UNE LIGNE DE TEXTE AVEC UN EMOJI DEVANT. « 📊 Table
            RM » en 14 px semi-gras pesait autant que n'importe quel libellé de la
            page ; c'est l'en-tête d'un tableau de sept colonnes. Barlow Condensed
            capitales, comme les titres de semaine et les mouvements — et l'emoji
            saute, il ne se traduit pas et ne se met pas à l'échelle. */}
        <h3 className="flex flex-wrap items-baseline gap-x-2.5 font-display text-[19px] font-bold uppercase tracking-[0.01em] text-gold">
          {t('charts.tableRm')}
          <span className="font-mono text-[10px] font-normal uppercase tracking-[0.16em] text-muted-foreground">
            {t('charts.pourcentDu1rm')} · kg
          </span>
        </h3>
        <div className="flex items-center gap-2">
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditMode((value) => !value)}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
                editMode
                  ? "bg-gold/15 text-gold hover:bg-gold/20"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {editMode ? (
                <>
                  <Eye className="h-3 w-3" /> {t("goals.preview")}
                </>
              ) : (
                <>
                  <Pencil className="h-3 w-3" /> {t("goals.edit")}
                </>
              )}
            </button>
          )}
        </div>
      </header>
      <div className="grid lg:grid-cols-[1fr_220px]">
        <div className="overflow-x-auto">
          <table className="w-full font-mono text-xs tabular-nums">
            <thead>
              {/* Mono espacé : ce sont des étiquettes de grille, pas de la prose. */}
              <tr className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <th className="px-3 py-2 text-left font-normal">RM</th>
                {PRINCIPAL_MOVEMENTS.map((m) => (
                  <th key={m} className="px-3 py-2 text-center font-normal">
                    {MOVEMENT_LABELS[m]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PCTS.map((p) => {
                const isMax = p === 100;
                return (
                  <tr key={p} className={cn("border-t border-border/40 transition-colors hover:bg-accent/15",
                                            // La ligne des 1RM porte la donnée SAISIE ; les autres en
                                            // sont déduites. Elle se détache franchement.
                                            isMax && "bg-gold/10")}>
                    <td className={cn("px-3 py-1.5 text-left", isMax ? "font-bold text-foreground" : "text-muted-foreground")}>
                      {isMax ? "1RM" : `${p} %`}
                    </td>
                    {PRINCIPAL_MOVEMENTS.map((m) => {
                      const orm = oneRM[MOVEMENT_TO_ORM[m]] ?? 0;
                      return (
                        <td
                          key={m}
                          className={cn("px-3 py-1.5 text-center", isMax && "text-[13px] font-bold text-gold")}
                        >
                          {isMax && canEdit && editMode ? (
                            <OneRMCell value={orm} onCommit={(n) => onUpdateOneRM?.(MOVEMENT_TO_ORM[m], n)} />
                          ) : orm > 0 ? (
                            round05((orm * p) / 100)
                          ) : (
                            /* ⚠️ LA RÈGLE ÉTAIT DÉJÀ ÉCRITE DANS CE FICHIER, ET
                               N'AVAIT PAS VOYAGÉ JUSQU'ICI. Le commentaire de
                               `totalDe` dit « UN 1RM MANQUANT NE VAUT PAS ZÉRO […]
                               on dit ce qui manque » — et le panneau de droite
                               l'applique. Cette cellule, elle, écrivait `0` : dix
                               fois par colonne vide, à l'endroit le plus regardé
                               de l'écran, juste à côté du panneau qui disait le
                               contraire. Un tiret ne se lit pas comme une charge.

                               Au passage `text-muted-foreground/40` disparaît :
                               une opacité ne signale pas un état (règle établie
                               sur quatre écrans, cf. `docs/design.md`). */
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* ⚠️ UNE COLONNE VIDE DOIT DIRE QUOI FAIRE, pas seulement qu'elle est
              vide. Les tirets disent « on ne sait pas » ; cette ligne dit de qui
              il s'agit et mène au seul endroit qui répare — le mode Modifier, que
              rien ne désignait depuis le tableau. */}
          {sansOneRM.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/40 px-3 py-2 text-[11px] text-muted-foreground">
              <span>
                {sansOneRM.map(m => MOVEMENT_LABELS[m]).join(' · ')} : {t('charts.rmARenseigner')}
              </span>
              {canEdit && !editMode && (
                <button
                  type="button"
                  onClick={() => setEditMode(true)}
                  className="ml-auto flex h-8 items-center gap-1 rounded-md px-2 font-mono text-[10px] uppercase tracking-wider text-gold transition-colors hover:bg-gold/10"
                >
                  {t('goals.edit')} <Pencil className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-2.5 border-t border-border/60 bg-gold/5 px-4 py-4 lg:border-l lg:border-t-0">
          {/* ⚠️ LES TOTAUX NOMMÉS D'ABORD, le total libre ensuite. L'ordre dit
              lequel est une LECTURE du produit et lequel est un outil du coach :
              le premier ne se règle pas, le second si. */}
          <div className="flex w-full flex-col gap-2">
            {cartes.map(({ cle, libelle, valeur, manquants }) => {
              const complet = manquants.length === 0;
              const faitFoi = officiel?.cle === cle;
              return (
                <div
                  key={cle}
                  className={cn(
                    "rounded-lg border px-3 py-2",
                    faitFoi ? "border-gold/50 bg-gold/10" : "border-border/60",
                  )}
                >
                  <div className="flex items-start justify-between gap-1.5">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {libelle}
                    </span>
                    {faitFoi && (
                      <span className="shrink-0 rounded bg-gold px-1 font-mono text-[9px] font-bold uppercase tracking-wider text-gold-foreground">
                        {t("charts.officiel")}
                      </span>
                    )}
                  </div>
                  {complet ? (
                    <>
                      <p className="mt-0.5 font-display text-2xl font-bold tabular-nums text-gold">
                        {valeur}
                        <span className="ml-1 text-[10px] font-normal uppercase tracking-wider text-muted-foreground">kg</span>
                      </p>
                      {/* ⚠️ UN TOTAL DIT CE QU'IL ADDITIONNE. « Avec pull-up » et
                          « avec chin-up » ne nomment que ce qui les DISTINGUE ;
                          sans la composition, on ne sait pas ce qu'il y a dans
                          les trois autres places — ni pourquoi le SBD n'a rien à
                          voir avec eux. */}
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {composition[cle]}
                      </p>
                    </>
                  ) : (
                    <p
                      className="mt-1 text-[11px] italic leading-snug text-muted-foreground"
                      title={t("charts.totalIncompletAide", {
                        mouvements: manquants.map(m => MOVEMENT_LABELS[m]).join(", "),
                      })}
                    >
                      {t("charts.totalIncomplet")} · {manquants.map(m => MOVEMENT_SHORT[m]).join(" ")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* ⚠️ LE TOTAL LIBRE EST UN OUTIL, ET RIEN NE LE DISAIT. Il affichait le
              même nombre que « Street · avec pull-up » juste au-dessus, sans
              cadre ni explication : deux fois 337,5 à l'écran, dont un qui se
              lisait comme une seconde vérité. Et les bascules qui le composent
              vivaient EN HAUT du panneau, sans libellé — on ne pouvait pas
              deviner qu'elles réglaient ce nombre-là.

              Elles sont donc dedans, sous leur titre. Le nombre ne change plus
              tout seul : on voit ce qu'on additionne. */}
          <div className="rounded-lg border border-dashed border-border/70 px-3 py-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {t('charts.totalLibre')}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {PRINCIPAL_MOVEMENTS.map((m) => {
                const on = selected.has(m);
                /* ⚠️ UN MOUVEMENT SANS 1RM NE S'AJOUTE À RIEN : le cocher
                   n'ajouterait aucun kilo. Il se dessine donc en TIRETS — le
                   vocabulaire du produit pour « pas encore » — plutôt que comme
                   une option ordinaire qui ne ferait rien. */
                const sansValeur = !(oneRM[MOVEMENT_TO_ORM[m]] ?? 0);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggle(m)}
                    // ⚠️ L'ÉTAT SE DIT, il ne se déduit pas d'une couleur. Ces
                    // boutons ne portaient que leur fond doré : ni un lecteur
                    // d'écran ni une spec ne pouvaient savoir si le mouvement
                    // comptait dans le total.
                    aria-pressed={on}
                    aria-label={t(on ? "charts.mouvementComptePourTotal" : "charts.mouvementRetireDuTotal",
                                  { mouvement: MOVEMENT_LABELS[m] })}
                    className={cn(
                      "rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider transition-colors",
                      on && !sansValeur && "bg-gold text-gold-foreground",
                      on && sansValeur && "border border-dashed border-gold/50 text-gold",
                      !on && !sansValeur && "border border-border bg-background/60 text-muted-foreground hover:text-foreground",
                      !on && sansValeur && "border border-dashed border-border text-muted-foreground",
                    )}
                  >
                    {MOVEMENT_SHORT[m]}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 font-display text-2xl font-bold tabular-nums">
              {total}
              <span className="ml-1 text-[10px] font-normal uppercase tracking-wider text-muted-foreground">kg</span>
            </p>
            <p className="text-[10px] leading-snug text-muted-foreground">{t('charts.totalLibreAide')}</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
