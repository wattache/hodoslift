import { HeartPulse } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { NoteEchouee, useDeclarerEtNoter, useDouleurs, useNoterDouleur } from '@/api/hooks/use-douleurs';
import type { Douleur, ExerciseEditing } from '@/api/types';
import { FigureDuCorps } from '@/components/kine/figure-du-corps';
import { SelecteurDIntensite } from '@/components/kine/selecteur-intensite';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { todayIso } from '@/lib/dates';
import { formatLong, formatShort } from '@/lib/dates-ui';
import { couleurDIntensite } from '@/lib/douleurs/intensite';
import { libelleDExercice, nomDeZone } from '@/lib/douleurs/libelles';
import { cn } from '@/lib/utils';

type Props = {
  /** `legacy_id` de l'athlète dont c'est la séance. */
  athleteId: string;
  ligne: ExerciseEditing;
  /** Le jour de la séance, ISO ; sans date prévue, aujourd'hui. */
  jour?: string;
  /** ⚠️ SUIT CE QUE BROKKR ACCEPTE : la note s'écrit en `owner`. Le staff voit
   *  la puce, jamais le bouton. */
  peutEcrire: boolean;
};

/** SIGNALER UNE GÊNE DEPUIS LA LIGNE DE SÉANCE — William, 27/10.
 *
 *  Sans passer par l'onglet Douleurs : on est sur la ligne où ça a fait mal,
 *  et la note garde cette ligne. Quinze commentaires de douleur sur quarante-et-
 *  un en production nommaient déjà l'exercice à la main.
 *
 *  ⚠️ NOUVELLE OU EXISTANTE, C'EST LE MÊME GESTE. On touche la figure : une
 *  zone déjà suivie ouvre la note du jour de cette douleur ; une zone libre
 *  ouvre la déclaration. La règle « une douleur vivante par zone » est celle du
 *  serveur, et l'écran n'arrive jamais au 409.
 *
 *  ⚠️ LE JOUR EST CELUI DE LA SÉANCE, ET « ENTRAÎNÉ » N'EST PAS DEMANDÉ :
 *  signaler depuis une ligne y répond. Brokkr refuse d'ailleurs la
 *  contradiction (`entrainement: false` avec un exercice). */
export function SignalerSurLaLigne({ athleteId, ligne, jour, peutEcrire }: Props) {
  const { t } = useTranslation();
  const { data: douleurs = [] } = useDouleurs(athleteId);
  const [ouvert, setOuvert] = useState(false);
  const leJour = jour ?? todayIso();

  // Ce qui a déjà été signalé SUR CETTE LIGNE : la dernière note de chaque
  // douleur, quand elle vient d'ici. Lisible par tous, l'athlète comme le staff.
  const notees = ligne.id
    ? douleurs.filter(d => d.derniere?.exercices.some(e => e.exerciseId === ligne.id))
    : [];

  return (
    <>
      {notees.map(d => <PuceDeGene key={d.id} douleur={d} />)}
      {peutEcrire && ligne.id && (
        <>
          <button type="button" onClick={() => setOuvert(true)} data-signaler-gene
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 text-[12px] text-muted-foreground hover:border-gold/35 hover:text-foreground">
            <HeartPulse className="h-3.5 w-3.5" aria-hidden />
            {t('douleurs.signalerUneGene')}
          </button>
          <Sheet open={ouvert} onOpenChange={setOuvert}>
            {/* ⚠️ UN VOLET PAR LE BAS, SOUS LE POUCE : on est à la salle, entre
                deux séries. Sur grand écran il se centre et se borne, sans
                prendre toute la largeur. */}
            <SheetContent side="bottom"
                          className="max-h-[92dvh] overflow-y-auto rounded-t-2xl border-gold p-4
                                     pb-[calc(1rem+env(safe-area-inset-bottom))]
                                     sm:mx-auto sm:max-w-3xl sm:rounded-t-2xl">
              {ouvert && (
                <Volet athleteId={athleteId} ligne={ligne} jour={leJour} douleurs={douleurs}
                       onFini={() => setOuvert(false)} />
              )}
            </SheetContent>
          </Sheet>
        </>
      )}
    </>
  );
}

/** Le cliché que la note affichera, écrit comme brokkr l'écrira : le réalisé
 *  s'il est saisi, sinon le prescrit. */
function clicheDeLaLigne(ligne: ExerciseEditing) {
  return {
    name: ligne.name ?? '', variant: ligne.variant ?? [], sets: ligne.sets ?? null,
    reps: ligne.repsDone || ligne.reps || null, weight: ligne.weightDone || ligne.weight || null,
    format: ligne.format ?? null,
  };
}

function PuceDeGene({ douleur }: { douleur: Douleur }) {
  const { t } = useTranslation();
  const note = douleur.derniere!;
  const couleur = couleurDIntensite(note.intensite);
  return (
    <Link to="/kine?vue=douleurs" data-gene-notee
          className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg border px-2.5 text-[12px] hover:border-gold/60"
          style={{ borderColor: couleur }}>
      <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: couleur }} />
      <span className="truncate font-medium">{douleur.nom}</span>
      <span className="tabular-nums" style={{ color: couleur }}>{note.intensite}/10</span>
      <span className="hidden text-muted-foreground sm:inline">
        · {t('douleurs.geneNoteeLe', { date: formatShort(note.date) })}
      </span>
    </Link>
  );
}

function Volet({ athleteId, ligne, jour, douleurs, onFini }: {
  athleteId: string; ligne: ExerciseEditing; jour: string; douleurs: Douleur[]; onFini: () => void;
}) {
  const { t } = useTranslation();
  const declarer = useDeclarerEtNoter(athleteId);
  const noter = useNoterDouleur(athleteId);
  const [zone, setZone] = useState<string | null>(null);
  const [nom, setNom] = useState('');
  const [intensite, setIntensite] = useState(3);
  const [commentaire, setCommentaire] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const idSel = useId();

  const vivantes = douleurs.filter(d => !d.fin);
  const deja = zone ? vivantes.find(d => d.zone === zone) : undefined;
  const exercice = { exerciseId: ligne.id! };
  const occupe = declarer.isPending || noter.isPending;

  const envoyer = async () => {
    if (!zone) return;
    setErreur(null);
    const note = { intensite, commentaire: commentaire.trim() || null, entrainement: true as const, exercice };
    try {
      if (deja) await noter.mutateAsync({ id: deja.id, jour, ...note });
      else await declarer.mutateAsync({ nom: nom.trim(), zone, jour, ...note });
      onFini();
    } catch (e) {
      // La douleur est créée, c'est la note qui n'est pas passée : on le dit tel
      // quel — recommencer créerait un doublon que le serveur refuserait.
      setErreur(t(e instanceof NoteEchouee ? 'douleurs.noteEchouee' : 'douleurs.envoiEchoue'));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <SheetHeader className="text-left">
        <SheetTitle className="text-base font-semibold">{t('douleurs.signalerUneGene')}</SheetTitle>
        <SheetDescription className="font-mono text-[12px]">
          {libelleDExercice(clicheDeLaLigne(ligne))} · {formatLong(jour)}
        </SheetDescription>
      </SheetHeader>

      {/* ⚠️ DEUX COLONNES DÈS QU'IL Y A LA PLACE : le corps à gauche, ce qu'on
          en dit à droite — la grammaire de l'onglet Douleurs. Empilés, la
          figure poussait le formulaire sous le pli du volet. Sur téléphone, une
          colonne : la figure se compacte quand la zone est choisie. */}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,19rem)] sm:items-start">
      <div className="flex flex-col gap-3">
        {!zone && <p className="text-sm text-muted-foreground">{t('douleurs.toucheLaZone')}</p>}

        {/* ⚠️ LES MUSCLES DÉJÀ SUIVIS SONT MARQUÉS D'EMBLÉE : toucher l'épaule
            qu'on suit déjà rouvre SA note, et la figure le dit avant le geste. */}
        <FigureDuCorps choisies={zone ? [zone] : []}
                       suivies={Object.fromEntries(vivantes.map(d => [d.zone, d.derniere?.intensite ?? null]))}
                       onChoisir={setZone}
                       nomChoisi={zone ? nomDeZone(zone, t) : null}
                       compacte={Boolean(zone)} />
      </div>

      {zone && (
        <div className="flex flex-col gap-3 rounded-xl border border-gold bg-card p-4" data-formulaire-gene>
          <header>
            <h4 className="text-sm font-semibold">
              {deja ? t('douleurs.noterCetteDouleur', { nom: deja.nom }) : t('douleurs.nouvelleDouleur')}
            </h4>
            <p className="text-[11px] uppercase tracking-wider text-gold">{nomDeZone(zone, t)}</p>
          </header>

          {!deja && (
            <>
              <label htmlFor={`${idSel}-nom`} className="text-xs text-muted-foreground">
                {t('douleurs.commentLAppeler', { zone: nomDeZone(zone, t) })}
              </label>
              <input id={`${idSel}-nom`} value={nom} onChange={e => setNom(e.target.value)}
                     placeholder={t('douleurs.exempleNom')} maxLength={80}
                     className="h-11 rounded-lg border border-border bg-background px-3 text-base" />
            </>
          )}

          <SelecteurDIntensite id={idSel} valeur={intensite} onChange={setIntensite} />
          <input value={commentaire} onChange={e => setCommentaire(e.target.value)}
                 placeholder={t('douleurs.commentairePlaceholder')} maxLength={500}
                 aria-label={t('douleurs.commentaire')}
                 // 16 px minimum : en dessous, iOS zoome à la mise au point.
                 className="h-11 rounded-lg border border-border bg-background px-3 text-base" />
          {/* La question « entraîné ? » n'est pas posée : la ligne y répond. */}
          <p className="text-[11px] text-muted-foreground">{t('douleurs.entraineImplicite')}</p>

          {erreur && <p role="alert" className="text-xs text-destructive">{erreur}</p>}

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void envoyer()}
                    disabled={occupe || (!deja && !nom.trim())}
                    className={cn('h-11 rounded-lg bg-gold px-4 text-sm font-semibold text-[#131316]',
                                  'disabled:opacity-40')}>
              {deja ? t('suiviKine.enregistrer') : t('douleurs.suivre')}
            </button>
            <button type="button" onClick={() => { setZone(null); setNom(''); setErreur(null); }}
                    className="h-11 rounded-lg border border-border px-4 text-sm text-muted-foreground">
              {t('suiviKine.annuler')}
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
