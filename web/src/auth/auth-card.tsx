import type { ReactNode } from 'react';

/** Carte d'authentification/onboarding (dark/gold).
 *  Utilisée par LoginPage + les états d'AuthGate (spinner, liaison, accès refusé). */
export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 text-center shadow-xl shadow-black/20">
        {children}
      </div>
    </div>
  );
}

export function AuthSpinner() {
  return (
    <div className="flex flex-col items-center gap-3 py-6">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-gold" />
    </div>
  );
}

export function AuthLogo() {
  /* ⚠️ `object-cover` ET L'ANNEAU ONT SAUTÉ AVEC LE PNG. Ils habillaient une
   * image pleine — un blason détouré sur fond noir opaque. Le symbole est un
   * tracé sur fond transparent : le cadre arrondi lui dessinerait une vignette
   * qui n'existe pas, et le recadrage rognerait la barre la plus haute. */
  return (
    <img
      src="/marque/symbole.svg"
      alt="HodosLift"
      className="mx-auto mb-4 h-16 w-16"
    />
  );
}
