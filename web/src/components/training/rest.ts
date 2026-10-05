/** Un repos « Libre » : le coach n'a pas fixé de durée, l'athlète gère et peut
 *  saisir son repos réel.
 *
 *  ⚠️ UNE SEULE ÉCRITURE : le champ VIDE (FRE-169). Historiquement « -1 » ou
 *  « Free » quand le coach effaçait le champ, et le front seul le savait — la
 *  base prenait `-1` pour un repos de moins une seconde et moyennait dessus.
 *  Depuis la migration du 12/09, brokkr rend NULL sur ces deux formes à
 *  l'écriture et le CHECK `rest_sans_sentinelle` refuse le négatif : aucune ne
 *  peut plus arriver ici, et les tolérer encore serait garder deux définitions.
 *  Un repos vide n'en expose pas moins la saisie du repos réel (bug d'origine :
 *  la case n'apparaissait pas). */
export function isFreeRest(rest?: string | null): boolean {
  return (rest ?? "").trim() === "";
}
