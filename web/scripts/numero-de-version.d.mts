type Livre = { eitri: string | null; brokkr: string | null };

export function decider(entree: {
  numero: string;
  publie: Livre | null;
  eitri: string | null;
  brokkr: string | null;
}): { ok: true; nouveau: boolean } | { ok: false; message: string };
