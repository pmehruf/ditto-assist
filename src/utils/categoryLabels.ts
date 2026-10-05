/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";

/** Category key → admin-facing label, read from the server and cached briefly (so a category created a moment ago shows up). */
let cache: { at: number; map: Map<string, string> } | null = null;
let pending: Promise<Map<string, string>> | null = null;
const TTL_MS = 60_000;

export const prettyCategory = (key: string) => key.replace(/_/g, " ");

async function load(): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  pending ??= fetch("/api/ped-repository/categories")
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const map = new Map<string, string>();
      for (const c of Array.isArray(j?.entries) ? j.entries : []) if (c?.categoryKey) map.set(c.categoryKey, c.label || prettyCategory(c.categoryKey));
      cache = { at: Date.now(), map };
      return map;
    })
    .catch(() => new Map<string, string>())
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Returns a function turning a category key into its label (falling back to a readable version of the key). */
export function useCategoryLabels(): (key: string | null | undefined) => string {
  const [map, setMap] = useState<Map<string, string>>(cache?.map ?? new Map());
  useEffect(() => {
    let live = true;
    void load().then((m) => live && setMap(m));
    return () => {
      live = false;
    };
  }, []);
  return (key) => (key ? map.get(key) ?? prettyCategory(key) : "none");
}
