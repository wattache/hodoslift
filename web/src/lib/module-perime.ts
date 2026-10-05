/** Un écran du build PRÉCÉDENT, demandé après une livraison.
 *
 *  Chaque vue secondaire est un fichier chargé à la demande, dont le nom change
 *  à chaque build. Une app restée ouverte pendant une livraison réclame donc un
 *  fichier qui n'existe plus : l'import échoue, et seul un rechargement la met
 *  sur la version servie.
 *
 *  ⚠️ UN SEUL RECHARGEMENT PAR FENÊTRE. Si le fichier manque encore après, ce
 *  n'est plus une version périmée mais une livraison cassée : recharger en
 *  boucle rendrait l'app inutilisable sans rien dire. */

/** Le message de chaque moteur quand un import dynamique échoue : Chrome,
 *  Safari, Firefox, puis Safari quand le serveur répond du HTML à la place. */
const MOTIFS = /dynamically imported module|Importing a module script failed|is not a valid JavaScript MIME type/i;

const CLE = 'eitri:rechargement-module-perime';
const FENETRE_MS = 10_000;

export function estUnModulePerime(erreur: unknown): boolean {
  return erreur instanceof Error && MOTIFS.test(erreur.message);
}

/** Faux quand un rechargement vient d'avoir lieu, ou que le stockage est
 *  inaccessible : sans trace du précédent, on ne sait pas s'arrêter. */
export function peutRecharger(maintenant = Date.now()): boolean {
  try {
    const dernier = Number(sessionStorage.getItem(CLE));
    return !(dernier > 0 && maintenant - dernier < FENETRE_MS);
  } catch {
    return false;
  }
}

export function recharger(maintenant = Date.now()): void {
  try {
    sessionStorage.setItem(CLE, String(maintenant));
  } catch {
    return;
  }
  window.location.reload();
}
