import { beforeEach, describe, expect, it } from 'vitest';

import { ApiError } from '@/api/client';
import i18n from '@/i18n';
import { saveErrorParts } from '@/lib/save-error';

/** Le message d'échec branche-t-il sur la CAUSE, ou seulement sur le statut ?
 *
 *  ⚠️ C'EST TOUT L'ENJEU DE FRE-40. Six règles métier du serveur partageaient un
 *  seul 409 : « ce coach suit encore des athlètes » et « ce lien public est déjà
 *  pris » arrivaient indiscernables. L'interface ne pouvait que dire « refusé »
 *  en recopiant une phrase FRANÇAISE du serveur — dans une app qui tourne en
 *  français, anglais et polonais.
 */

describe('saveErrorParts — le code prime sur le statut', () => {
  // ⚠️ LA LANGUE EST POSÉE EXPLICITEMENT. L'environnement de test démarre en
  // anglais ; un test qui suppose le français passerait ou tomberait selon un
  // réglage qu'il ne contrôle pas — et c'est précisément de traduction qu'il
  // s'agit ici.
  beforeEach(async () => { await i18n.changeLanguage('fr'); });

  it('deux 409 DIFFÉRENTS donnent deux messages différents', () => {
    const coach = saveErrorParts(
      new ApiError(409, '38 entrées de bibliothèque', 'coach_encore_reference'));
    const slug = saveErrorParts(new ApiError(409, 'peu importe', 'slug_deja_pris'));

    expect(coach.title).not.toEqual(slug.title);
    // …et chacun dit quoi FAIRE, ce qu'un statut seul ne peut pas porter.
    // ⚠️ CE CODE N'A PAS DE `hint` TRADUIT, VOLONTAIREMENT : son `detail` énumère
    // ce qui retient le coach, et c'est ce comptage qui dit quoi faire. Le front
    // laisse donc parler le serveur plutôt que d'y substituer une phrase vague.
    expect(coach.description).toEqual('38 entrées de bibliothèque');
    expect(slug.description).toMatch(/identifiant/i);
  });

  it('le message vient de la TRADUCTION, pas du serveur', async () => {
    const francais = saveErrorParts(new ApiError(409, 'phrase serveur en français', 'dernier_bloc'));
    // ⚠️ N'IMPORTE QUELLE AUTRE LANGUE FAIT L'AFFAIRE : ce test prouve que le
    // message vient de la TRADUCTION et non du serveur. Il visait le polonais,
    // retiré le 03/09 — l'anglais joue le même rôle.
    await i18n.changeLanguage('en');
    const polonais = saveErrorParts(new ApiError(409, 'phrase serveur en français', 'dernier_bloc'));

    expect(polonais.title).not.toEqual(francais.title);
    // Et surtout : la phrase du serveur n'est plus affichée du tout.
    expect(polonais.description).not.toMatch(/français/);
  });

  it('un code SANS traduction retombe sur le message par statut, sans casser', () => {
    // `reserve_aux_admins` existe côté serveur mais n'est pas dans la table : la
    // table est volontairement partielle, et se complète cas par cas.
    const partie = saveErrorParts(new ApiError(403, 'réservé aux admins', 'reserve_aux_admins'));
    expect(partie.title).toEqual(i18n.t('saveError.forbidden'));
  });

  it('une erreur SANS code reste traitée par son statut', () => {
    expect(saveErrorParts(new ApiError(404, 'introuvable')).title)
      .toEqual(i18n.t('saveError.missing'));
  });

  it('ce qui n’a jamais atteint le serveur parle de connexion, et rien d’autre', () => {
    // ⚠️ LE SEUL CAS OÙ PARLER DE CONNEXION EST HONNÊTE. Une `ApiError` signifie
    // que le serveur a répondu ; accuser le réseau serait envoyer chercher au
    // mauvais endroit — c'est le défaut que FRE-23 avait déjà corrigé une fois.
    expect(saveErrorParts(new TypeError('fetch failed')).title)
      .toEqual(i18n.t('saveError.offline'));
  });
});
