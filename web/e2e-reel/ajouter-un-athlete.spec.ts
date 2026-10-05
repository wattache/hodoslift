import { expect, test } from '@playwright/test';
import { seConnecter } from './aides';

/** UN COACH PEUT AJOUTER UN ATHLÈTE (25/08).
 *
 *  `POST /athletes` est en `require_coach` depuis toujours et pose
 *  `coach_uid = <l'appelant>` : un coach qui crée obtient un athlète rattaché à
 *  lui. Le seul bouton de l'app vivait pourtant dans la vue Admin, derrière
 *  `isAdmin` — un coach non-admin était BLOQUÉ, sans aucun message, sur un geste
 *  que le serveur acceptait.
 *
 *  ⚠️ POURQUOI CONTRE LA VRAIE PILE, ET PAS SUR LE DEV-MOCK. Le `mockMe` du
 *  dev-mock est coach ET admin (`isCoach: true, isAdmin: true`) : les deux
 *  conditions y sont vraies en même temps, donc l'écran s'y comporte pareil
 *  avant et après le correctif. Une spec dev-mock aurait été verte des deux
 *  côtés — elle n'aurait rien prouvé. Le compte `COACH` du harnais réel, lui,
 *  a une ligne dans `coaches` et PAS `users.is_admin` : c'est exactement la
 *  population qui était bloquée.
 *
 *  ⚠️ CE QUE CETTE SPEC NE FAIT PAS : inviter pour de bon. Le bac à sable n'est
 *  pas remis à zéro entre deux campagnes (`seed_e2e.sql` est idempotent, pas
 *  destructeur) et rien n'expose de suppression d'athlète : chaque exécution
 *  laisserait une fiche de plus dans la barre latérale du coach de test, et
 *  finirait par déranger les specs qui comptent ce qu'elles voient. La création
 *  elle-même est tenue côté serveur (`test_creation_rattache_l_athlete_AU_COACH_QUI_CREE`),
 *  là où la base se nettoie toute seule.
 */

const OUVRIR = /Ajouter un athlète|Add an athlete/;

test('le coach non-admin a l’entrée « Ajouter un athlète »', async ({ page }) => {
  await seConnecter(page);

  const bouton = page.getByRole('button', { name: OUVRIR });
  await expect(bouton).toBeVisible();
  await bouton.click();

  // Les deux seuls champs — et c'est le sujet : « inviter » n'envoie rien, on
  // crée une fiche que l'athlète rejoindra en se connectant avec cette adresse.
  const dialogue = page.getByRole('dialog');
  await expect(dialogue.getByRole('textbox').first()).toBeVisible();
  await expect(dialogue.locator('input[type="email"]')).toBeVisible();

  // ⚠️ ET LE BOUTON RESTE FERMÉ TANT QUE L'ADRESSE MANQUE. Sans elle la fiche
  // serait créée mais RATTACHABLE PAR PERSONNE : `POST /athletes/link` rapproche
  // sur l'email. Le serveur la refuse aussi (`_normalize_email` rejette une
  // chaîne vide, 422) — l'écran ne fait que dire NON PLUS TÔT, avec un bouton
  // éteint plutôt qu'une erreur après coup.
  const valider = dialogue.getByRole('button', { name: /^(Ajouter|Add)$/ });
  await expect(valider).toBeDisabled();
  await dialogue.getByRole('textbox').first().fill('Camille');
  await expect(valider).toBeDisabled();
});
