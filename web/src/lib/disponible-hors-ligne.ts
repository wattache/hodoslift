import { useEffect, useState } from 'react';
import { hashKey, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { get } from 'idb-keyval';

import { CLE_DU_CACHE } from '@/lib/persistance-hors-ligne';

/** « CETTE SEMAINE EST SUR LE TÉLÉPHONE » — la question, posée au DISQUE.
 *
 *  ⚠️ ON LIT CE QUI EST ÉCRIT, ON NE DÉDUIT PAS. Il aurait été plus simple de
 *  répondre « la requête a chargé et sa clé figure dans la liste blanche, donc
 *  elle SERA persistée » — mais c'est une promesse sur l'avenir, et l'indicateur
 *  n'aurait rien mesuré. Or c'est exactement le genre d'affirmation qui casse en
 *  silence : le persister est étranglé, il peut échouer (quota, navigation
 *  privée, IndexedDB refusé), et l'écran continuerait d'annoncer une sécurité
 *  qui n'existe pas. À ce moment-là l'athlète est en salle, sans réseau.
 *
 *  Le prix est un aller-retour disque et un `JSON.parse` de la centaine de Ko du
 *  cache. Il n'a lieu qu'à l'ouverture de l'écran et après chaque changement de
 *  donnée, jamais pendant la frappe.
 *
 *  ⚠️ IL FAUT LES QUATRE, ET LE DIRE EN UNE FOIS. Une semaine « sauvegardée »
 *  sans `me` ne s'ouvre pas — le gate arrête l'athlète avant. Sans l'annuaire,
 *  il passe le gate et n'a aucun athlète sélectionné. Répondre « oui » parce
 *  que les séances sont là serait juste sur la donnée et faux sur la promesse. */

/** Le temps qu'on laisse au persister, étranglé à 1 s, pour écrire. */
const DELAI_D_ECRITURE_MS = 1400;

interface CacheSurDisque {
  clientState?: { queries?: { queryHash: string }[] };
}

export async function toutesSurLeDisque(hashs: string[]): Promise<boolean> {
  const brut = await get<string>(CLE_DU_CACHE);
  if (!brut) return false;
  try {
    const cache = JSON.parse(brut) as CacheSurDisque;
    const presentes = new Set((cache.clientState?.queries ?? []).map(q => q.queryHash));
    return hashs.every(h => presentes.has(h));
  } catch {
    // Un cache illisible n'est pas un cache : mieux vaut ne rien promettre.
    return false;
  }
}

/** Ces requêtes sont-elles TOUTES sur le disque ?
 *
 *  ⚠️ ON NE REPASSE JAMAIS À « NON » PENDANT UN RAFRAÎCHISSEMENT. Une donnée
 *  plus fraîche qui arrive ne retire pas l'ancienne du disque : la semaine reste
 *  disponible hors ligne, simplement dans sa version d'avant. Faire clignoter
 *  l'indicateur à chaque refetch reviendrait à annoncer une perte qui n'a pas
 *  lieu — et à apprendre à l'athlète à ne plus le regarder. */
export function useDisponibleHorsLigne(cles: QueryKey[]): boolean {
  const qc = useQueryClient();
  const [surLeDisque, setSurLeDisque] = useState(false);

  // L'empreinte change quand une des requêtes reçoit une donnée neuve — c'est
  // le seul moment où le disque peut changer d'avis.
  const hashs = cles.map(hashKey);
  const empreinte = cles
    .map((c, i) => `${hashs[i]}:${qc.getQueryState(c)?.dataUpdatedAt ?? 0}`)
    .join('|');

  useEffect(() => {
    let vivant = true;
    const verifier = () => {
      void toutesSurLeDisque(empreinte.split('|').map(p => p.split(':')[0]))
        .then(ok => { if (vivant && ok) setSurLeDisque(true); });
    };
    verifier();
    const differe = setTimeout(verifier, DELAI_D_ECRITURE_MS);
    return () => { vivant = false; clearTimeout(differe); };
  }, [empreinte]);

  return surLeDisque;
}
