/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

export interface PersistentStateOptions<T> {
  /** Convert a value to the string stored in localStorage. Defaults to JSON.stringify. */
  serialize?: (value: T) => string;
  /** Convert a raw localStorage string back into a value. Defaults to JSON.parse. */
  deserialize?: (raw: string) => T;
  /**
   * When true, a falsy value (null/undefined/empty string/false) removes the
   * key from localStorage instead of writing it. Matches the historical
   * behavior of state like `simulatedRole`, which is cleared rather than
   * persisted as "null".
   */
  removeWhenFalsy?: boolean;
}

/**
 * Drop-in replacement for the `useState(() => { read localStorage })` +
 * `useEffect(() => { write localStorage }, [value])` pair that used to be
 * hand-written once per piece of persisted state in App.tsx (13 copies).
 *
 * Behavior is preserved exactly for each call site: pass the same
 * localStorage key, the same lazy initial-value function (including any
 * fallback/merge logic that used to run after `JSON.parse`), and the read
 * errors are swallowed silently just like the original `try { } catch (_) {}`
 * blocks.
 *
 * This is also the seam Phase 4 (database integration) will replace: swapping
 * the localStorage read/write below for a Data Access Layer call will not
 * require touching any of the ~10 call sites that use this hook.
 */
export function usePersistentState<T>(
  key: string,
  initialValue: T | (() => T),
  options: PersistentStateOptions<T> = {}
): [T, Dispatch<SetStateAction<T>>] {
  const deserialize = options.deserialize ?? ((raw: string) => JSON.parse(raw) as T);
  const serialize = options.serialize ?? ((value: T) => JSON.stringify(value));

  const [state, setState] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) {
        return deserialize(saved);
      }
    } catch (_) {
      // Ignore read errors (storage disabled, corrupt value, etc.) and fall
      // back to the initial value, same as every hand-written call site did.
    }
    return typeof initialValue === "function" ? (initialValue as () => T)() : initialValue;
  });

  useEffect(() => {
    try {
      if (options.removeWhenFalsy && !state) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, serialize(state));
      }
    } catch (_) {
      // Ignore write errors (quota exceeded, private browsing, etc.)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, state]);

  return [state, setState];
}
