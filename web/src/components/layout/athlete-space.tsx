import { Activity, CalendarDays, Dumbbell, HeartPulse, LayoutDashboard, ShieldCheck, UserRound } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';
import { AthleteAvatar } from '@/components/athlete-avatar';
import { useAthleteSelection } from '@/lib/athlete-selection';
import { useIsMobile } from '@/lib/use-mobile';
import { cn } from '@/lib/utils';

/** L'ESPACE ATHLÈTE (FRE-68) : une fois sur un athlète, des onglets INTERNES.
 *
 *  ⚠️ LA LISTE DES ONGLETS NE DÉRIVE PLUS DES PERMISSIONS. Elle l'a fait, pour un
 *  seul cas : le kiné, réduit au seul Training parce qu'il n'avait alors que la
 *  lecture. Il gère désormais son athlète comme le coach (2026-08-18), plus
 *  personne n'est dans ce régime, et un aiguillage qui ne distingue plus rien est
 *  un détour à lire pour rien. Les vues gardent leurs propres `canView`.
 *
 *  Ce qui reste vrai, et qui est le vrai point du fichier : la sélection
 *  d'athlète et la navigation étaient deux axes INDÉPENDANTS (une sidebar
 *  globale × un athlète global), donc toutes les combinaisons existaient — dont
 *  « Laura sélectionnée × Calendrier » qui affichait le monde de la kiné
 *  connectée. Les renvois posés ce jour-là dans chaque vue étaient des rustines
 *  sur des combinaisons qui ne devraient pas pouvoir se produire ; ce layout
 *  les supprime en rendant la combinaison inconstructible.
 *
 *  Les URL ne bougent pas (/dashboard, /training, /tracker, /calendar) : les
 *  favoris, la PWA installée et le harnais e2e survivent — seule la STRUCTURE
 *  qui les porte change.
 */

type Onglet = {
  to: string;
  labelKey: string;
  icon: typeof Dumbbell;
  /** Accents alignés sur la sidebar (mêmes familles de couleurs). */
  actif: string;
  icone: string;
  /** Au téléphone, la barre du bas ne le porte pas. */
  horsBarreBasse?: boolean;
};

const ONGLETS: Onglet[] = [
  { to: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard,
    actif: 'border-gold text-gold', icone: 'text-gold' },
  { to: '/training', labelKey: 'nav.training', icon: Dumbbell,
    actif: 'border-success text-success', icone: 'text-success' },
  // ⚠️ PAS D'ONGLET « PROGRAMME » : le bloc en tableau vit dans le Tracker, avec
  // ses propres sélecteurs de macro et de bloc. Un onglet à lui affichait le
  // bloc choisi dans un AUTRE écran — il fallait sortir, sélectionner, revenir.
  { to: '/tracker', labelKey: 'nav.tracker', icon: Activity,
    actif: 'border-block-accumulation text-block-accumulation', icone: 'text-block-accumulation' },
  { to: '/calendar', labelKey: 'nav.calendar', icon: CalendarDays,
    actif: 'border-block-accumulation text-block-accumulation', icone: 'text-block-accumulation' },
  // SUIVI KINÉ (2026-08-18) : l'athlète rapporte son état, son staff le lit. En
  // dernier parce que c'est le plus récent et le moins fréquenté — pas parce
  // qu'il compte moins.
  // ⚠️ JETON NOMMÉ, pas de valeur arbitraire `border-[var(--serie-poids)]` : celle
  // que j'avais écrite d'abord ne produisait AUCUN style — l'onglet était bien
  // `aria-current` mais restait gris. `--color-serie-poids` est déclaré dans le
  // `@theme` d'`index.css`, c'est lui qui donne les utilitaires `*-serie-poids`.
  { to: '/kine', labelKey: 'nav.kine', icon: HeartPulse,
    actif: 'border-serie-poids text-serie-poids', icone: 'text-serie-poids' },
  // LA FICHE (27/09) : un onglet dédié, pour y ranger la suite. ⚠️ PAS DANS LA
  // BARRE DU BAS : « les boutons actuels sont très bien » (William) — au
  // téléphone, on y entre par le tableau de bord.
  { to: '/profil', labelKey: 'nav.profil', icon: UserRound,
    actif: 'border-gold text-gold', icone: 'text-gold', horsBarreBasse: true },
];
const ONGLETS_DE_LA_BARRE_BASSE = ONGLETS.filter(o => !o.horsBarreBasse);

/** La hauteur de la barre basse, hors zone du geste d'accueil. Publiée en
 *  variable CSS tant que la barre existe : le bandeau du chrono et les toasts se
 *  posent AU-DESSUS d'elle, et la page réserve sa place en bas. */
const HAUTEUR_BARRE_BASSE = '64px';

/** LA BARRE BASSE, AU TÉLÉPHONE (Passe 3, constat 01 · 14/09).
 *
 *  ⚠️ LES ONGLETS DÉFILAIENT AVEC LA PAGE. Posés en haut de l'espace athlète, ils
 *  disparaissaient dès la troisième ligne de la séance : pour passer au suivi en
 *  fin de séance, il fallait remonter tout l'écran. Fixés en bas, ils restent
 *  sous le pouce.
 *
 *  ⚠️ LES MÊMES DESTINATIONS QU'EN HAUT, pas celles de la maquette. Elle proposait
 *  « Aujourd'hui · Programme · Suivi », mais « Aujourd'hui » supposait de savoir
 *  quand l'athlète fait sa séance — or on les échange (William, 14/09). On
 *  arrive déjà sur l'entraînement.
 *
 *  ⚠️ RENDUE OU NON, JAMAIS CACHÉE EN CSS (`useIsMobile`) : deux jeux de liens
 *  dans le DOM dupliqueraient chaque destination pour un lecteur d'écran et pour
 *  le harnais.
 *
 *  L'icône porte son accent AU REPOS : cinq glyphes gris identiques ne se
 *  distinguent pas d'un coup d'œil. L'état actif ajoute le filet et la couleur du
 *  libellé. */
function BarreBasse() {
  const { t } = useTranslation();
  useEffect(() => {
    const racine = document.documentElement.style;
    racine.setProperty('--barre-basse', HAUTEUR_BARRE_BASSE);
    return () => { racine.removeProperty('--barre-basse'); };
  }, []);

  return (
    <nav
      aria-label={t('nav.navigation')}
      className="fixed inset-x-0 bottom-0 z-30 grid border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
      style={{ gridTemplateColumns: `repeat(${ONGLETS_DE_LA_BARRE_BASSE.length}, minmax(0, 1fr))` }}
    >
      {ONGLETS_DE_LA_BARRE_BASSE.map(o => (
        <NavLink key={o.to} to={o.to} className="min-w-0">
          {({ isActive }) => (
            <span
              className={cn(
                'flex h-16 flex-col items-center justify-center gap-1 border-t-2 border-transparent px-0.5 text-center text-[11px] font-medium leading-tight text-muted-foreground [hyphens:auto]',
                isActive && o.actif,
              )}
            >
              <o.icon className={cn('h-5 w-5 shrink-0', o.icone)} aria-hidden />
              {t(o.labelKey)}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export function AthleteSpace() {
  const { t } = useTranslation();
  const telephone = useIsMobile();
  const sel = useAthleteSelection();
  const athlete = sel.selected;

  // ⚠️ IL Y AVAIT ICI TROIS RÉGIMES D'ONGLETS, dont un « suivi » qui réduisait la
  // vue du kiné au seul Training. Il n'en reste aucun : le kiné voit les mêmes
  // onglets que le coach (2026-08-18), et les vues portent déjà leurs propres
  // gardes `canView`. Un régime qui ne distingue plus rien est un détour à lire
  // pour rien — et le renvoi d'URL qu'il fallait avec lui.

  // Les PASTILLES décrivent les TITRES, cumulables — pas le régime effectif.
  // Un coach-kiné voit « Coach » ET « Suivi kiné » sur le même athlète : les
  // deux liens existent, les deux se disent. (Le régime des onglets, lui,
  // prend le plus fort : canManage l'emporte.)
  const estSuivi = Boolean(athlete && sel.suivisIds.has(athlete.id));

  const initials = athlete
    ? `${athlete.firstName[0] ?? ''}${athlete.lastName[0] ?? ''}`.toUpperCase()
    : '';

  return (
    <div className="flex flex-col gap-4">
      {/* L'en-tête de l'espace : QUI on regarde, à quel TITRE, et les onglets. */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 px-4 pb-0 pt-3">
          {athlete && (
            <AthleteAvatar
              initials={initials}
              alt={`Photo de ${athlete.firstName} ${athlete.lastName}`}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gold/30 bg-secondary text-xs font-semibold text-gold"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold tracking-tight">
                {athlete ? `${athlete.firstName} ${athlete.lastName}` : '—'}
              </h2>
              {sel.isSelf && (
                <span className="inline-flex items-center gap-1 rounded-md border border-gold/25 bg-gold/10 px-1.5 py-0.5 text-[10px] font-medium text-gold">
                  <UserRound className="h-2.5 w-2.5" /> {t('espace.monProfil')}
                </span>
              )}
              {sel.canManage && !sel.isSelf && (
                <span className="inline-flex items-center gap-1 rounded-md border border-gold/25 bg-gold/10 px-1.5 py-0.5 text-[10px] font-medium text-gold">
                  <ShieldCheck className="h-2.5 w-2.5" /> {t('espace.coach')}
                </span>
              )}
              {estSuivi && (
                <span className="inline-flex items-center gap-1 rounded-md border border-success/25 bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">
                  <HeartPulse className="h-2.5 w-2.5" /> {t('espace.suiviKine')}
                </span>
              )}
            </div>
            {athlete && (athlete.weight || athlete.height) && (
              <p className="text-[11px] text-muted-foreground">
                {[athlete.weight && `${athlete.weight} kg`, athlete.height && `${athlete.height} cm`]
                  .filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        </div>

        {/* Les onglets — des NavLink : mêmes libellés et même sémantique de lien
            que l'ancienne sidebar, pour les lecteurs d'écran comme pour le
            harnais.

            ⚠️ SOUS 640 PX, RIEN NE DÉFILE (retour utilisateur, 12/09 : « pas
            pratique sur tel d'avoir des menus où faut glisser »). L'icône passe
            au-dessus du libellé, le libellé revient à la ligne, et les cinq
            onglets (quatre sans suivi kiné) se partagent la largeur en colonnes
            égales. On perd la lecture « d'un trait » ; on ne perd plus une
            destination cachée à droite. Pas de libellé court pour mobile : un
            texte qui change selon la largeur casse le harnais autant que la
            mémoire. */}
        {!telephone && (
        <nav className="flex px-1 sm:gap-1 sm:px-2" aria-label={t('nav.navigation')}>
          {ONGLETS.map(o => (
            <NavLink key={o.to} to={o.to} className="min-w-0 flex-1 basis-0 sm:flex-none">
              {({ isActive }) => (
                <span
                  className={cn(
                    'flex h-full min-h-11 flex-col items-center justify-center gap-1 border-b-2 border-transparent px-1 py-1.5 text-center text-[11px] font-medium leading-tight text-muted-foreground transition-colors [hyphens:auto] hover:text-foreground',
                    'sm:flex-row sm:gap-1.5 sm:whitespace-nowrap sm:px-3 sm:py-2.5 sm:text-sm',
                    isActive && o.actif,
                  )}
                >
                  <o.icon className={cn('h-4 w-4 shrink-0', isActive && o.icone)} />
                  {t(o.labelKey)}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        )}
      </div>

      <Outlet />
      {telephone && (
        <>
          {/* La place de la barre, pour qu'elle ne cache pas la dernière ligne. */}
          <div aria-hidden className="h-16 shrink-0" />
          <BarreBasse />
        </>
      )}
    </div>
  );
}
