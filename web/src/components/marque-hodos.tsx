/** LE SYMBOLE, EN LIGNE — les quatre barres du bloc.
 *
 *  ⚠️ EN LIGNE ET PAS EN `<img>`, ET C'EST LE POINT. Le symbole doit hériter de
 *  la couleur du texte : la barre latérale a un thème CLAIR autant que sombre,
 *  et un fichier à couleurs figées y serait juste dans l'un des deux. Un `<img>`
 *  ne voit pas `currentColor`.
 *
 *  ⚠️ ET LES QUATRE BARRES SONT LES QUATRE NATURES DE BLOC — accumulation,
 *  intensification, réalisation, décharge. L'opacité descendante n'est pas un
 *  effet : c'est la charge qui monte puis retombe. La quatrième, la plus pâle,
 *  est la décharge ; elle ne se supprime pas pour « simplifier », sinon le
 *  symbole ne raconte plus un cycle.
 *
 *  Le fichier `public/marque/symbole-mono.svg` porte le même tracé pour les
 *  usages hors React (page d'accueil, partage, courrier). Les deux doivent
 *  bouger ensemble.
 */
export function SymboleHodos({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="currentColor"
         role="img" aria-label="HodosLift">
      <title>HodosLift</title>
      <rect x="2" y="21" width="5.5" height="9" fillOpacity={0.38} />
      <rect x="9.5" y="15" width="5.5" height="15" fillOpacity={0.66} />
      <rect x="17" y="7" width="5.5" height="23" />
      <rect x="24.5" y="19" width="5.5" height="11" fillOpacity={0.28} />
    </svg>
  );
}

/** LE NOM, « Lift » en or : le reste suit la couleur du texte qui l'entoure. */
export function NomHodosLift() {
  return <>Hodos<span className="text-gold">Lift</span></>;
}
