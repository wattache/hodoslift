import * as Sentry from '@sentry/react';

/** Envoi des incidents du NAVIGATEUR à Sentry — et ce qui n'y part pas.
 *
 *  ⚠️ C'EST ICI QUE SE TROUVAIT LE VRAI ANGLE MORT. Côté serveur, Cloud Logging
 *  voyait déjà tout ; côté navigateur, un plantage de rendu finissait dans une
 *  `console.error` que personne ne lit jamais. Un coach en pleine séance
 *  rechargeait, et on ne l'apprenait pas.
 *
 *  ⚠️ L'EXTRAIT D'ONBOARDING DE SENTRY LAISSE LA COLLECTE OUVERTE — `userInfo` et
 *  `httpBodies` sont actifs par défaut. Ne pas le recopier : cette application
 *  manipule des données d'athlètes réels. Les deux sont fermés explicitement
 *  ci-dessous, écrits plutôt qu'omis, pour qu'on voie la décision.
 *
 *  L'organisation est hébergée dans l'UE (`ingest.de.sentry.io`), ce qui règle le
 *  transfert hors UE — pas l'hébergement de données de santé, Sentry n'étant pas
 *  certifié HDS. La règle reste donc : rien de sensible n'y arrive. */

/** Les segments de chemin qui désignent une personne.
 *
 *  ⚠️ REMPLACÉS PAR UN JETON STABLE, jamais par une valeur aléatoire. Sentry
 *  regroupe les événements par leur texte : si chaque athlète produisait son
 *  propre identifiant, une panne unique ressemblerait à cinquante-huit erreurs
 *  distinctes, et aucun seuil d'alerte ne se déclencherait. */
const SEGMENT_IDENTIFIANT = /\/(athletes|programs|competitions|events)\/[A-Za-z0-9_-]{6,}/g;

function masquer(texte: string): string {
  return texte
    .replace(SEGMENT_IDENTIFIANT, '/$1/{id}')
    // Les messages d'erreur de brokkr mettent la valeur fautive entre
    // guillemets — un nom de mouvement, une catégorie de poids. Utile pour
    // déboguer en local, hors sujet chez un tiers.
    .replace(/«[^»]*»/g, '«…»');
}

export function installerObservabilite(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;

  // ⚠️ `PROD` AUTANT QUE LE DSN, et le second ne suffit pas ici. `.env.local`
  // porte les valeurs de PRODUCTION — c'est ce qui permet de travailler sur les
  // vraies données en local. Se contenter du DSN ferait donc remonter chaque
  // erreur de développement dans le flux de production, et brûlerait le quota en
  // bruit. Côté brokkr le problème ne se pose pas : le DSN n'y est posé qu'au
  // déploiement.
  if (!dsn || !import.meta.env.PROD) return;

  Sentry.init({
    dsn,
    environment: 'production',
    // ⚠️ SANS `release`, SENTRY NE SAIT PAS SITUER UNE ERREUR DANS LE TEMPS —
    // ni « ça a commencé au déploiement de mardi », ni la régression d'une
    // erreur close qui réapparaît. C'est la même lacune que brokkr portait
    // jusqu'au 20/08, et la valeur vient de la même source : le SHA du commit.
    // C'est aussi ce nom qui indexe les source maps téléversées au build : les
    // deux DOIVENT coïncider (cf. vite.config.ts).
    release: import.meta.env.VITE_GIT_SHA,
    // Ni identité, ni corps de requête — voir l'en-tête.
    sendDefaultPii: false,
    // Échantillonné : les erreurs sont rares, les requêtes réussies sont tout le
    // trafic, et c'est le tracing qui consomme le quota.
    tracesSampleRate: 0.1,
    beforeSend(evenement) {
      if (evenement.message) evenement.message = masquer(evenement.message);
      for (const valeur of evenement.exception?.values ?? []) {
        if (valeur.value) valeur.value = masquer(valeur.value);
      }
      if (evenement.request?.url) evenement.request.url = masquer(evenement.request.url);
      return evenement;
    },
    // ⚠️ LE PIÈGE DISCRET : les fils d'Ariane rejouent les requêtes qui ont
    // précédé l'incident, donc les URL et leurs identifiants. Masquer le seul
    // message laisserait passer les mêmes valeurs une ligne plus bas.
    beforeBreadcrumb(miette) {
      if (miette.message) miette.message = masquer(miette.message);
      if (typeof miette.data?.url === 'string') miette.data.url = masquer(miette.data.url);
      return miette;
    },
  });
}

/** Rapporte une erreur de rendu attrapée par `ErrorBoundary`.
 *
 *  Sans DSN ou hors production, ne fait rien — la `console.error` de
 *  l'`ErrorBoundary` reste, elle, utile en développement. */
export function rapporterPlantage(erreur: Error, info: unknown): void {
  Sentry.captureException(erreur, { extra: { info: String(info).slice(0, 2000) } });
}

/** Signale une DÉGRADATION, pas un plantage : l'app continue de fonctionner,
 *  mais quelque chose ne rend plus le service attendu.
 *
 *  ⚠️ POURQUOI PAS UN SIMPLE `console.warn`. On ne verra jamais la console d'un
 *  athlète au vestiaire. Et pourquoi pas laisser la promesse échouer : une
 *  rejection non attrapée arrive dans Sentry en « Unhandled », sans message ni
 *  contexte — un titre `<anonymous>` qu'on ne peut ni diagnostiquer ni fermer.
 *  Attraper et signaler transforme la même information en quelque chose de
 *  lisible, sans faire croire à une panne. */
export function signalerDegradation(quoi: string, cause: unknown): void {
  Sentry.captureException(cause instanceof Error ? cause : new Error(String(cause)), {
    level: 'warning',
    tags: { degradation: quoi },
  });
}

export { masquer as _masquerPourTest };
