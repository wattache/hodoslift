/* eslint-disable react-refresh/only-export-components --
 * Ce fichier EST le routeur : déclarer des composants lazy à côté du point
 * d'entrée est sa fonction, pas un accident. La règle protège le Fast Refresh
 * d'un module qui mêlerait composants et exports utilitaires — ici il n'y a
 * aucun export, et chaque route en ajoutait un avertissement identique. Douze
 * lignes de bruit qui masquaient les vraies alertes, et un budget qu'il fallait
 * relever à chaque page neuve. */
import { StrictMode, lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { Toaster } from 'sonner';

import i18n from '@/i18n';
import { installerObservabilite } from '@/lib/observabilite';
import { enregistrerLeServiceWorker, surveillerNouvelleVersion } from '@/lib/nouvelle-version';
/* ⚠️ LES POLICES AVANT LA FEUILLE DE STYLE, et servies par nous. Les paquets
 * `@fontsource` vendent les `.woff2` dans le bundle : aucune requête vers
 * Google Fonts — une app qui porte des bilans kiné n'a pas à annoncer ses
 * visiteurs à un tiers — et un rendu identique hors ligne, ce que la PWA exige.
 *
 * Les graisses sont importées UNE PAR UNE, à dessein : la famille complète
 * pèse une vingtaine de fichiers, on en charge cinq. Ajouter une graisse ici
 * est un choix, pas un effet de bord. */
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/ibm-plex-mono/500.css';
import './index.css';
import { AuthProvider, useAuth } from '@/auth/auth-context';
import { AuthCard, AuthSpinner } from '@/auth/auth-card';
import { ProvisionHorsLigne } from '@/lib/provision-hors-ligne';
import { lireLaFile, rejouerLaFile } from '@/lib/file-hors-ligne';
import { deciderIci, estUneAncienneAdresse, rapatrier } from '@/lib/rapatriement';
import { clesDeLArbre, clesDeriveesDuRealise, invalider } from '@/api/cles';
import { AuthGate } from '@/auth/auth-gate';
import { AthleteSelectionProvider } from '@/lib/athlete-selection';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ErrorBoundary } from '@/components/error-boundary';
import { ErreurDeRoute } from '@/components/erreur-de-route';
import { AppShell } from '@/components/layout/app-shell';
import { AthleteSpace } from '@/components/layout/athlete-space';
import { DashboardView } from '@/views/dashboard';

// ⚠️ AVANT TOUT RENDU. Une erreur pendant le montage du premier composant doit
// être vue ; l'installer plus bas laisserait un angle mort là où les pannes de
// démarrage sont précisément les plus opaques pour l'utilisateur.
installerObservabilite();

/** Vues secondaires code-splittées — le dashboard (vue par défaut) reste eager. */
const TrainingView = lazy(() => import('@/views/training').then(m => ({ default: m.TrainingView })));
const TrackerView = lazy(() => import('@/views/tracker').then(m => ({ default: m.TrackerView })));
const KineView = lazy(() => import('@/views/kine').then(m => ({ default: m.KineView })));
const ProfilAthleteView = lazy(() => import('@/views/profil-athlete').then(m => ({ default: m.ProfilAthleteView })));
const BilanView = lazy(() => import('@/views/bilan').then(m => ({ default: m.BilanView })));
const BilanModelesView = lazy(() => import('@/views/bilan-modeles').then(m => ({ default: m.BilanModelesView })));
const SignalementsView = lazy(() => import('@/views/signalements').then(m => ({ default: m.SignalementsView })));
// LE GUICHET (12/09) — l'écran d'accueil du coach. `Accueil` décide où `/` mène.
const GuichetView = lazy(() => import('@/views/guichet').then(m => ({ default: m.GuichetView })));
const Accueil = lazy(() => import('@/views/guichet').then(m => ({ default: m.Accueil })));
const CalendarView = lazy(() => import('@/views/calendar').then(m => ({ default: m.CalendarView })));
const CompetitionsView = lazy(() => import('@/views/competitions').then(m => ({ default: m.CompetitionsView })));
const CompetitionDetailView = lazy(() => import('@/views/competition-detail').then(m => ({ default: m.CompetitionDetailView })));
const CoachProfileView = lazy(() => import('@/views/coach-profile').then(m => ({ default: m.CoachProfileView })));
const DocumentationView = lazy(() => import('@/views/documentation').then(m => ({ default: m.DocumentationView })));
const LibraryView = lazy(() => import('@/views/library').then(m => ({ default: m.LibraryView })));
const AdminView = lazy(() => import('@/views/admin').then(m => ({ default: m.AdminView })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Refetch au retour de focus = le remplaçant pragmatique d'onSnapshot.
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // Pas de retry sur les erreurs métier (4xx) — seulement réseau/5xx.
        const status = (error as { status?: number }).status ?? 0;
        if (status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

function LazyFallback() {
  return (
    <div className="mx-auto max-w-6xl rounded-lg border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
      {i18n.t('common.loading')}
    </div>
  );
}

function withSuspense(node: React.ReactNode) {
  return <Suspense fallback={<LazyFallback />}>{node}</Suspense>;
}

// Une app reprise de mémoire ne sait pas qu'elle est vieille : ce module la
// prévient (toast « recharger ») dès qu'une nouvelle version du SW prend la main.
//
// ⚠️ PAS SUR UNE ANCIENNE ADRESSE (FRE-146) : on est là pour en partir, pas pour
// s'y installer. Un SW enregistré ici serait désenregistré trois lignes plus
// loin par `rapatrier`, et entre les deux il aurait pu prendre la main.
if (!estUneAncienneAdresse(window.location.hostname)) {
  enregistrerLeServiceWorker();
  surveillerNouvelleVersion();
}

const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <ErreurDeRoute />,
    children: [
      // ⚠️ L'ACCUEIL DÉPEND DE QUI ARRIVE (12/09) : le guichet pour qui coache,
      // le tableau de bord pour les autres. Un coach-athlète atterrit sur sa
      // file et passe à son propre entraînement par la bascule qui existe déjà.
      { path: '/', element: withSuspense(<Accueil />) },
      { path: '/guichet', element: withSuspense(<GuichetView />) },
      // L'ESPACE ATHLÈTE (FRE-68) : les quatre vues scopées à un athlète vivent
      // sous un layout à ONGLETS dérivés des permissions. Les URL ne changent
      // pas — seule la structure qui les porte.
      {
        element: <AthleteSpace />,
        children: [
          { path: '/dashboard', element: <DashboardView /> },
          { path: '/training', element: withSuspense(<TrainingView />) },
          // LE PROGRAMME EN TABLEAU (FRE-114) — l'entrée de l'ATHLÈTE sur le
          // même écran que la bascule de vue du coach. Dans l'espace athlète :
          // un bloc appartient à quelqu'un, en sortir perdrait la sélection.
          { path: '/tracker', element: withSuspense(<TrackerView />) },
          { path: '/kine', element: withSuspense(<KineView />) },
          // UN BILAN SUR SA PROPRE PAGE. 32 tests dépliés sous le questionnaire
          // quotidien sont impraticables sur un téléphone ; et une URL propre rend
          // le bouton RETOUR utile, un bilan en cours retrouvable en favori.
          //
          // DANS l'espace athlète : un bilan appartient à quelqu'un, en sortir
          // ferait perdre la sélection.
          { path: '/kine/bilans/:bilanId', element: withSuspense(<BilanView />) },
          { path: '/calendar', element: withSuspense(<CalendarView />) },
          // LA FICHE DE L'ATHLÈTE (27/09) : un onglet dédié, pour y ranger la suite.
          { path: '/profil', element: withSuspense(<ProfilAthleteView />) },
        ],
      },
      // L'onglet Tracking a fusionné dans Tracker (17/08). Redirection
      // EXPLICITE plutôt que de laisser le catch-all renvoyer au tableau de
      // bord : l'app est installable, et un coach peut avoir cette URL en
      // favori ou dans un onglet ouvert depuis des semaines.
      { path: '/tracking', element: <Navigate to="/tracker" replace /> },
      { path: '/competitions', element: withSuspense(<CompetitionsView />) },
      { path: '/competitions/:competitionId', element: withSuspense(<CompetitionDetailView />) },
      // HORS de l'espace athlète : il n'est scopé à personne, il les traverse.
      { path: '/signalements', element: withSuspense(<SignalementsView />) },
      // Les MODÈLES de bilan — hors espace athlète : un modèle n'appartient à
      // personne en particulier, c'est le catalogue de la kiné.
      { path: '/bilan-modeles', element: withSuspense(<BilanModelesView />) },
      // LA DOCUMENTATION DU PRODUIT — hors de l'espace athlète : une règle de
      // calcul ne décrit personne, et s'y trouvait dupliquée autant de fois
      // qu'il y a d'athlètes.
      { path: '/documentation', element: withSuspense(<DocumentationView />) },
      { path: '/library', element: withSuspense(<LibraryView />) },
      { path: '/ma-page', element: withSuspense(<CoachProfileView />) },
      { path: '/admin', element: withSuspense(<AdminView />) },
      { path: '*', element: <Navigate to="/dashboard" replace /> },
    ],
  },
]);

/** ⚠️ L'AUTH PASSE AU-DESSUS DU CACHE, et l'ordre porte une règle (FRE-118).
 *
 *  Le cache persisté est JETÉ dès que l'utilisateur change : c'est le `buster`,
 *  et il lui faut donc l'uid Firebase. Or `AuthProvider` n'interroge que
 *  Firebase — aucune requête — alors que tout ce qui est en dessous en fait.
 *  Il peut donc monter en premier, et c'est la seule position d'où l'identité
 *  est connue avant qu'une seule donnée ne soit relue du disque.
 *
 *  Deux personnes partagent parfois un téléphone. Sans cet ordre, la seconde
 *  ouvrirait l'app sur les séances de la première le temps d'un aller-retour. */
function Application() {
  const { user, loading } = useAuth();

  /** ⚠️ UNE SEULE ORIGINE DE PRODUCTION (FRE-146), ET ON N'EN PART QUE FILE VIDE.
   *
   *  Depuis `french-forge-600.web.app` ou `.firebaseapp.com`, l'app se rapatrie
   *  d'elle-même sur `trainer.french-forge.com` — la seule adresse que Google
   *  accepte au login depuis le 18/08. Mais la file d'écritures hors ligne vit
   *  par origine : partir avec une saisie en attente, c'est la perdre en
   *  silence. Alors on regarde la file AVANT (sans jeton, elle se lit), et si
   *  elle n'est pas vide on la laisse d'abord repartir — c'est l'effet du
   *  dessous, qui repose la question après chaque rejeu. Tant qu'elle n'est pas
   *  partie, un bandeau le dit, et on reste. */
  const [saisiesRetenues, setSaisiesRetenues] = useState(false);
  useEffect(() => {
    void deciderIci().then(d => {
      if (d === 'partir') void rapatrier();
      else if (d === 'attendre') setSaisiesRetenues(true);
    });
  }, []);

  /** ⚠️ LES FRAPPES GARDÉES REPARTENT ICI, ET NULLE PART AILLEURS (FRE-118).
   *
   *  Au niveau de l'APPLICATION, pas de l'écran d'entraînement — c'est tout
   *  l'intérêt. Un athlète qui rouvre son téléphone au retour du réseau atterrit
   *  sur le tableau de bord ; si le rejeu vivait dans l'éditeur, sa séance
   *  attendrait qu'il retourne de lui-même au bon onglet. Vu dans le harnais
   *  réel : après rechargement, la valeur n'arrivait jamais.
   *
   *  Au démarrage ET à chaque retour de réseau. Les deux comptent : l'app peut
   *  être ouverte quand la connexion revient, comme elle peut être rouverte bien
   *  après. */
  useEffect(() => {
    if (!user) return;                  // il faut un jeton pour écrire
    /** ⚠️ CE QUI EST REJOUÉ DOIT ÊTRE RELU (FRE-144). Le rejeu écrivait au
     *  serveur sans rien invalider : au retour du réseau, la séance partait bien,
     *  mais les records et la forme du jour du tableau de bord — que brokkr
     *  dérive de ces lignes-là — restaient ceux d'avant. Et c'est précisément
     *  l'écran où l'athlète atterrit en rouvrant son téléphone.
     *
     *  Seulement si quelque chose est parti : `rejouerLaFile` rend le compte, et
     *  il vaut zéro à chaque `online` sans file en attente. */
    const rejouer = () => {
      // ⚠️ LA CHARPENTE AUSSI, PAS SEULEMENT LE RÉALISÉ. La file porte désormais
      // les gestes du coach — trame, renommage, suppression — et un refus au
      // rejeu laisse l'écran avec un objet que le serveur n'a pas : relire.
      void lireLaFile().then(file => {
        const programmes = new Set(file.map(e => e.programId));
        return rejouerLaFile().then(n => [n, programmes] as const);
      }).then(async ([n, programmes]) => {
        for (const p of programmes) invalider(queryClient, clesDeLArbre(p));
        if (n > 0) invalider(queryClient, clesDeriveesDuRealise());
        // Sur une ancienne adresse, la file vidée est le signal du départ (FRE-146).
        if (await deciderIci() === 'partir') await rapatrier();
      });
    };
    rejouer();
    window.addEventListener('online', rejouer);
    return () => window.removeEventListener('online', rejouer);
  }, [user]);
  /** ⚠️ ON ATTEND QUE FIREBASE AIT TRANCHÉ, ET C'EST LA MOITIÉ DU HORS-LIGNE.
   *
   *  Le cache persisté est jeté dès que le `buster` change. Or au rechargement,
   *  `onAuthStateChanged` n'a pas encore répondu : `user` vaut nul pendant une
   *  fraction de seconde. Monter la persistance à ce moment-là, c'est le buster
   *  sur « anonyme » et JETER le cache de l'utilisateur juste avant de le lire.
   *
   *  Vu en harnais réel : l'app rechargée sans brokkr n'arrivait même pas au
   *  tableau de bord — `me` avait été effacé une milliseconde plus tôt par le
   *  code censé le conserver. Un défaut d'ORDRE, invisible en ligne, où un
   *  aller-retour réseau réparait tout.
   *
   *  Cette attente ne coûte rien : Firebase restaure sa session depuis le disque,
   *  sans réseau, et l'écran affichait déjà ce même chargement en aval. */
  if (loading) {
    return <AuthCard><AuthSpinner /></AuthCard>;
  }
  return (
    <ProvisionHorsLigne client={queryClient} uid={user?.uid ?? null}>
      {saisiesRetenues && (
        <div role="status" className="bg-amber-500/15 px-4 py-2 text-center text-sm text-amber-200">
          <strong>{i18n.t('auth.saisiesRetenues')}</strong> {i18n.t('auth.saisiesRetenuesSuite')}
        </div>
      )}
      <AuthGate>
        <AthleteSelectionProvider>
          <ConfirmProvider>
            <RouterProvider router={router} />
            <Toaster richColors position="bottom-right" theme="dark" mobileOffset={{ bottom: 'calc(var(--barre-basse, 0px) + 16px)' }} />
          </ConfirmProvider>
        </AthleteSelectionProvider>
      </AuthGate>
    </ProvisionHorsLigne>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <Application />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);

/* ---------------------------------------------------------------------------
 * RETIRER L'INTRO — celle des deux qui a joué.
 *
 * Les deux blocs vivent dans `index.html` et peignent avant ce bundle ; c'est
 * l'attribut `data-intro`, posé là-bas avant le premier rendu, qui dit lequel
 * est à l'écran.
 *
 * ⚠️ LE PLANCHER EST UN PLANCHER, PAS UN DÉLAI AJOUTÉ. L'app est servie
 * cache-first : au deuxième lancement React monte en ~80 ms, et le voile ne
 * serait qu'un clignotement — pire que pas de voile du tout. Sur un démarrage
 * froid lent, `performance.now()` a déjà dépassé le plancher et l'attente vaut
 * zéro : on ne fait JAMAIS patienter quelqu'un qui a déjà patienté.
 *
 * ⚠️ ET LE PLANCHER DE L'OUVERTURE EST BIEN PLUS HAUT parce qu'elle ÉCRIT.
 * Couper « by French Forge » au milieu d'un mot est pire que ne rien montrer.
 * ------------------------------------------------------------------------- */
const modeIntro = document.documentElement.dataset.intro === 'open' ? 'open' : 'boot';
// ⚠️ ET CELLE DE LA STRUCTURE (FRE-13) : `boot`/`open` pour French Forge, `-sc`
// pour SCAPPULIFT, `-eg` pour ElGustoLift — `index.html` a déjà tranché avant ce
// bundle (`data-structure`).
const suffixe = ({ scappulift: '-sc', elgustolift: '-eg' } as Record<string, string>)[
  document.documentElement.dataset.structure ?? ''] ?? '';
const idIntro = `${modeIntro}${suffixe}`;
const intro = document.getElementById(idIntro);
// Les autres blocs n'ont jamais été peints (`display:none`) mais ils restent dans
// le DOM. On les retire tout de suite : ce qui n'est plus jouable n'a pas à traîner.
for (const id of ['boot', 'open', 'boot-sc', 'open-sc', 'boot-eg', 'open-eg']) {
  if (id !== idIntro) document.getElementById(id)?.remove();
}

if (intro) {
  let retire = false;
  const retirer = () => {
    if (retire) return;
    retire = true;
    intro.classList.add('done');
    // ⚠️ LA TRANSITION PEUT NE JAMAIS FINIR — onglet en arrière-plan, mouvement
    // réduit, `transitionend` avalé. Sans ce filet, le voile resterait au-dessus
    // de `#root` et l'app serait inatteignable. Le délai couvre les 300 ms de
    // fondu avec de la marge.
    const filet = setTimeout(() => intro.remove(), 600);
    intro.addEventListener('transitionend', () => { clearTimeout(filet); intro.remove(); },
                           { once: true });
  };

  // ⚠️ UNE PORTE DE SORTIE, ET ELLE N'EST PAS UN CONFORT. Le jour de
  // compétition, au bord du plateau, personne ne veut regarder une signature
  // s'écrire. Un appui, un clic ou une touche, et le voile part.
  ['pointerdown', 'keydown'].forEach(ev =>
    intro.addEventListener(ev, retirer, { once: true, passive: true }));
  window.addEventListener('keydown', retirer, { once: true, passive: true });

  // ⚠️ LE PLANCHER DE L'OUVERTURE TIENT COMPTE DU TEMPS DE LECTURE, pas
  // seulement de la fin de l'animation. La dernière lettre de « by French
  // Forge » s'écrit à 2,14 s et met 0,24 s à paraître : à 2 500 ms, l'état
  // final ne tenait que 120 ms — le temps de le voir, pas de le lire (retour de
  // William, 10/09). 4 400 ms laissent DEUX SECONDES sur la figure achevée.
  //
  // C'est long, et c'est assumé : l'ouverture ne joue qu'une fois par session,
  // et un appui la fait partir immédiatement (cf. la porte de sortie ci-dessus).
  const plancher = modeIntro === 'open' ? 4400 : 900;
  setTimeout(retirer, Math.max(0, plancher - performance.now()));
}
