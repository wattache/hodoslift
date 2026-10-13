import { useEffect } from 'react';

/** Garde l'écran allumé tant que `actif` (Screen Wake Lock).
 *
 *  ⚠️ LE SYSTÈME RELÂCHE LE VERROU dès que la page passe en arrière-plan (autre
 *  app, téléphone verrouillé) : on le redemande au retour, tant qu'il est voulu.
 *  ⚠️ UN NAVIGATEUR SANS L'API, OU QUI REFUSE (économie d'énergie, app iOS
 *  d'écran d'accueil avant 18.4), NE CASSE RIEN : l'écran se met en veille comme
 *  avant, sans message. */
export function useEcranAllume(actif: boolean): void {
  useEffect(() => {
    const api = typeof navigator !== 'undefined' ? navigator.wakeLock : undefined;
    if (!actif || !api) return;
    let verrou: WakeLockSentinel | null = null;
    let fini = false;
    const demander = () => {
      if (fini || document.visibilityState !== 'visible' || (verrou && !verrou.released)) return;
      api.request('screen').then(v => {
        if (fini) void v.release();
        else verrou = v;
      }, () => { /* refusé : l'écran se mettra en veille, rien d'autre */ });
    };
    demander();
    document.addEventListener('visibilitychange', demander);
    return () => {
      fini = true;
      document.removeEventListener('visibilitychange', demander);
      void verrou?.release().catch(() => {});
    };
  }, [actif]);
}
