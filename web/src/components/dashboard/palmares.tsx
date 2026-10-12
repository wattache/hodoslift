import { useTranslation } from "react-i18next";

import type { Palmares as PalmaresDoc } from "@/api/types";
import { MOVEMENT_LABELS, PRINCIPAL_MOVEMENTS, type PrincipalMovement } from "@/lib/constants";
import { parseISODate } from "@/lib/dates-ui";

/** LE PALMARÈS — ses meilleurs singles, puis ses compétitions (calcul : brokkr).
 *
 *  Le chiffre est le héros : la charge en grand, d'où elle vient en petit. Une
 *  seule couleur d'accent, l'or, sur les charges ; pas de carte dans la carte. */
export function Palmares({ palmares }: { palmares: PalmaresDoc }) {
  const { t, i18n } = useTranslation();
  const date = (iso: string | null) => iso
    ? new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "short", year: "numeric" }).format(parseISODate(iso))
    : null;
  const ordre = (m: string) => PRINCIPAL_MOVEMENTS.indexOf(m as PrincipalMovement);
  const records = [...palmares.records].sort((a, b) => ordre(a.mouvement) - ordre(b.mouvement));
  const vide = records.length === 0 && palmares.competitions.length === 0;

  return (
    <section aria-labelledby="titre-palmares" className="rounded-xl border border-border/80 bg-card px-4 py-4 sm:px-5">
      <h3 id="titre-palmares" className="font-display text-[19px] font-bold uppercase tracking-[0.01em] text-gold">
        {t("palmares.titre")}
      </h3>
      {vide && <p className="mt-2 text-sm text-muted-foreground">{t("palmares.vide")}</p>}

      {records.length > 0 && (
        <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          {records.map(r => (
            <li key={r.mouvement} className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {MOVEMENT_LABELS[r.mouvement as PrincipalMovement] ?? r.mouvement}
              </p>
              <p className="mt-1 font-mono tabular-nums leading-none">
                <span className="text-[30px] font-bold text-gold">{r.charge}</span>
                <span className="ml-1 text-xs text-muted-foreground">kg</span>
              </p>
              <p className="mt-1.5 truncate text-[11px] text-muted-foreground" title={r.contexte ?? undefined}>
                {r.source === "competition" ? r.contexte : t(`palmares.source.${r.source}`)}
                {date(r.date) && <> · {date(r.date)}</>}
              </p>
            </li>
          ))}
        </ul>
      )}

      {palmares.competitions.length > 0 && (
        <ol className="mt-5 divide-y divide-border/50 border-t border-border/50">
          {palmares.competitions.map(c => (
            <li key={c.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 py-2.5">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{c.nom}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{date(c.date)}</span>
              <span className="w-full font-mono text-xs tabular-nums text-muted-foreground sm:w-auto">
                <span className="text-foreground">{c.total} kg</span>
                {c.ris != null && <> · RIS {c.ris.toFixed(2)}</>}
                {c.place != null && <> · {t("palmares.place", { place: c.place, sur: c.classes })}</>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
