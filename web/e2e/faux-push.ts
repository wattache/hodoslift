import type { Page } from '@playwright/test';

/** UN NAVIGATEUR QUI SAIT FAIRE DU PUSH — sans service de push.
 *
 *  ⚠️ POURQUOI UN FAUX. En local, aucun service worker n'est enregistré
 *  (`index.html` désinscrit tout worker résiduel), et Chromium sans compte
 *  Google n'a pas de service de push : `pushManager.subscribe` lèverait. Ce
 *  qu'on éprouve ici est la LOGIQUE de l'écran et l'aller-retour avec brokkr —
 *  l'abonnement lui-même est le travail du navigateur, pas le nôtre. Le faux
 *  imite l'API exactement : `getRegistration`, `pushManager.getSubscription`,
 *  `subscribe`, `unsubscribe`, `toJSON`, et `Notification.requestPermission`. */
export async function fauxPush(page: Page, options: { permission?: NotificationPermission; endpoint?: string } = {}) {
  await page.addInitScript(({ permission, endpoint }) => {
    let abonnement: { endpoint: string; unsubscribe: () => Promise<boolean>; toJSON: () => unknown } | null = null;
    const pushManager = {
      getSubscription: async () => abonnement,
      subscribe: async () => {
        abonnement = {
          endpoint,
          unsubscribe: async () => { abonnement = null; return true; },
          toJSON: () => ({ endpoint, keys: { p256dh: 'p256dh-de-test', auth: 'auth-de-test' } }),
        };
        return abonnement;
      },
    };
    const registration = { pushManager };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      // Ce que l'app touche au démarrage aussi (`nouvelle-version.ts` écoute
      // `controllerchange`) : sans ces méthodes, l'écran ne se monte pas.
      value: {
        getRegistration: async () => registration, ready: Promise.resolve(registration), register: async () => registration,
        controller: null, addEventListener: () => {}, removeEventListener: () => {},
      },
    });
    class FausseNotification {
      static permission: NotificationPermission = permission;
      static async requestPermission() { FausseNotification.permission = permission === 'denied' ? 'denied' : 'granted'; return FausseNotification.permission; }
    }
    Object.defineProperty(window, 'Notification', { configurable: true, value: FausseNotification });
    Object.defineProperty(window, 'PushManager', { configurable: true, value: function PushManager() {} });
  }, { permission: options.permission ?? 'default', endpoint: options.endpoint ?? 'https://push.example.test/abonnement/e2e' });
}
