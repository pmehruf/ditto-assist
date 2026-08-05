/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * UNIFIED announcement formatting pipeline (v3).
 *
 * The previous implementation stored announcements in a custom plain-markup
 * grammar (*bold*, ~underline~, [red]...[/red], "• " lines...) and converted
 * between that grammar and the editor's HTML in BOTH directions, with a
 * third, separate regex renderer for the published view. Three parsers over
 * one ambiguous grammar drifted apart repeatedly — nested formatting,
 * line breaks inside styled runs, and theme-dependent color hexes each
 * produced published output that didn't match the editor. (See the git
 * history of announcementEditorHtml.ts / renderFormattedAnnouncement.tsx
 * for the chain of patches this replaces.)
 *
 * v3 stores WHAT THE EDITOR SHOWS: the contentEditable's own HTML, passed
 * through a strict whitelist sanitizer, prefixed with a format sentinel.
 * The published view renders that exact same sanitized HTML with the exact
 * same CSS class set (see announcementSurfaceClasses). There is no
 * conversion step left to disagree with the editor — WYSIWYG by
 * construction.
 *
 * Legacy content (rows saved before v3, no sentinel prefix) is converted
 * one-way through the old markup->HTML importer (markupToEditableHtml, the
 * well-tested half of the old system) and then flows through the same
 * sanitizer + renderer as everything else. The first time a legacy row is
 * edited and saved it becomes v3 HTML permanently.
 *
 * Display-only text decorations — auto-linked bare URLs and the "rated N"
 * chip badges — are applied to TEXT NODES only, after sanitization. They
 * never alter structure or characters, so they cannot cause editor/published
 * divergence beyond their own intentional styling.
 *
 * SECURITY: the sanitizer rebuilds every node from scratch against a strict
 * whitelist (elements, attributes, and CSS color values are all validated).
 * Nothing from the input HTML is ever copied wholesale into the output, so
 * script tags, event handlers, javascript: URLs and arbitrary styles cannot
 * survive — a requirement now that stored HTML is re-injected via
 * dangerouslySetInnerHTML.
 */

import { markupToEditableHtml } from "./announcementEditorHtml";

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

/** Prefix marking a v3 (sanitized-HTML) announcement body. Anything without
 * it is legacy plain-markup and goes through the legacy importer. */
export const HTML_ANNOUNCEMENT_SENTINEL = "<!--fmt:html-->";

export function isHtmlAnnouncement(content: string): boolean {
  return content.startsWith(HTML_ANNOUNCEMENT_SENTINEL);
}

// ---------------------------------------------------------------------------
// Color palette (single source of truth; formerly renderFormattedAnnouncement's COLOR_HEX)
// ---------------------------------------------------------------------------

/**
 * Named text-color palette (Google Chat-style: red, blue, green, yellow,
 * gray — plus the default-ink swatch handled by the picker itself).
 * "orange" is LEGACY-ONLY: removed from the picker per design feedback, but
 * kept resolvable here so every announcement that already used it (and
 * legacy [orange]...[/orange] markup) keeps rendering correctly.
 */
export const COLOR_HEX: Record<string, { light: string; dark: string }> = {
  red: { light: "#ef4444", dark: "#ef4444" },
  blue: { light: "#0754B7", dark: "#00D3F3" },
  green: { light: "#059669", dark: "#10b981" },
  yellow: { light: "#a16207", dark: "#fbbf24" },
  gray: { light: "#57534e", dark: "#9ca3af" },
  orange: { light: "#92400e", dark: "#b45309" }, // legacy only — not in the picker
};

/**
 * The editor's "Default (Black/White)" swatch — picking it (or hitting
 * "Clear Formatting") applies THIS theme's own body-ink color via
 * `execCommand('foreColor', ...)`, because passing an unparseable value
 * like "inherit" makes Chromium silently fall back to an internal default
 * that renders brownish (see QAAnnouncementForm.tsx's applyColor). Exported
 * so the editor and the sanitizer agree on exactly what "default" means.
 */
export const DEFAULT_INK: { light: string; dark: string } = { light: "#111827", dark: "#f5f5f4" };

type NamedColor = keyof typeof COLOR_HEX;

/**
 * True if `cssColor` is literally one of DEFAULT_INK's two values (in
 * either hex or the rgb()/rgba() form the browser may normalize execCommand
 * output to) — i.e. "no real color choice was made, this is just the
 * theme's own default text color at the moment it was authored."
 *
 * THIS WAS THE ROOT CAUSE of the readability regression: `wrapColor` below
 * used to fall through to preserving any far-from-palette raw color
 * literally forever (the `isSafeColorValue` branch), on the theory —
 * stated in a since-stale comment on the old default-color logic — that
 * the sanitizer treated such colors as "no color". It never did. So
 * picking "Default" while authoring in Dark theme baked in a literal
 * near-white hex that stayed near-white (unreadable) when the SAME
 * announcement was later viewed in Light theme, and vice versa — visible
 * everywhere that renders announcement content (the Mark-as-Read modal,
 * the General Announcement modal, the lookup carousel) because they all
 * share this one sanitizer. Recognizing these two specific literals as
 * "not a real color" and letting them fall through to `under` (inherit the
 * viewer's own ambient text color) fixes it at the source, for every
 * announcement ever saved with this pattern — no data migration needed,
 * since sanitization re-runs on every render.
 */
function isDefaultInkColor(cssColor: string): boolean {
  const c = cssColor.trim().toLowerCase();
  const hex = c.startsWith("#") ? c : rgbStringToHex(c);
  return hex === DEFAULT_INK.light.toLowerCase() || hex === DEFAULT_INK.dark.toLowerCase();
}

function rgbStringToHex(rgb: string): string | null {
  const match = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!match) return null;
  const toHex = (n: string) => Number(n).toString(16).padStart(2, "0");
  return `#${toHex(match[1])}${toHex(match[2])}${toHex(match[3])}`.toLowerCase();
}

function hexToRgbTuple(hex: string): [number, number, number] | null {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Accepts #rgb / #rrggbb / #rrggbbaa (alpha ignored) or rgb()/rgba() and
 * returns an [r,g,b] tuple, or null if unparseable. */
function normalizeToRgbTuple(value: string): [number, number, number] | null {
  const v = value.trim().toLowerCase();
  if (v.startsWith("#")) {
    const hex = v.slice(1);
    if (hex.length === 3) return hexToRgbTuple(`#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`);
    if (hex.length === 6 || hex.length === 8) return hexToRgbTuple(`#${hex.slice(0, 6)}`);
    return null;
  }
  const hex = rgbStringToHex(v);
  return hex ? hexToRgbTuple(hex) : null;
}

/** WCAG relative luminance. */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG contrast ratio (1–21) between two [r,g,b] tuples. */
function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Maps an arbitrary CSS color to one of the 4 named palette colors when it
 * is (near-)identical to EITHER theme's hex for that name — the stored
 * notion of "blue" is theme-independent; only the on-screen hex varies. */
function resolveNamedColor(cssColor: string): NamedColor | null {
  const hex = cssColor.trim().startsWith("#") ? cssColor.trim().toLowerCase() : rgbStringToHex(cssColor);
  const target = hex ? hexToRgbTuple(hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex) : null;
  if (!target) return null;
  let best: { name: NamedColor; d: number } | null = null;
  for (const name of Object.keys(COLOR_HEX) as NamedColor[]) {
    for (const themeKey of ["light", "dark"] as const) {
      const cand = hexToRgbTuple(COLOR_HEX[name][themeKey]);
      if (!cand) continue;
      const d = Math.sqrt((target[0] - cand[0]) ** 2 + (target[1] - cand[1]) ** 2 + (target[2] - cand[2]) ** 2);
      if (!best || d < best.d) best = { name, d };
    }
  }
  return best && best.d <= 25 ? best.name : null;
}

/** Only plain hex / rgb() color values survive sanitization — anything else
 * (var(), url(), expressions) is dropped. */
function isSafeColorValue(value: string): boolean {
  return /^#[0-9a-f]{3,8}$/i.test(value.trim()) || /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/i.test(value.trim());
}

// ---------------------------------------------------------------------------
// Sanitizer — rebuilds allowed structure from scratch
// ---------------------------------------------------------------------------

const BLOCK_TAGS = new Set(["DIV", "P", "BLOCKQUOTE", "UL", "OL", "LI"]);

function styleProp(el: Element, prop: string): string | null {
  const styleAttr = el.getAttribute("style");
  if (!styleAttr) return null;
  const m = styleAttr.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i"));
  return m ? m[1].trim() : null;
}

/**
 * Sanitizes arbitrary editor/stored HTML into the strict allowed subset.
 * `theme` decides which hex the 4 named palette colors materialize as (the
 * name itself is stored on a data-color attribute so re-sanitizing under the
 * other theme re-maps it — this is what keeps author-picked colors correct
 * when the reader uses the opposite theme).
 */
export function sanitizeAnnouncementHtml(html: string, theme: "light" | "dark"): string {
  const doc = new DOMParser().parseFromString(`<div id="__root__">${html}</div>`, "text/html");
  const root = doc.getElementById("__root__");
  if (!root) return "";
  const out = doc.createElement("div");

  const cleanChildren = (from: Node, into: Element) => {
    from.childNodes.forEach((child) => cleanNode(child, into));
  };

  const cleanNode = (node: Node, into: Element): void => {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      into.appendChild(doc.createTextNode(node.textContent ?? ""));
      return;
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return;
    const el = node as Element;
    const tag = el.tagName;

    if (tag === "BR") {
      into.appendChild(doc.createElement("br"));
      return;
    }

    if (tag === "B" || tag === "STRONG" || tag === "I" || tag === "EM" || tag === "U") {
      const mapped = tag === "STRONG" ? "b" : tag === "EM" ? "i" : tag.toLowerCase();
      const wrapper = doc.createElement(mapped);
      // A color set directly on the formatting element (legacy bold+red
      // import, or a browser that merged the styles) is preserved as a
      // nested span so nothing is lost.
      const colored = wrapColor(el, wrapper);
      cleanChildren(el, colored);
      into.appendChild(wrapper);
      return;
    }

    if (tag === "CODE") {
      const code = doc.createElement("code");
      code.textContent = el.textContent ?? "";
      into.appendChild(code);
      return;
    }

    if (tag === "A") {
      const href = el.getAttribute("href") || "";
      if (/^https?:\/\//i.test(href)) {
        const a = doc.createElement("a");
        a.setAttribute("href", href);
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
        cleanChildren(el, a);
        into.appendChild(a);
        return;
      }
      cleanChildren(el, into); // invalid scheme — keep the text, drop the link
      return;
    }

    if (tag === "SPAN" || tag === "FONT") {
      // Chrome sometimes expresses bold/italic/underline as CSS on a span
      // (execCommand styleWithCSS) — canonicalize to real elements so the
      // stored HTML has exactly one representation per style.
      let target: Element = into;
      const fw = styleProp(el, "font-weight");
      if (fw && /^(bold|[5-9]00)$/i.test(fw)) {
        const b = doc.createElement("b");
        target.appendChild(b);
        target = b;
      }
      if (/italic/i.test(styleProp(el, "font-style") || "")) {
        const i = doc.createElement("i");
        target.appendChild(i);
        target = i;
      }
      if (/underline/i.test(styleProp(el, "text-decoration") || styleProp(el, "text-decoration-line") || "")) {
        const u = doc.createElement("u");
        target.appendChild(u);
        target = u;
      }
      const colored = wrapColor(el, target);
      cleanChildren(el, colored);
      return;
    }

    if (BLOCK_TAGS.has(tag)) {
      // Chrome's execCommand("indent") on a non-list line produces a
      // BLOCKQUOTE carrying "margin: 0 0 0 40px; border: none; padding: 0"
      // — that's an INDENT, not a quote. Detect it by the margin and map to
      // a margin-left div (nesting accumulates naturally for deeper
      // indents), so it never picks up the real blockquote's border/padding
      // styling. Real (toolbar) quotes have no inline margin.
      const marginLeft =
        styleProp(el, "margin-left") ?? (styleProp(el, "margin") || "").match(/^0(?:px)?\s+0(?:px)?\s+0(?:px)?\s+(\d+px)/)?.[1] ?? null;
      const marginPx = marginLeft !== null ? Math.min(400, Math.max(0, parseInt(marginLeft, 10) || 0)) : 0;
      // An indent is a margin-carrying BLOCKQUOTE (Chrome's execCommand
      // "indent" output) or a DIV that already carries the sanitized
      // margin-left from a previous save — both keep the margin, neither
      // gets quote styling.
      const isIndent = (tag === "BLOCKQUOTE" || tag === "DIV") && marginPx > 0;
      const mapped = tag === "P" || isIndent ? "div" : tag.toLowerCase();
      const block = doc.createElement(mapped);
      if (isIndent) block.setAttribute("style", `margin-left:${marginPx}px`);
      cleanChildren(el, block);
      into.appendChild(block);
      return;
    }

    // Unknown element (pasted junk, deprecated tags) — unwrap, keep content.
    cleanChildren(el, into);
  };

  /** If `el` carries a usable color, appends a color span under `under` and
   * returns it (as the new parent for children); otherwise returns `under`. */
  const wrapColor = (el: Element, under: Element): Element => {
    const named = (el.getAttribute("data-color") as NamedColor | null) && COLOR_HEX[el.getAttribute("data-color") as NamedColor]
      ? (el.getAttribute("data-color") as NamedColor)
      : null;
    const raw = styleProp(el, "color") || (el.tagName === "FONT" ? el.getAttribute("color") : null);
    const resolved = named ?? (raw ? resolveNamedColor(raw) : null);
    if (resolved) {
      const span = doc.createElement("span");
      span.setAttribute("data-color", resolved);
      span.setAttribute("style", `color:${COLOR_HEX[resolved][theme]}`);
      under.appendChild(span);
      return span;
    }
    if (raw && isDefaultInkColor(raw)) {
      // "No real color" — see isDefaultInkColor's comment. Deliberately no
      // span at all, so the text inherits whatever ambient color the
      // viewer (modal, carousel, editor) applies for the CURRENT theme,
      // instead of being frozen at whichever theme's ink color it happened
      // to be authored under.
      return under;
    }
    if (raw && isSafeColorValue(raw)) {
      // Contrast guard — catches near-invisible literal colors that aren't
      // an exact match for isDefaultInkColor's two known hexes (a browser
      // can round execCommand's color output by a few RGB units, and pasted
      // content can carry its own arbitrary inline color, e.g. light-gray
      // "muted" text from Word/Gmail). Rather than preserve a color that
      // will render illegibly against the surface it's about to sit on,
      // check its contrast against that surface (white for
      // forceLightContrast / light theme, near-black for dark theme — the
      // same assumption isDefaultInkColor already relies on) and drop it to
      // inherit the ambient ink color if it's below a "clearly broken"
      // threshold. This is deliberately a low bar (2.5:1, well under WCAG's
      // 4.5:1 AA) — it's here to catch genuinely invisible/near-invisible
      // text, not to second-guess an author's legitimate (if imperfect)
      // color choice.
      const rgb = normalizeToRgbTuple(raw);
      const bg: [number, number, number] = theme === "light" ? [255, 255, 255] : [10, 10, 12];
      if (rgb && contrastRatio(rgb, bg) < 2.5) {
        return under;
      }
      const span = doc.createElement("span");
      span.setAttribute("style", `color:${raw}`);
      under.appendChild(span);
      return span;
    }
    return under;
  };

  cleanChildren(root, out);
  return out.innerHTML;
}

// ---------------------------------------------------------------------------
// Content -> editor HTML / display HTML
// ---------------------------------------------------------------------------

/** The HTML loaded into the contentEditable editor. v3 content is just
 * re-sanitized (idempotent); legacy markup goes through the old importer
 * first and comes out as the same HTML subset. */
export function announcementContentToEditorHtml(content: string, theme: "light" | "dark"): string {
  const html = isHtmlAnnouncement(content)
    ? content.slice(HTML_ANNOUNCEMENT_SENTINEL.length)
    : markupToEditableHtml(content, theme);
  const clean = sanitizeAnnouncementHtml(html, theme);
  return clean === "" ? "<div><br></div>" : clean;
}

/** What the editor saves: sentinel + sanitized snapshot of its own DOM. */
export function editorHtmlToStoredContent(editorHtml: string, theme: "light" | "dark"): string {
  return HTML_ANNOUNCEMENT_SENTINEL + sanitizeAnnouncementHtml(editorHtml, theme);
}

const RATING_REGEX =
  /\b(Rating\s*:\s*-?[1-5]|Rating\s+-?[1-5]|Rated\s*:\s*-?[1-5]|Rated\s+-?[1-5]|rating\s*:\s*-?[1-5]|rating\s+-?[1-5]|rated\s*:\s*-?[1-5]|rated\s+-?[1-5]|R-?[1-5]|r-?[1-5])\b/g;
const URL_REGEX = /(https?:\/\/[^\s<>"')]+)/g;

function ratingChipClasses(n: number, theme: "light" | "dark"): string {
  const base = "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold mx-0.5 border";
  const dark = theme === "dark";
  if (n === 1) return `${base} ${dark ? "bg-red-500/15 text-red-400 border-red-500/25" : "bg-red-50 text-red-700 border-red-200"} font-extrabold`;
  if (n === 2) return `${base} ${dark ? "bg-orange-500/10 text-orange-400 border-orange-500/20" : "bg-orange-50 text-orange-700 border-orange-200"} font-extrabold`;
  if (n === 3) return `${base} ${dark ? "bg-amber-500/10 text-amber-400 border-amber-500/15" : "bg-amber-50 text-amber-800 border-amber-200"} font-extrabold`;
  if (n === 4) return `${base} bg-[#E1EAF7] text-[#0754B7] border-[#B9D2F2] font-extrabold`;
  return `${base} ${dark ? "bg-teal-500/10 text-teal-400 border-teal-500/15" : "bg-teal-50 text-teal-800 border-teal-200"} font-extrabold`;
}

/**
 * Display-only text-node decoration: bare URLs become real links, "rated N"
 * phrases become chip badges. Runs on the already-sanitized DOM and only
 * ever REPLACES a text node with (text | a | span)* of the same combined
 * text, so document structure and characters are untouched.
 */
function enhanceForDisplay(sanitizedHtml: string, theme: "light" | "dark"): string {
  const doc = new DOMParser().parseFromString(`<div id="__root__">${sanitizedHtml}</div>`, "text/html");
  const root = doc.getElementById("__root__");
  if (!root) return sanitizedHtml;
  const linkColor = theme === "dark" ? "#00D3F3" : "#0754B7";

  const decorate = (textNode: Node) => {
    const text = textNode.textContent ?? "";
    RATING_REGEX.lastIndex = 0;
    URL_REGEX.lastIndex = 0;
    if (!RATING_REGEX.test(text) && !URL_REGEX.test(text)) return;
    const frag = doc.createDocumentFragment();
    // Ratings first, then URLs inside the non-rating remnants.
    text.split(RATING_REGEX).forEach((part, idx) => {
      if (idx % 2 === 1) {
        const n = parseInt(part.match(/-?[1-5]/)?.[0] ?? "1", 10);
        const chip = doc.createElement("span");
        chip.setAttribute("class", ratingChipClasses(n, theme));
        chip.textContent = part;
        frag.appendChild(chip);
        return;
      }
      part.split(URL_REGEX).forEach((seg, segIdx) => {
        if (segIdx % 2 === 1) {
          const a = doc.createElement("a");
          a.setAttribute("href", seg);
          a.setAttribute("target", "_blank");
          a.setAttribute("rel", "noopener noreferrer");
          a.setAttribute("style", `color:${linkColor}`);
          a.setAttribute("class", "underline underline-offset-2 decoration-1 break-all font-semibold");
          a.textContent = seg;
          frag.appendChild(a);
        } else if (seg !== "") {
          frag.appendChild(doc.createTextNode(seg));
        }
      });
    });
    textNode.parentNode?.replaceChild(frag, textNode);
  };

  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      const parentTag = (node.parentNode as Element | null)?.tagName;
      if (parentTag !== "A" && parentTag !== "CODE") decorate(node);
      return;
    }
    // Snapshot first — decoration replaces nodes in place.
    Array.from(node.childNodes).forEach(walk);
  };
  walk(root);
  return root.innerHTML;
}

/** Final display HTML for any stored announcement content (v3 or legacy). */
export function announcementContentToDisplayHtml(content: string, theme: "light" | "dark"): string {
  return enhanceForDisplay(announcementContentToEditorHtml(content, theme), theme);
}

// ---------------------------------------------------------------------------
// Shared surface styling + the one true render component
// ---------------------------------------------------------------------------

/**
 * The exact structural CSS shared by the editor surface and the published
 * announcement — same list indents, same blockquote treatment, same code
 * chips, same link styling. Blockquotes are deliberately NOT forced italic:
 * italics inside a quote are the author's choice via the toolbar.
 */
export function announcementSurfaceClasses(theme: "light" | "dark"): string {
  const structural =
    "text-xs leading-relaxed text-left [&_div]:min-h-[1.2em] " +
    "[&_blockquote]:pl-3 [&_blockquote]:border-l-2 [&_blockquote]:my-1 " +
    "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul_ul]:list-[circle] " +
    "[&_a]:underline [&_a]:underline-offset-2 " +
    "[&_code]:font-mono [&_code]:text-[0.92em] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded";
  return theme === "dark"
    ? `${structural} [&_blockquote]:border-white/20 [&_a]:text-[#00D3F3] [&_code]:bg-white/10`
    : `${structural} [&_blockquote]:border-black/15 [&_a]:text-[#0754B7] [&_code]:bg-black/[0.06]`;
}

/**
 * THE renderer for published announcement content — used by the manager
 * gallery, the lookup-page carousel, and the read-and-acknowledge modal.
 * `forceLightContrast` keeps supporting the QA card's fixed light-blue
 * background regardless of the ambient theme (same contract the old
 * renderer had).
 */
export function AnnouncementContent({
  content,
  theme,
  forceLightContrast,
  className = "",
}: {
  content: string;
  theme: "light" | "dark";
  forceLightContrast?: boolean;
  className?: string;
}) {
  const effectiveTheme: "light" | "dark" = forceLightContrast ? "light" : theme;
  return (
    <div
      className={`${announcementSurfaceClasses(effectiveTheme)} ${className}`}
      // Safe by construction: announcementContentToDisplayHtml output is
      // fully rebuilt against the whitelist sanitizer above — no input
      // markup ever reaches this string unvalidated.
      dangerouslySetInnerHTML={{ __html: announcementContentToDisplayHtml(content, effectiveTheme) }}
    />
  );
}
