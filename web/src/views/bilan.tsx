import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, ChevronLeft, Lock, PlayCircle } from 'lucide-react';

import {
  useBilan, useBilans, useEnregistrerResultat, usePatchBilan,
} from '@/api/hooks/use-bilans';
import type { BilanResultat } from '@/api/types';
import { Antecedents } from '@/components/kine/antecedents';
import { estRenseigne } from '@/components/kine/bilan-mesures';
import { LigneTest } from '@/components/kine/bilan-test';
import { useAthleteSelection } from '@/lib/athlete-selection';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { toastSaveError } from '@/lib/save-error';
import { cn } from '@/lib/utils';

/** UN BILAN, SUR SA PROPRE PAGE — `/kine/bilans/:bilanId`.
 *
 *  ⚠️ PAGE DÉDIÉE ET NON PANNEAU DÉPLIÉ, POUR LE TÉLÉPHONE. 32 tests imbriqués
 *  sous le questionnaire quotidien et son historique, c'est déjà long sur un écran
 *  large ; sur 375 px c'est impraticable — on perd sa place au moindre repli, et
 *  remonter à la liste demande de traverser tout le formulaire.
 *
 *  Une URL propre apporte le reste gratuitement : le bouton RETOUR du téléphone
 *  ramène à la liste, un bilan en cours se retrouve en favori, et l'app étant
 *  installable, l'adresse survit à sa fermeture.
 *
 *  ⚠️ ELLE VIT DANS L'ESPACE ATHLÈTE (`AthleteSpace`), pas à côté. Un bilan
 *  appartient à quelqu'un : en sortir ferait perdre la sélection d'athlète, et
 *  changer d'athlète depuis cette page n'aurait aucun sens.
 */

export function BilanView() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { bilanId = null } = useParams();
  const navigate = useNavigate();
  const sel = useAthleteSelection();
  const athleteId = sel.canMedical ? (sel.selected?.id ?? null) : null;

  const { data: bilans = [] } = useBilans(athleteId);
  const { data: bilan } = useBilan(athleteId, bilanId);

  // Le dernier bilan FINALISÉ qui n'est pas celui-ci — la référence de
  // comparaison. Un bilan en cours n'en est pas une : il est incomplet par nature.
  const precedentId = useMemo(
    () => bilans.find(b => b.statut === 'finalise' && b.id !== bilanId)?.id ?? null,
    [bilans, bilanId]);
  const { data: precedent } = useBilan(athleteId, precedentId);

  const patch = usePatchBilan(athleteId, bilanId);
  const ecrire = useEnregistrerResultat(athleteId, bilanId);

  // Les rubriques REPLIÉES, et non les ouvertes : l'ensemble vide veut alors dire
  // « tout ouvert », qui est l'état par défaut voulu.
  const [replies, setReplies] = useState<Set<string>>(() => new Set());

  // ⚠️ LES RUBRIQUES VIENNENT DES RÉSULTATS, pas d'une liste écrite ici. Le
  // modèle est composé par la kiné : coder « Généraux / Mobilité / Activation »
  // en dur ferait disparaître de l'écran toute rubrique qu'elle inventerait — et
  // sans erreur, juste des tests devenus invisibles. L'ordre est celui du bilan,
  // figé à sa création.
  const rubriques = useMemo(() => {
    const par = new Map<string, BilanResultat[]>();
    for (const r of bilan?.resultats ?? []) {
      const titre = r.rubriqueLibelle ?? 'Autres tests';
      const liste = par.get(titre);
      if (liste) liste.push(r); else par.set(titre, [r]);
    }
    return [...par.entries()].map(([titre, tests]) => ({ titre, tests }));
  }, [bilan]);

  // ⚠️ APPARIÉ PAR `testId`, L'IDENTITÉ STABLE — pas par libellé. Renommer un
  // test dans le modèle ne doit pas délier un athlète de son propre passé ; et
  // deux tests peuvent porter le même nom dans deux rubriques.
  const precedentParTest = useMemo(() => {
    const m = new Map<string, BilanResultat>();
    for (const r of precedent?.resultats ?? []) if (r.testId) m.set(r.testId, r);
    return m;
  }, [precedent]);

  const fige = !sel.canMedical || bilan?.statut === 'finalise';

  // ⚠️ DANS L'ORDRE DU BILAN, qui est celui du protocole — donc celui dans lequel
  // la kiné fait passer les tests. « Reprendre » doit ramener là où la séance
  // s'est interrompue, pas au premier trou d'une liste réordonnée.
  const premierNonFait = useMemo(
    () => bilan?.resultats.find(r => !estRenseigne(r)) ?? null,
    [bilan]);

  // ⚠️ LE TEST VISÉ EST SURLIGNÉ À L'ARRIVÉE, et c'est ce qui rend le geste
  // perceptible. Sans ça, sauter vers un test DÉJÀ visible ne produit aucun
  // mouvement : le bouton semble ne rien faire, ce que William a constaté.
  // Un défilement n'est un retour que s'il déplace quelque chose ; un surlignage
  // en est un dans tous les cas.
  const [vise, setVise] = useState<string | null>(null);

  // ⚠️ UN BILAN NE SE FINALISE QUE COMPLET, et c'est le SERVEUR qui le tient
  // (409 `bilan_incomplet`). Le front reprend la même condition — la règle
  // d'affordance du projet : ne pas proposer un geste que le serveur refusera.
  const reste = (bilan?.testsTotal ?? 0) - (bilan?.testsRenseignes ?? 0);
  const complet = Boolean(bilan) && reste === 0;

  // ⚠️ ON N'ENVOIE QUE LE CHAMP TOUCHÉ. La route est un `PATCH` et le serveur
  // écrit ce qu'il reçoit (`exclude_unset`) : renvoyer la ligne entière — ce
  // qu'exigeait le `PUT` d'avant — rejouerait à chaque frappe des valeurs qu'on
  // n'a pas modifiées, et écraserait une saisie concurrente sur le même test.
  const enregistrer = (resultatId: string, valeurs: Partial<BilanResultat>) => {
    ecrire.mutate({ resultatId, valeurs }, { onError: toastSaveError });
  };

  if (!bilan) return null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      {/* ⚠️ COLLANT EN HAUT. Sur téléphone, la progression et le retour sont ce
          qu'on cherche après avoir déroulé quinze tests ; les laisser filer en haut
          de page obligerait à remonter tout le formulaire pour les atteindre. */}
      <header className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-3 border-b border-border bg-background/95 px-1 py-3 backdrop-blur">
        <button
          type="button"
          // ⚠️ `?vue=bilans` ET NON `/kine` TOUT COURT. Depuis que le suivi a des
          // sous-onglets, revenir sans préciser retomberait sur « Au jour le
          // jour » — on aurait quitté la liste des bilans pour réapparaître
          // ailleurs, et il faudrait la retrouver à chaque aller-retour.
          onClick={() => navigate('/kine?vue=bilans')}
          // Bordure DORÉE : c'est la seule sortie de cette page, et sur un fond
          // sombre une bordure grise se confond avec les cartes qui l'entourent.
          className="inline-flex h-10 items-center gap-1 rounded-lg border border-primary/50 bg-background px-3 text-sm text-foreground hover:bg-accent"
        >
          <ChevronLeft className="h-4 w-4" /> {t("bilan.suiviKine")}
        </button>
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            {bilan.statut === 'finalise' && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
            Bilan du {bilan.date}
          </h1>
          <p className="font-mono text-xs tabular-nums text-muted-foreground">
            {bilan.testsRenseignes} / {bilan.testsTotal} tests
          </p>
        </div>
        {!fige && (
          <div className="ml-auto flex items-center gap-2">
            {/* ⚠️ « REPRENDRE » EST LE GESTE CENTRAL D'UN BILAN, pas un confort. Il
                se remplit sur plusieurs séances (§5) : à la reprise, la question
                n'est pas « combien ai-je fait » mais « où me suis-je arrêté ». Le
                compteur répond à la première, ce bouton à la seconde.

                Caché quand tout est fait — un bouton qui ne mène nulle part est
                pire qu'un bouton absent. */}
            {premierNonFait && (
              <button
                type="button"
                title={t("bilan.allerAuPremierNonRenseigne", { libelle: premierNonFait.testLibelle })}
                onClick={() => {
                  // ⚠️ DÉPLIER D'ABORD. Le test visé peut être dans une rubrique
                  // refermée — c'est même le cas le plus probable, puisqu'on
                  // referme ce qu'on a fini. Sauter sans déplier viserait un
                  // élément qui n'existe pas dans le DOM, et le bouton n'aurait
                  // simplement aucun effet.
                  setReplies(s => {
                    const n = new Set(s);
                    n.delete(premierNonFait.rubriqueLibelle ?? 'Autres tests');
                    return n;
                  });
                  setVise(premierNonFait.id);
                  // Le rendu suit le `setState` : on attend la frame suivante pour
                  // que la ligne existe avant de la viser.
                  requestAnimationFrame(() => {
                    document.getElementById(`test-${premierNonFait.id}`)
                      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                  });
                }}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium hover:bg-accent"
              >
                <PlayCircle className="h-3.5 w-3.5 shrink-0 text-primary" />
                {/* ⚠️ « REPRENDRE » ET NON LE NOM DU TEST. J'avais mis le libellé du
                    test, pensant qu'il informait mieux — il informait moins : dans
                    une barre d'outils, un nom se lit comme une ÉTIQUETTE et non
                    comme une action, si bien qu'on ne savait plus que c'était
                    cliquable. Un verbe dit qu'on peut agir ; la destination va dans
                    l'infobulle, où elle précise sans brouiller.

                    Ce qui rendait vraiment le geste perceptible, c'était le liseré
                    sur le test visé — pas le libellé. */}
                Reprendre
              </button>
            )}
            {/* ⚠️ LE TITRE EST SUR LE SPAN, PAS SUR LE BOUTON. Un bouton `disabled`
                n'émet aucun événement de souris dans plusieurs navigateurs : son
                `title` ne s'affiche donc jamais — c'est-à-dire précisément dans le
                cas où l'explication est la plus nécessaire.

                Et il explique dans LES DEUX états : grisé, pourquoi ; actif, ce
                qu'il va faire — parce que finaliser est IRRÉVERSIBLE, et qu'un
                geste sans retour mérite d'être annoncé avant le clic, pas seulement
                dans la boîte de confirmation. */}
            <span
              // ⚠️ `pointer-events-none` SUR LE BOUTON, ET C'EST CE QUI FAIT MARCHER
              // L'INFOBULLE. Un bouton `disabled` avale le survol sans émettre
              // d'événement : le curseur « interdit » s'affichait bien, mais aucune
              // explication n'apparaissait — constaté par William, et c'est le pire
              // des deux mondes, un refus sans motif.
              //
              // En neutralisant ses événements, le survol tombe sur le span, qui
              // porte le `title` ET le curseur.
              className={cn('inline-flex', !complet && 'cursor-not-allowed')}
              title={!complet
                ? t('bilan.resteATest', { count: reste })
                : t('bilan.figerCeBilan')}>
            <button
              type="button"
              // ⚠️ REFUSÉ SUR UN BILAN VIDE. Finaliser, c'est déclarer une
              // référence de comparaison — et l'opération est irréversible côté
              // serveur. Un bilan à 0/32 finalisé serait une référence sans
              // contenu, qu'aucun bilan suivant ne pourrait comparer à rien.
              disabled={!complet}
              onClick={() => void (async () => {
                if (!await confirm({
                  title: t("bilan.finaliserCeBilan", { count: bilan.testsTotal }),
                  description: t('bilan.deviendraLaReference'),
                  confirmLabel: t('bilan.finaliser'),
                })) return;
                patch.mutate({ statut: 'finalise' }, {
                  onError: toastSaveError,
                  onSuccess: () => navigate('/kine'),
                });
              })()}
              className="h-10 rounded-lg border border-border bg-background px-3 text-xs font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
            >
              {t('bilan.finaliser')}
            </button>
            </span>
          </div>
        )}

        {/* ⚠️ UNE BARRE PLUTÔT QU'UN SEUL CHIFFRE. « 12 / 32 » demande une division
            mentale à chaque coup d'œil ; la barre donne l'avancement sans lecture,
            ce qui compte sur un écran qu'on consulte entre deux tests, debout.
            Le chiffre reste — il dit ce que la barre ne peut pas : combien
            exactement, et sur combien. */}
        {/* ⚠️ LE MOTIF EST ÉCRIT, PAS SEULEMENT SURVOLABLE. Une infobulle n'existe
            pas sur téléphone — et c'est justement là que ce bilan se remplit. Un
            bouton grisé dont la raison se cache derrière un survol est un refus
            sans motif pour la moitié des gens qui le rencontrent. */}
        {!complet && (
          <p className="w-full text-[11px] text-muted-foreground">
            {t('bilan.resteATest', { count: reste })}
          </p>
        )}

        <div className="h-1 w-full overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${Math.round(100 * bilan.testsRenseignes / Math.max(bilan.testsTotal, 1))}%` }}
          />
        </div>
      </header>

      {bilan.statut === 'finalise' && (
        <p className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          {t("bilan.bilanFinalise")}.
        </p>
      )}

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">
          {t('bilan.antecedents')}
        </h2>
        <Antecedents
          valeur={bilan.antecedents}
          lecture={fige}
          onCommit={v => patch.mutate({ antecedents: v }, { onError: toastSaveError })}
        />
      </section>

      {/* ⚠️ REPLIABLES, ET C'EST UNE QUESTION DE PRATICABILITÉ. 32 tests déroulés
          font un mur — la mobilité en compte 15 à elle seule — et un bilan se
          remplit rubrique par rubrique, sur plusieurs séances. Refermer ce qui est
          fait, c'est retrouver où on en était sans faire défiler.

          OUVERTES PAR DÉFAUT : une page de bilan doit montrer son contenu. */}
      {rubriques.map(({ titre, tests }) => {
        const ouverte = !replies.has(titre);
        const renseignes = tests.filter(estRenseigne).length;
        return (
          <section key={titre} className="rounded-xl border border-border bg-card px-4 pb-2">
            <button
              type="button"
              onClick={() => setReplies(s => {
                const n = new Set(s);
                if (n.has(titre)) n.delete(titre); else n.add(titre);
                return n;
              })}
              className="flex w-full items-center gap-1.5 py-3 text-left"
            >
              <ChevronDown className={cn(
                'h-3.5 w-3.5 shrink-0 text-primary transition-transform',
                !ouverte && '-rotate-90',
              )} />
              <h2 className="text-xs font-semibold uppercase tracking-wide text-primary">
                {titre}
              </h2>
              {/* Le compte par rubrique, visible même repliée : sans lui, refermer
                  reviendrait à cacher l'information qu'on cherchait. */}
              <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
                {renseignes} / {tests.length}
              </span>
            </button>
            {ouverte && tests.map(r => (
              <LigneTest
                key={r.id}
                resultat={r}
                precedent={r.testId ? precedentParTest.get(r.testId) : undefined}
                lecture={fige}
                vise={vise === r.id}
                onEcrire={v => enregistrer(r.id, v)}
              />
            ))}
          </section>
        );
      })}

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">{t('bilan.notes')}</h2>
        {fige ? (
          <p className="whitespace-pre-wrap text-sm text-foreground">
            {bilan.notes || <span className="text-muted-foreground">{t('bilan.aucuneNote')}</span>}
          </p>
        ) : (
          <textarea
            defaultValue={bilan.notes ?? ''}
            key={`notes-${bilan.id}`}
            rows={3}
            onBlur={e => patch.mutate({ notes: e.target.value || null }, { onError: toastSaveError })}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        )}
      </section>
    </div>
  );
}
