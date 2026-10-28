import { useTranslation } from 'react-i18next';

import { cleDIntensite, couleurDIntensite, VALEURS } from '@/lib/douleurs/intensite';
import { cn } from '@/lib/utils';

type Props = {
  valeur: number;
  onChange: (valeur: number) => void;
  /** ⚠️ TROIS ÉTATS : `true` jour entraîné, `false` jour sans, `undefined`
   *  « pas dit ». Un booléen simple rangerait « je n'ai pas répondu » avec
   *  « je n'ai pas bougé » — et la base ne peut pas répondre à la place de
   *  l'athlète : « aucune trace ce jour-là » peut vouloir dire qu'une séance
   *  n'est pas encore saisie. */
  entrainement?: boolean;
  onEntrainement?: (v: boolean | undefined) => void;
  /** Rend les libellés uniques quand deux sélecteurs cohabitent sur l'écran. */
  id: string;
  className?: string;
};

/** L'INTENSITÉ DU JOUR, EN ONZE BOUTONS — FRE-195.
 *
 *  ⚠️ DES BOUTONS, PAS UN CURSEUR, et ce n'est pas qu'une question de goût : un
 *  `range` se manipule au pouce par glissement, sur une piste de quelques
 *  pixels de haut, et il n'affiche la valeur qu'après l'avoir changée. Ici
 *  chaque valeur est une cible de 44 px qu'on atteint du premier coup — à la
 *  salle, entre deux séries, c'est la différence entre noter et renoncer.
 *
 *  ⚠️ ET LE MÊME COMPOSANT SERT À DÉCLARER ET À NOTER. Ce sont deux moments du
 *  produit, mais une seule question : « ça fait mal combien, là ? ». Deux
 *  sélecteurs finiraient par ne plus répondre pareil.
 *
 *  ⚠️ `0` EST UNE VALEUR ET IL EST VERT : « plus mal aujourd'hui ». Le retirer
 *  obligerait à dire au moins 1 quand on ne sent plus rien. */
export function SelecteurDIntensite({ valeur, onChange, entrainement, onEntrainement, id, className }: Props) {
  const { t } = useTranslation();

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center justify-between gap-3">
        <span id={`${id}-titre`} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('douleurs.intensiteAujourdhui')}
        </span>
        {/* La valeur en grand, dans sa couleur : c'est la réponse, on la relit
            avant d'enregistrer. */}
        <span className="flex items-baseline gap-1.5 rounded-lg border border-border bg-background/60 px-3 py-1.5"
              style={{ color: couleurDIntensite(valeur) }}>
          <span className="font-mono text-2xl font-semibold leading-none tabular-nums">{valeur}</span>
          <span className="font-mono text-xs text-muted-foreground">/10</span>
          <span className="text-xs font-semibold">{t(cleDIntensite(valeur))}</span>
        </span>
      </div>

      {/* ⚠️ UN `group` NOMMÉ, et pas onze boutons en vrac : au lecteur d'écran,
          « 7 » tout seul ne dit pas de quoi. */}
      {/* ⚠️ DEUX RANGÉES DE SIX, À 44 px : onze cibles sur une rangée faisaient
          24 à 34 px, sous le plancher du doigt. Et la couleur passe SOUS le
          chiffre, en filet, au lieu de le traverser. */}
      <div role="group" aria-labelledby={`${id}-titre`} className="grid grid-cols-6 gap-1.5">
        {VALEURS.map(v => {
          const choisi = v === valeur;
          const couleur = couleurDIntensite(v);
          return (
            <button key={v} type="button" onClick={() => onChange(v)}
                    aria-pressed={choisi}
                    aria-label={`${v}/10 · ${t(cleDIntensite(v))}`}
                    className={cn(
                      'flex h-11 flex-col items-center justify-center gap-1 rounded-md border font-mono text-sm font-semibold tabular-nums transition-colors',
                      choisi ? 'border-gold bg-gold/10 text-gold'
                             : 'border-border bg-card text-muted-foreground hover:text-foreground')}>
              {v}
              {/* ⚠️ LE FILET PORTE LA COULEUR MÊME NON CHOISI : sans lui,
                  l'échelle ne se lit qu'après avoir cliqué. */}
              <span aria-hidden className="h-0.5 w-5 rounded-full" style={{ backgroundColor: couleur }} />
            </button>
          );
        })}
      </div>

      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{t('douleurs.intensite.pasMal')}</span>
        <span>{t('douleurs.intensite.insupportable')}</span>
      </div>

      {/* ⚠️ « J'AI DÉJÀ EU DES DOULEURS MÊME HORS TRAINING, PERSISTANTES »
          (William, 23/09) — c'est ce que le kiné cherche en premier devant une
          douleur qui dure, et la base ne sait pas y répondre.
          ⚠️ DEUX BOUTONS QUI SE DÉSÉLECTIONNENT, pas une case à cocher : une
          case n'aurait que deux états et dirait « repos » là où l'athlète n'a
          simplement rien répondu. Recliquer remet la question à « non dit ». */}
      {onEntrainement && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span id={`${id}-jour`} className="text-xs text-muted-foreground">
            {t('douleurs.ceJourLa')}
          </span>
          <div role="group" aria-labelledby={`${id}-jour`} className="flex gap-2">
            {[true, false].map(v => (
              <button key={String(v)} type="button"
                      aria-pressed={entrainement === v}
                      onClick={() => onEntrainement(entrainement === v ? undefined : v)}
                      className={cn('h-11 rounded-lg border px-3 text-sm transition-colors',
                        entrainement === v ? 'border-gold text-gold font-semibold'
                                           : 'border-border text-muted-foreground hover:text-foreground')}>
                {v ? t('douleurs.jourEntraine') : t('douleurs.jourSans')}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
