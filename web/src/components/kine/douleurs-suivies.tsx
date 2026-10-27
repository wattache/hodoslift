import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FigureDuCorps } from '@/components/kine/figure-du-corps';
import { useDeclarerEtNoter, useDouleurs, useModifierDouleur, useNoterDouleur } from '@/api/hooks/use-douleurs';
import type { Douleur } from '@/api/types';
import { HistoireDeLaDouleur } from '@/components/kine/histoire-douleur';
import { SelecteurDIntensite } from '@/components/kine/selecteur-intensite';
import { SurLaLigne } from '@/components/kine/sur-la-ligne';
import { couleurDIntensite } from '@/lib/douleurs/intensite';
import { nomDesZones } from '@/lib/douleurs/libelles';
import { basculer, douleursTouchees, intensitesParZone } from '@/lib/douleurs/selection';
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
  const declarer = useDeclarerEtNoter(athleteId);
  const noter = useNoterDouleur(athleteId);
  const modifier = useModifierDouleur(athleteId);

  /** Les zones touchées sur la figure — plusieurs pour une douleur qui en
   *  porte plusieurs (FRE-196). */
  const [selection, setSelection] = useState<string[]>([]);
  /** Une zone déjà suivie propose d'abord sa douleur ; « nouvelle » est le
   *  geste explicite — un claquage du biceps n'est pas la vieille épaule. */
  const [nouvelle, setNouvelle] = useState(false);
  /** ⚠️ LES ZONES D'UNE DOULEUR SE CORRIGENT DEPUIS LA DOULEUR (FRE-196) : on
   *  choisit la douleur, puis la figure ajoute ou retire ses zones. Partir de la
   *  figure obligeait à toucher l'épaule PUIS le biceps pour trouver le geste. */
  const [edition, setEdition] = useState<{ id: string; nom: string; zones: string[] } | null>(null);
  const [nom, setNom] = useState('');
  const [intensiteNeuve, setIntensiteNeuve] = useState(3);
  const [entraineNeuve, setEntraineNeuve] = useState<boolean | undefined>(undefined);
  // Voir `NoteEchouee` : la douleur est créée, c'est la note qui n'est pas passée.
  const [erreurNote, setErreurNote] = useState<string | null>(null);
  const idNeuve = useId();

  const vivantes = douleurs.filter(d => !d.fin);
  const closes = douleurs.filter(d => d.fin);

  /** ⚠️ TOUCHER UNE ZONE DÉJÀ SUIVIE NE CRÉE RIEN D'EMBLÉE : les cartes des
   *  douleurs qui la portent se surlignent, et c'est là qu'on note. Une zone
   *  libre ouvre la déclaration. */
  const touchees = douleursTouchees(vivantes, selection);

  const toucher = (code: string) => {
    if (edition) { setEdition({ ...edition, zones: basculer(edition.zones, code) }); return; }
    setSelection(basculer(selection, code));
    setNouvelle(false);
  };

  const enregistrerLesZones = async () => {
    if (!edition?.zones.length) return;
    await modifier.mutateAsync({ id: edition.id, zones: edition.zones });
    setEdition(null);
  };

  const fermer = () => { setSelection([]); setNouvelle(false); setNom(''); setErreurNote(null); };

  const valider = async () => {
    if (!selection.length || !nom.trim()) return;
    setErreurNote(null);
    try {
      await declarer.mutateAsync({ nom: nom.trim(), zones: selection, intensite: intensiteNeuve,
                                   commentaire: null, entrainement: entraineNeuve });
    } catch {
      setErreurNote(t('douleurs.noteEchouee'));
      return;
    }
    fermer(); setIntensiteNeuve(3); setEntraineNeuve(undefined);
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">{t('suiviKine.chargement')}</p>;

  const feuilleOuverte = canWrite && !edition && selection.length > 0 && (touchees.length === 0 || nouvelle);
  const zonesMontrees = edition ? edition.zones : selection;

  return (
    /* ⚠️ LA FEUILLE EST HORS FLUX, DONC RIEN NE POUSSE LA PAGE — et sans cette
       réserve en bas, le défilement s'arrête avant d'avoir pu remonter la
       figure au-dessus d'elle. On touchait alors un mollet qu'on ne voyait
       pas. Sur grand écran le formulaire est dans une colonne : aucune
       réserve à prévoir. */
    <div className={cn('flex flex-col gap-4', feuilleOuverte && 'pb-[64vh] lg:pb-0')}>
      {/* ⚠️ DEUX COLONNES, ET C'EST LA FORME QUI PORTE LE GESTE : le corps à
          gauche, ce qu'on en dit à droite. Empilés, la figure passait sous les
          cartes et on ne voyait plus le lien entre toucher un muscle et ce qui
          s'ouvre. En dessous de `lg`, une seule colonne — un téléphone ne tient
          pas les deux de front. */}
      <section className="rounded-2xl border border-border bg-card p-4 lg:p-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <div className="flex flex-col gap-3">
            <header>
              <h2 className="text-2xl font-semibold uppercase tracking-tight">
                {/* ⚠️ LE TITRE DU STAFF NE PRÉSUME PAS DU GENRE de l'athlète —
                    et il ne le pourrait pas : 26 fiches de production sur 69
                    n'en portent aucun. */}
                {canWrite ? t('douleurs.ouAsTuMal') : t('douleurs.ouIlAMal')}
              </h2>
              {/* ⚠️ CE QUI N'AIDE PLUS S'EFFACE QUAND LA FEUILLE MONTE. Sur un
                  téléphone, chaque ligne gardée ici est une ligne de moins pour
                  le corps — et la consigne « touche la zone » n'a plus d'objet
                  une fois qu'on vient de le faire. */}
              {canWrite && !feuilleOuverte && !edition && (
                <p className="text-sm text-muted-foreground lg:block">{t('douleurs.toucheLaZone')}</p>
              )}
            </header>

            {/* ⚠️ AU-DESSUS DE LA FIGURE, ET PAS DANS LA CARTE : sur téléphone la
                carte est sous le corps, et c'est le corps qu'on touche. */}
            {edition && (
              <div className="flex flex-col gap-2 rounded-xl border border-gold p-3" data-edition-zones>
                <p className="text-sm font-semibold">{t('douleurs.zonesDe', { nom: edition.nom })}</p>
                <p className="text-[11px] uppercase tracking-wider text-gold">
                  {edition.zones.length ? nomDesZones(edition.zones, t) : '—'}
                </p>
                <p className="text-xs text-muted-foreground">{t('douleurs.toucheLaFigurePourLesZones')}</p>
                <div className="flex flex-wrap gap-2">
                  {/* Sans zone, la douleur disparaîtrait de la figure sans être close. */}
                  <button type="button" onClick={() => void enregistrerLesZones()}
                          disabled={!edition.zones.length || modifier.isPending}
                          className="h-11 rounded-lg bg-gold px-4 text-sm font-semibold text-[#131316] disabled:opacity-40">
                    {t('suiviKine.enregistrer')}
                  </button>
                  <button type="button" onClick={() => setEdition(null)}
                          className="h-11 rounded-lg border border-border px-4 text-sm text-muted-foreground">
                    {t('suiviKine.annuler')}
                  </button>
                </div>
              </div>
            )}

            {/* ⚠️ LA RANGÉE N'EXISTE QUE SUR TÉLÉPHONE, où les cartes sont
                reléguées sous la figure : sans elle, on ne sait pas ce qu'on
                suit déjà avant d'avoir fait défiler tout le corps. Sur grand
                écran la colonne de droite le dit en permanence. */}
            {vivantes.length > 0 && !feuilleOuverte && (
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:hidden">
                {vivantes.map(d => (
                  <button key={d.id} type="button"
                          onClick={() => { setSelection(d.zones); setNouvelle(false); }}
                          aria-pressed={touchees.includes(d)}
                          className={cn('flex h-11 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm',
                            touchees.includes(d) ? 'border-gold' : 'border-border')}>
                    <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm"
                          style={{ backgroundColor: d.derniere
                            ? couleurDIntensite(d.derniere.intensite) : 'var(--muted-foreground)' }} />
                    <span className="whitespace-nowrap">{nomDesZones(d.zones, t)}</span>
                    {d.derniere && (
                      <span className="tabular-nums text-muted-foreground">
                        {d.derniere.intensite}/10
                      </span>
                    )}
                    {/* ⚠️ LE POINT DIT « ÇA FAIT UN MOMENT », pas « c'est
                        grave » : une douleur qu'on suit et qu'on ne note plus
                        depuis une semaine n'est pas suivie, elle est oubliée. */}
                    {aRelancer(d.derniere?.date) && (
                      <span aria-label={t('douleurs.aRelancer')}
                            className="inline-block h-2 w-2 rounded-full bg-[#E08A3C]" />
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* ⚠️ LES MUSCLES DÉJÀ SUIVIS SONT MARQUÉS D'EMBLÉE. Sans ça, on
                retouchait l'épaule qu'on suit déjà — la réponse (« c'est la
                même, la voici ») arrivait après le geste au lieu d'avant. */}
            <FigureDuCorps choisies={zonesMontrees}
                           suivies={intensitesParZone(vivantes)}
                           onChoisir={canWrite ? toucher : undefined}
                           nomChoisi={zonesMontrees.length ? nomDesZones(zonesMontrees, t) : null}
                           compacte={selection.length > 0} />
          </div>

          {/* LA COLONNE DE DROITE BASCULE : la liste des douleurs suivies, ou
              le formulaire de déclaration quand on vient de toucher un muscle
              libre. Les deux à la fois obligeraient à choisir où regarder. */}
          <div className="flex flex-col gap-3">
            {/* ⚠️ UNE FEUILLE SUR TÉLÉPHONE, UNE COLONNE SUR GRAND ÉCRAN — le
                même formulaire, deux places. `fixed` sous `lg` pour qu'il reste
                sous le pouce sans pousser la figure hors de l'écran ; `static`
                au-dessus, où il prend la colonne de droite. Le `pb` laisse
                passer la barre de navigation du bas et l'encoche. */}
            {feuilleOuverte && (
          <div className="fixed inset-x-0 bottom-0 z-40 flex max-h-[62vh] flex-col gap-3
                          overflow-y-auto rounded-t-2xl border-t border-gold bg-card p-4
                          pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl
                          lg:static lg:max-h-none lg:rounded-xl lg:border lg:p-4
                          lg:pb-4 lg:shadow-none">
            <header>
              <h4 className="text-sm font-semibold">{t('douleurs.nouvelleDouleur')}</h4>
              <p className="text-[11px] uppercase tracking-wider text-gold">
                {nomDesZones(selection, t)}
              </p>
            </header>
            <p className="text-xs text-muted-foreground">{t('douleurs.toucheAutresZones')}</p>

            <label htmlFor="nom-douleur" className="text-xs text-muted-foreground">
              {t('douleurs.commentLAppeler', { zone: nomDesZones(selection, t) })}
            </label>
            <input id="nom-douleur" value={nom} onChange={e => setNom(e.target.value)}
                   placeholder={t('douleurs.exempleNom')} maxLength={80}
                   className="h-11 rounded-lg border border-border bg-background px-3 text-base" />

            <SelecteurDIntensite id={idNeuve} valeur={intensiteNeuve} onChange={setIntensiteNeuve} />

            {erreurNote && <p role="alert" className="text-xs text-destructive">{erreurNote}</p>}

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void valider()}
                      disabled={!nom.trim() || declarer.isPending}
                      className="h-11 rounded-lg bg-gold px-4 text-sm font-semibold text-[#131316] disabled:opacity-40">
                {t('douleurs.suivre')}
              </button>
              <button type="button"
                      onClick={fermer}
                      className="h-11 rounded-lg border border-border px-4 text-sm text-muted-foreground">
                {t('suiviKine.annuler')}
              </button>
            </div>
          </div>
        )}

            {!feuilleOuverte && (
              <>
                {/* Les zones touchées portent déjà une douleur : la noter, ou
                    en déclarer une autre — l'athlète tranche. */}
                {canWrite && !edition && touchees.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gold/60 p-3"
                       data-deja-suivie>
                    <span className="text-xs text-muted-foreground">
                      {t('douleurs.dejaSuivieIci')} · {nomDesZones(selection, t)}
                    </span>
                    <button type="button" onClick={() => { setNouvelle(true); setNom(''); }}
                            className="h-11 rounded-lg border border-border px-3 text-sm">
                      {t('douleurs.nouvelleDouleur')}
                    </button>
                  </div>
                )}
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
                                surligne={touchees.includes(d)}
                                onModifierLesZones={() => {
                                  setSelection([]); setNouvelle(false);
                                  setEdition({ id: d.id, nom: d.nom, zones: d.zones });
                                }}
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

      {closes.length > 0 && (
        <details className="rounded-lg border border-border bg-card/40 p-3">
          {/* ⚠️ LES CLOSES RESTENT LISIBLES : une épaule qui a fait mal six mois
              est un antécédent, et c'est ce que le kiné vient chercher. Repliées,
              parce que ce n'est pas ce qu'on regarde en premier. */}
          <summary className="cursor-pointer text-sm text-muted-foreground">
            {t('douleurs.anciennes', { count: closes.length })}
          </summary>
          <ul className="mt-3 flex flex-col gap-2">
            {closes.map(d => (
              <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{d.nom}</span>
                <span className="text-xs text-muted-foreground">
                  {nomDesZones(d.zones, t)} · {t('douleurs.closeLe', { date: d.fin })}
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

/** ⚠️ SEPT JOURS, ET C'EST UN SEUIL D'ATTENTION, PAS DE GRAVITÉ. Une douleur
 *  notée il y a plus d'une semaine n'est plus suivie : le point le dit avant
 *  qu'on ait à ouvrir sa carte. */
function aRelancer(derniere?: string): boolean {
  if (!derniere) return true;
  return Date.parse(todayIso()) - Date.parse(derniere) >= 7 * 86_400_000;
}

function CarteDouleur({ douleur, canWrite, athleteId, surligne, onModifierLesZones, onNoter, onClore }: {
  douleur: Douleur; canWrite: boolean; athleteId: string; surligne: boolean;
  onModifierLesZones: () => void;
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

  // ⚠️ RETOUCHER LE MUSCLE SUR LA FIGURE OUVRE LA SAISIE, et la retoucher la
  // referme : c'est le même geste, et `surligne` est ce qui le transporte.
  useEffect(() => { if (canWrite) setOuvert(surligne); }, [surligne, canWrite]);

  const valeur = douleur.derniere?.intensite;
  const couleur = valeur != null ? couleurDIntensite(valeur) : undefined;

  return (
    <section className={cn('rounded-xl border bg-card p-4 transition-colors',
                           surligne ? 'border-gold' : 'border-border')}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          {/* La pastille dit l'intensité avant qu'on ait lu quoi que ce soit. */}
          <span aria-hidden className="mt-1 inline-block h-3 w-3 shrink-0 rounded-sm"
                style={{ backgroundColor: couleur ?? 'var(--muted-foreground)' }} />
          <div>
            <h3 className="text-sm font-semibold">{douleur.nom}</h3>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {nomDesZones(douleur.zones, t)}
              {/* ⚠️ « ÇA REVIENT » VIENT DU SERVEUR, où ça se déduit du nombre
                  de relevés. Le recalculer ici ferait une seconde définition. */}
              {douleur.recurrente && ` · ${t('douleurs.recurrente', { count: douleur.logs })}`}
            </p>
          </div>
        </div>
        <BadgeDeFraicheur derniere={douleur.derniere?.date} />
      </header>

      {valeur != null && (
        <div className="mt-3 flex items-center gap-3">
          <p className="text-3xl font-semibold leading-none tabular-nums" style={{ color: couleur }}>
            {valeur}<span className="text-sm text-muted-foreground">/10</span>
          </p>
          {/* ⚠️ CHAQUE CASE PREND LA COULEUR DE SON PROPRE NIVEAU, pas celle de
              la note : la jauge montre alors où l'on se situe SUR l'échelle, et
              pas seulement combien de cases sont pleines. */}
          <div aria-hidden className="flex flex-1 gap-1">
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} className="h-1.5 flex-1 rounded-full"
                    style={{ backgroundColor: i < valeur ? couleurDIntensite(i + 1) : 'var(--muted)' }} />
            ))}
          </div>
        </div>
      )}

      {douleur.derniere?.commentaire && (
        <p className="mt-2 text-xs italic text-muted-foreground">
          « {douleur.derniere.commentaire} »
        </p>
      )}
      {/* Sur quelle ligne de séance ça a fait mal — quand la note vient de là. */}
      {douleur.derniere && douleur.derniere.exercices.length > 0 && (
        <SurLaLigne exercices={douleur.derniere.exercices} className="mt-2" />
      )}

      {/* ⚠️ L'HISTOIRE NE SE CHARGE QU'UNE FOIS DEMANDÉE, et c'est la règle du
          ticket : la liste des douleurs se lit à chaque ouverture de l'écran,
          y embarquer tous les relevés ferait payer l'historique à qui vient
          juste voir où il a mal. Non monté, le hook n'appelle rien. */}
      {histoire && douleur.logs > 1 && (
        <HistoireDeLaDouleur athleteId={athleteId} douleurId={douleur.id} />
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {canWrite && !ouvert && (
          <button type="button" onClick={() => setOuvert(true)}
                  className="h-11 rounded-lg border border-gold px-4 text-sm font-semibold text-gold">
            {dejaAujourdhui ? t('douleurs.corrigerAujourdhui') : t('douleurs.noterAujourdhui')}
          </button>
        )}
        {canWrite && (
          <button type="button" onClick={onModifierLesZones}
                  className="h-11 rounded-lg border border-border px-4 text-sm text-muted-foreground hover:text-foreground">
            {t('douleurs.modifierLesZones')}
          </button>
        )}

        {/* ⚠️ L'HISTOIRE A SON PROPRE BOUTON, et il porte le COMPTE : sans lui,
            rien ne dit qu'il y a quelque chose à déplier. Il n'apparaît qu'à
            partir de deux relevés — un seul est déjà montré en grand au-dessus. */}
        {douleur.logs > 1 && (
          <button type="button" onClick={() => setHistoire(h => !h)}
                  aria-expanded={histoire}
                  className="h-11 rounded-lg border border-border px-4 text-sm text-muted-foreground hover:text-foreground">
            {histoire ? t('douleurs.masquerHistoire')
                      : t('douleurs.voirHistoire', { count: douleur.logs })}
          </button>
        )}
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
