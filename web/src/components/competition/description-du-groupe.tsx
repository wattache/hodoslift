import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import type { Flight, WeightCategories } from '@/api/types';
import { cn } from '@/lib/utils';

type Categorie = { gender: 'M' | 'F'; weightCategory: string };
const cle = (c: Categorie) => `${c.gender} ${c.weightCategory}`;

/** Sous le groupe choisi : ses catégories de poids, et de quoi le modifier.
 *
 *  Chaque geste s'enregistre aussitôt : un groupe se règle un par un, pendant
 *  qu'on inscrit ou qu'on pèse. ⚠️ Une catégorie ne va que dans UN groupe —
 *  brokkr refuse le doublon en 422 (`categorie_dans_deux_flights`), une
 *  catégorie prise ailleurs n'est donc pas proposée. */
export function DescriptionDuGroupe({ flights, flight, categories, canWrite, edition, onEdition, onSave, onRenomme }: {
  flights: Flight[];
  /** Le groupe choisi ; `null` : ceux d'aucun groupe. */
  flight: string | null;
  categories: WeightCategories;
  canWrite: boolean;
  edition: boolean;
  onEdition: (ouverte: boolean) => void;
  onSave: (flights: Flight[]) => void;
  /** Le groupe à consulter après le geste ; `undefined` : celui en piste. */
  onRenomme: (nom: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const i = flights.findIndex(f => f.name === flight);
  const groupe = i >= 0 ? flights[i] : null;
  const [nom, setNom] = useState(groupe?.name ?? '');

  if (flight === null || !groupe) {
    return <p className="text-xs text-muted-foreground">{t('competition.horsGroupeExplication')}</p>;
  }

  const cats = groupe.categories ?? [];
  const remplacer = (f: Flight) => onSave(flights.map((x, j) => j === i ? f : x));

  if (!edition) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">{t('competition.categoriesDuGroupe')}</span>
        {cats.length === 0
          ? <span className="text-muted-foreground">{t('competition.groupeVide')}</span>
          : cats.map(c => <span key={cle(c)} className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px]">{cle(c)}</span>)}
        {canWrite && (
          <button type="button" onClick={() => { setNom(groupe.name); onEdition(true); }}
                  className="ml-auto flex h-8 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:border-gold/40 hover:text-foreground">
            <Pencil className="h-3 w-3" /> {t('common.edit')}
          </button>
        )}
      </div>
    );
  }

  const ailleurs = new Map<string, string>();
  flights.forEach((f, j) => { if (j !== i) (f.categories ?? []).forEach(c => ailleurs.set(cle(c), f.name)); });
  const toutes: Categorie[] = (['F', 'M'] as const).flatMap(gender => (categories[gender] ?? []).map(weightCategory => ({ gender, weightCategory })));
  const nomValide = (n: string) => !!n.trim() && !flights.some((f, j) => j !== i && f.name.trim().toLowerCase() === n.trim().toLowerCase());
  const renommer = () => {
    if (nom.trim() === groupe.name) return;
    if (!nomValide(nom)) { setNom(groupe.name); return; }
    remplacer({ ...groupe, name: nom.trim() });
    onRenomme(nom.trim());
  };
  const deplacer = (pas: -1 | 1) => {
    const next = [...flights];
    [next[i], next[i + pas]] = [next[i + pas], next[i]];
    onSave(next);
  };
  const bouton = 'flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground disabled:opacity-30';

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-gold/40 bg-background/30 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Input value={nom} maxLength={40} aria-label={t('competition.nomDuGroupe')}
               aria-invalid={!nomValide(nom)}
               onChange={e => setNom(e.target.value)} onBlur={renommer}
               onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
               className="h-9 w-36 text-base font-semibold xl:text-sm" />
        <button type="button" disabled={i === 0} onClick={() => deplacer(-1)} className={bouton}
                aria-label={t('competition.monterLeGroupe')} title={t('competition.monterLeGroupe')}>
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <button type="button" disabled={i === flights.length - 1} onClick={() => deplacer(1)} className={bouton}
                aria-label={t('competition.descendreLeGroupe')} title={t('competition.descendreLeGroupe')}>
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => { onSave(flights.filter((_, j) => j !== i)); onRenomme(undefined); onEdition(false); }}
                className={cn(bouton, 'hover:bg-destructive/15 hover:text-destructive')}
                aria-label={t('competition.retirerLeGroupe', { nom: groupe.name })} title={t('competition.retirerLeGroupe', { nom: groupe.name })}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => { renommer(); onEdition(false); }}
                className="ml-auto flex h-9 items-center gap-1 rounded-md bg-gold px-3 text-xs font-semibold text-gold-foreground">
          <Check className="h-3.5 w-3.5" /> {t('competition.termine')}
        </button>
      </div>
      <div role="group" aria-label={t('competition.categoriesDuGroupe')} className="flex flex-wrap gap-1">
        {toutes.map(c => {
          const ici = cats.some(x => cle(x) === cle(c));
          const prise = !ici ? ailleurs.get(cle(c)) : undefined;
          return (
            <button key={cle(c)} type="button" aria-pressed={ici} disabled={prise !== undefined}
                    title={prise !== undefined ? t('competition.categorieDejaDans', { groupe: prise }) : undefined}
                    onClick={() => remplacer({ ...groupe, categories: ici ? cats.filter(x => cle(x) !== cle(c)) : [...cats, c] })}
                    className={cn('h-9 rounded border px-2 font-mono text-xs',
                      ici ? 'border-gold bg-gold/15 text-gold' : 'border-border text-muted-foreground hover:border-gold/40',
                      prise !== undefined && 'cursor-not-allowed opacity-30')}>
              {cle(c)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
