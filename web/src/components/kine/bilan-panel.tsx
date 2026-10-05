import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, ClipboardList, Lock, Plus, Trash2 } from 'lucide-react';

import {
  useBilanModelesDisponibles, useBilans, useCreerBilan, useSupprimerBilan,
} from '@/api/hooks/use-bilans';
import { todayISO } from '@/lib/dates-ui';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { toastSaveError } from '@/lib/save-error';

/** LA LISTE DES BILANS — la carte d'entrée, dans la page « Suivi kiné ».
 *
 *  ⚠️ ELLE NE FAIT QUE LISTER. Le bilan lui-même s'ouvre sur SA page
 *  (`/kine/bilans/:id`, cf. `views/bilan.tsx`) : 32 tests dépliés sous le
 *  questionnaire quotidien et son historique, c'est impraticable sur un téléphone.
 *
 *  Ce que la liste doit montrer sans qu'on ouvre : la date, l'avancement
 *  (« 12 / 32 ») et le fait qu'un bilan soit figé. C'est ce qui permet de choisir
 *  lequel reprendre.
 */
export function BilanPanel({ athleteId, lectureSeule }: {
  athleteId: string | null;
  /** `true` pour un consultant qui n'a pas le droit d'écrire ici. */
  lectureSeule: boolean;
}) {
  const { t: traduire } = useTranslation();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { data: bilans = [] } = useBilans(athleteId);
  const { data: dispo } = useBilanModelesDisponibles(athleteId);
  const creer = useCreerBilan(athleteId);
  const supprimer = useSupprimerBilan(athleteId);

  const modeles = dispo?.modeles ?? [];
  const [choix, setChoix] = useState(false);

  const ouvrir = (modeleId: string) => {
    setChoix(false);
    creer.mutate({ modeleId, date: todayISO(), antecedents: null }, {
      onError: toastSaveError,
      // On ouvre le bilan neuf : le créer sans y aller obligerait à le retrouver
      // dans la liste juste après l'avoir demandé.
      onSuccess: b => navigate(`/kine/bilans/${b.id}`),
    });
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <ClipboardList className="h-4 w-4 text-primary" />
          {traduire('suiviKine.bilans')}
        </h2>
        {/* ⚠️ PAS DE CHOIX QUAND IL N'Y EN A PAS. Avec un seul modèle — le cas de
            départ, et probablement pour longtemps — un sélecteur ferait faire un
            clic pour rien. Il n'apparaît qu'à partir de deux, et le bouton dit
            alors qu'il ouvre une liste. */}
        {!lectureSeule && modeles.length > 0 && (
          <button
            type="button"
            onClick={() => (modeles.length === 1 ? ouvrir(modeles[0].id) : setChoix(v => !v))}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium hover:bg-accent"
          >
            <Plus className="h-3.5 w-3.5" /> {traduire('suiviKine.nouveauBilan')}
          </button>
        )}
        {/* Aucun modèle : on le DIT, plutôt que de masquer le bouton sans motif —
            un écran muet se diagnostique mal, surtout à distance. */}
        {!lectureSeule && modeles.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {traduire('suiviKine.aucunModeleDisponible')}
          </p>
        )}
      </header>

      {choix && (
        <ul className="mb-3 flex flex-col gap-1.5 rounded-lg border border-border bg-background p-2">
          {modeles.map(m => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => ouvrir(m.id)}
                className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{m.nom}</span>
                  {m.description && (
                    <span className="block truncate text-xs text-muted-foreground">{m.description}</span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {traduire('suiviKine.nbTests', { count: m.nbTests })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {bilans.length === 0 && (
        <p className="text-sm text-muted-foreground">{traduire('suiviKine.aucunBilan')}</p>
      )}

      <ul className="flex flex-col gap-1.5">
        {bilans.map(b => (
          <li key={b.id} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(`/kine/bilans/${b.id}`)}
              className="flex h-11 flex-1 items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 text-left text-sm transition-colors hover:bg-accent"
            >
              <span className="flex min-w-0 items-center gap-2">
                {b.statut === 'finalise' && <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                <span className="min-w-0">
                  <span className="block">{b.date}</span>
                  {modeles.length > 1 && (
                    <span className="block truncate text-xs text-muted-foreground">{b.modeleNom}</span>
                  )}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {b.testsRenseignes} / {b.testsTotal}
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </span>
            </button>
            {!lectureSeule && b.statut === 'en_cours' && (
              <button
                type="button"
                title={traduire('suiviKine.supprimerBilanEnCours')}
                onClick={() => void (async () => {
                  if (!await confirm({
                    title: traduire('suiviKine.supprimerLeBilanDu', { date: b.date }),
                    description: traduire('suiviKine.resultatsPartentAvec'),
                  })) return;
                  supprimer.mutate(b.id, { onError: toastSaveError });
                })()}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
