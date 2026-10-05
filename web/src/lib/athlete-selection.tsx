import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMe } from '@/api/hooks/use-me';
import { useAthletesSuivis, useMonAthlete, useMyAthletes } from '@/api/hooks/use-athletes';
import type { Athlete, Me } from '@/api/types';

/** Sélection d'athlète + permissions dérivées — l'ex-cœur de l'adapter v2.
 *
 *  Règle d'affordance : le front ne propose une écriture que là où brokkr
 *  l'accepte. QUATRE permissions, une par mode d'autorisation serveur :
 *   - `isSelf`      → autz "owner"          (suivi quotidien, RPE ressenti, forme)
 *   - `canEdit`     → autz "owner_or_staff" (objectifs, events, contenu semaine)
 *   - `canManage`   → autz "staff"          (profil canonique, 1RM, PR, structure)
 *   - `canMedical`  → autz "owner_or_kine"  (BILAN KINÉ — le coach en est exclu)
 *
 *  ⚠️ LA QUATRIÈME EST ARRIVÉE LE 21/08 AVEC LE BILAN, et elle est la première à
 *  RETRANCHER quelque chose au coach. Un bilan porte des antécédents et des
 *  pathologies, qui ne sont pas de la donnée d'entraînement — le serveur le tient
 *  par `owner_or_kine`, et l'interface ne doit pas proposer un écran qu'il
 *  refusera. Une permission de moins ici, et le coach verrait un onglet qui rend
 *  403 : exactement ce que la règle d'affordance interdit.
 */
export interface AthleteSelection {
  /** Mes athlètes (sidebar) — chargement en cours si undefined. */
  athletes: Athlete[];
  loading: boolean;
  selected: Athlete | null;
  selectedId: string | null;
  setSelectedId: (id: string) => void;
  /** L'utilisateur connecté EST l'athlète sélectionné. */
  isSelf: boolean;
  /** Le coach connecté GÈRE l'athlète sélectionné. */
  canManage: boolean;
  /** isSelf OU canManage — écritures "owner_or_coach". */
  canEdit: boolean;
  /** L'athlète LUI-MÊME ou SON kiné — jamais le coach. Le médical (bilan). */
  canMedical: boolean;
  /** Lecture des données privées (programme, logs, events…). */
  canView: boolean;
  /** L'athlète sélectionné n'est accessible QUE par le suivi kiné : lecture du
   *  programme seulement — les vues aux ressources athlète (dashboard, tracker,
   *  calendrier) doivent renvoyer vers l'entraînement. */
  /** Ids des athlètes suivis par l'appelant kiné (vide sinon) — pour que la
   *  sidebar sache les garder dans « mes athlètes ». */
  suivisIds: ReadonlySet<string>;
  me: Me | undefined;
}

const SelectionContext = createContext<AthleteSelection | null>(null);

const STORAGE_KEY = 'eitri-selected-athlete';

export function AthleteSelectionProvider({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const { data: miens = [], isLoading } = useMyAthletes();
  const { data: suivis = [] } = useAthletesSuivis();
  /** ⚠️ HORS LIGNE, C'EST TOUT CE QU'IL RESTE (FRE-118). Les deux listes
   *  ci-dessus viennent du réseau et sont vides sans lui ; celle-ci est relue du
   *  disque. Sans elle, l'app s'ouvre sur « Aucun athlète sélectionné » — et
   *  aucun à sélectionner — alors que la semaine est là, sur le même disque. */
  const { data: monAthlete } = useMonAthlete();

  const storageKey = `${STORAGE_KEY}:${me?.uid ?? 'anonymous'}`;
  const [selectedId, setSelectedIdRaw] = useState<string | null>(null);

  // Restauration par user une fois le profil connu (clé per-uid, pas de fuite
  // entre comptes sur un poste partagé).
  useEffect(() => {
    if (!me) return;
    const stored = localStorage.getItem(storageKey);
    if (stored) setSelectedIdRaw(stored);
  }, [me, storageKey]);

  const setSelectedId = (id: string) => {
    setSelectedIdRaw(id);
    localStorage.setItem(storageKey, id);
  };

  const value = useMemo<AthleteSelection>(() => {
    // FUSION : mes athlètes (soi / gérés / tous pour l'admin) + mes suivis de
    // kiné, dédoublonnés. Une kiné qui est AUSSI athlète voit les deux mondes.
    // Ma fiche vient en DERNIER RECOURS : en ligne elle est déjà dans `miens`,
    // et le dédoublonnage la laisse à sa place. Hors ligne, elle est la seule.
    const vus = new Set<string>();
    //
    // ⚠️ ET SEULEMENT SI C'EST MA FICHE DANS LA STRUCTURE COURANTE (FRE-13).
    // Nico chez SCAPPULIFT n'a pas de fiche (`me.athleteId` nul là-bas) : sa
    // fiche French Forge, gardée sur le disque, n'a rien à faire dans la liste.
    const maFiche = monAthlete && monAthlete.id === me?.athleteId ? [monAthlete] : [];
    const athletes = [...miens, ...suivis, ...maFiche]
      .filter(a => !vus.has(a.id) && (vus.add(a.id), true));
    // ⚠️ UN ACCÈS SUPPORT EN COURS VAUT COACH ET KINÉ (FRE-202), comme côté brokkr,
    // qui l'a déjà décidé : `supportJusquAu` n'arrive que s'il l'accepte. Il
    // entre dans `suivisIds` parce que c'est ce qui ouvre ce que seul le kiné
    // ouvre (les notes de suivi) — le nom dit « suivi », le serveur dit « kiné ».
    const supportIds = miens.filter(a => a.supportJusquAu).map(a => a.id);
    const suivisIds = new Set([...suivis.map(a => a.id), ...supportIds]);
    // Défaut : mon propre profil athlète, sinon le premier de la liste.
    const fallback = athletes.find(a => a.id === me?.athleteId) ?? athletes[0] ?? null;
    const selected = athletes.find(a => a.id === selectedId) ?? fallback;
    const isSelf = Boolean(me?.athleteId && selected && selected.id === me.athleteId);
    // Le suivi kiné se lit dans l'appartenance à /athletes/suivis, et pas dans un
    // cocktail de flags — une kiné-athlète perdait ses suivis avec l'ancien test
    // « kiné pur ».
    const kineDeCetAthlete = Boolean(selected && suivisIds.has(selected.id));
    // ⚠️ LE KINÉ GÈRE COMME LE COACH (2026-08-18) : mêmes droits, mêmes onglets.
    // C'était la LECTURE SEULE jusque-là, prudence de FRE-52 — le serveur refusait
    // alors ses écritures, et proposer un geste qu'il refuse est précisément ce
    // que la règle d'affordance du projet interdit. Il les accepte désormais
    // (`_MODES` et `_AthleteAccessDep`, brokkr) : les deux côtés se suivent.
    const canManage = Boolean(selected
      && ((me?.isCoach && selected.coachId === me.uid) || kineDeCetAthlete));
    return {
      athletes,
      loading: isLoading,
      selected,
      selectedId: selected?.id ?? null,
      setSelectedId,
      isSelf,
      canManage,
      canEdit: isSelf || canManage,
      // ⚠️ `kineDeCetAthlete` ET NON `canManage` : c'est toute la différence, et
      // elle tient à ce seul mot. `canManage` inclut le coach.
      canMedical: isSelf || kineDeCetAthlete,
      canView: isSelf || canManage,
      suivisIds,
      me,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [miens, suivis, monAthlete, isLoading, selectedId, me]);

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useAthleteSelection(): AthleteSelection {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error('useAthleteSelection doit être utilisé sous AthleteSelectionProvider');
  return ctx;
}
