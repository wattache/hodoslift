import type { ReactNode } from 'react';
import { CalendarClock, MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Athlete, Competition } from '@/api/types';
import { AthleteAvatar } from '@/components/athlete-avatar';
import { daysBetween, formatLong, todayISO } from '@/lib/dates-ui';
import { athleteInitials, nomAffiche } from '@/lib/athlete';

interface Props {
  athlete: Athlete;
  nextCompetition?: Competition;
  /** Action optionnelle rendue en haut à droite du header (ex. bouton d'édition). */
  action?: ReactNode;
}

export function AthleteHeader({ athlete, nextCompetition, action }: Props) {
  const { t } = useTranslation();
  const compDays = nextCompetition ? daysBetween(todayISO(), nextCompetition.startDate) : null;

  return (
    <header className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-[0_18px_46px_rgba(0,0,0,0.18)]">
      <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-5">
        <div className="flex items-center gap-4">
          <AthleteAvatar
            initials={athleteInitials(athlete)}
            alt={`Photo de ${athlete.firstName} ${athlete.lastName}`}
            className="h-12 w-12 text-base"
          >
            <span className="absolute inset-1 rounded-full border border-gold/10" aria-hidden />
          </AthleteAvatar>
          <div className="min-w-0">
            {/* ⚠️ LE NOM EST LE TITRE DE L'ÉCRAN, et il était en 18 px semi-gras —
                le même poids que « Meilleur total » trois centimètres plus bas.
                Il prend la police d'affichage en capitales, comme les titres de
                semaine et les mouvements : c'est de qui on parle.
                La casse est normalisée à l'AFFICHAGE (cf. `nomAffiche`), jamais
                en base — 16 prénoms sur 67 sont saisis tout en capitales. */}
            <h2 className="truncate font-display text-[26px] font-bold uppercase leading-none tracking-[0.01em]">
              {nomAffiche(athlete.firstName)} {nomAffiche(athlete.lastName)}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              {[
                athlete.weight ? `${athlete.weight} kg` : null,
                athlete.height ? `${athlete.height} cm` : null,
                athlete.age ? `${athlete.age} ${t('profile.ansUnite')}` : null,
                athlete.gender ? `${t('common.genre')} ${athlete.gender}` : null,
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {action}
          {/* ⚠️ LA COMPÉTITION ÉTAIT DITE TROIS FOIS (refonte des écrans, 09/2026) : cette pastille,
              un bandeau « Compétition : sam. 10 octobre » sous cet en-tête, et
              une `KpiCard` « Prochaine compet / J−28 » dans la rangée suivante.
              Trois emplacements et une demi-hauteur d'écran pour UN fait. Les
              deux autres ont sauté ; il ne reste que ce bloc, qui répond aux
              trois questions d'un coup — quand, où, dans combien de temps.

              ⚠️ ET IL N'EXISTE PAS SANS COMPÉTITION. Pas de carte « aucune
              compétition », pas de squelette vide : un athlète qui n'en prépare
              aucune ne voit rien ici. */}
          {nextCompetition && compDays !== null && (
            <div className="flex items-center gap-3 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2">
              <CalendarClock className="h-4 w-4 shrink-0 text-gold" aria-hidden />
              <div className="min-w-0">
                <div className="truncate font-display text-[15px] font-bold uppercase leading-tight tracking-[0.01em]">
                  {nextCompetition.name}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                  <span>{formatLong(nextCompetition.startDate)}</span>
                  {nextCompetition.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" aria-hidden />
                      {nextCompetition.location}
                    </span>
                  )}
                </div>
              </div>
              {/* Le compte à rebours, en grand : c'est la seule chose de ce bloc
                  qui change tous les jours. */}
              <div className="ml-1 shrink-0 border-l border-gold/30 pl-3 text-center">
                <div className="font-mono text-lg font-bold leading-none tabular-nums text-gold">
                  J−{compDays}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
