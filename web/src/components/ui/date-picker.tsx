"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { CalendarDays } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import i18n from "@/i18n";
import { todayIso } from "@/lib/dates";

const DatePickerPanel = React.lazy(() => import("@/components/ui/date-picker-panel"));

/**
 * Sélecteur de date aux couleurs de l'app, en remplacement de
 * `<input type="date">` — le calendrier natif est celui du système : hors
 * charte, et différent sur chaque navigateur.
 *
 * Remplaçant direct du natif : mêmes props `value` / `onChange` / `min` / `max`,
 * tout en ISO `YYYY-MM-DD`. `onChange` reçoit la chaîne ISO, pas un événement.
 *
 * La grille vient de `react-day-picker` (ce que shadcn utilise) plutôt que d'une
 * version maison : navigation au clavier dans le mois (flèches, Origine/Fin,
 * PagePrec/PageSuiv), rôles ARIA de grille, annonce du mois au lecteur d'écran
 * et locale française — tout ce qu'une grille de boutons faite à la main ne
 * couvre qu'à moitié. Ici on ne fournit que l'habillage.
 *
 * La grille elle-même est chargée À LA DEMANDE (`date-picker-panel`) : elle pèse
 * ~24 kB gzip, et la liste des objectifs du tableau de bord tire un DatePicker —
 * sans ce découpage, tout le monde payait le calendrier au premier chargement
 * alors qu'il ne sert qu'à l'ouverture d'un champ.
 *
 * FUSEAU : le composant parle ISO à l'extérieur et `Date` à l'intérieur. Les
 * conversions se font sur l'heure LOCALE À MIDI, pas à minuit UTC — un
 * `new Date('2026-10-10')` est interprété en UTC et retombe la veille dans les
 * fuseaux négatifs. Même vigilance que `utils/dates.ts`.
 */

/** ISO `YYYY-MM-DD` → Date locale à midi (jamais de bascule de jour). */
function isoToDate(value: string): Date | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d, 12);
}

/** Date locale → ISO `YYYY-MM-DD`, sur les composantes locales. */
function dateToIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** « 10 oct. 2026 » — libellé du bouton. */
function label(value: string): string {
  const date = isoToDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat(i18n.language || "fr", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export interface DatePickerProps {
  /** Date ISO `YYYY-MM-DD`, ou '' si non renseignée. */
  value: string;
  /** Reçoit la nouvelle date ISO (jamais un événement). */
  onChange: (value: string) => void;
  /** Bornes ISO INCLUSES — les jours en dehors ne sont pas cliquables. */
  min?: string;
  max?: string;
  placeholder?: string;
  title?: string;
  disabled?: boolean;
  /** Classes du BOUTON déclencheur (largeur, taille de texte…). */
  className?: string;
  /** Listes mois + année dans l'en-tête — pour une date lointaine (naissance). */
  choixDeLAnnee?: boolean;
}

export function DatePicker({
  value, onChange, min, max, placeholder, title, disabled, className, choixDeLAnnee,
}: DatePickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const selected = isoToDate(value);

  // Mois ouvert : celui de la valeur, sinon celui d'aujourd'hui. Piloté pour se
  // resynchroniser à chaque ouverture — sinon on rouvre sur le mois qu'on avait
  // quitté en naviguant, ce qui désoriente.
  const [month, setMonth] = React.useState<Date>(() => selected ?? new Date());
  React.useEffect(() => {
    if (open) setMonth(isoToDate(value) ?? isoToDate(todayIso()) ?? new Date());
  }, [open, value]);

  const hidden = [
    ...(min ? [{ before: isoToDate(min) as Date }] : []),
    ...(max ? [{ after: isoToDate(max) as Date }] : []),
  ];

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          title={title}
          // ⚠️ `title` NE NOMME PAS UN BOUTON QUI A DÉJÀ DU TEXTE : le nom
          // accessible reste la date affichée, si bien qu'un lecteur d'écran (et
          // une spec) ne peut pas distinguer deux sélecteurs voisins — « début »
          // de « fin ». L'infobulle survit pour la souris ; le nom, lui, dit
          // enfin de quelle date il s'agit.
          aria-label={title ? `${title}${value ? ` : ${value}` : ''}` : undefined}
          disabled={disabled}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2",
            "text-xs tabular-nums text-foreground outline-none transition-colors",
            "hover:border-gold/40 focus-visible:border-gold disabled:cursor-not-allowed disabled:opacity-50",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {value ? label(value) : placeholder ?? t('common.choisirEllipse')}
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          className={cn(
            "z-50 rounded-xl border border-border/80 bg-card p-3",
            "shadow-[0_20px_50px_rgba(0,0,0,0.45)]",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          )}
        >
          <React.Suspense fallback={<div className="h-[232px] w-[232px]" aria-hidden />}>
            <DatePickerPanel
              month={month}
              onMonthChange={setMonth}
              selected={selected}
              disabled={hidden}
              choixDeLAnnee={choixDeLAnnee}
              onSelect={date => { if (date) { onChange(dateToIso(date)); setOpen(false); } }}
            />
          </React.Suspense>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
