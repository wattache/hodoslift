import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";

import { LANGUAGES } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * Bascule de langue — bouton unique qui fait tourner les locales disponibles,
 * à côté de la bascule de thème. Avec deux langues, un menu déroulant serait
 * une cérémonie pour un aller-retour ; on affiche le code de la langue COURANTE
 * pour que l'état soit lisible sans ouvrir quoi que ce soit.
 *
 * Le choix est mémorisé (localStorage, cf. `i18n/index.ts`) et prime ensuite sur
 * la langue du navigateur.
 */
export function LanguageToggle({ className, onSwitched }: { className?: string; onSwitched?: () => void }) {
  const { i18n } = useTranslation();
  const current = i18n.resolvedLanguage ?? "fr";
  const index = LANGUAGES.findIndex(l => l.code === current);
  const next = LANGUAGES[(index + 1) % LANGUAGES.length];

  return (
    <button
      type="button"
      onClick={() => { void i18n.changeLanguage(next.code); onSwitched?.(); }}
      title={`${next.label}`}
      aria-label={`${next.label}`}
      className={cn(
        "flex h-8 shrink-0 items-center justify-center gap-1 rounded-md border border-sidebar-border/80",
        "bg-sidebar-accent/45 px-2 text-sidebar-foreground/70 transition-colors",
        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        className,
      )}
    >
      <Languages className="h-4 w-4" />
      <span className="text-[10px] font-semibold uppercase tracking-wider">{current}</span>
    </button>
  );
}
