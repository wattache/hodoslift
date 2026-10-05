import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/confirm-dialog';
import type { WeightCategories } from '@/api/types';
import type { RisGender } from '@/lib/ris-score';
import type { Participant } from './types';

/** Ce que l'inscription d'un athlète porte : poids du jour (la pesée), genre,
 *  catégorie, jour de passage.
 *
 *  ⚠️ LA CATÉGORIE FAIT LE GROUPE : brokkr range l'athlète dans le groupe qui la
 *  porte. Et la FK est (genre, catégorie) : changer de genre vide la catégorie. */
/** Le poids que dit un texte tapé ; `undefined` tant qu'il n'en dit aucun. */
const poidsLu = (texte: string): number | undefined => {
  const n = parseFloat(texte.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export function DonneesDeLAthlete({ p, categories, jours, onChange, onRemove }: {
  p: Participant;
  categories: WeightCategories;
  /** Les bornes de la compétition quand elle dure plusieurs jours. */
  jours: { start: string; end: string } | null;
  onChange: (patch: Partial<Participant>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  // ⚠️ LE CHAMP MONTRE CE QU'ON TAPE, PAS LE NOMBRE QU'ON EN LIT : « 79, » ne se
  // lit pas encore, et un champ piloté par le nombre se viderait sous les doigts.
  // Un poids venu d'ailleurs (relecture, autre téléphone) remplace le texte,
  // sauf s'il dit déjà la même chose.
  const [texte, setTexte] = useState(p.bodyweight ? String(p.bodyweight) : '');
  const [poidsVu, setPoidsVu] = useState(p.bodyweight);
  if (poidsVu !== p.bodyweight) {
    setPoidsVu(p.bodyweight);
    if (poidsLu(texte) !== p.bodyweight) setTexte(p.bodyweight ? String(p.bodyweight) : '');
  }
  const champ = 'flex items-center gap-1.5 text-xs text-muted-foreground';
  const select = 'h-9 rounded-md border border-border bg-background px-2 text-base text-foreground outline-none focus:border-gold disabled:opacity-50 xl:text-sm';
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className={champ}>
        {t('competition.poidsDuJour')}
        <Input value={texte} inputMode="decimal" placeholder="-"
               onChange={e => { setTexte(e.target.value); onChange({ bodyweight: poidsLu(e.target.value) }); }}
               className="h-9 w-20 text-center font-mono text-base xl:text-sm" />
        kg
      </label>
      <label className={champ}>
        {t('common.genre')}
        <select value={p.gender ?? ''} className={select}
                onChange={e => onChange({ gender: e.target.value ? e.target.value as RisGender : undefined, weightCategory: undefined })}>
          <option value="">-</option>
          <option value="M">M</option>
          <option value="F">F</option>
        </select>
      </label>
      <label className={champ}>
        {t('misc.weightCategory')}
        <select value={p.weightCategory ?? ''} disabled={!p.gender} className={select}
                onChange={e => onChange({ weightCategory: e.target.value || undefined })}>
          <option value="">-</option>
          {(p.gender ? categories[p.gender] ?? [] : []).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      {jours && (
        <label className={champ}>
          {t('competition.jourDePassage')}
          <DatePicker value={p.competesOn ?? ''} min={jours.start} max={jours.end} title={t('competition.jourDePassage')}
                      placeholder="—" onChange={v => onChange({ competesOn: v || undefined })} className="h-9" />
        </label>
      )}
      <button type="button" onClick={async () => {
        if (await confirm({
          title: t('competition.retirerDeLaCompetition', { nom: p.name }),
          description: t('competition.essaisPerdus'),
          confirmLabel: t('base.retirer'),
        })) onRemove();
      }} className="ml-auto flex h-9 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-destructive/15 hover:text-destructive">
        <Trash2 className="h-3.5 w-3.5" /> {t('base.retirer')}
      </button>
    </div>
  );
}
