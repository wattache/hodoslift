import { useId } from 'react';
import { SymboleHodos } from '@/components/marque-hodos';
import { cn } from '@/lib/utils';

/** LE LOGO D'UNE STRUCTURE — FRE-13.
 *
 *  Hodos garde son symbole partout ; le logo de la structure dit POUR QUI. Ce
 *  sont les ÉTATS FINAUX des ouvertures de `index.html` (`#open`, `#open-sc`,
 *  `#open-eg`) : les tracés sont les mêmes, et bougent ensemble.
 *
 *  ⚠️ SUR UNE PASTILLE SOMBRE, DANS LES DEUX THÈMES. La toque ElGustoLift est
 *  ivoire et le blason SCAPPULIFT acier : posés sur la barre latérale CLAIRE,
 *  ils disparaissaient. La pastille est celle des ouvertures (`#1b1a1f`) — le
 *  logo s'y voit comme il a été dessiné.
 *
 *  Une structure sans logo prend le symbole Hodos. */
export function LogoDeStructure({ slug, className }: { slug: string; className?: string }) {
  return (
    // ⚠️ LE TRACÉ EST POSÉ EN ABSOLU. En `inline-flex`, `h-full w-full` ne se
    // résolvaient pas sur un `<svg>` : il mesurait 0 × 0, et la pastille
    // s'affichait VIDE (vu à la capture, 18/09).
    <span className={cn('relative inline-block shrink-0 rounded-md bg-[#1b1a1f]', className)}
          aria-hidden>
      <Trace slug={slug} />
    </span>
  );
}

function Trace({ slug }: { slug: string }) {
  const id = useId().replace(/:/g, '');
  if (slug === 'french-forge') {
    return (
      <svg viewBox="0 0 32 32" className="absolute inset-[12%] h-[76%] w-[76%] overflow-visible">
        <defs><clipPath id={`dome-${id}`}><ellipse cx="16" cy="20" rx="13" ry="15" /></clipPath></defs>
        <polygon points="0.8,6 6.2,16.6 2.2,18.4" fill="#D4A843" />
        <polygon points="31.2,6 25.8,16.6 29.8,18.4" fill="#D4A843" />
        <g clipPath={`url(#dome-${id})`}>
          <rect x="3" y="5" width="6.3" height="15" fill="#D4A843" fillOpacity={0.45} />
          <rect x="9.8" y="5" width="6.3" height="15" fill="#D4A843" fillOpacity={0.68} />
          <rect x="16.6" y="5" width="6.3" height="15" fill="#D4A843" />
          <rect x="23.4" y="5" width="6.3" height="15" fill="#D4A843" fillOpacity={0.32} />
        </g>
        <rect x="3" y="20.6" width="26" height="3.4" fill="#D4A843" />
        <polygon points="13.5,24 18.5,24 17.7,30.5 14.3,30.5" fill="#D4A843" />
      </svg>
    );
  }
  if (slug === 'scappulift') {
    return (
      // Aux couleurs Hodos depuis le 19/09 : lame ivoire, cornes et grand losange
      // or — le même blason que l'ouverture (`#open-sc`), sans halo.
      <svg viewBox="0 0 32 32" className="absolute inset-[12%] h-[76%] w-[76%] overflow-visible">
        <g fill="#D4A843">
          <path d="M11.4 0.6C6.7 2 2 3.9 1.8 7C1.6 9.9 3.2 12.2 5.3 13.7L8.8 11.8C7.9 8.4 8.2 3.4 11.4 0.6Z" />
          <path d="M20.6 0.6C25.3 2 30 3.9 30.2 7C30.4 9.9 28.8 12.2 26.7 13.7L23.2 11.8C24.1 8.4 23.8 3.4 20.6 0.6Z" />
          <polygon points="16,3.9 20.6,8.75 16,13.6 11.4,8.75" />
        </g>
        <path fill="#EEECF2" fillRule="evenodd" d="M3.6 8.8L16 16.2L28.4 8.8L27.5 16.6L16 31.8L4.5 16.6ZM10.8 18.5L12.3 17L19.7 17L21.2 18.5L19.7 20L12.3 20ZM16 21.6L18 23.5L16 25.4L14 23.5ZM16 22.6L17.05 23.5L16 24.4L14.95 23.5Z" />
      </svg>
    );
  }
  if (slug === 'elgustolift') {
    return (
      <svg viewBox="0 0 32 32" className="absolute inset-[12%] h-[76%] w-[76%] overflow-visible">
        <path fill="#EEECF2" d="M6.74 2.89C7.91 2.72 8.85 2.78 10.39 2.89C11.93 3 13.96 3.09 16 3.54C18.04 4 20.72 4.74 22.65 5.63C24.59 6.52 26.5 8 27.61 8.89C28.72 9.78 28.89 10.28 29.3 10.98C29.72 11.67 30.09 13.07 30.09 13.07C30.09 13.07 29.37 13.02 28.65 12.67C27.93 12.33 26.39 11.26 25.78 10.98C25.17 10.7 25.22 10.83 25 10.98C24.78 11.13 24.7 11.74 24.48 11.89C24.26 12.04 23.7 11.89 23.7 11.89C23.7 11.89 23.28 12.11 23.17 12.93C23.07 13.76 23.17 15.57 23.04 16.85C22.91 18.13 22.39 20.63 22.39 20.63C22.39 20.63 18.04 21.7 16.52 21.93C15 22.17 14.37 22.11 13.26 22.07C12.15 22.02 10.83 21.85 9.87 21.67C8.91 21.5 7.52 21.02 7.52 21.02C7.52 21.02 8.39 15.46 8.57 13.59C8.74 11.72 8.57 9.8 8.57 9.8L8.04 9.8C8.04 9.8 8.09 12.7 7.91 14.5C7.74 16.3 7 20.63 7 20.63C7 20.63 6.33 20.67 6.09 20.63C5.85 20.59 5.57 20.37 5.57 20.37C5.57 20.37 5.7 19.61 5.57 18.93C5.43 18.26 5.04 17.98 4.78 16.33C4.52 14.67 4.3 10.48 4 9.02C3.7 7.57 3.22 7.83 2.96 7.59C2.7 7.35 2.43 7.59 2.43 7.59C2.43 7.59 3.2 7.85 3.48 9.28C3.76 10.72 3.87 14.5 4.13 16.2C4.39 17.89 4.89 18.8 5.04 19.46C5.2 20.11 5.04 20.11 5.04 20.11C5.04 20.11 4.89 20.37 4.65 20.11C4.41 19.85 4.15 19.98 3.61 18.54C3.07 17.11 1.83 13.07 1.39 11.5C0.96 9.93 1.02 10.07 1 9.15C0.98 8.24 1.26 6.02 1.26 6.02C1.26 6.02 1.93 6.46 3.22 6.67C4.5 6.89 6.96 6.7 8.96 7.33C10.96 7.96 13.74 9.78 15.22 10.46C16.7 11.13 16.87 11.11 17.83 11.37C18.78 11.63 20 11.91 20.96 12.02C21.91 12.13 23.57 12.02 23.57 12.02C23.57 12.02 18.89 11.33 16.39 10.46C13.89 9.59 10.63 7.5 8.57 6.8C6.5 6.11 5.15 6.48 4 6.28C2.85 6.09 1.65 5.63 1.65 5.63C1.65 5.63 2.5 4.39 3.35 3.93C4.2 3.48 5.57 3.07 6.74 2.89Z" />
        <path fill="#EEECF2" d="M25.26 11.5C25.74 11.46 26.96 12.15 26.96 12.15C26.96 12.15 27.24 11.8 26.96 12.67C26.67 13.54 25.74 16.33 25.26 17.37C24.78 18.41 24.33 18.48 24.09 18.93C23.85 19.39 23.98 19.87 23.83 20.11C23.67 20.35 23.17 20.37 23.17 20.37C23.17 20.37 23.54 14.65 23.7 13.33C23.85 12 23.83 12.72 24.09 12.41C24.35 12.11 24.78 11.54 25.26 11.5Z" />
        <path fill="#EEECF2" d="M27.48 12.67L29.83 13.59C29.83 13.59 30.09 13.67 29.83 14.11C29.57 14.54 28.98 15.54 28.26 16.2C27.54 16.85 25.52 18.02 25.52 18.02L27.48 12.67Z" />
        <path fill="#EEECF2" d="M30.35 13.98C30.35 13.98 30.93 14.85 31 15.28C31.07 15.72 31 16.22 30.74 16.59C30.48 16.96 30.07 17.28 29.43 17.5C28.8 17.72 26.96 17.89 26.96 17.89C26.96 17.89 28.61 16.72 29.17 16.07C29.74 15.41 30.35 13.98 30.35 13.98Z" />
        <path fill="#D4A843" d="M4 20.5C4 20.5 6.59 21.57 7.91 21.93C9.24 22.3 10.26 22.63 11.96 22.72C13.65 22.8 16.11 22.78 18.09 22.46C20.07 22.13 23.83 20.76 23.83 20.76L24.22 26.89C24.22 26.89 22.11 27.96 20.7 28.33C19.28 28.7 17.54 29.02 15.74 29.11C13.93 29.2 11.67 29.09 9.87 28.85C8.07 28.61 5.93 27.96 4.91 27.67C3.89 27.39 3.74 27.15 3.74 27.15L4 20.5Z" />
      </svg>
    );
  }
  return <SymboleHodos className="absolute inset-[12%] h-[76%] w-[76%] text-[#D4A843]" />;
}
