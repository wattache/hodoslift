import { useTranslation } from 'react-i18next';
import { UserRound } from 'lucide-react';

import { FicheAthlete } from '@/components/dashboard/fiche-athlete';
import { NotificationsPush } from '@/components/dashboard/notifications-push';
import { ReglageProgression } from '@/components/dashboard/reglage-progression';
import { useAthleteSelection } from '@/lib/athlete-selection';

/** L'ONGLET PROFIL DE L'ESPACE ATHLÈTE (William, 27/09).
 *
 *  Il porte la fiche — ce que la fenêtre « Modifier le profil » portait — et
 *  c'est un onglet dédié pour y ranger la suite. Sur le téléphone, la barre du
 *  bas ne change pas : on y arrive par « Profil » sur le tableau de bord. */
export function ProfilAthleteView() {
  const { t } = useTranslation();
  const sel = useAthleteSelection();
  const athlete = sel.selected;
  if (!athlete) return null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <section className="rounded-xl border border-border bg-card p-4 sm:p-5" aria-labelledby="titre-profil">
        <h2 id="titre-profil" className="mb-4 flex items-center gap-2 font-display text-lg font-bold uppercase tracking-tight">
          <UserRound className="h-4 w-4 text-gold" aria-hidden /> {t('nav.profil')}
        </h2>
        <FicheAthlete athlete={athlete} canManage={sel.canManage} />
      </section>

      {/* La suite que l'onglet devait accueillir : le rendu de la progression,
          au choix de la personne qui regarde — deux rangées, pas un écran. */}
      <ReglageProgression />
      {/* « Me prévenir quand mon coach génère une semaine » (28/09) — par appareil. */}
      <NotificationsPush />
    </div>
  );
}
