import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { mockResolve } from '@/api/mock';
import { useMe } from '@/api/hooks/use-me';
import type { Me, Preferences, PreferencesPatch } from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';

type Langue = NonNullable<Preferences['langue']>;
const LANGUES: readonly Langue[] = ['fr', 'en', 'pl'];

/** La langue de l'interface, posée dans `users.preferences` dès qu'elle diffère
 *  de ce que brokkr sait — c'est ainsi que le push parle la langue de l'athlète
 *  (FRE-228). Le choix reste local (`i18n`, localStorage) : brokkr n'est pas
 *  consulté pour afficher, seulement prévenu. Le dernier appareil a raison. */
export function useLangueServie(): void {
  const { i18n } = useTranslation();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const { mutate } = useMutation({
    mutationFn: (patch: PreferencesPatch) =>
      isFirebaseConfigured ? api.patch<Preferences, PreferencesPatch>('/users/me/preferences', patch)
                           : mockResolve<Preferences>({ langue: patch.langue }),
    onSuccess: (preferences) => {
      qc.setQueryData<Me>(['me'], (ancien) => ancien ? { ...ancien, preferences: { ...ancien.preferences, ...preferences } } : ancien);
    },
  });
  const courante = i18n.resolvedLanguage;
  const servie = me?.preferences?.langue ?? null;
  useEffect(() => {
    if (!me || !courante || !(LANGUES as readonly string[]).includes(courante) || courante === servie) return;
    mutate({ langue: courante as Langue });
  }, [me, courante, servie, mutate]);
}
