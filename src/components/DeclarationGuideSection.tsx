/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Scissors, BedDouble, Pill, FlaskConical, Check, AlertTriangle } from "lucide-react";

interface DeclarationGuideSectionProps {
  theme: "light" | "dark";
}

/** A main category inside a card (e.g. "Cured / one-time") — rendered as
 * the card's prominent sub-heading, with its examples and its single
 * requirement row (badge + question) beneath it. */
type Badge = "MANDATORY" | "OPTIONAL" | "ONLY";

/** A matte colour as used on dark vs light surfaces. */
interface Tone {
  dark: string;
  light: string;
}

interface BranchCase {
  label: string;
  /** Shown exactly as written, e.g. "(cataract, kidney stones)". */
  example?: string;
  requirements?: { badge: Badge; text: string }[];
}

interface Branch {
  id: string;
  /** Card title, e.g. "PED × Surgery". */
  title: string;
  icon: typeof Scissors;
  /** Matte accent for this branch's card (surgery=mustard yellow,
   * hospitalization=steel blue, medication=sage, investigative
   * tests=lavender) — one tone per theme: a softer, lighter tint on dark
   * surfaces and a deeper one on light surfaces so the main-category text
   * stays readable. Deliberately low-saturation for long-term viewing. */
  accent: Tone;
  cases: BranchCase[];
  optionsHeading: string;
  options: string[];
  /** "numbered" = 1. 2. 3. list; "bulleted" = bullets whose text already
   * carries its own marker (e.g. "P0. …"). */
  optionsStyle: "numbered" | "bulleted";
  method?: string[];
  methodHeading?: string;
  note?: string;
}

// Card content — copied verbatim from the user's Declaration Guide copy
// (2026-10). Every point is listed; nothing is paraphrased.
const BRANCHES: Branch[] = [
  {
    id: "surgery",
    title: "PED × Surgery",
    icon: Scissors,
    accent: { dark: "#D2B76A", light: "#8F7425" },
    cases: [
      {
        label: "Cured / one-time",
        example: "(cataract, kidney stones)",
        requirements: [
          { badge: "MANDATORY", text: "Surgery question" },
          { badge: "OPTIONAL", text: "PED Question" },
        ],
      },
      {
        label: "Active / ongoing",
        example: "(CAD + angioplasty)",
        requirements: [{ badge: "MANDATORY", text: "PED question" }],
      },
    ],
    optionsHeading: "DECLARATION OPTIONS (SURGERY)",
    options: ["Same PED question", "Surgery question", "Others section"],
    optionsStyle: "numbered",
  },
  {
    id: "hospitalization",
    title: "PED × Hospitalization",
    icon: BedDouble,
    accent: { dark: "#86AFCB", light: "#3F6A88" },
    cases: [
      {
        label: "Non-active / one-time",
        example: "(dengue, COVID)",
        requirements: [{ badge: "ONLY", text: "Hospitalization question" }],
      },
      {
        label: "Active / ongoing",
        example: "(Spondylitis, arthritis)",
        requirements: [{ badge: "MANDATORY", text: "PED question" }],
      },
    ],
    optionsHeading: "DECLARATION OPTIONS (HOSPITALIZATION)",
    options: ["Same PED question", "Hospitalization question", "Others section"],
    optionsStyle: "numbered",
  },
  {
    id: "medication",
    title: "PED × Medication",
    icon: Pill,
    accent: { dark: "#8DBCA3", light: "#3F7559" },
    cases: [
      {
        label: "Regular Medications",
        example: "e.g. diabetes, hypothyroid",
        requirements: [{ badge: "MANDATORY", text: "PED question" }],
      },
    ],
    optionsHeading: "DECLARATION OPTIONS (MEDICATION)",
    options: ["Same PED question", "Regular medicines question", "Others section"],
    optionsStyle: "numbered",
    note: "Medicine names are not mandatory — declaration like “Medication for hypertension is ongoing.” is enough.",
  },
  {
    id: "investigative-tests",
    title: "PED × Investigative Tests",
    icon: FlaskConical,
    accent: { dark: "#AEA2D2", light: "#65588F" },
    cases: [{ label: "Mandatory with or without — Findings, diagnosis, or report" }],
    optionsHeading: "DECLARATION OPTIONS (INVESTIGATIVE TESTS)",
    options: ["P0. Investigative tests question", "P1. Others section"],
    optionsStyle: "bulleted",
    methodHeading: "DECLARATION METHOD (INVESTIGATIVE TESTS)",
    method: [
      "General tests: “Medical tests were done.”",
      "7 critical tests — name exactly: angiography, TMT / stress test, ECG, MRI, endoscopy, colonoscopy, USG",
    ],
  },
];

/** Card text hierarchy: primary = card title and main categories,
 * secondary = requirement text, muted = examples and notes, label =
 * DECLARATION OPTIONS/METHOD headings, body = option/method lists. Colors
 * come straight from the theme tokens (inline style) because index.css
 * remaps many stock text-stone-* classes per theme, which flattens a
 * class-based hierarchy. Light --text-muted is near-black, so light muted
 * uses its own soft slate. */
function cardText(theme: "light" | "dark") {
  return {
    primary: { color: "var(--text-primary)" },
    secondary: { color: "var(--text-secondary)" },
    muted: { color: theme === "dark" ? "var(--text-muted)" : "#6B7686" },
    body: { color: "var(--text-secondary)", opacity: 0.88 },
  };
}

/** Matte badge colours (text; the background is the same tone at low
 * alpha) — muted rose/teal/steel instead of the stock saturated ones. */
const BADGE_TONE: Record<Badge, Tone> = {
  MANDATORY: { dark: "#D99A9A", light: "#A34F4F" },
  OPTIONAL: { dark: "#8CC2BA", light: "#3D7A72" },
  ONLY: { dark: "#93B4D4", light: "#41698E" },
};

/** `#rrggbb` → rgba() at the given alpha. */
function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** A main category, written like the DECLARATION OPTIONS labels (bold,
 * uppercase, tracked) in the card's accent colour, with its requirement
 * rows (badge + question) beneath it. Same 12px size as the rest of the
 * card content — only the card title is larger. */
function CaseBlock({ branchCase, accent, theme }: { branchCase: BranchCase; accent: string; theme: "light" | "dark" }) {
  const t = cardText(theme);
  return (
    <div>
      <p className="text-xs font-extrabold uppercase tracking-wide leading-snug" style={{ color: accent }}>
        {branchCase.label}
        {branchCase.example && <span className="ml-1.5 font-semibold opacity-75">{branchCase.example}</span>}
      </p>
      {branchCase.requirements?.map((r) => (
        <div key={r.badge + r.text} className="mt-2 [@media(max-height:799px)]:mt-1 flex items-center gap-2.5 flex-wrap">
          <span
            className="shrink-0 text-xs font-black uppercase tracking-wide px-2 py-0.5 rounded"
            style={{ color: BADGE_TONE[r.badge][theme], backgroundColor: withAlpha(BADGE_TONE[r.badge][theme], theme === "dark" ? 0.14 : 0.1) }}
          >
            {r.badge}
          </span>
          <span className="text-xs font-semibold" style={t.secondary}>
            {r.text}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * "Declaration Guide" section — full-width, one static card per branch,
 * every point always visible (no expand/collapse). Sits below the Mapping
 * Engine's input row.
 */
export function DeclarationGuideSection({ theme }: DeclarationGuideSectionProps) {
  const t = cardText(theme);
  const labelClass = `block text-xs font-bold tracking-wide mb-2 ${theme === "dark" ? "text-[#A7BBD3]" : "text-stone-500"}`;
  const divider = theme === "dark" ? "border-white/[0.08]" : "border-stone-200";

  return (
    // mt-2: a little extra separation from the workspace row above.
    // Spacing inside the cards is roomier on taller screens; on short
    // screens (under 800px tall) it falls back to the compact values so the
    // page still fits without scrolling — text sizes never change.
    // flex-1 + the cards grid's flex-1: fills the page's bottom half, with
    // the four cards stretching to the available height.
    <div className="w-full mt-2 flex-1 min-h-0 flex flex-col">
      {/* Header row doubles as the divider between the Mapping Engine's
          working row and the cards (title + hairline rule). */}
      <div className="flex items-center gap-3 mb-3 [@media(max-height:799px)]:mb-2.5">
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="w-6 h-0.5 flex-shrink-0"
            style={{ backgroundColor: "var(--accent)" }}
          />
          <h3
            className={`text-xs font-black uppercase tracking-widest ${
              theme === "dark" ? "text-stone-200" : "text-stone-850"
            }`}
          >
            Declaration Guide
          </h3>
        </div>
        <div
          aria-hidden="true"
          className={`flex-1 min-w-[24px] border-t ${theme === "dark" ? "border-white/[0.08]" : "border-stone-300/70"}`}
        />
      </div>

      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
        {BRANCHES.map((branch) => {
          const Icon = branch.icon;
          const accent = branch.accent[theme];
          const ListTag = branch.optionsStyle === "numbered" ? "ol" : "ul";
          return (
            <div
              key={branch.id}
              className={`rounded-2xl border px-5 pt-4 pb-3 flex flex-col gap-2.5 [@media(max-height:799px)]:pt-3.5 [@media(max-height:799px)]:pb-2.5 [@media(max-height:799px)]:gap-2 ${
                theme === "dark" ? "bg-white/[0.03]" : "bg-white shadow-xs"
              }`}
              style={{
                borderColor: theme === "dark" ? "rgba(255,255,255,0.1)" : "#e7e5e4",
                borderTopWidth: "3px",
                borderTopColor: accent,
              }}
            >
              <div className="flex items-center gap-3 mb-0.5">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: withAlpha(accent, theme === "dark" ? 0.14 : 0.1) }}
                >
                  <Icon className="w-4 h-4" style={{ color: accent }} />
                </div>
                <h4 className="min-w-0 text-sm font-black leading-snug" style={t.primary}>
                  {branch.title}
                </h4>
              </div>

              <div className="flex flex-col gap-3 [@media(max-height:799px)]:gap-2">
                {branch.cases.map((c) => (
                  <div key={c.label}><CaseBlock branchCase={c} accent={accent} theme={theme} /></div>
                ))}
              </div>

              <div className={`pt-3 [@media(max-height:799px)]:pt-2 border-t ${divider}`}>
                <span className={labelClass}>{branch.optionsHeading}</span>
                <ListTag
                  className={`${branch.optionsStyle === "numbered" ? "list-decimal" : "list-disc"} pl-4 text-xs font-medium space-y-[3px] [@media(max-height:799px)]:space-y-0.5`}
                  style={t.body}
                >
                  {branch.options.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ListTag>
              </div>

              {branch.method && (
                <div className={`pt-3 [@media(max-height:799px)]:pt-2 border-t ${divider}`}>
                  <span className={labelClass}>{branch.methodHeading}</span>
                  <ul className="list-disc pl-4 text-xs font-medium space-y-[3px] [@media(max-height:799px)]:space-y-0.5" style={t.body}>
                    {branch.method.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}

              {branch.note && (
                <p
                  className={`text-xs leading-snug border rounded-lg px-3 py-2 ${
                    theme === "dark" ? "bg-white/5 border-white/5" : "bg-[#F1F6FB] border-stone-200"
                  }`}
                  style={t.muted}
                >
                  {branch.note}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Advisory strip — rules that apply regardless of branch, kept
          visually secondary below the cards: first message left, second
          right. */}
      <div className="mt-1.5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-x-6 gap-y-1 px-1">
        <div className="flex items-start gap-1.5 min-w-0">
          <Check className="w-3.5 h-3.5 shrink-0 mt-px text-emerald-500" />
          <span className="text-[11px] leading-snug" style={t.muted}>
            Others is optional if the main journey question already covers all relevant details.
          </span>
        </div>
        <div className="flex items-start gap-1.5 min-w-0">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px text-amber-500" />
          <span className="text-[11px] leading-snug" style={t.muted}>
            Avoid saying reports or details are unavailable.
          </span>
        </div>
      </div>
    </div>
  );
}
