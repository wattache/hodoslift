"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Confirmation de suppression aux couleurs de l'app, en remplacement de
 * `window.confirm` — la boîte native était bloquante, hors charte, et son
 * message ne disait jamais CE QU'ON supprime.
 *
 * S'utilise comme le natif, en asynchrone :
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: 'Supprimer la séance « Push A » ?' })) onDelete();
 *
 * Bâti sur @radix-ui/react-dialog (déjà utilisé par `sheet.tsx`) : focus piégé,
 * fermeture au clavier et sémantique ARIA sont gérées par la primitive. Une
 * fermeture par Échap, par l'overlay ou par « Annuler » résout `false` — on ne
 * supprime jamais par abandon.
 */

export interface ConfirmOptions {
  /** Question posée, qui DOIT nommer la cible. « Supprimer la séance « Push A » ? » */
  title: string;
  /** Conséquence non évidente : ce qui part avec, ce qui est irréversible. */
  description?: string;
  /** Verbe du bouton d'action. Défaut « Supprimer ». */
  confirmLabel?: string;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

// Défaut hors provider : on refuse plutôt que de supprimer sans demander.
const ConfirmContext = React.createContext<ConfirmFn>(async () => false);

export function useConfirm(): ConfirmFn {
  return React.useContext(ConfirmContext);
}

interface Pending {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [pending, setPending] = React.useState<Pending | null>(null);

  const confirm = React.useCallback<ConfirmFn>(
    options => new Promise<boolean>(resolve => setPending({ options, resolve })),
    [],
  );

  // Une seule sortie pour tous les chemins (bouton, Échap, overlay) : la
  // promesse est TOUJOURS résolue, jamais laissée en suspens.
  const settle = React.useCallback((value: boolean) => {
    setPending(current => {
      current?.resolve(value);
      return null;
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <DialogPrimitive.Root
        open={pending !== null}
        onOpenChange={open => { if (!open) settle(false); }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className={cn(
              "fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px]",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            )}
          />
          <DialogPrimitive.Content
            className={cn(
              "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2",
              "rounded-xl border border-border/80 bg-card p-5 shadow-[0_24px_60px_rgba(0,0,0,0.45)]",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            )}
          >
            <div className="flex gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/15">
                <AlertTriangle className="h-4.5 w-4.5 text-destructive" />
              </span>
              <div className="min-w-0">
                <DialogPrimitive.Title className="text-sm font-semibold text-foreground">
                  {pending?.options.title}
                </DialogPrimitive.Title>
                {pending?.options.description ? (
                  <DialogPrimitive.Description className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    {pending.options.description}
                  </DialogPrimitive.Description>
                ) : (
                  // Radix attend une description : on la fournit pour les
                  // lecteurs d'écran même quand l'UI n'en affiche pas.
                  <DialogPrimitive.Description className="sr-only">
                    {t('common.actionDefinitive')}
                  </DialogPrimitive.Description>
                )}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => settle(false)}>
                Annuler
              </Button>
              {/* autoFocus sur l'action DESTRUCTIVE serait un piège : la touche
                  Entrée doit rester inoffensive. Radix met le focus initial sur
                  le premier élément focusable, donc « Annuler ». */}
              <Button size="sm" variant="destructive" onClick={() => settle(true)}>
                {pending?.options.confirmLabel ?? "Supprimer"}
              </Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </ConfirmContext.Provider>
  );
}
