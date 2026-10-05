import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import { auth, googleProvider, isFirebaseConfigured } from '@/firebase';
import i18n from '@/i18n';

/** Auth Firebase pure : n'importe quel compte Google passe ce niveau.
 *  Le contrôle d'accès réel est en aval — AuthGate interroge /users/me (brokkr)
 *  et l'autz par endpoint vit côté serveur. */

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  login: () => Promise<void>;
  /** Connexion par ID token Google (bouton GIS) : le token arrive DANS la page,
   *  aucun canal popup/redirect, aucun état de session à perdre en route. */
  loginWithIdToken: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Firebase non configuré → mode dev-mock (pas de login, fixtures). */
  devMode: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(isFirebaseConfigured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) return;
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setError(null);
      setLoading(false);
    });
  }, []);

  const login = async () => {
    if (!auth || !googleProvider) return;
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e: unknown) {
      const code = (e as { code?: string }).code ?? '';
      // Fermer la popup n'est pas une erreur.
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' || code === 'auth/user-cancelled') return;
      // La popup a échoué pour une AUTRE raison — sur Chrome Android, la
      // « popup » est un onglet et le canal de retour vers l'opener meurt
      // parfois : le compte Google est créé mais la session n'arrive jamais
      // (vécu le 18/08, premier login de Cédric). Le flux redirect n'a pas ce
      // canal, et il est sûr chez nous : authDomain = le domaine de l'app.
      try {
        await signInWithRedirect(auth, googleProvider);
      } catch (e2: unknown) {
        const code2 = (e2 as { code?: string }).code ?? '';
        // Toujours dire la cause technique : un « réessayez » nu ne se
        // diagnostique pas à distance (même leçon que l'écran AuthGate).
        setError(`${i18n.t('misc.signInError')} (${code2 || code || 'inconnue'})`);
      }
    }
  };

  const loginWithIdToken = async (idToken: string) => {
    if (!auth) return;
    setError(null);
    try {
      await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
    } catch (e: unknown) {
      const code = (e as { code?: string }).code ?? '';
      setError(`${i18n.t('misc.signInError')} (${code || 'inconnue'})`);
    }
  };

  const logout = async () => {
    if (auth) await signOut(auth);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, error, login, loginWithIdToken, logout, devMode: !isFirebaseConfigured }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé sous AuthProvider');
  return ctx;
}
