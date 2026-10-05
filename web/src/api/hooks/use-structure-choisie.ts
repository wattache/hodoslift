import { useEffect } from 'react';
import { useMe } from '@/api/hooks/use-me';
import { choisirStructure, structureCourante, useSlugRetenu, type StructureDeMoi } from '@/lib/structure';

/** Où l'on est, et où l'on peut aller — FRE-13.
 *
 *  ⚠️ LE CHOIX PAR DÉFAUT EST RETENU AUSSITÔT. Au premier lancement, rien n'est
 *  stocké : `structureCourante` tranche (Nico → SCAPPULIFT, là où il coache).
 *  Sans l'écrire, l'ouverture de la FOIS SUIVANTE — lue par `index.html`, avant
 *  le bundle — ne saurait pas laquelle jouer. */
export function useStructure(): {
  courante: StructureDeMoi | null;
  structures: readonly StructureDeMoi[];
  choisir: (slug: string) => void;
} {
  const { data: me } = useMe();
  const retenue = useSlugRetenu();
  const structures = me?.structures ?? [];
  const courante = structureCourante(structures, retenue);

  useEffect(() => {
    if (courante && courante.slug !== retenue) choisirStructure(courante.slug);
  }, [courante, retenue]);

  return { courante, structures, choisir: choisirStructure };
}

/** Le slug à passer aux listes bornées (`?structure=`), et s'il est CONNU.
 *
 *  ⚠️ `pret` EST CE QUI FAIT ATTENDRE LES LISTES. Tant que le profil n'est pas
 *  là, le slug vaut `null` — et une liste partie à ce moment arrivait SANS
 *  filtre, puis était remplacée par celle de la structure : l'écran changeait
 *  d'athlète sous les pieds de l'utilisateur. Sous charge, `e2e/kine` le voyait
 *  une fois sur trois (18/09). Un profil sans structures (serveur d'avant
 *  FRE-13) est prêt quand même : il ne filtre rien, comme avant. */
export function useSlugCourant(): { slug: string | null; pret: boolean } {
  const { data: me } = useMe();
  const { courante } = useStructure();
  return { slug: courante?.slug ?? null, pret: me !== undefined };
}
