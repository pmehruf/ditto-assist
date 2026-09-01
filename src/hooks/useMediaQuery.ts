/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";

/** Live `matchMedia` boolean — SSR-safe (starts `false`, corrects itself on
 * mount) and updates on viewport resize/rotation. Used to switch the Home
 * dashboard between its stacked single-column layout (below `lg`) and its
 * two-column grid (at `lg` and up, see LookupIntroPage.tsx) — and to gate
 * that page's `leftColRef` height-matching effect so it only applies at
 * the same breakpoint the columns actually sit side by side. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => (typeof window !== "undefined" ? window.matchMedia(query).matches : false));

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export default useMediaQuery;
