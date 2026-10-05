import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import type { TrackingSetsByMovement } from "@/api/types";
import { MOVEMENT_SHORT, type PrincipalMovement } from "@/lib/constants";
import { orderedPrincipaux } from "@/lib/principaux";
import { cn } from "@/lib/utils";

/* ============================================================
 * LES SÉRIES PAR SEMAINE, SUR LES LIFTS DE COMPÉTITION (FRE-148)
 *
 * ⚠️ LA QUESTION INVERSE DU GRAPHE AU-DESSUS. Celui-ci creuse UN mouvement sur
 * toutes ses métriques ; ce tableau compare TOUS les lifts sur une seule. C'est
 * la lecture d'un coach qui répartit un volume : « combien de séries de squat
 * cette semaine, contre le muscle up ? »
 *
 * ⚠️ DEUX NOMBRES PAR CELLULE, ET LE SECOND N'EST PAS UN ORNEMENT. `setsDone`
 * compte les séries TENUES (FRE-110) ; sans le prescrit en face, une semaine où
 * l'athlète n'est pas venu se lit exactement comme une semaine où le mouvement
 * n'était pas programmé — un zéro dans les deux cas. Le couple distingue :
 *
 *   0 / 0 → rien n'était prévu       (cellule vide, on n'affiche rien)
 *   0 / 7 → prévu, pas fait          (le signal le plus fort)
 *   6 / 7 → fait, une série calée
 *   7 / 7 → tenu                     (un seul chiffre, pas de bruit)
 *
 * C'est ce couple qui a rendu inutile une pastille « aucune séance » : séance ou
 * pas, ça fait des séries en moins, et l'écart le dit déjà.
 * ============================================================ */

/** ⚠️ LES DIX DERNIÈRES, PAS TOUT L'HISTORIQUE. Un athlète suivi depuis deux ans
 *  porte une centaine de semaines : la table deviendrait un mur, et la question
 *  qu'on lui pose — « où en est le volume EN CE MOMENT » — se lit sur un bloc,
 *  pas sur une carrière. Le graphe du dessus garde la vue longue. */
const SEMAINES_AFFICHEES = 10;

function fmtSemaine(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  // La langue vient d'i18n : un axe en français sous une interface anglaise
  // trahit ce que tout le reste traduit.
  return d.toLocaleDateString(i18n.language, { day: "2-digit", month: "short" });
}

export function SeriesParLift({ lignes }: { lignes: TrackingSetsByMovement[] }) {
  const { t } = useTranslation();

  const { semaines, mouvements, parCle } = useMemo(() => {
    const parCle = new Map(lignes.map(l => [`${l.week}|${l.movement}`, l]));
    const semaines = [...new Set(lignes.map(l => l.week))]
      .sort()
      .slice(-SEMAINES_AFFICHEES)
      .reverse();   // la plus récente en haut : c'est celle qu'on vient voir
    // ⚠️ L'ORDRE CANONIQUE, ET UN REPLI POUR LE RESTE. Le serveur borne aux
    // entrées `competition = true` de la bibliothèque, pas à une liste figée :
    // un lift ajouté demain arrive ici sans qu'on ait touché au code, et il ne
    // doit pas casser l'affichage faute d'abréviation connue.
    const mouvements = orderedPrincipaux([...new Set(lignes.map(l => l.movement))]);
    return { semaines, mouvements, parCle };
  }, [lignes]);

  if (semaines.length === 0) return null;

  const abrege = (m: string) =>
    MOVEMENT_SHORT[m as PrincipalMovement] ?? m;

  return (
    <section className="overflow-hidden rounded-xl border border-border/80 bg-card">
      <header className="flex items-baseline justify-between gap-2 border-b border-border/60 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-gold">{t("charts.seriesParSemaine")}</h3>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {t("charts.faitSurPrescrit")}
        </span>
      </header>

      {/* La table déborde DANS son cadre : sept lifts ne tiennent pas sur un
          téléphone, et faire glisser la page entière serait pire. */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">{t("charts.semaine")}</th>
              {mouvements.map(m => (
                <th key={m} className="px-3 py-2 text-center font-mono font-medium" title={m}>
                  {abrege(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {semaines.map(semaine => (
              <tr key={semaine} className="border-t border-border/40 hover:bg-accent/15">
                <td className="whitespace-nowrap px-3 py-1.5 text-left text-muted-foreground">
                  {fmtSemaine(semaine)}
                </td>
                {mouvements.map(m => {
                  const l = parCle.get(`${semaine}|${m}`);
                  // ⚠️ RIEN DE PRÉVU, RIEN D'AFFICHÉ. Un « 0 » ici se lirait
                  // comme un manquement, alors que le mouvement n'était pas au
                  // programme cette semaine-là.
                  if (!l || (l.setsDone === 0 && l.setsPlanned === 0)) {
                    return <td key={m} className="px-3 py-1.5 text-center text-muted-foreground/30">—</td>;
                  }
                  const manque = l.setsPlanned - l.setsDone;
                  return (
                    <td
                      key={m}
                      className={cn("px-3 py-1.5 text-center",
                        manque > 0 ? "text-amber-500" : "text-foreground")}
                      title={manque > 0
                        ? t("charts.seriesNonFaites", { count: manque, mouvement: m })
                        : t("charts.seriesTenues", { count: l.setsDone, mouvement: m })}
                    >
                      {manque > 0 ? (
                        <>
                          <span className="font-semibold">{l.setsDone}</span>
                          <span className="text-muted-foreground">/{l.setsPlanned}</span>
                        </>
                      ) : (
                        l.setsDone
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
