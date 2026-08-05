/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { FileSpreadsheet, Plus, X, Download } from "lucide-react";
import { CustomSelect } from "../components/CustomSelect";
import { PrimaryCtaButton } from "../components/PrimaryCtaButton";
import { ClippedButton } from "../components/ClippedButton";
import { INSURER_LOGOS } from "../constants/insurerLogos";
import {
  PLANS,
  resolvePlan,
  simulate,
  formatINR,
  usableRestoration,
  totalOf,
  type ResolvedPlan,
  type YearResult,
  type ClaimResult,
  type AddonKey,
} from "../coverageProjectionEngine";

// Ditto's brand logo, ported verbatim (base64 PNG) from the standalone
// Coverage Projection Studio's brand-footer markup.
const DITTO_LOGO_DATA_URI =
  "data:image/png;base64,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";

interface CoverageProjectionStudioPageProps {
  theme: "light" | "dark";
}

const LAKH = 100_000;

// Preset values are in Lakhs directly, matching the Sum Insured input's units.
const SI_PRESETS: [string, number][] = [
  ["5L", 5],
  ["7L", 7],
  ["10L", 10],
  ["15L", 15],
  ["20L", 20],
  ["25L", 25],
  ["50L", 50],
  ["1Cr", 100],
];

// Plain-language legend copy, keyed by plan id — sourced from the same
// policy-rules reference used by the standalone Coverage Projection Studio.
const LEGEND_COPY: Record<
  string,
  { bonus?: string; restoration?: string; secureBenefit?: string; addons?: Record<string, string> }
> = {
  hdfc_secure: {
    bonus: "Provides a 50% bonus on the Base SI every renewal, up to a maximum of 100% of the Base SI.",
    restoration:
      "100% restoration on partial exhaustion for any illness, available once per policy year (upgradeable to Unlimited with the Unlimited Restore Rider). A single claim cannot exceed the Base SI + Secure Benefit (e.g., ₹20L for a ₹10L SI).",
    secureBenefit: "2× coverage from Day 1.",
  },
  hdfc_secure_plus: {
    bonus: "Provides a 100% bonus on the Base SI every renewal with unlimited accumulation.",
    restoration: "100% restoration on partial exhaustion for any illness, available unlimited number of times.",
    secureBenefit: "2× coverage from Day 1.",
  },
  hdfc_super_secure: {
    bonus: "Provides a 50% bonus on the Base SI every renewal, up to a maximum of 100% of the Base SI.",
    restoration:
      "100% restoration on partial exhaustion for any illness, available once per policy year (upgradeable to Unlimited with the Unlimited Restore Rider). A single claim cannot exceed the Base SI + Secure Benefit (e.g., ₹20L for a ₹10L SI).",
    secureBenefit: "3× coverage from Day 1.",
  },
  care_supreme: {
    bonus: "Provides a 50% bonus on the Base SI every renewal, up to 100%.",
    restoration:
      "100% restoration on partial exhaustion for any illness, available unlimited number of times. A single claim cannot exceed the Base SI.",
    addons: {
      cbs: "Provides a 100% bonus every renewal, up to 500%.",
      cbb: "Provides a 100% bonus every renewal with unlimited accumulation.",
    },
  },
  ab_max: {
    bonus: "Provides a 100% bonus on the Base SI every renewal, up to a maximum of 500% (maximum ₹3 crore).",
    restoration:
      "100% restoration on partial exhaustion for any illness, available unlimited from the 2nd claim onwards. Base SI and Reload can be combined in a single claim.",
  },
  ab_nxt: {
    bonus: "Provides a 100% bonus on the Base SI every renewal, up to a maximum of 500% (maximum ₹3 crore).",
    restoration:
      "100% restoration for any illness, available from the 1st claim itself, with unlimited restorations from the 1st claim onwards. Base SI and Reload can be combined in a single claim.",
  },
  nb_bronze: {
    bonus: "Carries forward the unused Base SI every renewal, up to 3× of the Base SI.",
    restoration:
      "100% restoration on partial exhaustion for any illness, available unlimited for life once triggered after the first paid claim.",
  },
  nb_platinum: {
    bonus: "Carries forward the unused Base SI every renewal, up to 5× of the Base SI.",
    restoration:
      "100% restoration on partial exhaustion for any illness, available unlimited for life once triggered after the first paid claim.",
  },
  nb_titanium: {
    bonus: "Carries forward the unused Base SI every renewal, up to 10× of the Base SI.",
    restoration:
      "100% restoration on partial exhaustion for any illness, available unlimited for life once triggered after the first paid claim.",
  },
};

interface CalcCellResult {
  value: string;
  calc: string | null;
}

function calcCell(before: number, after: number): CalcCellResult {
  const used = before - after;
  if (used > 0.001) {
    return { value: formatINR(after), calc: "(" + formatINR(before) + "-" + formatINR(used) + ")" };
  }
  return { value: formatINR(after), calc: null };
}

// Clamps a raw years-input string to a valid 1-20 policy-year count. Kept
// separate from the input's own text state (see yearsText below) so the
// input can go through an empty/in-progress state while typing without the
// controlled value snapping back to "1" mid-keystroke (that snap-back was
// exactly what caused digits to concatenate instead of replace, e.g. typing
// "2" over a cleared field producing "12").
function clampYears(raw: string): number {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(20, n);
}

// Fixed, theme-independent brand palette for the results table/card, so it
// always renders exactly like the original Coverage Projection Studio
// illustration (see Coverage_Projection_Studio.html) regardless of whether
// the surrounding app is in light or dark mode.
const BRAND = {
  navy: "#1f2d3d",
  blue: "#7d8798",
  gray: "#6b7686",
  red: "#c0392b",
  green: "#1a8f5c",
  border: "#e1e5eb",
  frame: "#0d1c3f",
  yearRowBg: "#f8f9fb",
  claimRowBg: "#fffdf5",
  theadBg: "#f0f2f6",
  legendBg: "#f8f9fb",
};

declare global {
  interface Window {
    html2canvas?: (
      element: HTMLElement,
      options?: Record<string, unknown>
    ) => Promise<HTMLCanvasElement>;
  }
}

const HTML2CANVAS_SRC = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
let html2canvasLoadPromise: Promise<void> | null = null;

// Loads html2canvas from CDN exactly once, matching the standalone tool's
// approach (no bundler dependency — the original just tags the script in).
function loadHtml2Canvas(): Promise<void> {
  if (typeof window !== "undefined" && window.html2canvas) return Promise.resolve();
  if (html2canvasLoadPromise) return html2canvasLoadPromise;
  html2canvasLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = HTML2CANVAS_SRC;
    script.onload = () => resolve();
    script.onerror = () => {
      html2canvasLoadPromise = null;
      reject(new Error("Failed to load html2canvas"));
    };
    document.head.appendChild(script);
  });
  return html2canvasLoadPromise;
}

// html2canvas cannot reliably rasterize <img> elements whose src is an
// inline SVG data URI (a general html2canvas limitation affecting every
// insurer logo). We pre-rasterize the SVG to a PNG data URI using the
// browser's own SVG rendering, swap it in just before capture, then restore
// the original SVG src afterward — ported verbatim from the standalone tool.
function svgDataUriToPngDataUri(svgDataUri: string, cssWidth: number, cssHeight: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = 4;
      const w = Math.max(1, Math.round((cssWidth || img.naturalWidth || 100) * scale));
      const h = Math.max(1, Math.round((cssHeight || img.naturalHeight || 100) * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("no 2d context"));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      try {
        resolve(canvas.toDataURL("image/png"));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error("failed to load svg"));
    img.src = svgDataUri;
  });
}

function downloadImageBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "bonus-restoration-table.png";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Coverage Projection Studio — illustrates Base Cover, Bonus, Restoration and
 * Secure Benefit projections across policy years for the plans below, so an
 * advisor can show a customer exactly how much is available before, during,
 * and after a claim. Ported from the standalone Coverage Projection Studio
 * tool (validated against all 7 supported insurers' reference illustration
 * sheets — 48/48 scenarios, 70/70 unit tests passing) — see
 * ../coverageProjectionEngine.ts for the calculation engine itself, which is
 * an unmodified logic port of that validated source.
 *
 * Full parity with the standalone tool, including the branded results card
 * (insurer logo, ditto footer) and the "Copy Table" html2canvas export.
 */
export function CoverageProjectionStudioPage({ theme }: CoverageProjectionStudioPageProps) {
  const dark = theme === "dark";

  const captureAreaRef = useRef<HTMLDivElement>(null);
  const logoImgRef = useRef<HTMLImageElement>(null);
  const resultsSectionRef = useRef<HTMLDivElement>(null);
  const [copyStatus, setCopyStatus] = useState<string>("");
  const [copyError, setCopyError] = useState(false);

  const [planId, setPlanId] = useState<string>("hdfc_secure");
  const [careAddon, setCareAddon] = useState<AddonKey>("cbs");
  const [nxtAddonOn, setNxtAddonOn] = useState(true);
  const [showSecure, setShowSecure] = useState(true);
  const [showBonus, setShowBonus] = useState(true);
  const [showRestoration, setShowRestoration] = useState(true);
  const [riderOn, setRiderOn] = useState(true);
  const [siLakhs, setSiLakhs] = useState<number>(10);
  const [yearsText, setYearsText] = useState<string>("5");
  const years = clampYears(yearsText);
  const [claimsByYear, setClaimsByYear] = useState<Record<number, number[]>>({});
  const [claimInputs, setClaimInputs] = useState<Record<number, string>>({});
  const [results, setResults] = useState<{ plan: ResolvedPlan; si: number; years: YearResult[] } | null>(null);

  const basePlan = useMemo(() => PLANS.find((p) => p.id === planId)!, [planId]);

  const planOptions = useMemo(
    () => PLANS.map((p) => ({ value: p.id, label: p.name })),
    []
  );

  function handlePlanChange(id: string) {
    setPlanId(id);
    const base = PLANS.find((p) => p.id === id)!;
    if (base.addonOptions) setCareAddon(base.defaultAddon || "cbs");
    setNxtAddonOn(true);
    setShowSecure(true);
    setShowBonus(true);
    setShowRestoration(true);
    setRiderOn(!!base.riderAvailable);
    setResults(null);
  }

  function addClaim(year: number) {
    const raw = claimInputs[year];
    const val = parseFloat(raw);
    if (!val || val <= 0) return;
    setClaimsByYear((prev) => {
      const next = { ...prev };
      next[year] = [...(next[year] || []), val * LAKH];
      return next;
    });
    setClaimInputs((prev) => ({ ...prev, [year]: "" }));
  }

  function removeClaim(year: number, idx: number) {
    setClaimsByYear((prev) => {
      const next = { ...prev };
      next[year] = (next[year] || []).filter((_, i) => i !== idx);
      return next;
    });
  }

  // Mirrors the standalone tool's getSelectedPlan(): resolves the base plan
  // family + Care Supreme add-on choice, then applies the "show X in
  // isolation" teaching toggles on top.
  function getSelectedPlan(): ResolvedPlan {
    let plan: ResolvedPlan = basePlan.addonOptions
      ? resolvePlan(basePlan.id, { addon: careAddon })!
      : resolvePlan(basePlan.id, {})!;

    if (plan.id === "ab_nxt" && !nxtAddonOn) {
      // Super Credit is an optional add-on on Activ One NXT -- without it,
      // the plan is just Base SI + Super Reload restoration.
      plan = { ...plan, bonusTracks: [] };
    }
    if (plan.multiplier && !showSecure) {
      plan = { ...plan, multiplier: null };
    }
    if (!showBonus) {
      plan = { ...plan, bonusTracks: [] };
    }
    if (!showRestoration) {
      plan = { ...plan, restorationDisabled: true };
    }
    return plan;
  }

  function runSimulation() {
    const plan = getSelectedPlan();
    const SI = (siLakhs || 0) * LAKH;
    const options = plan.riderAvailable && riderOn ? { reloadPerClaim: true } : undefined;
    const r = simulate(plan, SI, years, claimsByYear, options);
    setResults({ plan, si: SI, years: r });
  }

  function showCopyStatus(msg: string, isError: boolean) {
    setCopyStatus(msg);
    setCopyError(isError);
    if (msg) {
      window.setTimeout(() => {
        setCopyStatus((current) => (current === msg ? "" : current));
      }, 4000);
    }
  }

  // Captures the branded frame (insurer logo, plan header, table, legend,
  // ditto footer) as a PNG blob — ported from the standalone tool's
  // copyTableAsImage(), including the SVG-logo rasterization workaround.
  // Shared by both the "Copy Table" and "Download" buttons below.
  async function captureTableImage(): Promise<Blob | null> {
    const target = captureAreaRef.current;
    if (!target) return null;

    try {
      await loadHtml2Canvas();
    } catch {
      showCopyStatus("Could not load the image renderer — check your internet connection and try again.", true);
      return null;
    }
    const html2canvas = window.html2canvas;
    if (!html2canvas) {
      showCopyStatus("Could not load the image renderer — check your internet connection and try again.", true);
      return null;
    }

    const logoEl = logoImgRef.current;
    const isSvgLogo = !!(logoEl && logoEl.src && logoEl.src.indexOf("data:image/svg+xml") === 0);
    const originalLogoSrc = isSvgLogo ? logoEl!.src : null;

    if (isSvgLogo && logoEl) {
      try {
        const pngUri = await svgDataUriToPngDataUri(originalLogoSrc!, logoEl.clientWidth, logoEl.clientHeight);
        logoEl.src = pngUri;
        if (logoEl.decode) await logoEl.decode().catch(() => {});
      } catch {
        // Rasterizing failed — fall back to capturing the original SVG src.
      }
    }

    const restoreLogo = () => {
      if (originalLogoSrc && logoEl) logoEl.src = originalLogoSrc;
    };

    try {
      const canvas = await html2canvas(target, { backgroundColor: "#0d1c3f", scale: 3 });
      restoreLogo();
      return await new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
    } catch {
      restoreLogo();
      return null;
    }
  }

  async function copyTableAsImage() {
    showCopyStatus("Generating image…", false);
    const blob = await captureTableImage();
    if (!blob) {
      showCopyStatus("Could not generate the image.", true);
      return;
    }
    if (navigator.clipboard && window.ClipboardItem) {
      navigator.clipboard
        .write([new window.ClipboardItem({ "image/png": blob })])
        .then(() => showCopyStatus("Table copied to clipboard — paste it into a chat or email.", false))
        .catch(() => {
          downloadImageBlob(blob);
          showCopyStatus("Clipboard copy is not available here — downloaded the image instead.", false);
        });
    } else {
      downloadImageBlob(blob);
      showCopyStatus("Clipboard copy is not available here — downloaded the image instead.", false);
    }
  }

  async function downloadTableAsImage() {
    showCopyStatus("Generating image…", false);
    const blob = await captureTableImage();
    if (!blob) {
      showCopyStatus("Could not generate the image.", true);
      return;
    }
    downloadImageBlob(blob);
    showCopyStatus("Image downloaded.", false);
  }

  const legend = results ? buildLegend(results.plan) : [];

  // Small track+knob toggle for the Plan Configuration options below — same
  // mechanic (role="switch", aria-checked, sliding knob) as the Developer
  // Controls visibility switch, but neutral blue/gray coloring instead of
  // that switch's rose/emerald danger-vs-safe pairing, since these are plain
  // feature toggles (include this benefit in the projection or don't), not
  // a binary with a "bad" state.
  // Smaller than the app's standard 44x24 switch (see OwnerControlsPage's
  // Page Visibility toggle) — this one sits nested under a narrow Plan
  // dropdown column, several to a row, so the standard size read as
  // oversized/"popping out" against that compact context. This is a
  // one-off, local-only sizing (not a shared component), so shrinking it
  // here doesn't affect the app-wide switch pattern used elsewhere.
  const renderToggle = (checked: boolean, onChange: (next: boolean) => void, label: string, key: string) => (
    <label key={key} className="flex items-center gap-1.5 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-8 rounded-full border transition-colors cursor-pointer shrink-0 ${
          checked
            ? dark ? "bg-blue-500/30 border-blue-500/50" : "bg-blue-100 border-blue-300"
            : dark ? "bg-white/5 border-white/10" : "bg-stone-100 border-stone-250"
        }`}
        style={{ height: "18px" }}
      >
        <span
          className={`absolute top-1/2 -translate-y-1/2 rounded-full transition-all duration-200 shadow-sm ${
            checked ? "left-[16px]" : "left-0.5"
          } ${checked ? (dark ? "bg-blue-400" : "bg-blue-600") : dark ? "bg-slate-400" : "bg-stone-400"}`}
          style={{ width: "14px", height: "14px" }}
        />
      </button>
      <span className={`text-[11px] font-semibold ${dark ? "text-slate-200" : "text-stone-700"}`}>{label}</span>
    </label>
  );

  // After a successful Generate, the results table can render well below the
  // fold (especially with several claim rows configured) — auto-scroll it
  // into view so the advisor doesn't have to hunt for it. Runs once the DOM
  // has the new results section, not on every render.
  useEffect(() => {
    if (results) {
      resultsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [results]);

  return (
    <>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-3 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h1
            className={`text-page-title tracking-tight flex items-center gap-2 ${
              dark ? "text-white" : "text-[#111827]"
            }`}
          >
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: dark ? "#00D3F3" : "#4673a9" }} />
            <span>Coverage Projection Studio</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            Illustrate Base Cover, Bonus, and Restoration Benefit projections across policy years for supported plans.
          </p>
        </div>
      </div>

      <div className="space-y-5 pb-6">
        {/* PLAN CONFIGURATION — Plan / Sum Insured / Projection Years now
            share one row in a single full-width card (previously Sum
            Insured + Years lived in their own narrow card paired next to
            Claim Scenarios); the boolean options below render as toggle
            switches instead of checkboxes, reusing the Developer Controls
            switch mechanic. Claim Scenarios (below) is its own full-width
            card again instead of being squeezed into the remaining 8/12
            columns. */}
        <section
          className={`rounded-2xl border p-5 space-y-4 ${
            dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-surface-elevated border-[var(--border-strong)] shadow-card"
          }`}
        >
          <h2 className={`text-xs font-black uppercase tracking-wider flex items-center gap-2 ${dark ? "text-slate-200" : "text-stone-800"}`}>
            {/* Was `dark ? "var(--accent)" : "#00D3F3"` — backwards: that put
                dark theme's own cyan accent into the LIGHT branch, so the
                icon rendered neon-cyan against a light card. Matches the
                page-title accent bar above (line ~479) now. */}
            <FileSpreadsheet className="w-4 h-4" style={{ color: dark ? "#00D3F3" : "#4673a9" }} />
            Plan Configuration
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
            <div>
              <label className={`block text-[11px] font-bold mb-1.5 ${dark ? "text-slate-300" : "text-stone-600"}`}>Plan</label>
              <CustomSelect
                value={planId}
                onChange={handlePlanChange}
                options={planOptions}
                theme={theme}
                triggerClassName={`w-full flex items-center justify-between gap-2 pl-2.5 pr-8 py-1.5 rounded-lg border outline-none font-semibold text-xs transition-all cursor-pointer font-sans shadow-sm relative ${
                  dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
                }`}
              />

              {/* Toggle options sit directly under the Plan field instead of
                  spanning full-width below the whole row (Plan's dropdown
                  was by far the shortest column here). Wrapping instead of
                  one-per-line stacking, so 2+ short toggles share a row and
                  the card doesn't grow taller than it needs to. */}
              <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-2.5">
                {basePlan.riderAvailable && renderToggle(riderOn, setRiderOn, "Unlimited Restore Rider", "rider")}
                {basePlan.id === "ab_nxt" && renderToggle(nxtAddonOn, setNxtAddonOn, "Include Super Credit add-on", "nxt")}
                {basePlan.multiplier && renderToggle(showSecure, setShowSecure, "Secure Benefit", "secure")}
                {renderToggle(showBonus, setShowBonus, "Bonus", "bonus")}
                {renderToggle(showRestoration, setShowRestoration, "Restoration", "restoration")}
              </div>
            </div>

            <div>
              <label className={`block text-[11px] font-bold mb-1.5 ${dark ? "text-slate-300" : "text-stone-600"}`}>
                Sum Insured (in Lakhs)
              </label>
              <input
                type="number"
                min={0}
                step={0.1}
                value={siLakhs}
                onChange={(e) => {
                  setSiLakhs(parseFloat(e.target.value) || 0);
                  setResults(null);
                }}
                className={`w-full px-3 py-1.5 rounded-lg border outline-none font-semibold text-xs ${
                  dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
                }`}
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {SI_PRESETS.map(([label, val]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      setSiLakhs(val);
                      setResults(null);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                      siLakhs === val
                        ? dark
                          ? "bg-blue-600/25 text-blue-300 border border-blue-500/40"
                          : "bg-blue-100 text-blue-700 border border-blue-400"
                        : dark
                          ? "bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10"
                          : "bg-stone-100 text-stone-600 border border-stone-200 hover:bg-stone-200 hover:border-stone-300"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={`block text-[11px] font-bold mb-1.5 ${dark ? "text-slate-300" : "text-stone-600"}`}>
                Projection Years
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={yearsText}
                onChange={(e) => {
                  setYearsText(e.target.value);
                  setResults(null);
                }}
                onBlur={() => setYearsText(String(clampYears(yearsText)))}
                className={`w-full px-3 py-1.5 rounded-lg border outline-none font-semibold text-xs ${
                  dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
                }`}
              />
            </div>
          </div>

          {basePlan.addonOptions && (
            <div>
              <label className={`block text-[11px] font-bold mb-1.5 ${dark ? "text-slate-300" : "text-stone-600"}`}>
                Cumulative Bonus add-on
              </label>
              <div className="flex flex-wrap gap-3 pt-2">
                {(["none", "cbs", "cbb"] as AddonKey[]).map((key) => (
                  <label key={key} className={`flex items-center gap-1.5 text-xs font-semibold cursor-pointer ${dark ? "text-slate-200" : "text-stone-700"}`}>
                    <input type="radio" name="careAddon" checked={careAddon === key} onChange={() => setCareAddon(key)} />
                    {key === "none" ? "None" : key === "cbs" ? "CBS" : "CBB"}
                  </label>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* CLAIM SCENARIOS — full width, its own card. */}
        <section
          className={`rounded-2xl border p-5 space-y-3 mt-7 ${
            dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-surface-elevated border-[var(--border-strong)]"
          }`}
        >
            <h2 className={`text-xs font-black uppercase tracking-wider ${dark ? "text-slate-200" : "text-stone-800"}`}>
              Claim Scenarios
            </h2>
            {/* Mild separator between year rows instead of bare vertical gap
                — divide-y only draws a line *between* rows, so the list
                still starts/ends flush, just with a subtle rule marking
                each year off from the next. */}
            <div className={`divide-y mt-4 ${dark ? "divide-white/[0.06]" : "divide-stone-500"}`}>
              {Array.from({ length: years }, (_, i) => i + 1).map((y) => (
                <div key={y} className={`flex flex-wrap items-center gap-3 py-2 pl-3 pr-1 -mx-1 rounded-lg transition-colors duration-150 ${dark ? "" : "hover:bg-stone-50"}`}>
                  <div className={`text-xs font-bold w-16 shrink-0 ${dark ? "text-slate-300" : "text-stone-600"}`}>Year {y}</div>
                  <div className="flex flex-wrap gap-1.5 flex-1 min-w-[120px]">
                    {(claimsByYear[y] || []).map((amt, idx) => (
                      <span
                        key={idx}
                        className={`inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full text-[11px] font-bold ${
                          dark ? "bg-blue-600/20 text-blue-300 border border-blue-500/30" : "bg-blue-50 text-blue-700 border border-blue-200"
                        }`}
                      >
                        ₹{formatINR(amt)}
                        <button
                          type="button"
                          onClick={() => removeClaim(y, idx)}
                          className="w-4 h-4 rounded-full flex items-center justify-center hover:bg-black/10 cursor-pointer"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      placeholder="In Lakhs"
                      value={claimInputs[y] || ""}
                      onChange={(e) => setClaimInputs((prev) => ({ ...prev, [y]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addClaim(y);
                      }}
                      className={`w-24 px-2.5 py-1.5 rounded-lg border outline-none font-semibold text-[11px] ${
                        dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
                      }`}
                    />
                    {/* App-wide clipped-corner button (see ClippedButton.tsx)
                        instead of a one-off rounded pill, so this matches
                        every other function-performing button in the app —
                        same navy fill as Copy Table / Download above. */}
                    <ClippedButton
                      onClick={() => addClaim(y)}
                      size="sm"
                      title="Add claim"
                      className="h-8 px-3 gap-1.5 text-[11px] font-bold whitespace-nowrap text-white"
                      style={{
                        background: BRAND.navy,
                        boxShadow: dark ? "0 2px 10px rgba(0,0,0,0.45)" : "none",
                      }}
                    >
                      <Plus className="w-3.5 h-3.5 shrink-0" />
                      Add claim
                    </ClippedButton>
                  </div>
                </div>
              ))}
            </div>
        </section>

        <div className={`pt-7 border-t ${dark ? "border-white/[0.08]" : "border-stone-200"}`}>
          <PrimaryCtaButton theme={theme} onClick={runSimulation} className="self-start">
            Generate Illustration
          </PrimaryCtaButton>
        </div>

        {/* RESULTS — deliberately theme-independent: this card always
            renders with the original Coverage Projection Studio's fixed
            navy-frame/white-card look (see BRAND above), regardless of
            whether the rest of the app is in light or dark mode. Full parity
            with the standalone tool: insurer logo, ditto footer, and the
            "Copy Table" image-export button are all present. */}
        {results && (
          <section ref={resultsSectionRef} style={{ scrollMarginTop: 24 }}>
            {/* Results Viewer — the branded illustration below (captureAreaRef)
                used to sit directly on the page, disconnected from its own
                action buttons. This card gives it a dedicated "document
                preview" frame — its own surface, border, and generous padding
                — so the title/actions and the illustration read as one
                grouped unit, like a PDF/Figma export preview rather than a
                floating image. Deliberately spans the full content width
                (matching every other card on this page) while the
                illustration itself keeps its fixed 860px size and native
                aspect ratio, centered inside — see the wrapper further below. */}
            <div
              className={`rounded-2xl border ${
                dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-surface-elevated border-[var(--border-strong)]"
              }`}
              style={{ padding: "32px 28px" }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 14,
                  flexWrap: "wrap",
                  marginBottom: 20,
                }}
              >
                <h2 className={`text-sm font-black uppercase tracking-wider ${dark ? "text-white" : "text-[#111827]"}`}>
                  Year-by-year Results
                </h2>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {/* App-wide clipped-corner button (see ClippedButton.tsx) instead
                      of a one-off pill shape, so this matches every other
                      function-performing button in the app. Brand navy fill is
                      theme-independent (see BRAND above) so it stays inline style;
                      layout/type comes through className like every other call site. */}
                  <ClippedButton
                    onClick={copyTableAsImage}
                    size="md"
                    className="gap-2.5 px-4 py-2.5 text-white"
                    style={{
                      background: BRAND.navy,
                      boxShadow: dark ? "0 2px 10px rgba(0,0,0,0.45)" : "none",
                    }}
                  >
                    <span style={{ width: 18, height: 18, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg viewBox="0 0 24 24" fill="none" width={16} height={16} xmlns="http://www.w3.org/2000/svg">
                        <rect x="8" y="8" width="13" height="13" rx="2.5" stroke="white" strokeWidth="2" />
                        <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" stroke="white" strokeWidth="2" />
                      </svg>
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.03em", textTransform: "uppercase", lineHeight: 1.2, whiteSpace: "nowrap" }}>
                      Copy Table
                    </span>
                  </ClippedButton>

                  {/* Icon-only counterpart to "Copy Table" — same capture,
                      saved to disk instead of the clipboard. */}
                  <ClippedButton
                    onClick={downloadTableAsImage}
                    size="sm"
                    title="Download table as an image file"
                    className="w-10 h-10 text-white"
                    style={{
                      background: BRAND.navy,
                      boxShadow: dark ? "0 2px 10px rgba(0,0,0,0.45)" : "none",
                    }}
                  >
                    <Download className="w-4 h-4" />
                  </ClippedButton>
                </div>
              </div>

              {copyStatus && (
                <span
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 600,
                    color: copyError ? BRAND.red : BRAND.green,
                    marginBottom: 12,
                  }}
                >
                  {copyStatus}
                </span>
              )}

              {/* Illustration frame — centers the fixed-size branded card and
                  gives it a shadow + hairline ring OF ITS OWN (not part of
                  captureAreaRef, so none of this is captured by the "Copy
                  Table"/"Download" export — the exported PNG is byte-for-byte
                  unchanged). This is what makes the navy card read as a
                  distinct, lifted document rather than blending into the
                  viewer's own background, especially in dark theme where
                  both were close to the same navy tone before. */}
              <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}>
                <div
                  style={{
                    borderRadius: 16,
                    boxShadow: dark
                      ? "0 24px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08)"
                      : "0 20px 45px rgba(15,23,42,0.18), 0 0 0 1px rgba(15,23,42,0.06)",
                  }}
                >
                  <div
                    ref={captureAreaRef}
                    style={{
                background: BRAND.frame,
                borderRadius: 16,
                padding: "28px 24px 22px",
                // Fixed width so the branded card always reads as a compact
                // illustration document, not a table stretched edge-to-edge
                // across whatever the page's content width happens to be
                // (that stretch is what was spreading the columns apart).
                // 1040 (up from 860) gives the columns more breathing room
                // once a scenario has several claim rows, without losing the
                // "document preview" feel — the outer results card is much
                // wider (page content width), so this still sits centered
                // with plenty of margin either side.
                maxWidth: 1040,
                marginLeft: "auto",
                marginRight: "auto",
              }}
            >
              <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 14px 34px rgba(0,0,0,0.28)", overflow: "hidden" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 14,
                    flexWrap: "wrap",
                    padding: "16px 20px",
                    borderBottom: `1px solid ${BRAND.border}`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    {results.plan.insurer && INSURER_LOGOS[results.plan.insurer] && (
                      <img
                        ref={logoImgRef}
                        src={INSURER_LOGOS[results.plan.insurer]}
                        alt={results.plan.insurer}
                        style={{ display: "inline-block", height: 30, width: "auto", verticalAlign: "middle" }}
                      />
                    )}
                    <span style={{ fontSize: 16, fontWeight: 700, color: BRAND.navy }}>
                      {results.plan.product || results.plan.name}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.gray, textAlign: "right" }}>
                    {featureSubtitle(results.plan)}
                  </div>
                </div>

                <div style={{ padding: "0 20px", overflowX: "auto" }}>
                  <ResultsTable plan={results.plan} si={results.si} years={results.years} />
                </div>

                {legend.length > 0 && (
                  <div
                    style={{
                      margin: "14px 20px 18px",
                      padding: "10px 16px",
                      background: BRAND.legendBg,
                      border: `1px solid ${BRAND.border}`,
                      borderRadius: 8,
                      fontSize: 10,
                      color: BRAND.gray,
                      lineHeight: 1.55,
                    }}
                  >
                    {legend.map((line, i) => (
                      <span key={i} style={{ display: "block", marginTop: i > 0 ? 5 : 0 }}>
                        <span style={{ fontWeight: 700, color: BRAND.navy }}>{line.key}</span> = {line.value}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  padding: "20px 6px 4px",
                }}
              >
                <span style={{ color: "rgba(255,255,255,0.85)", fontSize: 13 }}>Learn more at joinditto.in</span>
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                  <img
                    src={DITTO_LOGO_DATA_URI}
                    alt="ditto"
                    style={{ height: 24, width: "auto", display: "block" }}
                  />
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>
                    Financial safety is your right!
                  </span>
                </span>
              </div>
            </div>
              </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function featureSubtitle(plan: ResolvedPlan): string {
  const parts: string[] = [];
  if (plan.bonusTracks.length > 0) parts.push("Bonus");
  if (!plan.restorationDisabled) parts.push("Restoration");
  if (!parts.length) return "Working Illustration";
  return "Working Illustration - " + parts.join(" and ");
}

function buildLegend(plan: ResolvedPlan): { key: string; value: string }[] {
  const copy = LEGEND_COPY[plan.id] || {};
  const lines: { key: string; value: string }[] = [];

  if (plan.bonusTracks.length > 0 && plan.bonusTracks[0]) {
    const label = plan.bonusTracks[0].label;
    lines.push({ key: "Bonus", value: copy.bonus ? label + " - " + copy.bonus : label });
  }
  // Care Supreme's CBS/CBB add-on rides alongside the base Cumulative Bonus
  // track (bonusTracks[1]) rather than replacing it, so it gets its own
  // legend line named after the add-on itself.
  if (plan.bonusTracks.length > 1 && plan.bonusTracks[1] && plan.addonKey && copy.addons && copy.addons[plan.addonKey]) {
    lines.push({ key: plan.bonusTracks[1].label, value: copy.addons[plan.addonKey] });
  }
  if (!plan.restorationDisabled && plan.restorationLabel) {
    lines.push({
      key: "Restoration",
      value: copy.restoration ? plan.restorationLabel + " - " + copy.restoration : plan.restorationLabel,
    });
  }
  // Secure Benefit is HDFC ERGO-specific (the extra multiplier column), so
  // only plans with `multiplier` set get this line.
  if (plan.multiplier && copy.secureBenefit) {
    lines.push({ key: "Secure Benefit", value: copy.secureBenefit });
  }
  return lines;
}

// Fixed pixel/color values lifted directly from Coverage_Projection_Studio.html's
// table CSS (thead th / tr.year-header td / tr.claim-row td / .total-cell /
// .cell-value / .cell-calc / .shortfall), reproduced here as inline styles
// so the table is byte-for-byte the same look regardless of the app's theme.
const thStyle: CSSProperties = {
  padding: "8px 10px",
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  background: BRAND.theadBg,
  color: BRAND.navy,
  borderBottom: `1px solid ${BRAND.border}`,
  whiteSpace: "nowrap",
};
const yearTdStyle: CSSProperties = {
  padding: "8px 10px",
  fontSize: 13,
  fontWeight: 700,
  background: BRAND.yearRowBg,
  color: BRAND.navy,
  borderBottom: `1px solid ${BRAND.border}`,
  textAlign: "right",
  whiteSpace: "nowrap",
};
const claimTdStyle: CSSProperties = {
  padding: "8px 10px",
  fontSize: 13,
  background: BRAND.claimRowBg,
  color: BRAND.navy,
  borderBottom: `1px solid ${BRAND.border}`,
  textAlign: "right",
  whiteSpace: "nowrap",
};
const claimLabelStyle: CSSProperties = {
  ...claimTdStyle,
  color: BRAND.gray,
  textAlign: "left",
};
const totalCellExtra: CSSProperties = { color: BRAND.blue };
const calcLineStyle: CSSProperties = { display: "block", fontWeight: 400, fontSize: 11, color: BRAND.gray, marginTop: 2 };
const calcLineWarnStyle: CSSProperties = { ...calcLineStyle, color: BRAND.red, fontWeight: 600 };

function ResultsTable({ plan, si, years }: { plan: ResolvedPlan; si: number; years: YearResult[] }) {
  const cols: string[] = ["Year / Event", "Base Sum"];
  if (plan.multiplier) cols.push(plan.multiplier.label);
  plan.bonusTracks.forEach((t, i) => cols.push(i === 0 ? "Bonus" : t.label));
  if (!plan.restorationDisabled) cols.push("Restoration");
  cols.push("Total usable amount");

  return (
    <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, minWidth: 560 }}>
      <thead>
        <tr>
          {cols.map((c, i) => (
            <th key={c} style={{ ...thStyle, textAlign: i === 0 ? "left" : "right" }}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {years.map((yr) => {
          const openingTotal = totalOf(yr.opening, plan, si);
          let prev = yr.opening;
          return (
            <Fragment key={"year-" + yr.year}>
              <tr>
                <td style={{ ...yearTdStyle, textAlign: "left" }}>Year {yr.year}</td>
                <td style={yearTdStyle}>{formatINR(yr.opening.base)}</td>
                {plan.multiplier && <td style={yearTdStyle}>{formatINR(yr.opening.multiplier)}</td>}
                {yr.opening.bonusTracks.map((v, i) => (
                  <td key={i} style={yearTdStyle}>{formatINR(v)}</td>
                ))}
                {!plan.restorationDisabled && <td style={yearTdStyle}>{formatINR(yr.opening.restoration)}</td>}
                <td style={{ ...yearTdStyle, ...totalCellExtra }}>{"₹" + formatINR(openingTotal)}</td>
              </tr>
              {yr.claims.map((c: ClaimResult, idx: number) => {
                const claimTotal =
                  c.base +
                  (plan.multiplier ? c.multiplier : 0) +
                  c.bonusTracks.reduce((a, b) => a + b, 0) +
                  usableRestoration(c.restoration, c.base, si, plan);
                const baseCell = calcCell(prev.base, c.base);
                const secureCell = plan.multiplier ? calcCell(prev.multiplier, c.multiplier) : null;
                const bonusCells = c.bonusTracks.map((v, i) => calcCell(prev.bonusTracks[i], v));
                let restCell: CalcCellResult | null = null;
                if (!plan.restorationDisabled) {
                  if (c.triggeredThisClaim) {
                    restCell = { value: formatINR(c.restoration), calc: c.restoration > 0 ? "(unlocked for next claim)" : null };
                  } else if (c.usedFromRestoration > 0) {
                    restCell = calcCell(c.restoration + c.usedFromRestoration, c.restoration);
                  } else {
                    restCell = { value: formatINR(c.restoration), calc: null };
                  }
                }
                const row = (
                  <tr key={"y" + yr.year + "c" + idx}>
                    <td style={claimLabelStyle}>Claim {idx + 1} (₹{formatINR(c.amount)})</td>
                    <td style={claimTdStyle}>
                      <span style={{ fontWeight: 700 }}>{baseCell.value}</span>
                      {baseCell.calc && <span style={calcLineStyle}>{baseCell.calc}</span>}
                    </td>
                    {plan.multiplier && secureCell && (
                      <td style={claimTdStyle}>
                        <span style={{ fontWeight: 700 }}>{secureCell.value}</span>
                        {secureCell.calc && <span style={calcLineStyle}>{secureCell.calc}</span>}
                      </td>
                    )}
                    {bonusCells.map((bc, i) => (
                      <td key={i} style={claimTdStyle}>
                        <span style={{ fontWeight: 700 }}>{bc.value}</span>
                        {bc.calc && <span style={calcLineStyle}>{bc.calc}</span>}
                      </td>
                    ))}
                    {!plan.restorationDisabled && restCell && (
                      <td style={claimTdStyle}>
                        <span style={{ fontWeight: 700 }}>{restCell.value}</span>
                        {restCell.calc && <span style={calcLineStyle}>{restCell.calc}</span>}
                      </td>
                    )}
                    <td style={{ ...claimTdStyle, ...totalCellExtra, ...(c.shortfall > 0 ? { color: BRAND.red } : {}) }}>
                      <span style={{ fontWeight: 700 }}>{"₹" + formatINR(claimTotal)}</span>
                      {c.shortfall > 0 && (
                        <span style={calcLineWarnStyle}>{"(shortfall ₹" + formatINR(c.shortfall) + " payable by insured)"}</span>
                      )}
                    </td>
                  </tr>
                );
                prev = { base: c.base, multiplier: c.multiplier, bonusTracks: c.bonusTracks, restoration: c.restoration };
                return row;
              })}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

export default CoverageProjectionStudioPage;
