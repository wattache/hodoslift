import { useEffect, useState } from "react";
import { Link2 } from "lucide-react";
import { useTranslation } from 'react-i18next';
import { cn } from "@/lib/utils";

/** LES CELLULES DE SAISIE DU COACH — brouillon local, commit au `blur`, `Enter`
 *  qui valide. Toute la saisie du coach en dépend, sur grand écran comme au
 *  téléphone ; c'est pour ça qu'elles vivent hors des deux vues. */

/** Cellule éditable inline : brouillon local, commit au blur (évite d'écrire à chaque frappe). */
export function EditCell({
  value, align = "right", placeholder = "—", label, onCommit, className = "", inputMode, autoFocus,
}: {
  value: string | null | undefined;
  align?: "right" | "center" | "left";
  placeholder?: string;
  /** Clavier du téléphone. `numeric` sur une durée : la saisie est en SECONDES,
   *  et un clavier alphabétique au milieu d'une séance est une friction de plus
   *  sur un champ qu'on remplit déjà rarement (FRE-42). `decimal` pour une
   *  charge : le pavé numérique, avec sa virgule. */
  inputMode?: "numeric" | "decimal";
  /** Nom accessible : les libellés de ces cellules sont des `div`, pas des
   *  `label`, donc rien ne relie le texte au champ pour un lecteur d'écran. */
  label?: string;
  className?: string;
  autoFocus?: boolean;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => { setDraft(value ?? ""); }, [value]);
  return (
    <input
      value={draft}
      aria-label={label}
      placeholder={placeholder}
      inputMode={inputMode}
      autoFocus={autoFocus}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== (value ?? "")) onCommit(draft); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className={cn(
        "h-7 w-full rounded-md border border-border bg-background px-1 font-mono text-sm tabular-nums outline-none focus:border-gold",
        align === "right" ? "text-right" : align === "left" ? "text-left" : "text-center",
        className,
      )}
    />
  );
}

/** Champ URL éditable (lien vidéo / ressource) : brouillon local, commit au blur. */
export function LinkEdit({ value, onCommit }: { value: string | null | undefined; onCommit: (v: string) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => { setDraft(value ?? ""); }, [value]);
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 focus-within:border-gold">
      <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <input
        type="url"
        value={draft}
        aria-label={t("session.lienVideoRessource")}
        placeholder={t("session.httpsVideoDeDemonstration")}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== (value ?? "")) onCommit(draft); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="h-8 w-full bg-transparent text-foreground/90 outline-none"
      />
    </div>
  );
}

/** Zone de note éditable : brouillon local, commit au blur. */
export function NoteArea({ value, placeholder, label, onCommit }: {
  value: string | null | undefined; placeholder: string; label?: string; onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => { setDraft(value ?? ""); }, [value]);
  return (
    <textarea
      value={draft}
      aria-label={label}
      placeholder={placeholder}
      rows={2}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== (value ?? "")) onCommit(draft); }}
      className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 text-foreground/90 outline-none focus:border-gold"
    />
  );
}
