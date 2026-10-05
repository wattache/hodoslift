import * as PopoverPrimitive from "@radix-ui/react-popover";
import { useTranslation } from "react-i18next";
import { Target } from "lucide-react";

import type { ObjectifTechnique } from "@/api/types";
/* `creeLe` est un HORODATAGE, et `parseISODate` recolle `T00:00:00Z` derrière ce
   qu'on lui passe : on tronque au jour, sinon `Invalid Date` en silence. */
import { formatShort } from "@/lib/dates-ui";

/** LA PASTILLE D'OBJECTIFS TECHNIQUES SUR UNE LIGNE D'EXERCICE (FRE-122).
 *
 *  ⚠️ ELLE NE S'AFFICHE QUE S'IL Y A QUELQUE CHOSE À DIRE — au moins un objectif
 *  OUVERT sur ce mouvement. Une pastille présente partout, éteinte la plupart du
 *  temps, coûterait sa place sur chaque ligne du tableau pour l'information
 *  « non » ; et un signal qui ne s'éteint jamais cesse d'en être un.
 *
 *  ⚠️ ELLE PORTE LE NOMBRE, pas seulement une couleur. « Il y a des objectifs »
 *  et « il y en a trois » ne demandent pas le même geste : le premier se lit,
 *  le second se déplie.
 *
 *  ⚠️ ET ELLE SE DISTINGUE DE LA NOTE DE COACH, qui vit sur la même ligne. Les
 *  deux se confondraient sans effort — d'où une icône de CIBLE plutôt qu'un
 *  crayon ou une bulle, et un libellé qui dit « sur ce mouvement » là où la note
 *  dit « aujourd'hui ». C'est le risque produit que le ticket signalait.
 */
export function ObjectifsPastille({ objectifs, mouvement }: {
  objectifs: readonly ObjectifTechnique[];
  mouvement: string | null;
}) {
  const { t } = useTranslation();
  if (objectifs.length === 0) return null;

  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={t('training.nbObjectifsTechniquesSur', { count: objectifs.length, mouvement })}
          title={t('training.objectifsTechniquesSur', { mouvement })}
          className="flex h-5 shrink-0 items-center gap-1 rounded border border-gold/40 bg-gold/10 px-1.5 text-[10px] font-semibold text-gold transition-colors hover:bg-gold/20"
        >
          <Target className="h-3 w-3" />
          {objectifs.length}
        </button>
      </PopoverPrimitive.Trigger>

      {/* ⚠️ DANS UN PORTAIL, ET BORNÉ À L'ÉCRAN (14/09). La popup était un
          `absolute` de 256 px posé dans la carte de l'exercice : au téléphone,
          la carte la COUPAIT — à droite et en bas. Quint lisait « dos ne »,
          et la date à moitié. Radix la sort de la carte, la garde dans l'écran
          (`collisionPadding`), et au-delà de la hauteur disponible elle défile
          au lieu de disparaître. Le clic ailleurs et Échap referment. */}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          collisionPadding={12}
          aria-label={t('training.objectifsTechniquesSur', { mouvement })}
          className="z-50 max-h-[var(--radix-popover-content-available-height)] w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto rounded-lg border border-border bg-card p-2 shadow-[0_12px_32px_rgba(0,0,0,0.28)]"
        >
          <p className="mb-1.5 border-b border-border/60 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('training.objectifsTechniquesSur', { mouvement })}
          </p>
          {/* ⚠️ UN FILET ENTRE LES ENTRÉES, PAS UN SIMPLE ÉCART. Deux objectifs
              de deux lignes chacun se lisaient comme un seul paragraphe, et
              chacun porte maintenant sa date : sans séparation, on ne sait plus
              quelle date va avec quel texte. */}
          <ul className="flex flex-col divide-y divide-border/50">
            {objectifs.map(o => (
              <li key={o.id} className="py-1.5 first:pt-0 last:pb-0">
                {/* 14 px : c'est le chemin COURT, celui qu'on lit d'un coup
                    d'œil entre deux séries. Il était en 12. */}
                <p className="whitespace-pre-line break-words text-sm leading-snug">{o.texte}</p>
                {/* La date de pose — la popup ne montrant que des OUVERTS,
                    « depuis le … » est la seule chose qu'il reste à savoir. */}
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  {t('training.depuisLe', { date: formatShort(o.creeLe.slice(0, 10)) })}
                </p>
              </li>
            ))}
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
