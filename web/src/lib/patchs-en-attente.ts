import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { api } from '@/api/client';
import { clesDeLArbre, clesDeriveesDuRealise, invalider } from '@/api/cles';
import type { ObjectifsRemplaces, ObjectivesReplace } from '@/api/types';
import { FILE_CHANGEE, envoyer, garderPourPlusTard, lireLaFile, oublier, rejouerLaFile, type CiblePatch, type Geste } from '@/lib/file-hors-ligne';
import { isFirebaseConfigured } from '@/firebase';
import { jamaisParvenueAuServeur, toastSaveError } from '@/lib/save-error';

/** CE QUI EST EN VOL — la file d'attente des écritures (FRE-45).
 *
 *  Ce module répond à UNE question, et c'est ce qui justifie qu'il existe :
 *  **reste-t-il une écriture non acquittée ?** Tout le reste en découle — le
 *  debounce, les réessais, l'adoption d'identité, l'oubli des patchs devenus
 *  sans objet.
 *
 *  ⚠️ POURQUOI CETTE QUESTION MÉRITE UN SEUL ENDROIT. Elle a CINQ sources :
 *  les patchs en file, les appels partis mais pas acquittés, les objectifs
 *  débouncés, et les écritures de BASE. La quatrième manquait — `updateBlockBase`
 *  fait un `await api.put` direct, donc `hasPendingWrites()` rendait FAUX
 *  pendant toute une écriture de trame, et le garde-fou du resync (FRE-66) était
 *  décoratif pour exactement les écritures qu'il doit protéger. Révélé par une
 *  mutation : retirer la garde ne faisait rougir aucune spec.
 *
 *  Une source oubliée = une frappe écrasée par un instantané périmé. Les tenir
 *  ensemble rend l'oubli visible ; éparpillées dans un hook de mille lignes,
 *  elles ne l'étaient pas.
 *
 *  ⚠️ CE MODULE NE CONNAÎT PAS L'ARBRE, délibérément. Il ne voit ni `macros`, ni
 *  la sélection, ni le contenu d'une semaine — seulement des cibles, des
 *  identifiants et des patchs. C'est ce qui le rend testable sans monter
 *  d'écran, et ce qui empêche la persistance de se mêler à nouveau aux règles
 *  métier qu'elle transporte.
 */

const isMock = !isFirebaseConfigured;
const WEEK_SAVE_DEBOUNCE_MS = 400;
const WEEK_SAVE_RETRY_DELAYS = [1000, 3000, 8000];

/** Le calme après lequel on marque périmées les lectures dérivées. Plus long que
 *  le debounce de frappe (400 ms) : c'est une rafale entière qu'on attend, pas
 *  une valeur. Il ne retarde rien à l'écran — l'arbre est déjà à jour en local,
 *  et TanStack ne recharge que ce qui est monté. */
const DELAI_DERIVEES = 2000;
/** Période de la sonde qui fait retomber la vignette. Voir `publier`. */
const SONDE_MS = 150;
/** Au-delà, `envoyerMaintenant` rend la main quoi qu'il arrive : les trois
 *  réessais cumulés font 12 s, et un geste ne doit jamais geler plus longtemps. */
const ATTENTE_ACQUITTEMENT_MS = 15_000;

/** Ce que l'écran a le droit de dire de la persistance (FRE-32).
 *
 *  ⚠️ `repos` N'EST PAS `enregistre`, ET C'EST TOUT L'INTÉRÊT DU TRIPLET. Au
 *  chargement, rien n'a été écrit : annoncer « Enregistré » serait une affirmation
 *  sur une écriture qui n'a jamais eu lieu. L'état de repos n'affiche rien. */
/** ⚠️ `en-attente` EST LE QUATRIÈME, ET IL NE DIT PAS « ÇA CHARGE » (FRE-118).
 *
 *  Hors ligne, une frappe n'est ni en cours d'envoi ni enregistrée : elle est
 *  GARDÉE. Le sablier mentirait — il annonce un envoi qui n'a pas lieu — et
 *  « Enregistré » mentirait bien pire. C'est le même raisonnement qui a fait
 *  exister `repos` : un état qu'on n'a pas nommé finit affiché comme un autre. */
/** ⚠️ `echec` EST LE CINQUIÈME, ET IL MANQUAIT. Une trame refusée, ou partie
 *  dans le vide, laissait la sonde retomber sur « Enregistré » : elle ne compte
 *  que ce qui est EN VOL, pas ce qui a échoué. Aubin l'a lu le 25/09, a fermé
 *  l'écran, et a tout retapé le lendemain. Le toast avait bien eu lieu — mais
 *  un toast passe, la vignette reste : c'est elle qu'on relit avant de fermer. */
export type EtatEnregistrement = 'repos' | 'en-cours' | 'enregistre' | 'en-attente' | 'echec';

/** Pourquoi un patch n'a pas d'échéance. Les deux cas existaient déjà — l'un
 *  implicitement — et les confondre coûterait cher :
 *
 *  * `identite` : la ligne est neuve, son `POST` est en vol. `adopterIdentite`
 *    la libère ;
 *  * `reseau` : elle a une identité, elle est simplement partie dans le vide.
 *    C'est le retour du réseau qui la libère, et elle doit SURVIVRE à la
 *    fermeture de l'app.
 *
 *  ⚠️ SEULE LA SECONDE SE PERSISTE. Un identifiant provisoire ne désigne rien
 *  après un rechargement : le `POST` qui devait lui donner une identité est
 *  parti avec la page. La garder produirait un `PATCH /exercises/neuve:1` au
 *  réveil — un 404 et un toast pour une ligne qui n'a jamais existé. */
type SansEcheance = 'identite' | 'reseau';

/** ⚠️ UNE IDENTITÉ DÈS LA PREMIÈRE MILLISECONDE (FRE-86, défaut 1), ET C'EST
 *  LA VRAIE (25/09).
 *
 *  Une ligne qu'on vient d'ajouter n'avait pas d'id tant que le `POST` volait,
 *  et tout ce qui se tapait pendant ce vol disparaissait — sans message, sans
 *  trace. Or c'est exactement le moment où l'on tape : on ajoute une ligne POUR
 *  la remplir. Elle a d'abord reçu une identité PROVISOIRE (`neuve:1`), à ne
 *  jamais envoyer ; elle reçoit désormais l'identité que brokkr gardera — un
 *  uuid choisi ici — et c'est ce qui rend la création rejouable sans doublon
 *  (`file-hors-ligne`, `CreationEnAttente`).
 *
 *  ⚠️ MAIS UN `PATCH` SUR CETTE IDENTITÉ RENDRAIT 404 TANT QUE LE `POST` N'A
 *  PAS RÉPONDU. La frappe ATTEND (`attente: 'identite'`), et c'est le sort de
 *  la création qui la libère : acquittée, elle part ; gardée sur le disque,
 *  elle la suit, à sa place ; refusée, elle tombe avec l'objet fantôme.
 *
 *  Au niveau du module : une identité est unique dans tout le produit. */
const enCreation = new Set<string>();

export function estEnCreation(id: string | undefined | null): boolean {
  return !!id && enCreation.has(id);
}

/** L'identité d'un objet qu'on crée. `randomUUID` manque aux contextes non
 *  sécurisés ; le repli produit la même forme, moins bien tirée. */
export function nouvelleIdentite(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export type Cible = CiblePatch;

export function usePatchsEnAttente(programId: string | null | undefined) {
  /* La mécanique, telle qu'elle vivait dans le hook —
   *
   *  Avant FRE-12, une frappe déclenchait la réécriture de la SEMAINE ENTIÈRE :
   *  un seul endpoint, un seul debounce, et un payload qui portait toutes les
   *  séances. D'où le défaut qu'on corrige : une valeur refusée faisait tomber
   *  la semaine complète — trois semaines et 73 exercices bloqués le 11 août.
   *
   *  Désormais on écrit l'OBJET touché. Le debounce, le retry et le garde-fou
   *  anti-écrasement au resync sont conservés tels quels : ce sont eux qui
   *  protègent les frappes d'un coach quand le réseau flanche. Seule la clé
   *  change — l'objet plutôt que la semaine — et les patchs d'une même cible se
   *  FUSIONNENT, si bien qu'une rafale sur deux colonnes part en un seul appel. */

  // `timer: null` = en attente d'une IDENTITÉ, pas d'une échéance. Le patch est
  // bien en file (donc `hasPendingWrites` dit vrai, donc aucun resync ne vient
  // l'écraser), mais rien ne le fera partir avant que le `POST` ait répondu.
  const pendingPatches = useRef<Map<string, {
    timer: ReturnType<typeof setTimeout> | null; cible: Cible; id: string;
    patch: Record<string, unknown>; attente?: SansEcheance;
  }>>(new Map());
  const pendingObjectiveSaves = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  /** Écritures PARTIES mais pas encore acquittées, par cible. La valeur est le
   *  numéro d'ordre de l'appel en vol : c'est lui qui dit si un réessai est
   *  encore d'actualité ou s'il a été doublé par une frappe plus récente. */
  const enVol = useRef<Map<string, number>>(new Map());
  const numeroDAppel = useRef(0);

  /** ⚠️ CETTE FILE N'AVERTISSAIT PERSONNE (FRE-144). Elle écrit au serveur et
   *  ne touchait aucune clé TanStack : ni `useQueryClient`, ni
   *  `invalidateQueries`, nulle part dans ce fichier.
   *
   *  L'arbre restait juste quand même — l'éditeur mute son état local — donc le
   *  trou ne se voyait pas depuis l'écran de saisie. Ce qui restait périmé, ce
   *  sont les lectures DÉRIVÉES que brokkr recalcule des mêmes lignes et qui
   *  vivent AILLEURS : les records et la forme du jour, sur le tableau de bord.
   *
   *  ⚠️ COALESCÉ, ET C'EST NÉCESSAIRE. Une séance saisie, ce sont des dizaines
   *  de patchs acquittés ; invalider à chaque acquittement ferait autant de
   *  rechargements dès que le tableau de bord est monté. On marque périmé une
   *  fois, après le calme. */
  const qc = useQueryClient();
  const echeanceDerivees = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** La CHARPENTE aussi, quand c'est elle qui a bougé : renommer un macro ou
   *  masquer une semaine se lit sur le calendrier et le tableau de bord sous
   *  `['structure']`, cinq minutes de `staleTime`. L'éditeur, lui, mute son
   *  arbre — le défaut était invisible depuis l'écran qui le provoque (FRE-144). */
  const charpenteAussi = useRef(false);
  const perimerLesDerivees = useCallback((charpente = false) => {
    charpenteAussi.current ||= charpente;
    if (echeanceDerivees.current) clearTimeout(echeanceDerivees.current);
    echeanceDerivees.current = setTimeout(() => {
      echeanceDerivees.current = null;
      invalider(qc, clesDeriveesDuRealise());
      if (charpenteAussi.current) invalider(qc, clesDeLArbre(programId));
      charpenteAussi.current = false;
    }, DELAI_DERIVEES);
  }, [programId, qc]);
  useEffect(() => () => {
    if (echeanceDerivees.current) clearTimeout(echeanceDerivees.current);
  }, []);

  // ⚠️ `enVol` COMPTE. La file d'attente se vide AVANT l'appel HTTP : sans cette
  // seconde source, une resynchronisation tombant pendant le vol trouvait le
  // front « au repos » et repeignait l'écran avec l'état d'avant la frappe. La
  // base, elle, était juste — c'est l'écran qui mentait jusqu'au refetch suivant.
  // ⚠️ LES ÉCRITURES DE BASE COMPTENT AUSSI, et elles manquaient. `updateBlockBase`
  // fait un `await api.put` direct : il ne passe ni par `pendingPatches` ni par
  // `enVol`, donc `hasPendingWrites()` rendait FAUX pendant tout le temps d'une
  // écriture de trame. Le garde-fou du resync (FRE-66) était par conséquent
  // décoratif pour exactement les écritures qu'il doit protéger — révélé par une
  // mutation : retirer la garde ne faisait rougir aucune spec.
  // ⚠️ ET LES APPELS STRUCTURELS AUSSI (FRE-120). Un `POST` de création est une
  // écriture non acquittée comme une autre — mais il ne passe ni par la file ni
  // par `enVol`, qui ne connaissent que les patchs. Pendant qu'il volait,
  // `hasPendingWrites()` rendait donc FAUX, et n'importe quel resync tombant là
  // (un retour de focus suffit) remplaçait l'arbre local par celui du serveur —
  // qui ne connaît pas encore la ligne. La ligne disparaissait sous les doigts,
  // et la frappe en cours avec elle.
  //
  // Révélé par une spec de FRE-86 : le correctif d'affichage hors ligne ajoutait
  // une occasion de resync de plus, et elle est tombée pile là. Le défaut, lui,
  // était déjà atteignable.
  const directesEnVol = useRef(0);
  // ⚠️ `useCallback` AVEC DES DÉPENDANCES VIDES, et ce n'est pas décoratif : cette
  // fonction ne lit que des `ref`, donc son identité peut rester stable — et elle
  // DOIT l'être, puisqu'elle figure dans les dépendances d'un effet du hook
  // appelant. Une identité qui change à chaque rendu y relancerait l'effet en
  // boucle.
  const hasPendingWrites = useCallback(() =>
    pendingPatches.current.size > 0 || enVol.current.size > 0
    || pendingObjectiveSaves.current.size > 0 || directesEnVol.current > 0, []);

  /* ----- CE QUE L'ÉCRAN EN VOIT (FRE-32) -----
   *
   *  ⚠️ `hasPendingWrites` NE PROVOQUE AUCUN RENDU, et c'est délibéré : elle ne
   *  lit que des `ref`, et son identité doit rester stable puisqu'elle figure
   *  dans les dépendances d'un effet du hook appelant. Une vignette branchée
   *  dessus ne bougerait donc jamais. Il faut publier l'état à côté.
   *
   *  ⚠️ ON PUBLIE AU DÉPART, ET UNE SONDE FAIT RETOMBER. C'est ce qui décide si
   *  l'indicateur reste juste dans six mois. Il y a QUATRE sources et une bonne
   *  douzaine d'endroits où l'une d'elles se vide — une fin d'appel, un abandon
   *  après trois réessais, un patch oublié parce que sa ligne est supprimée, un
   *  `finally` d'écriture de BASE. Publier à chacun, c'est se donner douze
   *  occasions d'en oublier un, et un oubli laisserait la vignette sur
   *  « Enregistrement… » pour toujours — un mensonge pire que pas de vignette.
   *
   *  Les DÉPARTS, eux, sont quatre et passent tous par une fonction. On publie
   *  là, et la sonde — qui ne tourne QUE pendant une écriture, et s'arrête
   *  d'elle-même — relit la seule source de vérité pour retomber. Les 150 ms de
   *  retard sont invisibles à côté des 400 ms de debounce. */
  const [etatEnregistrement, setEtatEnregistrement] = useState<EtatEnregistrement>('repos');
  const sonde = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Un refus depuis le dernier départ : la sonde retombera sur « échec ». */
  const echec = useRef(false);
  const signalerEchec = useCallback(() => { echec.current = true; }, []);
  const saveFailed = useCallback((e: unknown) => { signalerEchec(); toastSaveError(e); }, [signalerEchec]);

  /** Ce que le DISQUE porte — les gestes qui attendent le réseau, tous genres
   *  confondus. La trame, une suppression, un renommage n'entrent pas dans
   *  `pendingPatches` : sans ce compte, une trame gardée hors ligne laissait la
   *  sonde retomber sur « Enregistré ». */
  const surLeDisque = useRef(0);

/** Ne reste-t-il QUE des gestes qui attendent le réseau ? */
  const toutAttendLeReseau = useCallback(() => {
    const pending = pendingPatches.current;
    const enMemoire = [...pending.values()];
    return enMemoire.every(e => e.attente === 'reseau')
      && (enMemoire.length > 0 || surLeDisque.current > 0)
      && enVol.current.size === 0
      && pendingObjectiveSaves.current.size === 0
      && directesEnVol.current === 0;
  }, []);

  const publier = useCallback(() => {
    echec.current = false;
    setEtatEnregistrement('en-cours');
    if (sonde.current) return;
    sonde.current = setInterval(() => {
      // ⚠️ TROIS SORTIES, PAS DEUX (FRE-118). Hors ligne, `hasPendingWrites`
      // reste vrai indéfiniment — c'est voulu, il protège la frappe — et la
      // sonde ne retombait donc jamais : la vignette affichait « Enregistrement… »
      // pour toujours, ce qui est le mensonge le plus proche de la vérité et
      // donc le plus trompeur. On nomme l'état au lieu de le laisser tourner.
      if (toutAttendLeReseau()) {
        if (sonde.current) clearInterval(sonde.current);
        sonde.current = null;
        setEtatEnregistrement('en-attente');
        return;
      }
      if (hasPendingWrites()) return;
      if (sonde.current) clearInterval(sonde.current);
      sonde.current = null;
      setEtatEnregistrement(echec.current ? 'echec' : 'enregistre');
    }, SONDE_MS);
  }, [hasPendingWrites, toutAttendLeReseau]);

  useEffect(() => () => { if (sonde.current) clearInterval(sonde.current); }, []);

  /** Le disque, suivi : il se vide au rejeu, sans que rien ici ne l'ait demandé,
   *  et c'est ce vidage qui fait passer « Gardé » à « Enregistré ». */
  useEffect(() => {
    let vivant = true;
    const relire = () => {
      void lireLaFile().then(f => {
        if (!vivant) return;
        const avant = surLeDisque.current;
        surLeDisque.current = f.length;
        if (avant > 0 && f.length === 0) publier();
      });
    };
    relire();
    window.addEventListener(FILE_CHANGEE, relire);
    return () => { vivant = false; window.removeEventListener(FILE_CHANGEE, relire); };
  }, [publier]);

  /* ----- LA FILE SURVIT À LA FERMETURE DE L'APP (FRE-118) ------------------
   *
   *  ⚠️ LE DISQUE EST TENU AILLEURS, ET C'EST LE POINT. `lib/file-hors-ligne`
   *  ne dépend d'aucun écran : c'est lui qui rejoue au démarrage de l'app, parce
   *  qu'un athlète qui rouvre son téléphone tombe sur le tableau de bord, pas
   *  sur l'éditeur. Ici on ne fait que DÉPOSER et RETIRER.
   *
   *  ⚠️ ET ON NE DÉPOSE QUE CE QUI A UNE IDENTITÉ SERVEUR. Un id provisoire ne
   *  désigne plus rien après un rechargement : le `POST` censé la lui donner est
   *  parti avec la page. Le rejouer produirait un `PATCH /exercises/neuve:1` —
   *  un 404 et un toast pour une ligne qui n'a jamais existé. */
  const deposer = useCallback((entry: {
    cible: Cible; id: string; patch: Record<string, unknown>;
  }) => {
    if (isMock || !programId || estEnCreation(entry.id)) return;
    // Compté tout de suite : la sonde ne doit pas trouver le disque vide entre
    // le départ de l'écriture et sa fin.
    surLeDisque.current += 1;
    // Champ par champ : l'entrée en mémoire porte aussi son `timer` et sa raison
    // d'attente, qui n'ont aucun sens une fois la page fermée — et qu'un
    // `...entry` aurait sérialisés sans que rien ne proteste.
    void garderPourPlusTard({
      genre: 'patch', programId, cible: entry.cible, id: entry.id, patch: entry.patch,
    });
  }, [programId]);

  /** Remet un patch en file, EN ATTENTE DE RÉSEAU — sans échéance ni réessai.
   *
   *  ⚠️ IL RESTE DANS `pendingPatches`, DONC `hasPendingWrites` DIT VRAI. Ce
   *  n'est pas un effet de bord, c'est la protection : tant que la frappe n'est
   *  pas écrite, aucun instantané serveur ne doit repeindre l'écran par-dessus. */
  const remettreEnFile = useCallback((key: string, entry: {
    cible: Cible; id: string; patch: Record<string, unknown>;
  }) => {
    const pending = pendingPatches.current;
    const existant = pending.get(key);
    if (existant?.timer) clearTimeout(existant.timer);
    // Une frappe PLUS RÉCENTE a la priorité : on fusionne dessous, jamais dessus.
    pending.set(key, {
      timer: null, attente: 'reseau', cible: entry.cible, id: entry.id,
      patch: { ...entry.patch, ...(existant?.patch ?? {}) },
    });
    deposer(entry);
    publier();
  }, [deposer, publier]);

  const persistPatch = useCallback((
    key: string,
    entry: { cible: Cible; id: string; patch: Record<string, unknown> },
    numero = ++numeroDAppel.current,
    attempt = 0,
  ) => {
    if (isMock || !programId) return;
    // Filet : `schedulePatch` ne programme rien pour un objet dont la création
    // vole encore, mais un appelant direct (flush au démontage, réessai)
    // pourrait encore l'y amener. Un `PATCH` sur lui rendrait 404 : la frappe
    // REPREND SA PLACE en attente, elle n'est pas jetée.
    if (estEnCreation(entry.id)) {
      pendingPatches.current.set(key, { ...entry, timer: null, attente: 'identite' });
      return;
    }
    const vol = enVol.current;
    vol.set(key, numero);
    // ⚠️ PAS DE `publier()` ICI, ET C'EST MESURÉ. Tout chemin qui arrive jusque
    // là est passé par `schedulePatch`, qui a déjà publié ; et le passage de la
    // file au vol se fait en un seul tour synchrone, donc la sonde ne peut pas
    // s'intercaler pour annoncer « Enregistré » entre les deux. Un `publier()`
    // de plus n'a fait rougir aucune spec — c'était du garde-fou décoratif.
    // `perime` : une écriture PLUS RÉCENTE sur la même cible est partie depuis.
    // Le debounce est de 400 ms et le premier réessai à 1 s, donc le cas est
    // ordinaire — et sans ce test, le réessai d'un vieux patch écrasait la
    // valeur fraîche qui, elle, était déjà passée.
    const perime = () => vol.get(key) !== numero;
    // ⚠️ CORPS NON TYPÉ, ET C'EST UNE DIVERGENCE ASSUMÉE (FRE-144). Les trois
    // cibles ont chacune leur modèle (`ExerciseLinePatch`, `SessionPatch`,
    // `WeekPatch`), mais ce qui arrive ici est un sac de clés : `updateExercise`
    // le construit par CLÉ CALCULÉE (`{ [field]: value }`), forme dont
    // TypeScript ne vérifie rien — ni le nom du champ, ni le type de la valeur,
    // même quand la cible est nommée. Poser l'union ne validerait donc rien de
    // plus et obligerait à forcer le passage. Ce que le contrat refuserait et
    // qui passerait ici : `repsUnit: ''`, `incrementUnit: ''`, `groupKind: ''`
    // (l'écriture veut `null`), ou un `tier` hors de 1|2|3.
    api.patch<unknown, Record<string, unknown>>(`/programs/${programId}/${entry.cible}/${entry.id}`, entry.patch)
      .then(() => {
        if (!perime()) vol.delete(key);
        void oublier([entry.id]);
        perimerLesDerivees(entry.cible === 'macros' || entry.cible === 'blocks' || entry.cible === 'weeks');
      })
      .catch(e => {
        if (perime()) return;
        // ⚠️ UNE ÉCRITURE QUI N'EST JAMAIS PARTIE N'EST PAS UNE ÉCRITURE REFUSÉE
        // (FRE-118), et c'est toute la différence entre garder la séance d'un
        // athlète et la perdre. Les trois réessais couvraient un réseau qui
        // vacille — douze secondes. Une salle en sous-sol, ce sont des heures :
        // la file abandonnait, affichait un toast, et l'écran continuait de
        // montrer la valeur tapée comme si elle était en base.
        //
        // Sans échéance et sans réessai : c'est le RETOUR DU RÉSEAU qui la
        // libère, et elle survit à la fermeture de l'app.
        if (jamaisParvenueAuServeur(e)) {
          vol.delete(key);
          remettreEnFile(key, entry);
          return;
        }
        if (attempt >= WEEK_SAVE_RETRY_DELAYS.length) {
          // Abandon : libérer la cible, sinon `hasPendingWrites` resterait vrai
          // pour toujours et la resynchronisation ne repasserait jamais.
          vol.delete(key);
          saveFailed(e);
          return;
        }
        setTimeout(() => {
          // Édition plus récente en file OU déjà repartie → elle écrira un état
          // plus frais que celui qu'on tient.
          if (pendingPatches.current.has(key) || perime()) { vol.delete(key); return; }
          persistPatch(key, entry, numero, attempt + 1);
        }, WEEK_SAVE_RETRY_DELAYS[attempt]);
      });
  }, [programId, remettreEnFile, perimerLesDerivees, saveFailed]);

  /** Programme l'écriture d'un objet. Un second appel sur la MÊME cible fusionne
   *  son patch et repousse l'échéance : taper la charge puis les reps produit un
   *  seul appel portant les deux. */
  const schedulePatch = useCallback((cible: Cible, id: string | undefined, patch: Record<string, unknown>) => {
    if (isMock || !programId || !id) return;
    const key = `${cible}/${id}`;
    const pending = pendingPatches.current;
    const existing = pending.get(key);
    if (existing?.timer) clearTimeout(existing.timer);
    const fusion = { ...(existing?.patch ?? {}), ...patch };
    // Un objet dont la création vole encore ? C'est `persistPatch` qui le
    // sait, à l'échéance — une seule règle, à un seul endroit : la frappe y
    // reprend sa place en attente, et le sort de la création la libère.
    const timer = setTimeout(() => {
      const entry = pending.get(key);
      if (!entry) return;
      pending.delete(key);
      persistPatch(key, entry);
    }, WEEK_SAVE_DEBOUNCE_MS);
    pending.set(key, { timer, cible, id, patch: fusion });
    publier();
  }, [persistPatch, programId, publier]);


  /** Le réseau revient : tout ce qui l'attendait repart, dans l'ordre d'arrivée.
   *
   *  ⚠️ `online` NE SUFFIT PAS SEUL et on ne s'y fie pas aveuglément — le
   *  navigateur l'émet dès qu'une interface réseau existe, pas quand brokkr
   *  répond. Un envoi qui échoue à nouveau retombe simplement en file : c'est
   *  la même mécanique, et elle est idempotente. */
  useEffect(() => {
    const reprendre = () => {
      // ⚠️ C'EST LE DISQUE QUI REPART, PAS LA MÉMOIRE. La file porte des gestes
      // qui n'existent qu'ici — une trame, une suppression — et leur ORDRE
      // compte. Renvoyer les patchs d'ici en parallèle les ferait doubler, et
      // parfois précéder ce dont ils dépendent. Ce qui attendait en mémoire
      // n'y reste que le temps du rejeu, pour fusionner une frappe qui
      // arriverait entre-temps.
      void rejouerLaFile().then(async () => {
        const encore = new Set((await lireLaFile()).filter(e => e.genre === 'patch').map(e => `${e.cible}/${e.id}`));
        const pending = pendingPatches.current;
        for (const [key, entry] of [...pending]) {
          if (entry.attente === 'reseau' && !encore.has(key)) pending.delete(key);
        }
      }).finally(() => {
        // ⚠️ REPUBLIER, SINON LA VIGNETTE RESTE SUR « Gardé ». La sonde s'est
        // ARRÊTÉE en annonçant l'attente — c'est elle qui doit repartir pour
        // constater que la file s'est vidée. Sans ça, la frappe arrive bien en
        // base et l'écran continue d'annoncer qu'elle attend : le contraire du
        // rôle de cette vignette, qui existe pour dire quand on peut fermer.
        publier();
      });
    };
    window.addEventListener('online', reprendre);
    return () => window.removeEventListener('online', reprendre);
  }, [publier]);

  /** La création est RÉGLÉE : les frappes qui l'attendaient suivent son sort.
   *
   *  ⚠️ ACQUITTÉE, ON REPOSTE, ON NE RE-PROGRAMME PAS. Ces frappes attendent
   *  déjà depuis l'aller-retour du `POST` — leur réappliquer 400 ms de debounce
   *  ne regrouperait rien et ne ferait qu'allonger la fenêtre pendant laquelle
   *  un onglet fermé les emporte. GARDÉE sur le disque, elles y vont aussi,
   *  après elle. REFUSÉE, l'objet n'existe pas : elles tombent avec lui. */
  const libererLesFrappes = useCallback((id: string, sort: 'acquittee' | 'gardee' | 'refusee') => {
    enCreation.delete(id);
    const pending = pendingPatches.current;
    for (const [key, entry] of [...pending]) {
      if (entry.id !== id) continue;
      if (entry.timer) clearTimeout(entry.timer);
      pending.delete(key);
      if (sort === 'acquittee') persistPatch(key, entry);
      else if (sort === 'gardee') remettreEnFile(key, entry);
    }
  }, [persistPatch, remettreEnFile]);

  /** Envoie SANS ATTENDRE ce qui est en file pour un objet, et rend la main quand
   *  le serveur l'a acquitté (Passe 3, constat 05).
   *
   *  ⚠️ C'EST CE QUI REND UNE COPIE SERVEUR JUSTE. Dupliquer une ligne se fait
   *  côté brokkr, depuis ce que la BASE contient — or on tape la charge, on
   *  quitte la case, on clique « dupliquer » : la frappe dort encore 400 ms dans
   *  le debounce, et la copie partait avec l'ancienne valeur.
   *
   *  Une frappe qui attend le RÉSEAU ou une IDENTITÉ n'est pas envoyée : elle ne
   *  partirait pas mieux maintenant, et l'appel qui suit échouera de toute façon
   *  sans réseau. La sonde attend les réessais, bornée pour ne jamais geler le
   *  geste. */
  const envoyerMaintenant = useCallback(async (cible: Cible, id: string): Promise<void> => {
    const key = `${cible}/${id}`;
    const entry = pendingPatches.current.get(key);
    if (entry?.timer) {
      clearTimeout(entry.timer);
      pendingPatches.current.delete(key);
      persistPatch(key, entry);
    }
    const limite = Date.now() + ATTENTE_ACQUITTEMENT_MS;
    while (enVol.current.has(key) && Date.now() < limite) {
      await new Promise(r => setTimeout(r, SONDE_MS));
    }
  }, [persistPatch]);

  /** Oublie les écritures en attente qui visaient ces objets (FRE-86, défaut 2).
   *
   *  ⚠️ SANS ÇA, SUPPRIMER UNE LIGNE ENVOIE QUAND MÊME SON PATCH : 404, puis un
   *  toast qui annonce « un problème d'enregistrement » alors qu'il n'y a plus
   *  rien à enregistrer. Le message est trompeur autant que l'appel est inutile —
   *  il envoie chercher une panne là où il n'y a qu'un objet effacé.
   *
   *  On compare les IDENTITÉS et non les clés : un id est unique dans tout le
   *  produit, donc reconnaître la cible n'apporterait qu'une occasion de se
   *  tromper de préfixe en supprimant une séance et ses lignes. */
  const oublierPatchs = useCallback((ids: Iterable<string | undefined>) => {
    const vises = new Set<string>();
    for (const id of ids) if (id) vises.add(id);
    if (!vises.size) return;
    for (const [key, entry] of pendingPatches.current) {
      if (!vises.has(entry.id)) continue;
      if (entry.timer) clearTimeout(entry.timer);
      pendingPatches.current.delete(key);
    }
  }, []);

  /** ⚠️ FERMER L'ONGLET NE DOIT PAS EMPORTER LA DERNIÈRE FRAPPE (FRE-86, défaut 3).
   *
   *  Le flush au démontage, juste en dessous, couvre la navigation DANS l'app —
   *  changer d'athlète, revenir au tableau de bord. Il ne couvre pas la fermeture
   *  de l'onglet : React ne démonte rien, et les 400 ms du debounce partent avec
   *  la page.
   *
   *  ⚠️ ON TENTE, PUIS ON PRÉVIENT — dans cet ordre, et les deux comptent. La
   *  tentative aboutit souvent (le navigateur laisse partir une requête déjà
   *  émise) mais ne se garantit pas, et rien ne nous en informerait. Le
   *  `preventDefault` fait le reste : le navigateur demande confirmation, et le
   *  coach découvre qu'il y avait une écriture en vol AVANT de fermer, pas trois
   *  jours plus tard en relisant une séance qui a gardé l'ancienne valeur.
   *
   *  Ce n'est volontairement PAS une bannière maison : à ce stade la page peut
   *  disparaître à tout instant, et seule la boîte du navigateur retient le
   *  geste. Un `sendBeacon` aurait été l'autre voie — il n'accepte pas d'en-tête
   *  d'autorisation, donc il partirait sans jeton. */
  useEffect(() => {
    const avantFermeture = (e: BeforeUnloadEvent) => {
      const pending = pendingPatches.current;
      if (!pending.size) return;
      // ⚠️ SUR UNE COPIE : une frappe dont la création vole encore est REMISE
      // dans la file par `persistPatch`, et une `Map` parcourue en direct
      // revisite ce qu'on y remet — sans fin.
      for (const [key, entry] of [...pending]) {
        if (entry.timer) clearTimeout(entry.timer);
        pending.delete(key);
        persistPatch(key, entry);
      }
      e.preventDefault();
    };
    window.addEventListener('beforeunload', avantFermeture);
    return () => window.removeEventListener('beforeunload', avantFermeture);
  }, [persistPatch]);

  // Flush au démontage : la dernière frappe ne doit pas se perdre.
  useEffect(() => {
    const pending = pendingPatches.current;
    return () => {
      for (const [key, entry] of [...pending]) {   // une copie, cf. `avantFermeture`
        if (entry.timer) clearTimeout(entry.timer);
        pending.delete(key);
        persistPatch(key, entry);
      }
    };
  }, [persistPatch]);

  /** Mute la semaine SÉLECTIONNÉE. L'appelant dit ENSUITE ce qu'il a changé —
   *  le local et le réseau sont deux gestes distincts depuis qu'on n'envoie plus
   *  la semaine en bloc. */
  /** Les objectifs d'un bloc s'écrivent EN ENTIER (`PUT`), pas champ par champ :
   *  la liste n'a pas d'identité stable côté client. Même debounce que les
   *  patchs — une rafale de frappes fait un seul appel. */
  /** Encadre une écriture qui NE PASSE PAS PAR LA FILE — trame de BASE, création,
   *  suppression, réordonnancement.
   *
   *  ⚠️ UNE SEULE MÉCANIQUE POUR LES DEUX, et c'est le point. Elles ont la même
   *  forme (`await api.*` en direct) et le même effet (une écriture non
   *  acquittée) ; leur donner deux compteurs, c'était se donner deux occasions
   *  d'en oublier un — ce qui est précisément arrivé aux BASE (FRE-66) puis aux
   *  appels structurels (FRE-120). */
  const suivreEcritureDirecte = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    directesEnVol.current += 1;
    publier();
    try { return await fn(); } finally { directesEnVol.current -= 1; }
  }, [publier]);

  /** Un geste qui part MAINTENANT — ou attend le réseau sur le disque, à sa
   *  place dans l'ordre des gestes. Rend faux si le serveur a REFUSÉ : l'écran
   *  a alors quelque chose à rattraper, ce que « gardé » n'aurait pas.
   *
   *  ⚠️ C'EST CE QUI MANQUAIT AU COACH. La file ne connaissait que les frappes
   *  de l'athlète ; la trame d'Aubin, écrite sur un Wi-Fi sans internet, a
   *  toasté « pas de connexion » et s'est perdue au retour du réseau, quand le
   *  serveur a repeint l'écran avec la version d'avant (25/09). */
  /** Les créations PARTIES mais pas réglées, par identité : un geste sur
   *  l'objet — le supprimer, créer dessous — attend qu'elle le soit, sinon ce
   *  serait un 404 pour un objet qui existe une seconde plus tard. */
  const creationsEnVol = useRef<Map<string, Promise<unknown>>>(new Map());

  const ecrire = useCallback(async (geste: Geste, emporte: string[] = []): Promise<boolean> => {
    if (isMock || !programId) return true;
    if (geste.genre === 'creation') enCreation.add(geste.id);
    const envoi = suivreEcritureDirecte(async () => {
      await creationsEnVol.current.get(geste.genre === 'creation' ? geste.parent : geste.id);
      try {
        await envoyer(geste);
        // Ce que le geste a fait disparaître n'a plus rien à recevoir : ce qui
        // le visait encore sur le disque sort — rejoué, ce ne serait qu'un 404.
        if (emporte.length) void oublier(emporte);
        if (geste.genre === 'creation') libererLesFrappes(geste.id, 'acquittee');
        return true;
      } catch (e) {
        if (jamaisParvenueAuServeur(e)) {
          surLeDisque.current += 1;
          await garderPourPlusTard(geste, emporte);
          if (geste.genre === 'creation') libererLesFrappes(geste.id, 'gardee');
          return true;
        }
        saveFailed(e);
        if (geste.genre === 'creation') libererLesFrappes(geste.id, 'refusee');
        return false;
      }
    });
    if (geste.genre === 'creation') {
      const { id } = geste;
      creationsEnVol.current.set(id, envoi.catch(() => undefined));
      void envoi.finally(() => creationsEnVol.current.delete(id));
    }
    return envoi;
  }, [libererLesFrappes, programId, saveFailed, suivreEcritureDirecte]);

  /** Les écritures d'objectifs PARTIES, par bloc : la suivante attend la
   *  précédente (FRE-163). */
  const objectifsEnVol = useRef<Map<string, Promise<unknown>>>(new Map());

  /** Programme le remplacement de la liste d'objectifs d'un bloc.
   *
   *  ⚠️ LA VERSION SE LIT AU DÉPART, PAS À LA PROGRAMMATION (FRE-163). Le serveur
   *  refuse en 409 une liste écrite sur une version périmée — c'est ce qui empêche
   *  un onglet resté ouvert d'effacer la coche posée depuis le téléphone. Mais le
   *  premier concerné serait le client lui-même : deux frappes à 500 ms, la
   *  seconde partirait avec la version d'avant la première. D'où deux règles :
   *  la version est lue au moment d'envoyer (`lireVersion`), et un envoi attend
   *  que le précédent du même bloc ait rendu la sienne (`adopterVersion`). */
  const planifierObjectifs = useCallback((
    blockId: string, cle: string, objectives: ObjectivesReplace['objectives'],
    lireVersion: () => string, adopterVersion: (version: string) => void,
  ) => {
    if (isMock || !programId) return;
    const pending = pendingObjectiveSaves.current;
    const existant = pending.get(cle);
    if (existant) clearTimeout(existant);
    pending.set(cle, setTimeout(() => {
      pending.delete(cle);
      const precedent = objectifsEnVol.current.get(cle) ?? Promise.resolve();
      const envoi = suivreEcritureDirecte(async () => {
        await precedent.catch(() => undefined);
        try {
          const res = await api.put<ObjectifsRemplaces, ObjectivesReplace>(
            `/programs/${programId}/blocks/${blockId}/objectives`, { objectives, version: lireVersion() });
          adopterVersion(res.version);
        } catch (e) {
          saveFailed(e);
        } finally {
          // ⚠️ LES OBJECTIFS SONT DE LA CHARPENTE (FRE-144). `read_structure` les
          // rend avec les macros et les blocs, et le tableau de bord les lit de
          // là — sous `['structure']`, cinq minutes de `staleTime`. Cocher un
          // objectif depuis l'éditeur ne se voyait donc pas sur le tableau de
          // bord, alors que c'est justement l'écran qui les affiche.
          //
          // ⚠️ ET MÊME EN ÉCHEC (FRE-163) : un 409 dit que la liste affichée est
          // FAUSSE. Sans relecture, on réessaierait sur la même version, et on
          // récolterait le même refus.
          invalider(qc, clesDeLArbre(programId));
        }
      });
      objectifsEnVol.current.set(cle, envoi);
      void envoi.finally(() => {
        if (objectifsEnVol.current.get(cle) === envoi) objectifsEnVol.current.delete(cle);
      });
    }, WEEK_SAVE_DEBOUNCE_MS));
    publier();
  }, [programId, publier, qc, saveFailed, suivreEcritureDirecte]);

  // ⚠️ `useMemo`, ET C'EST LE POINT QUI DÉCIDE SI CETTE EXTRACTION COÛTE OU RAPPORTE.
  // Sans lui, l'objet rendu est neuf à chaque rendu : chaque `useCallback` du hook
  // appelant qui en dépend se recrée, et la mémoïsation de tout l'éditeur tombe.
  // Séparer un module ne doit rien coûter au rendu — sinon on a déplacé le
  // problème au lieu de le résoudre.
  return useMemo(() => ({
    schedulePatch, envoyerMaintenant, oublierPatchs, hasPendingWrites,
    planifierObjectifs, suivreEcritureDirecte, ecrire, signalerEchec, etatEnregistrement,
  }), [schedulePatch, envoyerMaintenant, oublierPatchs, hasPendingWrites,
       planifierObjectifs, suivreEcritureDirecte, ecrire, signalerEchec, etatEnregistrement]);
}
