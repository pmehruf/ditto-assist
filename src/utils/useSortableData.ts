/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";

export interface SortState {
  key: string;
  direction: SortDirection;
}

/**
 * Generic click-to-sort behavior for the app's data tables (Audit Log, User
 * Directory, PED Directory, AI Mapping Review, Flagged Responses, My
 * Activity, Specific Illness Ledger). Each table defines its own
 * `comparators` map (one comparator per sortable column, keyed by the same
 * string used as that column's `sortKey`) and gets back the sorted rows plus
 * a `toggleSort(key)` handler to wire up to a clickable header.
 *
 * Tri-state per column, spreadsheet-style: first click sorts ascending,
 * second click reverses to descending, third click clears back to the
 * table's original (usually filter/fetch) order. Clicking a different
 * column always starts that column fresh at ascending.
 */
export function useSortableData<T>(
  data: T[],
  comparators: Record<string, (a: T, b: T) => number>,
  initialSort?: SortState | null
) {
  const [sort, setSort] = useState<SortState | null>(initialSort ?? null);

  const sorted = useMemo(() => {
    if (!sort || !comparators[sort.key]) return data;
    const comparator = comparators[sort.key];
    const copy = [...data].sort(comparator);
    return sort.direction === "desc" ? copy.reverse() : copy;
  }, [data, sort, comparators]);

  const toggleSort = (key: string) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, direction: "asc" };
      if (prev.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  };

  return { sorted, sort, toggleSort };
}

// Shared comparator builders — kept here so every table sorts strings,
// dates, and numbers the same way instead of each file rolling its own.

/** Case-insensitive string compare; blank/missing values always sort last
 * regardless of direction (toggleSort's .reverse() would otherwise flip
 * "no value" to the top on descending, which reads as broken, not sorted). */
export function stringComparator<T>(getValue: (row: T) => string | null | undefined) {
  return (a: T, b: T) => {
    const av = (getValue(a) || "").trim();
    const bv = (getValue(b) || "").trim();
    if (!av && !bv) return 0;
    if (!av) return 1;
    if (!bv) return -1;
    return av.localeCompare(bv, undefined, { sensitivity: "base" });
  };
}

/** Parses each side as a Date; unparseable/missing dates always sort last. */
export function dateComparator<T>(getValue: (row: T) => string | number | Date | null | undefined) {
  return (a: T, b: T) => {
    const av = getValue(a);
    const bv = getValue(b);
    const at = av ? new Date(av).getTime() : NaN;
    const bt = bv ? new Date(bv).getTime() : NaN;
    const aValid = !isNaN(at);
    const bValid = !isNaN(bt);
    if (!aValid && !bValid) return 0;
    if (!aValid) return 1;
    if (!bValid) return -1;
    return at - bt;
  };
}

/** Numeric compare; non-finite/missing values always sort last. */
export function numberComparator<T>(getValue: (row: T) => number | null | undefined) {
  return (a: T, b: T) => {
    const av = getValue(a);
    const bv = getValue(b);
    const aValid = typeof av === "number" && isFinite(av);
    const bValid = typeof bv === "number" && isFinite(bv);
    if (!aValid && !bValid) return 0;
    if (!aValid) return 1;
    if (!bValid) return -1;
    return (av as number) - (bv as number);
  };
}
