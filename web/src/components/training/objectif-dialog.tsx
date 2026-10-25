import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { BlockObjective } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatShort } from "@/lib/dates-ui";
import { cn } from "@/lib/utils";

/** Mêmes valeurs que le format d'un exercice de séance (`session-table`). */
export const EXERCISE_FORMATS = ["", "EMOM", "AMRAP", "CLUSTER"];

export const SELECT_CLASS =
  "h-11 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold sm:h-[38px] sm:text-xs";

/** La valeur courante figure TOUJOURS parmi les choix : une ligne de BASE à deux
 *  variantes donne « CHEST + DS », qu'aucune entrée de bibliothèque ne porte, et
 *  un `<select>` qui ne la propose pas afficherait « — » en la gardant. */
function avecLaValeur(options: string[], valeur: string | null | undefined): string[] {
  const v = (valeur ?? "").trim();
  return v && !options.includes(v) ? [v, ...options] : options;
}

/** L'OBJECTIF DANS UNE FENÊTRE (FRE-252) — la même pour ajouter, modifier, et
 *  partir d'une ligne de la BASE pré-remplie. Rien n'est écrit avant
 *  « Enregistrer » : un objectif se pose d'un geste, il ne se tape pas champ à
 *  champ dans la liste. */
export function ObjectifDialog({
  initial, nouveau, exerciseOptions, variantOptions, assistanceOptions, phrase,
  onSave, onRemove, onClose,
}: {
  initial: BlockObjective;
  /** Un objectif pas encore dans la liste : ni « atteint », ni « supprimer ». */
  nouveau: boolean;
  exerciseOptions: string[];
  variantOptions: string[];
  assistanceOptions: string[];
  phrase: (o: BlockObjective) => string;
  onSave: (o: BlockObjective) => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [o, setO] = useState<BlockObjective>(initial);
  const poser = <K extends keyof BlockObjective>(k: K, v: BlockObjective[K]) => setO(d => ({ ...d, [k]: v }));
  const lu = phrase(o);
  /* ⚠️ CE QUI DÉFINIT LA LIGNE NE SE MODIFIE PAS (FRE-254) : l'objectif vient
     d'une ligne de la BASE et en garde l'identité — mouvement, variante, format,
     tempo, tier. La changer ici le délierait de ses séries. */
  const fige = !!o.source;
  const ligneSource = o.source === 'principe'
    ? t("objectives.principeTier", { tier: o.tier ?? "—" }) : o.source === 'renfo' ? t("objectives.renfo") : "";

  return (
    <DialogPrimitive.Root open onOpenChange={ouvert => { if (!ouvert) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-xl border border-border/80 bg-card p-5 shadow-[0_24px_60px_rgba(0,0,0,0.45)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="flex items-start justify-between gap-3">
            <DialogPrimitive.Title className="text-sm font-semibold">
              {nouveau ? t("objectives.nouvelObjectif") : t("objectives.modifierObjectif")}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close aria-label={t("common.cancel")} className="-m-1 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">{t("objectives.mouvement")}</DialogPrimitive.Description>

          <form className="flex flex-col gap-3" onSubmit={e => { e.preventDefault(); onSave(o); }}>
            {fige && (
              <div data-ligne-de-l-objectif className="rounded-md border border-border/70 bg-muted/40 px-3 py-2">
                <div className="font-display text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {t("objectives.depuisLaLigne", { ligne: ligneSource })}
                </div>
                <div className="mt-0.5 font-mono text-xs">
                  {[o.exercise, o.variant, o.format, o.tempo && `tempo ${o.tempo}`].filter(Boolean).join(" · ")}
                </div>
              </div>
            )}
            <div className={cn("grid grid-cols-1 gap-2 sm:grid-cols-2", fige && "hidden")}>
              <Champ libelle={t("objectives.mouvement")}>
                <select className={SELECT_CLASS} value={o.exercise ?? ""} onChange={e => poser("exercise", e.target.value)}>
                  <option value="">—</option>
                  {avecLaValeur(exerciseOptions, o.exercise).map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </Champ>
              <Champ libelle={t("objectives.variant")}>
                <select className={SELECT_CLASS} value={o.variant ?? ""} onChange={e => poser("variant", e.target.value)}>
                  <option value="">—</option>
                  {avecLaValeur(variantOptions, o.variant).map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </Champ>
            </div>

            {/* Le format ET ses options : la durée d'un EMOM ou d'un AMRAP, le
                schéma et le repos d'un cluster — les mêmes champs que la BASE. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Champ libelle={t("objectives.format")} className={cn(fige && "hidden")}>
                <select className={SELECT_CLASS} value={o.format ?? ""} onChange={e => poser("format", e.target.value)}>
                  {avecLaValeur(EXERCISE_FORMATS, o.format).map(f => <option key={f} value={f}>{f || "—"}</option>)}
                </select>
              </Champ>
              {o.format && (
                <Champ libelle={o.format === "CLUSTER" ? t("objectives.schema") : t("objectives.duree")}>
                  <Input value={o.clusterMode ?? ""} placeholder={o.format === "CLUSTER" ? "1/1/1" : "120"}
                         className="h-11 w-full text-sm sm:h-[38px] sm:text-xs" onChange={e => poser("clusterMode", e.target.value)} />
                </Champ>
              )}
              {o.format === "CLUSTER" && (
                <Champ libelle={t("objectives.reposCluster")}>
                  <Input value={o.clusterRest ?? ""} placeholder="15s"
                         className="h-11 w-full text-sm sm:h-[38px] sm:text-xs" onChange={e => poser("clusterRest", e.target.value)} />
                </Champ>
              )}
              <Champ libelle={t("objectives.tempo")} className={cn(fige && "hidden")}>
                <Input value={o.tempo ?? ""} className="h-11 w-full text-sm sm:h-[38px] sm:text-xs" onChange={e => poser("tempo", e.target.value)} />
              </Champ>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Champ libelle={t("objectives.series")}>
                <Input value={o.sets ?? ""} className="h-11 w-full text-sm sm:h-[38px] sm:text-xs" onChange={e => poser("sets", e.target.value)} />
              </Champ>
              <Champ libelle={t("objectives.reps")}>
                <Input value={o.reps ?? ""} className="h-11 w-full text-sm sm:h-[38px] sm:text-xs" onChange={e => poser("reps", e.target.value)} />
              </Champ>
              <Champ libelle={t("objectives.chargeKg")} className="col-span-2">
                <div className="flex items-center gap-1.5">
                  <Input value={o.weightMin ?? ""} aria-label={t("objectives.chargeMin")} className="h-11 w-full border-gold/25 text-sm sm:h-[38px] sm:text-xs"
                         onChange={e => poser("weightMin", e.target.value)} />
                  <span className="text-xs text-muted-foreground">–</span>
                  <Input value={o.weightMax ?? ""} aria-label={t("objectives.chargeMax")} className="h-11 w-full border-gold/25 text-sm sm:h-[38px] sm:text-xs"
                         onChange={e => poser("weightMax", e.target.value)} />
                </div>
              </Champ>
            </div>

            <Champ libelle={t("objectives.assistance")} className="sm:w-1/2">
              <select className={SELECT_CLASS} value={o.assistance || ""} onChange={e => poser("assistance", e.target.value)}>
                <option value="">—</option>
                {avecLaValeur(assistanceOptions, o.assistance).map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </Champ>

            {lu && <p className="text-[11px] italic text-muted-foreground">{t("objectives.seLit", { phrase: lu })}</p>}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {!nouveau && (
                <button type="button" aria-pressed={!!o.atteintLe}
                        onClick={() => poser("atteintLe", o.atteintLe ? null : new Date().toISOString().slice(0, 10))}
                        className={cn("flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs transition-colors",
                          o.atteintLe ? "border-transparent bg-gold font-semibold text-gold-foreground"
                                      : "border-border text-muted-foreground hover:border-gold/40 hover:text-foreground")}>
                  <Check className="h-3.5 w-3.5" />
                  {o.atteintLe ? t("objectives.atteintLe", { date: formatShort(o.atteintLe) }) : t("objectives.marquerAtteint")}
                </button>
              )}
              {!nouveau && onRemove && (
                <button type="button" title={t("objectives.removeTitle")} aria-label={t("objectives.removeTitle")} onClick={onRemove}
                        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/15 hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              <div className="ml-auto flex gap-2">
                <DialogPrimitive.Close asChild>
                  <Button type="button" size="sm" variant="ghost" className="h-9">{t("common.cancel")}</Button>
                </DialogPrimitive.Close>
                <Button type="submit" size="sm" className="h-9 bg-gold text-gold-foreground hover:bg-gold/90">
                  <Check className="h-3.5 w-3.5" /> {nouveau ? t("objectives.ajouter") : t("common.save")}
                </Button>
              </div>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Champ({ libelle, className, children }: {
  libelle: string; className?: string; children: React.ReactNode;
}) {
  return (
    <label className={cn("block min-w-0", className)}>
      <span className="mb-1 block font-display text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {libelle}
      </span>
      {children}
    </label>
  );
}
