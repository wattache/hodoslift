import { useMemo } from 'react';
import { useLibrary } from '@/api/hooks/use-library';

/** Listes « coach » dérivées de la bibliothèque unifiée :
 *  - principaux    = exercices flagués `competition`
 *  - renforcement  = exercices non flagués
 *  - variantes / assistances / tempos / formats = leurs catégories.
 *  Shape historique (tableaux de noms) attendue par les éditeurs. */
export interface CoachLib {
  principaux: string[];
  renforcement: string[];
  variantes: string[];
  assistances: string[];
  tempos: string[];
  formats: string[];
}

export function useCoachLib(): CoachLib {
  const { data: library } = useLibrary();
  return useMemo(() => {
    const exercices = library?.exercices ?? [];
    return {
      principaux: exercices.filter(e => e.competition).map(e => e.name),
      renforcement: exercices.filter(e => !e.competition).map(e => e.name),
      variantes: (library?.variantes ?? []).map(e => e.name),
      assistances: (library?.assistances ?? []).map(e => e.name),
      tempos: (library?.tempos ?? []).map(e => e.name),
      formats: (library?.formats ?? []).map(e => e.name),
    };
  }, [library]);
}
