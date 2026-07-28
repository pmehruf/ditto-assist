/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReactNode } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import type { SortDirection } from "../utils/useSortableData";

/**
 * A clickable `<th>` for the app's sortable data tables — pairs with
 * useSortableData (src/utils/useSortableData.ts). Renders the column label
 * plus a chevron that shows the active sort direction, or a faint neutral
 * icon when this column isn't the active sort. Takes the SAME `className`
 * every table already puts on its plain `<th>` elements, so dropping this in
 * doesn't change a table's header styling — only adds the click affordance.
 */
export function SortableTh({
  label,
  sortKey,
  activeSort,
  onSort,
  className,
  align = "left",
}: {
  label: ReactNode;
  sortKey: string;
  activeSort: { key: string; direction: SortDirection } | null;
  onSort: (key: string) => void;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  const isActive = activeSort?.key === sortKey;
  const direction = isActive ? activeSort.direction : null;

  return (
    <th className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={isActive ? `Sorted ${direction === "asc" ? "ascending" : "descending"} — click to ${direction === "asc" ? "reverse" : "clear"}` : `Sort by ${typeof label === "string" ? label : "this column"}`}
        className={`inline-flex items-center gap-1 cursor-pointer select-none bg-transparent border-0 p-0 font-inherit text-inherit uppercase tracking-inherit hover:opacity-70 transition-opacity ${
          align === "right" ? "flex-row-reverse" : align === "center" ? "justify-center w-full" : ""
        }`}
      >
        <span>{label}</span>
        {direction === "asc" ? (
          <ChevronUp className="w-3 h-3 shrink-0" />
        ) : direction === "desc" ? (
          <ChevronDown className="w-3 h-3 shrink-0" />
        ) : (
          <ChevronsUpDown className="w-3 h-3 shrink-0 opacity-30" />
        )}
      </button>
    </th>
  );
}
