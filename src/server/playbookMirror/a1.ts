/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** 1 -> "A", 27 -> "AA". */
export function numToColumn(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** "A" -> 1, "AA" -> 27. */
export function columnToNum(col: string): number {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
