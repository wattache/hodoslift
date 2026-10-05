import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { api, isApiConfigured } from '@/api/client';
import type { LiaisonAthlete } from '@/api/types';
import { useMe } from '@/api/hooks/use-me';
import { useAuth } from './auth-context';
import { AuthCard, AuthLogo, AuthSpinner } from './auth-card';
import { LoginPage } from './login-page';
import { doitTenterLeRattachement, etatDuGate, type MotifDeRefus } from './etat-du-gate';

/** Gate d'accès : login Google → GET /users/me (get-or-create serveur) →
 *  auto-link athlète par email (POST /athletes/link) → app.
 *  Un compte connu ni coach, ni admin, ni athlète lié = « accès non autorisé ».
 *  En mode dev-mock, tout passe (profil mock). */
export function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user, loading: authLoading, devMode } = useAuth();
  const { data: me, isLoading: meLoading, error: meError, refetch: refetchMe } = useMe();
  const qc = useQueryClient();

  const [linking, setLinking] = useState(false);
  const [linkChecked, setLinkChecked] = useState(false);
  // POURQUOI le rattachement n'a rien donné (FRE-76) — c'est ce qui décide de la
  // phrase affichée, et l'une des deux accusait le coach à tort.
  const [motif, setMotif] = useState<MotifDeRefus>(null);

  // Auto-link : rattache l'utilisateur à l'athlète NON LIÉ portant son email.
  useEffect(() => {
    if (!doitTenterLeRattachement({
      devMode, user, apiConfiguree: isApiConfigured, linking, linkChecked, meLoading, me,
    })) return;

    void (async () => {
      setLinking(true);
      try {
        const res = await api.post<LiaisonAthlete>('/athletes/link');
        setMotif(res.motif ?? null);
        // /users/me dérive athleteId de athletes.user_uid → re-fetch suffit.
        if (res.linked) await qc.invalidateQueries({ queryKey: ['me'] });
      } catch (e) {
        console.error('[auth] auto-link :', e);
      } finally {
        setLinking(false);
        setLinkChecked(true);
      }
    })();
  }, [devMode, user, me, meLoading, linking, linkChecked, qc]);

  const etat = etatDuGate({
    devMode, user, authLoading, me, meLoading, meError, linking,
    enLigne: onlineManager.isOnline(), motifDuRattachement: motif,
  });

  if (etat.quoi === 'ok') return children;

  if (etat.quoi === 'chargement') {
    return (
      <AuthCard>
        <AuthSpinner />
        {etat.rattachement && (
          <>
            <h2 className="text-lg font-semibold tracking-tight">Bienvenue !</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('auth.onTeConnecteA')}</p>
          </>
        )}
      </AuthCard>
    );
  }

  if (etat.quoi === 'login') return <LoginPage />;

  // ERREUR ≠ compte inconnu : si /users/me a ÉCHOUÉ (serveur injoignable, CORS,
  // 5xx…), on n'a AUCUNE information sur le compte — afficher « ton coach ne
  // t'a pas enregistré » serait un mensonge (vécu : CORS canary manquant).
  if (etat.quoi === 'erreur') {
    return (
      <AuthCard>
        <AuthLogo />
        <h2 className="text-lg font-semibold tracking-tight">{t('auth.serveurInjoignable')}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('auth.serveurInjoignableDetail')}
          <br />
          {t('auth.serveurInjoignableSuite')}
        </p>
        <p className="mt-3 break-words font-mono text-[11px] text-muted-foreground/70">
          {meError instanceof Error ? meError.message : String(meError)}
        </p>
        <button
          onClick={() => void refetchMe()}
          className="mt-5 w-full rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
        >
          {t('auth.reessayer')}
        </button>
      </AuthCard>
    );
  }

  // ⚠️ PAS DE RÉPONSE ≠ COMPTE INCONNU — la même règle que juste au-dessus, et
  // c'est ce trou qui a fait l'incident du 21/08.
  //
  // `useQuery` est en `networkMode: 'online'` (le défaut) : hors ligne, il ne
  // lance PAS la requête et ne produit AUCUNE erreur — il MET EN PAUSE. On se
  // retrouve donc avec `me` undefined, `meError` null et `meLoading` false, ce
  // qui tombait droit dans « ton coach ne t'a pas encore enregistré ».
  //
  // Le message accusait le coach à tort, sur une app mobile utilisée en salle,
  // c'est-à-dire là où la connexion tombe. Vécu par Kévin puis par un second
  // athlète, qui a donné la clé : « ça m'arrive quand je n'ai pas de connexion ».
  // Côté serveur il n'y avait RIEN à voir — pas une erreur, pas même une requête.
  //
  // On n'accuse donc que sur une réponse REÇUE. Sans réponse, on dit qu'on ne
  // sait pas.
  if (etat.quoi === 'sans-reponse') {
    const horsLigne = etat.horsLigne;
    return (
      <AuthCard>
        <AuthLogo />
        <h2 className="text-lg font-semibold tracking-tight">
          {t(horsLigne ? 'auth.pasDeConnexion' : 'auth.profilIndisponible')}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t(horsLigne ? 'auth.profilHorsLigne' : 'auth.profilPasCharge')}
          <br />
          {t(horsLigne ? 'auth.profilHorsLigneSuite' : 'auth.profilPasChargeSuite')}
        </p>
        <button
          onClick={() => void refetchMe()}
          className="mt-5 w-full rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
        >
          {t('auth.reessayer')}
        </button>
      </AuthCard>
    );
  }

  // Réponse REÇUE, et elle n'ouvre rien. Reste à dire POURQUOI — et il y a deux
  // raisons opposées derrière le même écran.
  //
  // ⚠️ « TON COACH NE T'A PAS ENREGISTRÉ » N'EST VRAI QUE DANS UN CAS. Si une
  // fiche porte bien cette adresse mais appartient à un autre uid Firebase
  // (compte Google recréé, second compte, autre fournisseur), le coach a fait son
  // travail : c'est l'identité qui a bougé. La personne est en plus bloquée
  // définitivement — le rattachement refusera toujours — et la seule action utile
  // est du côté du coach. Le bouton « détacher » a été retiré le 22/08 (jamais eu
  // le cas) : le dépannage se fait à la main, d'où « préviens ton coach » et
  // rien de plus précis.
  const identiteChangee = etat.motif === 'fiche_deja_liee';
  return (
    <AuthCard>
      <AuthLogo />
      <h2 className="text-lg font-semibold tracking-tight">{t('auth.accesNonAutorise')}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {t(identiteChangee ? 'auth.ficheAutreCompte' : 'auth.pasEnregistre')}
        <br />
        {t(identiteChangee ? 'auth.ficheAutreCompteSuite' : 'auth.pasEnregistreSuite')}
      </p>
      <p className="mt-3 font-mono text-xs text-muted-foreground/70">{user?.email}</p>
      <button
        onClick={() => window.location.reload()}
        className="mt-5 w-full rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
      >
        {t('auth.reessayer')}
      </button>
    </AuthCard>
  );
}
