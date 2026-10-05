import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTraining } from '@/api/hooks/use-training';
import { useAthleteSelection } from '@/lib/athlete-selection';
import { useProgramSelection } from '@/lib/program-selection';
import { cn } from '@/lib/utils';
import { BlocTableau } from '@/views/bloc-tableau';

/** LE BLOC EN TABLEAU, DANS LE TRACKER — FRE-114.
 *
 *  ⚠️ IL A EU UN ONGLET À LUI, ET C'ÉTAIT LE DÉFAUT. « Programme » affichait le
 *  bloc choisi AILLEURS, dans l'arbre de l'écran Entraînement : pour regarder un
 *  autre bloc il fallait changer d'onglet, sélectionner, puis revenir — un
 *  aller-retour que rien à l'écran n'annonçait (William, 11/09 : « c'est pas
 *  intuitif, faut sélectionner dans un onglet puis aller dans un autre »). Le
 *  choix se fait donc ICI, sur l'écran qui l'affiche.
 *
 *  ⚠️ ET IL REJOINT LE TRACKER PLUTÔT QUE DE GARDER SON ONGLET. C'est la même
 *  question que le reste de cet écran — « où j'en suis » — à une autre échelle :
 *  le quotidien, puis le bloc, puis la progression par mouvement.
 *
 *  ⚠️ LE CHOIX EST LOCAL, IL N'ÉCRIT PAS LA SÉLECTION PARTAGÉE. `useProgramSelection`
 *  persiste dans `localStorage` et sert aussi à l'écran d'édition : appeler son
 *  `select` ici ferait qu'un coach venu CONSULTER un bloc d'il y a six mois
 *  retrouverait son éditeur posé dessus. On lit son état pour savoir où ouvrir,
 *  on n'y écrit pas. */
export function BlocEnTableau() {
  const { t } = useTranslation();
  const sel = useAthleteSelection();
  const programId = sel.canView ? sel.selected?.programId ?? null : null;
  /** ⚠️ L'ARBRE ENTIER, contrairement au reste de l'app (FRE-119) : le tableau
   *  lit les exercices de CHAQUE semaine du bloc, et la charpente allégée ne les
   *  porte pas. */
  const { data: macros = [], isLoading, isError, error } = useTraining(programId);
  const courant = useProgramSelection(programId, macros);

  /** `null` = on suit la sélection courante ; sinon c'est le choix fait ici. */
  const [choix, setChoix] = useState<{ macroId: string; blocId: string } | null>(null);

  if (!programId) return null;
  if (isLoading) return <Cadre><Etat texte={t('common.loading')} /></Cadre>;
  if (isError) {
    // La cause technique, toujours : un « réessayez » nu ne se diagnostique pas
    // à distance (même leçon que l'écran de connexion).
    const cause = (error as { code?: string; message?: string })?.code
      ?? (error as { message?: string })?.message ?? '?';
    return <Cadre><Etat texte={t('blocTableau.chargementEchoue', { cause })} /></Cadre>;
  }
  if (macros.length === 0) return null;

  const macro = macros.find(m => m.id === choix?.macroId) ?? courant.macro;
  const blocs = macro?.blocks ?? [];
  const bloc = blocs.find(b => b.id === choix?.blocId) ?? (choix ? blocs.at(-1) : courant.block);
  if (!macro || !bloc) return <Cadre><Etat texte={t('blocTableau.macroSansBloc', { macro: macro?.name ?? '' })} /></Cadre>;

  /** ⚠️ LE REPÈRE NE SUIT QUE LE BLOC EN COURS. « S3 en cours » posé sur un bloc
   *  d'il y a six mois désignerait une semaine qui n'a rien de courant — et
   *  accentuerait la mauvaise colonne. Sur un autre bloc, l'origine redevient S1,
   *  qui est la lecture du coach. */
  const semaineCourante = bloc.id === courant.block?.id ? courant.week?.weekNumber : undefined;

  return (
    <Cadre>
      <div className="flex flex-col gap-3">
        {/* ⚠️ DES PASTILLES, PAS UNE LISTE DÉROULANTE, et c'est mesuré : en
            production, 4 macros au maximum par programme (1,2 en moyenne) et 5
            blocs au maximum par macro (2,1). Tout tient sur une ligne, et le
            choix se voit sans ouvrir quoi que ce soit. */}
        {macros.length > 1 && (
          <Choix libelle={t('blocTableau.macro')}
                 entrees={macros.map((m, i) => ({
                   id: m.id,
                   nom: m.name || t('training.macroN', { n: m.macroNumber ?? i + 1 }),
                 }))}
                 actif={macro.id}
                 choisir={id => {
                   // Changer de macro emmène sur SON dernier bloc — le plus
                   // récent, celui qu'on vient regarder neuf fois sur dix.
                   const suivant = macros.find(m => m.id === id);
                   const dernier = suivant?.blocks.at(-1);
                   if (dernier) setChoix({ macroId: id, blocId: dernier.id });
                 }} />
        )}
        {/* Un macro d'un seul bloc n'a rien à choisir non plus. */}
        {blocs.length > 1 && (
          <Choix libelle={t('blocTableau.bloc')}
                 entrees={blocs.map(b => ({
                   id: b.id,
                   nom: b.name || t('training.blocN', { n: b.blockNumber }),
                 }))}
                 actif={bloc.id}
                 choisir={id => setChoix({ macroId: macro.id, blocId: id })} />
        )}
      </div>

      <BlocTableau bloc={bloc} semaineCourante={semaineCourante} />
    </Cadre>
  );
}

function Choix({ libelle, entrees, actif, choisir }: {
  libelle: string;
  entrees: { id: string; nom: string }[];
  actif: string;
  choisir: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-display text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        {libelle}
      </span>
      {entrees.map(e => (
        <button
          key={e.id}
          type="button"
          // ⚠️ `aria-pressed` ET NON `role="tab"` : il n'y a pas de panneau par
          // entrée, un seul tableau qui change de contenu. Un `tablist` sans
          // `tabpanel` promet une structure qui n'existe pas.
          aria-pressed={e.id === actif}
          onClick={() => choisir(e.id)}
          className={cn(
            'rounded-lg border px-3 py-1 text-xs transition-colors',
            e.id === actif
              ? 'border-gold text-gold'
              : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          {e.nom}
        </button>
      ))}
    </div>
  );
}

function Cadre({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card/40 p-4">
      <h2 className="font-display text-sm uppercase tracking-[0.14em] text-muted-foreground">
        {t('blocTableau.titre')}
      </h2>
      {children}
    </section>
  );
}

function Etat({ texte }: { texte: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
      {texte}
    </div>
  );
}
