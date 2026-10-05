import type { ExerciseEditing } from "@/api/types";
import i18n from "@/i18n";
import { parseSeconds, formatSeconds } from "@/lib/time";
import { tempsDuGroupe, type NatureDeGroupe } from "@/lib/groupe";
import { isFreeRest } from "./rest";

/** LE FORMATAGE D'UNE LIGNE D'EXERCICE — une seule fois (FRE-91).
 *
 *  ⚠️ CES FONCTIONS VIVAIENT EN DOUBLE, dans `session-table.tsx` (la table du
 *  coach) et `week-overview.tsx` (l'aperçu de l'athlète). Quatre d'entre elles
 *  étaient identiques ; deux avaient DIVERGÉ, et l'une se voyait à l'écran.
 *
 *  ⚠️ LE DÉFAUT QUE LA CONSOLIDATION CORRIGE — l'AMRAP. La table du coach passait
 *  par `formatTimeValue`, l'aperçu par `formatReps(…, "sec")`. Sur les 52 AMRAP
 *  de production (22 portent une durée : `300` dix-neuf fois, `60` trois fois),
 *  le coach lisait donc `300"` là où l'athlète lisait `5'`. Le même exercice,
 *  deux rendus, et personne pour le signaler puisque les deux écrans ne se
 *  regardent jamais côte à côte.
 *
 *  C'est la version RICHE qui l'emporte, ici comme pour `formatReps` : `5'` se
 *  lit, `300"` demande de compter. Conséquence assumée — la table du coach
 *  CHANGE d'affichage sur ces 22 lignes.
 */

/** Une durée saisie en secondes, telle quelle : `90` → `90"`. Une valeur déjà
 *  écrite (`1:30`, `x3`) est rendue intacte. */
export function formatTimeValue(value: string | null | undefined): string {
  if (!value) return "";
  if (/^\d+$/.test(value)) return `${value}"`;
  return value;
}

/** Les répétitions, avec le RÉALISÉ quand il diffère de la consigne.
 *
 *  ⚠️ `repsDone` EST OPTIONNEL, et c'est ce qui a permis de fusionner : la table
 *  du coach l'appelle à deux arguments et retrouve exactement son ancien
 *  comportement. La version courte était un sous-ensemble strict, pas une
 *  variante.
 *
 *  Le réel s'affiche dès qu'il DIFFÈRE — un « 3 → 2 » est l'information qu'on
 *  veut voir ; un « 3 → 3 » ne serait que du bruit. */
export function formatReps(reps: string | null | undefined, repsUnit: string | null | undefined, repsDone?: string | null): string {
  if (!reps) return "—";
  const value = repsUnit === "sec"
    ? (() => {
        const seconds = parseSeconds(reps);
        return seconds > 0 ? formatSeconds(seconds) : `${reps}"`;
      })()
    : reps;
  if (repsDone && repsDone.trim() && repsDone.trim() !== reps.trim()) {
    return `${value} → ${repsDone.trim()}`;
  }
  return value;
}

export function formatRest(rest: string | null | undefined): string {
  if (isFreeRest(rest)) return i18n.t("session.reposLibre");
  const seconds = parseSeconds(rest);
  if (seconds <= 0) return rest ?? '';
  return formatSeconds(seconds);
}

/** Le repos RÉELLEMENT pris, tel que l'athlète l'a noté. */
export function formatRestActual(restActual: string): string {
  const trimmed = restActual.trim();
  if (!trimmed) return "";
  return /^\d+$/.test(trimmed) ? `${trimmed}s` : trimmed;
}

/** Le repos prescrit, et le RÉEL quand il en diffère.
 *
 *  ⚠️ LA RÈGLE A CHANGÉ LE 31/08 (FRE-42), ET ELLE EST DEVENUE PLUS FINE PLUTÔT
 *  QUE PLUS LARGE. Elle disait : « le réel ne s'affiche que sur un repos LIBRE,
 *  parce que quand le repos est prescrit, la consigne est l'information ». Le
 *  raisonnement tenait sur l'affichage — mais il gouvernait AUSSI la saisie, et
 *  la case n'existait donc pas sur les 4 395 lignes à repos prescrit. Zéro réel
 *  y était enregistré, faute de pouvoir.
 *
 *  La consigne reste l'information tant qu'elle a été suivie. C'est l'ÉCART qui
 *  en est une autre : 3' prescrites et 5' prises expliquent une séance. On
 *  affiche donc le réel quand il DIFFÈRE — exactement ce que `formatReps` fait
 *  déjà pour les répétitions (`3 → 2`), et pour la même raison.
 *
 *  ⚠️ SUR UN REPOS LIBRE, le réel s'affiche toujours : il n'y a pas de consigne
 *  dont il pourrait différer, et c'est alors la SEULE information. */
export function formatRestWithActual(rest: string | null | undefined, restActual?: string | null): string {
  const prescribed = formatRest(rest);
  if (!prescribed) return "";
  const reel = restActual?.trim();
  if (!reel) return prescribed;
  if (isFreeRest(rest)) return `${prescribed} · ${i18n.t("session.reel")} ${formatRestActual(reel)}`;
  // Comparaison sur la valeur FORMATÉE : « 180 » et « 3' » sont le même repos,
  // et les opposer afficherait un écart qui n'existe pas.
  const reelFormate = formatRest(reel);
  return reelFormate === prescribed ? prescribed : `${prescribed} → ${reelFormate}`;
}

/** Ce qui se colle après le badge de format : la durée d'un AMRAP, l'intervalle
 *  et le total d'un EMOM, le motif et le repos d'un CLUSTER. */
export function formatBadgeSuffix(
  ex: Pick<ExerciseEditing, "format" | "clusterMode" | "sets"> & { clusterRest?: string | null },
): string {
  if (ex.format === "AMRAP") {
    return ex.clusterMode ? ` ${formatReps(ex.clusterMode, "sec")}` : "";
  }
  if (ex.format === "EMOM") {
    const intervalSec = parseSeconds(ex.clusterMode);
    const sets = parseInt(ex.sets ?? '', 10);
    const total = intervalSec && sets ? formatSeconds(intervalSec * sets) : "";
    const interval = formatTimeValue(ex.clusterMode);
    if (total && interval) return ` ${total} - ${interval}`;
    return interval || total ? ` ${interval || total}` : "";
  }
  if (ex.format === "CLUSTER") {
    const pattern = formatTimeValue(ex.clusterMode);
    const rest = formatTimeValue(ex.clusterRest ?? "");
    if (pattern && rest) return ` ${pattern} · ${rest}`;
    return pattern ? ` ${pattern}` : "";
  }
  return "";
}

/** « 1 série », « 3 séries », « 3-4 séries » — et « — séries » quand rien n'est
 *  prescrit (FRE-36).
 *
 *  ⚠️ VU SUR UN VRAI DROPSET : l'en-tête d'un groupe à une série annonçait
 *  « 1 séries ». Le défaut existait depuis FRE-31 sur les bi-sets, mais aucun
 *  n'était prescrit à une seule série — c'est le dropset qui l'a rendu visible,
 *  puisqu'il enchaîne ses descentes en UN tour.
 *
 *  ⚠️ ET `sets` EST DU TEXTE, pas un nombre : il porte des fourchettes (« 3-4 »)
 *  et des vides. Le singulier ne vaut donc QUE pour la chaîne « 1 » — tester
 *  `Number(sets) <= 1` mettrait « 3-4 » au singulier, `parseInt` rendant 3 mais
 *  `Number` rendant NaN. */
export function formatSeries(sets: string | null | undefined): string {
  const valeur = (sets || '').trim();
  return `${valeur || "—"} ${i18n.t(valeur === "1" ? "session.serie" : "session.series").toLocaleLowerCase()}`;
}

/** Les champs de l'en-tête d'un groupe, étiquetés (maquette 2a, FRE-116) :
 *  la valeur en mono, son libellé en petites capitales. « L'en-tête commande » —
 *  une phrase grise ne commandait rien. */
export function champsDuGroupe(
  nature: NatureDeGroupe, membres: number,
  ligne: Pick<ExerciseEditing, "sets" | "clusterMode" | "toursRealises">, repos: string,
): { valeur: string; libelle: string }[] {
  const sets = (ligne.sets || "").trim() || "—";
  const temps = tempsDuGroupe(nature, membres, ligne.sets, ligne.clusterMode);
  if (nature === "emom") {
    return [
      { valeur: sets, libelle: i18n.t("session.tours") },
      ...(temps ? [{ valeur: formatSeconds(temps.intervalle), libelle: i18n.t("session.parMouvementCourt") }] : []),
      ...(temps?.total ? [{ valeur: formatSeconds(temps.total), libelle: i18n.t("session.total") }] : []),
    ];
  }
  if (nature === "amrap") {
    return temps ? [{ valeur: formatSeconds(temps.intervalle), libelle: i18n.t("session.duree") }] : [];
  }
  const series = { valeur: sets, libelle: i18n.t("session.tours") };
  if (nature === "dropset") return [{ valeur: sets, libelle: i18n.t("session.series").toLocaleLowerCase() }];
  return repos ? [series, { valeur: repos, libelle: i18n.t("session.repos") }] : [series];
}

/** Le talon d'un groupe : ce qui se passe à la fin du tour, là où l'athlète
 *  regarde avant de repartir (maquette 2a). `""` quand il n'y a rien à dire. */
export function talonDuGroupe(
  nature: NatureDeGroupe, ligne: Pick<ExerciseEditing, "sets">, repos: string,
): string {
  const sets = (ligne.sets || "").trim();
  if (nature === "emom") return i18n.t("session.talonEmom", { n: sets || "—" });
  if (nature === "amrap" || nature === "dropset") return "";
  return [i18n.t("session.finDuTour"), repos ? `${i18n.t("session.repos")} ${repos}` : "", sets ? `×${sets}` : ""]
    .filter(Boolean).join(" · ");
}
