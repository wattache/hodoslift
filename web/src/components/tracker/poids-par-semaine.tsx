import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flag, Scale } from 'lucide-react';

import { usePeseeDuJour, usePoidsSemaines, usePoserPoidsDepart } from '@/api/hooks/use-poids';
import type { PoidsSemaines } from '@/api/types';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import i18n from '@/i18n';
import { todayIso } from '@/lib/dates';
import { toastSaveError } from '@/lib/save-error';
import { cn } from '@/lib/utils';

/** LE POIDS PAR SEMAINE (William, 29/09) — le Google Sheet de Maxence, dans le
 *  Tracker : la moyenne des pesées de chaque semaine depuis le départ, l'écart
 *  depuis ce départ en kg et en %, et la droite vers la pesée visée. Tout est
 *  calculé par brokkr ; ce composant écrit des nombres, il n'en dérive aucun.
 *
 *  Le départ se pose ici (l'athlète, ou son coach) : sans lui, les écarts
 *  partent de la première semaine pesée, et l'écran le dit. La cible ne se
 *  saisit pas — c'est la catégorie de la prochaine compétition. */

const kg = (n: number | null | undefined, decimales = 1): string =>
  n == null ? '—' : n.toLocaleString(i18n.language, { minimumFractionDigits: decimales, maximumFractionDigits: 2 });
const signe = (n: number | null | undefined, suffixe = ''): string =>
  n == null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${kg(Math.abs(n))}${suffixe}`;
const entier = (n: number): string => Math.round(n).toLocaleString(i18n.language);
const jour = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit' });
const teinte = (n: number | null | undefined) => n == null || n === 0 ? 'text-muted-foreground' : n < 0 ? 'text-success' : 'text-warning';

export function PoidsParSemaine({ athleteId, peutPoser }: { athleteId: string; peutPoser: boolean }) {
  const { t } = useTranslation();
  const { data, isPending } = usePoidsSemaines(athleteId);
  const poser = usePoserPoidsDepart(athleteId);
  const [edition, setEdition] = useState(false);
  if (isPending || !data) return null;

  return (
    <section className="rounded-xl border border-border/80 bg-card p-4 shadow-[0_16px_42px_rgba(0,0,0,0.16)]" aria-labelledby="titre-poids-semaine">
      <h2 id="titre-poids-semaine" className="flex items-center gap-2 font-display text-base font-bold uppercase tracking-tight">
        <Scale className="h-4 w-4 text-gold" aria-hidden /> {t('poids.titre')}
      </h2>
      <p className="mt-1 text-[12px] text-muted-foreground">{t('poids.intro')}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {/* LE DÉPART — posé ou à poser. */}
        <div data-depart className="rounded-lg border border-border px-3 py-2">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t('poids.depart')}</div>
          {edition ? (
            <FormulaireDepart
              athleteId={athleteId}
              initial={data.depart}
              onAnnuler={() => setEdition(false)}
              onPoser={(depart) => poser.mutate(depart, { onError: toastSaveError, onSuccess: () => setEdition(false) })}
            />
          ) : data.depart ? (
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-mono text-lg font-semibold tabular-nums">{kg(data.depart.kg)} kg</span>
              <span className="text-[12px] text-muted-foreground">{t('poids.departLe', { date: jour(data.depart.date) })}</span>
              {peutPoser && (
                <span className="ml-auto flex gap-1">
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setEdition(true)}>{t('poids.modifierLeDepart')}</Button>
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => poser.mutate(null, { onError: toastSaveError })}>{t('poids.effacerLeDepart')}</Button>
                </span>
              )}
            </div>
          ) : (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-muted-foreground">{t('poids.sansDepart')}</span>
              {peutPoser && (
                <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => setEdition(true)}>{t('poids.poserLeDepart')}</Button>
              )}
            </div>
          )}
        </div>

        {/* LA CIBLE — déduite de la compétition, jamais saisie. */}
        <div data-cible className="rounded-lg border border-border px-3 py-2">
          <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <Flag className="h-3 w-3" aria-hidden /> {t('poids.cible')}
          </div>
          {data.cible ? (
            <div className="mt-1 text-[12px]">
              <span className="font-mono text-lg font-semibold tabular-nums">{kg(data.cible.kg, 0)} kg</span>
              <span className="ml-2 text-muted-foreground">
                {t('poids.cibleDetail', { kg: kg(data.cible.kg, 0), competition: data.cible.competition, categorie: data.cible.categorie, date: jour(data.cible.date) }).replace(/^[^—]*— /, '')}
              </span>
              {(() => {
                const derniere = [...data.semaines].reverse().find(s => s.resteKg != null);
                if (!derniere?.resteKg && derniere?.resteKg !== 0) return null;
                return (
                  <div data-reste-actuel className={cn('mt-1 font-mono text-[13px] font-semibold tabular-nums', derniere.resteKg > 0 ? 'text-gold' : 'text-success')}>
                    {derniere.resteKg > 0 ? t('poids.resteKg', { kg: kg(derniere.resteKg) }) : t('poids.sousLaBarre', { kg: kg(Math.abs(derniere.resteKg)) })}
                    {derniere.cheminPct != null && <span className="ml-1 text-[11px] font-normal text-muted-foreground">{t('poids.chemin', { pct: entier(derniere.cheminPct) })}</span>}
                  </div>
                );
              })()}
            </div>
          ) : (
            <p className="mt-1 text-[12px] text-muted-foreground">{t('poids.sansCible')}</p>
          )}
        </div>
      </div>

      <TableauDesSemaines donnees={data} className="mt-4" />
    </section>
  );
}

function FormulaireDepart({ athleteId, initial, onAnnuler, onPoser }: {
  athleteId: string;
  initial: PoidsSemaines['depart'];
  onAnnuler: () => void;
  onPoser: (depart: { kg: number; date: string }) => void;
}) {
  const { t } = useTranslation();
  const [kgSaisi, setKg] = useState(initial ? String(initial.kg) : '');
  const [date, setDate] = useState(initial?.date ?? todayIso());
  // La date choisie reprend la pesée de ce jour-là : c'est presque toujours le
  // départ qu'on veut. Reprise quand la date CHANGE, ou tant que le champ est
  // vide — jamais par-dessus un départ déjà posé qu'on vient juste rouvrir.
  const [dateChoisie, setDateChoisie] = useState(false);
  const { data: peseeDuJour } = usePeseeDuJour(athleteId, date);
  useEffect(() => {
    if (peseeDuJour == null) return;
    setKg((k) => (dateChoisie || k === '' ? String(peseeDuJour) : k));
  }, [peseeDuJour, date, dateChoisie]);
  const valeur = parseFloat(kgSaisi.replace(',', '.'));
  const valide = valeur > 0 && valeur <= 400 && date !== '' && date <= todayIso();
  return (
    <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (valide) onPoser({ kg: valeur, date }); }}>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('poids.kg')}</span>
        <Input type="number" inputMode="decimal" step="0.1" min="1" max="400" value={kgSaisi} onChange={(e) => setKg(e.target.value)}
               aria-label={t('poids.depart')} className="h-8 w-24 font-mono" autoFocus />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('poids.dateDuDepart')}</span>
        <DatePicker value={date} max={todayIso()} title={t('poids.dateDuDepart')} className="h-8 text-sm"
                    onChange={(v) => { setDate(v); setDateChoisie(true); }} />
      </label>
      <Button type="submit" size="sm" className="h-8" disabled={!valide}>{t('poids.enregistrer')}</Button>
      <Button type="button" size="sm" variant="ghost" className="h-8" onClick={onAnnuler}>{t('poids.annuler')}</Button>
      {date > todayIso() && <span className="basis-full text-[11px] text-warning">{t('poids.dateFuture')}</span>}
      {peseeDuJour != null && <span data-pesee-reprise className="basis-full text-[11px] text-muted-foreground">{t('poids.peseeReprise', { kg: kg(peseeDuJour), date: jour(date) })}</span>}
    </form>
  );
}

/** Le tableau seul — un composant pur, pour les tests comme pour l'écran.
 *
 *  UNE colonne de mesure (William, 29/09) : ce qui a été perdu depuis le
 *  départ, en kg et en % — « −1,5 kg −1,8 % ». Ce qui reste jusqu'à la pesée
 *  vit dans le cadre « Pesée visée », pas ici. */
export function TableauDesSemaines({ donnees, className }: { donnees: PoidsSemaines; className?: string }) {
  const { t } = useTranslation();
  if (donnees.semaines.length === 0 || donnees.semaines.every(s => s.jours === 0)) {
    return <p className={cn('text-[12px] text-muted-foreground', className)}>{t('poids.aucunePesee')}</p>;
  }
  const th = 'px-2 py-1.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground';
  // `whitespace-nowrap` : « 7 pesées » coupé sur deux lignes se lit comme deux
  // chiffres. La table défile plutôt.
  const td = 'whitespace-nowrap px-2 py-1.5 font-mono text-[13px] tabular-nums';
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table data-poids-semaines className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className={th}>{t('poids.semaine')}</th>
            <th className={th}>{t('poids.dates')}</th>
            <th className={cn(th, 'text-right')}>{t('poids.moyenne')}</th>
            <th className={cn(th, 'text-right')}>{t('poids.ecartDepart')}</th>
          </tr>
        </thead>
        <tbody>
          {donnees.semaines.map((s) => (
            <tr key={s.numero} data-semaine={s.numero} className="border-b border-border/50 last:border-0">
              <td className={cn(td, 'text-gold')}>S{s.numero}</td>
              <td className={cn(td, 'text-muted-foreground')}>{jour(s.du)} → {jour(s.au)}</td>
              <td className={cn(td, 'text-right')}>
                <span data-moyenne className={cn('font-semibold', s.moyenne == null && 'text-muted-foreground')}>{kg(s.moyenne)}</span>
                {s.jours > 0 && <span className="ml-1 text-[10px] text-muted-foreground">{t('poids.jours', { count: s.jours })}</span>}
              </td>
              <td className={cn(td, 'text-right')}>
                <span data-ecart className={cn('font-semibold', teinte(s.ecartKg))}>{signe(s.ecartKg, ' kg')}</span>
                {s.ecartPct != null && <span className={cn('ml-1 text-[11px]', teinte(s.ecartPct))}>{signe(s.ecartPct, ' %')}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
