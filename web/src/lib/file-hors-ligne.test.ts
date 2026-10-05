// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** LA FILE SUR LE DISQUE — FRE-118.
 *
 *  ⚠️ POURQUOI ELLE VIT HORS DE `patchs-en-attente`. Celle-là est un hook : elle
 *  ne tourne que tant que l'écran d'entraînement est monté. Or un athlète qui
 *  rouvre son téléphone au retour du réseau atterrit sur le tableau de bord —
 *  sa séance dormirait sur le disque en attendant qu'il retourne de lui-même au
 *  bon onglet. Le harnais réel l'a montré : après rechargement, la valeur
 *  n'arrivait jamais. Le rejeu est donc au niveau de l'APPLICATION, et il se
 *  teste ici sans monter le moindre composant.
 */
const { ApiError } = await vi.importActual<typeof import('@/api/client')>('@/api/client');
type Appel = (url: string, corps?: unknown) => Promise<unknown>;
const api = {
  patch: vi.fn<Appel>(async () => ({})), put: vi.fn<Appel>(async () => ({})),
  delete: vi.fn<Appel>(async () => ({})), post: vi.fn<Appel>(async () => ({})),
};
vi.mock('@/api/client', async () => ({
  api, ApiError: (await vi.importActual<typeof import('@/api/client')>('@/api/client')).ApiError,
}));

const disque = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  get: async (k: string) => disque.get(k),
  set: async (k: string, v: unknown) => { disque.set(k, v); },
  del: async (k: string) => { disque.delete(k); },
}));

const { appliquerLaFile, garderPourPlusTard, lireLaFile, oublier, rejouerLaFile } =
  await import('@/lib/file-hors-ligne');

const CLE = 'eitri-file-ecritures';
const frappe = (id: string, patch: Record<string, unknown>) =>
  ({ genre: 'patch' as const, programId: 'prog-1', cible: 'exercises' as const, id, patch });
/** La trame d'un bloc, telle qu'elle se garde. */
const trame = (id: string, base: Record<string, unknown>) =>
  ({ genre: 'base' as const, programId: 'prog-1', id, corps: { base: base as never } });
/** Ce que la file rend : le geste, et la clé que le rangement lui a donnée. */
const rangee = (geste: object) => ({ ...geste, cle: expect.any(String) });
/** Une entrée telle que le disque la portait AVANT que la file connaisse
 *  d'autres gestes qu'un patch : ni `genre`, ni `cle`. */
const ancienneForme = (id: string, patch: Record<string, unknown>) =>
  ({ programId: 'prog-1', cible: 'exercises', id, patch });

const suppression = (cible: 'weeks' | 'sessions' | 'exercises', id: string) =>
  ({ genre: 'suppression' as const, programId: 'prog-1', cible, id });
const ordre = (cible: 'sessions' | 'exercises', id: string, ids: string[]) =>
  ({ genre: 'ordre' as const, programId: 'prog-1', cible, id, ids });

beforeEach(() => {
  disque.clear();
  api.patch.mockClear(); api.patch.mockResolvedValue({});
  api.put.mockClear(); api.put.mockResolvedValue({});
  api.delete.mockClear(); api.delete.mockResolvedValue({});
  api.post.mockClear(); api.post.mockResolvedValue({});
});
const creation = (cible: 'sessions' | 'exercises', id: string, parent: string) =>
  ({ genre: 'creation' as const, programId: 'prog-1', cible, id, parent, corps: { id, name: cible === 'sessions' ? 'Jeudi' : '' } } as never);
afterEach(() => { vi.restoreAllMocks(); });

describe('ce qui est gardé', () => {
  it('une frappe se range, et se relit', async () => {
    await garderPourPlusTard(frappe('ex-1', { weight: '80' }));
    expect(await lireLaFile()).toEqual([rangee(frappe('ex-1', { weight: '80' }))]);
  });

  it('⚠️ une seule entrée par objet : la plus récente FUSIONNE sur l’ancienne', async () => {
    // Sans ça, la file enfle d'une entrée par frappe pendant toute une séance
    // hors ligne, et le rejeu réécrit dix fois le même champ.
    await garderPourPlusTard(frappe('ex-1', { weight: '80' }));
    await garderPourPlusTard(frappe('ex-1', { repsDone: '4' }));
    await garderPourPlusTard(frappe('ex-1', { weight: '100' }));

    expect(await lireLaFile()).toEqual([
      rangee(frappe('ex-1', { weight: '100', repsDone: '4' })),
    ]);
  });

  it('⚠️ deux gestes rangés AU MÊME INSTANT sont tous deux gardés', async () => {
    // Chacun relit la file puis la réécrit : sans sérialisation, le second
    // écrase le premier. `make livrer` l'a vu le 26/09 — un renommage et une
    // suppression dans la même seconde, la suppression perdue.
    await Promise.all([
      garderPourPlusTard(frappe('ex-1', { weight: '80' })),
      garderPourPlusTard(suppression('sessions', 's2')),
      garderPourPlusTard(trame('b1', { principles: [] })),
    ]);
    expect((await lireLaFile()).map(e => e.genre)).toEqual(['patch', 'suppression', 'base']);
  });

  it('⚠️ la fusion est un geste NEUF : sa clé change', async () => {
    // C'est ce qui protège une frappe faite PENDANT le rejeu : le rejeu efface
    // ce qu'il a envoyé par sa clé, et la fusion n'a plus celle-là.
    await garderPourPlusTard(frappe('ex-1', { weight: '80' }));
    const [avant] = await lireLaFile();
    await garderPourPlusTard(frappe('ex-1', { repsDone: '4' }));
    const [apres] = await lireLaFile();
    expect(apres.cle).not.toBe(avant.cle);
  });

  it('une trame se REMPLACE : la dernière version gagne, entière', async () => {
    await garderPourPlusTard(trame('b1', { principles: [{ name: 'SQUAT' }] }));
    await garderPourPlusTard(trame('b1', { principles: [] }));
    expect(await lireLaFile()).toEqual([rangee(trame('b1', { principles: [] }))]);
  });

  it('un geste fusionné passe en FIN de file : c’est sa place dans l’ordre', async () => {
    await garderPourPlusTard(frappe('ex-1', { weight: '80' }));
    await garderPourPlusTard(trame('b1', { principles: [] }));
    await garderPourPlusTard(frappe('ex-1', { repsDone: '4' }));
    expect((await lireLaFile()).map(e => e.genre)).toEqual(['base', 'patch']);
  });

  it('ce que le disque portait AVANT se relit comme un patch, sous une clé STABLE', async () => {
    disque.set(CLE, [ancienneForme('ex-1', { weight: '80' })]);
    const [premiere] = await lireLaFile();
    const [seconde] = await lireLaFile();
    expect(premiere).toEqual({ ...frappe('ex-1', { weight: '80' }), cle: expect.any(String) });
    expect(seconde.cle).toBe(premiere.cle);
  });

  it('deux objets différents gardent chacun la leur', async () => {
    await garderPourPlusTard(frappe('ex-1', { weight: '80' }));
    await garderPourPlusTard(frappe('ex-2', { weight: '90' }));
    expect((await lireLaFile()).map(e => e.id)).toEqual(['ex-1', 'ex-2']);
  });

  it('un objet supprimé emporte sa frappe en attente', async () => {
    // Même règle qu'en mémoire : un `PATCH` sur un objet détruit rend 404 et un
    // toast qui envoie chercher une panne là où il n'y a qu'un objet effacé.
    await garderPourPlusTard(frappe('ex-1', { weight: '80' }));
    await oublier(['ex-1']);
    expect(disque.has(CLE)).toBe(false);
  });

  it('oublier un bloc emporte sa trame en attente', async () => {
    await garderPourPlusTard(trame('b1', { principles: [] }));
    await oublier(['b1']);
    expect(disque.has(CLE)).toBe(false);
  });

  it('⚠️ une suppression EMPORTE ce qui visait l’objet et ce qu’il entraîne', async () => {
    // Une frappe sur une ligne de la séance supprimée, l'ordre de ses lignes :
    // rejoués, ce ne seraient que des 404.
    await garderPourPlusTard(frappe('ex-1', { weight: '80' }));
    await garderPourPlusTard(ordre('exercises', 's1', ['ex-2', 'ex-1']));
    await garderPourPlusTard(frappe('ex-9', { weight: '70' }));
    await garderPourPlusTard(suppression('sessions', 's1'), ['s1', 'ex-1', 'ex-2']);
    expect((await lireLaFile()).map(e => `${e.genre}:${e.id}`)).toEqual(['patch:ex-9', 'suppression:s1']);
  });

  it('⚠️ supprimer ce qu’on venait de créer sans réseau : les deux gestes s’ANNULENT', async () => {
    // Envoyer la suppression seule ne serait qu'un 404 sur un objet que le
    // serveur n'a jamais vu ; envoyer la création puis la suppression, deux
    // écritures pour rien.
    await garderPourPlusTard(creation('sessions', 's9', 'w1'));
    await garderPourPlusTard(frappe('ex-9', { weight: '70' }));
    await garderPourPlusTard(suppression('sessions', 's9'), ['s9']);
    expect((await lireLaFile()).map(e => `${e.genre}:${e.id}`)).toEqual(['patch:ex-9']);
  });

  it('une création SOUS un objet supprimé part avec lui', async () => {
    await garderPourPlusTard(creation('exercises', 'ex-9', 's1'));
    await garderPourPlusTard(suppression('sessions', 's1'), ['s1']);
    expect((await lireLaFile()).map(e => e.genre)).toEqual(['suppression']);
  });

  it('un ordre se REMPLACE : la dernière liste gagne', async () => {
    await garderPourPlusTard(ordre('exercises', 's1', ['ex-2', 'ex-1']));
    await garderPourPlusTard(ordre('exercises', 's1', ['ex-1', 'ex-2']));
    expect(await lireLaFile()).toEqual([rangee(ordre('exercises', 's1', ['ex-1', 'ex-2']))]);
  });
});

describe('le rejeu', () => {
  it('envoie ce qui attend, et vide le disque', async () => {
    await garderPourPlusTard(frappe('ex-1', { weight: '80' }));

    expect(await rejouerLaFile()).toBe(1);
    expect(api.patch).toHaveBeenCalledWith('/programs/prog-1/exercises/ex-1', { weight: '80' });
    expect(disque.has(CLE)).toBe(false);
  });

  it('⚠️ DANS L’ORDRE, une par une', async () => {
    // Deux frappes sur des objets différents doivent repartir dans l'ordre où
    // elles ont été faites. `Promise.all` les enverrait en parallèle, et l'ordre
    // d'arrivée deviendrait celui du réseau.
    await garderPourPlusTard(frappe('ex-1', { weight: '80' }));
    await garderPourPlusTard(frappe('ex-2', { weight: '90' }));

    await rejouerLaFile();
    expect(api.patch.mock.calls.map(c => c[0])).toEqual([
      '/programs/prog-1/exercises/ex-1', '/programs/prog-1/exercises/ex-2',
    ]);
  });

  it('⚠️ ce qui ne PART toujours pas RESTE, et ne se perd pas', async () => {
    await garderPourPlusTard(frappe('ex-1', { weight: '80' }));
    api.patch.mockRejectedValue(new Error('Failed to fetch'));

    expect(await rejouerLaFile()).toBe(0);
    expect(await lireLaFile()).toEqual([rangee(frappe('ex-1', { weight: '80' }))]);
  });

  it('⚠️ et le rejeu S’ARRÊTE là : ce qui suit garde sa place, sans partir', async () => {
    // Continuer enverrait un geste AVANT celui dont il dépend — un renommage
    // avant la création — qui serait refusé, donc perdu.
    await garderPourPlusTard(frappe('ex-1', { weight: '80' }));
    await garderPourPlusTard(trame('b1', { principles: [] }));
    api.patch.mockRejectedValue(new Error('Failed to fetch'));

    expect(await rejouerLaFile()).toBe(0);
    expect(api.put).not.toHaveBeenCalled();
    expect((await lireLaFile()).map(e => e.genre)).toEqual(['patch', 'base']);
  });

  it('une trame gardée repart en PUT, entière', async () => {
    await garderPourPlusTard(trame('b1', { principles: [{ name: 'SQUAT' }] }));
    expect(await rejouerLaFile()).toBe(1);
    expect(api.put).toHaveBeenCalledWith('/programs/prog-1/blocks/b1/base',
                                         { base: { principles: [{ name: 'SQUAT' }] } });
    expect(disque.has(CLE)).toBe(false);
  });

  it('⚠️ une frappe faite PENDANT le rejeu n’est pas effacée avec ce qui est parti', async () => {
    await garderPourPlusTard(frappe('ex-1', { weight: '80' }));
    // La correction arrive pendant que le PATCH est en vol : elle fusionne, et
    // c'est un geste neuf. Le rejeu a envoyé l'ancien, pas celui-là.
    api.patch.mockImplementationOnce(async () => { await garderPourPlusTard(frappe('ex-1', { weight: '100' })); });

    expect(await rejouerLaFile()).toBe(1);
    expect(await lireLaFile()).toEqual([rangee(frappe('ex-1', { weight: '100' }))]);
  });

  it('une suppression repart en DELETE, un ordre en PUT sur son parent, un déplacement en PUT sur la ligne', async () => {
    await garderPourPlusTard(suppression('weeks', 'w1'));
    await garderPourPlusTard(ordre('sessions', 'w2', ['s2', 's1']));
    await garderPourPlusTard(ordre('exercises', 's1', ['ex-2', 'ex-1']));
    await garderPourPlusTard({ genre: 'deplacement', programId: 'prog-1', id: 'ex-1', sessionId: 's2', position: 0 });
    expect(await rejouerLaFile()).toBe(4);
    expect(api.delete).toHaveBeenCalledWith('/programs/prog-1/weeks/w1');
    expect(api.put.mock.calls).toEqual([
      ['/programs/prog-1/weeks/w2/sessions/order', { ids: ['s2', 's1'] }],
      ['/programs/prog-1/sessions/s1/exercises/order', { exerciseIds: ['ex-2', 'ex-1'] }],
      ['/programs/prog-1/exercises/ex-1/seance', { sessionId: 's2', position: 0 }],
    ]);
  });

  it('une création repart en POST sous son parent, l’identité dans le corps', async () => {
    await garderPourPlusTard(creation('sessions', 's9', 'w1'));
    await garderPourPlusTard(creation('exercises', 'ex-9', 's9'));
    expect(await rejouerLaFile()).toBe(2);
    expect(api.post.mock.calls).toEqual([
      ['/programs/prog-1/weeks/w1/sessions', { id: 's9', name: 'Jeudi' }],
      ['/programs/prog-1/sessions/s9/exercises', { id: 'ex-9', name: '' }],
    ]);
  });

  it('un seul rejeu à la fois : deux demandes simultanées partagent le même', async () => {
    await garderPourPlusTard(frappe('ex-1', { weight: '80' }));
    await Promise.all([rejouerLaFile(), rejouerLaFile()]);
    expect(api.patch).toHaveBeenCalledTimes(1);
  });

  it('⚠️ ce qui est REFUSÉ sort de la file — sinon elle enfle sans fin', async () => {
    // Le serveur a répondu : rejouer indéfiniment ne le fera pas changer d'avis,
    // et masquerait le refus au lieu de le traiter.
    await garderPourPlusTard(frappe('ex-1', { weight: 'PDC' }));
    api.patch.mockRejectedValue(new ApiError(422, 'valeur refusée'));

    expect(await rejouerLaFile()).toBe(0);
    expect(disque.has(CLE)).toBe(false);
  });

  it('une file vide n’appelle rien', async () => {
    expect(await rejouerLaFile()).toBe(0);
    expect(api.patch).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------- */
/* CE QUI ATTEND DOIT SE VOIR — FRE-120                                       */
/* ------------------------------------------------------------------------- */

/** ⚠️ POURQUOI CETTE SURCOUCHE EXISTE. Il y a deux stockages : le cache de
 *  lecture porte la semaine telle que le SERVEUR l'a donnée, la file porte ce
 *  que l'athlète a tapé sans réseau. Au rechargement, seul le premier était lu —
 *  et la saisie disparaissait de l'écran alors qu'elle était bien gardée.
 *
 *  L'athlète la retape, et doute de l'app au moment précis où elle est censée le
 *  rassurer. Fermer l'app entre deux séries est le geste le plus ordinaire du
 *  monde ; ce n'était pas un cas limite.
 */
const arbre = (exercices: { id?: string; weight?: string; repsDone?: string }[]) => ([{
  id: 'm1', macroNumber: 1, name: '', trainingFrequency: null, coachNotes: null,
  blocks: [{
    id: 'b1', blockNumber: 1, name: '', startDate: '', endDate: '', objectives: [],
    weeks: [{
      id: 'w1', weekNumber: 1, name: '', hidden: false, startDate: '', endDate: '',
      athlete: { firstName: '', lastName: '', weight: 0, height: 0 },
      sessions: [{
        id: 's1', name: 'Lundi', sessionDate: '', formOfTheDay: '' as const, lignesSansRessenti: 0,
        exercises: exercices,
      }],
    }],
  }],
}] as unknown as Parameters<typeof appliquerLaFile>[0]);

const lignes = (m: ReturnType<typeof appliquerLaFile>) =>
  m[0].blocks[0].weeks[0].sessions![0].exercises;

describe('la surcouche des frappes en attente', () => {
  it('pose la valeur gardée par-dessus celle du serveur', () => {
    const apres = appliquerLaFile(arbre([{ id: 'ex-1', weight: '80' }]),
                                     [frappe('ex-1', { weight: '100' })]);
    expect(lignes(apres)[0]).toMatchObject({ id: 'ex-1', weight: '100' });
  });

  it('ne touche pas les lignes qui n’attendent rien', () => {
    const apres = appliquerLaFile(
      arbre([{ id: 'ex-1', weight: '80' }, { id: 'ex-2', weight: '90' }]),
      [frappe('ex-1', { weight: '100' })]);
    expect(lignes(apres).map(e => e.weight)).toEqual(['100', '90']);
  });

  it('⚠️ une ligne SUPPRIMÉE ne ressuscite pas', () => {
    // Le piège du ticket. Un patch en attente désigne une ligne par son id ; si
    // le coach l'a effacée depuis un autre appareil, itérer la FILE la ferait
    // réapparaître — un fantôme que le serveur ne connaît plus, et dans lequel
    // l'athlète taperait pour rien. On parcourt donc l'ARBRE, jamais la file.
    const apres = appliquerLaFile(arbre([{ id: 'ex-2', weight: '90' }]),
                                     [frappe('ex-1', { weight: '100' })]);
    expect(lignes(apres).map(e => e.id)).toEqual(['ex-2']);
  });

  it('une file vide rend l’arbre INCHANGÉ, au même objet', () => {
    // Pas une coquetterie : cette valeur entre dans les dépendances de l'effet
    // qui recompose l'arbre. Un objet neuf le relancerait à chaque passage.
    const avant = arbre([{ id: 'ex-1', weight: '80' }]);
    expect(appliquerLaFile(avant, [])).toBe(avant);
  });

  it('la surcouche vaut aussi pour une SÉANCE et une SEMAINE', () => {
    const apres = appliquerLaFile(arbre([{ id: 'ex-1' }]), [
      { ...frappe('s1', { formOfTheDay: 4 }), cible: 'sessions' },
      { ...frappe('w1', { athleteWeightKg: 72.5 }), cible: 'weeks' },
    ]);
    const semaine = apres[0].blocks[0].weeks[0];
    expect(semaine.sessions![0]).toMatchObject({ formOfTheDay: 4 });
    expect(semaine).toMatchObject({ athleteWeightKg: 72.5 });
  });

  it('et pour un MACRO et un BLOC : le coach renomme hors ligne', () => {
    const apres = appliquerLaFile(arbre([{ id: 'ex-1' }]), [
      { ...frappe('m1', { name: 'ROAD TO 100' }), cible: 'macros' },
      { ...frappe('b1', { name: 'Force' }), cible: 'blocks' },
    ]);
    expect(apres[0]).toMatchObject({ name: 'ROAD TO 100' });
    expect(apres[0].blocks[0]).toMatchObject({ name: 'Force' });
  });

  it('⚠️ une TRAME gardée se voit : le bloc porte la sienne, pas celle du serveur', () => {
    // Le cas d'Aubin (25/09) : sa trame écrite sans réseau, puis l'écran
    // repeint avec celle du serveur au retour — vide.
    const apres = appliquerLaFile(arbre([{ id: 'ex-1' }]), [
      trame('b1', { principles: [{ name: 'SQUAT' }] }),
    ]);
    expect(apres[0].blocks[0].base).toEqual({ principles: [{ name: 'SQUAT' }] });
  });

  it('⚠️ un objet SUPPRIMÉ hors ligne ne se voit plus, ni ce qu’il entraîne', () => {
    const apres = appliquerLaFile(arbre([{ id: 'ex-1' }, { id: 'ex-2' }]), [
      suppression('exercises', 'ex-1'),
    ]);
    expect(lignes(apres).map(e => e.id)).toEqual(['ex-2']);
    const sansSeance = appliquerLaFile(arbre([{ id: 'ex-1' }]), [suppression('sessions', 's1')]);
    expect(sansSeance[0].blocks[0].weeks[0].sessions).toEqual([]);
    const sansSemaine = appliquerLaFile(arbre([{ id: 'ex-1' }]), [suppression('weeks', 'w1')]);
    expect(sansSemaine[0].blocks[0].weeks).toEqual([]);
  });

  it('un ORDRE gardé se voit ; ce que la liste ne connaît pas garde sa place, après', () => {
    const apres = appliquerLaFile(arbre([{ id: 'ex-1' }, { id: 'ex-2' }, { id: 'ex-3' }]), [
      ordre('exercises', 's1', ['ex-3', 'ex-1']),
    ]);
    expect(lignes(apres).map(e => e.id)).toEqual(['ex-3', 'ex-1', 'ex-2']);
  });

  it('un DÉPLACEMENT gardé pose la ligne dans l’autre séance', () => {
    const deuxSeances = arbre([{ id: 'ex-1' }, { id: 'ex-2' }]);
    deuxSeances[0].blocks[0].weeks[0].sessions!.push({
      ...deuxSeances[0].blocks[0].weeks[0].sessions![0], id: 's2', name: 'Mardi', exercises: [{ id: 'ex-3' } as never],
    });
    const apres = appliquerLaFile(deuxSeances, [
      { genre: 'deplacement', programId: 'prog-1', id: 'ex-1', sessionId: 's2', position: 1 },
    ]);
    const [lundi, mardi] = apres[0].blocks[0].weeks[0].sessions!;
    expect(lundi.exercises.map(e => e.id)).toEqual(['ex-2']);
    expect(mardi.exercises.map(e => e.id)).toEqual(['ex-3', 'ex-1']);
  });

  it('⚠️ un objet CRÉÉ hors ligne se voit, sous son parent, avec ce qu’on y a tapé', () => {
    const apres = appliquerLaFile(arbre([{ id: 'ex-1' }]), [
      creation('sessions', 's9', 'w1'),
      creation('exercises', 'ex-9', 's9'),
      { ...frappe('ex-9', { name: 'SQUAT' }) },
    ]);
    const [, jeudi] = apres[0].blocks[0].weeks[0].sessions!;
    expect(jeudi).toMatchObject({ id: 's9', name: 'Jeudi' });
    expect(jeudi.exercises.map(e => [e.id, e.name])).toEqual([['ex-9', 'SQUAT']]);
  });

  it('un macro créé hors ligne apparaît avec son bloc, un bloc sous son macro', () => {
    const apres = appliquerLaFile(arbre([{ id: 'ex-1' }]), [
      { genre: 'creation', programId: 'prog-1', cible: 'blocks', id: 'b9', parent: 'm1', corps: { id: 'b9' } },
      { genre: 'creation', programId: 'prog-1', cible: 'macros', id: 'm9', parent: 'prog-1', corps: { id: 'm9', block: { id: 'b10' } } },
    ]);
    expect(apres[0].blocks.map(b => b.id)).toEqual(['b1', 'b9']);
    expect(apres[1]).toMatchObject({ id: 'm9', macroNumber: 2 });
    expect(apres[1].blocks.map(b => b.id)).toEqual(['b10']);
    expect(apres[1].blocks[0].base).toBeDefined();
  });

  it('une trame qui REDATE les semaines les redate à l’écran aussi', () => {
    const apres = appliquerLaFile(arbre([{ id: 'ex-1' }]), [{
      genre: 'base', programId: 'prog-1', id: 'b1',
      corps: { base: {}, weekDates: [{ weekId: 'w1', startDate: '2026-10-05', endDate: '2026-10-11' }] } as never,
    }]);
    expect(apres[0].blocks[0].weeks[0]).toMatchObject({ startDate: '2026-10-05', endDate: '2026-10-11' });
  });
});
