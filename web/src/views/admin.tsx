import { useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Clock, Crown, Dumbbell, Lock, Search, Shield, Stethoscope } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

import { useMe } from '@/api/hooks/use-me';
import { useAnnuaireAthletes, useAccesSupport, useReassignCoach } from '@/api/hooks/use-athletes';
import { useSetUserCoach, useSetUserKine, useUsers } from '@/api/hooks/use-users';
import { useStructure } from '@/api/hooks/use-structure-choisie';
import type { AthleteAnnuaire, UserRow } from '@/api/types';
import { Input } from '@/components/ui/input';
import { useAthleteSelection } from '@/lib/athlete-selection';
import { formatMoment } from '@/lib/dates-ui';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

/** VUE ADMIN — RANGÉE PAR PERSONNE (19/09).
 *
 *  Elle était rangée par rôle : trois blocs (coachs, kinés, athlètes), chacun
 *  avec son champ « promouvoir ». La même personne y figurait jusqu'à trois
 *  fois, et le tableau des athlètes ne tenait pas sur un téléphone. Ici : UNE
 *  liste de personnes, filtrée par des pastilles qui sont aussi les compteurs,
 *  et UNE fiche par personne où tout se règle — un interrupteur par rôle, le
 *  coach qui la suit, les athlètes qu'elle suit.
 *
 *  ⚠️ L'ADMIN ADMINISTRE LA STRUCTURE SÉLECTIONNÉE (FRE-13). Un rôle est lu et
 *  posé DANS cette structure (`coachStructure`, `kineStructure`, la fiche de
 *  `/athletes/annuaire?structure=`, bornée par brokkr) ; un coach d'une autre
 *  structure y apparaît sans rôle, avec la mention de là où il coache. Administrer SCAPPULIFT, c'est
 *  d'abord y aller — par le menu de la barre latérale.
 *
 *  ⚠️ LE RÔLE ATHLÈTE NE SE COMMUTE PAS ICI, et ce n'est pas un oubli : aucune
 *  route ne donne ni ne retire ce rôle à un compte. Une fiche naît par « Ajouter
 *  un athlète » (coach), et se lie au compte à sa première connexion
 *  (`POST /athletes/link`). L'interrupteur montre l'état, il ne l'écrit pas.
 *
 *  Sur téléphone, la liste et la fiche sont deux écrans (retour « ‹ Équipe ») ;
 *  à partir de `lg` (1024 px), la liste à gauche et la fiche à droite. */

type Filtre = 'equipe' | 'athletes' | 'coachs' | 'kines' | 'sans-role';

/** Une personne de la structure : un compte (`uid`), ou une fiche athlète pas
 *  encore liée à un compte (`uid` nul, `cle` = `fiche:<id>`). */
interface Personne {
  cle: string;
  uid: string | null;
  nom: string;
  email: string;
  initiales: string;
  isAdmin: boolean;
  coach: boolean;
  kine: boolean;
  /** Le slug de la structure où il coache / exerce / s'entraîne, si ce n'est pas ici. */
  coachAilleurs: string | null;
  kineAilleurs: string | null;
  athleteAilleurs: string[];
  fiche: AthleteAnnuaire | null;
}

const nomDe = (u: UserRow) => u.displayName || u.email || u.uid;
const initialesDe = (nom: string) =>
  nom.split(/\s+/).filter(Boolean).slice(0, 2).map(m => m[0]).join('').toUpperCase() || '?';
const nomDeFiche = (a: AthleteAnnuaire) => `${a.firstName} ${a.lastName ?? ''}`.trim();

const aUnRole = (p: Personne) => Boolean(p.fiche || p.coach || p.kine);

/** ⚠️ SANS RÔLE NULLE PART. Un athlète ElGustoLift vu depuis French Forge n'a
 *  rien ICI, mais ce n'est pas quelqu'un à qui il reste un rôle à donner
 *  (William, 19/09). Il apparaît en cherchant son nom, avec « Athlète chez … ».
 *
 *  Hors du composant : ces deux règles ne dépendent que de la personne, et les
 *  garder dedans les rendait « manquantes » dans les dépendances du `useMemo`
 *  qui filtre la liste. */
const sansRoleNullePart = (p: Personne) =>
  !aUnRole(p) && !p.coachAilleurs && !p.kineAilleurs && p.athleteAilleurs.length === 0;

export function AdminView() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const isAdmin = !!me?.isAdmin;

  const { data: users = [], isLoading: usersLoading } = useUsers(isAdmin);
  // L'annuaire : toutes les fiches de la structure, sept champs (FRE-190).
  const { data: athletes = [], isLoading: athletesLoading } = useAnnuaireAthletes(isAdmin);
  const setUserCoach = useSetUserCoach();
  const setUserKine = useSetUserKine();
  const reassignCoach = useReassignCoach();
  const accesSupport = useAccesSupport();
  const { setSelectedId } = useAthleteSelection();
  const navigate = useNavigate();

  const { courante } = useStructure();
  const slug = courante?.slug;
  const nomDeStructure = (s: string) => me?.structures.find(x => x.slug === s)?.nom ?? s;

  const [filtre, setFiltre] = useState<Filtre>('equipe');
  const [recherche, setRecherche] = useState('');
  const [selection, setSelection] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const personnes = useMemo<Personne[]>(() => {
    const ficheDe = new Map<string, AthleteAnnuaire>();
    for (const a of athletes) if (a.linkedUserId) ficheDe.set(a.linkedUserId, a);
    const comptes = users.map<Personne>(u => {
      const nom = nomDe(u);
      return {
        cle: u.uid, uid: u.uid, nom, email: u.email, initiales: initialesDe(nom), isAdmin: u.isAdmin,
        coach: u.isCoach && (!slug || u.coachStructure === slug),
        kine: u.isKine && (!slug || u.kineStructure === slug),
        coachAilleurs: u.isCoach && slug && u.coachStructure && u.coachStructure !== slug ? u.coachStructure : null,
        kineAilleurs: u.isKine && slug && u.kineStructure && u.kineStructure !== slug ? u.kineStructure : null,
        athleteAilleurs: u.athleteStructures.filter(x => x !== slug),
        fiche: ficheDe.get(u.uid) ?? null,
      };
    });
    // Une fiche sans compte est une personne aussi : c'est elle qu'on réaffecte.
    const sansCompte = athletes.filter(a => !a.linkedUserId).map<Personne>(a => {
      const nom = nomDeFiche(a);
      return {
        cle: `fiche:${a.id}`, uid: null, nom, email: a.email ?? '', initiales: initialesDe(nom), isAdmin: false,
        coach: false, kine: false, coachAilleurs: null, kineAilleurs: null, athleteAilleurs: [], fiche: a,
      };
    });
    return [...comptes, ...sansCompte].sort((a, b) => a.nom.localeCompare(b.nom));
  }, [users, athletes, slug]);

  const coachs = useMemo(() => personnes.filter(p => p.coach && p.uid), [personnes]);
  const nomDuCoach = (uid: string | null | undefined) =>
    coachs.find(c => c.uid === uid)?.nom ?? t('admin.coachInconnu');
  const athletesDe = (uid: string) => personnes.filter(p => p.fiche?.coachId === uid);
  const suivisDe = (uid: string) => personnes.filter(p => p.fiche?.kineUid === uid);

  const compteurs: Record<Filtre, number> = {
    equipe: personnes.filter(aUnRole).length,
    athletes: personnes.filter(p => p.fiche).length,
    coachs: coachs.length,
    kines: personnes.filter(p => p.kine).length,
    'sans-role': personnes.filter(sansRoleNullePart).length,
  };

  const q = recherche.trim().toLowerCase();
  const liste = useMemo(() => {
    if (q) return personnes.filter(p => p.nom.toLowerCase().includes(q) || p.email.toLowerCase().includes(q));
    switch (filtre) {
      case 'equipe': return personnes.filter(aUnRole);
      case 'athletes': return personnes.filter(p => p.fiche);
      case 'coachs': return coachs;
      case 'kines': return personnes.filter(p => p.kine);
      // Ceux à qui il reste un rôle à donner — la liste, pas seulement le
      // compteur : « Sans rôle ne montre rien » (William, 19/09).
      case 'sans-role': return personnes.filter(sansRoleNullePart);
    }
  }, [personnes, coachs, filtre, q]);

  const selectionnee = personnes.find(p => p.cle === selection) ?? null;

  const onError = (e: unknown) =>
    toast.error(e instanceof Error ? e.message : t('misc.roleChangeFailed'));

  const poserCoach = (uid: string, isCoach: boolean) => {
    setSavingId(uid);
    setUserCoach.mutate({ uid, isCoach, structure: isCoach ? slug : undefined },
      { onError, onSettled: () => setSavingId(null) });
  };
  // Le retrait d'un kiné qui suit encore des athlètes rend 409 côté serveur
  // (FK RESTRICT) : le message remonte tel quel — « détache d'abord ».
  const poserKine = (uid: string, isKine: boolean) => {
    setSavingId(uid);
    setUserKine.mutate({ uid, isKine, structure: isKine ? slug : undefined },
      { onError, onSettled: () => setSavingId(null) });
  };
  const reaffecter = (athleteId: string, coachUid: string) => {
    if (!coachUid) return;
    setSavingId(athleteId);
    reassignCoach.mutate({ athleteId, coachUid }, { onError, onSettled: () => setSavingId(null) });
  };
  /** Ouvrir ou fermer un accès support (FRE-202). Ouvert, on va droit sur la
   *  fiche : c'est pour elle qu'on l'a prise. */
  const support = (athleteId: string, ouvrir: boolean) => {
    setSavingId(athleteId);
    accesSupport.mutate({ athleteId, ouvrir }, {
      onError,
      onSuccess: () => { if (ouvrir) { setSelectedId(athleteId); void navigate('/dashboard'); } },
      onSettled: () => setSavingId(null),
    });
  };

  const loading = usersLoading || athletesLoading;
  const isEmptyAdmin = !loading && (!isAdmin || (users.length === 0 && athletes.length === 0));

  const FILTRES: { id: Filtre; label: string }[] = [
    { id: 'equipe', label: t('admin.equipe') },
    { id: 'athletes', label: t('admin.athletes') },
    { id: 'coachs', label: t('admin.coachs') },
    { id: 'kines', label: t('admin.kines') },
    { id: 'sans-role', label: t('admin.sansRole') },
  ];

  return (
    // ⚠️ LES DEUX COLONNES TIENNENT DANS UN SEUL ÉCRAN, ET CHACUNE DÉFILE CHEZ
    // ELLE. Avant, la page entière défilait : la liste fait 71 personnes, donc
    // cliquer quelqu'un en bas changeait une fiche restée tout en haut, hors
    // champ — « j'avais l'impression que rien ne se passait » (William, 23/09).
    // Un écran qui répond ailleurs qu'où l'on regarde ne répond pas.
    // Sous `lg`, la liste et la fiche s'excluent déjà (`hidden lg:flex`) : rien
    // à cloisonner, c'est la page qui défile.
    <div className="mx-auto w-full max-w-6xl lg:grid lg:h-[calc(100vh-10rem)] lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:items-stretch lg:gap-6 lg:overflow-hidden">
      {/* ⚠️ « INVITER UN ATHLÈTE » VIT DANS LA SIDEBAR (`AjouterUnAthlete`) : le
          serveur ne demande que `require_coach`, et il doit être disponible
          depuis toutes les vues. Ici, seulement ce qui est PROPRE à l'admin. */}
      <div className={cn('flex min-h-0 flex-col gap-3', selectionnee && 'hidden lg:flex')}>
        <p className="font-mono text-[11px] text-muted-foreground">
          {t('admin.inscrits', { count: users.length })}
          <span className="hidden lg:inline"> · {t('admin.dansLEquipe', { count: compteurs.equipe })}</span>
        </p>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={recherche} onChange={e => setRecherche(e.target.value)}
                 placeholder={t('admin.rechercher', { count: users.length })}
                 aria-label={t('admin.rechercherLabel')} className="h-11 pl-10 text-sm" />
        </div>

        {/* Les filtres SONT les compteurs. Sur téléphone la rangée défile. */}
        <div role="tablist" aria-label={t('admin.filtres')}
             className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0 [scrollbar-width:none]">
          {FILTRES.map(f => (
            <button key={f.id} type="button" role="tab" aria-selected={filtre === f.id && !q}
                    onClick={() => { setFiltre(f.id); setRecherche(''); }}
                    className={cn(
                      'flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm transition-colors',
                      filtre === f.id && !q
                        ? 'border-gold bg-gold font-semibold text-gold-foreground'
                        : 'border-border bg-card text-foreground hover:bg-accent/40',
                    )}>
              {f.label}
              <span className={cn('font-mono text-xs tabular-nums', filtre === f.id && !q ? 'text-gold-foreground/70' : 'text-muted-foreground')}>
                {compteurs[f.id]}
              </span>
            </button>
          ))}
        </div>

        {isEmptyAdmin && (
          <div className="rounded-lg border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
            {t('admin.donneesIndisponibles')}
          </div>
        )}

        <div className="flex items-center justify-between px-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          <span>{q ? t('admin.resultats') : FILTRES.find(f => f.id === filtre)?.label}</span>
          <span className="tabular-nums">{liste.length} / {q ? personnes.length : compteurs[filtre]}</span>
        </div>

        <ul aria-label={t('admin.personnes')}
            // ⚠️ `min-h-0` SUR LE PARENT FLEX, sinon cette boîte refuse de
            // rétrécir et déborde au lieu de défiler : un enfant flex a
            // `min-height: auto` par défaut, donc la taille de son contenu.
            className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-card divide-y divide-border lg:overscroll-contain">
          {liste.map(p => (
            <li key={p.cle}>
              <button type="button" onClick={() => setSelection(p.cle)}
                      className={cn(
                        'flex min-h-[64px] w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/30',
                        selection === p.cle && 'bg-accent/40 shadow-[inset_3px_0_0_0_hsl(var(--gold))]',
                      )}>
                <Avatar p={p} taille="h-10 w-10 text-xs" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-sm font-medium">{p.nom}</span>
                    <Badges p={p} />
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    <LigneUtile p={p} nomDuCoach={nomDuCoach} nAthletes={p.uid ? athletesDe(p.uid).length : 0}
                                nSuivis={p.uid ? suivisDe(p.uid).length : 0} nomDeStructure={nomDeStructure} />
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </li>
          ))}
          {liste.length === 0 && !isEmptyAdmin && (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">
              {q ? t('admin.aucunResultat') : t('admin.aucunePersonne')}
            </li>
          )}
        </ul>
      </div>

      <div className={cn('min-h-0 lg:overflow-y-auto lg:pr-1',
                         !selectionnee && 'hidden lg:block')}>
        {selectionnee ? (
          <Fiche
            key={selectionnee.cle}
            p={selectionnee}
            coachs={coachs}
            athletes={selectionnee.uid ? athletesDe(selectionnee.uid) : []}
            suivis={selectionnee.uid ? suivisDe(selectionnee.uid) : []}
            occupe={savingId === selectionnee.uid || savingId === selectionnee.fiche?.id}
            nomDeStructure={nomDeStructure}
            onRetour={() => setSelection(null)}
            onOuvrir={setSelection}
            poserCoach={poserCoach}
            poserKine={poserKine}
            reaffecter={reaffecter}
            support={support}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-card/40 p-10 text-center text-sm text-muted-foreground">
            {t('admin.choisirUnePersonne')}
          </div>
        )}
      </div>
    </div>
  );
}

function Avatar({ p, taille }: { p: Personne; taille: string }) {
  // Décoratif : le nom accessible d'une ligne commence par le NOM, pas par « CD ».
  return (
    <span aria-hidden className={cn('flex shrink-0 items-center justify-center rounded-full font-semibold', taille,
                        p.coach ? 'bg-gold/15 text-gold' : p.kine ? 'bg-success/15 text-success' : 'bg-muted text-foreground')}>
      {p.initiales}
    </span>
  );
}

function Badges({ p }: { p: Personne }) {
  const { t } = useTranslation();
  const badge = 'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium';
  return (
    <>
      {p.fiche && <span className={cn(badge, 'bg-muted text-muted-foreground')}><Dumbbell className="h-2.5 w-2.5" /> {t('admin.athlete')}</span>}
      {p.coach && <span className={cn(badge, 'bg-gold/15 text-gold')}><Crown className="h-2.5 w-2.5" /> {t('admin.coach')}</span>}
      {p.kine && <span className={cn(badge, 'bg-success/15 text-success')}><Stethoscope className="h-2.5 w-2.5" /> {t('admin.kine')}</span>}
      {p.isAdmin && <span className={cn(badge, 'bg-muted text-foreground')}><Shield className="h-2.5 w-2.5" /> {t('admin.admin')}</span>}
    </>
  );
}

/** Ce qui compte d'un coup d'œil : par qui il est suivi, combien il en suit. */
function LigneUtile({ p, nomDuCoach, nAthletes, nSuivis, nomDeStructure }: {
  p: Personne; nomDuCoach: (uid: string | null | undefined) => string;
  nAthletes: number; nSuivis: number; nomDeStructure: (s: string) => string;
}) {
  const { t } = useTranslation();
  const parts: string[] = [];
  if (p.coach) parts.push(t('admin.athletesSuivis', { count: nAthletes }));
  if (p.kine && nSuivis > 0) parts.push(t('admin.suivisKine', { count: nSuivis }));
  if (p.fiche) parts.push(t('admin.suiviPar', { coach: nomDuCoach(p.fiche.coachId) }));
  if (p.coachAilleurs) parts.push(t('admin.coachChez', { structure: nomDeStructure(p.coachAilleurs) }));
  if (p.kineAilleurs) parts.push(t('admin.kineChez', { structure: nomDeStructure(p.kineAilleurs) }));
  for (const s of p.athleteAilleurs) parts.push(t('admin.athleteChez', { structure: nomDeStructure(s) }));
  return <>{parts.length ? parts.join(' · ') : p.email || t('admin.sansRoleIci')}</>;
}

/** L'interrupteur d'un rôle — 44 px de zone tactile, le bouton natif porte
 *  `role="switch"` : lisible par un lecteur d'écran, et par les specs. */
function Interrupteur({ checked, disabled, onChange, label }: {
  checked: boolean; disabled?: boolean; onChange?: (v: boolean) => void; label: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
            onClick={() => onChange?.(!checked)}
            className={cn('flex h-11 w-14 shrink-0 items-center justify-center outline-none focus-visible:ring-1 focus-visible:ring-gold',
                          disabled && 'cursor-not-allowed opacity-60')}>
      <span className={cn('relative h-7 w-12 rounded-full transition-colors', checked ? 'bg-gold' : 'bg-muted')}>
        <span className={cn('absolute top-1 h-5 w-5 rounded-full shadow transition-all',
                            checked ? 'left-6 bg-background' : 'left-1 bg-muted-foreground/70')} />
      </span>
    </button>
  );
}

function Fiche({ p, coachs, athletes, suivis, occupe, nomDeStructure, onRetour, onOuvrir, poserCoach, poserKine, reaffecter, support }: {
  p: Personne; coachs: Personne[]; athletes: Personne[]; suivis: Personne[]; occupe: boolean;
  nomDeStructure: (s: string) => string;
  onRetour: () => void; onOuvrir: (cle: string) => void;
  poserCoach: (uid: string, v: boolean) => void; poserKine: (uid: string, v: boolean) => void;
  reaffecter: (athleteId: string, coachUid: string) => void;
  support: (athleteId: string, ouvrir: boolean) => void;
}) {
  const { t } = useTranslation();
  const sansCompte = p.uid === null;
  const coachVerrouille = p.isAdmin && p.coach;
  const ligne = 'flex min-h-[64px] items-center gap-3 px-3 py-2';
  const icone = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg';
  const titre = 'px-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground';

  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={onRetour}
              className="-ml-2 flex h-11 w-fit items-center gap-1 rounded-md px-2 text-sm text-foreground hover:bg-accent/40 lg:hidden">
        <ChevronLeft className="h-4 w-4" /> {t('admin.equipe')}
      </button>

      <header className="flex items-start gap-4">
        <Avatar p={p} taille="h-16 w-16 text-xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 className="truncate text-2xl font-bold leading-tight">{p.nom}</h2>
          {p.email && <p className="truncate font-mono text-xs text-muted-foreground">{p.email}</p>}
          <div className="flex flex-wrap items-center gap-1.5">
            <Badges p={p} />
            {/* Le ✅ d'avant : la fiche est LIÉE à un compte (`linkedUserId`). */}
            {p.fiche && (p.fiche.linkedUserId
              ? <span className="inline-flex items-center gap-1 text-[11px] text-success"><Check className="h-3 w-3" /> {t('misc.linkedAccount')}</span>
              : <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Clock className="h-3 w-3" /> {t('misc.notConnected')}</span>)}
          </div>
        </div>
      </header>

      <section className="flex flex-col gap-2">
        <h3 className={titre}>{t('admin.roles')}</h3>
        <ul className="overflow-hidden rounded-xl border border-border bg-card divide-y divide-border">
          <li className={ligne}>
            <span className={cn(icone, 'bg-muted text-foreground')}><Dumbbell className="h-4 w-4" /></span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium">{t('admin.athlete')}</span>
              <span className="text-xs text-muted-foreground">
                {p.fiche ? t('admin.athleteSousTitre')
                  : p.athleteAilleurs.length ? p.athleteAilleurs.map(x => t('admin.athleteChez', { structure: nomDeStructure(x) })).join(' · ')
                  : t('admin.athleteNonCommutable')}
              </span>
            </span>
            <Interrupteur checked={!!p.fiche} disabled label={t('admin.athlete')} />
          </li>
          <li className={ligne}>
            <span className={cn(icone, 'bg-gold/15 text-gold')}><Crown className="h-4 w-4" /></span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium">{t('admin.coach')}</span>
              <span className="text-xs text-muted-foreground">
                {coachVerrouille ? t('admin.compteAdminNonRetirable')
                  : p.coachAilleurs ? t('admin.coachChez', { structure: nomDeStructure(p.coachAilleurs) })
                  : sansCompte ? t('admin.sansCompte') : t('admin.coachSousTitre')}
              </span>
            </span>
            {coachVerrouille ? (
              <span className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gold/15 px-3 text-xs font-medium text-gold">
                <Lock className="h-3.5 w-3.5" /> {t('admin.admin')}
              </span>
            ) : (
              <Interrupteur checked={p.coach} disabled={sansCompte || occupe} label={t('admin.coach')}
                            onChange={v => p.uid && poserCoach(p.uid, v)} />
            )}
          </li>
          <li className={ligne}>
            <span className={cn(icone, 'bg-success/15 text-success')}><Stethoscope className="h-4 w-4" /></span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium">{t('admin.kine')}</span>
              <span className="text-xs text-muted-foreground">
                {p.kineAilleurs ? t('admin.kineChez', { structure: nomDeStructure(p.kineAilleurs) })
                  : sansCompte ? t('admin.sansCompte') : t('admin.kineSousTitre')}
              </span>
            </span>
            <Interrupteur checked={p.kine} disabled={sansCompte || occupe} label={t('admin.kine')}
                          onChange={v => p.uid && poserKine(p.uid, v)} />
          </li>
        </ul>
      </section>

      {p.fiche && (
        <section className="flex flex-col gap-2">
          <h3 className={titre}>{t('admin.coach')}</h3>
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
            <label htmlFor="coach-qui-le-suit" className="text-sm text-muted-foreground">{t('admin.coachQuiLeSuit')}</label>
            <select id="coach-qui-le-suit" value={p.fiche.coachId ?? ''} disabled={occupe}
                    onChange={e => reaffecter(p.fiche!.id, e.target.value)}
                    className={cn('h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-gold', occupe && 'opacity-50')}>
              {!coachs.some(c => c.uid === p.fiche?.coachId) && <option value="">{t('admin.coachInconnu')}</option>}
              {coachs.map(c => <option key={c.uid!} value={c.uid!}>{c.nom}</option>)}
            </select>
            <p className="text-xs text-muted-foreground">{t('admin.coachsDisponibles', { count: coachs.length })}</p>
          </div>
        </section>
      )}

      {/* L'ACCÈS SUPPORT (FRE-202) : un accès daté à CETTE fiche, avec les droits du
          coach et du kiné. Un lien qu'on prend, pas un rôle qu'on a. */}
      {p.fiche && (
        <section className="flex flex-col gap-2">
          <h3 className={titre}>{t('admin.accesSupport')}</h3>
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
            {p.fiche.supportJusquAu ? (
              <>
                <p className="text-sm">{t('admin.supportJusquAu', { quand: formatMoment(p.fiche.supportJusquAu) })}</p>
                <button type="button" disabled={occupe} onClick={() => support(p.fiche!.id, false)}
                        className={cn('h-11 rounded-lg border border-border px-3 text-sm hover:border-gold', occupe && 'opacity-50')}>
                  {t('admin.fermerSupport')}
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">{t('admin.supportExplication')}</p>
                <button type="button" disabled={occupe} onClick={() => support(p.fiche!.id, true)}
                        className={cn('h-11 rounded-lg border border-gold/60 bg-gold/10 px-3 text-sm font-medium hover:bg-gold/20', occupe && 'opacity-50')}>
                  {t('admin.ouvrirSupport')}
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {p.coach && <ListeDePersonnes titre={t('admin.athletesSuivisTitre', { count: athletes.length })} personnes={athletes}
                                    vide={t('admin.aucunAthleteSuivi')} onOuvrir={onOuvrir} />}
      {p.kine && suivis.length > 0 && (
        <ListeDePersonnes titre={t('admin.suivisKineTitre', { count: suivis.length })} personnes={suivis}
                          vide={t('admin.aucunSuiviKine')} onOuvrir={onOuvrir} />
      )}
    </div>
  );
}

function ListeDePersonnes({ titre, personnes, vide, onOuvrir }: {
  titre: string; personnes: Personne[]; vide: string; onOuvrir: (cle: string) => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{titre}</h3>
      <ul className="overflow-hidden rounded-xl border border-border bg-card divide-y divide-border">
        {personnes.map(a => (
          <li key={a.cle}>
            <button type="button" onClick={() => onOuvrir(a.cle)}
                    className="flex min-h-[56px] w-full items-center gap-3 px-3 text-left hover:bg-accent/30">
              <Avatar p={a} taille="h-9 w-9 text-[11px]" />
              <span className="flex-1 truncate text-sm">{a.nom}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
            </button>
          </li>
        ))}
        {personnes.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">{vide}</li>}
      </ul>
    </section>
  );
}
