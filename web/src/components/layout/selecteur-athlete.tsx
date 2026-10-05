import { useEffect, useMemo, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Search } from 'lucide-react';

import { AthleteAvatar } from '@/components/athlete-avatar';
import { useAthleteSelection } from '@/lib/athlete-selection';
import {
  correspondALaRecherche, nomAffiche, routeApresChangementDAthlete, segmentsDeRecherche, vueDeLEspaceAthlete,
} from '@/lib/athlete';
import type { Athlete } from '@/api/types';
import { cn } from '@/lib/utils';

/** LE CHOIX D'ATHLÈTE, SORTI DE LA COLONNE (Passe 3, constat 07, 14/09).
 *
 *  ⚠️ C'ÉTAIT LE GESTE LE PLUS FRÉQUENT DU COACH, ET CELUI QUI TENAIT LE PLUS MAL.
 *  Trente-cinq personnes dans 248 px de barre latérale, six visibles, un
 *  « 29 autres » pour avouer la coupure, et les sections Kiné et Coach poussées
 *  vers le bas. Quatre réglages la faisaient tenir — borne, rail à six, seuil de
 *  recherche, ligne « n autres » : ils sont partis avec elle.
 *
 *  ⚠️ LE PREMIER ÉLÉMENT DE L'EN-TÊTE, ET LE NOM EN ENTIER. On sait toujours de
 *  qui on regarde le programme — ce que le sous-titre gris de 11 px ne disait pas
 *  assez fort.
 *
 *  ⚠️ OUVERT, IL N'A PAS DE BORNE : la recherche filtre, le panneau défile, la
 *  frappe est surlignée dans le nom. ⌘K (Ctrl+K) l'ouvre sans souris ; ↑↓, ⏎ et ⎋
 *  s'y conduisent au clavier. Sur téléphone le panneau prend tout l'écran, avec
 *  le clavier.
 *
 *  ⚠️ PAS DE « CE QUI L'ATTEND AUJOURD'HUI » SOUS CHAQUE NOM, alors que la
 *  maquette le montre. La liste (`AthleteMine`) ne le porte pas, et le calculer
 *  ici en ferait une seconde définition de « séance du jour » — celle du guichet
 *  vit côté serveur. Elle viendra de brokkr ou ne viendra pas.
 *
 *  Les ARCHIVÉS gardent leur place, en bas du panneau, derrière leur compte :
 *  masqués par défaut, jamais perdus (FRE-127). */
const CLE_DERNIERE_VUE = 'eitri-derniere-vue-athlete';

export function SelecteurAthlete() {
  const { t } = useTranslation();
  const { athletes, selected, selectedId, setSelectedId } = useAthleteSelection();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [ouvert, setOuvert] = useState(false);
  const [recherche, setRecherche] = useState('');
  const [voirArchives, setVoirArchives] = useState(false);
  const [surligne, setSurligne] = useState(0);
  const declencheurRef = useRef<HTMLButtonElement>(null);
  const listeRef = useRef<HTMLUListElement>(null);
  const [ancrage, setAncrage] = useState<{ top: number; left: number } | null>(null);
  const conteneurRef = useRef<HTMLDivElement>(null);

  /* ⚠️ LE CHEMIN DU RETOUR (14/09). La liste latérale partie, rien ne ramenait
     à l'athlète depuis la bibliothèque : il fallait rouvrir le sélecteur et
     RE-choisir celui qu'on regardait déjà (William : « ce qui était le souci de
     base »). Hors de l'espace athlète, le NOM ramène donc à la dernière page de
     l'athlète qu'on avait ouverte ; la flèche, elle, change d'athlète. Dans
     l'espace, le nom n'aurait nulle part où mener : il ouvre le choix, comme
     avant. La page retenue garde ses paramètres (`?week=`) : c'est le même
     athlète. */
  const dansLEspace = vueDeLEspaceAthlete(pathname) !== null;
  const { search } = useLocation();
  useEffect(() => {
    if (!dansLEspace) return;
    try { sessionStorage.setItem(CLE_DERNIERE_VUE, pathname + search); } catch { /* sans stockage, retour sur l'entraînement */ }
  }, [dansLEspace, pathname, search]);
  const revenir = () => {
    let derniere: string | null = null;
    try { derniere = sessionStorage.getItem(CLE_DERNIERE_VUE); } catch { /* idem */ }
    void navigate(derniere && vueDeLEspaceAthlete(derniere.split('?')[0]) ? derniere : '/training');
  };

  /* Les MIENS : mon profil, mes athlètes gérés, mes suivis de kiné — et c'est
     brokkr qui les borne (`/athletes/mine`, `/athletes/suivis`, FRE-190). Le
     tri qui vivait ici rattrapait la réponse de l'admin, qui recevait TOUTES les
     fiches ; il n'a plus rien à rattraper. */
  const actifs = useMemo(() => athletes.filter(a => !a.archiveLe), [athletes]);
  const archives = useMemo(() => athletes.filter(a => a.archiveLe), [athletes]);
  const visibles = useMemo(() => {
    const filtre = (liste: Athlete[]) => liste.filter(a => correspondALaRecherche(a, recherche));
    return [...filtre(actifs), ...(voirArchives ? filtre(archives) : [])];
  }, [actifs, archives, recherche, voirArchives]);

  // ⌘K / Ctrl+K, de n'importe où.
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOuvert(o => !o);
      }
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, []);

  /* À l'ouverture : l'ancrage sous le déclencheur (au-dessus de `md` seulement —
     en dessous le panneau est plein écran), une recherche vide, et la ligne
     surlignée sur celui qu'on regarde. */
  useEffect(() => {
    if (!ouvert) return;
    const r = (conteneurRef.current ?? declencheurRef.current)?.getBoundingClientRect();
    setAncrage(r ? { top: r.bottom + 8, left: r.left } : null);
    setRecherche('');
    const i = actifs.findIndex(a => a.id === selectedId);
    setSurligne(i >= 0 ? i : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert]);

  useEffect(() => { if (surligne >= visibles.length) setSurligne(Math.max(0, visibles.length - 1)); },
    [visibles.length, surligne]);

  /* ⚠️ `scrollTop`, PAS `scrollIntoView` — règle du projet : `scrollIntoView`
     remonte jusqu'au premier ancêtre défilable et emporte la page avec lui. */
  useEffect(() => {
    const boite = listeRef.current;
    const ligne = boite?.children[surligne] as HTMLElement | undefined;
    if (!boite || !ligne) return;
    if (ligne.offsetTop < boite.scrollTop) boite.scrollTop = ligne.offsetTop;
    else if (ligne.offsetTop + ligne.offsetHeight > boite.scrollTop + boite.clientHeight) {
      boite.scrollTop = ligne.offsetTop + ligne.offsetHeight - boite.clientHeight;
    }
  }, [surligne]);

  const choisir = (a: Athlete) => {
    setOuvert(false);
    if (a.id !== selectedId) setSelectedId(a.id);
    void navigate(routeApresChangementDAthlete(pathname));
  };

  const surToucheListe = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSurligne(i => Math.min(visibles.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSurligne(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && visibles[surligne]) { e.preventDefault(); choisir(visibles[surligne]); }
  };

  if (!selected) return null;
  const nom = (a: Pick<Athlete, 'firstName' | 'lastName'>) => `${nomAffiche(a.firstName)} ${nomAffiche(a.lastName)}`;
  const initiales = (a: Athlete) => `${a.firstName[0] ?? ''}${a.lastName[0] ?? ''}`.toUpperCase();

  /* UNE SEULE PERSONNE — l'athlète qui n'a que lui-même, le kiné qui n'en suit
     qu'une : un nom, pas un menu. Un déroulant à une entrée promettrait un choix
     qui n'existe pas.

     ⚠️ MAIS UN NOM QUI MÈNE QUELQUE PART. La liste latérale était aussi le
     CHEMIN vers l'espace de l'athlète depuis ce qui ne décrit personne
     (signalements, guichet). Rendu en texte inerte, le kiné du harnais réel ne
     pouvait plus rejoindre son unique athlète — vu rouge le 14/09, pas deviné. */
  if (athletes.length <= 1 && archives.length === 0) {
    return (
      <button
        type="button"
        onClick={() => void navigate(routeApresChangementDAthlete(pathname))}
        aria-label={t('selecteur.ouvrir', { nom: nom(selected) })}
        className="flex h-10 min-w-0 items-center gap-2.5 rounded-md px-1.5 text-left hover:bg-muted"
      >
        <AthleteAvatar initials={initiales(selected)}
                       className="h-7 w-7 border-gold/70 bg-transparent font-mono text-[10px]" />
        <span className="min-w-0 truncate font-display text-[17px] font-bold uppercase tracking-[0.05em]">
          {nom(selected)}
        </span>
      </button>
    );
  }

  const idLigne = (i: number) => `selecteur-athlete-${i}`;
  const libelleCompte = recherche.trim()
    ? t('selecteur.mesAthletesFiltres', { n: visibles.length, total: actifs.length })
    : t('selecteur.mesAthletes', { count: actifs.length });

  return (
    <DialogPrimitive.Root open={ouvert} onOpenChange={setOuvert}>
      {dansLEspace ? (
        <DialogPrimitive.Trigger asChild>
          <button
            ref={declencheurRef}
            type="button"
            aria-label={t('selecteur.changer', { nom: nom(selected) })}
            className="flex h-10 min-w-0 max-w-full items-center gap-2.5 rounded-md border border-gold/70 bg-gold/10 pl-1.5 pr-2.5 text-left transition-colors hover:bg-gold/15"
          >
            <AthleteAvatar initials={initiales(selected)}
                           className="h-7 w-7 border-gold/70 bg-transparent font-mono text-[10px]" />
            <span className="min-w-0 truncate font-display text-[17px] font-bold uppercase tracking-[0.05em] text-gold">
              {nom(selected)}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
          </button>
        </DialogPrimitive.Trigger>
      ) : (
        <div ref={conteneurRef}
             className="flex h-10 min-w-0 max-w-full items-stretch overflow-hidden rounded-md border border-gold/70 bg-gold/10">
          <button
            type="button"
            onClick={revenir}
            aria-label={t('selecteur.revenir', { nom: nom(selected) })}
            className="flex min-w-0 items-center gap-2.5 pl-1.5 pr-2.5 text-left transition-colors hover:bg-gold/15"
          >
            <AthleteAvatar initials={initiales(selected)}
                           className="h-7 w-7 border-gold/70 bg-transparent font-mono text-[10px]" />
            <span className="min-w-0 truncate font-display text-[17px] font-bold uppercase tracking-[0.05em] text-gold">
              {nom(selected)}
            </span>
          </button>
          <DialogPrimitive.Trigger asChild>
            <button
              ref={declencheurRef}
              type="button"
              aria-label={t('selecteur.changer', { nom: nom(selected) })}
              className="flex w-9 shrink-0 items-center justify-center border-l border-gold/40 transition-colors hover:bg-gold/15"
            >
              <ChevronDown className="h-3.5 w-3.5 text-gold" aria-hidden />
            </button>
          </DialogPrimitive.Trigger>
        </div>
      )}

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 md:bg-transparent" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onKeyDown={surToucheListe}
          style={ancrage ? ({ '--ancre-top': `${ancrage.top}px`, '--ancre-left': `${ancrage.left}px` } as React.CSSProperties) : undefined}
          className="fixed inset-0 z-50 flex flex-col bg-card outline-none md:inset-auto md:left-[var(--ancre-left,1.25rem)] md:top-[var(--ancre-top,4rem)] md:max-h-[min(70vh,560px)] md:w-[404px] md:rounded-lg md:border md:border-border md:shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
        >
          <DialogPrimitive.Title className="sr-only">{t('selecteur.titre')}</DialogPrimitive.Title>
          <div className="border-b border-border p-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:pt-3">
            <div className="flex h-11 items-center gap-2 rounded-md border border-gold/70 bg-background px-3 md:h-[38px]">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <input
                autoFocus
                value={recherche}
                onChange={e => { setRecherche(e.target.value); setSurligne(0); }}
                placeholder={t('views.chercherUnAthlete')}
                aria-label={t('views.chercherUnAthlete')}
                aria-controls="selecteur-athlete-liste"
                aria-activedescendant={visibles[surligne] ? idLigne(surligne) : undefined}
                className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
              />
              <DialogPrimitive.Close className="-mr-1 h-9 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground md:hidden">
                {t('selecteur.fermer')}
              </DialogPrimitive.Close>
            </div>
          </div>

          <p className="px-3.5 pb-2 pt-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {libelleCompte}
          </p>

          <ul id="selecteur-athlete-liste" ref={listeRef} role="listbox"
              aria-label={t('selecteur.titre')}
              className="relative min-h-0 flex-1 overflow-y-auto">
            {visibles.map((a, i) => {
              const actif = a.id === selectedId;
              const survol = i === surligne;
              const premierArchive = !!a.archiveLe && !visibles[i - 1]?.archiveLe;
              return (
                <li key={a.id} id={idLigne(i)} role="option" aria-selected={actif}
                    aria-label={nom(a)}
                    onMouseMove={() => setSurligne(i)}
                    onClick={() => choisir(a)}
                    className={cn(
                      'grid cursor-pointer grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2.5',
                      i > 0 && 'border-t border-border/60',
                      premierArchive && 'border-t-border',
                      survol && 'bg-muted',
                      actif && 'bg-gold/10 shadow-[inset_3px_0_0_var(--gold)]',
                    )}>
                  <AthleteAvatar
                    initials={initiales(a)}
                    className={cn('h-[30px] w-[30px] bg-secondary font-mono text-[10px]',
                                  actif ? 'border-gold/70 text-gold' : 'border-border text-foreground',
                                  /* L'archivé se DESSINE en pointillé — jamais une opacité. */
                                  !actif && a.archiveLe && 'border-dashed text-muted-foreground')} />
                  <span className="flex min-w-0 flex-col">
                    <span className={cn('truncate text-[14.5px]', actif && 'font-semibold text-gold')}>
                      {segmentsDeRecherche(nom(a), recherche).map((m, k) => m.trouve
                        ? <mark key={k} className="rounded-sm bg-gold/30 px-px text-inherit">{m.texte}</mark>
                        : <span key={k}>{m.texte}</span>)}
                    </span>
                    {a.archiveLe && (
                      <span className="font-mono text-[10.5px] text-muted-foreground">{t('selecteur.archive')}</span>
                    )}
                  </span>
                  <span className="hidden font-mono text-[11px] text-muted-foreground md:inline" aria-hidden>
                    {survol ? '⏎' : ''}
                  </span>
                </li>
              );
            })}
            {visibles.length === 0 && (
              <li className="px-3.5 py-4 text-sm italic text-muted-foreground">{t('views.aucunAthlete')}</li>
            )}
          </ul>

          <div className="flex items-center justify-between gap-3 border-t border-border px-3.5 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] md:pb-2.5">
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground md:inline">
              {t('selecteur.aides')}
            </span>
            {archives.length > 0 && (
              <button type="button" onClick={() => setVoirArchives(v => !v)} aria-expanded={voirArchives}
                      className="ml-auto h-9 rounded-md px-2 font-mono text-[10px] uppercase tracking-[0.1em] text-gold hover:bg-gold/10 md:h-7">
                {voirArchives
                  ? t('views.masquerArchives')
                  : t('views.voirArchives', { count: archives.length })}
              </button>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
