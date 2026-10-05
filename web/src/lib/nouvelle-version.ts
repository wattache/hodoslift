import { toast } from 'sonner';
import i18n from '@/i18n';
import { signalerDegradation } from '@/lib/observabilite';

/** « Nouvelle version disponible — recharger. »
 *
 *  Le déploiement est instantané côté serveur (HTML en no-store, worker
 *  network-first avec skipWaiting + claim) : un rechargement suffit. Le trou est
 *  HUMAIN — une app qui ne renavigue pas n'apprend jamais qu'elle est vieille, et
 *  personne ne recharge ce qui a l'air de marcher. Ce module le lui dit.
 */
/** Enregistre le service worker, et NE LAISSE PAS la promesse échouer seule.
 *
 *  ⚠️ CE `catch` MANQUAIT, et son absence produisait exactement le pire rapport
 *  possible : une rejection non attrapée, remontée dans Sentry en « Unhandled »
 *  sous le titre `navigator.serviceWorker.register(<anonymous>)`, sans message
 *  ni cause. Impossible d'en tirer quoi que ce soit — ni la fréquence utile, ni
 *  le navigateur, ni la raison. Le garde-fou existait pourtant TROIS LIGNES plus
 *  haut dans `index.html`, sur la branche de développement, et pas sur celle qui
 *  tourne en production.
 *
 *  ⚠️ ET ON NE L'AVALE PAS. L'enregistrement qui échoue n'empêche pas d'utiliser
 *  l'app — mais il emporte `surveillerNouvelleVersion` avec lui : plus de
 *  `controllerchange`, donc plus jamais de « nouvelle version disponible ». La
 *  personne reste sur un bundle périmé sans que rien ne le lui dise, ce qui est
 *  précisément l'incident du 17/08 qu'on venait de fermer. C'est une
 *  DÉGRADATION silencieuse : elle doit se voir.
 *
 *  Causes attendues, aucune n'étant un bug de l'app : stockage de site
 *  partitionné ou désactivé (navigation privée, profil Chrome abîmé — vécu avec
 *  Cédric le 18/08), extension qui bloque les workers, ou `sw.js` momentanément
 *  inaccessible pendant un déploiement.
 */
export function enregistrerLeServiceWorker(): void {
  // ⚠️ PRODUCTION SEULEMENT, et ce n'est pas cosmétique. `index.html` DÉSINSCRIT
  // tout SW résiduel en local (sinon un vieux worker de prod sert des assets
  // périmés pendant le dev, HMR compris). Enregistrer depuis le bundle sans
  // cette garde le réinstallerait aussitôt après la purge — le déménagement
  // aurait cassé le développement en réparant la production.
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch((cause: unknown) => {
    signalerDegradation('service-worker-non-enregistre', cause);
  });
}

/** La version que la production SERT, lue dans le `sw.js` — `null` si on ne sait pas.
 *
 *  `scripts/version-sw.mjs` écrit `eitri-<version>-<horodatage>` dans le nom du
 *  cache à chaque build, et `sw.js` est servi en `no-cache` : c'est déjà la sonde
 *  de `verifier-deploiement.mjs`. Le `sw.js` du développement (`eitri-v1`) ne
 *  correspond pas au motif, et rend `null`. */
async function versionServie(): Promise<string | null> {
  // ⚠️ Sans paramètre anti-cache : le worker met en cache tout GET de même
  // origine, et une URL unique par appel y ajouterait une entrée à chaque fois.
  // `no-store` contourne déjà le cache HTTP.
  const reponse = await fetch('/sw.js', { cache: 'no-store' });
  if (!reponse.ok) return null;
  const trouve = (await reponse.text()).match(/const CACHE_NAME = ['"]eitri-(.+)-\d{10,}['"]/);
  return trouve ? trouve[1] : null;
}

function annoncer(): void {
  toast(i18n.t('maj.disponible'), {
    description: i18n.t('maj.description'),
    action: { label: i18n.t('maj.recharger'), onClick: () => window.location.reload() },
    // Le toast attend qu'on agisse : une mise à jour ratée parce qu'on a
    // cligné des yeux au mauvais moment ne vaudrait rien.
    duration: Infinity,
    // Un seul toast, quel que soit le signal qui l'a déclenché.
    id: 'nouvelle-version',
  });
}

/** Entre deux vérifications d'un onglet qui ne bouge pas. */
const INTERVALLE_MS = 15 * 60_000;

/** ⚠️ ON COMPARE DES VERSIONS, on ne devine plus depuis le cycle de vie du worker.
 *
 *  Deux trous, tous deux propres à l'ORDINATEUR (le téléphone ne connaît ni l'un
 *  ni l'autre, d'où « je le vois sur mon téléphone, pas sur mon poste ») :
 *
 *   - un onglet qui reste VISIBLE n'émet jamais `visibilitychange` — une fenêtre
 *     à part, un second écran — et une SPA ne navigue pas : rien ne faisait
 *     revérifier `sw.js`. D'où l'intervalle, le `focus` et le retour du réseau ;
 *   - une page rechargée de FORCE (Ctrl+Maj+R) n'est plus contrôlée par le
 *     worker. Déduire « première installation » de `controller === null` avalait
 *     alors le remplacement suivant. La version servie, elle, ne ment pas : à la
 *     première installation elle est la nôtre, à un remplacement elle ne l'est plus.
 *
 *  Et la comparaison tient même si le worker n'a pas pu s'enregistrer.
 *
 *  Rend de quoi tout débrancher — les specs s'en servent, l'app jamais. */
export function surveillerNouvelleVersion(): () => void {
  const maVersion = import.meta.env.VITE_GIT_SHA;
  if (!maVersion) return () => {};
  const fin = new AbortController();
  const ecoute = { signal: fin.signal };

  let derniereVerification = 0;
  const verifier = (force = false): void => {
    const maintenant = Date.now();
    if (!force && maintenant - derniereVerification < 60_000) return;
    derniereVerification = maintenant;
    // Réveille aussi le worker : c'est ce qui rend le rechargement instantané.
    navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
    versionServie()
      .then((servie) => { if (servie !== null && servie !== maVersion) annoncer(); })
      .catch(() => { /* hors ligne, ou déploiement en cours : on réessaiera */ });
  };

  // Le signal INSTANTANÉ : avec skipWaiting + claim, le navigateur l'émet à la
  // seconde où un nouveau worker prend la main.
  navigator.serviceWorker?.addEventListener('controllerchange', () => verifier(true), ecoute);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') verifier();
  }, ecoute);
  window.addEventListener('focus', () => verifier(), ecoute);
  window.addEventListener('online', () => verifier(true), ecoute);
  const tic = setInterval(() => { if (document.visibilityState === 'visible') verifier(); }, INTERVALLE_MS);
  return () => { fin.abort(); clearInterval(tic); };
}
