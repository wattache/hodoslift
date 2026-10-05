import { useEffect, useRef, useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Check, ChevronsUpDown, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

/** Repli pour la recherche : casse et accents ignorés.
 *  « DEV EPAULES » doit se trouver en tapant « dév épaules ». */
function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

type Row =
  | { kind: 'clear' }
  | { kind: 'option'; name: string; orphan: boolean };

/** Le PANNEAU : recherche, navigation au clavier, liste. Partagé par les deux
 *  combobox — celui à valeur unique et celui à valeurs multiples — parce que
 *  c'est là que vivent les règles qui ne doivent pas diverger : la liste reste
 *  entière quand on efface la recherche, une valeur hors catalogue reste
 *  sélectionnable, et Entrée prend le premier résultat. */
function Panneau({
  options,
  selection,
  onChoisir,
  onVider,
  complet = false,
}: {
  options: string[];
  /** Valeurs retenues — une seule pour le combobox simple. */
  selection: string[];
  onChoisir: (name: string) => void;
  /** Absent = pas de ligne « aucun » (le multiple se vide en décochant). */
  onVider?: () => void;
  /** Maximum atteint : on ne peut plus qu'en retirer. */
  complet?: boolean;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Une valeur héritée absente du catalogue reste affichée ET sélectionnable :
  // sans ça, rouvrir une vieille séance l'effacerait silencieusement.
  const orphelines = selection.filter(v => !options.includes(v));

  // Calculé à chaque rendu, sans mémo : une centaine d'options tout au plus, et
  // mémoriser exigeait une clé de dépendance sur une LISTE — un joint qui casse
  // dès qu'une valeur contient le séparateur (« SMITH MACHINE »).
  const q = fold(query.trim());
  const pool = [...orphelines, ...options];
  const rows: Row[] = [];
  // Seulement sans recherche en cours : sinon « — Aucun » resterait en tête de
  // liste et Entrée effacerait la valeur au lieu de prendre le 1er résultat.
  if (onVider && selection.length > 0 && !q) rows.push({ kind: 'clear' });
  for (const name of q ? pool.filter(o => fold(o).includes(q)) : pool) {
    rows.push({ kind: 'option', name, orphan: orphelines.includes(name) });
  }

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const select = (row: Row) => {
    if (row.kind === 'clear') onVider?.();
    else onChoisir(row.name);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!rows.length) return;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setActive(a => (a + delta + rows.length) % rows.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[active];
      if (row) select(row);
    }
  };

  return (
    <>
      <input
        value={query}
        // Repartir en haut à chaque frappe : l'index précédent ne désigne
        // plus la même ligne une fois la liste refiltrée.
        onChange={e => { setQuery(e.target.value); setActive(0); }}
        onKeyDown={onKeyDown}
        placeholder={t('combobox.search')}
        className="h-8 w-full border-b border-border bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground/60"
      />

      <div ref={listRef} className="max-h-56 overflow-y-auto p-1">
        {rows.length === 0 && (
          // `whitespace-pre-line` : le message tient en deux phrases, le
          // constat puis la marche à suivre — c'est le seul indice restant.
          <p className="whitespace-pre-line px-3 py-3 text-center text-xs leading-relaxed text-muted-foreground">
            {t('combobox.noResult')}
          </p>
        )}

        {rows.map((row, i) => {
          const isActive = i === active;
          const key = row.kind === 'option' ? `o:${row.name}` : row.kind;
          const base = cn(
            'flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm',
            isActive && 'bg-gold/15',
          );

          if (row.kind === 'clear') {
            return (
              <button key={key} type="button" data-active={isActive} className={cn(base, 'text-muted-foreground')}
                onMouseEnter={() => setActive(i)} onClick={() => select(row)}>
                {t('combobox.clear')}
              </button>
            );
          }

          const retenue = selection.includes(row.name);
          // Maximum atteint : les autres options s'estompent au lieu de
          // disparaître — la liste reste la même, seule l'action est fermée.
          const bloquee = complet && !retenue;

          return (
            <button key={key} type="button" data-active={isActive} disabled={bloquee}
              className={cn(base, bloquee && 'opacity-40')}
              onMouseEnter={() => setActive(i)} onClick={() => select(row)}>
              <Check className={cn('h-3.5 w-3.5 shrink-0', retenue ? 'text-gold' : 'opacity-0')} />
              <span className="truncate">{row.name}</span>
              {row.orphan && (
                <TriangleAlert
                  className="ml-auto h-3.5 w-3.5 shrink-0 text-warning"
                  // Valeur saisie avant la fermeture des listes : conservée
                  // pour ne rien perdre, mais signalée comme hors catalogue.
                  aria-label={t('combobox.outsideLibrary')}
                />
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

const TRIGGER_CLASS =
  'flex h-7 w-full items-center gap-1 rounded-md border border-border bg-background px-1.5 text-sm outline-none '
  + 'hover:border-gold/50 focus:border-gold data-[state=open]:border-gold';

/** Liste FERMÉE : la valeur retenue vient TOUJOURS de la bibliothèque.
 *
 *  Aucune création à la volée, par choix : le catalogue se décide au même
 *  endroit pour tout le monde (la vue Bibliothèque), et enrichir le référentiel
 *  n'est pas un geste quotidien. Les noms d'exercice servant de clés
 *  (`MOVEMENT_TO_ORM`, `athlete_prs.movement`, `training_sets.exercise`), une
 *  porte de sortie en pleine saisie rouvrirait la voie aux clés fantômes.
 *
 *  Remplace `<input list>` + `<datalist>`, dont le navigateur filtrait les
 *  options selon la saisie sans possibilité de l'en empêcher — taper « 0031 »
 *  dans un tempo vidait le dépliement au lieu de montrer le catalogue.
 *
 *  Ici la recherche est explicite : le champ filtre, mais la liste complète
 *  reste atteignable en effaçant la recherche. */
export function Combobox({
  value,
  options,
  label,
  placeholder = '—',
  onCommit,
  align = 'left',
  className,
}: {
  value: string | null | undefined;
  options: string[];
  /** Nom accessible du champ : sans lui, un lecteur d'écran n'annonce que la
   *  valeur (« 30X0, bouton »), sans dire de quelle colonne il s'agit. */
  label?: string;
  placeholder?: string;
  onCommit: (v: string) => void;
  align?: 'left' | 'center';
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button type="button" aria-label={label} className={cn(TRIGGER_CLASS, className)}>
          <span
            className={cn(
              'min-w-0 flex-1 truncate',
              align === 'center' ? 'text-center' : 'text-left',
              !value && 'text-muted-foreground',
            )}
          >
            {value || placeholder}
          </span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground/60" />
        </button>
      </PopoverPrimitive.Trigger>

      <Contenu>
        {/* `key` sur l'ouverture : le panneau se remonte à chaque fois, donc
            la recherche repart à zéro — rouvrir doit montrer le catalogue
            complet, pas le filtre de la fois précédente. */}
        <Panneau
          key={String(open)}
          options={options}
          selection={value ? [value] : []}
          onChoisir={v => { if (v !== value) onCommit(v); setOpen(false); }}
          onVider={() => { onCommit(''); setOpen(false); }}
        />
      </Contenu>
    </PopoverPrimitive.Root>
  );
}

/** Même liste fermée, mais PLUSIEURS valeurs (FRE-33).
 *
 *  Le panneau reste ouvert entre deux choix : cumuler est le geste, refermer à
 *  chaque coche obligerait à rouvrir autant de fois. */
export function ComboboxMultiple({
  values,
  options,
  label,
  placeholder = '—',
  max,
  onCommit,
  className,
}: {
  values: string[];
  options: string[];
  label?: string;
  placeholder?: string;
  /** Au-delà, on ne peut plus qu'en retirer. */
  max?: number;
  onCommit: (v: string[]) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const complet = max !== undefined && values.length >= max;
  /** ⚠️ LES VARIANTES RETENUES EN TÊTE, figées À L'OUVERTURE (William, 20/09).
   *  Avec trois variantes cochées dans une liste de quarante, il fallait faire
   *  défiler pour les retrouver — et pour en décocher une. Elles montent en
   *  haut, dans l'ordre du catalogue ; le reste suit. L'ordre est pris au moment
   *  d'ouvrir et ne bouge plus tant que la liste est visible : recalculé à
   *  chaque coche, une option sauterait sous le doigt qui vient de la toucher. */
  const [ordre, setOrdre] = useState(options);
  const ouvrir = (o: boolean) => {
    if (o) {
      const retenue = (v: string) => values.some(x => x.toUpperCase() === v.toUpperCase());
      setOrdre([...options.filter(retenue), ...options.filter(v => !retenue(v))]);
    }
    setOpen(o);
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={ouvrir}>
      <PopoverPrimitive.Trigger asChild>
        <button type="button" aria-label={label} className={cn(TRIGGER_CLASS, className)}>
          <span className={cn('min-w-0 flex-1 truncate text-left', values.length === 0 && 'text-muted-foreground')}>
            {values.length > 0 ? values.join(' + ') : placeholder}
          </span>
          {/* Le compte n'apparaît qu'à partir de deux : sur une ligne unique il
              ne dirait rien que le libellé ne dise déjà. */}
          {values.length > 1 && (
            <span className="shrink-0 rounded-sm bg-gold/15 px-1 text-[10px] font-semibold text-gold tabular-nums">
              {values.length}
            </span>
          )}
          <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground/60" />
        </button>
      </PopoverPrimitive.Trigger>

      <Contenu>
        <Panneau
          key={String(open)}
          options={ordre}
          selection={values}
          complet={complet}
          onChoisir={v => onCommit(
            values.some(x => x.toUpperCase() === v.toUpperCase())
              ? values.filter(x => x.toUpperCase() !== v.toUpperCase())
              : complet ? values : [...values, v],
          )}
        />
      </Contenu>
    </PopoverPrimitive.Root>
  );
}

function Contenu({ children }: { children: React.ReactNode }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align="start"
        sideOffset={4}
        onOpenAutoFocus={e => {
          // Radix focalise le conteneur ; on veut le champ de recherche pour
          // pouvoir filtrer sans un clic de plus.
          e.preventDefault();
          (e.currentTarget as HTMLElement).querySelector('input')?.focus();
        }}
        className="z-50 w-[max(var(--radix-popover-trigger-width),15rem)] overflow-hidden rounded-lg border border-border bg-card shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
