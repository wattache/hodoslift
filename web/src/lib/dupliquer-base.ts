import type { BaseAccessory, Principle } from '@/api/types';

/** DUPLIQUER UNE LIGNE DE LA BASE — la copie se place juste après l'originale.
 *
 *  Elle porte toute la prescription : un objet recopié, pas une liste de champs
 *  à tenir — un champ ajouté demain suit seul. `id: ''` comme toute ligne neuve
 *  de trame : la BASE s'écrit en entier, une identité de ligne n'y désigne rien. */
export function dupliquerPrincipe(principes: Principle[], index: number): Principle[] {
  const source = principes[index];
  if (!source) return principes;
  return [...principes.slice(0, index + 1), { ...source, id: '' }, ...principes.slice(index + 1)];
}

/** ⚠️ UN ACCESSOIRE COPIÉ SORT DE SON GROUPE : copié dans un bi-set, il en ferait
 *  un tri-set sans qu'on l'ait demandé. Et il se place APRÈS LE GROUPE entier,
 *  pas au milieu — sinon il couperait le bi-set en deux à l'écran. */
export function dupliquerAccessoire(accessoires: BaseAccessory[], index: number): BaseAccessory[] {
  const source = accessoires[index];
  if (!source) return accessoires;
  const groupe = (source.groupId || '').trim();
  let apres = index;
  if (groupe) while (apres + 1 < accessoires.length && (accessoires[apres + 1].groupId || '').trim() === groupe) apres++;
  const copie: BaseAccessory = { ...source, id: '', groupId: '', groupKind: null, unbroken: false };
  return [...accessoires.slice(0, apres + 1), copie, ...accessoires.slice(apres + 1)];
}
