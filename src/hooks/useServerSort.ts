/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import type { SortDirection, SortState } from "../utils/useSortableData";

/**
 * Server-side counterpart to `useSortableData` (src/utils/useSortableData.ts).
 * Same tri-state click behavior (asc -> desc -> cleared) and the same
 * `{ key, direction }` shape, so it drops straight into the existing
 * `SortableTh` component — but instead of sorting an in-memory array, it
 * just tracks which column/direction the caller should send as
 * `?sortBy=&sortDir=` on its next fetch. The caller re-fetches on every
 * `sort` change (via a `useEffect` dependency).
 */
export function useServerSort(initialSort: SortState | null = null) {
  const [sort, setSort] = useState<SortState | null>(initialSort);

  const toggleSort = (key: string) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, direction: "asc" as SortDirection };
      if (prev.direction === "asc") return { key, direction: "desc" as SortDirection };
      return null;
    });
  };

  return { sort, toggleSort, setSort };
}
