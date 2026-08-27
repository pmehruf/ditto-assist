/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";

/** Live `matchMedia` boolean — SSR-safe (starts `false`, corrects itself on
 * mount) and updates on viewport resize/rotation. Used to switch the Home
 * dashboard between its normal responsive/stacked layout (below `lg`) and
 * the fixed-canvas "poster" composition (see ScaleToFit.tsx) at `lg` and
 * up, rather than trying to make one CSS tree serve both. */
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
