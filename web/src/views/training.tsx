import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { natureDe, type NatureDeGroupe } from "@/lib/groupe";
import { Check, ChevronDown, Layers, Loader2, Pencil, Plus, TriangleAlert, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { api } from '@/api/client';
import type { ContenuRealise } from '@/api/types';
import { EnteteDuProgramme } from '@/components/training/entete-du-programme';
import { WeekView } from '@/components/training/week-view';
import { VignetteEnregistrement } from '@/components/training/vignette-enregistrement';
import { useEnLigne } from '@/lib/reseau';
import { BlockObjectivesEditor, BlockObjectivesList } from '@/components/training/block-objectives-editor';
import { BlockBaseEditor } from '@/views/block-base-editor';
import { AjouterAvecMenu } from '@/components/ajouter-avec-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { parMouvementOuverts, useObjectifsTechniques } from '@/api/hooks/use-objectifs-techniques';
import { ObjectifsTechniquesPanel } from '@/components/training/objectifs-techniques-panel';
import { useAthleteSelection } from '@/lib/athlete-selection';
import { CLE_MON_ATHLETE } from '@/api/hooks/use-athletes';
import { useDisponibleHorsLigne } from '@/lib/disponible-hors-ligne';
import { useTrainingEditor } from '@/lib/training-editor';
import { useCoachLib } from '@/lib/coach-lib';
import { useLocalStorageState } from '@/lib/storage';
import { cn } from '@/lib/utils';

/** Vue Entraînement — arbre du programme (MacroTree) + WeekView, toggle
 *  athlète/coach, panneau GÉRER (cycle de vie), éditeur de BASE. */
/** Valide ce que le stockage rend : une valeur d'une autre version ne devient
 *  pas un mode. */
const estUnMode = (v: unknown): v is 'athlete' | 'coach' => v === 'athlete' || v === 'coach';

export function TrainingView() {
  const { t } = useTranslation();
  const sel = useAthleteSelection();
  const athlete = sel.selected;
  // LES OBJECTIFS TECHNIQUES de l'athlète (FRE-122) — regroupés par mouvement,
  // OUVERTS seulement. La pastille de chaque ligne y puise.
  //
  // ⚠️ UNE SEULE REQUÊTE POUR TOUT L'ÉCRAN, et c'est la leçon de FRE-119 :
  // interroger par mouvement aurait produit autant d'appels que de lignes
  // affichées. Un athlète a quelques dizaines d'objectifs en tout.
  const { data: objectifs = [] } = useObjectifsTechniques(sel.selectedId);
  const objectifsOuverts = useMemo(() => parMouvementOuverts(objectifs), [objectifs]);
  const canUseCoachMode = sel.canManage;
  /* ⚠️ LE MODE SE GARDE COMME LA SÉLECTION D'ATHLÈTE (FRE-178). C'était un état
   * local de cette vue : aller voir un 1RM ou la bibliothèque la démontait, et le
   * retour la remontait en mode athlète — un clic de plus à chaque détour, et les
   * semaines masquées cachées entre-temps. Désormais une PRÉFÉRENCE par
   * utilisateur, pas par athlète : le mode coach choisi vaut pour la session.
   *
   * ⚠️ LA PRÉFÉRENCE N'EST PAS LE MODE. Sur un athlète qu'on ne gère pas, l'écran
   * est en mode athlète SANS effacer la préférence : revenir sur un athlète géré
   * retrouve le mode coach. Et sans aucun clic, c'est le mode athlète. */
  const [preferenceDeMode, setMode] = useLocalStorageState<'athlete' | 'coach'>(
    `eitri-mode-entrainement:${sel.me?.uid ?? 'anonymous'}`, 'athlete', estUnMode);
  const mode = canUseCoachMode && preferenceDeMode === 'coach' ? 'coach' : 'athlete';
  /* ⚠️ LE TABLEAU DU BLOC N'A PLUS DE BASCULE ICI (FRE-114). Il en a eu une, à
   * côté d'« Éditer la BASE » — mais elle vivait derrière le mode coach, alors
   * que l'onglet « Programme » ouvre le même écran à l'athlète, au coach et au
   * kiné sans condition. Deux portes vers un écran identique, dont une réservée,
   * c'est l'inégalité que William a nommée : « faudrait que ça soit accessible
   * pour tout le monde ». Il n'en reste qu'une. */
  const [showBase, setShowBase] = useState(false);
  // ⚠️ L'ARBRE ENTIER NE SE CHARGE QUE POUR L'ÉDITEUR DE BASE (FRE-119), parce
  // qu'il est le seul à lire à travers les blocs : l'historique d'un mouvement
  // sur les blocs précédents, et les trames à dupliquer. C'est un geste de
  // coach, rare et volontaire ; l'athlète qui ouvre sa séance tous les jours ne
  // paie jamais ces 512 Ko.
  const editor = useTrainingEditor(
    sel.canView ? athlete?.programId : null,
    athlete?.currentOneRM ?? {},
    // ⚠️ `mode` PILOTE AUSSI CE QUE L'APERÇU CACHE (FRE-158). En mode Athlète —
    // le mode par DÉFAUT, même pour un coach — la semaine affichée ignore les
    // masquées, comme la barre le fait déjà pour les pastilles. Sans ça, le
    // coach voyait « SEMAINE 1 » et ses cinq séances dans l'aperçu de l'athlète
    // qu'il venait justement de masquer.
    { arbreComplet: showBase && canUseCoachMode, ignorerLesMasquees: mode !== 'coach' },
  );
  const coachLib = useCoachLib();

  // Les outils du coach partent FERMÉS : ce qu'on vient chercher, même en mode
  // coach, c'est la séance — pas le cycle de vie des objets qui la portent.
  /** CE QU'UNE SUPPRESSION VA DÉTRUIRE (FRE-130), demandé au clic.
   *
   *  ⚠️ AU CLIC ET NON EN PERMANENCE : l'écran n'a pas besoin de ce compte tant
   *  que personne ne vise la corbeille, et le demander à chaque rendu de l'arbre
   *  ferait trois requêtes de plus par navigation, pour rien.
   *
   *  ⚠️ ET L'ÉCHEC EST SILENCIEUX, DÉLIBÉRÉMENT. Sans réseau, on affiche le
   *  dialogue sans la phrase : un geste légitime ne se prend pas en otage par
   *  une information de confort. */
  const programId = athlete?.programId;
  const contenuRealise = useCallback(async (
    niveau: 'macro' | 'bloc' | 'semaine', id: string | undefined,
  ) => {
    // ⚠️ UN NIVEAU SANS `id` N'A JAMAIS ÉTÉ ENREGISTRÉ (la famille `…Editing`,
    // FRE-70) : il ne peut rien porter de réalisé, et l'interroger rendrait 404.
    if (!id || !programId) return null;
    try {
      return await api.get<ContenuRealise>(
        `/programs/${programId}/realise/${niveau}/${id}`);
    } catch {
      return null;
    }
  }, [programId]);

  const [outilsOuverts, setOutilsOuverts] = useState(false);

  const { macro, block, week, macroIndex, blockIndex, weekIndex } = editor.selection;
  /** POURQUOI « + Semaine » est fermé — `null` quand il est ouvert (FRE-138).
   *
   *  ⚠️ LA RÈGLE EST CELLE DE BROKKR, qui refuse en 409 `base_sans_dates` : une
   *  semaine ne NAÎT plus d'un bloc dont la BASE n'a pas le début ET la fin de S1.
   *  « + Semaine » contournait le refus de la génération et fabriquait des
   *  semaines nues — 4 149 lignes réalisées hors de toute courbe le 15/09. Le
   *  front ne propose l'écriture que là où le serveur l'accepte.
   *
   *  ⚠️ `block.base` ABSENT N'EST PAS « SANS DATES » : la BASE n'arrive qu'avec le
   *  contenu du bloc. Tant qu'elle manque, on ne sait pas — et on ne l'affirme
   *  pas (le serveur, lui, refuserait quand même). */
  const raisonPasDeSemaine = block?.base && !((block.base.s1StartDate ?? '').trim() && (block.base.s1EndDate ?? '').trim())
    ? t('training.semaineSansDatesDeBase')
    : null;
  /** ⚠️ CE QUE LE SERVEUR CALCULE NE S'OFFRE PAS SANS RÉSEAU. La semaine
   *  suivante, la génération, une copie de trame : leur contenu se fabrique
   *  côté brokkr, à partir de ce qu'il a en base — rien à garder sur le
   *  téléphone en attendant. Le reste (trame, renommages, saisies) est gardé
   *  et repart au retour. La raison se LIT, comme pour les dates de S1. */
  const enLigne = useEnLigne();
  const raisonReseau = enLigne ? null : t('training.disponibleAuRetourDuReseau');

  /* ⚠️ LE GUICHET MÈNE ICI PAR L'URL (`?week=…&session=…`). La sélection de
     programme est persistée en {macro, bloc, semaine} et le dossier ne connaît
     que la semaine : on retrouve son bloc et son macro dans la charpente, une
     fois chargée, et on sélectionne. La séance, elle, descend à la vue semaine. */
  const [params] = useSearchParams();
  const weekParam = params.get('week');
  const sessionParam = params.get('session');
  const selectionAppliquee = useRef<string | null>(null);
  useEffect(() => {
    if (!weekParam || selectionAppliquee.current === weekParam || editor.macros.length === 0) return;
    for (const m of editor.macros) {
      for (const b of m.blocks) {
        if (b.weeks.some(w => w.id === weekParam)) {
          selectionAppliquee.current = weekParam;
          editor.selection.select({ macroId: m.id ?? '', blockId: b.id ?? '', weekId: weekParam });
          return;
        }
      }
    }
  }, [weekParam, editor.macros, editor.selection]);

  useEffect(() => {
    if (!canUseCoachMode) setShowBase(false);
  }, [canUseCoachMode]);

  // Les blocs PRÉCÉDENTS, avec leur contenu : ils viennent de l'arbre entier,
  // pas de `macros` — qui ne porte plus que le bloc courant.
  const macroComplet = editor.arbreComplet.find(m => m.id === macro?.id);
  const pastBlocksForBase = blockIndex > 0 ? (macroComplet?.blocks.slice(0, blockIndex) ?? []) : [];
  const canGenerate = !(block?.weeks?.[0]?.sessions?.length);
  /** CE QUE LA SECTION MONTRE — nommé une fois, parce que DEUX endroits en
   *  dépendent : l'en-tête du programme (qui ne porte l'en-tête de semaine que
   *  si la semaine est affichée) et le groupe d'objectifs (1b, 13/09). Hors
   *  ligne, contenu en pause : ni l'un ni l'autre. */
  const brancheBase = !(editor.contenuEnPause && !showBase) && showBase && canUseCoachMode && mode === 'coach' && !!block;
  const brancheSemaine = !editor.contenuEnPause && !brancheBase && !!week;
  /** ⚠️ LES QUATRE, PAS SEULEMENT LES SÉANCES. Une semaine « sauvegardée » sans
   *  `me` ne s'ouvre pas (le gate arrête l'athlète avant) et sans l'annuaire il
   *  n'a aucun athlète sélectionné. L'indicateur porte la promesse entière. */
  const disponibleHorsLigne = useDisponibleHorsLigne([
    ['me'], CLE_MON_ATHLETE,
    ['structure', athlete?.programId], ['block-content', athlete?.programId, block?.id],
  ]);

  const storageScopeKey = `${sel.me?.uid || 'anonymous'}:${athlete?.id || 'self'}`;

  /** Les trames à dupliquer — servies par l'éditeur, qui les lit sur la
   *  CHARPENTE (`hasBase`). La règle des quatre morceaux vivait ici, en
   *  TypeScript, et obligeait cet écran à tenir l'arbre ENTIER pour l'appliquer :
   *  512 Ko pour une liste de libellés (FRE-119). */
  const availableBases = editor.basesDisponibles;

  /** Le menu ne rend qu'un INDEX dans `availableBases` — il n'a pas à connaître
   *  la façon dont une BASE se repère. On relit ici le bloc source attendu par
   *  l'éditeur, qui lui demandera sa trame au moment du geste. */
  const baseSource = (i: number) => availableBases[i].blockId;

  const sessionIndexOf = (id: string): number =>
    (week?.sessions ?? []).findIndex(s => s.id === id);

  const toggleExerciseGroup = (id: string, exerciseIndex: number) => {
    const si = sessionIndexOf(id);
    const session = week?.sessions?.[si];
    if (!session) return;
    const exercise = session.exercises[exerciseIndex];
    if (!exercise) return;

    const currentGroupId = exercise.groupId?.trim();
    // ⚠️ ÉTENDRE UN GROUPE (FRE-116). Le lien sous la DERNIÈRE ligne d'un groupe y
    // rattache la suivante : sans ce geste, aucun groupe ne pouvait dépasser deux
    // lignes — zéro en production, et un EMOM en rotation de cinq mouvements
    // impossible à écrire. Sous la PREMIÈRE ligne, le lien défait le groupe,
    // comme avant.
    const suivante = session.exercises[exerciseIndex + 1];
    const ouvreLeGroupe = session.exercises[exerciseIndex - 1]?.groupId?.trim() !== currentGroupId;
    if (currentGroupId && !ouvreLeGroupe && suivante && !suivante.groupId?.trim()) {
      editor.updateExercise(si, exerciseIndex + 1, 'groupId', currentGroupId);
      // La nature du groupe, écrite sur la ligne qui entre : le serveur la lui
      // donnerait (`add`/`patch` adoptent celle du groupe), mais le brouillon doit
      // dire tout de suite ce qu'elle est — et un EMOM efface son format.
      editor.updateExercise(si, exerciseIndex + 1, 'groupKind', natureDe(exercise));
      return;
    }
    if (currentGroupId) {
      session.exercises.forEach((ex, idx) => {
        if (ex.groupId === currentGroupId) editor.updateExercise(si, idx, 'groupId', '');
      });
      return;
    }

    const prevIndex = exerciseIndex > 0 ? exerciseIndex - 1 : -1;
    const nextIndex = exerciseIndex < session.exercises.length - 1 ? exerciseIndex + 1 : -1;
    const prev = prevIndex >= 0 ? session.exercises[prevIndex] : undefined;
    const next = nextIndex >= 0 ? session.exercises[nextIndex] : undefined;
    const pairedIndex = next && !next.groupId ? nextIndex : prev && !prev.groupId ? prevIndex : -1;
    if (pairedIndex < 0) return;
    const groupId = `biset-${id}-${Math.min(exerciseIndex, pairedIndex)}-${Math.max(exerciseIndex, pairedIndex)}`;
    editor.updateExercise(si, exerciseIndex, 'groupId', groupId);
    editor.updateExercise(si, pairedIndex, 'groupId', groupId);
    // ⚠️ LA NATURE SE POSE AU LIAGE, EXPLICITEMENT (FRE-36). Le serveur ferait
    // bien retomber un groupe sans nature sur « bi-set » à la lecture, mais la
    // colonne resterait NULL : deux groupes identiques à l'écran seraient
    // différents en base, et le jour où le défaut change, l'un bascule et pas
    // l'autre. Ce qu'on crée aujourd'hui dit ce qu'il est.
    editor.updateExercise(si, exerciseIndex, 'groupKind', 'biset');
  };

  /** Choisit la nature d'un groupe (FRE-36, FRE-116).
   *
   *  ⚠️ UN CHOIX SUR UN GROUPE EXISTANT PLUTÔT QUE DES BOUTONS DE CRÉATION. Le geste de liaison est
   *  déjà là et il est bon ; le doubler obligerait à choisir la nature AVANT de
   *  savoir ce qu'on écrit. Ici le choix reste réversible — un coach qui se
   *  trompe reclique, il ne délie pas pour relier autrement.
   *
   *  ⚠️ ON N'ÉCRIT QU'UNE LIGNE, et le groupe entier suit — des DEUX côtés :
   *  `CHAMPS_DE_GROUPE` propage localement (comme pour les séries et le repos),
   *  `_propager_la_nature` propage en base. Boucler ici sur les membres
   *  écrirait une troisième fois une règle déjà tenue deux fois. */
  const choisirNatureDuGroupe = (id: string, exerciseIndex: number, nature: NatureDeGroupe) => {
    const si = sessionIndexOf(id);
    const session = week?.sessions?.[si];
    const exercise = session?.exercises[exerciseIndex];
    const gid = exercise?.groupId?.trim();
    if (!session || !exercise || !gid) return;
    editor.updateExercise(si, exerciseIndex, 'groupKind', nature);
  };

  if (!athlete || !sel.canView) {
    return (
      <div className="mx-auto max-w-6xl rounded-lg border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
        {athlete ? t("training.programmePrive") : t("training.aucunAthleteSelectionne")}
      </div>
    );
  }

  if (editor.loading) {
    return (
      <div className="mx-auto flex w-full max-w-7xl items-center justify-center rounded-xl border border-border/80 bg-card/80 p-10 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-gold" />
        {t("training.chargementDuProgramme")}
      </div>
    );
  }

  if (editor.macros.length === 0) {
    return (
      <div className="mx-auto max-w-6xl rounded-lg border border-dashed border-border bg-card/50 p-8 text-center">
        <p className="mb-4 text-sm text-muted-foreground">{t('training.aucunProgramme')}</p>
        {canUseCoachMode && (
          <Button size="sm" className="bg-gold text-gold-foreground hover:bg-gold/90" onClick={() => void editor.addMacro()}>
            <Plus className="h-3.5 w-3.5" /> {t("training.creerUnMacrocycle")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px]">
      {/* ⚠️ CE BANDEAU N'EST PLUS RÉSERVÉ AU COACH. La vignette doit s'afficher
          pour tout le monde : un athlète écrit aussi — RPE ressenti, série
          réalisée — et par la même file. Le bascule athlète/coach, lui, reste
          conditionné. */}
      <div className="mb-4 flex min-h-7 items-center gap-3">
        <VignetteEnregistrement etat={editor.etatEnregistrement} horsLigne={disponibleHorsLigne} />
        {canUseCoachMode && (
          <div className="ml-auto flex rounded-md border border-border/80 bg-card/80 p-0.5 shadow-[0_10px_28px_rgba(0,0,0,0.20)]">
            <Button
              size="sm"
              variant="ghost"
              className={cn('h-7 px-3 text-xs', mode === 'athlete' ? 'bg-gold text-gold-foreground shadow hover:bg-gold/90' : 'text-muted-foreground hover:text-foreground')}
              onClick={() => setMode('athlete')}
            >
              {t('role.athlete')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={cn('h-7 px-3 text-xs', mode === 'coach' ? 'bg-gold text-gold-foreground shadow hover:bg-gold/90' : 'text-muted-foreground hover:text-foreground')}
              onClick={() => setMode('coach')}
            >
              {t('role.coach')}
            </Button>
          </div>
        )}
      </div>

      {/* ⚠️ LA NAVIGATION EST L'EN-TÊTE DE LA SEMAINE (1b, 13/09). Le haut de
          l'écran empilait quatre bandeaux dans 190 px : objectifs techniques,
          barre du programme, objectifs du bloc, puis l'en-tête de semaine — le
          sujet de la page, arrivé quatrième. Macro, bloc, semaine et en-tête
          sont maintenant UNE carte, fermée par le filet doré ; les deux
          objectifs se regroupent dessous. Deux objets au lieu de quatre.

          Historique qu'on garde : la navigation a été un RAIL de 275 px, puis
          une barre au-dessus de la semaine — c'est la place rendue à la séance,
          qui a treize colonnes, qui a décidé des deux passages. */}
      <div className="flex w-full flex-col gap-5">
        <EnteteDuProgramme
          macros={editor.macros}
          selectedMacroId={macro?.id ?? ''}
          selectedBlockId={block?.id ?? ''}
          selectedWeekId={week?.id ?? ''}
          week={brancheSemaine ? week : undefined}
          onSelect={(macroId, blockId, weekId) => editor.selection.select({ macroId, blockId, weekId })}
          coachMode={mode === 'coach'}
          onToggleHidden={(macroId, blockId, weekId) => editor.toggleWeekHidden(macroId, blockId, weekId)}
          // ⚠️ PAS SUR LA SEMAINE 1 : sa durée EST la référence, posée dans la
          // BASE (et déplacée par le stepper du cycle). Le geste y serait sans
          // effet — la cascade lui réapplique la référence — et le front ne
          // propose pas une écriture qui ne tient pas. Par l'INDEX, pas par
          // `weekNumber` : c'est l'index que l'éditeur écrit.
          onChangerLaFinDeSemaine={editor.selection.weekIndex > 0
            ? fin => void editor.decalerLaFinDeSemaine(editor.selection.weekIndex, fin)
            : undefined}
        />

          {/* ⚠️ « ÉDITER LA BASE » N'EST PAS UN OUTIL DE GESTION, et l'avoir
              rangé sous le pli a fait rougir treize specs — à raison. C'est une
              BASCULE DE VUE, comme Aperçu/Détail : on regarde le bloc courant
              par sa semaine ou par sa trame. Elle reste donc toujours visible,
              contre la barre qui désigne justement ce bloc.

              Ce qui se replie, c'est le CYCLE DE VIE — créer, renommer,
              supprimer — qu'on ouvre quelques fois par mois. Fermé au départ :
              même en mode coach, ce qu'on vient chercher est la séance. */}
          {mode === 'coach' && (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowBase(v => !v)}
                  className={cn('flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium',
                    showBase ? 'border-gold bg-gold/15 text-gold' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground')}
                >
                  <Layers className="h-3.5 w-3.5" /> {showBase ? t("training.voirLaSemaine") : t('misc.editBlockBase')}
                </button>
                <button
                  type="button"
                  onClick={() => setOutilsOuverts(v => !v)}
                  aria-expanded={outilsOuverts}
                  className="flex items-center gap-2 font-display text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', outilsOuverts && 'rotate-180')} />
                  {t('training.gerer')}
                </button>
              </div>

              {/* ⚠️ LES AJOUTS RESTENT VISIBLES, et dix specs du harnais réel
                  l'ont établi d'un coup en ne trouvant plus « + Semaine ».
                  Ajouter une semaine est un geste HEBDOMADAIRE ; le replier
                  aurait mis un clic devant le rythme normal du coach. Seuls
                  renommer et supprimer — quelques fois par mois — passent
                  sous « Gérer ». */}
              <div className="flex flex-wrap items-center gap-1">
                <AjouterAvecMenu
                  label={t("training.macro")}
                  sources={enLigne ? availableBases : []}
                  titreSources={t("training.dupliquerUneBase")}
                  iconeSource={Layers}
                  classeDeclencheur={CLASSE_BOUTON_PROG}
                  onChoisir={i => void editor.addMacro(
                    i === undefined ? undefined : { duplicateFrom: baseSource(i) })}
                />
                <AjouterAvecMenu
                  label={t("training.bloc")}
                  sources={enLigne ? availableBases : []}
                  titreSources={t("training.dupliquerUneBase")}
                  iconeSource={Layers}
                  classeDeclencheur={CLASSE_BOUTON_PROG}
                  onChoisir={i => void editor.addBlock(
                    i === undefined ? undefined : { duplicateFrom: baseSource(i) })}
                />
                <ProgBtn label={t("training.semaine")} onClick={() => void editor.addWeek()}
                         disabled={!!raisonPasDeSemaine || !!raisonReseau} />
                {/* ⚠️ UNE SÉANCE VIT DANS UNE SEMAINE : sur un bloc qui n'en a pas
                    encore (un bloc neuf, cf. « bloc sans semaine »), le bouton
                    envoyait `POST /weeks/undefined/sessions` et un 404 — vu le
                    16/09 sur le bloc 1 d'ELIAS. Le bouton n'agit que là où
                    brokkr accepte l'écriture. */}
                <ProgBtn label={t('training.seance')} onClick={() => editor.addSession(t('misc.newSession'))}
                         disabled={!week?.id} />
              </div>
              {/* ⚠️ LA RAISON S'AFFICHE, ELLE NE SE SURVOLE PAS — la leçon du 09/09 sur
                  « Générer » (« le bouton est grisé et rien ne dit pourquoi »). Et
                  le chemin est à côté : c'est dans la BASE que les dates se posent,
                  et les poser y redate toutes les semaines du bloc. */}
              {raisonPasDeSemaine && !showBase && (
                <p role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-gold" />
                  <span>{raisonPasDeSemaine}</span>
                  <button type="button" onClick={() => setShowBase(true)}
                          className="font-medium text-gold underline-offset-2 hover:underline">
                    {t('training.allerALaBase')}
                  </button>
                </p>
              )}
              {raisonReseau && !raisonPasDeSemaine && !showBase && (
                <p role="status" className="flex items-center gap-x-2 text-xs text-muted-foreground">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-gold" />
                  <span>{t('training.semaine')} · {raisonReseau}</span>
                </p>
              )}
              <div className={cn('flex-col gap-1.5', outilsOuverts ? 'flex' : 'hidden')}>
              <div className="mt-1 flex flex-col gap-1">
                {/* ⚠️ UNE FABRIQUE, TROIS NIVEAUX. La question est la même à
                    chaque étage — « qu'est-ce qu'il y a de FAIT là-dedans » —,
                    et le serveur répond par une seule route. L'écrire trois
                    fois aurait fait trois endroits où corriger le jour où la
                    définition de « réalisé » bouge (FRE-130). */}
                {macro && macroIndex >= 0 && (
                  <EditRow
                    label={t("training.macro")} name={macro.name} fallback={t("training.macroN", { n: macro.macroNumber })}
                    onRename={n => editor.renameMacro(macroIndex, n)}
                    onDelete={() => void editor.removeMacro(macroIndex)}
                    contenuRealise={() => contenuRealise('macro', macro.id)}
                    confirmExtra={t("training.etToutSonContenu")}
                  />
                )}
                {block && blockIndex >= 0 && (
                  <EditRow
                    label={t("training.bloc")} name={block.name} fallback={t("training.blocN", { n: block.blockNumber })}
                    onRename={n => editor.renameBlock(blockIndex, n)}
                    onDelete={() => void editor.removeBlock(blockIndex)}
                    contenuRealise={() => contenuRealise('bloc', block.id)}
                    confirmExtra={t("training.etSesSemaines")}
                  />
                )}
                {week && weekIndex >= 0 && (
                  <EditRow
                    label={t("training.semaine")} name={week.name} fallback={t("week.semaineN", { n: week.weekNumber })}
                    onRename={n => editor.renameWeek(weekIndex, n)}
                    onDelete={() => void editor.removeWeek(weekIndex)}
                    contenuRealise={() => contenuRealise('semaine', week.id)}
                  />
                )}
              </div>
              </div>
            </div>
          )}

        <section className="min-w-0">
          {/* ⚠️ LE HORS-LIGNE SE TESTE AVANT `week`, ET C'EST TOUT LE PIÈGE
              (FRE-118). La charpente, elle, est en cache : les semaines du bloc
              existent donc, une est sélectionnée, et l'écran rendait la table de
              séance — VIDE, avec « + Séance » à côté. Il n'annonçait plus « ce
              bloc n'a pas de semaine », il faisait pire : il montrait une
              semaine réelle comme si elle n'avait rien dedans.

              Vu en harnais réel, et c'est exactement pour ça qu'il existe. */}
          {/* ⚠️ LES DEUX OBJECTIFS, REGROUPÉS SOUS L'EN-TÊTE (1b, 13/09). Ils étaient
              de part et d'autre de la navigation, dessinés pareil — même
              chevron, même cible dorée, même compte —, et se lisaient comme un
              doublon alors que l'un suit le BLOC et l'autre l'ATHLÈTE. Un seul
              cadre maintenant, un filet entre les deux, et le bloc en premier :
              il concerne ce qu'on regarde.

              ⚠️ LES OBJECTIFS DU BLOC S'ÉDITENT AUSSI DEPUIS LA BASE, ET C'EST
              UNE QUESTION DE MOMENT (William, 05/09) : « les objectifs on les a
              en tête quand on fait le bloc, donc quand on regarde la BASE ».
              Même donnée, même table (`block_objectives`), un seul éditeur à
              l'écran : la base et la semaine ne sont jamais visibles ensemble.

              ⚠️ LE JOURNAL TECHNIQUE (FRE-122) SUIT L'ATHLÈTE, pas un bloc :
              `peutEcrire` regarde la BASCULE D'APERÇU, pas seulement la
              permission. En « Athlète », le coach prévisualise l'écran de son
              athlète — y laisser le formulaire ferait mentir l'aperçu. Replié
              par défaut : la pastille sur la ligne est le chemin courant, ceci
              est celui de la revue. */}
          <div className="mb-4 overflow-hidden rounded-lg border border-border/70 bg-card/55 [&>*+*]:border-t [&>*+*]:border-border/60">
            {(brancheBase || brancheSemaine) && block && (mode === 'coach' ? (
              <BlockObjectivesEditor
                objectives={block.objectives ?? []}
                blockLabel={block.name || t("training.blocN", { n: block.blockNumber })}
                exerciseOptions={[...new Set([...coachLib.principaux, ...coachLib.renforcement])]}
                variantOptions={coachLib.variantes}
                assistanceOptions={coachLib.assistances}
                onAdd={() => editor.addObjective()}
                onUpdate={(i, field, value) => editor.updateObjective(i, field, value)}
                onRemove={i => editor.removeObjective(i)}
                onMove={(from, to) => editor.moveObjective(from, to)}
              />
            ) : (
              <BlockObjectivesList
                objectives={block.objectives ?? []}
                blockLabel={block.name || t("training.blocN", { n: block.blockNumber })}
              />
            ))}
            <ObjectifsTechniquesPanel
              athleteId={sel.selectedId}
              objectifs={objectifs}
              mouvements={[...new Set([...coachLib.principaux, ...coachLib.renforcement])]}
              peutEcrire={mode === 'coach' && sel.canManage}
            />
          </div>

          {/* ⚠️ LE HORS-LIGNE SE TESTE AVANT `week`, ET C'EST TOUT LE PIÈGE
              (FRE-118). La charpente, elle, est en cache : les semaines du bloc
              existent donc, une est sélectionnée, et l'écran rendait la table de
              séance — VIDE, avec « + Séance » à côté. Il n'annonçait plus « ce
              bloc n'a pas de semaine », il faisait pire : il montrait une
              semaine réelle comme si elle n'avait rien dedans.

              Vu en harnais réel, et c'est exactement pour ça qu'il existe. */}
          {editor.contenuEnPause && !showBase ? (
            <PanneauSansSemaine blocSansSemaine={false} horsLigne />
          ) : brancheBase && block ? (
            <>
              {/* key={block.id} : remount à chaque changement de bloc, sinon le
                  state interne `draft` reste sur l'ancien bloc. */}
              <BlockBaseEditor
                key={block.id}
                blockLabel={block.name || t("training.blocN", { n: block.blockNumber })}
                programId={athlete.programId}
                blockId={block.id}
                base={block.base}
                oneRM={athlete.currentOneRM}
                lib={coachLib}
                canGenerate={canGenerate}
                hasPendingWrites={editor.hasPendingWrites}
                pastBlocks={pastBlocksForBase}
                onChange={base => { if (blockIndex >= 0) void editor.updateBlockBase(blockIndex, base); }}
                onGenerate={() => { if (blockIndex >= 0) { void editor.generateWeekOneFromBase(blockIndex); setShowBase(false); } }}
              />
            </>
          ) : brancheSemaine && week ? (
            <>
              <WeekView
                week={week}
                sessionInitiale={sessionParam}
                mode={mode}
                allowCoachMode={canUseCoachMode}
                canEditSelectedAthlete={sel.isSelf}
                storageScopeKey={storageScopeKey}
                blockWeeks={block?.weeks}
                athleteName={`${athlete.firstName} ${athlete.lastName}`.trim()}
                /* Bloc + semaine seulement : le nom du macro est souvent long
                   (« ROAD TO 100 ») et poussait la semaine hors du bandeau. Il
                   ne situe pas la séance mieux que le bloc. */
                shareContext={[block?.name || (block ? `Bloc ${block.blockNumber}` : ""), week.name || `Semaine ${week.weekNumber}`].filter(Boolean).join(" · ")}
                /* L'image d'un exercice couvre TOUT le bloc : y afficher la
                   semaine courante mentirait sur la portée de la courbe. */
                shareBlock={block?.name || (block ? `Bloc ${block.blockNumber}` : "")}
                onFeltRPEChange={(id, ei, value) => {
                  const si = sessionIndexOf(id);
                  if (si >= 0) editor.updateExercise(si, ei, 'feltRPE', value);
                }}
                /* ⚠️ DEUX CHEMINS POUR LE MÊME CHAMP, ET LA DIFFÉRENCE EST LE
                   DÉTAIL PAR SÉRIE. Le tableau du coach (`onFeltRPEChange`)
                   n'efface rien : il n'a pas de pli, donc aucun geste par lequel
                   quelqu'un aurait dit « oublie le détail ». La carte, elle, en
                   a un — et hors du pli, noter la ligne DOIT fermer le détail,
                   sinon la ligne repart avec un tableau périmé que le badge lit
                   comme un pli à moitié rempli (10/09). */
                onFeltRPEGlobal={(id, ei, value) => {
                  const si = sessionIndexOf(id);
                  if (si >= 0) editor.updateExerciseFeltRPE(si, ei, value);
                }}
                onUpdateForm={(id, value) => {
                  const si = sessionIndexOf(id);
                  if (si >= 0) editor.updateSessionForm(si, value);
                }}
                onUpdateSetRPE={(id, ei, setIndex, value) => {
                  const si = sessionIndexOf(id);
                  if (si >= 0) editor.updateExerciseSetRPE(si, ei, setIndex, value);
                }}
                onUpdateSetValue={(id, ei, setIndex, champ, value) => {
                  const si = sessionIndexOf(id);
                  if (si >= 0) editor.updateExerciseSetValue(si, ei, setIndex, champ, value);
                }}
                onUpdateField={(id, ei, field, value) => {
                  const si = sessionIndexOf(id);
                  if (si >= 0) editor.updateExercise(si, ei, field as keyof import('@/api/types').Exercise, value);
                }}
                onSetExerciseKind={(id, ei, kind) => {
                  const si = sessionIndexOf(id);
                  if (si >= 0) editor.setExerciseKind(si, ei, kind);
                }}
                onSetSessionKind={(id, kind) => {
                  const si = sessionIndexOf(id);
                  if (si >= 0) editor.setSessionKind(si, kind);
                }}
                onAddExercise={id => {
                  const si = sessionIndexOf(id);
                  if (si >= 0) editor.addExercise(si);
                }}
                onRemoveExercise={(id, ei) => {
                  const si = sessionIndexOf(id);
                  if (si >= 0) editor.removeExercise(si, ei);
                }}
                onDuplicateExercise={async (id, ei) => {
                  const si = sessionIndexOf(id);
                  return si >= 0 ? editor.duplicateExercise(si, ei) : null;
                }}
                onRenameSession={(id, name) => {
                  const si = sessionIndexOf(id);
                  if (si >= 0) editor.renameSession(si, name);
                }}
                onDeleteSession={id => {
                  const si = sessionIndexOf(id);
                  if (si >= 0) editor.removeSession(si);
                }}
                onMoveSession={(from, to) => editor.moveSession(from, to)}
                onMoveExercise={(id, from, to) => {
                  const si = sessionIndexOf(id);
                  if (si >= 0) editor.moveExercise(si, from, to);
                }}
                onMoveExerciseToSession={(fromId, fromIdx, toId, toIdx) => {
                  const de = sessionIndexOf(fromId);
                  const vers = sessionIndexOf(toId);
                  if (de >= 0 && vers >= 0) editor.moveExerciseToSession(de, fromIdx, vers, toIdx);
                }}
                onToggleGroup={toggleExerciseGroup}
                onSetGroupKind={choisirNatureDuGroupe}
                nameOptions={[...new Set([...coachLib.principaux, ...coachLib.renforcement])]}
                objectifsParMouvement={objectifsOuverts}
                variantOptions={coachLib.variantes}
                assistanceOptions={coachLib.assistances}
                tempoOptions={coachLib.tempos}
              />
            </>
          ) : (
            <PanneauSansSemaine blocSansSemaine={!!block && block.weeks.length === 0} />
          )}
        </section>
      </div>
    </div>
  );
}

/** LE PANNEAU DE DROITE QUAND AUCUNE SEMAINE N'EST AFFICHÉE.
 *
 *  ⚠️ DEUX VIDES DIFFÉRENTS, ET UN SEUL MESSAGE JUSQU'AU 22/08. « Sélectionne
 *  une semaine » suppose qu'il y en a une. Depuis qu'un bloc neuf naît SANS
 *  semaine, le coach qui venait d'en créer un lisait une consigne impossible à
 *  suivre — la même faute que le gate d'accès qui accusait le coach faute de
 *  savoir : un écran qui AFFIRME au lieu de constater.
 *
 *  ⚠️ EXTRAIT DU JSX POUR ÊTRE TESTABLE (FRE-93), pas par goût du découpage. Ces
 *  cinq lignes vivaient au fond d'une vue de 400, derrière une dizaine de hooks :
 *  atteindre la branche demandait de monter tout l'écran. Le défaut du 22/08 a
 *  d'ailleurs été trouvé à l'œil dans le navigateur, pas par un test. La décision
 *  se réduit à un booléen nommé, et `training-panneau-vide.test.tsx` la garde. */
export function PanneauSansSemaine(
  { blocSansSemaine, horsLigne = false }: { blocSansSemaine: boolean; horsLigne?: boolean },
) {
  const { t } = useTranslation();
  // ⚠️ LE HORS-LIGNE PASSE EN PREMIER, ET L'ORDRE EST LA RÈGLE. Sans contenu
  // chargé, un bloc a l'air de n'avoir aucune semaine : on lui dirait donc de
  // « composer la BASE » alors que ses douze semaines existent, à l'autre bout
  // d'un réseau absent. Un troisième vide, et le plus trompeur des trois.
  const cle = horsLigne ? 'training.blocHorsLigne'
    : blocSansSemaine ? 'training.blocSansSemaine'
    : 'training.choisisUneSemaine';
  return (
    <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
      {t(cle)}
    </div>
  );
}

/** Partagée avec `AjouterAvecMenu` : les quatre boutons de la barre « Gérer »
 *  doivent rester indiscernables, qu'ils ouvrent un menu ou non. */
const CLASSE_BOUTON_PROG =
  'flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground';

function ProgBtn({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
            className={cn(CLASSE_BOUTON_PROG, 'disabled:cursor-not-allowed disabled:border-dashed disabled:hover:bg-transparent disabled:hover:text-muted-foreground')}>
      <Plus className="h-3 w-3" /> {label}
    </button>
  );
}

/** ⚠️ `AddWithBaseMenu` A DÉMÉNAGÉ dans `@/components/ajouter-avec-menu`. Le
 *  catalogue des modèles de bilan avait le MÊME geste offert autrement (une
 *  icône par ligne), et cette seconde forme a fait croire à un kiné que la
 *  duplication n'existait plus. Un seul composant pour les deux, désormais. */

/** Ligne d'édition d'un niveau du programme : nom + rename INLINE (fin du
 *  window.prompt natif) + suppression confirmée. */
/** ⚠️ LE NOM ET L'ÉTIQUETTE SONT DEUX CHOSES, et les confondre se voyait.
 *
 *  Ce composant ne recevait qu'une chaîne : `macro.name || `Macro 1``. Il
 *  affichait donc l'étiquette de repli — ce qui est juste — mais il PRÉ-REMPLISSAIT
 *  AUSSI le champ d'édition avec elle. Sur un objet sans nom, le crayon proposait
 *  « Macro 1 » comme texte à modifier, et en valider une variante enregistrait un
 *  vrai nom qui ressemble à une étiquette automatique. Après une renumérotation,
 *  il serait resté figé à « Macro 1 » en étant le macro 3.
 *
 *  Et vider le nom donnait l'impression que l'ancien revenait, alors que c'était
 *  l'étiquette qui reprenait sa place — c'est-à-dire exactement ce qu'il fallait.
 *
 *  Le nom réel sert donc à ÉDITER, l'étiquette à AFFICHER. Vide, le champ montre
 *  l'étiquette en filigrane : on voit ce sur quoi on retombera. */
function EditRow({ label, name, fallback, onRename, onDelete, confirmExtra, contenuRealise }: {
  label: string;
  /** Le nom RÉEL, vide tant que personne n'en a donné. */
  name: string | null;
  /** Ce qui s'affiche à défaut — « Macro 1 ». Jamais enregistré. */
  fallback: string;
  onRename: (name: string) => void;
  onDelete: () => void;
  confirmExtra?: string;
  /** CE QUE LA SUPPRESSION VA DÉTRUIRE (FRE-130), demandé au serveur au clic.
   *
   *  ⚠️ ON NE BLOQUE PAS, ON DIT. La revue proposait de refuser toute
   *  suppression portant du réalisé ; décision de William : « ça m'arrive de
   *  supprimer pour réajuster ». Ce qui manquait n'était pas une barrière mais
   *  une phrase — le dialogue disait la même chose d'une semaine vierge et
   *  d'une semaine où l'athlète a saisi douze séances.
   *
   *  ⚠️ ET LE COMPTE VIENT DU SERVEUR, PAS D'ICI. La définition de « réalisé »
   *  a été RETIRÉE du front exprès (`estRealise`, cf. `selectors.ts`) : « la
   *  règle n'existe plus qu'une fois, en SQL ». La recompter ici ressusciterait
   *  la duplication qu'on vient d'éliminer.
   *
   *  ⚠️ UNE PANNE NE DOIT PAS EMPÊCHER DE SUPPRIMER : si l'appel échoue, on
   *  affiche le dialogue sans la phrase. Un geste légitime ne se prend pas en
   *  otage par une information de confort. */
  contenuRealise?: () => Promise<{ lignes: number; seances: number } | null>;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<string | null>(null);
  const affiche = name || fallback;

  // ⚠️ `name ?? ''` : le serveur sert `null` pour un bloc jamais nommé, et
  // `setDraft(null)` est « pas d'édition » — le crayon ne faisait rien sur
  // exactement les blocs qu'on veut nommer (vu en harnais, 26/09).
  const commit = () => {
    if (draft !== null && draft.trim() !== (name ?? '')) onRename(draft.trim());
    setDraft(null);
  };

  return (
    <div className="flex items-center gap-1 rounded-md bg-muted/20 px-1.5 py-1">
      <span className="w-14 shrink-0 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      {draft !== null ? (
        <>
          <Input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={fallback}
            className="h-6 flex-1 text-[11px]"
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setDraft(null);
            }}
          />
          <button type="button" onClick={commit} className="flex h-6 w-6 items-center justify-center rounded text-success hover:bg-accent" title={t("common.valider")}>
            <Check className="h-3 w-3" />
          </button>
          <button type="button" onClick={() => setDraft(null)} className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent" title={t("common.annuler")}>
            <X className="h-3 w-3" />
          </button>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-[11px]">{affiche}</span>
          <button
            type="button"
            title={t("training.renommerLe", { quoi: label.toLowerCase() })}
            onClick={() => setDraft(name ?? '')}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            title={t("training.supprimerLe", { quoi: label.toLowerCase() })}
            onClick={async () => {
              const realise = contenuRealise ? await contenuRealise() : null;
              const phrases = [
                confirmExtra ? t('training.suppressionDe', { quoi: confirmExtra }) : null,
                realise && realise.seances > 0
                  ? t('training.dontDuRealise', { count: realise.seances })
                  : null,
              ].filter(Boolean);
              if (await confirm({
                title: t('training.supprimerNomme', { nom: affiche }),
                description: phrases.length > 0 ? phrases.join(' ') : undefined,
              })) onDelete();
            }}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </>
      )}
    </div>
  );
}
