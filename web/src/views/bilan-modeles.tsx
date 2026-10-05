import { useState } from 'react';
import {
  Archive, ArrowLeft, ClipboardList, EyeOff, Plus, Trash2, Undo2,
} from 'lucide-react';

import {
  useArchiverModele, useBilanModele, useBilanModeles, useCreerModele, useCreerRubrique,
  useCreerTest, usePatchModele, usePatchRubrique, usePatchTest, useSupprimerModele,
  useSupprimerRubrique, useSupprimerTest,
} from '@/api/hooks/use-bilan-modeles';
import type { BilanTest } from '@/api/types';
import { AjouterAvecMenu } from '@/components/ajouter-avec-menu';
import { MediaDuTest } from '@/components/kine/media-du-test';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { toastSaveError } from '@/lib/save-error';
import { cn } from '@/lib/utils';

/** LES MODÈLES DE BILAN — ce que la kiné compose. Spec : `brokkr/docs/bilan-kine.md`.
 *
 *  ⚠️ RÉSERVÉE À LA KINÉ. Décider quels tests cliniques existent, sous quel
 *  protocole et quelle charge, est un acte de praticien : le serveur le tient
 *  (`require_kine`), et la navigation ne propose donc l'entrée qu'à elle.
 *
 *  ⚠️ ET ON LE DIT À L'ÉCRAN : éditer ici ne touche AUCUN bilan déjà passé. Un
 *  bilan copie son modèle à sa création — sans cette phrase, on n'ose pas
 *  corriger une charge de peur d'abîmer l'historique, et le modèle se fige par
 *  prudence plutôt que par choix.
 */

const MESURES = [
  { valeur: 'aucune', cle: 'bilan.mesureAucune' },
  { valeur: 'reps', cle: 'bilan.mesureReps' },
  { valeur: 'secondes', cle: 'bilan.mesureSecondes' },
] as const;

const VUES = ['face', 'profil', 'dos'] as const;

function Champ({ label, valeur, onCommit, placeholder, type = 'text', large = false }: {
  label: string;
  valeur: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'number';
  large?: boolean;
}) {
  return (
    <label className={cn('flex flex-col gap-1 text-xs text-muted-foreground', large && 'w-full')}>
      {label}
      <input
        type={type}
        defaultValue={valeur}
        placeholder={placeholder}
        key={valeur}
        onBlur={e => { if (e.target.value !== valeur) onCommit(e.target.value); }}
        className={cn(
          'h-10 rounded-md border border-border bg-background px-2 text-sm text-foreground',
          large ? 'w-full' : 'w-28',
        )}
      />
    </label>
  );
}

function LigneTestEditable({ test, modeleId }: { test: BilanTest; modeleId: string }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const patch = usePatchTest(modeleId);
  const supprimer = useSupprimerTest(modeleId);
  const [ouvert, setOuvert] = useState(false);

  const ecrire = (corps: Parameters<typeof patch.mutate>[0]['corps']) =>
    patch.mutate({ testId: test.id, corps }, { onError: toastSaveError });

  return (
    <div className={cn(
      'border-t border-border/60 py-2 first:border-t-0',
      // ⚠️ UN TEST RETIRÉ RESTE VISIBLE, EN GRISÉ. Il ne part plus dans les
      // nouveaux bilans, mais la kiné doit pouvoir le retrouver et le réactiver —
      // le faire disparaître transformerait un retrait en suppression.
      test.retire && 'opacity-50',
    )}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOuvert(v => !v)}
          className="min-w-0 flex-1 text-left text-sm font-medium text-foreground hover:underline"
        >
          {test.libelle}
          {test.retire && <span className="ml-2 text-xs font-normal text-muted-foreground">(retiré)</span>}
        </button>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {test.mesure === 'aucune' ? t("bilan.ressenti") : test.mesure}
          {test.bilateral && ` · ${t("bilan.gd")}`}
          {test.chargeKg != null && ` · ${test.chargeKg} kg`}
        </span>
        <button
          type="button"
          title={test.retire ? t("bilan.remettreLeTest")
                             : t("bilan.retirerDesProchains")}
          onClick={() => ecrire({ retire: !test.retire })}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent"
        >
          {test.retire ? <Undo2 className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          title={t("bilan.supprimerDefinitivementTest")}
          onClick={() => void (async () => {
            if (!await confirm({ title: t("bilan.supprimerTest", { libelle: test.libelle }) })) return;
            supprimer.mutate(test.id, { onError: toastSaveError });
          })()}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {ouvert && (
        <div className="mt-2 flex flex-col gap-3 rounded-lg border border-border bg-background/60 p-3">
          <Champ label={t("bilan.libelle")} valeur={test.libelle} large
                 onCommit={v => ecrire({ libelle: v })} />
          <Champ label={t('bilan.protocole2')} valeur={test.protocole ?? ''} large
                 placeholder={t("bilan.protocole")}
                 onCommit={v => ecrire({ protocole: v || null })} />
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Mesure
              <select
                value={test.mesure}
                onChange={e => ecrire({ mesure: e.target.value as typeof test.mesure })}
                className="h-10 rounded-md border border-border bg-background px-2 text-sm text-foreground"
              >
                {MESURES.map(m => <option key={m.valeur} value={m.valeur}>{t(m.cle)}</option>)}
              </select>
            </label>
            {/* ⚠️ PAS DE LATÉRALITÉ SANS MESURE (§3.5). Deux résultats n'ont de
                sens que s'il y a quelque chose à mettre dedans — le serveur ne
                l'accepterait pas, l'écran ne le propose donc pas. */}
            {test.mesure !== 'aucune' && (
              <label className="flex h-10 items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={test.bilateral}
                  onChange={e => ecrire({ bilateral: e.target.checked })}
                  className="h-4 w-4 accent-[var(--primary)]"
                />
                {t("bilan.gaucheDroite")}
              </label>
            )}
            <Champ label={t("bilan.chargeKg")} type="number" valeur={test.chargeKg?.toString() ?? ''}
                   onCommit={v => ecrire({ chargeKg: v === '' ? null : Number(v) })} />
            <Champ label={t("bilan.materiel")} valeur={test.materiel ?? ''} placeholder={t("bilan.materielPlaceholder")}
                   onCommit={v => ecrire({ materiel: v || null })} />
            <Champ label={t('bilan.cible')} valeur={test.cible ?? ''} placeholder={t("bilan.dureePlaceholder")}
                   onCommit={v => ecrire({ cible: v || null })} />
          </div>
          {/* ⚠️ LES IMAGES VIVENT AVEC LE PROTOCOLE, pas dans un écran à part.
              C'est en écrivant les consignes qu'on se dit « une photo dirait ça
              mieux » — et sur un geste de mobilité, elle dit ce qu'aucune
              phrase ne dit. */}
          <MediaDuTest test={test} onChoisir={ids => ecrire({ mediaIds: ids })} />

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-muted-foreground">{t("bilan.priseDeVue")}</span>
            {VUES.map(v => (
              <label key={v} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={test.vues.includes(v)}
                  onChange={e => ecrire({
                    vues: e.target.checked
                      ? [...test.vues, v]
                      : test.vues.filter(x => x !== v),
                  })}
                  className="h-4 w-4 accent-[var(--primary)]"
                />
                {v}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Composeur({ modeleId, onFermer }: { modeleId: string; onFermer: () => void }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { data: modele } = useBilanModele(modeleId);
  const patch = usePatchModele(modeleId);
  const creerRubrique = useCreerRubrique(modeleId);
  const patchRubrique = usePatchRubrique(modeleId);
  const supprimerRubrique = useSupprimerRubrique(modeleId);
  const creerTest = useCreerTest(modeleId);

  if (!modele) return null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onFermer}
          className="inline-flex h-10 items-center gap-1 rounded-lg border border-primary/50 bg-background px-3 text-sm hover:bg-accent"
        >
          <ArrowLeft className="h-4 w-4" /> {t("bilan.modeles")}
        </button>
        <h1 className="text-sm font-semibold tracking-tight">{modele.nom}</h1>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {t("bilan.testsCount", { count: modele.nbTests })}
        </span>
      </header>

      {/* ⚠️ LA PHRASE QUI PERMET D'OSER. Sans elle, on n'édite pas un modèle de
          peur d'abîmer les bilans déjà passés — et le modèle se fige par
          prudence. Elle dit la garantie du schéma, elle ne la promet pas. */}
      <p className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
        {t("bilan.modifierNAffecteQue")} <strong className="text-foreground">{t("bilan.prochains")}</strong>{' '}
        {t("bilan.bilansDejaPassesGardent")}
      </p>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <Champ label={t('bilan.nom')} valeur={modele.nom} large
               onCommit={v => patch.mutate({ nom: v }, { onError: toastSaveError })} />
        <Champ label={t('common.description')} valeur={modele.description ?? ''} large
               onCommit={v => patch.mutate({ description: v || null }, { onError: toastSaveError })} />
      </section>

      {modele.rubriques.map(r => (
        <section key={r.id} className="rounded-xl border border-border bg-card px-4 pb-3 pt-3">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <input
              defaultValue={r.libelle}
              key={r.libelle}
              // ⚠️ SANS NOM ACCESSIBLE, ce champ s'annonçait « zone de texte » et
              // rien d'autre : le libellé de la rubrique EST sa valeur, donc rien
              // ne le décrit. Même raison que la prop `label` d'`EditCell` côté
              // entraînement — un texte voisin ne relie rien à un champ.
              aria-label={t("bilan.libelleDeLaRubrique", { libelle: r.libelle })}
              onBlur={e => {
                if (e.target.value !== r.libelle) {
                  patchRubrique.mutate({ rubriqueId: r.id, corps: { libelle: e.target.value } },
                                       { onError: toastSaveError });
                }
              }}
              className="h-10 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-xs font-semibold uppercase tracking-wide text-primary hover:border-border focus:border-border"
            />
            <button
              type="button"
              // Les défauts du contrat sont sobres — un test de mobilité, le cas
              // le plus fréquent — mais ils doivent être ÉCRITS : le schéma les
              // déclare requis pour que le front ne puisse pas les oublier.
              onClick={() => creerTest.mutate(
                { rubriqueId: r.id,
                  corps: { libelle: 'Nouveau test', mesure: 'aucune', bilateral: false } },
                { onError: toastSaveError })}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-2 text-xs hover:bg-accent"
            >
              <Plus className="h-3.5 w-3.5" /> Test
            </button>
            <button
              type="button"
              title={t("bilan.supprimerRubrique")}
              onClick={() => void (async () => {
                if (!await confirm({
                  title: t("bilan.supprimerLaRubrique", { libelle: r.libelle }),
                  description: t("bilan.refuseSiRubriquePorteDesTests"),
                })) return;
                supprimerRubrique.mutate(r.id, { onError: toastSaveError });
              })()}
              className="grid h-9 w-9 place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          {r.tests.length === 0
            ? <p className="py-2 text-xs text-muted-foreground">{t("bilan.aucunTestDansCetteRubrique")}</p>
            : r.tests.map(t => <LigneTestEditable key={t.id} test={t} modeleId={modeleId} />)}
        </section>
      ))}

      <button
        type="button"
        onClick={() => creerRubrique.mutate({ libelle: 'Nouvelle rubrique' },
                                            { onError: toastSaveError })}
        className="inline-flex h-10 items-center gap-1.5 self-start rounded-lg border border-border bg-background px-3 text-xs font-medium hover:bg-accent"
      >
        <Plus className="h-3.5 w-3.5" /> {t("bilan.ajouterUneRubrique")}
      </button>
    </div>
  );
}

export function BilanModelesView() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [ouvert, setOuvert] = useState<string | null>(null);
  const { data: modeles = [] } = useBilanModeles(!ouvert);
  const creer = useCreerModele();
  const archiver = useArchiverModele();
  const supprimer = useSupprimerModele();

  if (ouvert) return <Composeur modeleId={ouvert} onFermer={() => setOuvert(null)} />;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <ClipboardList className="h-4 w-4 text-primary" />
          {t("bilan.modelesDeBilan")}
        </h1>
        {/* ⚠️ UN SEUL POINT D'ENTRÉE, ET C'EST LE CORRECTIF (25/08). Le bouton
            disait « + Modèle vide » et la duplication vivait dans une icône ▢
            posée sur chaque ligne. Thomas a cherché à repartir d'un modèle
            existant, a cliqué ici, n'a rien vu — et a conclu que la
            fonctionnalité avait disparu. On cherche « dupliquer » là où l'on
            crée, pas sur la ligne de l'objet qu'on ne crée pas. Même mécanique
            que « + Bloc » côté entraînement, au composant près. */}
        <AjouterAvecMenu
          label={t("bilan.modele")}
          sources={modeles.map(m => ({ label: t("bilan.modeleEtTests", { nom: m.nom, count: m.nbTests }) }))}
          titreSources={t("bilan.dupliquerUnModele")}
          iconeSource={ClipboardList}
          alignement="droite"
          classeDeclencheur="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium hover:bg-accent"
          onChoisir={i => {
            const source = i === undefined ? undefined : modeles[i];
            creer.mutate(
              source
                ? { nom: t("bilan.copieDe", { nom: source.nom }), description: source.description, dupliquerDe: source.id }
                : { nom: t("bilan.nouveauModele") },
              { onError: toastSaveError, onSuccess: m => setOuvert(m.id) },
            );
          }}
        />
      </header>

      {modeles.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("bilan.aucunModele")}</p>
      )}

      <ul className="flex flex-col gap-1.5">
        {modeles.map(m => (
          <li key={m.id} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOuvert(m.id)}
              className={cn(
                // ⚠️ `min-w-0` AVEC `flex-1` : un enfant de flex ne rétrécit pas
                // sous la largeur de son contenu tant qu'on ne l'y autorise pas,
                // et le `truncate` du libellé ne sert alors à rien. À 320 px, la
                // ligne faisait 375 — ce bouton en tenait 271, plus les deux
                // carrés de 44 et leurs écarts.
                'flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2 text-left text-sm hover:bg-accent',
                m.archive && 'opacity-50',
              )}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {m.nom}
                  {m.archive && <span className="ml-2 text-xs font-normal text-muted-foreground">(archivé)</span>}
                </span>
                {m.description && (
                  <span className="block truncate text-xs text-muted-foreground">{m.description}</span>
                )}
              </span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                {m.nbTests} tests
              </span>
            </button>
            {/* ⚠️ L'ICÔNE « DUPLIQUER » ÉTAIT ICI, et elle a été retirée le 25/08.
                Dupliquer reste LA VOIE NORMALE (§6) — personne ne recompose 32
                protocoles à la main — mais le geste a rejoint le bouton « +
                Modèle », qui est là où on le cherche. Deux affordances pour un
                seul geste, c'était une de trop, et la moins visible des deux
                était celle qui portait la voie normale. */}
            {/* ⚠️ ARCHIVER PLUTÔT QUE SUPPRIMER, et c'est le geste PRINCIPAL : un
                modèle utilisé par des bilans ne se supprime pas (le serveur
                refuse), parce que le lien qui relie ces bilans entre eux
                disparaîtrait sans que personne ne le voie. */}
            <button
              type="button"
              title={m.archive ? t("bilan.remettreDansLesModeles") : t("bilan.archiverModele")}
              onClick={() => archiver.mutate({ modeleId: m.id, archive: !m.archive },
                                             { onError: toastSaveError })}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent"
            >
              {m.archive ? <Undo2 className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              title={t("bilan.supprimerDefinitivementModele")}
              onClick={() => void (async () => {
                if (!await confirm({
                  title: t("bilan.supprimerLeModele", { nom: m.nom }),
                  description: t("bilan.refuseSiModeleUtilise"),
                })) return;
                supprimer.mutate(m.id, { onError: toastSaveError });
              })()}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
