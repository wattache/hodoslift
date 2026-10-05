import { toast } from 'sonner';

import { ApiError, type CodeErreur } from '@/api/client';
import i18n from '@/i18n';

/** Message d'échec d'écriture, adressé à un coach — pas à un développeur.
 *
 *  Toutes les surfaces affichaient jusqu'ici soit « vérifie ta connexion »
 *  quelle que soit la cause, soit le `message` brut d'`ApiError`
 *  (« [brokkr] 422 — week.hidden: Extra inputs are not permitted »). Les deux
 *  échouent : le premier envoie chercher au mauvais endroit, le second ne veut
 *  rien dire pour l'utilisateur.
 *
 *  On sépare donc :
 *   - le TITRE, une phrase qui dit ce qui s'est passé et dans quelle direction
 *     chercher ;
 *   - la DESCRIPTION, le motif brut du serveur — incompréhensible pour un
 *     coach, mais c'est ce qu'il recopiera dans son signalement, et c'est ce
 *     qui nous fait gagner une heure de diagnostic.
 *
 *  ⚠️ Une erreur qui n'est PAS une `ApiError` n'a jamais atteint le serveur
 *  (fetch qui échoue, hors-ligne) : c'est le seul cas où parler de connexion
 *  est honnête. */
/** Les codes serveur pour lesquels le front a un message À LUI.
 *
 *  ⚠️ `satisfies readonly CodeErreur[]` EST LE POINT IMPORTANT. La liste est
 *  vérifiée contre le vocabulaire ENGENDRÉ depuis l'OpenAPI : une faute de frappe
 *  ne compile pas, et un code retiré côté serveur fait rougir le front au lieu de
 *  laisser une branche morte que personne ne remarquera.
 *
 *  Elle est volontairement PARTIELLE. Un code sans entrée retombe sur le message
 *  par statut, ce qui reste juste — la table se complète cas par cas, et le
 *  ticket le préconise (« en commençant par ceux que le front traite déjà »). */
export const CODES_TRADUITS = [
  'coach_encore_reference', 'kine_a_des_athletes', 'slug_deja_pris', 'slug_immuable',
  'entree_deja_existante', 'dernier_bloc', 'semaine_deja_remplie',
  // FRE-188 : déplacer une ligne reste dans la semaine ; le code se lit dès le geste.
  'seance_d_une_autre_semaine',
  // FRE-204 : une annonce ne baisse pas — l'écran grise la charge, le serveur la refuse.
  'annonce_en_baisse',
  // ⚠️ `base_sans_dates` EXISTAIT AU SERVEUR SANS EXISTER ICI (FRE-154). Le
  // contrat n'avait pas été régénéré après FRE-138 : le code manquait à
  // `brokkr.gen.ts`, donc `CodeErreur` l'ignorait, donc cette liste ne POUVAIT
  // pas le porter — le `satisfies` l'aurait refusé. Un onglet ouvert avant le
  // déploiement gardait son bouton actif et récoltait « refusé » suivi du
  // détail brut. `make contrat` empêche désormais un déploiement dans cet état.
  'base_sans_dates',
  'fin_avant_debut', 'date_invalide',
  // ⚠️ `trop_d_objectifs` A ÉTÉ RETIRÉ ICI AUSSI (FRE-124). La borne est passée
  // dans le contrat Pydantic, donc le serveur ne lève plus ce code — il
  // répond 422 de validation. Le garder aurait laissé le front attendre un
  // mot que personne ne dit plus, ce que cette liste existe précisément pour
  // empêcher. C'est `tsc` qui l'a signalé, à la régénération des types.
  'photo_trop_lourde', 'photo_pas_png', 'pas_un_lift_de_competition',
  'categorie_exige_le_genre', 'categorie_invalide', 'jour_hors_competition',
  'pas_un_kine', 'email_non_verifie', 'corps_invalide',
  // ⚠️ LE FILET ET LE ROUTAGE (FRE-79). `erreur_interne` remplace le 500 texte
  // brut sans CORS, que `save-error` ne pouvait qu'attribuer à la connexion ;
  // les deux autres remplacent des codes qui MENTAIENT (`athlete_introuvable`
  // sur une URL inconnue, `corps_invalide` sur un 405).
  'erreur_interne', 'route_introuvable', 'methode_non_autorisee',
  // FRE-78 : « authentifié » n'est pas « membre » — Firebase accepte tout compte
  // Google du monde, un jeton valide ne prouve aucun lien avec le club.
  'reserve_aux_membres',
  // BILAN KINÉ. ⚠️ `bilan_incomplet` N'A PAS DE `hint`, VOLONTAIREMENT : le
  // `detail` du serveur dit COMBIEN de tests il reste, et une phrase générique
  // l'écraserait. C'est la règle de FRE-24 — pas de `hint` quand le serveur compte.
  'bilan_incomplet', 'bilan_deja_finalise', 'test_non_bilateral', 'test_sans_mesure',
  'modele_vide', 'modele_utilise', 'rubrique_non_vide', 'test_utilise',
  // ⚠️ COMPÉTITION ET BIBLIOTHÈQUE (FRE-139), et le premier se lit EN DIRECT. Un
  // motif resté sur un essai qui n'est plus « norep » fait refuser le PUT ENTIER
  // de la compétition : le coach voyait « refusé » suivi du détail brut du
  // serveur, en français, un jour de match. Les sept autres sont les codes
  // qu'un geste ORDINAIRE atteint — pas des cas de laboratoire.
  'motif_exige_un_echec', 'mouvement_inconnu', 'competition_hors_exercices',
  'intervalle_inverse', 'reordonnancement_incoherent', 'essais_perdus',
  'media_trop_lourd', 'media_format_refuse',
  // ⚠️ DEUX ÉCRIVAINS SUR LA MÊME LISTE (FRE-134). L'athlète et son coach
  // éditent tous deux les objectifs, et le `PUT` remplace la liste entière :
  // celui qui avait chargé la page en premier effaçait l'ajout de l'autre. Le
  // serveur refuse désormais, et ce mot-là est celui qu'il dit.
  'objectifs_perimes',
  // Le même refus sur le plateau d'une compétition (FRE-162) : deux coachs y
  // saisissaient le jour J, et le second effaçait les barres du premier.
  'competition_perimee',
] as const satisfies readonly CodeErreur[];

/** L'appel a-t-il seulement ATTEINT le serveur ?
 *
 *  ⚠️ UNE SEULE DÉFINITION, PARCE QU'ELLE COMMANDE DEUX CHOSES DIFFÉRENTES. Elle
 *  décide du message affiché (« vérifie ta connexion » n'est honnête que là), et
 *  depuis FRE-118 elle décide aussi du SORT DE LA FRAPPE : une écriture qui n'est
 *  jamais partie est gardée pour le retour du réseau, une écriture REFUSÉE est
 *  abandonnée. Deux définitions de « hors ligne » divergeant, c'est une saisie
 *  perdue d'un côté ou une file qui enfle de l'autre.
 *
 *  Le test tient en une phrase : `ApiError` n'est fabriquée que depuis une
 *  RÉPONSE. Tout le reste — fetch qui échoue, rafraîchissement de jeton
 *  impossible — n'a pas quitté le téléphone. */
export function estUneReponseDuServeur(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** La même question, posée dans l'autre sens — DÉRIVÉE, jamais réécrite. */
export const jamaisParvenueAuServeur = (e: unknown): boolean => !estUneReponseDuServeur(e);

export function saveErrorParts(e: unknown): { title: string; description?: string } {
  const t = i18n.t.bind(i18n);

  // ⚠️ LE CODE D'ABORD, LE STATUT ENSUITE, ET L'ORDRE EST TOUT LE TICKET (FRE-40).
  //
  // Brancher sur le statut, c'est confondre six règles métier sous un même 409 :
  // « réassigne tes athlètes » et « choisis un autre lien » arrivaient
  // identiques, et l'interface ne pouvait que recopier une phrase FRANÇAISE du
  // serveur — dans une app qui tourne en trois langues.
  //
  // Le code, lui, est stable et traduisible. Ceux qui n'en ont pas encore
  // retombent sur le statut : la table se complète cas par cas, sans que rien ne
  // se dégrade entre-temps.
  if (e instanceof ApiError && e.code && (CODES_TRADUITS as readonly string[]).includes(e.code)) {
    // ⚠️ UNE TRADUCTION SANS `hint` LAISSE PARLER LE SERVEUR, et ce n'est pas un
    // oubli. Certains `detail` ÉNUMÈRENT quelque chose que le front ne peut pas
    // deviner — « 38 entrées de bibliothèque et 1 compétition dépendent encore de
    // ce coach » (FRE-24). Un texte traduit générique remplacerait ce comptage
    // par une phrase vague, et c'est justement le comptage qui dit quoi faire.
    //
    // Le titre reste traduit : c'est lui qu'on lit en premier, et il n'a pas
    // besoin du détail pour être juste.
    const cle = `saveError.code.${e.code}`;
    return {
      title: t(`${cle}.title`),
      description: i18n.exists(`${cle}.hint`) ? t(`${cle}.hint`) : e.detail,
    };
  }

  if (!estUneReponseDuServeur(e)) {
    return { title: t('saveError.offline'), description: t('saveError.offlineHint') };
  }

  // status 0 = la requête n'est jamais partie (URL brokkr absente).
  if (e.status === 0) return { title: t('saveError.misconfigured'), description: e.detail };
  if (e.status === 401) return { title: t('saveError.expired'), description: t('saveError.expiredHint') };
  if (e.status === 403) return { title: t('saveError.forbidden'), description: t('saveError.forbiddenHint') };
  if (e.status === 404) return { title: t('saveError.missing'), description: t('saveError.missingHint') };
  if (e.status >= 500) return { title: t('saveError.server'), description: t('saveError.serverHint') };

  // 4xx restants (409, 422…) : le serveur a bien reçu et REFUSÉ, et son `code`
  // dit LAQUELLE de ses règles. À défaut de code traduit, son motif brut reste
  // la meilleure information disponible.
  return { title: t('saveError.rejected'), description: e.detail };
}

/** Toast d'échec d'écriture. À utiliser partout : neuf surfaces affichaient
 *  neuf variantes du même message approximatif. */
export function toastSaveError(e: unknown): void {
  const { title, description } = saveErrorParts(e);
  console.error('[save]', e);
  toast.error(title, { description });
}
