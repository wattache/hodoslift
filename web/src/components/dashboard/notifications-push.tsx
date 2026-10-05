import { useTranslation } from 'react-i18next';
import { Bell } from 'lucide-react';

import { useMe } from '@/api/hooks/use-me';
import { useNotificationsPush, type EtatPush } from '@/lib/notifications-push';
import { cn } from '@/lib/utils';

/** LES NOTIFICATIONS — une section de la page Profil (William, 28/09) : un
 *  interrupteur, « me prévenir quand mon coach génère une nouvelle semaine ».
 *  Par appareil, et l'écran le dit. Ne s'offre qu'à qui a une fiche d'athlète
 *  quelque part : un coach sans fiche n'a rien à recevoir. Sans clé VAPID côté
 *  brokkr, la section n'existe pas : on ne propose pas ce qui ne peut pas arriver. */
export function NotificationsPush() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const { etat, activer, desactiver } = useNotificationsPush();
  const aUneFiche = (me?.structures ?? []).some(s => s.athleteId) || Boolean(me?.athleteId);
  if (!aUneFiche || etat === 'sans-serveur') return null;

  const actif = etat === 'actif';
  const peutBasculer = etat === 'actif' || etat === 'inactif' || etat === 'echec';
  const note: Partial<Record<EtatPush, string>> = {
    actif: t('notifications.actif'),
    inactif: t('notifications.inactif'),
    'en-cours': t('notifications.enCours'),
    refuse: t('notifications.refuse'),
    indisponible: t('notifications.indisponible'),
    echec: t('notifications.echec'),
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5" aria-labelledby="titre-notifications">
      <h2 id="titre-notifications" className="flex items-center gap-2 font-display text-lg font-bold uppercase tracking-tight">
        <Bell className="h-4 w-4 text-gold" aria-hidden /> {t('notifications.titre')}
      </h2>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">{t('notifications.intro')}</p>

      <label className={cn('flex items-start gap-3 rounded-lg border p-3', actif ? 'border-gold/60 bg-gold/5' : 'border-border', !peutBasculer && 'opacity-80')}>
        {/* ⚠️ UN VRAI `<input type="checkbox" role="switch">` : le geste est
            asynchrone (permission, abonnement, brokkr), donc l'état visible est
            celui de l'APPAREIL, jamais celui de la case seule. */}
        <input
          type="checkbox"
          role="switch"
          checked={actif}
          disabled={!peutBasculer}
          aria-describedby="note-notifications"
          onChange={() => { void (actif ? desactiver() : activer()); }}
          className="mt-0.5 h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full border border-border bg-muted transition-colors
                     before:block before:h-4 before:w-4 before:translate-x-0 before:rounded-full before:bg-muted-foreground before:transition-transform
                     checked:border-gold checked:bg-gold checked:before:translate-x-4 checked:before:bg-gold-foreground disabled:cursor-not-allowed"
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-semibold">{t('notifications.nouvelleSemaine')}</span>
          <span id="note-notifications" data-etat-push={etat} role="status"
                className={cn('text-[12px]', etat === 'actif' ? 'text-success' : etat === 'refuse' || etat === 'echec' ? 'text-warning' : 'text-muted-foreground')}>
            {note[etat] ?? ''}
          </span>
        </span>
      </label>
    </section>
  );
}
