import { lireLaFile } from '@/lib/file-hors-ligne';

/** UNE SEULE ORIGINE DE PRODUCTION — FRE-146.
 *
 *  Le site d'hébergement porte TROIS adresses qui servent le même déploiement :
 *  `trainer.french-forge.com`, `french-forge-600.web.app` et
 *  `french-forge-600.firebaseapp.com`. Une seule est déclarée dans les origines
 *  JavaScript du client OAuth, et depuis que le bouton GIS est la voie
 *  principale (18/08) c'est l'origine qui est validée : sur `web.app`, le login
 *  répond `origin_mismatch`. Ceux qui y étaient connectés le restent — jusqu'à la
 *  purge de stockage suivante. Mesuré le 09/09 dans les logs Cloud Run : SEPT
 *  personnes encore sur l'ancienne adresse, dont un coach.
 *
 *  ⚠️ FIREBASE HOSTING NE SAIT PAS REDIRIGER PAR DOMAINE sur un même site, et
 *  les adresses par défaut ne se suppriment pas. La redirection est donc ici,
 *  dans le code.
 *
 *  ⚠️ ET ELLE N'EST PAS AVEUGLE. La file d'écritures hors ligne vit PAR ORIGINE
 *  (IndexedDB) : quelqu'un qu'on éjecte avec une saisie en attente la perd, sans
 *  message et sans trace — la famille de défaut que ce projet a déjà payée. On
 *  ne part que file VIDE ; sinon on la rejoue d'abord (`rejouerLaFile`, dans
 *  `main.tsx`), et on repose la question.
 *
 *  ⚠️ LISTE BLANCHE, PAS LISTE NOIRE. On rapatrie depuis `*.web.app` et
 *  `*.firebaseapp.com`, jamais depuis « tout ce qui n'est pas trainer » :
 *  `localhost`, l'émulateur et les deux harnais e2e sont indemnes par
 *  construction, sans garde à maintenir. */

export const ORIGINE_UNIQUE = 'https://trainer.french-forge.com';

const ANCIENNES = ['.web.app', '.firebaseapp.com'];

export function estUneAncienneAdresse(hostname: string): boolean {
  return ANCIENNES.some(suffixe => hostname.endsWith(suffixe));
}

/** La même page, sur la bonne origine : chemin, paramètres et ancre conservés. */
export function cibleDuRapatriement(loc: { pathname: string; search: string; hash: string }): string {
  return `${ORIGINE_UNIQUE}${loc.pathname}${loc.search}${loc.hash}`;
}

export type Decision = 'rester' | 'partir' | 'attendre';

/** Partir, rester, ou attendre que la file soit partie. PURE : c'est elle que
 *  les specs éprouvent. */
export function decider(hostname: string, ecrituresEnAttente: number): Decision {
  if (!estUneAncienneAdresse(hostname)) return 'rester';
  return ecrituresEnAttente === 0 ? 'partir' : 'attendre';
}

/** Ce qu'il faut faire MAINTENANT, depuis cette fenêtre. */
export async function deciderIci(): Promise<Decision> {
  const file = await lireLaFile();
  return decider(window.location.hostname, file.length);
}

/** Le départ lui-même. Le service worker de l'ancienne origine est désenregistré
 *  d'abord : sinon elle reste « installée » et continue de servir sa coque à la
 *  prochaine ouverture, comme si de rien n'était. `replace` et non `assign` :
 *  un « retour » qui ramènerait sur l'ancienne adresse rejouerait le départ. */
export async function rapatrier(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const inscrits = await navigator.serviceWorker.getRegistrations().catch(() => []);
    await Promise.all(inscrits.map(r => r.unregister().catch(() => false)));
  }
  window.location.replace(cibleDuRapatriement(window.location));
}
