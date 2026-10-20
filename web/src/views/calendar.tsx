import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Dumbbell, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import * as DialogPrimitive from '@radix-ui/react-dialog';

import type { CalendarEvent, CalendarEventInput } from '@/api/types';
import { useDeleteEvent, useEvents, usePatchEvent, useUpsertEvent } from '@/api/hooks/use-events';
import { useCoachAvailability, useCompetitions } from '@/api/hooks/use-competitions';
import { useProgramStructure } from '@/api/hooks/use-structure';
import { useAthleteSelection } from '@/lib/athlete-selection';
import { athleteCompetitions } from '@/lib/athlete';
import { todayISO } from '@/lib/dates-ui';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { toastSaveError } from '@/lib/save-error';
import { EVENT_CATEGORIES, draftFromEvent, estModifiable, type DraftEvent } from '@/lib/evenement-calendrier';
import { BandeauDeSituation, FriseDePeriodisation } from '@/components/periodization-frise';
import { CalendrierMois } from '@/components/calendrier-mois';
import { useLocalStorageState } from '@/lib/storage';
import { lignesDeMacro, semaineDEntree, type BandeDeBloc, type EvenementDeFrise } from '@/lib/frise-periodisation';



/** VUE CALENDRIER — LA FRISE DE PÉRIODISATION, et le MOIS à côté (FRE-245).
 *
 *  Le mois est revenu à la demande des utilisateurs (20/10), sous une forme qui
 *  évite ce qui avait fait retirer l'ancienne grille (ci-dessous) : un seul mois,
 *  la couleur du TYPE de bloc, et toucher un jour pour y saisir un évènement.
 *
 *  ⚠️ DEUX VUES ONT DISPARU LE MÊME JOUR, et pour deux raisons opposées. La
 *  grille de douze mini-mois montrait des JOURS, pas une périodisation : 365
 *  cases qui répètent « quel bloc couvre ce jour », une couleur attribuée par
 *  rotation d'index (« Bloc 1 » en deux couleurs dans la même légende). L'onglet
 *  Périodisation, lui, disait la bonne chose sans l'axe du temps — la frise le
 *  remplace et reprend ce qu'il avait seul : les objectifs du bloc, désormais au
 *  survol de la bande (William, 16/09). Un onglet de moins, pas un réglage de
 *  plus : garder l'ancienne vue « au cas où » fige le défaut chez qui la garde. */
export function CalendarView() {
  const sel = useAthleteSelection();
  const athleteId = sel.canView ? (sel.selected?.id ?? null) : null;
  // ⚠️ LA CHARPENTE, PAS L'ARBRE (FRE-119). Cette frise ne lit que des numéros,
  // des dates et les objectifs de bloc — jamais une séance. Elle téléchargeait
  // pourtant l'arbre entier : 512 Ko sur le programme le plus fourni, 119 en
  // médian, pour en utiliser 11.
  const { data: macros = [] } = useProgramStructure(sel.canView ? sel.selected?.programId : null);
  const navigate = useNavigate();
  // Le cycle n'est plus un événement (FRE-173) : c'est un fait du jour, saisi et
  // lu dans le Tracker, et le serveur n'en rend plus aucun depuis le 13/09.
  const { data: events = [] } = useEvents(athleteId);
  const { data: competitions = [] } = useCompetitions();
  // Le formulaire d'événement est TENU ICI : la frise l'ouvre (clic ou glissé
  // sur des jours, « Saisir un événement »), la liste en dessous l'édite.
  const [draft, setDraft] = useState<DraftEvent | null>(null);
  // La vue choisie se garde sur l'appareil : un coach qui préfère le mois le
  // retrouve, sans que ça change ce que voient les autres.
  const [vue, setVue] = useLocalStorageState<'frise' | 'mois'>('eitri-calendrier-vue', 'frise', (v): v is 'frise' | 'mois' => v === 'frise' || v === 'mois');
  const { t } = useTranslation();
  const saisir = useCallback((debut: string, fin: string) => {
    setDraft({ ...emptyDraft(), type: 'other', emoji: '📌', startDate: debut, endDate: fin });
  }, []);
  // ⚠️ TOUT CE QUI DÉSIGNE UN OBJET Y MÈNE (William, 16/09). L'Entraînement
  // s'ouvre SUR UNE SEMAINE (`?week=`) — c'est le seul repère qu'il accepte, et
  // celle d'aujourd'hui vaut mieux que la première quand le bloc est en cours.
  const ouvrirLeBloc = useCallback((bloc: BandeDeBloc) => {
    const semaine = semaineDEntree(bloc);
    void navigate(semaine ? `/training?week=${semaine.id}` : '/training');
  }, [navigate]);

  // Le calendrier montre déjà les compétitions où l'athlète affiché CONCOURT.
  // Il lui manquait celles où il ENCADRE : un coach n'est pas participant de la
  // compétition qu'il gère, donc se déclarer présent n'aboutissait nulle part
  // (FRE-25).
  //
  // La disponibilité lue est celle de l'ATHLÈTE AFFICHÉ, via son compte lié —
  // jamais celle de l'utilisateur connecté. Un calendrier décrit celui qu'on
  // regarde : y verser les plateaux du coach qui consulte lui montrerait des
  // engagements qui ne sont pas les siens.
  const { data: coaching = [] } = useCoachAvailability(sel.selected?.linkedUserId);

  const myCompetitions = useMemo(() => {
    const asParticipant = athleteCompetitions(competitions, sel.selected);
    // `available` UNIQUEMENT : un `pending` afficherait un rendez-vous que
    // personne n'a confirmé, et un `unavailable` l'inverse de la vérité.
    const encadrees = new Set(
      coaching.filter(a => a.status === 'available').map(a => a.competitionId),
    );
    if (encadrees.size === 0) return asParticipant;
    const seen = new Set(asParticipant.map(c => c.id));
    return [
      ...asParticipant,
      // Un coach peut aussi CONCOURIR sur la compétition qu'il encadre : sans
      // ce garde-fou, elle apparaîtrait deux fois.
      ...competitions.filter(c => encadrees.has(c.id) && !seen.has(c.id)),
    ];
  }, [competitions, sel.selected, coaching]);

  const emojiFor = (type: string): string => {
    if (type === 'competition') return '⚔️';
    if (type === 'vacation') return '🌴';
    if (type === 'travel') return '💼';
    if (type === 'rest') return '😴';
    return '📌';
  };

  // La frise lit la CHARPENTE brute et les événements avec leur « peut-on
  // s'entraîner » : c'est ce qui colore un jour indisponible.
  const evenementsDeFrise: EvenementDeFrise[] = [
    ...myCompetitions.map((c): EvenementDeFrise => ({
      id: `competition-${c.id}`, nature: 'competition', type: 'competition', nom: c.name, emoji: '⚔️',
      debut: c.startDate, fin: c.endDate || c.startDate, peutSEntrainer: null, competitionId: c.id,
    })),
    ...events.filter(e => e.startDate).map((e): EvenementDeFrise => ({
      id: e.id, nature: e.type === 'competition' ? 'competition' : 'evenement', type: e.type ?? 'other',
      nom: e.name, emoji: e.emoji ?? emojiFor(e.type ?? 'other'),
      debut: e.startDate, fin: e.endDate || e.startDate, peutSEntrainer: e.canTrain ?? null,
    })),
  ];

  const ouvrirLEvenement = (id: string) => {
    const ev = events.find(e => e.id === id);
    if (ev) setDraft(draftFromEvent(ev));
  };
  const blocs = useMemo(() => lignesDeMacro(macros, todayISO()).flatMap(l => l.blocs), [macros]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      {/* Ce qui vaut pour les DEUX vues se pose au-dessus du sélecteur : la
          situation du jour et la liste des évènements (FRE-245). */}
      <BandeauDeSituation
        macros={macros}
        evenements={evenementsDeFrise}
        aujourdhui={todayISO()}
        onBloc={ouvrirLeBloc}
        onCompetition={id => void navigate(`/competitions/${id}`)}
        onEvenement={ouvrirLEvenement}
      />
      {athleteId && (
        <EventsManager athleteId={athleteId} events={events} canEdit={sel.canEdit} draft={draft} setDraft={setDraft} />
      )}
      <div role="group" aria-label={t('calendar.vue')} className="flex self-start rounded-lg border border-border bg-card p-0.5 text-xs">
        {(['frise', 'mois'] as const).map(v => (
          <button key={v} type="button" aria-pressed={vue === v} onClick={() => setVue(v)}
                  className={cn('h-7 rounded-md px-3', vue === v ? 'bg-gold font-semibold text-gold-foreground' : 'text-muted-foreground hover:text-foreground')}>
            {t(`calendar.${v}`)}
          </button>
        ))}
      </div>
      {vue === 'frise' ? (
        <FriseDePeriodisation
          macros={macros}
          evenements={evenementsDeFrise}
          aujourdhui={todayISO()}
          peutSaisir={sel.canEdit && !!athleteId}
          onSaisir={saisir}
          onCompetition={id => void navigate(`/competitions/${id}`)}
          onBloc={ouvrirLeBloc}
          onEvenement={ouvrirLEvenement}
        />
      ) : (
        <CalendrierMois
          blocs={blocs}
          evenements={evenementsDeFrise}
          aujourdhui={todayISO()}
          peutSaisir={sel.canEdit && !!athleteId}
          onSaisir={saisir}
          onCompetition={id => void navigate(`/competitions/${id}`)}
          onEvenement={ouvrirLEvenement}
        />
      )}
    </div>
  );
}

/* ============================================================
 * Gestion des événements (CRUD)
 * ============================================================ */


function emptyDraft(): DraftEvent {
  const t = todayISO();
  // ⚠️ PLUS « compétition » PAR DÉFAUT (16/09) : elle ne se saisit plus ici. Les
  // vacances sont le cas le plus fréquent en production — 12 événements sur 29.
  return { type: 'vacation', name: '', emoji: '🌴', startDate: t, endDate: t, canTrain: true };
}

function eventIcon(ev: CalendarEvent): string {
  return ev.emoji ?? '📌';
}

function eventTitle(ev: CalendarEvent): string {
  return ev.name;
}

function EventsManager({ athleteId, events, canEdit, draft, setDraft }: {
  athleteId: string;
  events: CalendarEvent[];
  canEdit: boolean;
  draft: DraftEvent | null;
  setDraft: React.Dispatch<React.SetStateAction<DraftEvent | null>>;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();

  const upsertEvent = useUpsertEvent(athleteId);
  const patchEvent = usePatchEvent(athleteId);
  const deleteEvent = useDeleteEvent(athleteId);
  const onError = toastSaveError;

  const sorted = [...events].sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));

  const save = () => {
    if (!draft) return;
    if (!draft.name.trim()) return;

    const payload: CalendarEventInput = {
      type: draft.type,
      name: draft.name.trim(),
      emoji: draft.emoji,
      startDate: draft.startDate,
      endDate: draft.endDate || draft.startDate,
      canTrain: draft.canTrain,
    };

    if (draft.id) patchEvent.mutate({ id: draft.id, patch: payload }, { onError });
    else upsertEvent.mutate({ event: payload }, { onError });
    setDraft(null);
  };

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">{t('calendar.evenements')}</h2>
        {canEdit && (
          <Button size="sm" className="h-8 bg-gold text-gold-foreground hover:bg-gold/90" onClick={() => setDraft(emptyDraft())}>
            <Plus className="h-3.5 w-3.5" /> {t('common.add')}
          </Button>
        )}
      </header>

      {/* LE FORMULAIRE EST UNE FENÊTRE (FRE-245) : il s'ouvre là où est le geste —
          un jour du mois, la frise, « Ajouter » ou le crayon d'une ligne —, au
          lieu d'une ligne de la liste, hors de l'écran au téléphone. */}
      <DialogPrimitive.Root open={draft !== null} onOpenChange={o => { if (!o) setDraft(null); }}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          {draft && (
            <DialogPrimitive.Content
              data-brouillon-debut={draft.startDate} data-brouillon-fin={draft.endDate}
              className="fixed left-1/2 top-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border border-border/80 bg-card p-5 shadow-[0_24px_60px_rgba(0,0,0,0.45)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
              <div className="flex items-start justify-between gap-3">
                <DialogPrimitive.Title className="text-sm font-semibold">
                  {draft.id ? t('calendar.modifierLEvenement') : t('calendar.nouvelEvenement')}
                </DialogPrimitive.Title>
                <DialogPrimitive.Close aria-label={t('common.cancel')} className="-m-1 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                  <X className="h-4 w-4" />
                </DialogPrimitive.Close>
              </div>
              <DialogPrimitive.Description className="sr-only">{t('calendar.nomDeLEvenement')}</DialogPrimitive.Description>
              <form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); save(); }}>
                <div className="flex flex-wrap gap-1.5">
                  {EVENT_CATEGORIES.map(c => (
                    <button
                      key={c.emoji}
                      type="button"
                      title={t(c.cle)}
                      aria-pressed={draft.type === c.type}
                      onClick={() => setDraft(d => d && { ...d, type: c.type, emoji: c.emoji })}
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-md border text-base',
                        draft.type === c.type ? 'border-gold bg-gold/15' : 'border-border hover:bg-accent',
                      )}
                    >
                      {c.emoji}
                    </button>
                  ))}
                </div>
                <Input
                  value={draft.name}
                  onChange={e => setDraft(d => d && { ...d, name: e.target.value })}
                  placeholder={t('calendar.nomDeLEvenement')}
                  className="h-9 text-sm"
                  autoFocus
                />
                <div className="flex flex-wrap items-center gap-2">
                  <DatePicker value={draft.startDate} title={t('calendar.debut')}
                              onChange={v => setDraft(d => d && { ...d, startDate: v })} />
                  <span className="text-muted-foreground">→</span>
                  <DatePicker value={draft.endDate} title={t('common.fin')} min={draft.startDate}
                              onChange={v => setDraft(d => d && { ...d, endDate: v })} />
                </div>
                <button
                  type="button"
                  aria-pressed={draft.canTrain}
                  title={t('calendar.peutOnSEntrainer')}
                  onClick={() => setDraft(d => d && { ...d, canTrain: !d.canTrain })}
                  className={cn(
                    'flex h-9 items-center gap-1.5 self-start rounded-md border px-2.5 text-xs font-medium',
                    draft.canTrain
                      ? 'border-gold bg-gold/15 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <Dumbbell className="h-3.5 w-3.5" />
                  {draft.canTrain ? t('misc.trainOk') : t('misc.noTrainingShort')}
                </button>
                <div className="flex justify-end gap-2">
                  <DialogPrimitive.Close asChild>
                    <Button type="button" size="sm" variant="ghost" className="h-9">{t('common.cancel')}</Button>
                  </DialogPrimitive.Close>
                  <Button type="submit" size="sm" className="h-9 bg-gold text-gold-foreground hover:bg-gold/90" disabled={!draft.name.trim()}>
                    <Check className="h-3.5 w-3.5" /> {draft.id ? t('common.save') : t('misc.create')}
                  </Button>
                </div>
              </form>
            </DialogPrimitive.Content>
          )}
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {sorted.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">{t('calendar.aucunEvenement')}</div>
      ) : (
        <ul className="divide-y divide-border">
          {sorted.map(ev => (
            <li key={ev.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="text-base">{eventIcon(ev)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{eventTitle(ev)}</div>
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {ev.startDate}{ev.endDate && ev.endDate !== ev.startDate ? ` → ${ev.endDate}` : ''}
                </div>
              </div>
              <span
                title={ev.canTrain === false ? t('misc.noTraining') : t('misc.canTrain')}
                className={cn(
                  'flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                  ev.canTrain === false ? 'bg-muted text-muted-foreground' : 'text-gold/70',
                )}
              >
                <Dumbbell className="h-3.5 w-3.5" />
                {ev.canTrain === false ? 'Repos' : null}
              </span>
              {/* ⚠️ UNE COMPÉTITION HÉRITÉE SE LIT ET SE SUPPRIME, ELLE NE
                  S'ÉDITE PLUS : le serveur refuse ce type à l'écriture, et
                  l'ouvrir « en autre » réécrirait ce que l'athlète a noté. */}
              {canEdit && !estModifiable(ev) && (
                <span className="shrink-0 text-[11px] text-muted-foreground">{t('calendar.competitionDansSonOnglet')}</span>
              )}
              {canEdit && (
                <>
                  {estModifiable(ev) && (
                  <button
                    type="button"
                    title={t('calendar.editer')}
                    onClick={() => setDraft(draftFromEvent(ev))}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  )}
                  <button
                    type="button"
                    title={t('common.delete')}
                    onClick={async () => {
                      if (await confirm({ title: t('calendar.supprimerLEvenement', { titre: eventTitle(ev) }) })) {
                        deleteEvent.mutate(ev.id, { onError });
                      }
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
