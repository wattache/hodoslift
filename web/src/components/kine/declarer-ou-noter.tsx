import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { NoteEchouee, useDeclarerEtNoter, useNoterDouleur } from '@/api/hooks/use-douleurs';
import type { Douleur } from '@/api/types';
import { SelecteurDIntensite } from '@/components/kine/selecteur-intensite';
import { formatShort } from '@/lib/dates-ui';
import { cleDIntensite, couleurDIntensite } from '@/lib/douleurs/intensite';
import { nomDeZone, nomDeZoneCourt, nomDesZones } from '@/lib/douleurs/libelles';
import { douleursTouchees } from '@/lib/douleurs/selection';
import { cn } from '@/lib/utils';

/** Des zones en puces courtes ; la forme longue reste au survol et au lecteur
 *  d'écran. */
export function ZonesEnPuces({ zones, className, onRetirer }: {
  zones: string[]; className?: string;
  /** Présent : chaque puce porte un ×, sauf la dernière — une douleur garde au
   *  moins une zone. */
  onRetirer?: (zone: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <ul className={cn('flex min-w-0 flex-wrap gap-1.5', className)} aria-label={nomDesZones(zones, t)}>
      {zones.map(z => (
        <li key={z} className="min-w-0">
          {onRetirer && zones.length > 1 ? (
            <button type="button" onClick={() => onRetirer(z)} title={nomDeZone(z, t)}
                    aria-label={t('douleurs.retirerLaZone', { zone: nomDeZone(z, t) })}
                    className="flex h-11 max-w-full items-center gap-1.5 rounded-full border border-gold px-3 font-mono text-xs text-gold">
              <span className="truncate">{nomDeZoneCourt(z, t)}</span><span aria-hidden>×</span>
            </button>
          ) : (
            <span title={nomDeZone(z, t)}
                  className="block max-w-full truncate rounded-full border border-gold px-2.5 py-0.5 font-mono text-xs text-gold">
              {nomDeZoneCourt(z, t)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Les candidates, la plus récemment notée en tête : c'est celle qu'on attend. */
export function candidatesDe(vivantes: Douleur[], zones: string[]): Douleur[] {
  return [...douleursTouchees(vivantes, zones)]
    .sort((a, b) => (b.derniere?.date ?? '').localeCompare(a.derniere?.date ?? ''));
}

/** « À QUELLE DOULEUR ? » — UNE LISTE, LA MÊME AUX TROIS POINTS D'ENTRÉE.
 *
 *  ⚠️ UNE LIGNE PAR DOULEUR QUI PORTE LA ZONE, pas une seule plus « nouvelle » :
 *  une zone peut appartenir à plusieurs douleurs vivantes (FRE-196). On choisit
 *  sur le NOM que l'athlète a donné, pas sur un code de zone. */
function ChoixDeDouleur({ candidates, choix, onChoisir }: {
  candidates: Douleur[]; choix: string; onChoisir: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div role="radiogroup" aria-labelledby="titre-choix-douleur" className="flex flex-col gap-2">
      {candidates.map(d => {
        const pris = choix === d.id;
        const intensite = d.derniere?.intensite;
        const couleur = intensite != null ? couleurDIntensite(intensite) : undefined;
        return (
          <button key={d.id} type="button" role="radio" aria-checked={pris} onClick={() => onChoisir(d.id)}
                  data-choix-douleur={d.id}
                  className={cn('flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors',
                                pris ? 'border-gold bg-gold/10' : 'border-border bg-background/40 opacity-75 hover:opacity-100')}>
            <Pastille pris={pris} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold">{d.nom}</span>
              <span className="truncate font-mono text-[11px] text-muted-foreground">
                {d.zones.map(z => nomDeZoneCourt(z, t)).join(' · ')}
              </span>
            </span>
            {intensite != null && (
              <span className={cn('shrink-0 rounded-md px-2 py-0.5 font-mono text-xs font-semibold tabular-nums',
                                  pris && 'border')}
                    style={{ color: couleur, borderColor: pris ? couleur : undefined }}>
                {intensite}/10{pris && ` · ${t(cleDIntensite(intensite))}`}
              </span>
            )}
          </button>
        );
      })}
      <button type="button" role="radio" aria-checked={choix === 'nouvelle'} onClick={() => onChoisir('nouvelle')}
              data-choix-douleur="nouvelle"
              className={cn('flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider transition-colors',
                            choix === 'nouvelle' ? 'border-gold bg-gold/10 text-gold'
                                                 : 'border-dashed border-border text-muted-foreground hover:text-foreground')}>
        <Pastille pris={choix === 'nouvelle'} />
        <span className="flex-1">+ {t('douleurs.creerNouvelleDouleur')}</span>
        <span aria-hidden>→</span>
      </button>
    </div>
  );
}

/** Le rond d'un choix exclusif : plein d'or quand il est pris. */
function Pastille({ pris }: { pris: boolean }) {
  return (
    <span aria-hidden className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
                                    pris ? 'border-gold' : 'border-muted-foreground/50')}>
      {pris && <span className="h-1.5 w-1.5 rounded-full bg-gold" />}
    </span>
  );
}

type Props = {
  athleteId: string;
  /** Les zones touchées sur la figure. */
  zones: string[];
  vivantes: Douleur[];
  jour: string;
  /** Signalée depuis une ligne de séance : le jour est entraîné, la ligne
   *  s'attache à la note, et la question entraînement/repos n'est pas posée. */
  exercice?: { exerciseId: string };
  /** La douleur à proposer d'abord — celle qu'on a touchée dans la liste. */
  prefere?: string | null;
  onFini: () => void;
  onAnnuler: () => void;
};

/** DÉCLARER OU NOTER — le même formulaire dans l'onglet Douleurs et dans le
 *  volet de la ligne de séance. Deux formulaires finiraient par ne plus poser la
 *  même question. */
export function DeclarerOuNoter({ athleteId, zones, vivantes, jour, exercice, prefere, onFini, onAnnuler }: Props) {
  const { t } = useTranslation();
  const declarer = useDeclarerEtNoter(athleteId);
  const noter = useNoterDouleur(athleteId);
  const idSel = useId();

  const candidates = candidatesDe(vivantes, zones);
  const attendue = (prefere && candidates.some(d => d.id === prefere) ? prefere : candidates[0]?.id) ?? 'nouvelle';
  const [choix, setChoix] = useState(attendue);
  const [nom, setNom] = useState('');
  const [intensite, setIntensite] = useState(3);
  const [commentaire, setCommentaire] = useState('');
  const [entrainement, setEntrainement] = useState<boolean | undefined>(undefined);
  const [erreur, setErreur] = useState<string | null>(null);

  const douleur = candidates.find(d => d.id === choix);

  /** ⚠️ CHOISIR UNE DOULEUR REPREND SA NOTE : la dernière intensité, et la note
   *  du jour si elle existe — re-noter le même jour CORRIGE. */
  const reprendre = (id: string) => {
    setChoix(id);
    const d = candidates.find(x => x.id === id);
    const duJour = d?.derniere?.date === jour ? d.derniere : null;
    setIntensite(d?.derniere?.intensite ?? 3);
    setCommentaire(duJour?.commentaire ?? '');
    setEntrainement(duJour?.entrainement ?? undefined);
  };

  // Les zones changent sous le formulaire : la douleur attendue peut changer.
  const cleZones = zones.join('|');
  useEffect(() => { reprendre(attendue); }, [cleZones, attendue]); // eslint-disable-line react-hooks/exhaustive-deps

  const occupe = declarer.isPending || noter.isPending;

  const envoyer = async () => {
    setErreur(null);
    const note = {
      intensite, commentaire: commentaire.trim() || null,
      ...(exercice ? { entrainement: true as const, exercice } : { entrainement }),
    };
    try {
      if (douleur) await noter.mutateAsync({ id: douleur.id, jour, ...note });
      else await declarer.mutateAsync({ nom: nom.trim(), zones, jour, ...note });
      onFini();
    } catch (e) {
      // La douleur est créée, c'est la note qui n'est pas passée : on le dit tel
      // quel — recommencer créerait un doublon.
      setErreur(t(e instanceof NoteEchouee ? 'douleurs.noteEchouee' : 'douleurs.envoiEchoue'));
    }
  };

  const derniere = douleur?.derniere;
  const section = 'flex flex-col gap-3 border-t border-border pt-4';
  const etiquette = 'text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

  return (
    <div className="flex flex-col gap-4" data-formulaire-gene>
      <header className="flex flex-col gap-2">
        <p className="font-mono text-[11px] uppercase tracking-wider text-gold">
          {t('douleurs.tuAsTouche')} : {zones.map(z => nomDeZoneCourt(z, t)).join(' · ')}
        </p>
        <h4 id="titre-choix-douleur" className="text-xl font-semibold uppercase tracking-tight">
          {candidates.length ? t('douleurs.aQuelleDouleur') : t('douleurs.nouvelleDouleur')}
        </h4>
      </header>

      {candidates.length > 0 && <ChoixDeDouleur candidates={candidates} choix={choix} onChoisir={reprendre} />}

      {!douleur && (
        <div className="flex flex-col gap-2">
          <label htmlFor={`${idSel}-nom`} className="text-xs text-muted-foreground">
            {t('douleurs.commentLAppeler', { zone: nomDesZones(zones, t) })}
          </label>
          <input id={`${idSel}-nom`} value={nom} onChange={e => setNom(e.target.value)}
                 placeholder={t('douleurs.exempleNom')} maxLength={80}
                 className="h-11 rounded-lg border border-border bg-background px-3 text-base" />
        </div>
      )}

      <div className={section}>
        <SelecteurDIntensite id={idSel} valeur={intensite} onChange={setIntensite} />
      </div>

      <div className={section}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span id={`${idSel}-contexte`} className={etiquette}>{t('douleurs.contexteEtNotes')}</span>
          {derniere && (
            <span className="text-[11px] text-muted-foreground">
              {t('douleurs.noteLeA', { date: formatShort(derniere.date), valeur: derniere.intensite })}
            </span>
          )}
        </div>
        {/* ⚠️ TROIS ÉTATS : recliquer remet la question à « non dit ». Depuis
            une ligne de séance, la question n'est pas posée : la ligne y répond. */}
        {exercice ? (
          <p className="text-[11px] text-muted-foreground">{t('douleurs.entraineImplicite')}</p>
        ) : (
          <div role="group" aria-labelledby={`${idSel}-contexte`} className="flex flex-wrap gap-2">
            {[true, false].map(v => (
              <button key={String(v)} type="button" aria-pressed={entrainement === v}
                      onClick={() => setEntrainement(entrainement === v ? undefined : v)}
                      className={cn('h-11 rounded-full border px-4 text-sm transition-colors',
                                    entrainement === v ? 'border-gold text-gold font-semibold'
                                                       : 'border-border text-muted-foreground hover:text-foreground')}>
                {v ? t('douleurs.jourEntraine') : t('douleurs.jourSans')}
              </button>
            ))}
          </div>
        )}
        <textarea value={commentaire} onChange={e => setCommentaire(e.target.value)}
                  placeholder={t('douleurs.commentairePlaceholder')} maxLength={500} rows={2}
                  aria-label={t('douleurs.commentaire')}
                  // 16 px minimum : en dessous, iOS zoome à la mise au point.
                  className="min-h-16 resize-none rounded-lg border border-border bg-background px-3 py-2 text-base" />
      </div>

      {erreur && <p role="alert" className="text-xs text-destructive">{erreur}</p>}

      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
        <button type="button" onClick={onAnnuler}
                className="h-12 rounded-lg border border-border px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('suiviKine.annuler')}
        </button>
        <button type="button" onClick={() => void envoyer()}
                disabled={occupe || (!douleur && !nom.trim())}
                className="h-12 truncate rounded-lg bg-gold px-4 text-xs font-semibold uppercase tracking-wider text-[#131316] disabled:opacity-40">
          ✓ {douleur ? t('douleurs.enregistrerLaNote', { valeur: intensite })
                     : t('douleurs.suivreAvecNote', { valeur: intensite })}
        </button>
      </div>
    </div>
  );
}
