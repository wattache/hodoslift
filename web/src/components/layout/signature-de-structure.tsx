import { useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMe } from '@/api/hooks/use-me';
import { useStructure } from '@/api/hooks/use-structure-choisie';
import { LogoDeStructure } from '@/components/logo-de-structure';
import type { StructureDeMoi } from '@/lib/structure';
import { cn } from '@/lib/utils';

/** « by French Forge » — la signature sous HODOS (FRE-13). Du texte : le
 *  logo et le changement de structure ont leur ligne, `ChoixDeStructure`. */
export function SignatureDeStructure() {
  const { courante } = useStructure();
  return <span className="truncate text-[10px] text-sidebar-foreground/45">by {courante?.nom ?? 'French Forge'}</span>;
}

/** OÙ L'ON EST — LE LOGO DE LA STRUCTURE, ET LE CHANGEMENT (FRE-13).
 *
 *  ⚠️ SA PROPRE LIGNE, SUR TOUTE LA LARGEUR DE LA BARRE. Le changement vivait
 *  dans la signature « by … », un `<select>` de 10 px dans une colonne de 73 px :
 *  « pas pratique », et sans logo (William, 18/09). Logo, puis tronqué à
 *  « by SC… » dès qu'on l'y ajoutait. Ici, la place des sélecteurs d'espace de
 *  travail : le logo, le nom, et ce qu'on y EST (coach, kiné, athlète).
 *
 *  Une seule structure : la ligne montre son logo, sans rien à ouvrir. Barre
 *  repliée : le logo seul. */
export function ChoixDeStructure() {
  const { t } = useTranslation();
  const { courante, structures, choisir } = useStructure();
  const [ouvert, setOuvert] = useState(false);
  if (!courante) return null;

  const ligne = (
    <>
      <LogoDeStructure slug={courante.slug} className="h-7 w-7" />
      <span className="flex min-w-0 flex-1 flex-col text-left leading-tight group-data-[collapsible=icon]:hidden">
        <span className="truncate text-xs font-semibold text-sidebar-foreground">{courante.nom}</span>
        <span className="truncate text-[10px] text-sidebar-foreground/50"><Roles structure={courante} /></span>
      </span>
    </>
  );
  const cadre = 'flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0';

  if (structures.length < 2) return <div className={cadre}>{ligne}</div>;

  return (
    <PopoverPrimitive.Root open={ouvert} onOpenChange={setOuvert}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={t('structure.changer')}
          className={cn(cadre, 'outline-none transition-colors hover:bg-sidebar-accent/70 focus-visible:ring-1 focus-visible:ring-gold')}
        >
          {ligne}
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden" aria-hidden />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          className="z-50 w-64 rounded-xl border border-border/80 bg-card p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.45)]"
        >
          <p className="px-2 pb-1.5 pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('structure.titre')}
          </p>
          <ul role="listbox" aria-label={t('structure.changer')} className="flex flex-col gap-0.5">
            {structures.map(s => (
              <li key={s.slug}>
                <button
                  type="button"
                  role="option"
                  aria-selected={s.slug === courante.slug}
                  onClick={() => { choisir(s.slug); setOuvert(false); }}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left outline-none transition-colors',
                    'hover:bg-accent focus-visible:bg-accent',
                    s.slug === courante.slug && 'bg-accent/60',
                  )}
                >
                  <LogoDeStructure slug={s.slug} className="h-9 w-9" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold">{s.nom}</span>
                    <span className="truncate text-[11px] text-muted-foreground"><Roles structure={s} /></span>
                  </span>
                  {s.slug === courante.slug && <Check className="h-4 w-4 shrink-0 text-gold" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/** Ce qu'on EST dans cette structure — calculé par brokkr (`me.structures`),
 *  l'admin en plus, qui est de la plateforme. */
function Roles({ structure }: { structure: StructureDeMoi }) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const roles = [
    structure.isCoach && t('structure.role.coach'),
    structure.isKine && t('structure.role.kine'),
    structure.athleteId && t('structure.role.athlete'),
    me?.isAdmin && t('structure.role.admin'),
  ].filter(Boolean);
  return <>{roles.join(' · ')}</>;
}
