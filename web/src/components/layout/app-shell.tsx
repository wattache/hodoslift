import { useLayoutEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogOut, MoonStar, SunMedium } from 'lucide-react';

import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider,
  SidebarTrigger, useSidebar,
} from '@/components/ui/sidebar';
import { LanguageToggle } from '@/components/ui/language-toggle';
import { NomHodosLift, SymboleHodos } from '@/components/marque-hodos';
import { ChoixDeStructure, SignatureDeStructure } from '@/components/layout/signature-de-structure';
// ⚠️ LA COMPOSITION DES SECTIONS VIT AILLEURS, et c'est délibéré : `sectionKine`
// décide qui voit quoi, et cette décision doit être TESTABLE. Le dev-mock n'a
// qu'un utilisateur, coach et kiné à la fois — le cas « coach sans être kiné »,
// soit tous les coachs sauf un, n'y est jouable par aucune spec.
import {
  NAV_COACH, NAV_PRINCIPALE, sectionAdmin, sectionKine, type EntreeNav,
} from '@/components/layout/nav-kine';
import { AjouterUnAthlete } from '@/components/ajouter-un-athlete';
import { SelecteurAthlete } from '@/components/layout/selecteur-athlete';
import { BandeauChrono, BoutonChrono, ChronoProvider, EspaceDuChrono } from '@/components/chrono';
import { cn } from '@/lib/utils';
import { useLocalStorageState } from '@/lib/storage';
import { useAthleteSelection } from '@/lib/athlete-selection';
import { useAuth } from '@/auth/auth-context';

type ThemeKey = 'dark' | 'light';

const THEME_STORAGE_KEY = 'eitri-theme';

function isThemeKey(value: unknown): value is ThemeKey {
  return value === 'dark' || value === 'light';
}

export function AppShell() {
  const [theme, setTheme] = useLocalStorageState<ThemeKey>(THEME_STORAGE_KEY, 'dark', isThemeKey);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <SidebarProvider>
      {/* Le chrono vit AU-DESSUS des routes : lancé d'un écran, il tourne encore
          sur les autres. */}
      <ChronoProvider>
      {/* ⚠️ LA ZONE DE LA BARRE D'ÉTAT APPARTIENT À L'EN-TÊTE, PAS AU CONTENEUR
          (16/09, capture iPhone : « le header semble flottant »). Le conteneur la
          réservait en marge, et l'en-tête collait JUSTE SOUS elle : au défilement,
          les séances passaient dans cette bande, derrière l'heure et la batterie,
          et l'en-tête avait l'air suspendu au milieu du contenu. L'en-tête colle
          maintenant en haut et PEINT la zone de la barre d'état. */}
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar theme={theme} onToggleTheme={() => setTheme(v => (v === 'dark' ? 'light' : 'dark'))} />
        <div className="flex flex-1 flex-col min-w-0">
          <header className="sticky top-0 z-20 box-content flex h-14 items-center gap-3 border-b border-border bg-background/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-md md:px-6">
            <SidebarTrigger className="-ml-1" />
            {/* ⚠️ LE CHOIX D'ATHLÈTE EST LE PREMIER ÉLÉMENT DE L'EN-TÊTE (constat 07).
                Il a quitté la barre latérale, où 35 personnes tenaient dans 248 px. */}
            <SelecteurAthlete />
            <div className="h-5 w-px shrink-0 bg-border" />
            <HeaderTitle />
            <span className="ml-auto hidden shrink-0 font-mono text-[10.5px] tracking-[0.1em] text-muted-foreground md:inline" aria-hidden>
              ⌘K
            </span>
            <BoutonChrono />
          </header>
          <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
            <Outlet />
            <EspaceDuChrono />
          </main>
        </div>
      </div>
      <BandeauChrono />
      </ChronoProvider>
    </SidebarProvider>
  );
}

function HeaderTitle() {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  /* ⚠️ PLUS DE SOUS-TITRE D'ATHLÈTE (constat 07) : le sélecteur, juste à gauche,
     porte le nom en entier. Le répéter en gris 11 px dessous le doublerait. */
  const titres: Record<string, string> = {
    '/dashboard': t('views.dashboard'),
    '/training': t('views.training'),
    '/tracker': t('views.tracker'),
    '/calendar': t('views.calendar'),
    '/guichet': t('nav.guichet'),
    '/competitions': t('views.competitions'),
    '/documentation': t('views.documentation'),
    '/library': t('views.library'),
    '/admin': t('views.admin'),
  };
  const titre = Object.entries(titres).find(([path]) => pathname.startsWith(path))?.[1] ?? 'French Forge';

  return (
    <div className="flex min-w-0 flex-1 flex-col leading-tight">
      <h1 className="truncate text-sm font-semibold tracking-tight">{titre}</h1>
    </div>
  );
}

/** L'intitulé d'une section — mono, espacé, et au `--muted-foreground` PLEIN.
 *
 *  ⚠️ IL ÉTAIT À `/40`, c'est-à-dire sous le seuil de contraste : un titre qu'on
 *  ne lit pas occupe quand même sa hauteur. Quatre intitulés pour onze entrées,
 *  et le plus long — « Navigation » — ne disait rien : dans une barre latérale,
 *  tout est de la navigation. Celui-là a sauté (§1.1) ; les deux autres restent,
 *  parce que « Kiné » et « Coach » désignent des PUBLICS différents — c'est ce
 *  que garde `nav-kine.test.ts`. */
const LIBELLE_SECTION =
  "h-6 px-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground";

/** `label` optionnel : sans lui, la section rend ses entrées sans titre. */
function NavSection({ label, entries, className }: {
  label?: string; entries: EntreeNav[]; className?: string;
}) {
  const { t } = useTranslation();
  const { isMobile, setOpenMobile } = useSidebar();
  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <SidebarGroup className={cn("px-2 py-1.5", className)}>
      {label && <SidebarGroupLabel className={LIBELLE_SECTION}>{label}</SidebarGroupLabel>}
      <SidebarGroupContent>
        <SidebarMenu>
          {entries.map(item => (
            <SidebarMenuItem key={item.to}>
              <NavLink to={item.to} onClick={closeMobile}>
                {({ isActive }) => (
                  <SidebarMenuButton
                    isActive={isActive}
                    tooltip={t(item.labelKey)}
                    className={cn(
                      'relative h-9 rounded-lg border border-transparent text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground',
                      isActive && 'border-sidebar-border/80 text-sidebar-accent-foreground ring-1',
                      isActive && item.accent.active,
                    )}
                  >
                    {/* ⚠️ L'ACCENT EN PERMANENCE, PAS SEULEMENT À L'ÉTAT ACTIF.
                        `ACCENTS` attribue une couleur par vue depuis toujours et
                        ne la sortait qu'au moment où l'on est DÉJÀ dessus — au
                        repos, sept glyphes gris identiques. Et c'est pire replié :
                        sans libellé, l'accent est le seul moyen de distinguer les
                        icônes du rail. Aucune couleur nouvelle, ce sont les tokens
                        du produit. */}
                    <item.icon className={cn('h-4 w-4', item.accent.icon)} />
                    <span>{t(item.labelKey)}</span>
                    <span className={cn('ml-auto h-1.5 w-1.5 rounded-full opacity-0 group-data-[collapsible=icon]:hidden', isActive && 'opacity-100', item.accent.dot)} />
                  </SidebarMenuButton>
                )}
              </NavLink>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function AppSidebar({ theme, onToggleTheme }: { theme: ThemeKey; onToggleTheme: () => void }) {
  const { t } = useTranslation();
  const { me } = useAthleteSelection();

  // La section « Kiné » se compose des entrées que CE staff-là peut atteindre :
  // les signalements pour le coach comme pour la kiné, les modèles pour elle
  // seule. Tableau vide → aucun titre affiché, donc rien pour un athlète.
  const kineNav = sectionKine(me);
  const adminNav = sectionAdmin(me);
  const { logout, devMode } = useAuth();
  const { isMobile, setOpenMobile } = useSidebar();
  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border/80 bg-sidebar/95">
        <div className="flex items-center gap-2.5 px-2 py-2" style={{ paddingRight: 'max(env(safe-area-inset-right), 0.5rem)' }}>
          {/* ⚠️ LA PLAQUE OR A SAUTÉ AVEC L'HALTÈRE. Elle existait pour donner
              une assise à une icône de trait ; le symbole est un aplat, et
              l'enfermer dans un rectangle plein de la même couleur revenait à
              le peindre sur lui-même. C'est aussi la seule chose qui reste
              visible quand la barre est repliée : elle doit être le SYMBOLE,
              pas un contenant. */}
          <div className="flex h-9 w-9 shrink-0 items-center justify-center text-gold">
            <SymboleHodos className="h-7 w-7" />
          </div>
          <div className="flex min-w-0 flex-col leading-tight group-data-[collapsible=icon]:hidden">
            {/* ⚠️ EN CAPITALES, DANS LA POLICE D'AFFICHAGE — c'est un logotype,
                pas un mot de texte. Il était rendu comme un libellé ordinaire
                (`text-sm font-semibold`), au même poids que « Tableau de bord »
                deux centimètres plus bas : le nom du produit ne se distinguait
                d'aucune entrée de menu. La maquette le porte en majuscules, et
                c'est ce qui le sépare de la signature en bas-de-casse
                juste dessous. Barlow Condensed le rend en 38 px sur les 69
                disponibles — mesuré à l'écran, pas estimé. */}
            <span className="truncate font-display text-sm font-bold uppercase tracking-[0.08em]"><NomHodosLift /></span>
            {/* ⚠️ EN MINUSCULES, ET CE N'EST PAS UN CHOIX DE STYLE. « Trainer »
                qu'il remplace tenait en un mot ; « by French Forge » en fait
                trois, dans une colonne large de 73 px que fixe la barre
                repliable. Mesuré à l'écran, les cinq candidats :

                  10px MAJ .06em → 92 px      9px MAJ .04em → 80 px
                  10px MAJ 0     → 83 px     11px minuscules → 76 px
                  10px minuscules → 69 px    ← le seul qui tienne

                Rétrécir encore aurait donné du 8 px illisible pour garder des
                capitales. La signature se lit mieux en bas-de-casse. */}
            <SignatureDeStructure />
          </div>
          <button
            type="button"
            onClick={() => { closeMobile(); onToggleTheme(); }}
            className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-sidebar-border/80 bg-sidebar-accent/45 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:ml-0"
            title={t(theme === 'dark' ? 'nav.passerEnModeClair' : 'nav.passerEnModeSombre')}
            aria-label={t(theme === 'dark' ? 'nav.passerEnModeClair' : 'nav.passerEnModeSombre')}
          >
            {theme === 'dark' ? <SunMedium className="h-4 w-4" /> : <MoonStar className="h-4 w-4" />}
          </button>
          <LanguageToggle onSwitched={closeMobile} />
        </div>
        <ChoixDeStructure />
      </SidebarHeader>

      <SidebarContent className="gap-1 py-2">
        {/* ⚠️ PLUS DE LISTE D'ATHLÈTES ICI (Passe 3, constat 07, 14/09). Le choix
            d'athlète est le premier élément de l'en-tête (`SelecteurAthlete`) : la
            colonne redevient la navigation seule, avec ses accents au repos. Les
            vues scopées restent où FRE-68 les a mises, dans les onglets de
            l'espace athlète. */}
        <NavSection entries={NAV_PRINCIPALE} />
        {/* ⚠️ `nav.sectionKine` ET NON `nav.kine` : ce dernier titre l'onglet
            « Suivi kiné » de l'espace athlète, qui parle d'UN athlète précis.
            Réutiliser la clé aurait fait dire « Suivi kiné » à une section qui
            porte aussi le catalogue des modèles — lequel n'appartient à
            personne. */}
        {kineNav.length > 0 && <NavSection label={t('nav.sectionKine')} entries={kineNav} />}
        {me?.isCoach && <NavSection label={t('nav.coach')} entries={NAV_COACH} />}
        {adminNav.length > 0 && <NavSection entries={adminNav} />}
        {/* ⚠️ AJOUTER UN ATHLÈTE RESTE UN GESTE DE COACH (`POST /athletes` est en
            `require_coach`), et il reste dans la colonne : il vivait sous la liste
            d'athlètes, qui est partie dans l'en-tête. Sous la section Coach. */}
        {me?.isCoach && (
          <SidebarGroup className="px-2 py-0">
            <SidebarGroupContent>
              <SidebarMenu><AjouterUnAthlete /></SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {!devMode && (
          <SidebarGroup className="mt-auto px-2 py-1.5">
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip={t('nav.logout')}
                    className="h-9 rounded-lg text-sidebar-foreground/60 hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground"
                    onClick={() => void logout()}
                  >
                    <LogOut className="h-4 w-4 text-sidebar-foreground/50" />
                    <span>{t('nav.logout')}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      {/* Le numéro de l'app, et au survol le commit exact qu'on regarde. */}
      <SidebarFooter className="px-4 pb-3 pt-0 group-data-[collapsible=icon]:hidden">
        <span className="font-mono text-[10px] text-gold" title={import.meta.env.VITE_GIT_SHA}>
          v{import.meta.env.VITE_APP_VERSION}
        </span>
      </SidebarFooter>
    </Sidebar>
  );
}
