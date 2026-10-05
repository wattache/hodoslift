/** Firebase réduit à sa plus simple expression : l'AUTHENTIFICATION, et rien
 *  d'autre. Toutes les données passent par l'API brokkr — aucun SDK Firestore
 *  ici, c'est un choix d'architecture d'Eitri.
 *
 *  ⚠️ STORAGE EST PARTI (FRE-91, 27/08). Ce module ouvrait aussi un client
 *  Firebase Storage pour les photos d'athlète — retirées du produit le 20/08, et
 *  dont le bucket a été supprimé le 27/08 (FRE-88). Personne n'importait
 *  `storage` ni `isStorageConfigured` : le code était inerte, mais il pointait
 *  sur un seau qui n'existe plus, et `VITE_FIREBASE_STORAGE_BUCKET` restait dans
 *  la configuration de build comme si le produit s'en servait.
 *
 *  Les images vivent désormais chez Scaleway, servies par brokkr — le front ne
 *  parle plus jamais directement à un stockage.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';

const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;
const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;

/** Config incomplète → mode DEV-MOCK (pas de login, fixtures locales). */
export const isFirebaseConfigured = Boolean(apiKey && authDomain && projectId);

let auth: Auth | null = null;
let googleProvider: GoogleAuthProvider | null = null;

if (isFirebaseConfigured) {
  const app: FirebaseApp = initializeApp({
    apiKey,
    authDomain,
    projectId,
  });
  auth = getAuth(app);
  // ÉMULATEUR AUTH — le seul endroit où le produit sait qu'un test existe.
  //
  // Il est là parce qu'un seul booléen commande à la fois le bypass du login et
  // les 15 court-circuits d'écriture de l'éditeur : sans émulateur, aucun test
  // ne peut à la fois ENTRER dans l'app et ÉCRIRE pour de vrai. Les alternatives
  // (forger un jeton, injecter une session dans IndexedDB, dédoubler le drapeau)
  // coûtent toutes plus cher — en code produit ou en fragilité.
  //
  // `import.meta.env` est substitué statiquement par Vite : sans la variable, ce
  // bloc est du code MORT, éliminé du bundle. Et `npm run build` refuse de
  // construire si elle est posée (cf. scripts/refuser-emulateur.mjs).
  if (import.meta.env.VITE_AUTH_EMULATOR_HOST) {
    connectAuthEmulator(auth, `http://${import.meta.env.VITE_AUTH_EMULATOR_HOST}`,
                        { disableWarnings: true });
  }
  googleProvider = new GoogleAuthProvider();
} else if (apiKey || authDomain || projectId) {
  console.warn(
    '[firebase] Config incomplète (il faut VITE_FIREBASE_API_KEY + AUTH_DOMAIN + PROJECT_ID). Bascule en mode dev-mock.',
  );
}

export { auth, googleProvider };
