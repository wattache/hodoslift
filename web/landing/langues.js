/** Langues qu'un coach peut déclarer sur sa page publique (FRE-30).
 *
 *  SOURCE UNIQUE, lue par trois consommateurs :
 *    - l'app (menu déroulant de « Ma page publique »), via un import Vite ;
 *    - `build-coachs.mjs`, qui inline cette table dans les pages générées ;
 *    - les pages elles-mêmes, au runtime, pour rendre les codes reçus de l'API.
 *  D'où un module ESM sans dépendance : importable par Vite comme par Node.
 *
 *  ON STOCKE LE CODE, PAS LE LIBELLÉ. `langues: ['fr','pl']` en base ; le nom et
 *  le drapeau sont de l'affichage. Renommer « Anglais » en « English » ou changer
 *  un drapeau ne doit jamais demander de migration.
 *
 *  ⚠️ Le drapeau est une CONVENTION, pas une vérité : une langue n'est pas un
 *  pays. 🇬🇧 pour l'anglais et 🇪🇸 pour l'espagnol sont les usages européens ;
 *  ils seraient discutables ailleurs. Choix assumé (William, 2026-08-13) parce
 *  que le repère visuel vaut mieux qu'une liste de mots sur une page vitrine.
 *
 *  Codes ISO 639-1, en minuscules. Ajouter une langue = une ligne ici, rien
 *  d'autre : brokkr ne contraint pas le vocabulaire, justement pour qu'une
 *  langue de plus ne demande pas un déploiement du backend.
 */
export const LANGUES = [
  { code: 'fr', nom: 'Français', drapeau: '🇫🇷' },
  { code: 'en', nom: 'Anglais', drapeau: '🇬🇧' },
  { code: 'es', nom: 'Espagnol', drapeau: '🇪🇸' },
  { code: 'de', nom: 'Allemand', drapeau: '🇩🇪' },
  { code: 'it', nom: 'Italien', drapeau: '🇮🇹' },
  { code: 'pt', nom: 'Portugais', drapeau: '🇵🇹' },
  { code: 'nl', nom: 'Néerlandais', drapeau: '🇳🇱' },
  { code: 'pl', nom: 'Polonais', drapeau: '🇵🇱' },
  { code: 'ru', nom: 'Russe', drapeau: '🇷🇺' },
  { code: 'uk', nom: 'Ukrainien', drapeau: '🇺🇦' },
  { code: 'ar', nom: 'Arabe', drapeau: '🇸🇦' },
  { code: 'tr', nom: 'Turc', drapeau: '🇹🇷' },
];

/** Code → { nom, drapeau }. Un code inconnu ressort tel quel plutôt que d'être
 *  avalé : si la base contient une valeur qu'on ne connaît pas, on veut la voir. */
export function langue(code) {
  return LANGUES.find(l => l.code === code) ?? { code, nom: code, drapeau: '' };
}
