import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NotebookPen, Pencil, Trash2 } from 'lucide-react';

import {
  useCorrigerNoteKine, useCreerNoteKine, useNotesKine, useSupprimerNoteKine,
} from '@/api/hooks/use-notes-kine';
import type { NoteKine } from '@/api/types';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { toastSaveError } from '@/lib/save-error';

/** LE JOURNAL DE SUIVI DU KINÉ (FRE-102) — au fil de l'eau, hors bilan.
 *
 *  « Le kiné prend des notes au fil de l'eau puis il sait où il en est. » Les
 *  deux moitiés de cette phrase décident de la forme : des entrées DATÉES qui
 *  s'empilent (au fil de l'eau) et la plus récente EN PREMIER (où il en est).
 *  Un bloc-notes qu'on réécrit ne donnerait que la seconde, en perdant comment
 *  on y est arrivé — ce qui est précisément ce qu'un suivi raconte.
 *
 *  ⚠️ CE COMPOSANT NE S'AFFICHE QU'AU KINÉ DE CET ATHLÈTE. L'appelant le garde
 *  (`suivisIds`), et le serveur refuse tout le monde d'autre en 403 — le mode
 *  d'accès le plus étroit du produit, seul à exclure l'athlète lui-même. Un
 *  bilan se remplit AVEC lui ; une note de suivi est l'observation du praticien.
 */

/** Une date lisible sans être bavarde : le jour suffit à situer une note, et
 *  l'heure encombrerait une liste qu'on parcourt du regard. */
function quand(iso: string, langue: string): string {
  // ⚠️ LA LANGUE VIENT D'i18n, elle n'est pas figée. `'fr-FR'` en dur affichait
  // « 24 août 2026 » sous une interface polonaise : tout le reste traduit, et la
  // date qui trahit. C'est le genre de détail qui fait dire « c'est pas vraiment
  // traduit » alors que 95 % l'est.
  return new Date(iso).toLocaleDateString(langue, {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

function Ligne({ note, athleteId }: { note: NoteKine; athleteId: string }) {
  const { t, i18n } = useTranslation();
  const date = quand(note.creeLe, i18n.language);
  const confirm = useConfirm();
  const corriger = useCorrigerNoteKine(athleteId);
  const supprimer = useSupprimerNoteKine(athleteId);
  const [edition, setEdition] = useState<string | null>(null);

  const valider = () => {
    const v = (edition ?? '').trim();
    setEdition(null);
    // Rien à écrire si le texte n'a pas bougé — ni si on l'a vidé, ce que le
    // serveur refuserait de toute façon (422). Vider n'est PAS supprimer : le
    // geste existe, et il est à côté.
    if (!v || v === note.contenu) return;
    corriger.mutate({ noteId: note.id, contenu: v }, { onError: toastSaveError });
  };

  return (
    <li className="border-t border-border/60 py-3 first:border-t-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {date}
          {/* ⚠️ « MODIFIÉE » NE SE DÉDUIT PAS D'UNE ÉGALITÉ DE TIMESTAMPS À LA
              MICROSECONDE : `cree_le` et `modifie_le` naissent de deux appels
              d'horloge distincts et diffèrent toujours de quelques µs. On compare
              donc à la SECONDE — sinon toute note fraîche se dirait modifiée. */}
          {Math.abs(+new Date(note.modifieLe) - +new Date(note.creeLe)) > 1000 && (
            <span className="ml-2 italic">{t('suiviKine.modifieeLe', { date: quand(note.modifieLe, i18n.language) })}</span>
          )}
        </span>
        {edition === null && (
          <span className="flex shrink-0 gap-1">
            <button
              type="button"
              aria-label={t('suiviKine.corrigerDu', { date })}
              onClick={() => setEdition(note.contenu)}
              className="grid h-8 w-8 place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label={t('suiviKine.supprimerDu', { date })}
              onClick={() => void (async () => {
                // ⚠️ LA CONFIRMATION NOMME LA NOTE PAR SA DATE. « Supprimer cette
                // note ? » ne dit pas laquelle quand il y en a douze à l'écran.
                if (!await confirm({
                  title: t('suiviKine.supprimerDu', { date }),
                  description: t('suiviKine.pasRecuperable'),
                })) return;
                supprimer.mutate(note.id, { onError: toastSaveError });
              })()}
              className="grid h-8 w-8 place-items-center rounded-md border border-border text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </div>

      {edition === null ? (
        // `whitespace-pre-wrap` : une note se rédige avec des retours à la ligne,
        // et les écraser transformerait une liste de points en pavé.
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {note.contenu}
        </p>
      ) : (
        <div className="mt-1 flex flex-col gap-2">
          <textarea
            value={edition}
            autoFocus
            rows={3}
            aria-label={t('suiviKine.corrigerLaNote')}
            onChange={e => setEdition(e.target.value)}
            className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 text-sm text-foreground outline-none focus:border-gold"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setEdition(null)}>{t('suiviKine.annuler')}</Button>
            <Button size="sm" className="bg-gold text-gold-foreground hover:bg-gold/90"
                    onClick={valider}>{t('suiviKine.enregistrer')}</Button>
          </div>
        </div>
      )}
    </li>
  );
}

export function NotesSuivi({ athleteId }: { athleteId: string }) {
  const { t } = useTranslation();
  const { data: notes = [], isLoading } = useNotesKine(athleteId);
  const creer = useCreerNoteKine(athleteId);
  const [brouillon, setBrouillon] = useState('');

  const ajouter = () => {
    const v = brouillon.trim();
    if (!v || creer.isPending) return;
    creer.mutate(v, {
      onSuccess: () => setBrouillon(''),
      onError: toastSaveError,
    });
  };

  return (
    <section className="rounded-xl border border-border bg-card px-4 pb-3 pt-3">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-tight">
        <NotebookPen className="h-4 w-4 text-serie-poids" />
        {t('suiviKine.notes')}
      </h2>

      {/* ⚠️ LA SAISIE EST EN HAUT, avec le journal antichronologique dessous.
          Écrire est le geste fréquent — « au fil de l'eau » — et le reléguer
          sous douze notes obligerait à faire défiler pour noter deux lignes. */}
      <div className="flex flex-col gap-2">
        <textarea
          value={brouillon}
          rows={2}
          aria-label={t('suiviKine.nouvelleNote')}
          placeholder={t('suiviKine.quObservesTu')}
          onChange={e => setBrouillon(e.target.value)}
          className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-gold"
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={!brouillon.trim() || creer.isPending}
            className="bg-gold text-gold-foreground hover:bg-gold/90"
            onClick={ajouter}
          >
            {t('suiviKine.ajouter')}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="mt-3 text-xs text-muted-foreground">{t('suiviKine.chargement')}</p>
      ) : notes.length === 0 ? (
        // ⚠️ L'ÉTAT VIDE DIT À QUOI ÇA SERT. Un cadre vide laisserait deviner ;
        // c'est le premier écran que Thomas verra, et il doit s'expliquer seul.
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {t('suiviKine.aucuneNote')}
        </p>
      ) : (
        <ul className="mt-2 flex flex-col">
          {notes.map(n => <Ligne key={n.id} note={n} athleteId={athleteId} />)}
        </ul>
      )}
    </section>
  );
}
