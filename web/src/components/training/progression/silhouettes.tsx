import type { RenduProgression } from '@/api/types';

/** LES SILHOUETTES DES RENDUS (brief progression, réglage revu le 28/09) : un
 *  trait qui monte, trois lignes de texte. Pas des données lisibles — à 26 px
 *  personne ne lit « 62,5 » — mais la forme qu'on reconnaît d'un coup. Le rendu
 *  choisi passe en or, les autres en gris : c'est la couleur du contexte
 *  (`currentColor`), le bouton la pose. */
export function Silhouette({ rendu, className }: { rendu: RenduProgression; className?: string }) {
  return (
    <svg viewBox="0 0 104 40" className={className} aria-hidden fill="none">
      {rendu === 'courbe' ? (
        <>
          <path d="M10 31 L37 25 L66 18 L94 8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          {[[10, 31], [37, 25], [66, 18], [94, 8]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="3.2" fill="currentColor" />)}
        </>
      ) : (
        <>
          <rect x="10" y="8" width="84" height="5" rx="2.5" fill="currentColor" />
          <rect x="10" y="18" width="58" height="5" rx="2.5" fill="currentColor" opacity="0.75" />
          <rect x="10" y="28" width="72" height="5" rx="2.5" fill="currentColor" opacity="0.5" />
        </>
      )}
    </svg>
  );
}
