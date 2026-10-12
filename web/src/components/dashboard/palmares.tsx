import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import type { Palmares as PalmaresDoc } from "@/api/types";
import { MOVEMENT_LABELS, PRINCIPAL_MOVEMENTS, type PrincipalMovement } from "@/lib/constants";
import { parseISODate } from "@/lib/dates-ui";
import { useLocalStorageState } from "@/lib/storage";
import { cn } from "@/lib/utils";

const MEDAILLE: Record<number, { emoji: string; ton: string }> = {
  1: { emoji: "🥇", ton: "border-gold/50 bg-gold/10 text-gold" },
  2: { emoji: "🥈", ton: "border-slate-400/40 bg-slate-400/10 text-foreground" },
  3: { emoji: "🥉", ton: "border-orange-700/50 bg-orange-700/10 text-orange-300" },
};

/** PALMARÈS & RECORDS — ses meilleurs singles, son total aux quatre places, et
 *  ses compétitions, repliables et cliquables (calcul : brokkr). */
export function Palmares({ palmares }: { palmares: PalmaresDoc }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [historiqueOuvert, setHistoriqueOuvert] = useLocalStorageState<boolean>("eitri-palmares-historique", false);
  const date = (iso: string | null, jour = true) => iso
    ? new Intl.DateTimeFormat(i18n.language, jour ? { day: "numeric", month: "short", year: "numeric" } : { month: "short", year: "numeric" })
        .format(parseISODate(iso))
    : null;
  const ordre = (m: string) => PRINCIPAL_MOVEMENTS.indexOf(m as PrincipalMovement);
  const records = [...palmares.records].sort((a, b) => ordre(a.mouvement) - ordre(b.mouvement));
  const { competitions } = palmares;

  return (
    <section aria-labelledby="titre-palmares" className="overflow-hidden rounded-xl border border-border/80 bg-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-4 py-4 sm:px-5">
        <div className="flex items-stretch gap-3">
          <span aria-hidden className="w-1.5 rounded-sm bg-gold" />
          <h3 id="titre-palmares" className="font-display text-[22px] font-bold uppercase leading-none tracking-[0.01em] text-foreground">
            {t("palmares.titre")} <span className="text-gold">&amp; {t("palmares.records")}</span>
          </h3>
        </div>
        <div className="flex flex-wrap gap-2 font-mono text-[11px] uppercase tracking-wider">
          {palmares.genre && palmares.categorie && (
            <span className="rounded-md border border-border bg-muted/40 px-2.5 py-1 text-muted-foreground">
              {t(`palmares.genre.${palmares.genre}`)} · {palmares.categorie} kg
            </span>
          )}
          {palmares.total != null && (
            <span className="rounded-md border border-gold/50 bg-gold/10 px-2.5 py-1 text-gold">
              {t("palmares.total")} {palmares.total} kg
            </span>
          )}
        </div>
      </header>

      <div className="px-4 py-4 sm:px-5">
        <h4 className="font-display text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {t("palmares.meilleursSingles")}
        </h4>
        {records.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("palmares.vide")}</p>
        ) : (
          <ul className="mt-3 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {records.map(r => (
              <li key={r.mouvement} className="min-w-0 rounded-lg border border-border/70 bg-background/40 px-3.5 py-3">
                <p className="font-display text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {MOVEMENT_LABELS[r.mouvement as PrincipalMovement] ?? r.mouvement}
                </p>
                <p className="mt-1.5 font-mono tabular-nums leading-none">
                  <span className="text-[30px] font-bold text-foreground">{r.charge}</span>
                  <span className="ml-0.5 text-xs text-gold">kg</span>
                </p>
                <p className="mt-2.5 truncate border-t border-border/50 pt-2 text-[11px] text-muted-foreground" title={r.contexte ?? undefined}>
                  {r.source === "competition" ? r.contexte : t(`palmares.source.${r.source}`)}
                  {date(r.date, false) && <> · {date(r.date, false)}</>}
                </p>
              </li>
            ))}
          </ul>
        )}

        {palmares.total != null && (
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/40 px-3.5 py-2.5">
            <span className="flex items-center gap-2 font-display text-[13px] font-semibold uppercase tracking-[0.06em] text-foreground">
              <span aria-hidden className="h-2 w-2 rounded-full bg-success" />
              {t("palmares.indice")}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              {t("palmares.total")} : <span className="text-sm font-bold text-foreground">{palmares.total} kg</span>
              {palmares.ris != null && (
                <> <span aria-hidden className="mx-2 text-border">|</span> RIS : <span className="text-sm font-bold text-gold">{palmares.ris.toFixed(2)}</span></>
              )}
            </span>
          </div>
        )}
      </div>

      {competitions.length > 0 && (
        <div className="border-t border-border/60">
          <button type="button" aria-expanded={historiqueOuvert} onClick={() => setHistoriqueOuvert(o => !o)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-accent/10 sm:px-5">
            <span className="font-display text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {t("palmares.historique")}
            </span>
            <span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
              {t("palmares.nCompetitions", { count: competitions.length })}
              <ChevronDown className={cn("h-4 w-4 transition-transform", historiqueOuvert && "rotate-180")} />
            </span>
          </button>
          {historiqueOuvert && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-border/50 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    <th className="px-4 py-2 text-left font-normal sm:px-5">{t("palmares.competition")}</th>
                    <th className="hidden px-3 py-2 text-right font-normal sm:table-cell">{t("palmares.date")}</th>
                    <th className="px-3 py-2 text-right font-normal">{t("palmares.total")}</th>
                    <th className="px-3 py-2 text-right font-normal">RIS</th>
                    <th className="px-4 py-2 text-right font-normal sm:px-5">{t("palmares.resultat")}</th>
                  </tr>
                </thead>
                <tbody>
                  {competitions.map(c => {
                    const medaille = c.place != null ? MEDAILLE[c.place] : undefined;
                    return (
                      <tr key={c.id} onClick={() => void navigate(`/competitions/${c.id}`)}
                          className="cursor-pointer border-b border-border/40 last:border-b-0 hover:bg-accent/15">
                        <td className="px-4 py-3 sm:px-5">
                          <a href={`/competitions/${c.id}`} onClick={e => { e.preventDefault(); void navigate(`/competitions/${c.id}`); }}
                             className="font-medium text-foreground hover:underline">{c.nom}</a>
                          <span className="block font-mono text-[11px] text-muted-foreground sm:hidden">{date(c.date)}</span>
                        </td>
                        <td className="hidden px-3 py-3 text-right font-mono text-[11px] text-muted-foreground sm:table-cell">{date(c.date)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums">
                          <span className="font-semibold text-foreground">{c.total}</span> <span className="text-[11px] text-muted-foreground">kg</span>
                        </td>
                        <td className={cn("px-3 py-3 text-right font-mono tabular-nums", c.place === 1 ? "text-gold" : "text-muted-foreground")}>
                          {c.ris != null ? c.ris.toFixed(2) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right sm:px-5">
                          {c.place != null ? (
                            <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 font-mono text-[11px]",
                                                medaille?.ton ?? "border-border text-muted-foreground")}>
                              {medaille && <span aria-hidden>{medaille.emoji}</span>}
                              {t(c.place === 1 ? "palmares.placePremier" : "palmares.place", { place: c.place, sur: c.classes })}
                            </span>
                          ) : <span className="font-mono text-[11px] text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
