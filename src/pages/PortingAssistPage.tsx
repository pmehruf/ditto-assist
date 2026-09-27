/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Route,
  Plus,
  Trash2,
  Download,
  CheckCircle2,
  Clock,
  Users,
  User,
  ShieldCheck,
  PiggyBank,
  Stethoscope,
  FileText,
  Calendar,
  Database,
  Gift,
  AlertTriangle,
  ClipboardList,
  Copy,
  type LucideIcon,
} from "lucide-react";
import { CustomSelect, type CustomSelectOption } from "../components/CustomSelect";
import { DateInputDMY } from "../components/DateInputDMY";
import { isoDateToDMY } from "../utils/dateFormat";
import { PrimaryCtaButton } from "../components/PrimaryCtaButton";
import { ClippedButton } from "../components/ClippedButton";
import {
  calculatePortingAssist,
  validatePortingAssistInput,
  formatRupees,
  INITIAL_WAITING_PERIOD_DAYS,
  SPECIFIC_ILLNESS_WAITING_PERIOD_YEARS,
  PED_WAITING_PERIOD_YEARS,
  type PortingAssistInput,
  type PortingAssistResult,
  type MemberInput,
  type MemberResult,
  type PedGroupInput,
  type PedResult,
} from "../portingAssistEngine";

interface PortingAssistPageProps {
  theme: "light" | "dark";
}

// ─── Static config (section 1 / 26 of the product spec) ────────────────────

const PORTING_PLAN_OPTIONS: CustomSelectOption[] = [
  { value: "hdfc_optima_secure", label: "HDFC ERGO Optima Secure" },
  { value: "hdfc_optima_super_secure", label: "HDFC ERGO Optima Super Secure" },
  { value: "hdfc_optima_secure_plus", label: "HDFC ERGO Optima Secure+" },
  { value: "care_supreme", label: "Care Supreme" },
  { value: "other", label: "Other" },
];

// Plan-specific informational notes (section 21/26) — purely informational,
// never silently altering the core waiting-period calculation above, and
// rendered visually secondary to the core calculation in the illustration.
const PLAN_NOTES: Record<string, { title: string; lines: string[] }> = {
  hdfc_optima_secure: {
    title: "HDFC ERGO Optima Secure / Optima Super Secure",
    lines: [
      "Waiting-period credit applies to Base Cover and the first restoration. Secure Benefit and further restorations under Unlimited Restoration may have fresh waiting periods.",
    ],
  },
  hdfc_optima_super_secure: {
    title: "HDFC ERGO Optima Secure / Optima Super Secure",
    lines: [
      "Waiting-period credit applies to Base Cover and the first restoration. Secure Benefit and further restorations under Unlimited Restoration may have fresh waiting periods.",
    ],
  },
  hdfc_optima_secure_plus: {
    title: "HDFC ERGO Optima Secure+",
    lines: [
      "Waiting-period credit applies to eligible ported Base Sum Insured. It does not extend to Secure Benefit or Unlimited Restoration.",
    ],
  },
};

const RELATIONSHIP_OPTIONS: CustomSelectOption[] = [
  "Self",
  "Spouse",
  "Son",
  "Daughter",
  "Father",
  "Mother",
  "Father-in-law",
  "Mother-in-law",
  "Brother",
  "Sister",
  "Uncle",
  "Aunt",
  "Friend",
  "Other",
].map((r) => ({ value: r, label: r }));

// Defensive cap only — the advisor never enters this directly anymore (see
// derivePolicyYears below); it just stops a bad/ancient inception date from
// producing an absurd number of policy years.
const MAX_POLICY_YEARS = 40;

/**
 * The Cover Timeline is the ONE place the advisor enters cover amounts —
 * there is no separate "Current Cover" field anymore (that used to be able
 * to drift out of sync with a later Cover History entry). One row exists
 * per actual policy year (see derivePolicyYears — Year 1 always exists,
 * later years appear automatically as the policy ages), each holding either
 * an explicit amount the advisor typed for that year, or `null` meaning
 * "unchanged from the year before" (see effectiveCoverAmounts). Year 1 has
 * nothing to inherit from, so a `null` there simply reads as ₹0/blank —
 * exactly the "no pre-filled value" the advisor should see on a fresh form.
 */
type CoverYearOverrides = (number | null)[];

function emptyCoverYearOverrides(policyYears: number): CoverYearOverrides {
  return Array.from({ length: Math.max(1, policyYears) }, () => null);
}

/** Resolves the sparse per-year overrides into one concrete amount per
 * policy year: an explicit entry is used as-is, and a blank later year just
 * carries the most recent explicit amount forward (cover doesn't change
 * every year — the advisor only has to touch a row when it actually did).
 * This is also exactly what each row DISPLAYS while the advisor hasn't
 * typed into it yet, so the table always shows real, editable numbers
 * instead of empty cells that look unset. */
function effectiveCoverAmounts(overrides: CoverYearOverrides): number[] {
  const out: number[] = [];
  let last = 0;
  for (const v of overrides) {
    if (v !== null) last = v;
    out.push(last);
  }
  return out;
}

// ─── Draft (form) state shapes — richer than the engine's own input types
// (carry UI-only concerns like "Other" custom text and the inception
// checkbox) and converted into portingAssistEngine's plain input shape only
// at Generate time via buildEngineInput() below. ───────────────────────────

interface PedGroupDraft {
  id: string;
  conditions: string;
  declaredSinceInception: boolean;
  declaredYear: number | null;
}

/** Fixed row count for the declared-PED table — a simple spreadsheet-style
 * grid instead of dynamic add/remove rows. Blank rows are just left unused;
 * they're filtered out at Generate time. */
const PED_TABLE_ROWS = 5;

interface MemberDraft {
  id: string;
  relationship: string;
  customRelationship: string;
  sameAsInception: boolean;
  memberSinceYear: number;
  pedGroups: PedGroupDraft[];
  /** Undeclared PEDs — one single free-text cell (comma-separated), not a
   * row-per-condition list; split into individual conditions only when
   * building the engine input (see buildEngineInput). */
  undeclaredPedsText: string;
}

let idCounter = 0;
function uid(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function emptyPedGroup(): PedGroupDraft {
  return { id: uid("ped"), conditions: "", declaredSinceInception: true, declaredYear: null };
}

function emptyMember(relationship = "Self"): MemberDraft {
  return {
    id: uid("member"),
    relationship,
    customRelationship: "",
    sameAsInception: true,
    memberSinceYear: 1,
    pedGroups: Array.from({ length: PED_TABLE_ROWS }, () => emptyPedGroup()),
    undeclaredPedsText: "",
  };
}

/** Picks a sensible next relationship for "+ Add Member" — Self, then
 * Spouse, then Son for anyone after that (the advisor can change it via the
 * dropdown; duplicates are fine now — see memberTabLabel, which numbers them
 * automatically). */
function nextDefaultRelationship(existing: MemberDraft[]): string {
  const rels = existing.map((m) => m.relationship);
  if (!rels.includes("Self")) return "Self";
  if (!rels.includes("Spouse")) return "Spouse";
  return "Son";
}

function resolveRelationshipLabel(m: MemberDraft): string {
  if (m.relationship === "Other") return m.customRelationship.trim() || "Other";
  return m.relationship;
}

/** The member tab's label — the member's own resolved relationship, not a
 * generic "Member N". When more than one member shares the same resolved
 * relationship (e.g. two Sons), each gets numbered in array order ("Son 1",
 * "Son 2"); a relationship that's unique among the current members shows
 * unsuffixed. */
function memberTabLabel(members: MemberDraft[], index: number): string {
  const label = resolveRelationshipLabel(members[index]);
  const sameLabelIndices = members.reduce<number[]>((acc, m, i) => {
    if (resolveRelationshipLabel(m) === label) acc.push(i);
    return acc;
  }, []);
  if (sameLabelIndices.length <= 1) return label;
  return `${label} ${sameLabelIndices.indexOf(index) + 1}`;
}

/** Purely a display convenience — labels a policy year by the actual
 * renewal-to-renewal date RANGE it covers (e.g. "Year 3 (26-27)" for a
 * 2024-05-23 inception, viewed once Year 3 has started), never a single
 * calendar year on its own. A single year ("Year 3 (2026)") reads as "the
 * 2026 calendar year" and can wrongly look like it hasn't started yet when
 * the current date is still early in that calendar year — a real point of
 * confusion for a porting conversation, which always happens mid-way
 * through the CURRENT (not-yet-renewed) policy year. Never used in any
 * calculation (see portingAssistEngine.ts's module comment: Policy
 * Inception Date never enters a calculation). */
function policyYearLabel(year: number, inceptionDate: string): string {
  const inceptionYear = inceptionDate ? parseInt(inceptionDate.slice(0, 4), 10) : NaN;
  if (!Number.isFinite(inceptionYear)) return `Year ${year}`;
  const startYear = inceptionYear + year - 1;
  const endYear = startYear + 1;
  const yy = (y: number) => String(y).slice(-2);
  return `Year ${year} (${yy(startYear)}-${yy(endYear)})`;
}

/** Derives the CURRENT policy year (1-indexed, renewal-boundary counting —
 * never a mid-year/day-level figure) purely from the Policy Inception Date
 * and today's date, so the advisor never has to enter or maintain a policy-
 * year count by hand. A policy renews on its inception date's calendar
 * anniversary each year; once that anniversary has passed (or fallen today)
 * in the current calendar year, the policy has entered a new policy year. */
function derivePolicyYears(inceptionDate: string): number {
  if (!inceptionDate) return 0;
  const parts = inceptionDate.split("-");
  if (parts.length !== 3) return 0;
  const [y, m, d] = parts.map((p) => parseInt(p, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return 0;
  const inception = new Date(y, m - 1, d);
  if (Number.isNaN(inception.getTime())) return 0;
  const today = new Date();
  let years = today.getFullYear() - inception.getFullYear();
  const hadAnniversaryThisYear =
    today.getMonth() > inception.getMonth() ||
    (today.getMonth() === inception.getMonth() && today.getDate() >= inception.getDate());
  if (!hadAnniversaryThisYear) years -= 1;
  return Math.max(1, years + 1);
}

interface CoverPeriod {
  startYear: number;
  endYear: number;
  amountLakhs: number;
  isCurrent: boolean;
}

/** Compact, human-readable summary of the periods the Cover Timeline
 * produces (e.g. "Year 1-2 (24-26): ₹10L, Year 3 (26-27): ₹15L, current") —
 * groups consecutive years that share the same effective amount so a long
 * flat history doesn't repeat itself row by row. Never used for the actual
 * calculation, purely a compact readout under the table. */
function summarizeCoverPeriods(overrides: CoverYearOverrides): CoverPeriod[] {
  const amounts = effectiveCoverAmounts(overrides);
  const periods: CoverPeriod[] = [];
  for (let year = 1; year <= amounts.length; year++) {
    const amt = amounts[year - 1];
    const last = periods[periods.length - 1];
    if (last && last.amountLakhs === amt) last.endYear = year;
    else periods.push({ startYear: year, endYear: year, amountLakhs: amt, isCurrent: false });
  }
  if (periods.length > 0) periods[periods.length - 1].isCurrent = true;
  return periods;
}

/** Strips an accidental leading zero a plain-text amount field can end up
 * with (e.g. typing "5" right after an already-typed "0" produces "05") —
 * applied only on blur, never mid-keystroke, so it tidies up without
 * fighting the advisor while they're actively typing. Preserves genuine
 * decimals ("0.5") and a lone "0". */
function normalizeLeadingZeros(raw: string): string {
  const m = raw.match(/^0+(\d.*)$/);
  return m ? m[1] : raw;
}

// Ditto's brand logo, ported verbatim (base64 PNG) from Coverage Projection
// Assist's own branded illustration footer (CoverageProjectionStudioPage.tsx)
// — the same brand asset reused for visual consistency across every
// shareable illustration in the app; the layout/content around it below is
// its own, unrelated design, not copied from that page.
const DITTO_LOGO_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKgAAAA4CAYAAABpLbP3AAAJfUlEQVR42u1dTVIbyRL+srpt0MzC7YWDliXGzQksTmA4wTAnsDgBYvkiJgKI92be0vgEiBOAT4B8AssncD0koRZeuL2Y4cfqyrdoiUFYP1WtFkJyfzuChipVfvVVVnZmipgZs47M7xefAHg6z5LC9t9/ZvaRYiYgZp6c/7r0dMkJACzoZWr2lKApUqQETZESNEWKqcKexqCtZl3rZsaMPfd5fjc1U6qgKVKkCjoJXPx3UWZ+v5C6N3mhxLu4Y/n1+hpZOBnw62Apm386rZOHCeuum6+kCvoQSfqfzAqI90Y8JkNWq3/9+fg49kBEQzYBB5P8jL4vh27AMKQAc4i5OeIv/v3TLkJaASC/4xWrt4uPMqvXf/xcHWsQYm9qH7BtDx3bsr6lBJ2F437x0dUqkXrbVU0Qrf/9x8+lLzsY24AEnlqQnyxVSH3QOcCXHScAUHq6h93o5/GJeYsmQ1Rs0kes8FKCzhVRkTxhCANVjIEJExRD1dt1PZke8T8w/Hp9bVpjB1I6ANZ+xHVPCartA/LWcHHF10mNff3Y3hrF4ZSgPzDOz+o7AG0Me4aZv0xKuZkif3rI6HNLUGMfVErpLNp2gSxVIKaXTOQAcLo7mRkfoVBx87MfNJZSOpkF6wA0nJwAQERfkx77p8f2FlmjyHkfF7T+aDQaBQsokAgdgF4QRzxgQsBMX8EkwSzH4QLpJix33qLsgLmAiJQjNjUHBBwrEe7ddeCTfhf/uSELIdk6JAqWsrn9fr9rNU9LzMKJnuMnABUM/b4KM96Peujyur3veV7Qq9C1DRWNByJ+QgyHgQ2tdY5WSjLT4ainQqbjXC5XHW/DiiIgftXmwe31UXwIK6yYXOhGEvT8rLbBhDfDQywjF3B/Kbu8PSmC+o1GkQQf6BhyKbu80p+gjU/A5APxTO2Vuwbyz2plIno98bEVb7q55XJcNWdwyZCUg0hX7idcRj6olNJpNesnTHQ0HjkBgEqtZv2DjG6jKWYIrebpVuax9YkJu0mQM9qkVCS2P0W+fQwf1Pell1mwTmBQSqGBQmbB+tBq1mVq9lnxv+0jQKyBJnWaYLfVrBWZwvVBair6kZPYOhlfNfsqqYcfNJ43S+gI1If7sRV5xNZJo9EoaBGU2D6aDDlTzAo5JydQg0lqCz7pl7Elei9E9R1g8Ou8FPOPKQqUQ2yd3L2niNs7Z3RAeOiVO2CQZFDqY84opi9Q5GUW7IO+lyShrB2mGKQU9BZol91sr5MbxSatEhFezYbLwO+Y+cl3S0b6fjMzl0c9c3nV57WkQIVV/3gfERU1P8Ax84g3SlYohx7tZMcRqGMmegd8u4lvRke17UFxMYb9N3y/vtatDiBm7vgd9ifDib29uGrv3g069/vgUNZunDjffcZBB/7v4WUePVjK5hO/72rHjMcs+Tg/qx2w/mYAAxVQe3NULLPDrRKALQPL39hJdNXTMDywt5TNl0aRE4jSwNzny0Um7CHFg70YGZGT6NDN5td1Au2u68mlbL5kZn/yfD/KHhMdwhmEE/jYdc1LgTt/U0np8PBgJlAsXTdXjGn/t/qXNewAgPjckAUTH4Ep3I7t5VF7Ezy/mTezChOBYgrX446zcNXeNbD/mpTSEUoI/ckxl8fJ3HZdT4JGJzWkuD8YCtS7cezveF7AIG0VXXxkbQgwvdI/C8YnFxOOU1o8HISwCvq247Ftt3jd3tc+5gUVhEECQJBEYwDXzVfSY/7hgARpE/TyMhyboI7nBdCPlXtCV94ZqCa4LDKlxoOBZik1S52ojZ6rqN5rPvlS6OZAJllzw+CPKS9m7CKVqKjo/i9yhD7rJ1Nzk2Lqh7z3gCfnpEVzKXQVaipuWUrQlHh6fiVNR2mFtj+Q4ASJ6EXKjIdywuvV1NM/lbsJ2F/3f7EUujuIkkzDYi6kzHgoAsr/03w0SQXVihwwSAqDG7UzqkelDj43ZCGp4qsUSagZV/Xtn1D7H02BIuCrMJggoOziuHMzebWawmBdFcfa9EzCwP7j1yj59fqavkBRRZhMkAhb45cO09a8kiSJEyb2ZYLj+YiLl+2qtpuXgP2FYO284LZCRZhMEICTWTDLHb2NTo8jD3MLe2qfzeSVZY9BPS8AkfYxv/jYLsW3f21DP++UZS6Xq4rOBA2SQKh0flbbMPc9T1+PVfM0Nc61pfbKMDYmQD3d8WN3fzZJJibCThxftFPz9sZ0Tt2E5WOzD0RHrWZDeye1mqdbSojyLGri4qVRa8PXiR/zBvmTvn8aq31OlATEJhvxyESkzEuZWQJh5YagnSyliuHKvTk/qx0MKrjvOsStZv0EEPuzemg7nheYuEDE1onfqBUT46dB3gKxKLeajVI/P3GU72hYkuMw0dH5We1g2IaUUjrnZ/UdUtYHs6R4Ouzmnd40D/P9+hqxXnFYf8aTpM7rMCZywLw2bjjpIRTNAUDrrHak04LxO+Uj8Q+xWTkgBKbjt5qnJUC8MV+9W64BKwdETr/GZb1j1U8Qr5tIFYBkxsdI9fgFExUQK3beayP7tsz7Z7XDeF3WyAPgMVGPszI3IH4/qoFtH2fNAW6FfmKux8KVKl8txCHorSy1zthh+GiEirY3SVkfYghLAUCBKPLBeYxmTkKFv/X83ONvXYclE1/kR8HClSonlGRt/LIjSvBNptjQwvCvsnFdT7LA9rTWmQl7z3JedSBBHc8LhAp/m3TGe9TgQG3PSmZ9FOngRMqmR6nYIGVLZK008ilcd7k8jRJxJuz1qxb+LpvpWc6rCg7XJ0UeJuy5z5c3l7K/7Cdl9PvAUvaXfRiUzcZVsckqG7/QGy+/y8T3WIFL24NK2fum2z3LeVUW4Wryx33vRFhZAWYIS9l8aVySkhCxLo5JKBsRPTUabyIc6L0QMWF9UFv2gQTt7tqFq3A1CdUAUBWqvXp3IoLUTBG0S9LxiBK/zXikbFiPTxqzr3KMuoIsrzDxZqJEZQ6YsHdxFa6OKsS0NRz0ku/L/Tj9laL+PXzouv37ohOHUtEjOXjHh1oEFqQCBaGzgIkssuvmd31flgG7CMYr0gnNMAdMVIVJck7/sSsAVny/VgTTa9L8MgMGSUK8suGO/cq+XyuSoq1h37g3mg94f3kV7usW4Gl/ywfQTYaw1oipwMDLu8FXYg4YXCXij0Kpyt0b2Tzjc0MWQst27q6JUCogDuUk16LbTU4odtQdF8IKv1X/+obEKjIH8YDunAwcxcVv+MCkjuM0ffg/92aML4dwuwAAAAAASUVORK5CYII=";

// Fixed, theme-independent brand palette for the illustration frame (see
// CoverageProjectionStudioPage.tsx's own BRAND constant — same navy family,
// reused for visual consistency, but this page's own layout/content).
// Deliberately muted, not punchy — every color below is a soft, desaturated
// tone meant to sit on a white card (see the reference design): green for
// waiting-period carry-forward, coral/red for enhanced cover with fresh
// waiting periods, amber for partially-remaining waiting periods, blue for
// the Current Plan accent.
const BRAND = {
  navy: "#0d1c3f",
  navyText: "#1c2942",
  gray: "#6b7686",
  grayLight: "#98a2b3",
  border: "#e6e9ef",
  surface: "#f7f8fb",
  green: "#2f8f63",
  greenBg: "#eaf6ef",
  greenBorder: "#c9e8d6",
  amber: "#b5822c",
  amberBg: "#fbf3e3",
  amberBorder: "#ecdbb3",
  coral: "#c1584a",
  coralBg: "#fbebe8",
  coralBorder: "#f0cec8",
  blue: "#3c5a9a",
  blueBg: "#edf1fa",
  blueBorder: "#cdd8ee",
};

// Every member illustration is authored at exactly this fixed, portrait
// (4:5) canvas size — never taller, regardless of how much content a given
// member has (see MemberIllustration's own doc comment). 1080×1350 is the
// spec's own recommended export size; the on-screen preview scales this
// down visually (see PREVIEW_WIDTH below) but the captured/exported image is
// always the real, full-resolution 1080×1350 node.
const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1350;
// On-screen preview size for each grid cell — purely a CSS transform scale
// of the real canvas (see MemberIllustration), so two columns of these fit
// comfortably in the results panel without needing the advisor to scroll a
// full-resolution 1080px-wide card.
const PREVIEW_WIDTH = 440;
const PREVIEW_SCALE = PREVIEW_WIDTH / CANVAS_WIDTH;
const PREVIEW_HEIGHT = CANVAS_HEIGHT * PREVIEW_SCALE;

// Horizontal offset (page px) for the hidden, untransformed capture copies —
// see the "Hidden, untransformed capture copies" comment further down for
// why this MUST be a large POSITIVE number, never negative (html2canvas's
// own render-surface bug with `position: fixed` at a negative offset — not
// this positioning, and not captureMemberImage's html2canvas call, which
// (2026-09) no longer passes windowWidth/windowHeight at all — is what that
// comment covers).
const HIDDEN_CAPTURE_OFFSET = 3000;

// ─── Image export — same html2canvas-via-CDN approach as Cover Projection
// Assist (see CoverageProjectionStudioPage.tsx), duplicated locally rather
// than shared: that page keeps its own copy of this mechanism too (there is
// no existing shared image-export utility to reuse), so this mirrors the
// established per-page pattern instead of introducing a new shared module. ─

declare global {
  interface Window {
    html2canvas?: (element: HTMLElement, options?: Record<string, unknown>) => Promise<HTMLCanvasElement>;
  }
}

const HTML2CANVAS_SRC = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
let html2canvasLoadPromise: Promise<void> | null = null;

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

function downloadImageBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Slugifies a member's relationship label into a safe filename fragment —
 * e.g. "Mother-in-law" -> "mother-in-law", "Son 2" -> "son-2". */
function slugify(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "member"
  );
}

// ─── Small presentational helpers ───────────────────────────────────────────

function SectionCard({ dark, children }: { dark: boolean; children: ReactNode }) {
  return (
    <section
      className={`rounded-xl border p-4 space-y-3 ${
        dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-surface-elevated border-[var(--border-strong)] shadow-card"
      }`}
    >
      {children}
    </section>
  );
}

// Field label and text-input treatment standardised to Cover Projection
// Assist's own convention (CoverageProjectionStudioPage.tsx's Plan
// Configuration card: `text-[11px] font-bold mb-1.5` labels, `px-3 py-1.5
// rounded-lg border ... text-xs` inputs) — every field of the same TYPE
// across this page now shares one treatment instead of several slightly
// different ones.
function FieldLabel({ dark, children }: { dark: boolean; children: ReactNode }) {
  return <label className={`block text-[11px] font-bold mb-1.5 ${dark ? "text-slate-300" : "text-stone-600"}`}>{children}</label>;
}

function textInputClass() {
  return "w-full px-3 py-1.5 rounded-lg border outline-none font-semibold text-xs bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--input-text)]";
}

/**
 * CustomSelect's own default trigger (py-2, text-input-value, font-bold) is
 * visibly taller than the text-input/AmountField/DateInputDMY controls this
 * page builds with (py-1.5, text-xs, font-semibold) — every dropdown on this
 * page passes this instead of relying on that default, so a select sitting
 * next to a text field, amount field, or date field in the same row is
 * always the exact same height, never taller. Kept as its own helper (not a
 * `textInputClass()` reuse) only because a select trigger needs the flex
 * layout + right padding for its chevron that a plain <input> doesn't.
 */
function selectTriggerClass(disabled?: boolean) {
  return `w-full flex items-center justify-between gap-2 pl-3 pr-8 py-1.5 rounded-lg border outline-none font-semibold text-xs transition-colors font-sans relative bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--input-text)] hover:bg-[var(--surface-hover)] ${
    disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
  }`;
}

/**
 * Every amount/numeric field on this page (Current Cover, Bonus, Porting
 * Cover, cover-change amounts) goes through this one component — fixes the
 * "0" input bug at the source rather than patching it per field.
 *
 * The bug: a plain `<input type="number" value={someNumber} onChange={(e)
 * => setSomeNumber(parseFloat(e.target.value) || 0)} />` round-trips through
 * a NUMBER on every keystroke, so backspacing "0" to empty immediately
 * re-renders as "0" again (parseFloat("") || 0 = 0), and typing into that
 * "0" appends onto it ("05") instead of replacing it. The fix: keep the
 * DISPLAYED value as the advisor's own raw text for the entire duration of
 * editing (never re-derived from the parsed number while they're typing),
 * and only resync that text from an external value change — e.g. Reset —
 * via the effect below, which is skippable exactly when the change
 * originated from this field's own last commit.
 */
function AmountField({
  dark,
  value,
  onChange,
  placeholder = "0",
  className,
}: {
  dark: boolean;
  value: number;
  onChange: (n: number) => void;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState<string>(value === 0 ? "" : String(value));
  const lastCommitted = useRef(value);

  useEffect(() => {
    if (value !== lastCommitted.current) {
      setText(value === 0 ? "" : String(value));
      lastCommitted.current = value;
    }
  }, [value]);

  function handleChange(raw: string) {
    // Reject keystrokes that can't be part of a valid amount (letters, a
    // second decimal point) rather than silently coercing them — lets
    // every other valid intermediate state (empty, "5", "5.", "5.2")
    // through untouched.
    if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) return;
    setText(raw);
    const n = raw.trim() === "" ? 0 : parseFloat(raw);
    const safe = Number.isFinite(n) && n >= 0 ? n : 0;
    lastCommitted.current = safe;
    onChange(safe);
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={() => setText((t) => normalizeLeadingZeros(t))}
      placeholder={placeholder}
      className={className ?? textInputClass()}
      style={{ colorScheme: dark ? "dark" : "light" }}
    />
  );
}

/**
 * Shared boolean toggle — same track+knob switch mechanic as Cover
 * Projection Assist's Plan Configuration options (renderToggle in
 * CoverageProjectionStudioPage.tsx: role="switch", 18px track, 14px knob,
 * the app's --accent tokens for "on"), reused verbatim here so every
 * yes/no control on this page (Any PEDs?, Declared?, Same as inception,
 * Since inception) looks and behaves identically instead of mixing pill
 * buttons and native checkboxes.
 */
function Switch({
  dark,
  checked,
  onChange,
  label,
}: {
  dark: boolean;
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-8 rounded-full border transition-colors cursor-pointer shrink-0 ${
          checked ? "bg-[var(--accent-subtle-bg)] border-[var(--accent-border)]" : dark ? "bg-white/5 border-white/10" : "bg-stone-100 border-stone-250"
        }`}
        style={{ height: "18px" }}
      >
        <span
          className={`absolute top-1/2 -translate-y-1/2 rounded-full transition-all duration-200 shadow-sm ${checked ? "left-[16px]" : "left-0.5"} ${
            checked ? "bg-[var(--accent)]" : dark ? "bg-slate-400" : "bg-stone-400"
          }`}
          style={{ width: "14px", height: "14px" }}
        />
      </button>
      {label && <span className={`text-xs font-bold ${dark ? "text-slate-200" : "text-stone-700"}`}>{label}</span>}
    </label>
  );
}

/**
 * Porting Assist — an independent advisor tool for calculating and visually
 * explaining waiting-period carry-forward during a health-insurance porting
 * case. All calculation logic lives in ../portingAssistEngine.ts (pure,
 * deterministic, input-driven — no AI calls, no medical classification of
 * PED conditions, no mid-term/day-level date math). This file is UI only.
 */
export function PortingAssistPage({ theme }: PortingAssistPageProps) {
  const dark = theme === "dark";

  // Current Plan Details
  const [planName, setPlanName] = useState("");
  const [inceptionDate, setInceptionDate] = useState("");
  const policyYears = Math.min(MAX_POLICY_YEARS, derivePolicyYears(inceptionDate) || 1);
  const [bonusLakhs, setBonusLakhs] = useState<number>(0);
  // The Cover Timeline — one row per actual policy year (see
  // emptyCoverYearOverrides/effectiveCoverAmounts above). This replaces both
  // the old standalone "Current Cover" field and the old change-log table:
  // Year 1 IS the base cover, entered directly with no default value, and
  // every later year just carries it forward until the advisor overrides a
  // specific year — so "current cover" (the last year's effective amount)
  // can never drift out of sync with what's actually in the table.
  const [coverYearOverrides, setCoverYearOverrides] = useState<CoverYearOverrides>(() => emptyCoverYearOverrides(policyYears));

  // Porting Plan Details
  const [portingPlanId, setPortingPlanId] = useState<string>("hdfc_optima_secure_plus");
  const [customPortingPlanName, setCustomPortingPlanName] = useState("");
  const [portingCoverLakhs, setPortingCoverLakhs] = useState<number>(20);

  // Members
  const [members, setMembers] = useState<MemberDraft[]>(() => [emptyMember("Self")]);
  const [activeMemberId, setActiveMemberId] = useState<string>(() => members[0].id);

  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<PortingAssistResult | null>(null);
  const [resultContext, setResultContext] = useState<{
    planName: string;
    inceptionDate: string;
    currentCoverAmount: number;
    portingPlanLabel: string;
    bonusAmount: number;
    portingCoverAmount: number;
  } | null>(null);

  // One capture ref per member (keyed by member id) — each member's
  // illustration is an independent, individually exportable snippet (see
  // MemberIllustration below), not one shared capture area.
  const captureRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const resultsSectionRef = useRef<HTMLDivElement>(null);
  const [cardStatus, setCardStatus] = useState<Record<string, { message: string; isError: boolean }>>({});

  // If the inception date changes and policyYears shrinks or grows, clamp
  // any member/PED year selection and resize the Cover Timeline to match —
  // growing appends fresh "inherit from last year" rows (see
  // effectiveCoverAmounts), shrinking just drops the years that no longer
  // exist — so the form never silently holds an invalid, unreachable value.
  useEffect(() => {
    setMembers((prev) =>
      prev.map((m) => ({
        ...m,
        memberSinceYear: Math.min(m.memberSinceYear, policyYears),
        pedGroups: m.pedGroups.map((g) => ({
          ...g,
          declaredYear: g.declaredYear !== null ? Math.min(g.declaredYear, policyYears) : g.declaredYear,
        })),
      }))
    );
    setCoverYearOverrides((prev) => {
      if (prev.length === policyYears) return prev;
      if (prev.length < policyYears) return [...prev, ...Array.from({ length: policyYears - prev.length }, () => null)];
      return prev.slice(0, policyYears);
    });
  }, [policyYears]);

  const activeMember = members.find((m) => m.id === activeMemberId) ?? members[0];
  const coverEffectiveAmounts = effectiveCoverAmounts(coverYearOverrides);
  const coverPeriods = summarizeCoverPeriods(coverYearOverrides);
  const currentCoverLakhs = coverEffectiveAmounts[coverEffectiveAmounts.length - 1] ?? 0;

  function updateCoverYear(index: number, amountLakhs: number) {
    setCoverYearOverrides((prev) => prev.map((v, i) => (i === index ? amountLakhs : v)));
  }

  function updateMember(id: string, patch: Partial<MemberDraft>) {
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function addMember() {
    const relationship = nextDefaultRelationship(members);
    const newMember = emptyMember(relationship);
    setMembers((prev) => [...prev, newMember]);
    setActiveMemberId(newMember.id);
  }

  function removeMember(id: string) {
    if (members.length <= 1) return;
    const next = members.filter((m) => m.id !== id);
    setMembers(next);
    if (activeMemberId === id) setActiveMemberId(next[0].id);
  }

  // Both PED tables are fixed-row grids (see PED_TABLE_ROWS) — no add/remove
  // handlers needed, just per-row updates by id/index.
  function updatePedGroup(memberId: string, groupId: string, patch: Partial<PedGroupDraft>) {
    setMembers((prev) =>
      prev.map((m) =>
        m.id === memberId ? { ...m, pedGroups: m.pedGroups.map((g) => (g.id === groupId ? { ...g, ...patch } : g)) } : m
      )
    );
  }

  function updateUndeclaredPedsText(memberId: string, value: string) {
    setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, undeclaredPedsText: value } : m)));
  }

  function buildEngineInput(): PortingAssistInput {
    const coverHistory = coverEffectiveAmounts.map((amt, i) => ({
      policyYear: i + 1,
      coverAmount: amt * 100_000,
    }));
    const engineMembers: MemberInput[] = members.map((m) => {
      // Blank table rows are just unused slots — only rows the advisor
      // actually typed a condition into are sent (the engine itself
      // validates/errors on an empty-condition PED group, so this filter has
      // to happen here, before validation ever sees them).
      const declaredGroups = m.pedGroups.filter((g) => g.conditions.trim().length > 0);
      // One free-text cell, split into individual conditions here — the
      // engine still gets the same string[] shape it always has, this is
      // purely how the single input field gets parsed into it.
      const undeclaredConditions = m.undeclaredPedsText
        .split(",")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      // No more "Any PEDs?" toggle — whether this member has PEDs at all is
      // derived purely from whether either table actually has content.
      const hasPeds = declaredGroups.length > 0 || undeclaredConditions.length > 0;
      return {
        id: m.id,
        relationship: resolveRelationshipLabel(m),
        memberSinceYear: m.sameAsInception ? 1 : m.memberSinceYear,
        hasPeds,
        pedGroups: hasPeds
          ? declaredGroups.map(
              (g): PedGroupInput => ({
                id: g.id,
                conditions: g.conditions.trim(),
                declared: true,
                declaredSinceInception: g.declaredSinceInception,
                declaredYear: g.declaredSinceInception ? null : g.declaredYear,
              })
            )
          : [],
        undeclaredPedConditions: hasPeds ? undeclaredConditions : [],
      };
    });
    return {
      coverHistory,
      availableBonus: bonusLakhs * 100_000,
      portingCoverAmount: portingCoverLakhs * 100_000,
      members: engineMembers,
    };
  }

  function handleGenerate() {
    const input = buildEngineInput();
    const validationErrors = validatePortingAssistInput(input);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      setResult(null);
      return;
    }
    setErrors([]);
    const portingPlanLabel =
      portingPlanId === "other"
        ? customPortingPlanName.trim() || "Other"
        : PORTING_PLAN_OPTIONS.find((o) => o.value === portingPlanId)?.label ?? "";
    setResultContext({
      planName: planName.trim() || "Current Plan",
      inceptionDate,
      // The most recent (present-day) cover amount, not necessarily the
      // Year-1 base figure — the last entry in the Cover Timeline already
      // accounts for every later year's own entry (see
      // effectiveCoverAmounts), so this can never drift from what the
      // advisor actually entered.
      currentCoverAmount: input.coverHistory[input.coverHistory.length - 1]?.coverAmount ?? 0,
      portingPlanLabel,
      bonusAmount: input.availableBonus,
      portingCoverAmount: input.portingCoverAmount,
    });
    setResult(calculatePortingAssist(input));
  }

  function handleReset() {
    setPlanName("");
    setInceptionDate("");
    setCoverYearOverrides(emptyCoverYearOverrides(1));
    setBonusLakhs(0);
    setPortingPlanId("hdfc_optima_secure_plus");
    setCustomPortingPlanName("");
    setPortingCoverLakhs(20);
    const freshMember = emptyMember("Self");
    setMembers([freshMember]);
    setActiveMemberId(freshMember.id);
    setErrors([]);
    setResult(null);
    setResultContext(null);
  }

  useEffect(() => {
    if (result) resultsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [result]);

  function showCardStatus(memberId: string, msg: string, isError: boolean) {
    setCardStatus((prev) => ({ ...prev, [memberId]: { message: msg, isError } }));
    if (msg) {
      window.setTimeout(() => {
        setCardStatus((prev) => (prev[memberId]?.message === msg ? { ...prev, [memberId]: { message: "", isError: false } } : prev));
      }, 4000);
    }
  }

  /** Captures exactly one member's illustration — the fixed 1080×1350 node
   * itself (see MemberIllustration's CANVAS_WIDTH/CANVAS_HEIGHT), never the
   * scaled-down on-screen preview wrapper around it. scale:2 (2026-09,
   * raised from 1) — html2canvas doesn't get the browser's own subpixel
   * text hinting or high-quality image downsampling, so small raster
   * assets (the ditto wordmark in IllustrationFooter, sourced at a modest
   * 168×56 and displayed at 22px tall) and fine text edges come out
   * noticeably softer/lighter than the live on-screen node at scale:1 —
   * confirmed by capturing the same node at both scales and comparing the
   * footer logo crop directly: scale:2's extra source pixels going into
   * html2canvas's own downsample read as visibly crisper, not just
   * larger. Cheap to afford: this illustration is a fixed 1080×1350
   * layout (not a scale multiplier on already-large content the way it
   * would be on, say, a full results table), so 2160×2700 is still a
   * modest PNG, not the "bloats the file" concern the old scale:1 comment
   * here warned against. */
  async function captureMemberImage(memberId: string): Promise<Blob | null> {
    const target = captureRefs.current[memberId];
    if (!target) return null;
    try {
      await loadHtml2Canvas();
    } catch {
      showCardStatus(memberId, "Could not load the image renderer — check your internet connection and try again.", true);
      return null;
    }
    const html2canvas = window.html2canvas;
    if (!html2canvas) {
      showCardStatus(memberId, "Could not load the image renderer — check your internet connection and try again.", true);
      return null;
    }
    try {
      // Deliberately NO explicit width/height/scrollX/scrollY/windowWidth/
      // windowHeight here (2026-09) — matches CoverageProjectionStudioPage's
      // captureTableImage(), the one export mechanism in the app that's
      // never had a clipping complaint. html2canvas auto-sizes the output
      // canvas from the target's own box, which is already exactly
      // CANVAS_WIDTH×CANVAS_HEIGHT with `overflow: hidden` (see
      // MemberIllustration) — CSS itself is the only thing that needs to
      // agree on the size. The previous approach passed width/height too,
      // which doesn't just duplicate that sizing, it OVERRIDES it: those
      // options tell html2canvas to hard-crop the canvas to exactly that
      // many pixels measured from wherever its internal clone computes the
      // element's offset to be — every pixel of daylight between that
      // computed offset and the element's true rendered position (from
      // font-hinting/sub-pixel differences between browsers, OS's, or even
      // just different real advisor content than whatever was on-screen
      // when this was last tested) becomes a silent slice off the right or
      // bottom edge, with no error and no visual sign anything was wrong
      // except cropped content — precisely the "content cut off on the
      // right/bottom" reports this replaces. Letting html2canvas measure
      // the element itself removes that whole failure class: there's no
      // second, independently-computed crop window to ever disagree with
      // the DOM's own layout.
      const canvas = await html2canvas(target, {
        backgroundColor: "#ffffff",
        scale: 2,
      });
      return await new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
    } catch {
      return null;
    }
  }

  async function copyMemberImage(memberId: string, relationshipLabel: string) {
    showCardStatus(memberId, "Generating image…", false);
    const blob = await captureMemberImage(memberId);
    if (!blob) {
      showCardStatus(memberId, "Could not generate the image.", true);
      return;
    }
    if (navigator.clipboard && window.ClipboardItem) {
      navigator.clipboard
        .write([new window.ClipboardItem({ "image/png": blob })])
        .then(() => showCardStatus(memberId, "Copied to clipboard.", false))
        .catch(() => {
          downloadImageBlob(blob, `porting-assist-${slugify(relationshipLabel)}.png`);
          showCardStatus(memberId, "Clipboard copy isn't available here — downloaded instead.", false);
        });
    } else {
      downloadImageBlob(blob, `porting-assist-${slugify(relationshipLabel)}.png`);
      showCardStatus(memberId, "Clipboard copy isn't available here — downloaded instead.", false);
    }
  }

  async function downloadMemberImage(memberId: string, relationshipLabel: string) {
    showCardStatus(memberId, "Generating image…", false);
    const blob = await captureMemberImage(memberId);
    if (!blob) {
      showCardStatus(memberId, "Could not generate the image.", true);
      return;
    }
    downloadImageBlob(blob, `porting-assist-${slugify(relationshipLabel)}.png`);
    showCardStatus(memberId, "Downloaded.", false);
  }

  const planNotes = PLAN_NOTES[portingPlanId];
  // The single "Declaration Year" select now covers both cases the old
  // dropdown+"Since inception" switch combo used to: its own join year is
  // included as a normal option (picking it sets declaredSinceInception —
  // see the onChange below), then every later year through the current
  // policy year.
  const resolvedJoinYear = activeMember.sameAsInception ? 1 : activeMember.memberSinceYear;
  const pedYearOptions = Array.from({ length: Math.max(0, policyYears - resolvedJoinYear + 1) }, (_, i) => resolvedJoinYear + i).map(
    (y) => ({
      value: String(y),
      label: y === resolvedJoinYear ? `${policyYearLabel(y, inceptionDate)} · Since joining` : policyYearLabel(y, inceptionDate),
    })
  );

  return (
    <>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-3 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${dark ? "text-white" : "text-[#111827]"}`}>
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: dark ? "#00D3F3" : "#4673a9" }} />
            <span>Porting Assist</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            Calculate and visually explain waiting-period carry-forward during a health-insurance porting case.
          </p>
        </div>
      </div>

      <div className="space-y-4 pb-6 pt-4">
        {/* Plan Details and Member Details side by side on wide screens
            (2xl+, where each card still has genuine room for its own
            internal horizontal layout without cramping) instead of always
            stacking vertically; below that they fall back to the
            already-tested full-width stacked layout. */}
        {/* items-stretch (the grid default) so Plan Details and Member
            Details always render at the same height, regardless of which
            one has more content. */}
        {/* PLAN DETAILS — three cards in a row: Current Plan, then the Cover
            Timeline (the single source of truth for every year's cover —
            see effectiveCoverAmounts — sitting between the two plan cards
            rather than buried inside one of them), then Porting Plan.
            Member Details (full width) follows below. */}
        <SectionCard dark={dark}>
          <h2 className={`text-xs font-black uppercase tracking-wider flex items-center gap-2 ${dark ? "text-slate-200" : "text-stone-800"}`}>
            <Route className="w-4 h-4" style={{ color: dark ? "#00D3F3" : "#4673a9" }} />
            Plan Details
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-stretch">
            {/* Current Plan — a tinted panel using the app's own blue accent
                tokens. Current Cover is a read-only readout (never a second
                editable field — see the Cover Timeline card, its only
                source), so it can never drift out of sync with what's
                actually entered there. */}
            <div
              className="rounded-xl border overflow-hidden flex flex-col"
              style={{ background: "var(--accent-subtle-bg)", borderColor: "var(--accent-border)" }}
            >
              <div className="flex items-center gap-2 px-3.5 py-2.5 border-b" style={{ borderColor: "var(--accent-border)" }}>
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                  style={{ background: dark ? "rgba(0,211,243,0.16)" : "#FFFFFF" }}
                >
                  <FileText className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} />
                </div>
                <span className="text-[11px] font-black uppercase tracking-wide" style={{ color: "var(--accent)" }}>
                  Current Plan
                </span>
              </div>

              <div className="p-3.5 space-y-2.5 flex-1">
                <div>
                  <FieldLabel dark={dark}>Plan Name</FieldLabel>
                  <input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="e.g. Care Supreme" className={textInputClass()} />
                </div>
                <div>
                  <FieldLabel dark={dark}>Inception Date</FieldLabel>
                  <DateInputDMY
                    value={inceptionDate}
                    onChange={setInceptionDate}
                    displayClassName={`${textInputClass()} flex items-center justify-between`}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <FieldLabel dark={dark}>Current Cover (₹L)</FieldLabel>
                    <div
                      className={`px-3 py-1.5 rounded-lg border font-bold text-xs ${
                        dark ? "bg-white/[0.02] border-white/[0.08] text-slate-300" : "bg-stone-50 border-stone-200 text-stone-600"
                      }`}
                      title="Auto-calculated from the Cover Timeline's latest year"
                    >
                      {currentCoverLakhs > 0 ? `₹${currentCoverLakhs}L` : "—"}
                    </div>
                  </div>
                  <div>
                    <FieldLabel dark={dark}>Available Bonus (₹L)</FieldLabel>
                    <AmountField dark={dark} value={bonusLakhs} onChange={setBonusLakhs} />
                  </div>
                </div>
                <div className={`text-[10px] italic leading-snug ${dark ? "text-slate-500" : "text-stone-400"}`}>
                  Current Cover follows the Cover Timeline →
                </div>
              </div>
            </div>

            {/* Cover Timeline — the ONE place the advisor enters cover
                amounts. One row per actual policy year (never a fixed row
                count, never a "pick which year changed" dropdown): Year 1
                is the base, entered directly with nothing pre-filled;
                every later year already shows the prior year's amount
                (editable) so the advisor only has to touch a row when the
                cover genuinely changed that year. */}
            <div
              className={`rounded-xl border overflow-hidden flex flex-col ${dark ? "bg-white/[0.02] border-white/[0.08]" : "bg-white border-stone-200"}`}
            >
              <div className={`flex items-center gap-2 px-3.5 py-2.5 border-b ${dark ? "border-white/[0.08]" : "border-stone-200"}`}>
                <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${dark ? "bg-white/[0.06]" : "bg-stone-100"}`}>
                  <Clock className="w-3.5 h-3.5" style={{ color: dark ? "#00D3F3" : "#4673a9" }} />
                </div>
                <span className={`text-[11px] font-black uppercase tracking-wide ${dark ? "text-slate-200" : "text-stone-700"}`}>Cover Timeline</span>
              </div>

              <div className="p-3.5 space-y-2.5 flex-1">
                <div className={`rounded-lg border overflow-hidden ${dark ? "border-white/[0.10] bg-white/[0.02]" : "border-stone-200 bg-white"}`}>
                  <div
                    className={`grid grid-cols-[1fr_104px] gap-1.5 px-2 py-1.5 border-b text-[9.5px] font-black uppercase tracking-wide ${
                      dark ? "border-white/[0.08] text-slate-400" : "border-stone-200 text-stone-500"
                    }`}
                  >
                    <span>Policy Year</span>
                    <span>Cover (₹L)</span>
                  </div>
                  <div className={`divide-y ${dark ? "divide-white/[0.06]" : "divide-stone-200"}`}>
                    {coverYearOverrides.map((override, i) => {
                      const year = i + 1;
                      const isCurrent = year === policyYears;
                      return (
                        <div
                          key={year}
                          className={`grid grid-cols-[1fr_104px] gap-1.5 items-center px-2 py-1.5 ${isCurrent ? (dark ? "bg-white/[0.04]" : "bg-stone-50") : ""}`}
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={`text-xs font-bold truncate ${dark ? "text-slate-200" : "text-stone-700"}`}>
                              {policyYearLabel(year, inceptionDate)}
                            </span>
                            {isCurrent && (
                              <span
                                className="shrink-0 text-[8px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded"
                                style={{ background: "var(--accent-subtle-bg)", color: "var(--accent)" }}
                              >
                                Current
                              </span>
                            )}
                          </div>
                          <AmountField dark={dark} value={override ?? coverEffectiveAmounts[i]} onChange={(n) => updateCoverYear(i, n)} />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Compact resulting-periods preview, grouping consecutive
                    years that share the same amount — never a year-by-year
                    repeat (see product spec section 3). */}
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {coverPeriods.map((p, i) => (
                    <span
                      key={i}
                      className={`text-[10px] font-semibold ${
                        p.isCurrent ? (dark ? "text-slate-100 font-black" : "text-stone-800 font-black") : dark ? "text-slate-500" : "text-stone-500"
                      }`}
                    >
                      {p.startYear === p.endYear ? `Year ${p.startYear}` : `Year ${p.startYear}-${p.endYear}`}: ₹{p.amountLakhs}L
                      {p.isCurrent ? " (current)" : ""}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Porting Plan — the app's own secondary-accent (teal) token,
                clearly distinct from Current Plan's blue. */}
            <div
              className="rounded-xl border overflow-hidden flex flex-col"
              style={{
                background: "color-mix(in srgb, var(--teal) 10%, transparent)",
                borderColor: "color-mix(in srgb, var(--teal) 32%, transparent)",
              }}
            >
              <div
                className="flex items-center gap-2 px-3.5 py-2.5 border-b"
                style={{ borderColor: "color-mix(in srgb, var(--teal) 32%, transparent)" }}
              >
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                  style={{ background: dark ? "rgba(45,212,191,0.16)" : "#FFFFFF" }}
                >
                  <FileText className="w-3.5 h-3.5" style={{ color: "var(--teal)" }} />
                </div>
                <span className="text-[11px] font-black uppercase tracking-wide" style={{ color: "var(--teal)" }}>
                  Porting Plan
                </span>
              </div>

              <div className="p-3.5 space-y-2.5 flex-1">
                <div className="grid grid-cols-1 gap-2.5">
                  <div>
                    <FieldLabel dark={dark}>Porting Plan</FieldLabel>
                    <CustomSelect
                      value={portingPlanId}
                      onChange={setPortingPlanId}
                      options={PORTING_PLAN_OPTIONS}
                      triggerClassName={selectTriggerClass()}
                      theme={theme}
                    />
                    {portingPlanId === "other" && (
                      <input
                        value={customPortingPlanName}
                        onChange={(e) => setCustomPortingPlanName(e.target.value)}
                        placeholder="Enter the porting plan name"
                        className={`${textInputClass()} mt-2`}
                      />
                    )}
                  </div>
                  <div>
                    <FieldLabel dark={dark}>Porting Cover (₹L)</FieldLabel>
                    <AmountField dark={dark} value={portingCoverLakhs} onChange={setPortingCoverLakhs} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* MEMBER DETAILS — full width, below Plan Details. Segmented member
            tabs (labeled by relationship, auto-numbered on duplicates — see
            memberTabLabel) + one compact editor for the active member:
            Relationship/Member Since stacked in a left column, the two PED
            tables always visible in a right column (no more "Any PEDs?"
            toggle — whether a member has PEDs is decided purely by whether
            either table actually has an entry, see buildEngineInput). */}
        <SectionCard dark={dark}>
          <h2 className={`text-xs font-black uppercase tracking-wider flex items-center gap-2 ${dark ? "text-slate-200" : "text-stone-800"}`}>
            <Users className="w-4 h-4" style={{ color: dark ? "#00D3F3" : "#4673a9" }} />
            Member Details
          </h2>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className={`inline-flex items-center gap-1 rounded-xl p-1 ${dark ? "bg-white/[0.05]" : "bg-stone-100"}`}>
              {members.map((m, idx) => {
                const isActive = m.id === activeMember.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setActiveMemberId(m.id)}
                    className={`px-4 py-1.5 rounded-lg text-[11.5px] font-bold cursor-pointer whitespace-nowrap transition-colors ${
                      isActive
                        ? dark
                          ? "bg-[#0b2337] text-[#AEDCF4] shadow-sm"
                          : "bg-white text-[#01334F] shadow-sm"
                        : dark
                          ? "text-slate-400 hover:text-slate-200"
                          : "text-stone-500 hover:text-stone-700"
                    }`}
                  >
                    {memberTabLabel(members, idx)}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-1.5">
              {members.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeMember(activeMember.id)}
                  title="Remove this member"
                  className={`p-2 rounded-lg cursor-pointer ${dark ? "text-rose-300 hover:bg-rose-500/10" : "text-rose-600 hover:bg-rose-50"}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              {/* variant="action" (2026-09): shared --action-navy token,
                  same as Generate Illustration below, instead of this
                  page's own one-off muted gray fill. */}
              <ClippedButton onClick={addMember} size="sm" variant="action" className="px-3 py-1.5">
                <Plus className="w-3.5 h-3.5 mr-1" /> Add Member
              </ClippedButton>
            </div>
          </div>

          <div className={`rounded-lg border p-3 ${dark ? "border-white/[0.08] bg-white/[0.02]" : "border-stone-200 bg-white"}`}>
            <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3 items-start">
              {/* Left — Relationship and Member Since, stacked vertically. */}
              <div className="space-y-3">
                <div>
                  <FieldLabel dark={dark}>Relationship</FieldLabel>
                  <CustomSelect
                    value={activeMember.relationship}
                    onChange={(v) => updateMember(activeMember.id, { relationship: v })}
                    options={RELATIONSHIP_OPTIONS}
                    triggerClassName={selectTriggerClass()}
                    theme={theme}
                  />
                  {activeMember.relationship === "Other" && (
                    <input
                      value={activeMember.customRelationship}
                      onChange={(e) => updateMember(activeMember.id, { customRelationship: e.target.value })}
                      placeholder="Enter relationship"
                      className={`${textInputClass()} mt-2`}
                    />
                  )}
                </div>
                <div>
                  <FieldLabel dark={dark}>Member Since</FieldLabel>
                  <div className="space-y-2">
                    {activeMember.sameAsInception ? (
                      <div
                        className={`px-2.5 py-1.5 rounded-lg border font-bold text-xs ${
                          dark ? "bg-white/[0.02] border-white/[0.08] text-slate-300" : "bg-stone-50 border-stone-200 text-stone-600"
                        }`}
                      >
                        {inceptionDate ? isoDateToDMY(inceptionDate) : policyYearLabel(1, inceptionDate)}
                      </div>
                    ) : (
                      <CustomSelect
                        value={String(activeMember.memberSinceYear)}
                        onChange={(v) => updateMember(activeMember.id, { memberSinceYear: parseInt(v, 10) })}
                        options={Array.from({ length: policyYears }, (_, i) => i + 1).map((y) => ({
                          value: String(y),
                          label: policyYearLabel(y, inceptionDate),
                        }))}
                        triggerClassName={selectTriggerClass()}
                        theme={theme}
                      />
                    )}
                    <Switch
                      dark={dark}
                      checked={activeMember.sameAsInception}
                      onChange={(v) => updateMember(activeMember.id, { sameAsInception: v, memberSinceYear: v ? 1 : activeMember.memberSinceYear })}
                      label="Same as inception"
                    />
                  </div>
                </div>
              </div>

              {/* Right — PED tables, always visible (no "Any PEDs?" toggle;
                  whether this member has PEDs is decided purely by whether
                  either table actually has an entry — see buildEngineInput).
                  Table 1 (declared) is a fixed-row Condition + Declaration
                  Year grid (blank rows are just unused slots, filtered out
                  at Generate time); Table 2 (undeclared) is a single
                  free-text cell, not a row-per-condition list. */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-stretch">
                {/* Table 1 — declared PEDs (condition + declaration year) */}
                <div className={`rounded-lg border overflow-hidden flex flex-col ${dark ? "border-white/[0.08] bg-white/[0.02]" : "border-stone-200 bg-white"}`}>
                  <div
                    className={`grid grid-cols-[1fr_136px] gap-2 px-2.5 py-1.5 border-b text-[10px] font-black uppercase tracking-wide ${
                      dark ? "border-white/[0.08] text-slate-400" : "border-stone-200 text-stone-500"
                    }`}
                  >
                    <span>PEDs</span>
                    <span>Declaration Year</span>
                  </div>
                  <div className={`divide-y ${dark ? "divide-white/[0.06]" : "divide-stone-100"}`}>
                    {activeMember.pedGroups.map((group, gi) => (
                      <div key={group.id} className="grid grid-cols-[1fr_136px] gap-2 items-center px-2.5 py-1.5">
                        <input
                          value={group.conditions}
                          onChange={(e) => updatePedGroup(activeMember.id, group.id, { conditions: e.target.value })}
                          // Placeholder only on the very first row — a quiet
                          // example rather than a hint repeated on every row.
                          placeholder={gi === 0 ? "e.g. Diabetes, Hypertension" : undefined}
                          className={`${textInputClass()} placeholder:italic placeholder:text-[10px] placeholder:font-normal`}
                        />
                        <CustomSelect
                          value={group.declaredSinceInception ? String(resolvedJoinYear) : group.declaredYear !== null ? String(group.declaredYear) : ""}
                          onChange={(v) => {
                            const picked = parseInt(v, 10);
                            if (picked === resolvedJoinYear) {
                              updatePedGroup(activeMember.id, group.id, { declaredSinceInception: true, declaredYear: null });
                            } else {
                              updatePedGroup(activeMember.id, group.id, { declaredSinceInception: false, declaredYear: picked });
                            }
                          }}
                          options={pedYearOptions}
                          placeholder="Select…"
                          triggerClassName={selectTriggerClass()}
                          theme={theme}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Table 2 — undeclared PEDs: one single big cell, no rows.
                    Comma-separated free text, split into individual
                    conditions only when building the engine input. */}
                <div className={`rounded-lg border overflow-hidden flex flex-col ${dark ? "border-white/[0.08] bg-white/[0.02]" : "border-stone-200 bg-white"}`}>
                  <div
                    className={`px-2.5 py-1.5 border-b text-[10px] font-black uppercase tracking-wide ${
                      dark ? "border-white/[0.08] text-slate-400" : "border-stone-200 text-stone-500"
                    }`}
                  >
                    Undeclared PEDs
                  </div>
                  <textarea
                    value={activeMember.undeclaredPedsText}
                    onChange={(e) => updateUndeclaredPedsText(activeMember.id, e.target.value)}
                    placeholder="e.g. Asthma, Thyroid"
                    className={`w-full flex-1 resize-none border-0 outline-none px-3 py-2 font-semibold text-xs bg-transparent text-[var(--input-text)] placeholder:italic placeholder:text-[10px] placeholder:font-normal ${
                      dark ? "placeholder:text-slate-500" : "placeholder:text-stone-400"
                    }`}
                    style={{ minHeight: "112px" }}
                  />
                </div>
              </div>
            </div>
          </div>
        </SectionCard>

        {errors.length > 0 && (
          <div className={`rounded-xl border p-4 space-y-1.5 ${dark ? "bg-rose-500/10 border-rose-500/30" : "bg-rose-50 border-rose-200"}`}>
            {errors.map((err, i) => (
              <div key={i} className={`text-xs font-semibold ${dark ? "text-rose-300" : "text-rose-700"}`}>
                {err}
              </div>
            ))}
          </div>
        )}

        <div className={`pt-3 border-t flex items-center gap-3 ${dark ? "border-white/[0.06]" : "border-stone-100"}`}>
          <PrimaryCtaButton theme={theme} onClick={handleGenerate} className="self-start">
            Generate Illustration
          </PrimaryCtaButton>
          <ClippedButton onClick={handleReset} size="sm" className={dark ? "bg-white/[0.05] text-stone-300 px-3 py-2" : "bg-stone-100 text-stone-600 px-3 py-2"}>
            Reset
          </ClippedButton>
        </div>

        {result && resultContext && (
          <section ref={resultsSectionRef} style={{ scrollMarginTop: 24 }}>
            <div
              className={`rounded-2xl border ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-surface-elevated border-[var(--border-strong)]"}`}
              style={{ padding: "20px 20px" }}
            >
              <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
                <h2 className={`text-sm font-black uppercase tracking-wider ${dark ? "text-white" : "text-[#111827]"}`}>
                  Illustration{result.members.length > 1 ? "s" : ""} Generated
                </h2>
                <span className={`text-[11px] font-semibold ${dark ? "text-slate-400" : "text-stone-500"}`}>
                  {result.members.length > 1
                    ? `${result.members.length} independent, individually shareable illustrations below.`
                    : "One shareable illustration below."}
                </span>
              </div>

              {/* Two-column grid — always 2 columns regardless of member
                  count (2 -> one row, 3 -> 2+1, 4 -> 2+2, ...), never one
                  long vertical stack. Each cell is one member's fully
                  independent, individually exportable illustration — see
                  MemberIllustration and the per-member capture/export
                  handlers above. */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(2, ${PREVIEW_WIDTH}px)`,
                  justifyContent: "center",
                  gap: "28px 24px",
                }}
              >
                {result.members.map((memberResult) => {
                  const status = cardStatus[memberResult.id];
                  return (
                    <div key={memberResult.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                      {/* Preview frame — a CSS-scaled-down, DISPLAY-ONLY view
                          of the illustration. html2canvas cannot be trusted
                          to capture an element that sits under a transformed
                          ancestor (it bakes in the ancestor's scale
                          unpredictably, producing a squished/overlapping
                          render into the full-size output canvas) — see the
                          hidden, untransformed capture copy rendered further
                          below and pointed to by captureRefs instead. This
                          node is purely decorative. */}
                      <div
                        style={{
                          width: PREVIEW_WIDTH,
                          height: PREVIEW_HEIGHT,
                          borderRadius: 14,
                          overflow: "hidden",
                          boxShadow: dark
                            ? "0 18px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)"
                            : "0 14px 32px rgba(15,23,42,0.16), 0 0 0 1px rgba(15,23,42,0.06)",
                        }}
                      >
                        <div style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, transform: `scale(${PREVIEW_SCALE})`, transformOrigin: "top left" }}>
                          <MemberIllustration memberResult={memberResult} context={resultContext} planNotes={planNotes} />
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {/* Shared --action-navy token (2026-09) instead of a
                            hardcoded #1f2d3d, which stayed the light-theme
                            color even in dark mode. */}
                        <ClippedButton
                          onClick={() => copyMemberImage(memberResult.id, memberResult.relationship)}
                          size="sm"
                          variant="action"
                          className="gap-2 px-3 py-2"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.03em", textTransform: "uppercase" }}>Copy Image</span>
                        </ClippedButton>
                        <ClippedButton
                          onClick={() => downloadMemberImage(memberResult.id, memberResult.relationship)}
                          size="sm"
                          title="Download as an image file"
                          variant="action"
                          className="w-9 h-9"
                        >
                          <Download className="w-4 h-4" />
                        </ClippedButton>
                      </div>
                      {status?.message && (
                        <div className={`text-[10.5px] font-semibold text-center ${status.isError ? "text-rose-600" : "text-emerald-600"}`}>
                          {status.message}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Hidden, untransformed capture copies — one true-size
                (1080×1350) render per member, positioned off-screen via
                `position: absolute` (ordinary document-flow coordinates)
                rather than nested under the scaled preview above, and
                deliberately NOT `position: fixed` — html2canvas has
                long-standing, well-documented trouble rasterizing
                fixed-position elements correctly (their viewport-relative
                coordinates don't translate cleanly into html2canvas's
                page-coordinate clone, which produced exactly the
                right-edge-clipped, word-spacing-stretched capture seen when
                this used `position: fixed`). html2canvas also cannot be
                trusted to capture an element sitting under a transformed
                ancestor (bakes the ancestor's scale into the clone
                unpredictably) — hence a separate copy from the scaled
                preview above, rather than pointing captureRefs into it. No
                opacity/visibility/clip-path tricks either — those make
                html2canvas render a blank or clipped capture too.
                Positioned at a large POSITIVE offset (never negative) —
                html2canvas clones the page into an offscreen render surface
                that starts at x=0 and is only as big as `windowWidth`
                (default: the current viewport), so a negative left (as this
                used to be) places the target outside that surface entirely,
                producing the stretched/justified text and right-edge
                clipping seen with `left: -9999px`. `HIDDEN_CAPTURE_OFFSET`
                below must stay comfortably clear of the page's own visible
                content width so every member's capture copy is fully inside
                the render surface (captureMemberImage's html2canvas call
                doesn't pass an explicit `windowWidth`/`windowHeight`
                (2026-09) — html2canvas's own default there is the current
                viewport, generously larger than this offset needs). */}
            <div style={{ position: "absolute", top: 0, left: HIDDEN_CAPTURE_OFFSET, pointerEvents: "none" }} aria-hidden="true">
              {result.members.map((memberResult) => (
                <div
                  key={memberResult.id}
                  ref={(el) => {
                    captureRefs.current[memberResult.id] = el;
                  }}
                  style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
                >
                  <MemberIllustration memberResult={memberResult} context={resultContext} planNotes={planNotes} />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

// ─── Result illustration (the exported artifact) ────────────────────────────
//
// Each member gets their own INDEPENDENT, fixed-canvas (1080×1350, 4:5
// portrait) illustration — never one long illustration containing every
// member, and never a canvas that grows taller to fit more content (see
// CANVAS_WIDTH/CANVAS_HEIGHT above and the results grid in
// PortingAssistPage). A member with more to say (several PED groups, both a
// carry-forward AND an enhanced portion on every waiting period) gets a more
// COMPACT rendering of the same fixed canvas, never a taller one — a section
// that doesn't apply to this member (no PEDs, full carry-forward, no plan
// note) is simply omitted rather than shown empty. All figures come
// straight from portingAssistEngine's own PortingAssistResult/MemberResult;
// this file only decides what to surface, in what shape, and how to fit it
// — the underlying waiting-period math is never touched here.

/** "3" -> "3 years", "1" -> "1 year" — every waiting-period figure in the
 * illustration goes through this so nothing reads as a bare, ambiguous
 * number (see product spec section 9: never a vague "1 year remaining"
 * without saying what it's remaining of). */
function pluralYears(n: number): string {
  return `${n} year${n === 1 ? "" : "s"}`;
}

/** Compact Lakh/Crore shorthand for the illustration's own prose sentences
 * (the single-line cover explanation) — the big headline figures elsewhere
 * use formatRupees' full Indian-format instead. Purely a display
 * convenience, never used in a calculation. */
function formatLakhShort(amount: number): string {
  const lakhs = amount / 100_000;
  if (lakhs >= 100) return `${trimTrailingZero(lakhs / 100)}Cr`;
  return `${trimTrailingZero(lakhs)}L`;
}
function trimTrailingZero(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

function isSelfRelationship(relationship: string): boolean {
  return relationship.trim().toLowerCase() === "self";
}

/** "Spouse" -> "Spouse's", "Mother-in-law" -> "Mother-in-law's" — every
 * supported relationship (including a custom "Other" label) just takes a
 * plain "'s"; none of RELATIONSHIP_OPTIONS end in "s" themselves, so no
 * special-casing is needed. Never applied to "Self" — see
 * IllustrationHeader, which renders "Self" as "Your ..." with no possessive
 * at all (see product spec section 4). */
function possessive(relationship: string): string {
  return `${relationship}'s`;
}

type LineStatus = "completed" | "partial" | "fresh";

function statusStyle(status: LineStatus): { bg: string; border: string; fg: string; Icon: LucideIcon } {
  if (status === "completed") return { bg: BRAND.greenBg, border: BRAND.greenBorder, fg: BRAND.green, Icon: CheckCircle2 };
  if (status === "partial") return { bg: BRAND.amberBg, border: BRAND.amberBorder, fg: BRAND.amber, Icon: Clock };
  return { bg: BRAND.coralBg, border: BRAND.coralBorder, fg: BRAND.coral, Icon: Clock };
}

/** This member's own carry-forward Specific Illness status, computed
 * directly from just its own carry-forward tranches (never mixed with the
 * fresh portion's, which always reports its own separate "Fresh 2 years"
 * line — see WaitingPeriodsRow). Carry-forward cover always has SOME
 * history (that's what makes it carry-forward), so this is only ever
 * "Completed" or "X remaining" — never "Fresh". */
function carryForwardSpecificIllness(memberResult: MemberResult): { completed: boolean; remainingYears: number } {
  const carryTranches = memberResult.tranches.filter((t) => t.sinceYear !== null);
  const completed = carryTranches.length > 0 && carryTranches.every((t) => t.specificIllnessCompleted);
  const stillWaiting = carryTranches.filter((t) => !t.specificIllnessCompleted);
  const remainingYears = stillWaiting.length > 0 ? Math.max(...stillWaiting.map((t) => t.specificIllnessRemainingYears)) : 0;
  return { completed, remainingYears };
}

/** The carry-forward portion's own PED status. The PED clock runs
 * independently of cover vintage (see portingAssistEngine's own module
 * comment on PED WAITING PERIOD), so this can legitimately show "fresh" —
 * every declared/undeclared PED has 0 years served yet — even though the
 * COVER itself carries forward; WaitingPeriodsRow deliberately renders that
 * case in amber (not green), so it never misreads as "all clear". */
function carryForwardPedRemaining(memberResult: MemberResult): number {
  const active = memberResult.pedResults.filter((p) => !p.completed);
  return active.length > 0 ? Math.max(...active.map((p) => p.remainingYears)) : 0;
}

/** Header — badge + "Current Plan → Porting Plan" title + a tagline whose
 * relationship possessive is generated dynamically (see product spec
 * section 4): "Self" renders as "Your waiting-period status..." with no
 * relationship word at all; every other relationship bolds its own
 * possessive form. */
function IllustrationHeader({
  planName,
  portingPlanLabel,
  relationship,
}: {
  planName: string;
  portingPlanLabel: string;
  relationship: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          alignSelf: "flex-start",
          background: BRAND.blueBg,
          border: `1px solid ${BRAND.blueBorder}`,
          borderRadius: 999,
          padding: "6px 13px",
        }}
      >
        <ShieldCheck size={13} color={BRAND.blue} />
        <span style={{ fontSize: 14.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: BRAND.blue }}>
          Waiting-Period Carry-Forward
        </span>
      </div>
      <div style={{ fontSize: 29, fontWeight: 900, color: BRAND.navyText, lineHeight: 1.2, wordBreak: "break-word" }}>
        {planName} <span style={{ color: BRAND.grayLight, fontWeight: 800 }}>→</span> {portingPlanLabel}
      </div>
      <div style={{ fontSize: 26, fontWeight: 600, color: BRAND.gray, lineHeight: 1.4 }}>
        {isSelfRelationship(relationship) ? (
          <>
            <b style={{ color: BRAND.navyText, fontWeight: 800 }}>Your</b> waiting-period status after porting, at a glance.
          </>
        ) : (
          <>
            Your <b style={{ color: BRAND.navyText, fontWeight: 800 }}>{possessive(relationship)}</b> waiting-period status after porting, at a
            glance.
          </>
        )}
      </div>
    </div>
  );
}

/** Current Plan card (product spec section 5) — Inception Date / Base Cover
 * / Available Bonus as compact inline stats, with Total Cover (= Base Cover
 * + Available Bonus, computed here, never from the engine's own tranche
 * bookkeeping) called out in its own highlighted badge so it's never
 * missable. The plan name is NOT repeated here — it's already in the main
 * title above (see product spec section 5: "do not repeat the current plan
 * name here"). */
function CurrentPlanCard({
  inceptionDate,
  baseCoverAmount,
  bonusAmount,
}: {
  inceptionDate: string;
  baseCoverAmount: number;
  bonusAmount: number;
}) {
  const totalCover = baseCoverAmount + bonusAmount;
  return (
    <div style={{ background: BRAND.blueBg, border: `1px solid ${BRAND.blueBorder}`, borderRadius: 14, padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
        <div style={{ width: 24, height: 24, borderRadius: 7, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <FileText size={13} color={BRAND.blue} />
        </div>
        <span style={{ fontSize: 15.5, fontWeight: 900, color: BRAND.blue, textTransform: "uppercase", letterSpacing: "0.05em" }}>Current Plan</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <MiniStat icon={Calendar} label="Inception Date" value={inceptionDate ? isoDateToDMY(inceptionDate) : "—"} />
          <MiniStat icon={Database} label="Base Cover" value={`₹${formatRupees(baseCoverAmount)}`} />
          {bonusAmount > 1e-6 && <MiniStat icon={Gift} label="Available Bonus" value={`₹${formatRupees(bonusAmount)}`} />}
        </div>
        <div style={{ background: "#fff", border: `1px solid ${BRAND.blueBorder}`, borderRadius: 10, padding: "8px 16px", textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: BRAND.blue }}>Total Cover</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: BRAND.navyText }}>₹{formatRupees(totalCover)}</div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
        <Icon size={11} color={BRAND.blue} />
        <span style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: BRAND.blue, opacity: 0.85, whiteSpace: "nowrap" }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 24.5, fontWeight: 800, color: BRAND.navyText }}>{value}</div>
    </div>
  );
}

/** "Porting to" figure + carry-forward/enhanced bar + one-line explanation
 * (product spec sections 6-7) — every amount here is THIS member's own
 * carryForwardAmount/freshAmount (not the policy-level owner totals), so
 * the bar always matches the waiting-period cards below it exactly. Drops
 * whichever side is zero entirely — an all-carry-forward or all-enhanced
 * outcome renders as a single solid bar and a single legend item, never a
 * ₹0 segment (see product spec section 6). */
function PortingSummary({ portingCoverAmount, memberResult }: { portingCoverAmount: number; memberResult: MemberResult }) {
  const carry = memberResult.carryForwardAmount;
  const fresh = memberResult.freshAmount;
  const total = carry + fresh;
  const hasCarry = carry > 1e-6;
  const hasFresh = fresh > 1e-6;
  const carryPct = total > 0 ? (carry / total) * 100 : 0;
  const freshPct = total > 0 ? (fresh / total) * 100 : 0;

  const explanation = !hasFresh
    ? `Your existing ₹${formatLakhShort(carry)} cover + bonus receives waiting-period credit.`
    : !hasCarry
      ? `The entire ₹${formatLakhShort(fresh)} porting cover is enhanced cover, with fresh waiting periods.`
      : `₹${formatLakhShort(carry)} receives waiting-period credit; the remaining ₹${formatLakhShort(fresh)} is enhanced cover with fresh waiting periods.`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
        <div style={{ flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
            <PiggyBank size={12} color={BRAND.gray} />
            <span style={{ fontSize: 14, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: BRAND.gray }}>Porting to</span>
          </div>
          <div style={{ fontSize: 29, fontWeight: 900, color: BRAND.navyText, lineHeight: 1.1 }}>₹{formatRupees(portingCoverAmount)}</div>
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: "flex", width: "100%", height: 34, borderRadius: 8, overflow: "hidden" }}>
            {hasCarry && (
              <div
                style={{
                  width: `${hasFresh ? Math.max(carryPct, 10) : 100}%`,
                  background: BRAND.green,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {(carryPct >= 24 || !hasFresh) && <span style={{ fontSize: 13, fontWeight: 800, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>₹{formatRupees(carry)}</span>}
              </div>
            )}
            {hasFresh && (
              <div
                style={{
                  width: `${hasCarry ? Math.max(freshPct, 10) : 100}%`,
                  background: BRAND.coral,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {(freshPct >= 24 || !hasCarry) && <span style={{ fontSize: 13, fontWeight: 800, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>₹{formatRupees(fresh)}</span>}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 20, marginTop: 9, flexWrap: "wrap" }}>
            {hasCarry && <BarLegendItem color={BRAND.green} label="Carry-forward cover" caption="Waiting-period credit from existing cover" />}
            {hasFresh && <BarLegendItem color={BRAND.coral} label="Enhanced cover" caption="Fresh waiting periods apply" />}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, background: BRAND.greenBg, border: `1px solid ${BRAND.greenBorder}`, borderRadius: 10, padding: "10px 14px", minWidth: 0 }}>
        <CheckCircle2 size={15} color={BRAND.green} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 18, fontWeight: 700, color: BRAND.navyText, lineHeight: 1.4, minWidth: 0 }}>{explanation}</span>
      </div>
    </div>
  );
}

function BarLegendItem({ color, label, caption }: { color: string; label: string; caption: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 6, maxWidth: 270 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, marginTop: 4, flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: BRAND.navyText }}>{label}</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: BRAND.gray, lineHeight: 1.3 }}>{caption}</div>
      </div>
    </div>
  );
}

/** One of the three always-distinguishable waiting-period cards (Initial /
 * Specific Illness / PED — product spec section 8). Each shows the
 * category's standard duration once, then at most two cover-specific status
 * pills — "Carry-forward" and "Enhanced" — so the customer never has to
 * guess which portion of their new cover a status applies to (see product
 * spec section 9: never a bare "1 year remaining"). A pill is omitted
 * entirely when that cover portion doesn't exist for this member. */
function WaitingPeriodCard({
  icon: Icon,
  label,
  standardDuration,
  carryAmount,
  freshAmount,
  carry,
  fresh,
}: {
  icon: LucideIcon;
  label: string;
  standardDuration: string;
  carryAmount: number;
  freshAmount: number;
  carry: { detail: string; status: LineStatus } | null;
  fresh: { detail: string } | null;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0, background: "#fff", border: `1px solid ${BRAND.border}`, borderRadius: 14, padding: "14px 13px", display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <Icon size={14} color={BRAND.gray} style={{ flexShrink: 0 }} />
        <span
          style={{
            fontSize: 12,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.03em",
            color: BRAND.gray,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {label}
        </span>
      </div>
      <div style={{ fontSize: 19, fontWeight: 900, color: BRAND.navyText }}>{standardDuration}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {carry && <StatusPill amount={carryAmount} kindLabel="Carry-forward" style={statusStyle(carry.status)} detail={carry.detail} />}
        {fresh && <StatusPill amount={freshAmount} kindLabel="Enhanced" style={statusStyle("fresh")} detail={fresh.detail} />}
      </div>
    </div>
  );
}

function StatusPill({
  amount,
  kindLabel,
  style,
  detail,
}: {
  amount: number;
  kindLabel: string;
  style: { bg: string; border: string; fg: string; Icon: LucideIcon };
  detail: string;
}) {
  const { Icon } = style;
  return (
    <div style={{ background: style.bg, border: `1px solid ${style.border}`, borderRadius: 9, padding: "7px 9px", minWidth: 0, overflow: "hidden" }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: style.fg, marginBottom: 3, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        ₹{formatRupees(amount)} <span style={{ fontWeight: 700, opacity: 0.85 }}>{kindLabel}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
        <Icon size={11} color={style.fg} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 14.5, fontWeight: 800, color: style.fg, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail}</span>
      </div>
    </div>
  );
}

/** The core section (product spec section 8-10) — three cards, side by
 * side, each cover-specific. Carry-forward's Initial WP is always
 * "Completed" (every real/bonus-extended tranche has existed at least one
 * full policy year — see allocatePortingCover); its Specific Illness and
 * PED lines are computed from this member's own tranches/PED results (see
 * carryForwardSpecificIllness/carryForwardPedRemaining above). Enhanced
 * cover's three lines are always "Fresh" at the category's own full
 * duration, independent of any calculation — a genuinely brand-new portion
 * has no history of any kind (see portingAssistEngine's own PED WAITING
 * PERIOD module comment). */
function WaitingPeriodsRow({ memberResult }: { memberResult: MemberResult }) {
  const hasCarry = memberResult.carryForwardAmount > 1e-6;
  const hasFresh = memberResult.freshAmount > 1e-6;

  const specIllness = carryForwardSpecificIllness(memberResult);
  const pedRemaining = carryForwardPedRemaining(memberResult);
  const pedStatus = memberResult.pedStatus; // "none" | "completed" | "partial" | "fresh"

  const initialCarry: { detail: string; status: LineStatus } | null = hasCarry ? { detail: "Completed", status: "completed" } : null;
  const initialFresh = hasFresh ? { detail: `Fresh ${INITIAL_WAITING_PERIOD_DAYS} days` } : null;

  const specCarry: { detail: string; status: LineStatus } | null = hasCarry
    ? { detail: specIllness.completed ? "Completed" : `${pluralYears(specIllness.remainingYears)} remaining`, status: specIllness.completed ? "completed" : "partial" }
    : null;
  const specFresh = hasFresh ? { detail: `Fresh ${pluralYears(SPECIFIC_ILLNESS_WAITING_PERIOD_YEARS)}` } : null;

  const pedCarryDetail =
    pedStatus === "none" ? "No PED declared" : pedStatus === "completed" ? "Completed" : pedStatus === "fresh" ? `Fresh ${pluralYears(PED_WAITING_PERIOD_YEARS)}` : `${pluralYears(pedRemaining)} remaining`;
  const pedCarryStatus: LineStatus = pedStatus === "none" || pedStatus === "completed" ? "completed" : "partial";
  const pedCarry: { detail: string; status: LineStatus } | null = hasCarry ? { detail: pedCarryDetail, status: pedCarryStatus } : null;
  const pedFresh = hasFresh ? { detail: `Fresh ${pluralYears(PED_WAITING_PERIOD_YEARS)}` } : null;

  return (
    <div style={{ display: "flex", gap: 11 }}>
      <WaitingPeriodCard
        icon={Clock}
        label="Initial Waiting Period"
        standardDuration={`${INITIAL_WAITING_PERIOD_DAYS} days`}
        carryAmount={memberResult.carryForwardAmount}
        freshAmount={memberResult.freshAmount}
        carry={initialCarry}
        fresh={initialFresh}
      />
      <WaitingPeriodCard
        icon={Stethoscope}
        label="Specific Illness"
        standardDuration={pluralYears(SPECIFIC_ILLNESS_WAITING_PERIOD_YEARS)}
        carryAmount={memberResult.carryForwardAmount}
        freshAmount={memberResult.freshAmount}
        carry={specCarry}
        fresh={specFresh}
      />
      <WaitingPeriodCard
        icon={ShieldCheck}
        label="PED Waiting Period"
        standardDuration={pluralYears(PED_WAITING_PERIOD_YEARS)}
        carryAmount={memberResult.carryForwardAmount}
        freshAmount={memberResult.freshAmount}
        carry={pedCarry}
        fresh={pedFresh}
      />
    </div>
  );
}

/** PED Details table (product spec sections 11-12) — only rendered when
 * this member actually has PED results (declared or undeclared); the
 * "no PEDs at all" case is already fully covered by the PED card's own
 * "No PED declared" pill above, so no separate section is needed for it at
 * all (never an empty table). Row padding compacts automatically once there
 * are more than a few conditions, and anything past MAX_ROWS collapses into
 * a single "+N more" line — a customer-facing illustration stays a small,
 * glance-able snippet, never a spreadsheet dump. */
function PedDetailsSection({ memberResult }: { memberResult: MemberResult }) {
  const results = memberResult.pedResults;
  if (results.length === 0) return null;

  const MAX_ROWS = 5;
  const visible = results.slice(0, MAX_ROWS);
  const overflow = results.length - visible.length;
  const compact = results.length > 3;

  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${BRAND.border}`,
        borderRadius: 14,
        padding: compact ? "12px 16px" : "14px 18px",
        display: "flex",
        flexDirection: "column",
        gap: compact ? 4 : 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <ClipboardList size={13} color={BRAND.gray} />
        <span style={{ fontSize: 14.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: BRAND.gray }}>PED Details</span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1.5fr)",
          gap: 6,
          fontSize: 12,
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: "0.03em",
          color: BRAND.grayLight,
          paddingBottom: 5,
          borderBottom: `1px solid ${BRAND.border}`,
        }}
      >
        <span>Condition</span>
        <span>Declared</span>
        <span>Time Served</span>
        <span>PED Waiting Period</span>
      </div>
      {visible.map((p) => (
        <Fragment key={p.id}>
          <PedRow p={p} compact={compact} />
        </Fragment>
      ))}
      {overflow > 0 && <div style={{ fontSize: 13.5, fontWeight: 700, color: BRAND.gray, paddingTop: 2 }}>+{overflow} more condition{overflow === 1 ? "" : "s"}</div>}
    </div>
  );
}

function PedRow({ p, compact }: { p: PedResult; compact: boolean }) {
  const status: LineStatus = p.completed ? "completed" : p.servedYears === 0 ? "fresh" : "partial";
  const { Icon, fg } = statusStyle(status);
  const detail = p.completed ? "Completed" : p.servedYears === 0 ? `Fresh ${pluralYears(PED_WAITING_PERIOD_YEARS)}` : `${pluralYears(p.remainingYears)} remaining`;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1.5fr)",
        gap: 6,
        alignItems: "center",
        padding: compact ? "5px 0" : "7px 0",
        borderBottom: `1px solid ${BRAND.border}`,
      }}
    >
      <span style={{ fontSize: 15.5, fontWeight: 800, color: BRAND.navyText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.conditions || "—"}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: BRAND.gray, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.declared ? p.declaredLabel : "Not declared"}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: BRAND.gray, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.declared ? pluralYears(p.servedYears) : "–"}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, overflow: "hidden" }}>
        <Icon size={11} color={fg} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 14, fontWeight: 800, color: fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail}</span>
      </div>
    </div>
  );
}

/** Plan-specific "Important" note (product spec section 17) — only the note
 * matching the SELECTED porting plan is ever shown (see PLAN_NOTES/planNotes
 * in PortingAssistPage); irrelevant plan notes never appear. */
function PlanNoteSection({ planNotes }: { planNotes?: { title: string; lines: string[] } }) {
  if (!planNotes) return null;
  return (
    <div style={{ background: BRAND.amberBg, border: `1px solid ${BRAND.amberBorder}`, borderRadius: 12, padding: "12px 16px", display: "flex", gap: 10, alignItems: "flex-start" }}>
      <AlertTriangle size={15} color={BRAND.amber} style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em", color: BRAND.amber, marginBottom: 3 }}>
          Important — {planNotes.title}
        </div>
        <div style={{ fontSize: 22, fontWeight: 600, color: BRAND.navyText, lineHeight: 1.5 }}>{planNotes.lines.join(" ")}</div>
      </div>
    </div>
  );
}

function IllustrationFooter() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: "auto", paddingTop: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <img src={DITTO_LOGO_DATA_URI} alt="ditto" style={{ height: 22, width: "auto", display: "block" }} />
        <span style={{ fontSize: 14.5, fontWeight: 600, color: BRAND.gray }}>For a healthier tomorrow.</span>
      </div>
      <span style={{ fontSize: 15, fontWeight: 700, color: BRAND.blue }}>join.ditto.in</span>
    </div>
  );
}

/**
 * One member's complete, independent, customer-shareable illustration —
 * always exactly CANVAS_WIDTH×CANVAS_HEIGHT (1080×1350, 4:5 portrait), with
 * `overflow: hidden` as a hard guarantee that content NEVER grows the
 * canvas (see this section's own module comment above): every sub-section
 * is written to compact itself first (tighter PED-row padding, omitted
 * sections) long before that safety net would ever have to actually clip
 * anything. The footer is pinned to the very bottom via `marginTop: auto`
 * on a flex column, so a member with fewer applicable sections (no PEDs, no
 * plan note) never leaves a conspicuous gap mid-card — the extra room
 * simply collects as breathing space above the footer.
 */
function MemberIllustration({
  memberResult,
  context,
  planNotes,
}: {
  memberResult: MemberResult;
  context: {
    planName: string;
    inceptionDate: string;
    currentCoverAmount: number;
    portingPlanLabel: string;
    bonusAmount: number;
    portingCoverAmount: number;
  };
  planNotes?: { title: string; lines: string[] };
}) {
  return (
    <div
      style={{
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        background: "#fff",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        padding: "44px 46px 32px",
        boxSizing: "border-box",
      }}
    >
      <IllustrationHeader planName={context.planName} portingPlanLabel={context.portingPlanLabel} relationship={memberResult.relationship} />
      <div style={{ height: 20 }} />
      <CurrentPlanCard inceptionDate={context.inceptionDate} baseCoverAmount={context.currentCoverAmount} bonusAmount={context.bonusAmount} />
      <div style={{ height: 20 }} />
      <PortingSummary portingCoverAmount={context.portingCoverAmount} memberResult={memberResult} />
      <div style={{ height: 22 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 13 }}>
        <User size={14} color={BRAND.gray} />
        <span style={{ fontSize: 18, fontWeight: 900, color: BRAND.navyText }}>Waiting-Period Status — {memberResult.relationship}</span>
      </div>
      <WaitingPeriodsRow memberResult={memberResult} />
      {memberResult.pedResults.length > 0 && <div style={{ height: 16 }} />}
      <PedDetailsSection memberResult={memberResult} />
      {planNotes && <div style={{ height: 16 }} />}
      <PlanNoteSection planNotes={planNotes} />
      <IllustrationFooter />
    </div>
  );
}

export default PortingAssistPage;
