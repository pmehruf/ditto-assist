/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { COLOR_HEX } from "./renderFormattedAnnouncement";

/**
 * Two-way conversion between the plain-markup-token announcement format
 * (*bold*, _italic_, legacy **bold+red**, [color]...[/color], "> " quote
 * lines, "• " bullet lines, [label](url) links -- see
 * renderFormattedAnnouncement.tsx's file header for the full grammar this
 * mirrors) and the HTML a `contentEditable` surface needs so authors see
 * formatting applied live while typing, instead of the raw tokens.
 *
 * Why this exists: QAAnnouncementForm.tsx used to store and edit content as
 * a single plain-text string in a `<textarea>`, with a separate "Preview"
 * toggle (Eye/EyeOff button) that swapped in a read-only render of the same
 * text. Per design feedback, that's gone -- there is exactly one editing
 * surface now, and it live-renders formatting the same way a normal
 * rich-text compose box (Slack, Notion, Gmail) does. The STORAGE format is
 * unchanged (still the same plain-markup string every existing announcement
 * and the read-side renderer already understand) -- only the authoring
 * surface changed, from <textarea> to contentEditable.
 *
 * `markupToEditableHtml` runs when loading content INTO the editor (opening
 * the form fresh, switching into "Edit" on an existing announcement, or
 * clearing the form after submit) -- i.e. only on those explicit external
 * state changes, never on every keystroke. `editableHtmlToMarkup` runs on
 * every `input` event, reading the editor's current `innerHTML` back into
 * the plain-markup string kept in React state for submission. Because
 * normal typing only ever reads FROM the DOM (never writes `innerHTML` back
 * during a keystroke), the browser's native contentEditable caret handling
 * is what keeps the cursor in place -- there's no re-render-driven cursor
 * jump to guard against.
 *
 * One stored line == one top-level block element in the editable HTML (a
 * plain <div> for a normal line, <blockquote> for a quote line, <ul><li> for
 * a bullet line) -- consecutive quote/bullet lines each get their own
 * container rather than being merged into one shared block. That's a purely
 * cosmetic simplification (the read-side renderer already groups consecutive
 * "> " lines into one visual blockquote regardless of how many separate
 * <blockquote> elements produced them) that keeps both conversion directions
 * a simple 1:1 line mapping instead of needing cross-line grouping logic in
 * both places.
 *
 * Legacy **bold+red** input (pre-dating the general color picker) round-trips
 * through the editor as an explicit `[red]*text*[/red]` on save -- visually
 * identical (the read-side renderer already treats both as the same bold+red
 * styling), just normalized onto the newer explicit-color-tag form the first
 * time someone re-edits and saves that announcement.
 */

// ---------------------------------------------------------------------------
// markup -> HTML (for loading content into the editor)
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const FORMAT_TOKEN_REGEX =
  /(\*\*_[\s\S]+?_\*\*|_\*\*[\s\S]+?\*\*_|\*_[\s\S]+?_\*|_\*[\s\S]+?\*_|\*\*[\s\S]+?\*\*|\*[\s\S]+?\*|_[\s\S]+?_)/g;

const COLOR_TOKEN_REGEX =
  /(\[(?:red|orange|green|blue)\][\s\S]*?\[\/(?:red|orange|green|blue)\])/g;
const COLOR_SPAN_REGEX = /^\[(red|orange|green|blue)\]([\s\S]*)\[\/(?:red|orange|green|blue)\]$/;

const EXPLICIT_LINK_REGEX = /\[([^[\]]+)\]\((https?:\/\/[^\s()]+)\)/g;

/** [label](url) -> <a href="url">label</a>; everything else escaped as plain text. */
function inlineLinksToHtml(text: string): string {
  if (!text.includes("](http")) return escapeHtml(text);
  let out = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  EXPLICIT_LINK_REGEX.lastIndex = 0;
  while ((match = EXPLICIT_LINK_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) out += escapeHtml(text.slice(lastIndex, match.index));
    const [, label, url] = match;
    out += `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) out += escapeHtml(text.slice(lastIndex));
  return out;
}

/** Bold/italic (and the combined/legacy-red variants) -> <b>/<i> HTML, recursing link handling into each segment. */
function formatTokensToHtml(text: string): string {
  const parts = text.split(FORMAT_TOKEN_REGEX);
  return parts
    .map((part) => {
      let match: RegExpMatchArray | null;
      if ((match = part.match(/^\*\*_([\s\S]+?)_\*\*$/)) || (match = part.match(/^_\*\*([\s\S]+?)\*\*_$/))) {
        // Legacy bold+red+italic — normalized to an inline color style
        // directly on the <b> (no separate outer color span needed for the
        // legacy case, same as the read-side renderer's own handling).
        return `<b style="color:#ef4444"><i>${inlineLinksToHtml(match[1])}</i></b>`;
      }
      if ((match = part.match(/^\*_([\s\S]+?)_\*$/)) || (match = part.match(/^_\*([\s\S]+?)\*_$/))) {
        return `<b><i>${inlineLinksToHtml(match[1])}</i></b>`;
      }
      if ((match = part.match(/^\*\*([\s\S]+?)\*\*$/))) {
        return `<b style="color:#ef4444">${inlineLinksToHtml(match[1])}</b>`;
      }
      if ((match = part.match(/^\*([\s\S]+?)\*$/))) {
        return `<b>${inlineLinksToHtml(match[1])}</b>`;
      }
      if ((match = part.match(/^_([\s\S]+?)_$/))) {
        return `<i>${inlineLinksToHtml(match[1])}</i>`;
      }
      return inlineLinksToHtml(part);
    })
    .join("");
}

/** Outermost [color]...[/color] spans -> <span style="color:...">, recursing bold/italic/link handling inside. */
function colorTokensToHtml(text: string, theme: "light" | "dark"): string {
  const parts = text.split(COLOR_TOKEN_REGEX);
  return parts
    .map((part) => {
      const spanMatch = part.match(COLOR_SPAN_REGEX);
      if (spanMatch) {
        const [, colorName, inner] = spanMatch;
        const hex = COLOR_HEX[colorName]?.[theme];
        return `<span style="color:${hex ?? "inherit"}">${formatTokensToHtml(inner)}</span>`;
      }
      return formatTokensToHtml(part);
    })
    .join("");
}

function inlineMarkupToHtml(text: string, theme: "light" | "dark"): string {
  if (text === "") return "<br>";
  return colorTokensToHtml(text, theme);
}

/**
 * Converts a full stored announcement string into an HTML string suitable
 * for a contentEditable's `innerHTML` — one <div>/<blockquote>/<ul><li> per
 * stored line, in original order.
 */
export function markupToEditableHtml(markup: string, theme: "light" | "dark"): string {
  if (!markup) return "<div><br></div>";
  const lines = markup.split(/\n/);
  return lines
    .map((line) => {
      if (line.startsWith("> ")) {
        return `<blockquote>${inlineMarkupToHtml(line.slice(2), theme)}</blockquote>`;
      }
      if (line.startsWith("• ")) {
        return `<ul><li>${inlineMarkupToHtml(line.slice(2), theme)}</li></ul>`;
      }
      return `<div>${inlineMarkupToHtml(line, theme)}</div>`;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// HTML -> markup (reading the editor's current content back into state)
// ---------------------------------------------------------------------------

// execCommand('foreColor', ...) is always called with one of these exact
// hexes (see the color picker in QAAnnouncementForm.tsx), so the browser
// hands them straight back — but it normalizes to "rgb(r, g, b)" when read
// through an element's inline style, not the original hex string. This
// converts that back to "#rrggbb" for comparison against COLOR_HEX.
function rgbStringToHex(rgb: string): string | null {
  const match = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!match) return null;
  const [, r, g, b] = match;
  const toHex = (n: string) => Number(n).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toLowerCase();
}

function hexToRgbTuple(hex: string): [number, number, number] | null {
  const match = hex.replace("#", "").match(/^([0-9a-f]{6})$/i);
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Maps an arbitrary color (from a pasted span, or execCommand's rgb()
 * normalization) to the nearest of the 4 named colors this app supports, but
 * only within a tight tolerance -- anything further away (e.g. plain
 * inherited ink color, or a color from pasted-in foreign content) is treated
 * as "no recognized color" rather than being force-mapped to the closest of
 * the 4, which would silently recolor content the author never asked to
 * color.
 */
function resolveNamedColor(cssColor: string, theme: "light" | "dark"): "red" | "orange" | "green" | "blue" | null {
  const hex = cssColor.startsWith("#") ? cssColor.toLowerCase() : rgbStringToHex(cssColor);
  if (!hex) return null;
  const target = hexToRgbTuple(hex);
  if (!target) return null;

  let best: { name: "red" | "orange" | "green" | "blue"; distance: number } | null = null;
  for (const name of ["red", "orange", "green", "blue"] as const) {
    const candidateHex = COLOR_HEX[name]?.[theme];
    const candidate = candidateHex ? hexToRgbTuple(candidateHex) : null;
    if (!candidate) continue;
    const distance = Math.sqrt(
      (target[0] - candidate[0]) ** 2 + (target[1] - candidate[1]) ** 2 + (target[2] - candidate[2]) ** 2
    );
    if (!best || distance < best.distance) best = { name, distance };
  }
  // ~25/441 of the full RGB cube diagonal — close enough to be "that color,
  // maybe slightly re-rendered by the browser", far enough to reject
  // anything that isn't obviously one of the 4.
  return best && best.distance <= 25 ? best.name : null;
}

function getInlineColor(el: Element): string | null {
  const styleAttr = el.getAttribute("style");
  if (styleAttr) {
    // Anchored to a declaration boundary (start-of-string or a preceding
    // ";") so this matches the "color" declaration itself, not the tail end
    // of "background-color" or any other *-color property.
    const match = styleAttr.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
    if (match) return match[1].trim();
  }
  if (el.tagName === "FONT") {
    const colorAttr = el.getAttribute("color");
    if (colorAttr) return colorAttr;
  }
  return null;
}

/** Recursively converts one inline DOM subtree (the content of a single line) back into markup tokens. */
function inlineNodeToMarkup(node: ChildNode, theme: "light" | "dark"): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const el = node as Element;
  const tag = el.tagName;
  const childrenMarkup = () => Array.from(el.childNodes).map((c) => inlineNodeToMarkup(c, theme)).join("");

  if (tag === "BR") return "";

  if (tag === "A") {
    const href = el.getAttribute("href") || "";
    const label = el.textContent || "";
    if (!href || !/^https?:\/\//i.test(href)) return label; // never emit a non-http(s) link token
    return `[${label}](${href})`;
  }

  if (tag === "B" || tag === "STRONG") {
    const color = getInlineColor(el);
    const resolved = color ? resolveNamedColor(color, theme) : null;
    const inner = childrenMarkup();
    // Legacy bold+red produced directly on the <b> itself (see
    // markupToEditableHtml) — normalize forward to an explicit color tag
    // rather than trying to preserve the old "**" shorthand.
    return resolved ? `[${resolved}]*${inner}*[/${resolved}]` : `*${inner}*`;
  }

  if (tag === "I" || tag === "EM") {
    return `_${childrenMarkup()}_`;
  }

  if (tag === "SPAN" || tag === "FONT") {
    const color = getInlineColor(el);
    const resolved = color ? resolveNamedColor(color, theme) : null;
    const inner = childrenMarkup();
    return resolved ? `[${resolved}]${inner}[/${resolved}]` : inner;
  }

  // Unknown/unexpected element (e.g. a stray <div> nested inline by a
  // browser quirk) — flatten to its text content rather than dropping it or
  // throwing, so odd DOM shapes degrade to plain text instead of losing data.
  return childrenMarkup();
}

function lineElementToMarkup(el: Element, theme: "light" | "dark"): string {
  if (el.tagName === "BLOCKQUOTE") {
    // A blockquote may itself contain one or more line-divs (if the browser
    // grouped several quoted lines together) — walk one level down so each
    // becomes its own "> "-prefixed stored line.
    const innerLines = Array.from(el.children).filter((c) => c.tagName === "DIV" || c.tagName === "P");
    if (innerLines.length > 0) {
      return innerLines
        .map((d) => `> ${Array.from(d.childNodes).map((c) => inlineNodeToMarkup(c, theme)).join("")}`)
        .join("\n");
    }
    return `> ${Array.from(el.childNodes).map((c) => inlineNodeToMarkup(c, theme)).join("")}`;
  }
  if (el.tagName === "UL" || el.tagName === "OL") {
    return Array.from(el.children)
      .filter((c) => c.tagName === "LI")
      .map((li) => `• ${Array.from(li.childNodes).map((c) => inlineNodeToMarkup(c, theme)).join("")}`)
      .join("\n");
  }
  // Plain line (<div>/<p>, or anything else treated as one).
  return Array.from(el.childNodes).map((c) => inlineNodeToMarkup(c, theme)).join("");
}

/**
 * Converts the editor's current `innerHTML` back into the stored plain-markup
 * string. Uses `DOMParser` (a standard browser API, not the live document)
 * so this never mutates or reflows the actual editor while reading it.
 */
export function editableHtmlToMarkup(html: string, theme: "light" | "dark"): string {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, "text/html");
  const root = doc.getElementById("root");
  if (!root) return "";

  const lines: string[] = [];
  // Inline content encountered directly at the top level (before the
  // browser has wrapped anything in a block container — e.g. the very
  // first line of a brand-new editor, before Enter has ever been pressed)
  // is buffered here and flushed as one line whenever a block-level
  // container or a bare top-level <br> is hit.
  let buffer = "";
  let bufferHasContent = false;

  const flushBuffer = () => {
    if (bufferHasContent || buffer !== "") lines.push(buffer);
    buffer = "";
    bufferHasContent = false;
  };

  Array.from(root.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent ?? "";
      if (t !== "") bufferHasContent = true;
      buffer += t;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (el.tagName === "DIV" || el.tagName === "P" || el.tagName === "BLOCKQUOTE" || el.tagName === "UL" || el.tagName === "OL") {
      flushBuffer();
      lines.push(lineElementToMarkup(el, theme));
      return;
    }
    if (el.tagName === "BR") {
      flushBuffer();
      return;
    }
    // Inline element sitting directly at the top level — part of the
    // implicit first/only line.
    buffer += inlineNodeToMarkup(el, theme);
    bufferHasContent = true;
  });
  flushBuffer();

  return lines.join("\n");
}
