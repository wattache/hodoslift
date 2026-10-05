import { expect, test } from '@playwright/test';
import { ATHLETE, BROKKR, COACH, IDENTITE, KINE, colonne, jeton } from './aides';

/** QUAND L'UID FIREBASE DE QUELQU'UN CHANGE (FRE-76, FRE-77).
 *
 *  Compte Google recréé, second compte, autre fournisseur : le même geste banal
 *  laissait une personne dehors DÉFINITIVEMENT, avec un écran qui accusait son
 *  coach à tort.
 *
 *  ⚠️ POURQUOI CONTRE LA VRAIE PILE. Ce défaut est un PARCOURS, pas une
 *  fonction : `/users/me` → `/athletes/link` → refus → geste du coach →
 *  `/athletes/link` → `/users/me`. Aucun test unitaire ne le traverse, et c'est
 *  précisément dans les jointures entre ces appels qu'il vivait.
 *
 *  ⚠️ ET CE QUE LE HARNAIS NE PEUT PAS REPRODUIRE, mesuré plutôt que supposé :
 *  la variante « nouvel uid, adresse déjà connue » de FRE-77. L'émulateur Auth,
 *  comme Firebase, applique « un compte par adresse » — présenter une identité
 *  Google neuve sur une adresse existante rend le compte EXISTANT, pas un
 *  second. Le 500 exigeait donc que le compte Firebase ait été SUPPRIMÉ puis
 *  recréé : Firebase oublie, brokkr se souvient. Cette variante reste épinglée
 *  par pytest, où l'on maîtrise les lignes ; ici on éprouve l'autre bout du même
 *  défaut, `''` qui collisionnait avec lui-même, et qui lui est reproductible.
 */

async function appel(chemin: string, compte: { sub: string; email?: string } = COACH,
                     methode = 'GET') {
  return fetch(`${BROKKR}${chemin}`, {
    method: methode,
    headers: { Authorization: `Bearer ${await jeton(compte)}` },
  });
}

const profil = async (compte: { sub: string; email?: string }) =>
  (await appel('/users/me', compte)).json();

test('le refus dit POURQUOI, et la reprise se fait seule', async () => {
  /** Le parcours de FRE-76 : l'impasse, la sortie, puis la reprise. La
   *  fiche `e2e-identite` porte l'adresse du compte, mais reste rattachée à
   *  `e2e-identite-ancien` — un uid qui n'a plus de compte Firebase en face. */

  // 1. L'IMPASSE. Le rattachement refuse — à juste titre, c'est la garde
  //    anti-usurpation — mais il NOMME désormais ce qu'il refuse.
  const bloque = await appel('/athletes/link', IDENTITE, 'POST');
  const corps = await bloque.json();
  expect(bloque.status, JSON.stringify(corps)).toBe(200);
  expect(corps).toMatchObject({ linked: false, motif: 'fiche_deja_liee' });
  expect((await profil(IDENTITE)).athleteId, 'toujours dehors').toBeNull();

  // 2. LA SORTIE, ET ELLE N'EST PLUS UNE ROUTE (FRE-131).
  //
  // ⚠️ `DELETE /athletes/{id}/link` A ÉTÉ SUPPRIMÉE. Elle fournissait cette
  // sortie — et, ouverte au coach, l'étape 0 d'une prise de contrôle :
  // détacher, écrire son adresse sur une fiche redevenue libre, se rattacher,
  // lire les bilans kiné. Zéro appel en 30 jours de journaux, aucun bouton
  // depuis le 22/08 : supprimée plutôt que sécurisée.
  //
  // Le détachement redevient donc un UPDATE en base, fait à la main. On le joue
  // ici PAR L'ÉTAT, pas par l'API, et la spec continue d'éprouver ce qui compte :
  // qu'une fois la fiche libérée, la reprise se fasse SEULE.
  const disparue = await appel('/athletes/e2e-identite/link', COACH, 'DELETE');
  expect(disparue.status, 'la route ne doit plus répondre').toBe(404);
  colonne("UPDATE athletes SET user_uid = NULL WHERE legacy_id = 'e2e-identite'");

  // 3. LA REPRISE. Elle se rattache SEULE à la connexion suivante : le chemin
  //    normal reprend, on n'a rien de spécial à lui faire faire.
  expect(await (await appel('/athletes/link', IDENTITE, 'POST')).json())
    .toMatchObject({ linked: true, athleteId: 'e2e-identite' });
  expect((await profil(IDENTITE)).athleteId).toBe('e2e-identite');
});

test('« aucune fiche » et « fiche déjà liée » ne se confondent pas', async () => {
  /** Sans cette distinction, l'écran servait la même phrase aux deux — et elle
   *  accusait le coach dans le cas où il n'y était pour rien. Ici, personne ne
   *  porte cette adresse : « ton coach ne t'a pas encore enregistré » est vrai. */
  // Le KINÉ fait un parfait « pas athlète » : compte réel, adresse vérifiée, et
  // aucune fiche ne la porte. Un compte fabriqué à la volée ne conviendrait pas
  // — l'émulateur ne le marque pas vérifié, et la route refuserait pour ce
  // motif-là, qui n'est pas celui qu'on éprouve.
  expect(await (await appel('/athletes/link', KINE, 'POST')).json())
    .toMatchObject({ linked: false, motif: 'aucune_fiche' });
});

test('PERSONNE ne détache plus par l’API — la route a disparu', async () => {
  /** ⚠️ ELLE ÉTAIT RÉSERVÉE AU COACH, ET C'ÉTAIT LE PROBLÈME (FRE-131). Cette
   *  spec vérifiait que l'athlète ne pouvait pas se détacher lui-même ; le
   *  coach, lui, le pouvait — et c'était l'étape 0 d'une prise de contrôle :
   *  détacher, écrire son adresse sur la fiche libérée, se rattacher, lire les
   *  bilans kiné.
   *
   *  Supprimée plutôt que passée en admin : zéro appel en 30 jours de journaux,
   *  aucun bouton depuis le 22/08. La spec devient donc plus forte — elle
   *  n'éprouve plus un refus parmi d'autres, elle éprouve que le chemin
   *  n'existe pour PERSONNE, coach compris. */
  for (const compte of [ATHLETE, COACH]) {
    const r = await appel('/athletes/e2e-athlete/link', compte, 'DELETE');
    expect(r.status, `détachement encore ouvert à ${compte.email}`).toBe(404);
  }
  expect((await profil(ATHLETE)).athleteId, 'toujours lié').toBe('e2e-athlete');
});

test('deux comptes SANS ADRESSE coexistent — l’autre bout de FRE-77', async () => {
  /** ⚠️ LE MÊME DÉFAUT, PAR LE CÔTÉ REPRODUCTIBLE. Le routeur écrit `''` quand
   *  le jeton ne porte pas d'adresse, et `users.email` était `UNIQUE` : deux
   *  comptes sans email suffisaient à faire tomber `/users/me` en 500, sans
   *  qu'aucune adresse ne soit vraiment en double. C'est `vide contre NULL`, le
   *  défaut le plus récurrent de ce projet, arbitré par une contrainte de base.
   *
   *  La personne lisait « Serveur injoignable » sur la toute première route
   *  appelée après connexion — un message qui annonce un incident passager
   *  alors que la panne était PERMANENTE pour elle. */
  for (const sub of ['e2e-sans-adresse-1', 'e2e-sans-adresse-2']) {
    const r = await appel('/users/me', { sub });
    const moi = await r.json();
    expect(r.status, `${sub} : ${JSON.stringify(moi)}`).toBe(200);
    expect(moi.email).toBe('');
  }
});
