import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play, RotateCcw, Timer, X } from 'lucide-react';

import { demarrerLeChrono, ecouleMs, formatChrono, mettreEnPause, reprendre, type Chrono } from '@/lib/chrono';
import { cn } from '@/lib/utils';

/** LE CHRONO INTÉGRÉ, À DÉCLENCHER (William, 14/09).
 *
 *  ⚠️ IL A ÉTÉ UN MINUTEUR LANCÉ PAR LE RPE, ET ÇA A ÉTÉ RETIRÉ LE JOUR MÊME.
 *  Noter un ressenti lançait le repos prescrit — mais on ne note pas toujours son
 *  RPE série par série : le déclencheur supposait un usage que la moitié des
 *  saisies n'a pas. Reste ce qui sert à tout le monde : un chrono qu'on lance soi-
 *  même, depuis l'en-tête, sur n'importe quel écran.
 *
 *  ⚠️ IL CONTINUE DE TOURNER QUAND ON QUITTE L'APP. Il garde des instants, pas un
 *  compteur (`lib/chrono.ts`), et les range dans le stockage du navigateur : on
 *  verrouille le téléphone, on ouvre une autre application, on revient — le temps
 *  est juste. Il survit aussi à la navigation : le fournisseur vit au-dessus des
 *  routes. */

const CLE_STOCKAGE = 'eitri-chrono';

interface Contexte {
  chrono: Chrono | null;
  lancer: () => void;
  basculerPause: () => void;
  remettreAZero: () => void;
  fermer: () => void;
}

const ChronoContext = createContext<Contexte | null>(null);

function lireStockage(): Chrono | null {
  try {
    const brut = localStorage.getItem(CLE_STOCKAGE);
    if (!brut) return null;
    const c = JSON.parse(brut) as Chrono;
    return typeof c.cumulMs === 'number' && (c.enMarcheDepuis === null || typeof c.enMarcheDepuis === 'number') ? c : null;
  } catch {
    return null;
  }
}

export function ChronoProvider({ children }: { children: ReactNode }) {
  const [chrono, setChrono] = useState<Chrono | null>(() => lireStockage());

  useEffect(() => {
    try {
      if (chrono) localStorage.setItem(CLE_STOCKAGE, JSON.stringify(chrono));
      else localStorage.removeItem(CLE_STOCKAGE);
    } catch {
      // Un stockage refusé n'empêche pas le chrono de tourner ; il ne survivra
      // simplement pas à un rechargement.
    }
  }, [chrono]);

  const lancer = useCallback(() => setChrono(c => c ?? demarrerLeChrono(Date.now())), []);
  const basculerPause = useCallback(() => setChrono(c => {
    if (!c) return c;
    return c.enMarcheDepuis === null ? reprendre(c, Date.now()) : mettreEnPause(c, Date.now());
  }), []);
  const remettreAZero = useCallback(() => setChrono(c => (c ? demarrerLeChrono(Date.now()) : c)), []);
  const fermer = useCallback(() => setChrono(null), []);

  const valeur = useMemo(() => ({ chrono, lancer, basculerPause, remettreAZero, fermer }),
    [chrono, lancer, basculerPause, remettreAZero, fermer]);
  return <ChronoContext.Provider value={valeur}>{children}</ChronoContext.Provider>;
}

function useChrono(): Contexte | null {
  return useContext(ChronoContext);
}

/** Le déclencheur, dans l'en-tête : présent sur tous les écrans. */
export function BoutonChrono() {
  const { t } = useTranslation();
  const ctx = useChrono();
  if (!ctx) return null;
  const actif = !!ctx.chrono;
  return (
    <button
      type="button"
      onClick={ctx.lancer}
      aria-label={t('chrono.lancer')}
      aria-pressed={actif}
      title={t('chrono.lancer')}
      // ⚠️ UN LIBELLÉ DÈS QU'IL Y A LA PLACE (William, 14/09 : « je ne vois pas le
      // chrono »). L'icône seule, au bout de l'en-tête, passait pour un détail.
      className={cn('flex h-9 min-w-9 shrink-0 items-center justify-center gap-1.5 rounded-md border px-2 font-display text-[11px] uppercase tracking-[0.12em] transition-colors',
                    actif ? 'border-gold/70 bg-gold/10 text-gold' : 'border-gold/40 text-foreground hover:border-gold')}
    >
      <Timer className="h-4 w-4 text-gold" aria-hidden />
      <span className="hidden md:inline">{t('chrono.titre')}</span>
    </button>
  );
}

/** Le bandeau collant, en bas de l'écran tant que le chrono existe. */
export function BandeauChrono() {
  const { t } = useTranslation();
  const ctx = useChrono();
  const [maintenant, setMaintenant] = useState(() => Date.now());
  const chrono = ctx?.chrono ?? null;
  const enMarche = !!chrono && chrono.enMarcheDepuis !== null;

  useEffect(() => {
    if (!enMarche) return;
    setMaintenant(Date.now());
    const id = window.setInterval(() => setMaintenant(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [enMarche]);

  if (!ctx || !chrono) return null;

  return (
    // ⚠️ AU-DESSUS DE LA BARRE BASSE quand elle existe (`--barre-basse`, posée par
    // l'espace athlète au téléphone) : sinon le bandeau la recouvrait entière.
    <div
      role="timer"
      aria-label={t('chrono.titre')}
      data-etat={enMarche ? 'en-marche' : 'en-pause'}
      className="fixed inset-x-0 bottom-[var(--barre-basse,0px)] z-40 border-t-2 border-gold bg-card pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_32px_rgba(0,0,0,0.35)] md:inset-x-auto md:bottom-4 md:right-4 md:w-[340px] md:rounded-lg md:border-2"
    >
      <div className="flex h-[76px] items-center gap-2.5 px-4">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-display text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            {t('chrono.titre')}
          </span>
          {/* En pause, le chiffre passe à l'encre pleine : l'or est ce qui VIT à
              l'écran. Une opacité ne dirait pas l'état — la règle du produit. */}
          <span className={cn('font-mono text-[32px] font-semibold leading-none tabular-nums',
                              enMarche ? 'text-gold' : 'text-foreground')}>
            {formatChrono(ecouleMs(chrono, maintenant))}
          </span>
        </div>
        <button type="button" onClick={ctx.basculerPause}
                aria-label={enMarche ? t('chrono.pause') : t('chrono.reprendre')}
                className="flex h-11 w-11 items-center justify-center rounded-md border border-border bg-muted">
          {enMarche ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
        </button>
        <button type="button" onClick={ctx.remettreAZero} aria-label={t('chrono.zero')}
                className="flex h-11 w-11 items-center justify-center rounded-md border border-border bg-muted">
          <RotateCcw className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" onClick={ctx.fermer} aria-label={t('chrono.fermer')}
                className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground">
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** La place du bandeau en bas de page, pour qu'il ne cache pas la dernière ligne. */
export function EspaceDuChrono() {
  const ctx = useChrono();
  return ctx?.chrono ? <div aria-hidden className="h-[92px] shrink-0 md:h-24" /> : null;
}
