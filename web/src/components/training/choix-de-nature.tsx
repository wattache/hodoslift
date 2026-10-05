import { useTranslation } from "react-i18next";
import { NATURES_DE_GROUPE, libelleGroupe, type NatureDeGroupe } from "@/lib/groupe";
import { cn } from "@/lib/utils";

/** Le choix de la NATURE d'un groupe (FRE-36, FRE-116).
 *
 *  ⚠️ UNE LISTE ET PLUS UNE BASCULE. Deux natures se basculaient d'un clic ; six
 *  demanderaient cinq clics pour revenir en arrière, sans voir où l'on va. La
 *  liste reste habillée comme l'étiquette qu'elle remplace : c'est la même
 *  information, simplement devenue modifiable.
 *
 *  Elle n'apparaît que sur un groupe EXISTANT : proposer une nature à des lignes
 *  non liées ne voudrait rien dire. Partagée par la semaine et la BASE, qui
 *  proposent le même geste — deux copies auraient divergé à la septième nature. */
export function ChoixDeNature({ nature, taille, onChange, className }: {
  nature: NatureDeGroupe;
  taille: number;
  onChange: (nature: NatureDeGroupe) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <select
      value={nature}
      aria-label={t("session.natureDuGroupe")}
      title={t("session.natureDuGroupe")}
      onChange={(e) => onChange(e.target.value as NatureDeGroupe)}
      className={cn(
        "cursor-pointer appearance-none rounded-sm border border-gold/35 bg-card px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-gold shadow-sm outline-none transition-colors hover:bg-gold/15 focus:border-gold",
        className,
      )}
    >
      {NATURES_DE_GROUPE.map((n) => (
        <option key={n} value={n}>{libelleGroupe(taille, n)}</option>
      ))}
    </select>
  );
}
