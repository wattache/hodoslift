import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import type { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import {
  estPersistee, PEREMPTION_HORS_LIGNE_MS, persisterHorsLigne,
} from '@/lib/persistance-hors-ligne';

/* ⚠️ DEUX FICHIERS POUR UNE SEULE IDÉE, et c'est le Fast Refresh qui l'impose :
 * un module qui exporte un composant ET des constantes perd le rechargement à
 * chaud. La RÈGLE de ce qu'on persiste vit à côté, en `.ts` — ce qui la rend
 * aussi testable sans monter de composant. Ici, le branchement seul. */

export function ProvisionHorsLigne(
  { client, uid, children }: { client: QueryClient; uid: string | null; children: ReactNode },
) {
  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister: persisterHorsLigne,
        maxAge: PEREMPTION_HORS_LIGNE_MS,
        // ⚠️ LE `buster` EST L'IDENTITÉ DE L'UTILISATEUR, et c'est une règle de
        // confidentialité, pas de justesse. Deux personnes partagent parfois un
        // téléphone — un couple, un athlète qui montre l'app à un autre. Sans
        // ce buster, la seconde ouvrirait l'app sur les séances de la première
        // le temps d'un aller-retour réseau. Le cache est JETÉ dès que l'uid
        // change, y compris à la déconnexion (`uid` devient nul).
        buster: uid ?? 'anonyme',
        dehydrateOptions: {
          shouldDehydrateQuery: q =>
            q.state.status === 'success' && estPersistee(q.queryKey),
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
