import { useMemo, useState } from 'react';
import { Check, Pencil, Plus, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { LibraryCategory, LibraryEntry } from '@/api/types';
import { useCreateLibraryEntry, useLibrary, usePatchLibraryEntry } from '@/api/hooks/use-library';
import { useMe } from '@/api/hooks/use-me';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toastSaveError } from '@/lib/save-error';

/** Bibliothèque — modèle unifié brokkr : une entrée par (catégorie, nom), tout
 *  partagé. Les « exercices » se répartissent en deux onglets par le flag
 *  `competition` (lifts de compét vs renforcement) ; `supports` relie un
 *  renforcement aux mouvements principaux qu'il sert. */

type TabId = 'competition' | 'renforcement' | 'variantes' | 'tempos' | 'formats' | 'assistances';

const TABS: { id: TabId; labelKey: string; category: LibraryCategory }[] = [
  { id: 'competition', labelKey: 'library.competition', category: 'exercices' },
  { id: 'renforcement', labelKey: 'library.accessory', category: 'exercices' },
  { id: 'variantes', labelKey: 'library.variants', category: 'variantes' },
  { id: 'tempos', labelKey: 'library.tempos', category: 'tempos' },
  { id: 'formats', labelKey: 'library.formats', category: 'formats' },
  { id: 'assistances', labelKey: 'library.assistances', category: 'assistances' },
];

function entriesOf(tab: TabId, lib: Partial<Record<LibraryCategory, LibraryEntry[]>>): LibraryEntry[] {
  if (tab === 'competition') return (lib.exercices ?? []).filter(e => e.competition);
  if (tab === 'renforcement') return (lib.exercices ?? []).filter(e => !e.competition);
  const cat = TABS.find(t => t.id === tab)!.category;
  return lib[cat] ?? [];
}

export function LibraryView() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const { data: library } = useLibrary();
  const createEntry = useCreateLibraryEntry();
  const patchEntry = usePatchLibraryEntry();

  const [tab, setTab] = useState<TabId>('competition');
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState<{ name: string; supports: string[] } | null>(null);

  const lib: Partial<Record<LibraryCategory, LibraryEntry[]>> = library ?? {};
  // Le coach de la structure — ou l'admin, qui entretient celle qu'il regarde
  // sans forcément y coacher (brokkr : `structure_ecrite`, `patch_entry`).
  const canWrite = !!me?.isCoach || !!me?.isAdmin;
  const compLifts = useMemo(() => (lib.exercices ?? []).filter(e => e.competition).map(e => e.name), [lib.exercices]);

  const onError = toastSaveError;

  const saveDraft = () => {
    if (!draft || !draft.name.trim()) return;
    const meta = TABS.find(o => o.id === tab)!;
    createEntry.mutate(
      {
        category: meta.category,
        name: draft.name.trim(),
        ...(meta.category === 'exercices' ? { competition: tab === 'competition' } : {}),
        ...(tab === 'renforcement' && draft.supports.length ? { supports: draft.supports } : {}),
      },
      { onError },
    );
    setDraft(null);
  };

  const counts = Object.fromEntries(TABS.map(o => [o.id, entriesOf(o.id, lib).length])) as Record<TabId, number>;
  const items = entriesOf(tab, lib).filter(e => !q || e.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <div className="flex items-center justify-end">
        {canWrite && !draft && (
          <Button size="sm" className="h-8 bg-gold text-gold-foreground hover:bg-gold/90" onClick={() => setDraft({ name: '', supports: [] })}>
            <Plus className="h-3.5 w-3.5" /> {t('library.newItem')}
          </Button>
        )}
      </div>

      {draft && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t(TABS.find(o => o.id === tab)?.labelKey ?? '')}
          </span>
          <Input
            value={draft.name}
            onChange={e => setDraft(d => d && { ...d, name: e.target.value })}
            placeholder={t('library.nomPlaceholder')}
            className="h-8 flex-1 min-w-[160px] text-sm"
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') saveDraft(); }}
          />
          {tab === 'renforcement' && (
            <SupportsSelector
              lifts={compLifts}
              supports={draft.supports}
              onChange={supports => setDraft(d => d && { ...d, supports })}
            />
          )}
          <Button size="sm" className="h-8 bg-gold text-gold-foreground hover:bg-gold/90" onClick={saveDraft}>{t('library.creer')}</Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => setDraft(null)}>{t('common.annuler')}</Button>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={t('library.search')}
          className="h-9 pl-9 text-sm"
        />
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl border border-border/80 bg-card p-1 shadow-[0_12px_32px_rgba(0,0,0,0.14)]">
        {TABS.map(onglet => (
          <button
            key={onglet.id}
            type="button"
            onClick={() => setTab(onglet.id)}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              tab === onglet.id
                ? 'bg-gold text-gold-foreground shadow'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {t(onglet.labelKey)}
            <span className={cn(
              'rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums',
              tab === onglet.id ? 'bg-gold-foreground/10 text-gold-foreground' : 'bg-muted text-muted-foreground',
            )}>
              {counts[onglet.id]}
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.length === 0 && (
          <div className="col-span-full rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            {t('library.aucunElement')}
          </div>
        )}
        {items.map(e => (
          <EntryCard
            key={e.id}
            entry={e}
            showSupports={tab === 'renforcement'}
            lifts={compLifts}
            canWrite={canWrite}
            onRename={name => patchEntry.mutate({ id: e.id, patch: { name } }, { onError })}
            onSupports={supports => patchEntry.mutate({ id: e.id, patch: { supports } }, { onError })}
          />
        ))}
      </div>
    </div>
  );
}

function EntryCard({ entry, showSupports, lifts, canWrite, onRename, onSupports }: {
  entry: LibraryEntry;
  showSupports: boolean;
  lifts: string[];
  canWrite: boolean;
  onRename: (name: string) => void;
  onSupports: (supports: string[]) => void;
}) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState<string | null>(null);

  const commitRename = () => {
    const name = (renaming ?? '').trim();
    if (name && name !== entry.name) onRename(name);
    setRenaming(null);
  };

  return (
    <div className="group rounded-lg border border-border/80 bg-card p-3 shadow-[0_10px_28px_rgba(0,0,0,0.12)] transition-colors hover:border-gold/40">
      <div className="mb-1 flex items-start justify-between gap-2">
        {renaming !== null ? (
          <span className="flex flex-1 items-center gap-1">
            <Input
              value={renaming}
              onChange={e => setRenaming(e.target.value)}
              className="h-7 text-sm"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setRenaming(null);
              }}
            />
            <button type="button" onClick={commitRename} title={t('common.valider')}>
              <Check className="h-3.5 w-3.5 text-success" />
            </button>
            <button type="button" onClick={() => setRenaming(null)} title={t('common.annuler')}>
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </span>
        ) : (
          <>
            <span className="text-sm font-semibold">{entry.name}</span>
            {canWrite && (
              <button
                type="button"
                title={t('common.rename')}
                onClick={() => setRenaming(entry.name)}
                className="opacity-0 transition-opacity group-hover:opacity-100"
              >
                <Pencil className="h-3 w-3 text-muted-foreground hover:text-foreground" />
              </button>
            )}
          </>
        )}
      </div>
      {showSupports && (
        <SupportsSelector
          lifts={lifts}
          supports={entry.supports ?? []}
          onChange={canWrite ? onSupports : undefined}
        />
      )}
    </div>
  );
}

/** Sélecteur des mouvements principaux qu'un renforcement supporte
 *  (`supports` = noms de lifts de compétition, texte libre côté serveur). */
function SupportsSelector({ lifts, supports, onChange }: {
  lifts: string[];
  supports: string[];
  onChange?: (supports: string[]) => void;
}) {
  const toggle = (name: string) => {
    if (!onChange) return;
    onChange(supports.includes(name) ? supports.filter(s => s !== name) : [...supports, name]);
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {lifts.map(name => {
        const active = supports.includes(name);
        return (
          <button
            key={name}
            type="button"
            title={name}
            onClick={() => toggle(name)}
            disabled={!onChange}
            className={cn(
              'rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold transition-colors',
              active
                ? 'border-gold/35 bg-gold/15 text-gold'
                : 'border-border/80 bg-muted/20 text-muted-foreground',
              onChange && !active && 'hover:border-gold/25 hover:text-foreground',
            )}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}
