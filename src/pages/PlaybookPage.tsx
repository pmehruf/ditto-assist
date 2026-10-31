/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PRODUCT PLAYBOOK — advisor tool (2026-10). Read-only view of the Product
 * Playbook sheet's VISIBLE content, from the latest verified snapshot.
 *  - "Compare plans": pick up to 4 plans and, optionally, categories. Every
 *    cell is shown exactly as in the sheet (formatting, links, line breaks),
 *    in full, with its note always visible.
 *  - "Recommendation specifics": the tab as a grid.
 * Rows/columns hidden in the sheet are never shown (the server never sends them).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BookOpen, X } from "lucide-react";
import { CheckPlaybook, PlaybookGrid, Runs, type GridCell, type PlaybookGridData } from "../components/PlaybookGrid";
import { CustomSelect } from "../components/CustomSelect";
import { PlaybookSearch } from "../components/PlaybookSearch";

interface Props {
  theme: "light" | "dark";
}

interface Meta {
  published: boolean;
  snapshotId: number | null;
  playbookAsOf: string | null;
  stale: boolean | null;
  plans: { planKey: string; insurer: string; displayName: string; header: string }[];
  features: { featureKey: string; subKey: string; label: string; subLabel: string | null }[];
}
interface ReadCell {
  planKey: string;
  featureKey: string;
  subKey: string;
  a1: string;
  readFrom: string;
  isEmpty: boolean;
  rawText: string | null;
  numberRaw: string | null;
  formattedValue: string | null;
  resolvedRuns: GridCell["resolvedRuns"];
  note: string | null;
  warning: string | null;
}

const MAX_PLANS = 4;
const SPECIFICS_TAB = "Recommendation specifics";
const firstLine = (t: string) => t.replace(/\r\n|\r/g, "\n").split("\n")[0];
const display = (t: string) => t.replace(/\r\n|\r/g, "\n");
// Dropdown options are one line, so the header's line breaks become spaces there (the table shows it exactly).
const oneLine = (t: string) => t.replace(/\s*(\r\n|\r|\n)\s*/g, " ").trim();
// "9:28 PM, 30 Oct 2026"
const syncedAt = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}, ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
};

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (HTTP ${res.status}).`);
  return body as T;
}

export function PlaybookPage({ theme }: Props) {
  const dark = theme === "dark";
  const [view, setView] = useState<"compare" | "specifics">("compare");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlans, setSelectedPlans] = useState<string[]>([]);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [cells, setCells] = useState<ReadCell[] | null>(null);
  const [specifics, setSpecifics] = useState<PlaybookGridData | null>(null);
  const [loading, setLoading] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const loadMeta = useCallback(async () => {
    try {
      setMeta(await get<Meta>("/api/playbook-mirror/read/meta"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  // Load once when the page opens (async fetch; state is set after the request resolves).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadMeta(); }, [loadMeta]);

  // Categories (one chip per feature, sub-rows belong to it).
  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const f of meta?.features ?? []) if (!seen.has(f.featureKey)) seen.set(f.featureKey, firstLine(f.label));
    return [...seen.entries()].map(([key, label]) => ({ key, label }));
  }, [meta]);

  const loadCells = useCallback(async (plans: string[], features: string[]) => {
    if (plans.length === 0) {
      setCells(null);
      return;
    }
    setLoading(true);
    try {
      const q = `plans=${encodeURIComponent(plans.join(","))}${features.length ? `&features=${encodeURIComponent(features.join(","))}` : ""}`;
      const r = await get<{ cells: ReadCell[] }>(`/api/playbook-mirror/read/cells?${q}`);
      setCells(r.cells);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const togglePlan = (key: string) => {
    const next = selectedPlans.includes(key) ? selectedPlans.filter((k) => k !== key) : selectedPlans.length >= MAX_PLANS ? selectedPlans : [...selectedPlans, key];
    setSelectedPlans(next);
    void loadCells(next, selectedFeatures);
  };
  const toggleFeature = (key: string) => {
    const next = selectedFeatures.includes(key) ? selectedFeatures.filter((k) => k !== key) : [...selectedFeatures, key];
    setSelectedFeatures(next);
    void loadCells(selectedPlans, next);
  };

  const openSpecifics = async () => {
    setView("specifics");
    if (specifics) return;
    try {
      setSpecifics(await get<PlaybookGridData>(`/api/playbook-mirror/read/grid?tab=${encodeURIComponent(SPECIFICS_TAB)}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Rows of the comparison: each (category, sub-row) in sheet order; one cell per plan
  // (a value merged over several sheet rows is shown once).
  const rows = useMemo(() => {
    if (!meta || !cells) return [];
    const wanted = selectedFeatures.length ? meta.features.filter((f) => selectedFeatures.includes(f.featureKey)) : meta.features;
    return wanted.map((f) => ({
      feature: f,
      byPlan: selectedPlans.map((p) => {
        const list = cells.filter((c) => c.planKey === p && c.featureKey === f.featureKey && c.subKey === f.subKey);
        return list.filter((c, i) => list.findIndex((x) => x.readFrom === c.readFrom) === i);
      }),
    }));
  }, [meta, cells, selectedPlans, selectedFeatures]);

  const planByKey = new Map<string, Meta["plans"][number]>((meta?.plans ?? []).map((p) => [p.planKey, p]));
  const categoryLabel = new Map(categories.map((x) => [x.key, x.label]));

  // Explicit colours per theme (the app's global theme rules restyle stone-* utilities).
  const c = dark
    ? {
        label: "text-[#A9C0DC]",
        trigger: "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]",
        tab: "border-[#1e3e5c] text-[#DCEAFB] hover:bg-[#143B61]",
        tabOn: "bg-[#0891B2] border-[#0891B2] text-white",
        chip: "bg-[#0891B2] text-white",
        colHead: "bg-[#0B2A44] text-[#F5F7FA] border-[#1e3e5c]",
        rowHead: "bg-[#0E3253] text-[#F5F7FA] border-[#1e3e5c]",
        cell: "bg-[#102236] text-[#F5F7FA] border-[#1e3e5c]",
        muted: "text-[#A9C0DC]",
      }
    : {
        label: "text-[#4C5A72]",
        trigger: "bg-white border-[#8A9BB0] text-[#1E293B]",
        tab: "bg-white border-[#8A9BB0] text-[#1E293B] hover:bg-[#E1EAF7]",
        tabOn: "bg-[#0754B7] border-[#0754B7] text-white",
        chip: "bg-[#0754B7] text-white",
        colHead: "bg-[#0754B7] text-white border-[#B8C4D4]",
        rowHead: "bg-[#C9DAF0] text-[#0F1E33] border-[#B8C4D4]",
        cell: "bg-white text-[#1E293B] border-[#B8C4D4]",
        muted: "text-[#4C5A72]",
      };
  const triggerClass = `w-full flex items-center justify-between gap-2 pl-2.5 pr-8 py-1.5 rounded-lg border outline-none font-semibold text-xs cursor-pointer shadow-sm relative disabled:opacity-60 disabled:cursor-not-allowed ${c.trigger}`;

  const planOptions = (meta?.plans ?? []).filter((p) => !selectedPlans.includes(p.planKey)).map((p) => ({ value: p.planKey, label: oneLine(p.header) }));
  const categoryOptions = categories.filter((x) => !selectedFeatures.includes(x.key)).map((x) => ({ value: x.key, label: x.label }));

  const chip = (key: string, label: string, onRemove: () => void) => (
    <span key={key} className={`inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full text-[11px] font-semibold ${c.chip}`}>
      {label}
      <button onClick={onRemove} aria-label={`Remove ${label}`} className="rounded-full p-0.5 hover:bg-black/20"><X className="w-3 h-3" /></button>
    </span>
  );

  // Keyword search over the content shown: below the plan selection (compare) or above the grid (specifics).
  const search = (
    <PlaybookSearch
      target={contentRef}
      theme={theme}
      refreshKey={`${view}|${loading}|${cells?.length ?? 0}|${specifics?.snapshotId ?? 0}|${selectedPlans.join(",")}|${selectedFeatures.join(",")}`}
    />
  );

  return (
    <div className="space-y-4 text-left">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 pb-3 border-b border-line">
        <div>
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5" style={{ color: dark ? "#00D3F3" : "#0754B7" }} />
            <h1 className="text-lg font-bold text-content">Product Playbook</h1>
          </div>
          {meta?.playbookAsOf && <p className={`text-xs mt-1 font-semibold ${c.muted}`}>Last synced on {syncedAt(meta.playbookAsOf)}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => setView("compare")} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${view === "compare" ? c.tabOn : c.tab}`}>Compare plans</button>
          <button onClick={() => void openSpecifics()} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${view === "specifics" ? c.tabOn : c.tab}`}>Recommendation specifics</button>
        </div>
      </div>

      {meta?.stale && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/30 p-2.5 text-xs text-amber-900 dark:text-amber-200">
          <AlertTriangle className="w-4 h-4 shrink-0" /> This copy is more than a day old. It may not include the latest changes to the sheet.
        </div>
      )}
      {error && <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/30 p-3 text-xs text-red-800 dark:text-red-200">{error}</div>}
      {meta && !meta.published && <div className="rounded-lg border border-line p-3 text-xs text-content">The Playbook isn't available yet.</div>}

      {meta?.published && view === "compare" && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${c.label}`}>Plans (up to {MAX_PLANS})</label>
              <CustomSelect
                theme={theme}
                value=""
                onChange={togglePlan}
                placeholder={selectedPlans.length >= MAX_PLANS ? `${MAX_PLANS} plans selected` : "Search and add a plan"}
                options={planOptions}
                searchable
                searchPlaceholder="Search plans…"
                disabled={selectedPlans.length >= MAX_PLANS}
                maxPanelHeightPx={320}
                triggerClassName={triggerClass}
              />
              {selectedPlans.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {selectedPlans.map((k) => chip(k, oneLine(planByKey.get(k)?.header ?? k), () => togglePlan(k)))}
                </div>
              )}
            </div>
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${c.label}`}>Categories (optional — all shown when none is chosen)</label>
              <CustomSelect
                theme={theme}
                value=""
                onChange={toggleFeature}
                placeholder="Search and add a category"
                options={categoryOptions}
                searchable
                searchPlaceholder="Search categories…"
                maxPanelHeightPx={320}
                triggerClassName={triggerClass}
              />
              {selectedFeatures.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {selectedFeatures.map((k) => chip(k, categoryLabel.get(k) ?? k, () => toggleFeature(k)))}
                  <button onClick={() => { setSelectedFeatures([]); void loadCells(selectedPlans, []); }} className={`px-1.5 py-1 text-[11px] underline ${c.muted}`}>Clear all</button>
                </div>
              )}
            </div>
          </div>

          {selectedPlans.length === 0 ? (
            <p className={`text-xs ${c.muted}`}>Choose one or more plans to see their details side by side.</p>
          ) : (
            <>
            {search}
            <div ref={contentRef} className={`overflow-auto max-h-[75vh] border rounded-lg ${c.cell}`}>
              {/* Fixed layout: the feature column has a set width and the plans share the rest equally. */}
              <table className="table-fixed border-separate border-spacing-0 text-xs leading-snug w-full" style={{ minWidth: 200 + selectedPlans.length * 260 }}>
                <colgroup>
                  <col style={{ width: 200 }} />
                  {selectedPlans.map((k) => <col key={k} />)}
                </colgroup>
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className={`sticky left-0 z-20 border-b border-r px-2 py-2 text-left font-bold ${c.colHead}`}>Feature</th>
                    {selectedPlans.map((k) => (
                      <th key={k} className={`border-b border-r px-2 py-2 text-left whitespace-pre-wrap break-words font-bold ${c.colHead}`}>{display(planByKey.get(k)?.header ?? k)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ feature, byPlan }) => (
                    <tr key={`${feature.featureKey}.${feature.subKey}`} className="align-top">
                      <th className={`sticky left-0 z-10 border-b border-r px-2 py-1.5 text-left font-semibold whitespace-pre-wrap ${c.rowHead}`}>
                        {display(feature.label)}
                        {feature.subLabel && <div className={`font-normal ${c.muted}`}>{display(feature.subLabel)}</div>}
                      </th>
                      {byPlan.map((list, i) => (
                        <td key={selectedPlans[i]} className={`border-b border-r px-2 py-1.5 ${c.cell}`}>
                          {list.find((x) => x.warning) && <CheckPlaybook text={list.find((x) => x.warning)!.warning!} />}
                          {list.some((x) => x.warning) && list.every((x) => x.isEmpty) ? null : list.length === 0 || list.every((x) => x.isEmpty) ? (
                            <span className={`italic ${c.muted}`}>Blank in the Playbook</span>
                          ) : (
                            list.map((x) => (
                              <div key={x.readFrom} className="whitespace-pre-wrap break-words">
                                <Runs cell={x as unknown as GridCell} />
                                {x.note && (
                                  <div className="mt-1 border-l-2 border-amber-500 pl-1.5 text-[11px] text-amber-900 dark:text-amber-200 whitespace-pre-wrap">
                                    <span className="font-bold">Note: </span>{display(x.note)}
                                  </div>
                                )}
                              </div>
                            ))
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {loading && <div className={`p-2 text-xs ${c.muted}`}>Loading…</div>}
            </div>
            </>
          )}
        </>
      )}

      {meta?.published && view === "specifics" && (specifics ? <div className="space-y-2">{search}<div ref={contentRef}><PlaybookGrid grid={specifics} theme={theme} /></div></div> : <p className={`text-xs ${c.muted}`}>Loading…</p>)}
    </div>
  );
}
