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

/** Turns the category list the server returns into key → label (server order preserved). */
export function categoryLabelsFromEntries(entries: unknown): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const c of Array.isArray(entries) ? entries : []) if (c?.categoryKey) labels[c.categoryKey] = c.label || prettyCategory(c.categoryKey);
  return labels;
}

/**
 * Plan mapping editor helper (moved out of PlanManagementPage unchanged except that the category list is now passed in):
 * any category with no mapping yet defaults to the plan's catch-all question, so the engine never skips a plan for a category.
 * Pairs that already have a mapping are never touched.
 */
export function fillUnmappedCategories(map: Record<string, string>, anyOther: string, categoryKeys: string[]): Record<string, string> {
  if (!anyOther) return map;
  const filled = { ...map };
  categoryKeys.forEach((key) => {
    if (filled[key] === undefined) filled[key] = anyOther;
  });
  return filled;
}

export interface LiveCategories {
  /** key → label, in the server's own order (sort order, then key). */
  labels: Record<string, string>;
  status: "loading" | "ready" | "error";
}

/**
 * The live category list (the `categories` table, via /api/ped-repository/categories — the same source the PED Library,
 * the Categories screen and every other part of Mapping Control use). Read fresh each time a screen opens so a category
 * created a moment ago is there. Nothing is compiled in: while loading or on error the list is empty and says so.
 */
export function useLiveCategories(): LiveCategories {
  const [state, setState] = useState<LiveCategories>({ labels: {}, status: "loading" });
  useEffect(() => {
    let live = true;
    fetch("/api/ped-repository/categories")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => {
        if (!live) return;
        setState({ labels: categoryLabelsFromEntries(j?.entries), status: "ready" });
      })
      .catch(() => live && setState({ labels: {}, status: "error" }));
    return () => {
      live = false;
    };
  }, []);
  return state;
}
