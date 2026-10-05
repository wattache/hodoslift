import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { mockEvents, mockResolve } from '@/api/mock';
import type { CalendarEvent, CalendarEventInput, EventPatch } from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';

const isMock = !isFirebaseConfigured;

/** Id d'event côté client (le contrat PUT est create-or-replace par id). */
function newEventId(): string {
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useEvents(athleteId: string | null | undefined) {
  return useQuery<CalendarEvent[]>({
    queryKey: ['events', athleteId],
    queryFn: () => (isMock ? mockResolve(mockEvents) : api.get<CalendarEvent[]>(`/athletes/${athleteId}/events`)),
    enabled: Boolean(athleteId),
    staleTime: 60_000,
  });
}

export function useUpsertEvent(athleteId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, event }: { id?: string; event: CalendarEventInput }) =>
      isMock
        ? mockResolve({ ok: true, id: id ?? newEventId() })
        : api.put<unknown, CalendarEventInput>(`/athletes/${athleteId}/events/${id ?? newEventId()}`, event),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['events', athleteId] }),
  });
}

export function usePatchEvent(athleteId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CalendarEventInput> }) =>
      isMock ? mockResolve({ ok: true }) : api.patch<unknown, EventPatch>(`/athletes/${athleteId}/events/${id}`, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['events', athleteId] }),
  });
}

export function useDeleteEvent(athleteId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      isMock ? mockResolve({ ok: true }) : api.delete(`/athletes/${athleteId}/events/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['events', athleteId] }),
  });
}
