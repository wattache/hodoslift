"use client";

import { DayPicker } from "react-day-picker";
import { fr } from "react-day-picker/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * La GRILLE du sélecteur de date, isolée dans son propre module pour être
 * chargée à la demande (`React.lazy` côté `date-picker.tsx`).
 *
 * Pourquoi : `react-day-picker` + ses utilitaires de dates pèsent ~24 kB gzip.
 * Importés en dur, ils atterrissaient dans le bundle d'entrée — la liste des
 * objectifs du tableau de bord tire un DatePicker, donc tout le monde payait le
 * calendrier au premier chargement. Or on n'en a besoin qu'à l'ouverture d'un
 * champ. Ici la grille part dans son propre morceau, récupéré au premier clic.
 *
 * Seul l'habillage vit ici ; la logique (valeur, bornes, ouverture) reste dans
 * `date-picker.tsx`.
 */

export interface DatePickerPanelProps {
  month: Date;
  onMonthChange: (month: Date) => void;
  selected?: Date;
  disabled: Array<{ before: Date } | { after: Date }>;
  onSelect: (date: Date | undefined) => void;
  /** Listes mois + année au lieu du seul libellé : pour une date LOINTAINE (une
   *  naissance), où trente ans de flèches mois par mois ne sont pas un geste. */
  choixDeLAnnee?: boolean;
}

export default function DatePickerPanel({
  month, onMonthChange, selected, disabled, onSelect, choixDeLAnnee,
}: DatePickerPanelProps) {
  return (
    <DayPicker
      mode="single"
      locale={fr}
      weekStartsOn={1}
      month={month}
      onMonthChange={onMonthChange}
      selected={selected}
      disabled={disabled}
      onSelect={onSelect}
      captionLayout={choixDeLAnnee ? 'dropdown' : 'label'}
      // Jusqu'à cent ans en arrière, jusqu'à aujourd'hui : les bornes par défaut
      // de `dropdown`, écrites pour qu'elles se lisent ici.
      startMonth={choixDeLAnnee ? new Date(new Date().getFullYear() - 100, 0) : undefined}
      endMonth={choixDeLAnnee ? new Date() : undefined}
      components={{
        PreviousMonthButton: props => (
          <button {...props} className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        ),
        NextMonthButton: props => (
          <button {...props} className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        ),
      }}
      classNames={{
        root: "text-foreground",
        months: "relative",
        // `px-7` : les listes mois/année ne recouvrent pas les flèches du bord.
        month_caption: "mb-2 flex h-6 items-center justify-center px-7",
        caption_label: "flex items-center gap-1 text-xs font-semibold capitalize [&_svg]:h-3 [&_svg]:w-3 [&_svg]:fill-muted-foreground",
        // ⚠️ LE `<select>` EST INVISIBLE ET POSÉ SUR SON LIBELLÉ — c'est le
        // montage de react-day-picker : le libellé dessine, le select natif
        // capte le clic et le clavier. Visible, il se peignait PAR-DESSUS le
        // libellé, et chaque liste apparaissait deux fois.
        dropdowns: "flex items-center gap-1.5",
        dropdown_root: "relative inline-flex items-center rounded border border-border px-1.5 py-0.5 hover:border-gold/40",
        dropdown: "absolute inset-0 w-full cursor-pointer appearance-none opacity-0",
        nav: "absolute inset-x-0 top-0 flex h-6 items-center justify-between",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "flex h-6 w-8 items-center justify-center text-[10px] font-medium text-muted-foreground",
        week: "flex",
        // ⚠️ LA TAILLE EST SUR LA CELLULE, PAS SEULEMENT SUR SON BOUTON.
        //
        // `week` est un `flex` : les cellules sont donc des éléments flex, et une
        // cellule VIDE — les jours qui précèdent le 1er du mois — n'a pas de
        // bouton pour lui donner sa largeur. Elle mesurait 0, la première ligne
        // se collait à gauche, et le 1er août 2026 (un SAMEDI) s'affichait dans
        // la colonne du lundi, à la même abscisse que le 3.
        //
        // Six mois sur sept étaient concernés : tous ceux qui ne commencent pas
        // un lundi. Le défaut datait du premier commit du projet — la grille est
        // JUSTE dans le DOM (cinq cellules vides bien présentes), c'est le CSS
        // qui les faisait disparaître, ce qui explique qu'il ait tenu si
        // longtemps : rien de sémantique ne clochait.
        day: "h-7 w-8 p-0",
        day_button: cn(
          "flex h-7 w-8 items-center justify-center rounded text-[11px] tabular-nums transition-colors",
          "hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold",
        ),
        selected: "[&_button]:bg-gold [&_button]:font-semibold [&_button]:text-gold-foreground [&_button]:hover:bg-gold",
        today: "[&_button]:ring-1 [&_button]:ring-inset [&_button]:ring-gold/50",
        outside: "opacity-30",
        disabled: "[&_button]:cursor-not-allowed [&_button]:opacity-25 [&_button]:hover:bg-transparent",
      }}
    />
  );
}
