/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";

/**
 * Returns `value`, but only updates after it has stopped changing for
 * `delayMs`. Used by every server-paginated table's search box so typing
 * doesn't fire a request per keystroke — the request only goes out once the
 * user pauses. Defaults to 350ms, a common sweet spot between "feels
 * instant" and "doesn't spam the server".
 */
export function useDebouncedValue<T>(value: T, delayMs: number = 350): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
