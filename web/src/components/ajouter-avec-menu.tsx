import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Plus } from 'lucide-react';

import { cn } from '@/lib/utils';

/** UN SEUL BOUTON « + X », QUI OUVRE LE CHOIX : partir de zéro, ou dupliquer.
 *
 *  ⚠️ POURQUOI CE COMPOSANT EXISTE. Le même geste était offert de deux façons
 *  différentes dans l'app. Côté entraînement, « + Bloc » ouvrait un menu où la
 *  duplication d'une BASE figurait à côté de « Bloc vide ». Côté modèles de
 *  bilan, l'entrée s'appelait « + Modèle vide » et la duplication vivait dans
 *  une icône ▢ posée sur CHAQUE ligne du catalogue.
 *
 *  ⚠️ ET LA SECONDE FORME A ÉCHOUÉ POUR DE VRAI, le 25/08. Thomas (kiné) a
 *  cherché à repartir d'un modèle existant, a cliqué « + Modèle vide », n'a rien
 *  vu — et a conclu que la fonctionnalité avait DISPARU. Elle était là, à deux
 *  centimètres. Le commentaire de la spec d'alors soutenait l'inverse (« la
 *  cacher dans un menu suffirait à ce que personne ne l'utilise ») : l'usage a
 *  tranché contre lui, et il faut le dire. Une icône posée sur la ligne d'un
 *  objet répond à « que faire de CET objet ? » ; or on cherche la duplication en
 *  se demandant « comment en créer un ? », c'est-à-dire au bouton de création.
 *
 *  ⚠️ LES SOURCES SE DÉSIGNENT PAR LEUR INDEX, volontairement. Le composant n'a
 *  donc rien à savoir de ce qu'il duplique — une BASE se repère par deux entiers
 *  (macro, bloc), un modèle par un uuid — et l'appelant relit sa propre liste.
 *  Le menu se referme au choix : l'index ne peut pas se périmer entre les deux.
 */
export function AjouterAvecMenu({
  label, sources, titreSources, iconeSource: IconeSource, onChoisir,
  classeDeclencheur, alignement = 'gauche',
}: {
  /** Le nom de ce qu'on crée — « Bloc », « Modèle ». L'option vide en découle. */
  label: string;
  sources: { label: string }[];
  /** L'intitulé de la section — « Dupliquer une base », « Dupliquer un modèle ». */
  titreSources: string;
  iconeSource: ComponentType<{ className?: string }>;
  /** `undefined` = créer vide ; un index = dupliquer `sources[index]`. */
  onChoisir: (index?: number) => void;
  classeDeclencheur: string;
  alignement?: 'gauche' | 'droite';
}) {
  const [ouvert, setOuvert] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ouvert) return;
    const auDocument = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOuvert(false);
    };
    // ⚠️ ÉCHAP FERME, et ce n'est pas de la décoration : le panneau s'annonce
    // `role="menu"`, ce qui promet un comportement au clavier. La version
    // d'origine ne se fermait qu'au clic dehors — on pouvait donc l'ouvrir sans
    // pouvoir en sortir autrement qu'à la souris.
    const auClavier = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOuvert(false);
    };
    document.addEventListener('mousedown', auDocument);
    document.addEventListener('keydown', auClavier);
    return () => {
      document.removeEventListener('mousedown', auDocument);
      document.removeEventListener('keydown', auClavier);
    };
  }, [ouvert]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={ouvert}
        aria-haspopup="menu"
        onClick={() => setOuvert(o => !o)}
        className={classeDeclencheur}
      >
        <Plus className="h-3 w-3" /> {label}
      </button>
      {ouvert && (
        <div
          role="menu"
          className={cn(
            'absolute top-full z-20 mt-1 max-h-64 w-56 overflow-auto rounded-md border border-border bg-card p-1 shadow-[0_18px_48px_rgba(0,0,0,0.28)]',
            alignement === 'droite' ? 'right-0' : 'left-0',
          )}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => { onChoisir(); setOuvert(false); }}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-[12px] text-foreground hover:bg-accent"
          >
            <Plus className="h-3 w-3" /> {label} vide
          </button>
          {sources.length > 0 && (
            <div className="mt-1 border-t border-border/60 px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {titreSources}
            </div>
          )}
          {sources.map((s, index) => (
            <button
              key={`${index}-${s.label}`}
              type="button"
              role="menuitem"
              onClick={() => { onChoisir(index); setOuvert(false); }}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <IconeSource className="h-3 w-3 shrink-0 text-gold/70" />
              <span className="truncate">{s.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
