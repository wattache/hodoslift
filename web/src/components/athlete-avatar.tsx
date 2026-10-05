import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** La pastille d'un athlète : ses initiales, et rien d'autre.
 *
 *  ⚠️ PLUS DE PHOTO, ET C'EST UNE SUPPRESSION ASSUMÉE. Ce composant acceptait une
 *  `photoURL`, servie par un envoi direct du navigateur vers Firebase Storage.
 *  Dix athlètes sur 58 s'en servaient, et l'image n'était jamais affichée
 *  au-dessus de 56 pixels — les initiales faisaient déjà le travail pour les 48
 *  autres, et pour tous en cas d'échec de chargement.
 *
 *  Ce que ça a permis de retirer derrière, en revanche, est sans commune mesure :
 *  l'autorisation de ces photos passait par des règles Storage qui interrogeaient
 *  Firestore, que brokkr entretenait par trois écritures croisées. C'était le
 *  dernier fil qui retenait Firestore côté données. Une photo de visage est en
 *  outre une donnée personnelle, avec ce que ça implique le jour où l'hébergement
 *  bouge.
 *
 *  L'état `failed` a disparu avec l'image : il n'y a plus rien qui puisse échouer
 *  à charger. */
interface AthleteAvatarProps {
  initials: string;
  /** ⚠️ DEVENU L'ÉTIQUETTE ACCESSIBLE, et il ne faut pas le retirer avec l'image.
   *  Il servait d'`alt` à la photo ; sans lui, un lecteur d'écran annoncerait les
   *  initiales telles quelles — « LM » — là où l'appelant sait dire « Léa
   *  Martin ». C'est la seule chose que l'image apportait et qui manquerait. */
  alt?: string;
  className?: string;
  children?: ReactNode;
}

export function AthleteAvatar({ initials, alt, className, children }: AthleteAvatarProps) {
  return (
    <span
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-gold/25 bg-gold/10 text-sm font-semibold text-gold",
        className,
      )}
    >
      <span aria-hidden={alt ? true : undefined}>{initials}</span>
      {children}
    </span>
  );
}
