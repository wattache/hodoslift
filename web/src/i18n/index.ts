import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import fr from './locales/fr.json';
import en from './locales/en.json';

/**
 * Internationalisation de l'INTERFACE. Le français reste la langue de référence :
 * c'est lui qu'on écrit dans le code, et les autres locales s'y comparent.
 *
 * Pourquoi : un athlète polonais a vu l'app planter (« Failed to execute
 * removeChild »). Cause — la traduction automatique de Chrome remplace les
 * nœuds de texte par ses propres éléments, et React ne retrouve plus les siens
 * au moment de les retirer. Offrir l'anglais évite le déclenchement de cette
 * traduction pour qui ne lit pas le français.
 *
 * ⚠️ LE POLONAIS A ÉTÉ RETIRÉ le 03/09/2026 — « c'était trop ambitieux »
 * (William). Il avait été ajouté pour cet incident, mais c'est L'ANGLAIS qui
 * porte la parade : il suffit d'offrir UNE langue que l'utilisateur lit pour que
 * Chrome ne propose plus de traduire. Deux dictionnaires au lieu de trois, et
 * plus de troisième colonne à remplir à chaque libellé.
 *
 * ⚠️ À NE PAS CONFONDRE avec les langues PARLÉES par un coach, sur sa page
 * publique : elles ont leur propre liste (`landing/langues.js`) et le polonais y
 * reste. Un coach qui parle polonais continue de le déclarer.
 *
 * PÉRIMÈTRE : uniquement les textes de l'app. Les DONNÉES restent dans leur
 * langue d'origine — noms de blocs et de séances saisis par le coach, notes,
 * retours d'athlète. Les référentiels (exercices, variantes, motifs de no-rep)
 * sont traduisibles mais vivent en base : ça se fera côté brokkr, séparément.
 *
 * ⚠️ Les noms d'exercices servent de CLÉS (`ex.name === 'MUSCLE UP'` dans les
 * sélecteurs de records). Ne jamais traduire une valeur qui sert à comparer :
 * la traduction est un libellé d'affichage, la donnée reste la clé.
 */

export const LANGUAGES = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' },
] as const;

export const LANGUAGE_STORAGE_KEY = 'ff-language';

void i18next
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      fr: { translation: fr },
      en: { translation: en },
    },
    fallbackLng: 'fr',
    supportedLngs: LANGUAGES.map(l => l.code),
    // `fr-CA` doit retomber sur `fr`, pas sur le repli.
    load: 'languageOnly',
    detection: {
      // Le choix explicite de l'utilisateur prime sur la langue du navigateur.
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: {
      // React échappe déjà : ré-échapper produirait des &#39; à l'écran.
      escapeValue: false,
    },
  });

export default i18next;
