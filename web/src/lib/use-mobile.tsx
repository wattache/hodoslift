import * as React from "react";

const MOBILE_BREAKPOINT = 768;

/** Une requête média, observée. Rend `true` tant qu'elle est satisfaite.
 *
 *  ⚠️ POURQUOI CE HOOK EXISTE À CÔTÉ DES CLASSES `sm:` / `lg:`. Tailwind suffit
 *  quand il s'agit de MONTRER OU CACHER ; il ne suffit plus quand il faut ne PAS
 *  RENDRE. Un nœud caché en CSS reste dans le DOM : il y duplique son texte, un
 *  lecteur d'écran le lit, et `getByText(...).first()` tombe dessus — ce qui a
 *  fait rougir deux specs le jour où le fil d'Ariane de l'arbre a répété le
 *  chemin déjà écrit dans le rail.
 *
 *  ⚠️ LA VALEUR EST LUE DÈS L'INITIALISATION, pas dans un effet. Partir de
 *  `false` puis corriger au premier effet fait rendre la version téléphone
 *  l'espace d'une image sur un écran large — visible, et pire, ça change le DOM
 *  juste après le premier rendu.
 */
export function useMediaQuery(query: string): boolean {
  const [correspond, setCorrespond] = React.useState(
    // `?.` : jsdom n'a pas `matchMedia`. Sans lui, on rend la version large.
    () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches,
  );

  React.useEffect(() => {
    if (!window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setCorrespond(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return correspond;
}

/** Le seuil « téléphone » historique (768 px). Une seule définition : ce hook
 *  n'est plus qu'un cas particulier de `useMediaQuery`. */
export function useIsMobile() {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
}
