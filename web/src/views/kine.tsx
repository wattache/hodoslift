import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { BilanPanel } from '@/components/kine/bilan-panel';
import { NotesSuivi } from '@/components/kine/notes-suivi';
import { DouleursSuivies } from '@/components/kine/douleurs-suivies';
import { useAthleteSelection } from '@/lib/athlete-selection';
import { cn } from '@/lib/utils';

/** SUIVI KINÉ — l'athlète rapporte son état, son staff le lit.
 *
 *  QUI ÉCRIT : l'athlète LUI-MÊME, et lui seul (`PATCH /daily-logs/{date}` est en
 *  mode `owner` côté brokkr). Les questions sont formulées à la deuxième personne
 *  — « quelles douleurs AS-TU ? » — et c'est cohérent : le coach ou le kiné qui
 *  regarde voit un historique en lecture, sans champ de saisie. C'est la règle
 *  d'affordance du projet : ne proposer une écriture que là où le serveur
 *  l'accepte.
 *
 *  OÙ ÇA VIT : dans `daily_logs`, la table du journal quotidien — une ligne par
 *  athlète et par jour. L'historique vient donc gratuitement, et c'est lui qui
 *  intéresse un kiné : une douleur qui monte ou qui descend.
 *
 *  ⚠️ LE QUESTIONNAIRE N'EST PAS ARRÊTÉ, et rien ici ne le connaît. Les questions
 *  vivent dans `lib/kine-questionnaire.ts` ; cette vue les parcourt. En ajouter
 *  une, en reformuler une, passer un texte en échelle : un seul fichier, aucune
 *  migration, aucun déploiement de brokkr — la colonne est un `jsonb` libre.
 */

/* `Jour` vient de `lib/kine-historique` — il y était déjà défini pour le
   regroupement. En garder une copie ici aurait fait deux formes d'une même chose,
   à synchroniser à la main : le défaut que ce projet a déjà payé plusieurs fois. */

/** ⚠️ PLUS D'ONGLET « AU JOUR LE JOUR » (FRE-195). Il ne portait QUE le
 *  questionnaire de douleur — les quatre clés de `daily_logs.kine` parlaient
 *  toutes de ça. Le garder à côté de « Douleurs » posait deux fois la même
 *  question, dont une en texte libre qu'aucune requête ne savait relire. */
type Vue = 'douleurs' | 'bilans' | 'notes';

function SousOnglets({ vues, active, onChoisir }: {
  vues: { cle: Vue; libelle: string }[];
  active: Vue;
  onChoisir: (v: Vue) => void;
}) {
  const { t } = useTranslation();
  return (
    <div role="tablist" aria-label={t('suiviKine.sections')} className="flex flex-wrap gap-1.5">
      {vues.map(v => (
        <button
          key={v.cle}
          type="button"
          role="tab"
          aria-selected={v.cle === active}
          // ⚠️ `aria-controls` ET UN `role="tabpanel"` EN FACE. Annoncer `tab`
          // sans désigner ce qu'il commande est une demi-promesse : un lecteur
          // d'écran dit « onglet 3 sur 3 » puis laisse l'utilisateur chercher où
          // le contenu a changé. Les deux moitiés, ou aucune.
          aria-controls={`suivi-${v.cle}`}
          onClick={() => onChoisir(v.cle)}
          className={cn(
            'h-9 rounded-full border px-4 text-xs font-medium transition-colors',
            v.cle === active
              ? 'border-transparent bg-primary text-primary-foreground'
              : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {v.libelle}
        </button>
      ))}
    </div>
  );
}

export function KineView() {
  const { t } = useTranslation();
  const sel = useAthleteSelection();
  const athleteId = sel.canView ? (sel.selected?.id ?? null) : null;

  const [parametres, setParametres] = useSearchParams();
  const canWrite = sel.isSelf;


  if (!sel.selected) {
    return (
      <div className="mx-auto max-w-4xl rounded-lg border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
        {t('suiviKine.aucunAthlete')}
      </div>
    );
  }

  // ⚠️ LES VUES DISPONIBLES SUIVENT LES MÊMES GARDES QU'AVANT, une par une. Un
  // onglet est une PROMESSE : en afficher un que le serveur refuserait serait
  // pire que l'empilement qu'on remplace — on remplacerait une page longue par
  // une porte fermée.
  const vues: { cle: Vue; libelle: string }[] = [
    // ⚠️ VISIBLE PAR TOUS CEUX QUI VOIENT CET ÉCRAN. La liste est servie en
    // `owner_or_staff` — c'est la règle du suivi kiné, dont le guichet sert
    // déjà le kiné ET le coach. Seule l'ÉCRITURE est réservée à l'athlète, et
    // c'est `canWrite` qui la porte, pas l'onglet.
    { cle: 'douleurs', libelle: t('douleurs.titre') },
    ...(sel.canMedical ? [{ cle: 'bilans' as const, libelle: t('suiviKine.bilans') }] : []),
    ...(athleteId && sel.suivisIds.has(athleteId)
        ? [{ cle: 'notes' as const, libelle: t('suiviKine.notes') }] : []),
  ];

  const demandee = parametres.get('vue') as Vue | null;
  // ⚠️ ON RETOMBE SUR LA PREMIÈRE VUE si celle demandée n'est pas disponible :
  // une URL `?vue=notes` partagée à un athlète ne doit pas lui rendre un écran
  // vide, ni une erreur — juste ce qu'il a le droit de voir.
  const active: Vue = vues.some(v => v.cle === demandee) ? demandee! : 'douleurs';

  const choisir = (v: Vue) =>
    // `replace` : les sous-onglets ne sont pas des étapes de navigation. Sans lui,
    // le bouton RETOUR du navigateur reparcourrait chaque pastille cliquée avant
    // de quitter l'écran.
    setParametres(v === 'douleurs' ? {} : { vue: v }, { replace: true });

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      {/* Un seul onglet disponible : pas de barre du tout. Une rangée d'un
          élément ne fait pas choisir, elle occupe. */}
      {vues.length > 1 && <SousOnglets vues={vues} active={active} onChoisir={choisir} />}

      {active === 'douleurs' && athleteId && (
        <div id="suivi-douleurs" role="tabpanel">
          <DouleursSuivies athleteId={athleteId} canWrite={canWrite} />
        </div>
      )}

      {/* ⚠️ AFFICHÉ SEULEMENT SI LE SERVEUR L'ACCEPTERA. `canMedical` exclut le
          coach — le bilan est en `owner_or_kine` côté brokkr. Lui montrer l'onglet
          pour qu'il reçoive un 403 est exactement ce que la règle d'affordance du
          projet interdit. */}
      {active === 'bilans' && sel.canMedical && (
        <div id="suivi-bilans" role="tabpanel">
          <BilanPanel athleteId={athleteId} lectureSeule={!sel.canMedical} />
        </div>
      )}

      {/* ⚠️ `suivisIds` ET NON `canMedical`, et l'écart est TOUT le sujet. Les
          bilans sont ouverts à l'athlète (`owner_or_kine`) parce qu'il les
          remplit ; les notes de suivi ne le sont pas. C'est l'observation du
          praticien — une hypothèse, pas un constat — et `canMedical` vaut
          `isSelf || kineDeCetAthlete`, donc il inclurait justement celui à qui
          elles sont fermées. Le serveur refuserait (403) ; l'écran ne doit pas
          proposer. */}
      {active === 'notes' && athleteId && sel.suivisIds.has(athleteId) && (
        <div id="suivi-notes" role="tabpanel">
          <NotesSuivi athleteId={athleteId} />
        </div>
      )}
    </div>
  );
}
