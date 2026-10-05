import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MacrocycleEditing, WeekEditing } from "@/api/types";
import { cn } from "@/lib/utils";
import { formatLong } from "@/lib/dates-ui";
import { formatAverageRPE, rpeDotColor, weekAverageRPE } from "@/lib/rpe";
import { formatKg, sessionTonnage } from "@/lib/tonnage";
import { blocAMontrer } from "@/lib/program-selection";
import { DatePicker } from "@/components/ui/date-picker";
import i18n from "@/i18n";

/** L'EN-TÊTE DU PROGRAMME — la navigation EST l'en-tête de la semaine (1b, 13/09).
 *
 *  ⚠️ QUATRE BANDEAUX EN 190 PX, C'ÉTAIT LE DÉFAUT. Le haut de la vue empilait les
 *  objectifs techniques, cette barre (avec ses propres `border-y`), les objectifs
 *  du bloc, puis l'en-tête de `WeekView` — le sujet de la page, arrivé QUATRIÈME.
 *  Les deux cartes d'objectifs, dessinées pareil, encadraient la navigation et se
 *  lisaient comme un doublon ; la navigation, bordée, concourait avec elles au
 *  lieu de se subordonner au document qu'elle désigne.
 *
 *  Le geste : macro + bloc + semaine + en-tête de semaine dans UNE carte, fermée
 *  par le filet doré — « ici s'arrête le chrome, en dessous commence la séance ».
 *  Les objectifs passent dessous, regroupés (`training.tsx`). Deux objets au lieu
 *  de quatre. Le prix : ~250 px, l'objet le plus lourd de l'écran — un seul objet
 *  à lire, mais dense.
 *
 *  Ce qui suit est l'histoire de la BARRE, que cette carte absorbe ; les règles
 *  qu'elle a apprises tiennent toujours.
 *
 *  ── LA BARRE DU PROGRAMME — la navigation en UNE ligne, au-dessus de la semaine.
 *
 *  ⚠️ ELLE REMPLACE L'ARBRE EN RAIL, ET C'EST UNE QUESTION DE PLACE AUTANT QUE
 *  DE FORME. Le rail réservait une colonne de 275 px pour ~200 px de contenu :
 *  du vide sous l'arbre sur chaque écran, pendant que les lignes d'exercices —
 *  qui ont treize colonnes — se serraient à côté. Une barre coûte ~44 px de
 *  hauteur et rend toute la largeur à la séance.
 *
 *  ⚠️ TROIS CONTRÔLES, CHOISIS PAR LA FRÉQUENCE À LAQUELLE ON S'EN SERT — c'est
 *  ce qui décide de la forme de chacun, pas l'esthétique :
 *
 *    le MACRO    change quelques fois par an  → des onglets qui DÉFILENT
 *    le BLOC     change quelques fois par mois → des onglets, tous visibles
 *    la SEMAINE  change chaque semaine, voire → des pastilles, toujours là
 *                plusieurs fois par séance
 *
 *  ⚠️ PAS DE `<select>` POUR LE MACRO, ET C'EST UNE LEÇON. Le premier jet en
 *  utilisait un : le nom du macro n'y est alors PAS un nœud de texte visible
 *  (une `<option>` n'a pas de boîte de rendu), et deux specs qui vérifiaient
 *  qu'il s'affiche sont tombées. Ce qui ne se voit pas d'un test ne se voit pas
 *  non plus d'un lecteur d'écran qui parcourt la page. Des onglets partout,
 *  donc, et un défilement horizontal quand les années en auront empilé quinze.
 *
 *  ⚠️ LE RENDU NE SUIVAIT PAS CE RAISONNEMENT (refonte des écrans, 09/2026). Macro et bloc recevaient
 *  exactement le même traitement — 13 px, même `border-b-2 border-gold`, même
 *  position : deux rangées jumelles pour deux étages, et rien ne disait qu'on
 *  était dans « Macro 2 → Bloc 3 → semaine 4 ». La hiérarchie se recomposait de
 *  tête. Le poids visuel suit désormais la fréquence d'usage que ce fichier
 *  énonce depuis le début : macro discret, BLOC en gros, semaines à portée.
 *
 *  ⚠️ ET LA BARRE N'ENCODE PLUS QUE TROIS CHOSES, c'est la règle à tenir :
 *
 *    aplat doré  → ce qui est sélectionné (bloc ET semaine, le même signe)
 *    tirets      → une semaine qui n'a pas encore de séance
 *    barré rouge → une semaine mise de côté
 *    (mono)      → un nom fabriqué par le générateur, pas choisi par le coach
 *
 *  Tout le reste est neutre. Une quatrième convention de couleur appartiendrait
 *  à l'écran d'en dessous, pas ici.
 *
 *  ⚠️ LE POINT DE NATURE DU BLOC A ÉTÉ RETIRÉ, et ce n'est pas cosmétique : il
 *  était DEVINÉ du nom par `inferBlockKind`, qui retombe sur « accumulation »
 *  pour tout ce qu'elle ne reconnaît pas — « Montée » y passait pour de
 *  l'accumulation. Quatre teintes hors charte, sans légende nulle part, pour une
 *  périodisation que chaque coach nomme à sa façon : ça ne se lit pas comme un
 *  code, ça se lit comme une couleur arbitraire. `inferBlockKind` et les jetons
 *  `--block-*` restent en place pour leurs autres usages ; on ne les appelle
 *  simplement plus ici. Ne pas la faire revenir, ni en point, ni en mot, ni en
 *  infobulle — personne ne l'a demandée.
 */

interface Props {
  macros: MacrocycleEditing[];
  /** La semaine AFFICHÉE, dont la carte porte l'en-tête. Absente — éditeur de
   *  BASE ouvert, contenu hors ligne en pause — la carte n'est que navigation. */
  week?: WeekEditing;
  selectedMacroId?: string;
  selectedBlockId?: string;
  selectedWeekId?: string;
  onSelect: (macroId: string, blockId: string, weekId: string) => void;
  // Coach : voit les semaines masquées (barrées) + peut les masquer/afficher.
  // Athlète : elles sont filtrées.
  coachMode?: boolean;
  onToggleHidden?: (macroId: string, blockId: string, weekId: string) => void;
  /** Étire (ou raccourcit) la semaine affichée — coach seulement. Les semaines
   *  suivantes se décalent d'autant ; la durée de référence reste dans la BASE. */
  onChangerLaFinDeSemaine?: (fin: string) => void;
}

export function EnteteDuProgramme({ macros, week, selectedMacroId, selectedBlockId, selectedWeekId, onSelect, coachMode = false, onToggleHidden, onChangerLaFinDeSemaine }: Props) {
  const { t } = useTranslation();
  const macro = macros.find((m) => (m.id ?? "") === selectedMacroId) ?? macros[0];
  const mid = macro?.id ?? "";
  // ⚠️ UN BLOC SANS SEMAINE VISIBLE NE S'AFFICHE PAS À L'ATHLÈTE (FRE-158), et
  // pas non plus « vide » : c'est un bloc que le coach a voulu cacher, en
  // masquant sa seule semaine. Le serveur ne le sert déjà plus à un athlète ;
  // ceci ne concerne que l'APERÇU du coach, à qui il sert tout.
  const blocs = (macro?.blocks ?? []).filter(b => blocAMontrer(b, !coachMode));
  const bloc = blocs.find((b) => (b.id ?? "") === selectedBlockId) ?? blocs[0];
  const bid = bloc?.id ?? "";
  const semaines = (bloc?.weeks ?? []).filter((w) => coachMode || !w.hidden);
  const semaineActive = semaines.find((w) => (w.id ?? "") === selectedWeekId);

  // ⚠️ PLUS DE NOM À CÔTÉ DES PASTILLES : le titre de semaine, juste en dessous,
  // le porte en 36 px. Le répéter en 12 px dans la rangée le doublerait.

  if (macros.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-xl border border-border/80 bg-card">
      <nav>
      {/* LES MACROS — un bandeau DISCRET, et une rangée qui DÉFILE. Ils se
          comptent en dizaines au fil des années : les faire tenir de force
          finirait par les écraser, alors qu'un défilement horizontal garde
          chaque nom entier et met les plus récents sous la main.
          Le préfixe remplace ce que l'ancienne rangée ne disait pas : à
          traitement égal avec les blocs, on ne savait pas lequel des deux
          étages on regardait. */}
      <div className="flex items-center gap-1.5 overflow-x-auto bg-background/55 px-[18px] pb-2 pt-2.5">
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
              aria-hidden>
          {t('training.macro')}
        </span>
        {macros.map((m) => {
          const courant = (m.id ?? "") === mid;
          const premier = m.blocks[0];
          return (
            <button
              key={m.id ?? ""}
              type="button"
              onClick={() => onSelect(m.id ?? "", premier?.id ?? "", premier?.weeks[0]?.id ?? "")}
              aria-current={courant ? "true" : undefined}
              className={cn(
                // ⚠️ UN FOND, PAS UN FILET DORÉ. L'or est réservé à ce qu'on a
                // choisi DANS le macro courant — bloc et semaine. Le macro se
                // marque en neutre, parce qu'il est le contexte, pas la
                // sélection du jour.
                "shrink-0 rounded px-2 py-1 text-[12px] transition-colors",
                courant ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                // ⚠️ MONO PLUTÔT QU'ITALIQUE, ET AUX DEUX ÉTAGES (voir le bloc).
                // « Macro 1 » est une étiquette du générateur, pas un nom : la
                // distinction a de la valeur, mais l'italique la portait mal —
                // personne n'en décode la convention, et elle abîme la lisibilité
                // à cette taille. Le mono est déjà la voix des machines partout
                // dans ce produit (charges, RPE, dates, compteurs).
                !m.name && "font-mono",
              )}
            >
              {m.name || t('training.macroN', { n: m.macroNumber })}
            </button>
          );
        })}
      </div>

      {/* ⚠️ BLOCS ET SEMAINES SUR UNE LIGNE QUI S'ENROULE, PAS UNE GRILLE (1b, 13/09).
          Sous 640 px, `grid-cols-2` donnait à chaque bloc la moitié de la
          largeur : l'aplat du bloc courant devenait l'élément le plus fort de
          l'écran — de la navigation — et trois blocs faisaient un escalier avec
          une cellule vide. Des pastilles à largeur de leur nom qui s'enroulent
          règlent aussi le retour du 12/09 (« à partir de 3 ça commence à
          défiler ») : rien n'est caché, et la hauteur ne change que quand le
          coach AJOUTE un bloc, pas sous le doigt pendant qu'on navigue.
          `flex-wrap`, jamais `overflow-x`. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-3.5 py-2.5">
      {/* LES BLOCS — des onglets : peu nombreux, et on compare l'un à l'autre.
          C'est l'étage qui PORTE LE POIDS de la barre : le nom du bloc est ce
          qu'on lit pour savoir où l'on en est. Pas de <select> natif : une
          <option> n'a pas de boîte de rendu, ce qui ne se voit pas d'un test ne
          se voit pas d'un lecteur d'écran. */}
      {blocs.length > 0 && (
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1">
          {blocs.map((b) => {
            const courant = (b.id ?? "") === bid;
            return (
              <button
                key={b.id ?? ""}
                type="button"
                onClick={() => onSelect(mid, b.id ?? "", (b.id ?? "") === bid
                  ? (selectedWeekId ?? "")
                  : (b.weeks[0]?.id ?? ""))}
                aria-current={courant ? "true" : undefined}
                className={cn(
                  // ⚠️ SURBRILLANCE PLEINE, PAS UN FOND TEINTÉ. `bg-gold/12` a été
                  // essayé d'abord : trop discret, on ne repérait pas le bloc
                  // courant d'un coup d'œil. Le bloc et la semaine se disent donc
                  // EXACTEMENT pareil — aplat doré, texte sombre —, deux étages
                  // pour un seul signe, et rien ne se lit comme « presque
                  // sélectionné ».
                  //
                  // ⚠️ `border border-transparent` SUR LES INACTIFS : sans lui,
                  // ils perdent les 2 px de bordure de l'actif et la rangée
                  // sautille d'un clic à l'autre.
                  //
                  // `max-w-full` + le `truncate` du nom : un nom plus long que
                  // l'écran se coupe au lieu de pousser la carte hors de la page.
                  "flex h-11 min-w-0 max-w-full items-center rounded-md border border-transparent px-3 font-display text-[16px] uppercase leading-none tracking-[0.01em] transition-colors sm:h-[38px]",
                  courant
                    ? "bg-gold font-bold text-gold-foreground"
                    : "font-semibold text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {/* Le mono paraît plus gros à corps égal : il descend d'un cran. */}
                <span className={cn("block min-w-0 truncate", !b.name && "font-mono text-[13px] normal-case")}>
                  {b.name || t('training.blocN', { n: b.blockNumber })}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {blocs.length > 0 && semaines.length > 0 && (
        // Sous 640 px la semaine passe souvent à la ligne : un filet resterait
        // orphelin au bout des blocs. Il n'existe que là où la ligne tient.
        <span className="hidden h-[22px] w-px shrink-0 bg-border sm:block" aria-hidden />
      )}

      {/* LES SEMAINES — ce qu'on change le plus, donc toujours visible. Elles
          restent à DROITE (c'est une zone, pas une file d'attente) mais se
          rapprochent : le séparateur passe AVANT le préfixe, pas entre le
          préfixe et les pastilles. */}
      {semaines.length > 0 && (
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
                aria-hidden>
            {t('training.semaine')}
          </span>
          <div className="flex flex-wrap items-center gap-1">
            {semaines.map((w) => {
              const wid = w.id ?? "";
              const active = wid === selectedWeekId;
              const vide = (w.sessions ?? []).length === 0;
              return (
                <button
                  key={wid}
                  type="button"
                  onClick={() => onSelect(mid, bid, wid)}
                  // ⚠️ LE NOM ACCESSIBLE RESTE « Semaine 3 » alors que la
                  // pastille n'affiche que « 3 » : c'est ce que lit un lecteur
                  // d'écran, et ce par quoi les specs du harnais réel désignent
                  // une semaine.
                  aria-label={w.name?.trim() || t('week.semaineN', { n: w.weekNumber })}
                  aria-current={active ? "true" : undefined}
                  title={w.hidden ? t('week.semaineMasquee', { nom: w.name?.trim() || t('week.semaineN', { n: w.weekNumber }) }) : undefined}
                  className={cn(
                    // 44 px au doigt (le plancher de `plancher-du-doigt.spec`),
                    // 38 au pointeur, alignés sur les blocs de la même ligne
                    // (c'était 30, sous une rangée de blocs à 32).
                    "flex h-11 min-w-11 items-center justify-center rounded-md border border-transparent px-1.5 font-mono text-[14px] transition-colors sm:h-[38px] sm:min-w-[38px]",
                    active
                      ? "bg-gold font-semibold text-gold-foreground"
                      : "bg-muted text-foreground hover:bg-muted/70",
                    // ⚠️ QUATRIÈME OPACITÉ D'ÉTAT RETIRÉE DU PRODUIT, après la vue
                    // semaine, les objectifs de bloc et les objectifs techniques.
                    // Le vocabulaire est désormais stable : TIRETS = ce qui
                    // n'existe pas encore, BARRÉ = ce qui est mis de côté, OR =
                    // ce qui est choisi. L'opacité ne signale pas un état.
                    !active && vide && "border-dashed border-border bg-transparent text-muted-foreground",
                    // ⚠️ BARRÉ, ET LISIBLE. À `opacity-40` sur un chiffre de
                    // 12 px, le coach ne pouvait pas RELIRE une semaine masquée
                    // pour décider de la rouvrir — c'est pourtant le seul geste
                    // qu'on vient faire ici.
                    w.hidden && !active && "bg-transparent text-muted-foreground line-through decoration-destructive decoration-2",
                    w.hidden && active && "line-through decoration-destructive decoration-2",
                  )}
                >
                  {w.weekNumber}
                </button>
              );
            })}
          </div>

          {coachMode && onToggleHidden && semaineActive && (
            <button
              type="button"
              onClick={() => onToggleHidden(mid, bid, semaineActive.id ?? "")}
              title={semaineActive.hidden ? i18n.t("misc.showWeek") : i18n.t("misc.hideWeek")}
              aria-label={semaineActive.hidden ? i18n.t("misc.showWeek") : i18n.t("misc.hideWeek")}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-gold/70 transition-colors hover:bg-gold/10 hover:text-gold"
            >
              {semaineActive.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      )}
      </div>
      </nav>

      {week && <EnteteDeSemaine week={week} coachMode={coachMode} onChangerLaFin={onChangerLaFinDeSemaine} />}

      {/* LE FILET DORÉ FERME LA CARTE. Il était le `border-b-2 border-gold` de
          l'en-tête de `WeekView` ; il vaut maintenant pour toute la carte — ici
          s'arrête le chrome, en dessous commence la séance. */}
      <div className="h-0.5 bg-gold" aria-hidden />
    </section>
  );
}

/** L'EN-TÊTE DE LA SEMAINE — déplacé de `WeekView` (1b, 13/09), dont il était
 *  le `<header>`. Le titre monte à 36 px dès le mobile : c'est le sujet de la
 *  page, et il arrivait quatrième.
 *
 *  ⚠️ LA SEMAINE EST UN TITRE DE PAGE, PAS UNE CARTE (règle héritée). Ses
 *  chiffres ont été servis en gélules, chacune avec son icône, comme si les trois
 *  n'avaient rien à voir entre eux. Ce sont les métadonnées d'un document : elles
 *  se posent en ligne sous son titre, pas en badges autour. Les libellés disent
 *  déjà « séances », « tonnage », « RPE » ; des pictogrammes les décoreraient. */
function EnteteDeSemaine({ week, coachMode, onChangerLaFin }: {
  week: WeekEditing; coachMode: boolean; onChangerLaFin?: (fin: string) => void;
}) {
  const { t } = useTranslation();
  const totalTon = (week.sessions ?? []).reduce((total, s) => total + sessionTonnage(s), 0);
  const averageRPE = weekAverageRPE(week);
  const weekRPEColor = averageRPE === null ? undefined : rpeDotColor(String(averageRPE));
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 px-3.5 py-4">
      <div className="min-w-0">
        <h2 className="font-display text-[36px] font-bold uppercase leading-none tracking-[0.03em] sm:text-4xl">
          {week.name || t("week.semaineN", { n: week.weekNumber })}
        </h2>
        {week.startDate && week.endDate && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <span>{formatLong(week.startDate)} →</span>
            {/* ⚠️ LA FIN SEULE SE DÉPLACE, PAS LE DÉBUT (William, 20/09) : une
                semaine commence quand finit la précédente, et c'est ce qui
                garantit qu'un bloc n'a ni trou ni chevauchement. Ce qui se règle
                ici, c'est l'EXCEPTION — « S3 a besoin de 3 jours de plus » — et
                les semaines suivantes suivent. La durée de référence, elle,
                reste celle de la BASE. */}
            {/* Absent sur la semaine 1 : c'est l'appelant qui le sait (par l'index),
                et sa durée se règle dans la BASE. */}
            {coachMode && onChangerLaFin
              ? <DatePicker value={week.endDate} min={week.startDate} title={t("week.finDeLaSemaine")}
                            onChange={v => { if (v) onChangerLaFin(v); }} />
              : <span>{formatLong(week.endDate)}</span>}
          </div>
        )}
      </div>
      <div className="flex items-end gap-6 pb-[3px]">
        <div>
          <div className="font-display text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t("week.sessionsUnit")}
          </div>
          <div className="mt-1 font-mono text-[22px] leading-none">{(week.sessions ?? []).length}</div>
        </div>
        <div>
          <div className="font-display text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t("week.tonnageUnit")}
          </div>
          <div className="mt-1 font-mono text-[22px] font-medium leading-none text-gold">{formatKg(totalTon)}</div>
        </div>
        <div>
          <div className="font-display text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{t('base.rpe')}</div>
          <div className="mt-1 font-mono text-[22px] leading-none"
               style={weekRPEColor ? { color: weekRPEColor } : undefined}>
            {formatAverageRPE(averageRPE)}
          </div>
        </div>
      </div>
    </div>
  );
}
