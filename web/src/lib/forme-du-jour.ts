/** L'ÉCHELLE de la forme du jour. Rien d'autre.
 *
 *  ⚠️ L'ÉCHELLE EST 1-5, ET C'EST LA SEULE CHOSE QUI RESTE ICI. Le calcul, lui,
 *  est parti dans brokkr (FRE-119) : il vivait en TypeScript ET dans l'ETL, donc
 *  en double, et il obligeait trois écrans à télécharger l'arbre d'entraînement
 *  ENTIER (512 Ko sur le programme le plus fourni) pour en tirer trente points.
 *  `useFormeParJour` les sert désormais, déjà datés et ordonnés.
 *
 *  Le piège que portait ce calcul est parti avec lui, dans la requête :
 *  `session_date` n'est renseignée que si la séance a été LANCÉE dans l'app —
 *  mesuré le 17/08 sur la vraie donnée, 446 séances notées la portent et 306
 *  autres ont une forme saisie SANS date de séance. D'où le repli
 *  `coalesce(session_date, week.start_date)`, sans lequel la courbe est vide
 *  pour la plupart des athlètes tout en restant crédible.
 *
 *  ⚠️ CES DEUX BORNES NE SONT PAS DÉCORATIVES. Le composant traçait sur 1-10 et
 *  affichait « /10 » : une forme à 5 — le MAXIMUM — sortait au milieu du graphe
 *  et se lisait comme médiocre. Trois sources concordent : `FormRating` rend
 *  `[1,2,3,4,5]`, la colonne `training_sessions.form_of_the_day` est documentée
 *  « 1 à 5 », et le contrat brokkr impose `Literal[1,2,3,4,5]`.
 */
export const FORME_MIN = 1;
export const FORME_MAX = 5;
