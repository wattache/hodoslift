import { Component, type ReactNode } from 'react';
import i18n from '@/i18n';
import { rapporterPlantage } from '@/lib/observabilite';

/** Garde-fou global : capture les erreurs de rendu pour éviter l'écran noir.
 *  Affiche un message lisible + l'erreur, plutôt que de blanchir toute l'app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // La console reste : elle est ce qui sert en développement, où Sentry est
    // volontairement muet.
    console.error('App crash:', error, info);
    // ⚠️ ET C'EST LA RAISON D'ÊTRE DE TOUT CE BRANCHEMENT. Ce garde-fou évitait
    // l'écran blanc, mais gardait l'erreur pour lui : une `console.error` dans
    // le navigateur d'un coach n'est lue par personne. Il rechargeait, et on ne
    // l'apprenait jamais.
    rapporterPlantage(error, info);
  }

  render() {
    if (this.state.error) return <EcranDErreur erreur={this.state.error} />;
    return this.props.children;
  }
}

/** L'écran de plantage, commun à ce garde-fou et à celui du routeur. */
export function EcranDErreur({ erreur }: { erreur: unknown }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-xl border border-destructive/40 bg-card p-6 text-center">
        <h1 className="text-lg font-semibold tracking-tight">{i18n.t("auth.uneErreurEstSurvenue")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{i18n.t("auth.lApplicationARencontre")}</p>
        <pre className="mt-4 max-h-40 overflow-auto rounded-md border border-border bg-background p-3 text-left text-[11px] text-destructive">
          {erreur instanceof Error ? erreur.message : String(erreur)}
        </pre>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 rounded-lg bg-gold px-4 py-2 text-sm font-medium text-gold-foreground hover:bg-gold/90"
        >
          Recharger
        </button>
      </div>
    </div>
  );
}
