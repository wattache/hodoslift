import { useEffect, useState } from 'react';

import { api } from '@/api/client';
import type { BasePreview, BlockBase, Week } from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';

const isMock = !isFirebaseConfigured;

/** L'APERÇU DE LA SEMAINE QUE LA BASE PRODUIRAIT (FRE-29, déplacé le 26/08).
 *
 *  ⚠️ POURQUOI CE N'EST PLUS UN CALCUL LOCAL. Il l'était — 239 lignes de
 *  TypeScript — et la génération réelle est passée côté serveur. Garder l'aperçu
 *  ici aurait laissé LA MÊME RÈGLE ÉCRITE EN DEUX LANGUES : invisible jusqu'au
 *  jour où l'aperçu et la génération ne diraient plus la même chose, c'est-à-dire
 *  exactement quand ça compte. Le serveur répond aux deux, et une spec brokkr
 *  vérifie qu'ils s'accordent.
 *
 *  ⚠️ PAS `useQuery`, ET C'EST DÉLIBÉRÉ. Ce qu'on interroge n'est pas une
 *  ressource : c'est un BROUILLON en cours de frappe, qui n'a ni identité ni
 *  cache à peupler. Une clé de requête construite sur son contenu créerait une
 *  entrée de cache par frappe — un cache qui grossit et ne resert jamais.
 *
 *  ⚠️ ET LE DERNIER MOT EST AU DERNIER APPEL. Deux aperçus peuvent être en vol :
 *  sans le drapeau `perime`, une réponse lente arrivée après une plus récente
 *  repeindrait l'écran avec un état ancien — le coach verrait sa modification
 *  s'annuler toute seule. */
export function useApercuSemaine(base: BlockBase, blockId: string, programId: string | null | undefined) {
  const [semaine, setSemaine] = useState<Week | null>(null);

  useEffect(() => {
    // En maquette il n'y a personne à qui demander, et on ne resimule pas : ce
    // serait réécrire ce qu'on vient de retirer.
    if (isMock || !programId) return;

    let perime = false;
    // Le même délai que les écritures de l'éditeur : une rafale de clics sur la
    // grille ne produit qu'un aperçu.
    const timer = setTimeout(() => {
      api.post<Week, BasePreview>(`/programs/${programId}/blocks/${blockId}/base/preview-week`, { base })
        .then(res => { if (!perime) setSemaine(res); })
        // ⚠️ SILENCIEUX, ET C'EST LE SEUL ENDROIT OÙ JE L'ACCEPTE : un aperçu
        // est une aide à la composition, pas une écriture. Un toast à chaque
        // frappe pendant une coupure réseau serait pire que l'aperçu figé.
        .catch(() => {});
    }, 400);

    return () => { perime = true; clearTimeout(timer); };
  }, [base, blockId, programId]);

  return semaine;
}
