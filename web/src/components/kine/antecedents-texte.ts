/** Les antécédents, côté TEXTE — découpage et recomposition.
 *
 *  ⚠️ HORS DU FICHIER DE COMPOSANT, ET C'EST LA RÈGLE DU PROJET. Un module qui
 *  exporte à la fois des composants et des fonctions casse le rafraîchissement à
 *  chaud de Vite (`react-refresh/only-export-components`) : à chaque édition,
 *  c'est la page entière qui se recharge au lieu du seul composant — et l'état
 *  de saisie en cours part avec.
 */

export function decouper(texte: string | null | undefined): string[] {
  return (texte ?? '').split('\n').map(l => l.trim()).filter(Boolean);
}

export function rejoindre(lignes: string[]): string | null {
  const propres = lignes.map(l => l.trim()).filter(Boolean);
  // `null` et non `''` : « aucun antécédent connu » est une absence, et c'est ce
  // que la colonne exprime en NULL. Écrire `''` créerait un troisième état.
  return propres.length ? propres.join('\n') : null;
}

/** ⚠️ LECTURE ET ÉDITION SONT DEUX COMPOSANTS, ET PAS UN `if` AU MILIEU D'UN SEUL.
 *  L'édition tient un état local (les champs vides ajoutés), donc un hook — et un
 *  hook placé APRÈS un `return` anticipé n'est plus appelé au même rang selon le
 *  mode, ce que React interdit. La règle a d'ailleurs refusé la première version.
 *
 *  Séparer coûte quelques lignes et rend la faute impossible plutôt que
 *  surveillée. */
