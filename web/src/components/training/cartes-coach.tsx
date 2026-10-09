import { useEffect, useRef, useState } from "react";
import { Lock, LockOpen, MoreVertical } from "lucide-react";
import { useTranslation } from 'react-i18next';

import { Combobox } from "@/components/ui/combobox";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { badgeKind, isTraining } from "@/lib/exercise-kind";
import { debutDansLEmom, estChronometre, leReposSeSaisit, lesSeriesSeSaisissent, libelleGroupe, natureDe, rangDansLeGroupe, tempsDuGroupe } from "@/lib/groupe";
import { useEnLigne } from '@/lib/reseau';
import { RPE_OPTIONS } from "@/lib/rpe";
import {
  CHAMPS_DU_STEPPER, appliquerLePas, appliquerLeRaccourci, champSuivant, ecrituresDePrescription, nombreDuChamp,
  pasDuChamp, raccourcisDuChamp, resumeDuReel, type ChampDePrescription, type ChampDuStepper,
} from "@/lib/saisie-coach";
import { cn } from "@/lib/utils";
import { afficherVariantes } from "@/lib/variantes";

import { ChoixDeNature } from "./choix-de-nature";
import { formatBadgeSuffix, formatRest } from "./format";
import { isFreeRest } from "./rest";
import type { SessionTableProps } from "./session-table";
import { DepliDeLaLigne } from "./tableau-coach";

/** LES CARTES DU COACH, TÉLÉPHONE — la saisie complète, pas un dépannage
 *  (brief coach, 27/09).
 *
 *  Une carte par ligne : le nom, ce que l'athlète a fait, trois tuiles de 52 px
 *  (séries, reps, charge) et le verrou à côté, jamais par-dessus la valeur.
 *  Toucher une tuile ouvre l'ÉDITEUR sous la carte : le champ en gros, un `−`
 *  et un `+` au pas juste, quatre raccourcis, puis « Terminé » et « Champ
 *  suivant » — pour écrire une ligne entière sans jamais viser une petite cible.
 *
 *  ⚠️ PAS DE CLAVIER OBLIGATOIRE : le stepper couvre 90 % des saisies. Le
 *  clavier reste accessible en touchant la valeur au centre, en 16 px au moins
 *  pour qu'iOS ne zoome pas. */

/** Ce que l'éditeur sait ouvrir : les quatre champs du stepper, et le repos. */
type ChampEdite = ChampDuStepper | 'rest';

const TUILE = "flex h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[10px] border px-2 transition-colors";
const PASTILLE = "flex h-[34px] items-center rounded-full border px-2.5 font-mono text-xs";

export function CartesCoach({
  session, onUpdateField, onSetExerciseKind, onRemoveExercise, onDuplicateExercise, onMoveExercise, onToggleGroup,
  onSetGroupKind, nameOptions, variantOptions, assistanceOptions, tempoOptions, blockWeeks, shareBlock,
  autresSeances, onMoveExerciseTo,
}: SessionTableProps & { onUpdateField: NonNullable<SessionTableProps['onUpdateField']> }) {
  const { t } = useTranslation();
  const enLigne = useEnLigne();
  const confirm = useConfirm();
  const [edition, setEdition] = useState<{ i: number; champ: ChampEdite } | null>(null);
  const [details, setDetails] = useState<Record<number, boolean>>({});
  const [menu, setMenu] = useState<number | null>(null);

  const ecrire = (i: number, champ: ChampDePrescription, v: string) => {
    for (const [field, value] of ecrituresDePrescription(champ, v)) onUpdateField(i, field, value);
  };

  return (
    <div className="flex flex-col gap-2">
      {session.exercises.map((ex, i) => {
        const precedente = session.exercises[i - 1];
        const suivante = session.exercises[i + 1];
        const linked = !!ex.groupId;
        const membres = ex.groupId ? session.exercises.filter(o => o.groupId === ex.groupId).length : 0;
        const enGroupe = membres > 1;
        const isGroupStart = linked && precedente?.groupId !== ex.groupId;
        const suiteDuGroupe = enGroupe && precedente?.groupId === ex.groupId;
        const natureDuGroupe = natureDe(ex);
        const suiteDeDescentes = natureDuGroupe === 'dropset' && suiteDuGroupe;
        const seriesSaisissables = !(linked && !lesSeriesSeSaisissent(natureDuGroupe)) && !suiteDuGroupe;
        const reposSaisissable = leReposSeSaisit(natureDuGroupe) && !suiteDuGroupe;
        const reel = resumeDuReel(ex);
        const enEdition = edition && edition.i === i ? edition.champ : null;
        const verrouille = !!ex.weightLocked;
        const peutLier = !linked && !suivante?.groupId;
        const peutEtendre = linked && !isGroupStart && !!suivante && !suivante.groupId;
        const unite = ex.repsUnit === "sec";

        const ouvrir = (champ: ChampEdite) => setEdition({ i, champ });

        return (
          <article
            key={i}
            data-ligne={i}
            data-ligne-id={ex.id}
            className={cn("relative rounded-xl border bg-card p-3",
              enEdition ? "border-gold" : "border-border",
              enGroupe && (estChronometre(natureDuGroupe) ? "border-l-[3px] border-l-metric" : "border-l-[3px] border-l-gold/70"))}
          >
            {/* ---- En tête : numéro, nom, badge, le réel ---- */}
            <div className="flex items-start gap-2">
              <span className="w-5 shrink-0 pt-1 font-mono text-[11px] text-muted-foreground">
                {enGroupe && natureDuGroupe === "emom"
                  ? <span className="text-metric">{debutDansLEmom(session.exercises.slice(0, i).filter(o => o.groupId === ex.groupId).length, tempsDuGroupe("emom", membres, ex.sets, ex.clusterMode))}</span>
                  : enGroupe ? t("session.placeDansLeTour", { rang: rangDansLeGroupe(session.exercises, i) + 1, total: membres })
                  : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <div data-nom-exercice className="min-w-0 flex-1 text-base">
                    {suiteDeDescentes
                      ? <span className="text-muted-foreground/50" title={t("session.memeExerciceQueLaDescente")}>↑</span>
                      : <Combobox value={ex.name} options={nameOptions ?? []} label={t("session.exercice")} placeholder={t("session.exercice")}
                                  className="h-9 text-base font-medium" onCommit={(v) => onUpdateField(i, "name", v)} />}
                  </div>
                  {afficherVariantes(ex.variant) && (
                    <span className="shrink-0 font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{afficherVariantes(ex.variant)}</span>
                  )}
                  {!isTraining(ex) && ex.kind && ex.kind !== "training" && (
                    <span className="shrink-0 font-display text-[10px] font-bold uppercase tracking-[0.12em] text-gold">{badgeKind(ex.kind, t)}</span>
                  )}
                  {enGroupe && isGroupStart && (
                    <span className={cn("shrink-0 font-display text-[10px] font-bold uppercase tracking-[0.12em]", estChronometre(natureDuGroupe) ? "text-metric" : "text-gold")}>
                      {libelleGroupe(membres, natureDuGroupe)}
                    </span>
                  )}
                  {ex.format && <span className="shrink-0 font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{ex.format}{formatBadgeSuffix(ex)}</span>}
                </div>
                <div className={cn("mt-0.5 truncate font-mono text-[10px]", reel ? (reel.ecart ? "text-[var(--warning)]" : "text-success") : "text-muted-foreground/60")}>
                  {reel ? `${t("session.fait")} ${reel.texte}${reel.detail ? ` · ${reel.detail}` : ""}` : t("session.pasEncoreFait")}
                </div>
              </div>
              <div className="relative shrink-0">
                <button
                  type="button"
                  aria-label={t("session.actionsDeLaLigne", { nom: ex.name || t("session.sansNom") })}
                  aria-haspopup="menu"
                  aria-expanded={menu === i}
                  onClick={() => setMenu(menu === i ? null : i)}
                  className="flex h-11 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
                {menu === i && (
                  <MenuDeLaLigne onFermer={() => setMenu(null)}>
                    {onMoveExercise && i > 0 && <Item onClick={() => onMoveExercise(i, i - 1)}>{t("session.monter")}</Item>}
                    {onMoveExercise && i < session.exercises.length - 1 && <Item onClick={() => onMoveExercise(i, i + 1)}>{t("session.descendre")}</Item>}
                    {onDuplicateExercise && (
                      <Item disabled={!enLigne} aria-label={t("session.dupliquerLaLigne", { nom: ex.name || t("session.sansNom") })}
                            onClick={() => void onDuplicateExercise(i)}>
                        {t("session.dupliquer")}{!enLigne && <span className="block text-[10px] text-muted-foreground">{t("training.disponibleAuRetourDuReseau")}</span>}
                      </Item>
                    )}
                    {onToggleGroup && (isGroupStart || peutLier || peutEtendre) && (
                      <Item onClick={() => onToggleGroup(i)}>
                        {isGroupStart ? t("session.delierLeGroupe") : peutEtendre ? t("session.ajouterAuGroupe") : t("misc.makeBiset")}
                      </Item>
                    )}
                    {/* Le glisser-déposer entre séances n'a pas d'équivalent tactile :
                        « déplacer vers… », une entrée par autre séance (FRE-188). */}
                    {onMoveExerciseTo && (autresSeances ?? []).map((s) => (
                      <Item key={s.id} onClick={() => onMoveExerciseTo(i, s.id)}>{t("session.deplacerVers", { seance: s.name })}</Item>
                    ))}
                    {onRemoveExercise && (
                      <Item destructif title={t('session.supprimerLExercice')} onClick={async () => {
                        if (await confirm({ title: t("session.supprimerExercice", { nom: ex.name || t("session.sansNom") }) })) onRemoveExercise(i);
                      }}>{t("session.retirer")}</Item>
                    )}
                  </MenuDeLaLigne>
                )}
              </div>
            </div>

            {/* ---- Trois tuiles, et le verrou à côté ---- */}
            <div className="mt-2 flex gap-1.5">
              <Tuile libelle={t("session.series")} valeur={seriesSaisissables ? (ex.sets || "—") : suiteDuGroupe ? "↑" : "—"}
                     on={enEdition === 'sets'} disabled={!seriesSaisissables}
                     title={!seriesSaisissables ? t(suiteDuGroupe ? "session.definiSurLaPremiereLigneDuBiSet" : "session.amrapSansSeries") : undefined}
                     onClick={() => ouvrir('sets')} />
              <Tuile libelle={unite ? t("session.secondes") : t("session.reps")} valeur={ex.reps || "—"} on={enEdition === 'reps'} onClick={() => ouvrir('reps')} />
              <Tuile libelle={t("session.chargeKg")} valeur={ex.weight || "—"} on={enEdition === 'weight'} or grow onClick={() => ouvrir('weight')} />
              <button
                type="button"
                onClick={() => onUpdateField(i, "weightLocked", !verrouille)}
                aria-pressed={verrouille}
                aria-label={verrouille ? t("session.chargeVerrouilleeAria") : t("session.chargeLibreAria")}
                className={cn("flex h-[52px] w-12 shrink-0 items-center justify-center rounded-[10px] border transition-colors",
                  verrouille ? "border-[var(--warning)]/60 bg-[var(--warning)]/10 text-[var(--warning)]" : "border-border bg-background text-muted-foreground")}
              >
                {verrouille ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
              </button>
            </div>

            {/* ---- Les annexes en pastilles, carte au repos ---- */}
            {!enEdition && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button type="button" onClick={() => ouvrir('aimedRPE')} className={cn(PASTILLE, "border-border bg-background text-foreground")}>
                  {ex.aimedRPE ? `RPE ${ex.aimedRPE}` : `RPE —`}
                </button>
                {reposSaisissable && (
                  <button type="button" onClick={() => ouvrir('rest')} className={cn(PASTILLE, "border-border bg-background text-foreground")}>
                    {t("session.repos").toLocaleLowerCase()} {ex.rest && !isFreeRest(ex.rest) ? formatRest(ex.rest) : "—"}
                  </button>
                )}
                {ex.tempo && (
                  <button type="button" onClick={() => setDetails((d) => ({ ...d, [i]: true }))} className={cn(PASTILLE, "border-border bg-background text-foreground")}>
                    tempo {ex.tempo}
                  </button>
                )}
                <button type="button" aria-expanded={!!details[i]} onClick={() => setDetails((d) => ({ ...d, [i]: !d[i] }))}
                        className={cn(PASTILLE, "border-dashed border-border text-muted-foreground")}>
                  {t("session.plusDeChamps")}
                </button>
              </div>
            )}

            {/* ---- L'éditeur, sous la carte ---- */}
            {enEdition && (
              <Editeur
                champ={enEdition}
                valeur={enEdition === 'rest' ? (isFreeRest(ex.rest) ? "" : ex.rest) : ex[enEdition]}
                verrouille={enEdition === 'weight' && verrouille}
                repsUnit={ex.repsUnit}
                onRepsUnit={(u) => onUpdateField(i, "repsUnit", u)}
                onValeur={(v) => ecrire(i, enEdition, v)}
                onSuivant={() => {
                  // Le repos ne fait pas partie du parcours : on repart au début.
                  setEdition({ i, champ: enEdition === 'rest' ? CHAMPS_DU_STEPPER[0] : champSuivant(enEdition) });
                }}
                onTermine={() => setEdition(null)}
              />
            )}

            {/* ---- Les champs restants : le même dépli que le grand écran ---- */}
            {details[i] && (
              <DepliDeLaLigne
                session={session} i={i} suiteDuGroupe={suiteDuGroupe} natureDuGroupe={natureDuGroupe} linked={linked}
                onUpdateField={onUpdateField} onSetExerciseKind={onSetExerciseKind}
                recopiable={(_champ, _i, cellule) => cellule} ecrire={ecrire}
                variantOptions={variantOptions} assistanceOptions={assistanceOptions} tempoOptions={tempoOptions}
                blockWeeks={blockWeeks} shareBlock={shareBlock}
                actions={
                  <>
                    {isGroupStart && onSetGroupKind && (
                      <ChoixDeNature nature={natureDuGroupe} taille={membres} onChange={(n) => onSetGroupKind(i, n)} />
                    )}
                    {linked && !!suivante && suivante.groupId === ex.groupId && natureDuGroupe !== 'dropset' && (
                      <button type="button" aria-pressed={!!ex.unbroken} onClick={() => onUpdateField(i, "unbroken", !ex.unbroken)}
                              className={cn("h-9 rounded-md border px-3 font-display text-[11px] font-bold uppercase tracking-[0.08em]",
                                ex.unbroken ? "border-gold/35 bg-gold/15 text-gold" : "border-dashed border-border text-muted-foreground")}>
                        {t("session.unbroken")}
                      </button>
                    )}
                    <button type="button" onClick={() => setDetails((d) => ({ ...d, [i]: false }))}
                            className="ml-auto h-9 rounded-md border border-border px-3 text-xs text-muted-foreground">
                      {t("session.replier")}
                    </button>
                  </>
                }
              />
            )}
          </article>
        );
      })}
    </div>
  );
}

function Tuile({ libelle, valeur, on, or, grow, disabled, title, onClick }: {
  libelle: string; valeur: string; on: boolean; or?: boolean; grow?: boolean; disabled?: boolean; title?: string; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-pressed={on}
            className={cn(TUILE, grow && "flex-[1.4]",
              on ? "border-gold bg-gold/10" : "border-border bg-background",
              disabled && "cursor-not-allowed opacity-60")}>
      <span className={cn("font-mono text-[17px] font-semibold tabular-nums", or ? "text-gold" : "text-foreground")}>{valeur}</span>
      <span className="font-display text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{libelle}</span>
    </button>
  );
}

/** Le stepper : le champ en gros, `−` et `+` au pas juste, quatre raccourcis,
 *  « Terminé » et « Champ suivant ». Chaque geste écrit tout de suite — la
 *  file de patchs fusionne les frappes rapprochées. */
function Editeur({ champ, valeur, verrouille, repsUnit, onRepsUnit, onValeur, onSuivant, onTermine }: {
  champ: ChampEdite; valeur: string | null | undefined; verrouille: boolean;
  repsUnit: string | null | undefined; onRepsUnit: (u: 'count' | 'sec') => void;
  onValeur: (v: string) => void; onSuivant: () => void; onTermine: () => void;
}) {
  const { t } = useTranslation();
  const [brouillon, setBrouillon] = useState(valeur ?? "");
  useEffect(() => { setBrouillon(valeur ?? ""); }, [valeur, champ]);
  const pas = champ === 'rest' ? 15 : pasDuChamp(champ);
  const raccourcis = champ === 'rest' ? ['60', '90', '120', '180'] : raccourcisDuChamp(champ);
  const libelle = champ === 'sets' ? t("session.series") : champ === 'reps' ? (repsUnit === 'sec' ? t("session.secondes") : t("session.reps"))
    : champ === 'weight' ? t("session.charge") : champ === 'aimedRPE' ? t("session.rpeCible") : t("session.repos");
  const unite = champ === 'weight' ? 'kg' : champ === 'rest' || (champ === 'reps' && repsUnit === 'sec') ? 's' : champ === 'aimedRPE' ? t("session.rpeSur10") : '';
  const valider = () => { if (brouillon !== (valeur ?? "")) onValeur(brouillon); };
  const poser = (v: string) => { setBrouillon(v); onValeur(v); };
  // Le RPE cible a un vocabulaire clos (Sub5, FAIL…) : le pas ne s'applique
  // qu'aux valeurs numériques, et le menu reste là pour le reste.
  const numerique = champ !== 'aimedRPE' || nombreDuChamp(valeur) !== null || !valeur;

  return (
    <div className="mt-3 flex flex-col gap-2.5 border-t border-border pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-display text-xs font-bold uppercase tracking-[0.1em] text-gold">{libelle}</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {verrouille ? t("session.verrouilleePourLAthlete") : t("session.pasDe", { pas: String(pas).replace('.', ',') })}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={t("session.diminuer")} disabled={!numerique} onClick={() => poser(appliquerLePas(brouillon, -pas))}
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-2xl text-foreground disabled:opacity-40">−</button>
        <div className="flex h-14 min-w-0 flex-1 items-center justify-center gap-1 rounded-xl border border-gold bg-background px-2">
          {champ === 'aimedRPE' ? (
            <select value={brouillon} aria-label={libelle} onChange={(e) => poser(e.target.value)}
                    className="h-full w-full bg-transparent text-center font-mono text-[26px] font-semibold text-gold outline-none">
              {RPE_OPTIONS.map((o) => <option key={o || "vide"} value={o}>{o || "—"}</option>)}
            </select>
          ) : (
            <input
              value={brouillon}
              aria-label={libelle}
              inputMode={champ === 'weight' ? "decimal" : "numeric"}
              onChange={(e) => setBrouillon(e.target.value)}
              onBlur={valider}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className="h-full w-full min-w-0 bg-transparent text-center font-mono text-[26px] font-semibold tabular-nums text-gold outline-none"
            />
          )}
          {unite && <span className="shrink-0 font-mono text-xs text-muted-foreground">{unite}</span>}
        </div>
        <button type="button" aria-label={t("session.augmenter")} disabled={!numerique} onClick={() => poser(appliquerLePas(brouillon, pas))}
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-2xl text-foreground disabled:opacity-40">+</button>
      </div>
      <div className="flex gap-1.5">
        {raccourcis.map((r) => (
          <button key={r} type="button" onClick={() => poser(appliquerLeRaccourci(brouillon, r))}
                  className="h-10 flex-1 rounded-lg border border-border bg-background font-mono text-[13px] text-foreground">
            {r}
          </button>
        ))}
        {champ === 'reps' && (
          <button type="button" onClick={() => onRepsUnit(repsUnit === 'sec' ? 'count' : 'sec')} title={t("session.basculerEntreRepetitionsRep")}
                  className={cn("h-10 w-14 rounded-lg border text-[11px] font-semibold uppercase tracking-wide",
                    repsUnit === 'sec' ? "border-gold/35 bg-gold/10 text-gold" : "border-border bg-background text-muted-foreground")}>
            {repsUnit === 'sec' ? 'sec' : 'rep'}
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => { valider(); onTermine(); }}
                className="h-12 flex-1 rounded-xl bg-gold text-[15px] font-semibold text-gold-foreground">
          {t("session.termine")}
        </button>
        <button type="button" onClick={() => { valider(); onSuivant(); }}
                className="h-12 w-[120px] rounded-xl border border-border text-sm text-foreground">
          {t("session.champSuivant")}
        </button>
      </div>
    </div>
  );
}

/** Le menu `⋮` d'une carte : dupliquer, lier, déplacer, retirer. Se ferme au
 *  clic dehors et à Échap, comme tout ce qui s'annonce `role="menu"`. */
function MenuDeLaLigne({ children, onFermer }: { children: React.ReactNode; onFermer: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const auDocument = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onFermer(); };
    const auClavier = (e: KeyboardEvent) => { if (e.key === 'Escape') onFermer(); };
    document.addEventListener('mousedown', auDocument);
    document.addEventListener('keydown', auClavier);
    return () => { document.removeEventListener('mousedown', auDocument); document.removeEventListener('keydown', auClavier); };
  }, [onFermer]);
  return (
    <div ref={ref} role="menu" className="absolute right-0 top-full z-30 mt-1 flex min-w-[200px] flex-col rounded-lg border border-border bg-card p-1 shadow-lg"
         onClick={onFermer}>
      {children}
    </div>
  );
}

function Item({ children, destructif, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { destructif?: boolean }) {
  return (
    <button type="button" role="menuitem" {...props}
            className={cn("flex min-h-11 w-full flex-col items-start justify-center rounded-md px-3 text-left text-sm hover:bg-accent disabled:opacity-40",
              destructif ? "text-destructive" : "text-foreground")}>
      {children}
    </button>
  );
}

