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
      <div className="flex items-baseline justify-between gap-2">
        <span id={`${id}-titre`} className="text-xs text-muted-foreground">
          {t('douleurs.intensiteAujourdhui')}
        </span>
        <span className="text-sm font-semibold" style={{ color: couleurDIntensite(valeur) }}>
          {valeur}/10 · {t(cleDIntensite(valeur))}
        </span>
      </div>

      {/* ⚠️ UN `group` NOMMÉ, et pas onze boutons en vrac : au lecteur d'écran,
          « 7 » tout seul ne dit pas de quoi. */}
      <div role="group" aria-labelledby={`${id}-titre`} className="flex gap-1">
        {VALEURS.map(v => {
          const choisi = v === valeur;
          const couleur = couleurDIntensite(v);
          return (
            <button key={v} type="button" onClick={() => onChange(v)}
                    aria-pressed={choisi}
                    aria-label={`${v}/10 · ${t(cleDIntensite(v))}`}
                    className={cn(
                      'h-11 flex-1 rounded-md border-b-[3px] text-sm font-semibold tabular-nums transition-colors',
                      choisi ? 'text-[#131316]' : 'bg-card text-muted-foreground hover:text-foreground')}
                    style={{
                      // ⚠️ LE LISERÉ PORTE LA COULEUR MÊME QUAND LE BOUTON N'EST
                      // PAS CHOISI : sans lui, l'échelle ne se lit qu'après avoir
                      // cliqué, et on ne voit pas que 7 est rouge avant d'y aller.
                      borderBottomColor: couleur,
                      backgroundColor: choisi ? couleur : undefined,
                    }}>
              {v}
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
