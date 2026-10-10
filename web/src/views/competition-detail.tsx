import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Plus, Check, Pencil, Radio, Table2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAthletesInscriptibles, useCompetitions, usePatchCompetition, useWeightCategories } from '@/api/hooks/use-competitions';
import { useMe } from '@/api/hooks/use-me';
import { athleteFullName } from '@/lib/athlete';
import { createEmptyParticipant, computeScore } from '@/lib/comp-helpers';
import { REGLEMENTS, reglementLabel, type Reglement } from '@/lib/norep-reasons';
import type { RisGender } from '@/lib/ris-score';
import { formatRange } from '@/lib/dates-ui';
import { DatePicker } from '@/components/ui/date-picker';
import { useTranslation } from 'react-i18next';
import { toastSaveError } from '@/lib/save-error';
import { CoachAvailabilitySection } from '@/components/competition/coach-availability';
import { Plateau } from '@/components/competition/plateau';
import { FeuillesDePreparation } from '@/components/competition/feuilles-de-preparation';
import { cn } from '@/lib/utils';
import { ClassementAuRis } from '@/components/competition/classements';
import type { Attempt, Comp, Participant } from '@/components/competition/types';
import type { Flight } from '@/api/types';

/** L'écran d'une compétition : son en-tête, le Plateau (la feuille de match et
 *  le panneau de saisie, un seul écran pour préparer la veille et juger le jour
 *  J), le classement général, les groupes et les coachs présents. */

/** Athlète proposé au rattachement. `uid` = l'uid d'AUTHENTIFICATION
 *  (linkedUserId), jamais l'id du doc : c'est lui qui relie un participant à sa
 *  fiche (scores de compét, PR). Absent si l'athlète ne s'est jamais connecté. */
export interface SelectableAthlete {
  uid?: string;
  name: string;
  bodyweight?: number;
  gender?: RisGender;
}

export function CompetitionDetail({ comp, onUpdate, onBack, athletes = [], canWrite, ecritureEnVol = false }: {
  comp: Comp;
  onUpdate: (patch: Partial<Comp>) => void;
  /** Une écriture est partie et n'est pas revenue : ce que le serveur rend
   *  d'ici là date d'avant elle. */
  ecritureEnVol?: boolean;
  athletes?: SelectableAthlete[];
  onBack: () => void;
  /** Les coachs et l'admin écrivent, l'athlète lit : c'est ce que brokkr applique. */
  canWrite: boolean;
}) {
  const { t } = useTranslation();
  const [participants, setParticipants] = useState<Participant[]>(comp.participants ?? []);

  const [adding, setAdding] = useState<{ name: string; uid?: string; bodyweight: string; gender: '' | RisGender; category: string; competesOn: string } | null>(null);
  // Édition des méta de la compétition (nom / date / lieu) — l'endpoint le
  // permettait déjà, l'UI ne l'exposait pas.
  const [editMeta, setEditMeta] = useState<{ name: string; startDate: string; endDate: string; location: string; reglement: Reglement } | null>(null);
  // Référentiel des catégories (FK composite en base : une valeur libre ferait
  // échouer l'écriture) — d'où un menu déroulant et AUCUNE saisie manuelle.
  const { data: catsByGender = { M: [], F: [] } } = useWeightCategories();
  // Deux vues d'une même feuille : le Plateau pour le jour J, les Feuilles pour
  // préparer le plan — chaque essai et ses trois charges, saisis sur place.
  const [vue, setVue] = useState<'plateau' | 'feuilles'>('plateau');
  const flightNames = (comp.flights ?? []).map(f => f.name);
  // Les groupes écrits ici se voient tout de suite, sans attendre la relecture ;
  // dès que le serveur en renvoie d'autres, ce sont les siens qui valent.
  const [flightsEcrits, setFlightsEcrits] = useState<{ depuis: Flight[] | undefined; flights: Flight[] } | null>(null);
  const flights = flightsEcrits && flightsEcrits.depuis === comp.flights ? flightsEcrits.flights : comp.flights ?? [];
  const setFlights = (f: Flight[]) => setFlightsEcrits({ depuis: comp.flights, flights: f });

  const movementNames = comp.movementNames?.length ? comp.movementNames : ['MUSCLE UP', 'PULL UP', 'DIPS', 'SQUAT'];
  const maxAttempts = comp.maxAttempts || 3;
  // `date` reste renvoyé par compat ; startDate fait foi dès qu'il est là.
  const start = comp.startDate ?? comp.date;
  const end = comp.endDate ?? start;
  const multiDay = end > start;

  // Persistance debouncée : l'UI se met à jour instantanément (setParticipants),
  // mais on ne persiste (onUpdate → write) qu'après ~600ms sans nouvelle frappe.
  // Une rafale de saisies (poids, rep/norep…) = UN seul write au lieu d'un par
  // interaction. Chaque write envoie l'état complet, donc coalescer sur le
  // dernier est sûr.
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Participant[] | null>(null);

  const flush = useCallback(() => {
    if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null; }
    if (pending.current) { onUpdateRef.current({ participants: pending.current }); pending.current = null; }
  }, []);

  // Flush au démontage (ex. retour arrière) pour ne pas perdre la dernière édition.
  useEffect(() => flush, [flush]);

  // Resync depuis le remote (onSnapshot). Garde-fou : ne pas écraser une édition
  // locale non encore persistée (sinon un snapshot d'une écriture précédente
  // ferait « clignoter » les frappes en cours). Au CHANGEMENT de compétition, on
  // resync toujours (et on abandonne le pending de l'ancienne).
  // ⚠️ NI UNE ÉCRITURE EN VOL : la relecture qui arrive pendant elle est partie
  // AVANT, et ne porte pas ce qu'on vient d'envoyer. La prendre retirerait le
  // dernier verdict de l'écran ; le geste suivant, qui renvoie tout, l'effacerait
  // de la base. Une ref, pas une dépendance : la fin de l'écriture ne doit pas
  // rejouer le resync sur l'instantané périmé — la relecture d'après s'en charge.
  const enVol = useRef(ecritureEnVol);
  enVol.current = ecritureEnVol;
  const syncedId = useRef(comp.id);
  useEffect(() => {
    const compChanged = comp.id !== syncedId.current;
    if (compChanged) {
      syncedId.current = comp.id;
      pending.current = null;
      if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null; }
    }
    if (!compChanged && (pending.current || enVol.current)) return;
    setParticipants(comp.participants ?? []);
  }, [comp.id, comp.participants]);

  const commit = (next: Participant[]) => {
    const scored = next.map(p => ({ ...p, score: computeScore(p.movements) }));
    setParticipants(scored);           // UI instantanée
    pending.current = scored;          // mémorise le dernier état
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(flush, 600);
  };

  const addParticipant = () => {
    if (!adding || !adding.name.trim()) return;
    const base = createEmptyParticipant(movementNames, maxAttempts) as Participant;
    base.name = adding.name.trim();
    // Rattache le participant à sa fiche athlète : sans uid, ses résultats ne
    // remontent sur aucun profil (ni RIS compét, ni PR).
    if (adding.uid) (base as { uid?: string }).uid = adding.uid;
    if (adding.bodyweight.trim()) base.bodyweight = parseFloat(adding.bodyweight.replace(',', '.')) || undefined;
    if (adding.gender) base.gender = adding.gender;
    if (adding.category.trim()) base.weightCategory = adding.category.trim();
    if (multiDay && adding.competesOn) base.competesOn = adding.competesOn;
    commit([...participants, base]);
    setAdding(null);
  };

  const saveMeta = () => {
    if (!editMeta || !editMeta.name.trim() || !editMeta.startDate) return;
    // Patch des seules méta : les participants ne sont pas touchés (le serveur
    // ne remplace le sous-arbre que si on le lui envoie). Rétrécir la plage
    // sous un jour de passage existant est refusé côté serveur (422).
    onUpdate({
      name: editMeta.name.trim(),
      startDate: editMeta.startDate,
      endDate: editMeta.endDate || editMeta.startDate,
      location: editMeta.location.trim() || undefined,
      reglement: editMeta.reglement,
    } as Partial<Comp>);
    setEditMeta(null);
  };

  const removeParticipant = (pi: number) => commit(participants.filter((_, i) => i !== pi));
  const changeParticipant = (pi: number, patch: Partial<Participant>) =>
    commit(participants.map((p, i) => i === pi ? { ...p, ...patch } : p));

  const setAttempt = (pi: number, mi: number, ai: number, attempt: Attempt) => {
    commit(participants.map((p, i) => i !== pi ? p : {
      ...p,
      movements: p.movements.map((mv, j) => j !== mi ? mv : {
        ...mv, attempts: mv.attempts.map((a, k) => k !== ai ? a : attempt),
      }),
    }));
  };

  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <button onClick={onBack} className="mb-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Compétitions
          </button>
          {editMeta ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input value={editMeta.name} onChange={e => setEditMeta(v => v && { ...v, name: e.target.value })}
                     placeholder={t('common.nom')} className="h-8 w-52 text-sm" autoFocus />
              <div className="flex items-center gap-1">
                <DatePicker value={editMeta.startDate} title={t('competition.premierJour')}
                            onChange={v => setEditMeta(m => m && { ...m, startDate: v })} />
                <span className="text-xs text-muted-foreground">→</span>
                <DatePicker value={editMeta.endDate} title={t('competition.dernierJour')} min={editMeta.startDate}
                            onChange={v => setEditMeta(m => m && { ...m, endDate: v })} />
              </div>
              <Input value={editMeta.location} onChange={e => setEditMeta(v => v && { ...v, location: e.target.value })}
                     placeholder={t('competition.lieu')} className="h-8 w-44 text-sm"
                     onKeyDown={e => { if (e.key === 'Enter') saveMeta(); }} />
              <select value={editMeta.reglement} aria-label={t('competition.reglement')} title={t('competition.reglement')}
                      onChange={e => setEditMeta(v => v && { ...v, reglement: e.target.value as Reglement })}
                      className="h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold">
                {REGLEMENTS.map(r => <option key={r} value={r}>{reglementLabel(r)}</option>)}
              </select>
              <Button size="sm" className="h-8 bg-gold text-gold-foreground hover:bg-gold/90" onClick={saveMeta}>
                <Check className="h-3.5 w-3.5" /> {t('common.save')}
              </Button>
              <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditMeta(null)}>{t('common.annuler')}</Button>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">{comp.name}</h2>
                <p className="text-xs text-muted-foreground">
                  {formatRange(start, end)}{comp.location ? ` · ${comp.location}` : ''} · {reglementLabel(comp.reglement ?? 'fnsl')}
                </p>
              </div>
              {/* Affordance explicite : un titre cliquable sans repère visuel
                  n'est pas découvrable (retour de William). */}
              {canWrite && <button
                type="button"
                onClick={() => setEditMeta({ name: comp.name, startDate: start, endDate: end, location: comp.location ?? '', reglement: comp.reglement ?? 'fnsl' })}
                title={t("competition.modifierLeNomLes")}
                className="mt-1 flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-gold/40 hover:text-foreground"
              >
                <Pencil className="h-3 w-3" /> {t('common.edit')}
              </button>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canWrite && (
            <div role="group" aria-label={t('competition.vue')} className="flex rounded-md border border-border p-0.5">
              {([['plateau', Radio], ['feuilles', Table2]] as const).map(([v, Icone]) => (
                <button key={v} type="button" aria-pressed={vue === v} onClick={() => setVue(v)}
                        className={cn('flex items-center gap-1 rounded-sm px-2.5 py-1 text-[11px] font-medium',
                          vue === v ? 'bg-accent text-foreground' : 'text-muted-foreground')}>
                  <Icone className="h-3.5 w-3.5" /> {t(v === 'plateau' ? 'competition.vuePlateau' : 'competition.vueFeuilles')}
                </button>
              ))}
            </div>
          )}
          {canWrite && !adding && (
            <Button size="sm" className="h-8 bg-gold text-gold-foreground hover:bg-gold/90" onClick={() => setAdding({ name: '', bodyweight: '', gender: '', category: '', competesOn: '' })}>
              <Plus className="h-3.5 w-3.5" /> Participant
            </Button>
          )}
        </div>
      </div>

      {adding && canWrite && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
          {/* Choisir un athlète le RATTACHE (uid) : sans ça ses résultats ne
              remontent sur aucune fiche. La saisie libre reste possible pour un
              invité extérieur au club. */}
          {athletes.length > 0 && (
            <select
              value={adding.uid ?? ''}
              onChange={e => {
                const a = athletes.find(x => x.uid === e.target.value);
                setAdding(v => v && (a
                  ? { ...v, uid: a.uid, name: a.name,
                      bodyweight: a.bodyweight != null ? String(a.bodyweight) : v.bodyweight,
                      gender: a.gender ?? v.gender,
                      // Le genre peut changer avec l'athlète : la catégorie
                      // choisie deviendrait un couple invalide (FK composite).
                      category: (a.gender ?? v.gender) === v.gender ? v.category : '' }
                  : { ...v, uid: undefined }));
              }}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-gold"
            >
              <option value="">{t("competition.inviteSaisieLibre")}</option>
              {athletes.filter(a => a.uid).map(a => (
                <option key={a.uid} value={a.uid}>{a.name}</option>
              ))}
            </select>
          )}
          <Input value={adding.name} onChange={e => setAdding(v => v && { ...v, name: e.target.value, uid: undefined })} placeholder={t('common.nom')} className="h-8 w-44 text-sm" autoFocus onKeyDown={e => { if (e.key === 'Enter') addParticipant(); }} />
          <Input value={adding.bodyweight} onChange={e => setAdding(v => v && { ...v, bodyweight: e.target.value })} placeholder={t('objectives.load')} className="h-8 w-28 text-sm" />
          <select value={adding.gender}
                  onChange={e => setAdding(v => v && {
                    ...v, gender: e.target.value as '' | RisGender,
                    // La FK est (genre, catégorie) : garder « -80 » en passant à F
                    // produirait un couple invalide, refusé par la base.
                    category: '',
                  })} className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-gold">
            <option value="">{t('common.genre')}</option>
            <option value="M">M</option>
            <option value="F">F</option>
          </select>
          <select
            value={adding.category}
            disabled={!adding.gender}
            title={adding.gender ? t("misc.weightCategory") : 'Choisis d\'abord le genre'}
            onChange={e => setAdding(v => v && { ...v, category: e.target.value })}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-gold disabled:opacity-50"
          >
            <option value="">{t("competition.categorie")}</option>
            {(adding.gender ? catsByGender[adding.gender] ?? [] : []).map((c: string) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {/* Jour de passage : n'a de sens que si la compét s'étale. Le serveur
              refuse (422) une date hors de la plage. */}
          {multiDay && (
            <DatePicker value={adding.competesOn} min={start} max={end} title={t("competition.jourDePassage")}
                        placeholder={t("competition.jourDePassage")}
                        onChange={v => setAdding(a => a && { ...a, competesOn: v })} />
          )}
          <Button size="sm" className="h-8 bg-gold text-gold-foreground hover:bg-gold/90" onClick={addParticipant}>{t('common.add')}</Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => setAdding(null)}>{t('common.annuler')}</Button>
        </div>
      )}

      {participants.length === 0 ? (
        <>
        <div className="rounded-lg border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
          {t("competition.aucunParticipant")}
        </div>
        </>
      ) : vue === 'feuilles' && canWrite ? (
        <>
        <ClassementAuRis participants={participants} />
        <FeuillesDePreparation participants={participants} flightNames={flightNames} maxAttempts={maxAttempts}
                               setAttempt={setAttempt} />
        </>
      ) : (
        <Plateau participants={participants} movementNames={movementNames} maxAttempts={maxAttempts} reglement={comp.reglement ?? 'fnsl'}
                 canWrite={canWrite} setAttempt={setAttempt} onChangeParticipant={changeParticipant}
                 onRemoveParticipant={removeParticipant} categories={catsByGender}
                 jours={multiDay ? { start, end } : null}
                 flights={flights}
                 onSaveFlights={f => { setFlights(f); flush(); onUpdate({ flights: f } as Partial<Comp>); }}
                 classementGeneral={<ClassementAuRis participants={participants} />} />
      )}

      <CoachAvailabilitySection competitionId={comp.id} />
    </div>
  );
}

/* ---- Wrapper de route : /competitions/:competitionId ---- */
export function CompetitionDetailView() {
  const { t } = useTranslation();
  const { competitionId } = useParams();
  const navigate = useNavigate();
  const { data: competitions = [], isLoading } = useCompetitions();
  const { data: inscriptibles = [] } = useAthletesInscriptibles(competitionId);
  const patchCompetition = usePatchCompetition();
  const { data: me } = useMe();

  const comp = competitions.find(c => c.id === competitionId);
  if (!comp) {
    return (
      <div className="mx-auto max-w-4xl rounded-lg border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
        {t(isLoading ? 'common.loading' : 'competition.competitionIntrouvable')}
      </div>
    );
  }

  return (
    <CompetitionDetail
      comp={comp as unknown as Comp}
      onBack={() => void navigate('/competitions')}
      canWrite={!!me?.isCoach || !!me?.isAdmin}
      ecritureEnVol={patchCompetition.isPending}
      onUpdate={patch =>
        patchCompetition.mutate(
          { id: comp.id, patch: patch as Parameters<typeof patchCompetition.mutate>[0]['patch'] },
          { onError: toastSaveError },
        )
      }
      // uid = linkedUserId (l'uid d'AUTH), pas l'id du doc athlète : c'est lui
      // qui rattache un participant à sa fiche côté serveur.
      athletes={inscriptibles.map(a => ({
        uid: a.linkedUserId ?? undefined,
        name: athleteFullName(a) || a.id,
        bodyweight: a.weight ?? undefined,
        gender: a.gender ?? undefined,
      }))}
    />
  );
}
