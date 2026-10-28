import { History, Pencil, Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DeclarerOuNoter, ZonesEnPuces } from '@/components/kine/declarer-ou-noter';
import { FigureDuCorps } from '@/components/kine/figure-du-corps';
import { useDouleurs, useModifierDouleur, useNoterDouleur } from '@/api/hooks/use-douleurs';
import type { Douleur } from '@/api/types';
import { HistoireDeLaDouleur } from '@/components/kine/histoire-douleur';
import { SelecteurDIntensite } from '@/components/kine/selecteur-intensite';
import { SurLaLigne } from '@/components/kine/sur-la-ligne';
import { cleDIntensite, couleurDIntensite } from '@/lib/douleurs/intensite';
import { nomDeZoneCourt, nomDesZones } from '@/lib/douleurs/libelles';
import { basculer, intensitesParZone } from '@/lib/douleurs/selection';
import { todayIso } from '@/lib/dates';
import { cn } from '@/lib/utils';

type Props = {
  athleteId: string;
  canWrite: boolean;
};

/** LES DOULEURS SUIVIES — FRE-195.
 *
 *  ⚠️ CE QUI MANQUAIT N'ÉTAIT PAS LA MESURE, C'ÉTAIT L'IDENTITÉ. L'intensité se
 *  saisit depuis août dans le formulaire du jour ; mais rien ne reliait deux
 *  signalements de la même épaule, et sur huit saisies de production, personne
 *  n'a jamais noté deux fois. Ici une douleur porte un nom, et on la retrouve.
 *
 *  ⚠️ LE STAFF LIT, L'ATHLÈTE ÉCRIT. `canWrite` suit ce que brokkr accepte : la
 *  liste est en `owner_or_staff`, les écritures en `owner`. Un bouton qui mène à
 *  un 403 n'existe pas. */
export function DouleursSuivies({ athleteId, canWrite }: Props) {
  const { t } = useTranslation();
  const { data: douleurs = [], isLoading } = useDouleurs(athleteId);
  const noter = useNoterDouleur(athleteId);
  const modifier = useModifierDouleur(athleteId);

  /** Les zones touchées sur la figure, pour déclarer ou noter. */
  const [selection, setSelection] = useState<string[]>([]);
  /** La douleur à proposer d'abord, quand on part d'elle (la rangée « en cours »). */
  const [prefere, setPrefere] = useState<string | null>(null);
  /** ⚠️ LA FIGURE N'A PAS DE MODES, ELLE A UN SUJET. Aucun : un toucher
   *  sélectionne. Une douleur : un toucher ajoute ou retire une zone DE CETTE
   *  douleur. Le bandeau au-dessus de la figure le dit en permanence. */
  const [sujet, setSujet] = useState<{ id: string; nom: string; zones: string[] } | null>(null);

  const vivantes = douleurs.filter(d => !d.fin);
  const closes = douleurs.filter(d => d.fin);

  const toucher = (code: string) => {
    if (sujet) { setSujet({ ...sujet, zones: basculer(sujet.zones, code) }); return; }
    setSelection(basculer(selection, code));
    setPrefere(null);
  };
  const fermer = () => { setSelection([]); setPrefere(null); };

  const editer = (d: Douleur) => { fermer(); setSujet({ id: d.id, nom: d.nom, zones: d.zones }); };
  const terminer = async () => {
    if (!sujet?.zones.length) return;
    await modifier.mutateAsync({ id: sujet.id, zones: sujet.zones });
    setSujet(null);
  };
  const retirer = (z: string) => sujet && setSujet({ ...sujet, zones: sujet.zones.filter(x => x !== z) });

  if (isLoading) return <p className="text-sm text-muted-foreground">{t('suiviKine.chargement')}</p>;

  const formulaire = canWrite && !sujet && selection.length > 0;
  const choisies = sujet ? sujet.zones : selection;
  const eteintes = sujet
    ? vivantes.filter(d => d.id !== sujet.id).flatMap(d => d.zones).filter(z => !sujet.zones.includes(z))
    : [];

  return (
    /* ⚠️ LA FEUILLE ET LA BARRE SONT HORS FLUX, DONC RIEN NE POUSSE LA PAGE —
       sans cette réserve en bas, le défilement s'arrête avant d'avoir pu
       remonter la figure au-dessus d'elles. */
    <div className={cn('flex flex-col gap-4', formulaire && 'pb-[64vh] lg:pb-0', sujet && 'pb-48 lg:pb-0')}>
      <section className="rounded-2xl border border-border bg-card p-4 lg:p-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <div className="flex min-w-0 flex-col gap-3">
            <h2 className="text-2xl font-semibold uppercase tracking-tight">
              {/* ⚠️ LE TITRE DU STAFF NE PRÉSUME PAS DU GENRE de l'athlète. */}
              {canWrite ? t('douleurs.ouAsTuMal') : t('douleurs.ouIlAMal')}
            </h2>

            {/* ⚠️ LA RANGÉE « EN COURS » N'EXISTE QUE SUR TÉLÉPHONE, où les cartes
                sont sous la figure. Elle porte le NOM que l'athlète a donné, et
                elle EMPILE : une rangée qui défile faisait déborder la page. */}
            {vivantes.length > 0 && !formulaire && !sujet && (
              <div className="flex flex-col gap-2 lg:hidden">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {t('douleurs.enCours', { count: vivantes.length })}
                </p>
                {vivantes.map(d => (
                  <LigneEnCours key={d.id} douleur={d}
                                onOuvrir={canWrite ? () => { setSelection(d.zones); setPrefere(d.id); } : undefined} />
                ))}
              </div>
            )}

            {/* ⚠️ LE SUJET DE LA FIGURE, ÉCRIT AU-DESSUS D'ELLE, ET TOUJOURS LÀ :
                sa présence constante est ce qui rend sa couleur lisible quand il
                passe à l'or. */}
            {canWrite && (
              <div data-sujet-figure
                   className={cn('flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm',
                                 sujet ? 'border-gold bg-gold/10 font-semibold text-gold'
                                       : 'border-border text-muted-foreground')}>
                <span className="min-w-0 truncate">
                  {sujet ? t('douleurs.zonesDe', { nom: sujet.nom }) : t('douleurs.toucheLaZone')}
                </span>
                {sujet && (
                  <span className="shrink-0 font-mono text-xs">
                    {t('douleurs.nbZones', { count: sujet.zones.length })}
                  </span>
                )}
              </div>
            )}

            {/* ⚠️ LES MUSCLES DÉJÀ SUIVIS SONT MARQUÉS D'EMBLÉE. Pendant
                l'édition, ceux des AUTRES douleurs s'éteignent : la figure dit
                qu'ils ne sont pas le sujet. */}
            <FigureDuCorps choisies={choisies}
                           suivies={sujet ? {} : intensitesParZone(vivantes)}
                           eteintes={eteintes}
                           onChoisir={canWrite ? toucher : undefined}
                           nomChoisi={choisies.length ? nomDesZones(choisies, t) : null}
                           compacte={formulaire} />
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            {/* ⚠️ UNE FEUILLE SUR TÉLÉPHONE, UNE COLONNE SUR GRAND ÉCRAN — le même
                formulaire, deux places, et le même que dans le volet de séance. */}
            {formulaire && (
              <div className="fixed inset-x-0 bottom-0 z-40 flex max-h-[62vh] flex-col gap-3
                              overflow-y-auto rounded-t-2xl border-t border-gold bg-card p-4
                              pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl
                              lg:static lg:max-h-none lg:rounded-xl lg:border lg:p-4
                              lg:z-auto lg:pb-4 lg:shadow-none">
                <DeclarerOuNoter key={selection.join('|')} athleteId={athleteId} zones={selection}
                                 vivantes={vivantes} jour={todayIso()} prefere={prefere}
                                 onFini={fermer} onAnnuler={fermer} />
              </div>
            )}

            {!formulaire && (
              <>
                <header className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold uppercase tracking-wider">
                    {t('douleurs.suivies')}
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {t('douleurs.enCours', { count: vivantes.length })}
                  </span>
                </header>

                {vivantes.length === 0 && (
                  <p className="rounded-lg border border-dashed border-border bg-background/40 p-6 text-center text-sm text-muted-foreground">
                    {canWrite ? t('douleurs.aucuneVous') : t('douleurs.aucune')}
                  </p>
                )}

                {vivantes.map(d => (
                  <CarteDouleur key={d.id} douleur={d} canWrite={canWrite}
                                athleteId={athleteId}
                                edition={sujet?.id === d.id ? {
                                  zones: sujet.zones, occupe: modifier.isPending,
                                  onRetirer: retirer, onTerminer: () => void terminer(),
                                  onAnnuler: () => setSujet(null),
                                } : undefined}
                                onModifierLesZones={sujet ? undefined : () => editer(d)}
                                onNoter={(intensite, commentaire, entrainement) =>
                                  noter.mutateAsync({ id: d.id, jour: todayIso(), intensite,
                                                      commentaire, entrainement })}
                                onClore={() => modifier.mutateAsync({ id: d.id, fin: todayIso() })} />
                ))}
              </>
            )}
          </div>
        </div>
      </section>

      {/* ⚠️ TÉLÉPHONE : LA BARRE D'ÉDITION EST EN BAS, au-dessus de la barre de
          navigation. En haut, elle sortait du champ dès qu'on défilait vers la
          figure — et « Enregistrer » avec elle. La consigne et les zones vivent
          avec elle, au moment où l'on valide. */}
      {sujet && (
        <div data-barre-edition
             className="fixed inset-x-0 z-40 flex flex-col gap-2 border-t border-gold bg-card p-3 shadow-2xl lg:hidden"
             style={{ bottom: 'var(--barre-basse, 0px)' }}>
          <ZonesEnPuces zones={sujet.zones} onRetirer={retirer} />
          <BoutonsDEdition zones={sujet.zones} occupe={modifier.isPending}
                           onTerminer={() => void terminer()} onAnnuler={() => setSujet(null)} />
          <p className="text-center text-xs text-muted-foreground">{t('douleurs.toucheLaFigurePourLesZones')}</p>
        </div>
      )}

      {closes.length > 0 && (
        <details className="rounded-lg border border-border bg-card/40 p-3">
          {/* ⚠️ LES CLOSES RESTENT LISIBLES : une épaule qui a fait mal six mois
              est un antécédent, et c'est ce que le kiné vient chercher. */}
          <summary className="cursor-pointer text-sm text-muted-foreground">
            {t('douleurs.anciennes', { count: closes.length })}
          </summary>
          <ul className="mt-3 flex flex-col gap-2">
            {closes.map(d => (
              <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{d.nom}</span>
                <span className="text-xs text-muted-foreground">
                  {d.zones.map(z => nomDeZoneCourt(z, t)).join(' · ')} · {t('douleurs.closeLe', { date: d.fin })}
                  {d.recurrente && ` · ${t('douleurs.revenait', { count: d.logs })}`}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Une douleur en cours, sur la rangée du téléphone : son NOM, ses zones en
 *  court, sa dernière note. */
function LigneEnCours({ douleur, onOuvrir }: { douleur: Douleur; onOuvrir?: () => void }) {
  const { t } = useTranslation();
  const valeur = douleur.derniere?.intensite;
  const contenu = (
    <>
      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: valeur != null ? couleurDIntensite(valeur) : 'var(--muted-foreground)' }} />
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="truncate text-sm font-semibold">{douleur.nom}</span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {douleur.zones.map(z => nomDeZoneCourt(z, t)).join(' · ')}
        </span>
      </span>
      {/* ⚠️ LE POINT DIT « ÇA FAIT UN MOMENT », pas « c'est grave ». */}
      {aRelancer(douleur.derniere?.date) && (
        <span aria-label={t('douleurs.aRelancer')} className="h-2 w-2 shrink-0 rounded-full bg-[#E08A3C]" />
      )}
      {valeur != null && (
        <span className="font-mono text-sm font-semibold tabular-nums" style={{ color: couleurDIntensite(valeur) }}>
          {valeur}/10
        </span>
      )}
    </>
  );
  const classes = 'flex min-h-12 w-full items-center gap-3 rounded-lg border border-border px-3 py-1.5';
  return onOuvrir
    ? <button type="button" onClick={onOuvrir} className={classes} data-ligne-en-cours>{contenu}</button>
    : <div className={classes}>{contenu}</div>;
}

/** « Terminé » se ferme sans zone : la douleur disparaîtrait de la figure sans
 *  être close. */
function BoutonsDEdition({ zones, occupe, onTerminer, onAnnuler }: {
  zones: string[]; occupe: boolean; onTerminer: () => void; onAnnuler: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-2">
      <button type="button" onClick={onTerminer} disabled={!zones.length || occupe}
              className="h-11 flex-1 rounded-lg bg-gold px-4 text-sm font-semibold text-[#131316] disabled:opacity-40 lg:flex-none">
        {t('douleurs.termine')}
      </button>
      <button type="button" onClick={onAnnuler}
              className="h-11 rounded-lg border border-border px-4 text-sm text-muted-foreground">
        {t('suiviKine.annuler')}
      </button>
    </div>
  );
}

/** ⚠️ SEPT JOURS, ET C'EST UN SEUIL D'ATTENTION, PAS DE GRAVITÉ. Une douleur
 *  notée il y a plus d'une semaine n'est plus suivie : le point le dit avant
 *  qu'on ait à ouvrir sa carte. */
function aRelancer(derniere?: string): boolean {
  if (!derniere) return true;
  return Date.parse(todayIso()) - Date.parse(derniere) >= 7 * 86_400_000;
}

type Edition = {
  zones: string[]; occupe: boolean;
  onRetirer: (zone: string) => void; onTerminer: () => void; onAnnuler: () => void;
};

function CarteDouleur({ douleur, canWrite, athleteId, edition, onModifierLesZones, onNoter, onClore }: {
  douleur: Douleur; canWrite: boolean; athleteId: string;
  /** Présente quand cette douleur est le SUJET de la figure. */
  edition?: Edition;
  /** Absent pendant qu'une autre douleur est éditée : un sujet à la fois. */
  onModifierLesZones?: () => void;
  onNoter: (intensite: number, commentaire: string | null,
            entrainement: boolean | undefined) => Promise<unknown>;
  onClore: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const dejaAujourdhui = douleur.derniere?.date === todayIso();
  const [intensite, setIntensite] = useState(douleur.derniere?.intensite ?? 3);
  const [commentaire, setCommentaire] = useState(
    dejaAujourdhui ? (douleur.derniere?.commentaire ?? '') : '');
  const [ouvert, setOuvert] = useState(false);
  /** ⚠️ LIRE ET ÉCRIRE SONT DEUX GESTES, ET ILS ÉTAIENT CONFONDUS. L'historique
   *  ne s'ouvrait qu'avec la saisie : pour relire ses notes, il fallait cliquer
   *  « Corriger la note du jour » — faire mine d'écrire pour lire. Et le staff,
   *  qui n'écrit pas, le voyait toujours déplié : la même carte se comportait
   *  de deux façons selon qui la regarde. */
  const [histoire, setHistoire] = useState(false);
  const [entraine, setEntraine] = useState<boolean | undefined>(
    dejaAujourdhui ? (douleur.derniere?.entrainement ?? undefined) : undefined);
  const idSel = useId();

  const valeur = douleur.derniere?.intensite;
  const couleur = valeur != null ? couleurDIntensite(valeur) : undefined;

  return (
    /* ⚠️ L'OR RELIE LA CARTE ET LA FIGURE : la douleur éditée prend le même
       cadre que le bandeau au-dessus du corps — on voit ce qu'on modifie. */
    <section data-edition={edition ? '' : undefined}
             className={cn('rounded-xl border p-4 lg:p-5 transition-colors',
                           edition ? 'border-2 border-gold bg-gold/5' : 'border-border bg-card')}>
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded border border-gold/60 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold">
            {t('douleurs.enCoursBadge')}
          </span>
          <BadgeDeFraicheur derniere={douleur.derniere?.date} />
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-xl font-semibold uppercase tracking-tight">
              <span className="truncate">{douleur.nom}</span>
              {/* La pastille dit l'intensité avant qu'on ait lu quoi que ce soit. */}
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: couleur ?? 'var(--muted-foreground)' }} />
            </h3>
            <p className="font-mono text-[11px] text-muted-foreground" title={nomDesZones(douleur.zones, t)}>
              {douleur.zones.map(z => nomDeZoneCourt(z, t)).join(' · ')}
              {/* ⚠️ « ÇA REVIENT » VIENT DU SERVEUR, où ça se déduit du nombre
                  de relevés. Le recalculer ici ferait une seconde définition. */}
              {douleur.recurrente && ` · ${t('douleurs.recurrente', { count: douleur.logs })}`}
            </p>
          </div>
          {valeur != null && (
            <div className="shrink-0 text-right" data-dernier-releve>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('douleurs.dernierReleve')}
              </p>
              <p className="flex items-baseline justify-end gap-1" style={{ color: couleur }}>
                <span className="font-mono text-3xl font-semibold leading-none tabular-nums">{valeur}</span>
                <span className="font-mono text-xs text-muted-foreground">/10</span>
                <span className="text-[11px] font-semibold uppercase">{t(cleDIntensite(valeur))}</span>
              </p>
            </div>
          )}
        </div>
      </header>

      {!histoire && douleur.derniere?.commentaire && (
        <p className="mt-3 border-l-2 border-gold/40 pl-3 text-xs italic text-muted-foreground">
          « {douleur.derniere.commentaire} »
        </p>
      )}
      {/* Sur quelle ligne de séance ça a fait mal — quand la note vient de là. */}
      {!histoire && douleur.derniere && douleur.derniere.exercices.length > 0 && (
        <SurLaLigne exercices={douleur.derniere.exercices} className="mt-2" />
      )}

      {/* ⚠️ L'HISTOIRE NE SE CHARGE QU'UNE FOIS DEMANDÉE, et c'est la règle du
          ticket : la liste des douleurs se lit à chaque ouverture de l'écran,
          y embarquer tous les relevés ferait payer l'historique à qui vient
          juste voir où il a mal. Non monté, le hook n'appelle rien. */}
      {histoire && douleur.logs > 1 && (
        <HistoireDeLaDouleur athleteId={athleteId} douleurId={douleur.id} />
      )}

      {/* L'édition dans la carte, sur grand écran ; au téléphone, c'est la
          barre du bas qui la porte. */}
      {edition && (
        <div className="mt-3 hidden flex-col gap-3 lg:flex">
          <div className="flex flex-wrap items-center gap-1.5">
            <ZonesEnPuces zones={edition.zones} onRetirer={edition.onRetirer} />
            <span className="rounded-full border border-dashed border-border px-2.5 py-0.5 font-mono text-xs text-muted-foreground">
              {t('douleurs.toucheLaFigure')}
            </span>
          </div>
          <BoutonsDEdition zones={edition.zones} occupe={edition.occupe}
                           onTerminer={edition.onTerminer} onAnnuler={edition.onAnnuler} />
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
        {canWrite && !ouvert && !edition && (
          <button type="button" onClick={() => setOuvert(true)}
                  className="flex h-12 items-center justify-center gap-2 rounded-lg bg-gold px-4 text-sm font-semibold uppercase tracking-wider text-[#131316]">
            <Plus className="h-4 w-4" aria-hidden />
            {dejaAujourdhui ? t('douleurs.corrigerAujourdhui') : t('douleurs.noterAujourdhui')}
          </button>
        )}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {canWrite && onModifierLesZones && (
          <button type="button" onClick={onModifierLesZones}
                  className="flex h-11 items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            {t('douleurs.modifierLesZones')}
          </button>
        )}

        {/* ⚠️ L'HISTOIRE A SON PROPRE BOUTON, et il porte le COMPTE : sans lui,
            rien ne dit qu'il y a quelque chose à déplier. Il n'apparaît qu'à
            partir de deux relevés — un seul est déjà montré en grand au-dessus. */}
        {douleur.logs > 1 && (
          <button type="button" onClick={() => setHistoire(h => !h)}
                  aria-expanded={histoire}
                  className="flex h-11 items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
            <History className="h-3.5 w-3.5" aria-hidden />
            {histoire ? t('douleurs.masquerHistoire')
                      : t('douleurs.voirHistoire', { count: douleur.logs })}
          </button>
        )}
        </div>
      </div>

      {canWrite && ouvert && (
        <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
          <SelecteurDIntensite id={idSel} valeur={intensite} onChange={setIntensite}
                               entrainement={entraine} onEntrainement={setEntraine} />
          <input value={commentaire} onChange={e => setCommentaire(e.target.value)}
                 placeholder={t('douleurs.commentairePlaceholder')} maxLength={500}
                 aria-label={t('douleurs.commentaire')}
                 // ⚠️ 16 px MINIMUM : en dessous, iOS zoome tout seul à la mise
                 // au point et l'écran part de travers.
                 className="h-11 rounded-lg border border-border bg-background px-3 text-base" />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button"
                    onClick={() => void onNoter(intensite, commentaire.trim() || null, entraine)
                      .then(() => setOuvert(false))}
                    className="h-11 rounded-lg bg-gold px-4 text-sm font-semibold text-[#131316]">
              {dejaAujourdhui ? t('douleurs.corrigerLaNote') : t('suiviKine.enregistrer')}
            </button>
            <button type="button" onClick={() => setOuvert(false)}
                    className="h-11 rounded-lg border border-border px-4 text-sm text-muted-foreground">
              {t('suiviKine.annuler')}
            </button>
            {/* ⚠️ À L'ÉCART DES DEUX AUTRES : clore est irréversible d'un geste,
                et se trouve ici à côté de « enregistrer ». */}
            <button type="button" onClick={() => void onClore()}
                    className="ml-auto h-11 rounded-lg px-3 text-sm text-muted-foreground hover:text-foreground">
              {t('douleurs.clore')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** DEPUIS QUAND CETTE DOULEUR N'A PAS ÉTÉ NOTÉE.
 *
 *  ⚠️ « NOTÉ AUJOURD'HUI » EST UNE BONNE NOUVELLE, le reste en est une autre :
 *  une douleur qu'on suit et qu'on ne note plus depuis cinq semaines n'est pas
 *  suivie, elle est oubliée. Les deux ne se disent donc pas de la même couleur. */
function BadgeDeFraicheur({ derniere }: { derniere?: string }) {
  const { t } = useTranslation();
  if (!derniere) return null;

  if (derniere === todayIso()) {
    return (
      <span className="rounded-full border border-gold px-2 py-0.5 text-[11px] text-gold">
        {t('douleurs.noteAujourdhui')}
      </span>
    );
  }

  const jours = Math.floor((Date.parse(todayIso()) - Date.parse(derniere)) / 86_400_000);
  return (
    <span className="rounded-full border border-[#E08A3C] px-2 py-0.5 text-[11px] text-[#E08A3C]">
      {jours < 7 ? t('douleurs.ilYaJours', { count: jours })
                 : t('douleurs.ilYaSemaines', { count: Math.floor(jours / 7) })}
    </span>
  );
}
