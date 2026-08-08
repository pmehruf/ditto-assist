/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared CSV export utility — extracted from the local copy that used to
 * live only in App.tsx (and a second, duplicated copy in
 * AiMappingReview.tsx). Any component can import this directly instead of
 * needing the function threaded down as a prop, which is what previously
 * limited CSV export to just the couple of pages App.tsx happened to pass
 * it into.
 *
 * Same behavior as the original: quotes every field, escapes embedded
 * quotes, stringifies nested objects/arrays, and triggers a browser
 * download via a throwaway object URL.
 */
export function downloadCSV(data: Record<string, unknown>[], filename: string): void {
  if (data.length === 0) return;
  const headers = Object.keys(data[0]);
  const csvContent = [
    headers.join(","),
    ...data.map((row) =>
      headers
        .map((field) => {
          let val = row[field];
          if (typeof val === "object") val = JSON.stringify(val);
          return `"${String(val || "").replace(/"/g, '""')}"`;
        })
        .join(",")
    ),
  ].join("\r\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
