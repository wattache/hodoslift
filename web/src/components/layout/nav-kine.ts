import { BookOpen, BookText, ClipboardList, Globe, HeartPulse, Inbox, Shield, Trophy } from 'lucide-react';
import type { ComponentType } from 'react';

import type { Me } from '@/api/types';

/** LA COMPOSITION DES SECTIONS DE NAVIGATION, sortie du composant pour être
 *  TESTABLE.
 *
 *  ⚠️ POURQUOI CE FICHIER EXISTE. La section « Kiné » réunit deux entrées qui
 *  n'ont pas le même public : les signalements se lisent par le coach ET la
 *  kiné, les modèles de bilan par la kiné seule. Réunies sous un titre commun
 *  (25/08), rien n'empêchait plus de les aligner par mégarde sur la garde la
 *  plus stricte — ce qui retirerait les signalements aux coachs sans qu'aucun
 *  test ne le dise.
 *
 *  ⚠️ ET LE HARNAIS NE PEUT PAS LE VOIR. Le dev-mock n'a qu'UN utilisateur, qui
 *  est coach ET kiné : le cas « coach sans être kiné » — c'est-à-dire tous les
 *  coachs du club sauf un — n'y est jouable par aucune spec e2e. C'est
 *  exactement le trou que décrit FRE-93 (aucun test de composant), et une
 *  fonction pure est ce qui permet de le combler sans attendre.
 */

export interface EntreeNav {
  to: string;
  labelKey: string;
  icon: ComponentType<{ className?: string }>;
  accent: { icon: string; active: string; dot: string };
}

/** Accents par vue — l'or pour le « moi », le vert pour le travail, le bleu pour
 *  le temps, le rouge pour la compétition (hérité du v2). */
export const ACCENTS = {
  gold: { icon: 'text-gold', active: 'bg-gold/10 ring-gold/25 shadow-[inset_3px_0_0_var(--gold)]', dot: 'bg-gold' },
  green: { icon: 'text-success', active: 'bg-success/10 ring-success/20 shadow-[inset_3px_0_0_var(--success)]', dot: 'bg-success' },
  blue: { icon: 'text-block-accumulation', active: 'bg-block-accumulation/10 ring-block-accumulation/20 shadow-[inset_3px_0_0_var(--block-accumulation)]', dot: 'bg-block-accumulation' },
  red: { icon: 'text-block-realisation', active: 'bg-block-realisation/10 ring-block-realisation/20 shadow-[inset_3px_0_0_var(--block-realisation)]', dot: 'bg-block-realisation' },
  gray: { icon: 'text-block-deload', active: 'bg-block-deload/10 ring-block-deload/25 shadow-[inset_3px_0_0_var(--block-deload)]', dot: 'bg-block-deload' },
} as const;

// FRE-68 : le scopé-athlète (dashboard, prog, tracker, calendrier) a déménagé
// dans les ONGLETS de l'espace athlète — la sidebar ne garde que ce qui ne
// dépend pas de l'athlète regardé.
export const NAV_PRINCIPALE: EntreeNav[] = [
  { to: '/competitions', labelKey: 'nav.competitions', icon: Trophy, accent: ACCENTS.red },
  // ⚠️ HORS DE L'ESPACE ATHLÈTE, ET C'EST TOUT LE SUJET. La documentation du
  // suivi vivait dans l'onglet Tracker, donc sous un athlète : elle décrit le
  // PRODUIT, pas la personne qu'on regarde, et s'y trouvait dupliquée autant de
  // fois qu'il y a d'athlètes (William, 11/09). Une règle de calcul n'appartient
  // à personne.
  { to: '/documentation', labelKey: 'nav.documentation', icon: BookText, accent: ACCENTS.gray },
];

const BIBLIOTHEQUE: EntreeNav =
  { to: '/library', labelKey: 'nav.library', icon: BookOpen, accent: ACCENTS.green };

export const NAV_COACH: EntreeNav[] = [
  // LE GUICHET (12/09) — l'écran d'accueil du coach : la file de travail qui se
  // vide. En tête, parce que c'est là qu'on arrive et qu'on revient.
  { to: '/guichet', labelKey: 'nav.guichet', icon: Inbox, accent: ACCENTS.gold },
  BIBLIOTHEQUE,
  { to: '/ma-page', labelKey: 'nav.myPublicPage', icon: Globe, accent: ACCENTS.gold },
];

/** ⚠️ L'ADMIN N'EST PLUS DANS LA SECTION COACH (FRE-13). Il y vivait parce que
 *  l'admin était aussi coach — vrai tant qu'il n'y avait qu'une structure. Chez
 *  French Forge, William n'est plus qu'athlète (il coache chez ElGustoLift) :
 *  la section Coach disparaissait, et l'entrée Admin avec elle, alors que
 *  l'admin est de la PLATEFORME. Sa propre section, sous `isAdmin`, partout. */
const ADMIN: EntreeNav =
  { to: '/admin', labelKey: 'nav.admin', icon: Shield, accent: ACCENTS.gray };

/** La section de l'admin — et, là où il ne coache pas, la BIBLIOTHÈQUE (19/09) :
 *  brokkr le laisse entretenir celle de la structure qu'il regarde
 *  (`structure_ecrite`), et l'entrée vivait sous la section Coach, absente pour
 *  William chez French Forge. Vide pour qui n'est pas admin. */
export function sectionAdmin(me: Me | undefined): EntreeNav[] {
  if (!me?.isAdmin) return [];
  return me.isCoach ? [ADMIN] : [ADMIN, BIBLIOTHEQUE];
}

/** Le tableau « qui va mal en ce moment » — lu par le STAFF ENTIER. */
const SIGNALEMENTS: EntreeNav =
  { to: '/signalements', labelKey: 'nav.signalements', icon: HeartPulse, accent: ACCENTS.gold };

/** ⚠️ LA KINÉ SEULE. Composer un modèle de bilan est un acte de praticien : le
 *  serveur le refuse au coach (`require_kine`), et la règle d'affordance du
 *  projet veut qu'on ne propose pas un écran dont toutes les écritures seraient
 *  refusées. */
const MODELES: EntreeNav =
  { to: '/bilan-modeles', labelKey: 'nav.bilanModeles', icon: ClipboardList, accent: ACCENTS.green };

/** La section « Kiné » telle que CE compte la voit.
 *
 *  Un seul titre depuis le 25/08, à la place de « Staff » et « Suivi kiné » :
 *  deux intitulés pour un même domaine se lisaient comme deux sujets. Mais c'est
 *  la SECTION qui fusionne, pas les autorisations — chaque entrée garde la
 *  sienne.
 *
 *  Rend un tableau VIDE quand rien n'est atteignable : l'appelant n'affiche
 *  alors aucun titre, plutôt qu'une section creuse. */
export function sectionKine(me: Me | undefined): EntreeNav[] {
  return [
    ...(me?.isCoach || me?.isKine ? [SIGNALEMENTS] : []),
    ...(me?.isKine ? [MODELES] : []),
  ];
}
