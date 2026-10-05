/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Le SHA du commit : cache, Sentry, vérification d'après livraison. */
  readonly VITE_GIT_SHA: string;
  /** Le numéro affiché, promu à la main dans `package.json`. */
  readonly VITE_APP_VERSION: string;
}
