import { useEffect, useState } from 'react';
import { useRouteError } from 'react-router-dom';
import { rapporterPlantage, signalerDegradation } from '@/lib/observabilite';
import { estUnModulePerime, peutRecharger, recharger } from '@/lib/module-perime';
import { EcranDErreur } from './error-boundary';

/** Ce que montre le routeur quand un écran plante.
 *
 *  ⚠️ LE ROUTEUR ATTRAPE LES ERREURS DE SES ÉCRANS AVANT `ErrorBoundary`, qui
 *  l'entoure : sans cet élément, elles finissent sur la page par défaut de
 *  React Router, et n'arrivent jamais à Sentry.
 *
 *  Un écran d'une version périmée recharge l'app une fois, sans rien montrer :
 *  c'est une livraison, pas une panne. */
export function ErreurDeRoute() {
  const erreur = useRouteError();
  const [rechargement] = useState(() => estUnModulePerime(erreur) && peutRecharger());

  useEffect(() => {
    const cause = erreur instanceof Error ? erreur : new Error(String(erreur));
    if (rechargement) {
      signalerDegradation('module-perime', cause);
      recharger();
    } else {
      console.error('Route crash:', erreur);
      rapporterPlantage(cause, 'route');
    }
  }, [erreur, rechargement]);

  if (rechargement) return null;
  return <EcranDErreur erreur={erreur} />;
}
