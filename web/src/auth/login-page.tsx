import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from './auth-context';
import { AuthCard, AuthLogo, AuthSpinner } from './auth-card';
import { NomHodosLift } from '@/components/marque-hodos';

/** Bouton Google Identity Services — la voie SANS canal de retour. Popup et
 *  redirect reposent tous deux sur un état qui doit survivre à un aller-retour
 *  (canal vers l'opener, sessionStorage) ; certains Android le détruisent en
 *  route (vécu le 18/08 : premier login de Cédric, les DEUX flux morts sur un
 *  Chrome normal). GIS livre l'ID token directement dans la page — rien à
 *  stocker, rien à perdre — puis signInWithCredential fait le reste.
 *
 *  Le bouton n'existe que si VITE_GOOGLE_CLIENT_ID est posé (déployable sans
 *  risque : sans la variable, la page est identique à avant), et l'ancien
 *  bouton reste dessous en secours. */
const GIS_CLIENT_ID: string | undefined = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GIS_SRC = 'https://accounts.google.com/gsi/client';

type GisId = {
  initialize: (cfg: { client_id: string; callback: (r: { credential: string }) => void }) => void;
  renderButton: (el: HTMLElement, cfg: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    google?: { accounts: { id: GisId } };
  }
}

function useBoutonGis(onIdToken: (idToken: string) => void) {
  const conteneur = useRef<HTMLDivElement>(null);
  const [rendu, setRendu] = useState(false);
  // La callback vit dans une ref : le script GIS ne s'initialise qu'une fois.
  const cb = useRef(onIdToken);
  useEffect(() => {
    cb.current = onIdToken;
  });

  useEffect(() => {
    if (!GIS_CLIENT_ID || !conteneur.current) return;
    let demonte = false;

    const rendre = () => {
      const gis = window.google?.accounts.id;
      if (demonte || !gis || !conteneur.current) return;
      gis.initialize({
        client_id: GIS_CLIENT_ID,
        callback: (r) => cb.current(r.credential),
      });
      gis.renderButton(conteneur.current, { theme: 'outline', size: 'large', width: 288 });
      setRendu(true);
    };

    if (window.google?.accounts.id) {
      rendre();
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = rendre;
    // Échec de chargement (bloqueur, hors-ligne) : on reste sur l'ancien bouton.
    document.head.appendChild(script);
    return () => {
      demonte = true;
    };
  }, []);

  return { conteneur, rendu };
}

export function LoginPage() {
  const { t } = useTranslation();
  const { login, loginWithIdToken, error, loading } = useAuth();
  const { conteneur, rendu: gisRendu } = useBoutonGis((idToken) => void loginWithIdToken(idToken));

  if (loading) {
    return (
      <AuthCard>
        <AuthSpinner />
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <AuthLogo />
      <h1 className="text-xl font-semibold tracking-tight"><NomHodosLift /></h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('auth.connecteToiPourAcceder')}</p>
      {error && (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      <div ref={conteneur} className={gisRendu ? 'mt-6 flex justify-center' : 'hidden'} />
      <button
        onClick={login}
        className={
          gisRendu
            ? 'mt-3 w-full rounded-lg px-4 py-2 text-xs text-muted-foreground underline-offset-2 hover:underline'
            : 'mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90'
        }
      >
        {!gisRendu && (
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
        )}
        {t(gisRendu ? 'auth.connexionClassique' : 'auth.seConnecterAvecGoogle')}
      </button>
    </AuthCard>
  );
}
