import { useState, useEffect, useRef } from 'react';

// Drop-in replacement for useState that persists the value in localStorage.
// On mount, reads the stored value; on every update, writes it back.
//
// Use cases: navigation state (active tab, training session, indices, mode)
// that should survive a page reload — including when iOS/Android evicts the
// tab while the user is in another app and returns to a fresh page.
//
// Notes:
// - Storage failures (quota, private mode) are swallowed silently.
// - The first render uses the persisted value if any; otherwise `initial`.
// - The optional `validate` predicate lets callers reject stale values
//   (e.g. an index that's now out of range for the current data).
export function useLocalStorageState<T>(
  key: string,
  initial: T,
  validate?: (v: T) => boolean,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return initial;
      const parsed = JSON.parse(raw) as T;
      if (validate && !validate(parsed)) return initial;
      return parsed;
    } catch {
      return initial;
    }
  });

  const lastKey = useRef(key);
  const skipNextWrite = useRef(false);
  useEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    skipNextWrite.current = true;
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) {
        setValue(initial);
        return;
      }
      const parsed = JSON.parse(raw) as T;
      setValue(validate && !validate(parsed) ? initial : parsed);
    } catch {
      setValue(initial);
    }
  }, [key, initial, validate]);

  // Avoid the redundant localStorage.setItem on the very first render — the
  // value either came from storage (no-op) or is the default (no need to save
  // until the user actually changes it).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (skipNextWrite.current) {
      skipNextWrite.current = false;
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* quota exceeded or storage disabled — ignore */
    }
  }, [key, value]);

  return [value, setValue];
}
