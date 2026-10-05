import { useCallback, useEffect, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Check, Copy, Download, Loader2, Share2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

import {
  canCopyImage, canShareFiles, copyImage, downloadImage, shareImage,
} from '@/lib/session-share';
import { Button } from '@/components/ui/button';

/** Partage d'une image (séance, progression d'un exercice…).
 *
 *  Le dialogue ne sait PAS ce qu'il montre : il reçoit une fonction de rendu.
 *  C'est ce qui permet d'ajouter une image sans dupliquer l'aperçu, la copie
 *  et les replis de compatibilité.
 *
 *  L'aperçu n'est pas cosmétique : on ne publie pas à l'aveugle. Il garantit
 *  aussi que le blob existe AVANT le clic sur « Copier » — Safari invalide un
 *  accès presse-papier qui sort du geste utilisateur. */
export function ShareImageDialog({ render, fileName, title, triggerTitle, className, children }: {
  render: () => Promise<Blob>;
  fileName: string;
  /** Titre du PARTAGE natif (invisible dans l'image). */
  title: string;
  triggerTitle?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = useCallback(async () => {
    setBlob(null);
    setError(null);
    try {
      const next = await render();
      setBlob(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [render]);

  useEffect(() => {
    if (!open) return;
    void generate();
  }, [open, generate]);

  // L'URL d'objet doit être révoquée, sinon chaque rendu fuite en mémoire.
  useEffect(() => {
    if (!blob) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  const onShare = async () => {
    if (!blob) return;
    try {
      await shareImage(blob, fileName, title);
    } catch (e) {
      // L'utilisateur qui ferme la feuille de partage déclenche AbortError :
      // ce n'est pas une erreur à lui signaler.
      if (e instanceof DOMException && e.name === 'AbortError') return;
      toast.error(t('share.failed'));
    }
  };

  const onCopy = async () => {
    if (!blob) return;
    try {
      await copyImage(blob);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success(t('share.copied'));
    } catch {
      toast.error(t('share.copyFailed'));
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          title={triggerTitle ?? t('share.title')}
          onClick={e => e.stopPropagation()}
          className={className ?? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-gold/15 hover:text-gold'}
        >
          {children ?? <Share2 className="h-3.5 w-3.5" />}
        </button>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onClick={e => e.stopPropagation()}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-2xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        >
          <div className="flex items-center justify-between gap-2">
            <DialogPrimitive.Title className="text-sm font-semibold">{t('share.title')}</DialogPrimitive.Title>
            <DialogPrimitive.Close className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">
            {t('share.description')}
          </DialogPrimitive.Description>

          <div className="flex min-h-64 items-center justify-center overflow-hidden rounded-lg border border-border bg-background/50">
            {error ? (
              <p className="p-6 text-center text-xs text-destructive">{error}</p>
            ) : previewUrl ? (
              <img src={previewUrl} alt={t('share.preview')} className="max-h-[52vh] w-auto object-contain" />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-gold" />
            )}
          </div>

          <div className="flex flex-col gap-2">
            {canShareFiles() && (
              <Button
                className="w-full bg-gold text-gold-foreground hover:bg-gold/90"
                disabled={!blob}
                onClick={() => void onShare()}
              >
                <Share2 className="h-4 w-4" /> {t('share.share')}
              </Button>
            )}
            {canCopyImage() && (
              <Button variant="outline" className="w-full" disabled={!blob} onClick={() => void onCopy()}>
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                {t('share.copy')}
              </Button>
            )}
            {/* Dernier recours : sans partage natif NI copie d'image (vieux
                navigateur, contexte non sécurisé), le dialogue n'offrirait
                sinon aucune action. */}
            {!canShareFiles() && !canCopyImage() && (
              <Button
                variant="outline"
                className="w-full"
                disabled={!blob}
                onClick={() => blob && downloadImage(blob, fileName)}
              >
                <Download className="h-4 w-4" /> {t('share.download')}
              </Button>
            )}
          </div>

          <p className="text-center text-[11px] leading-snug text-muted-foreground">
            {canShareFiles() ? t('share.hintMobile') : t('share.hintDesktop')}
          </p>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
