/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { COLOR_HEX } from "./announcementHtml";

/**
 * LEGACY IMPORTER ONLY (v3 cleanup).
 *
 * Announcements are now stored as sanitized HTML (see announcementHtml.ts —
 * the single unified pipeline for the editor, the manager gallery, the
 * lookup carousel, and the acknowledge modal). This module's one remaining
 * job is a ONE-WAY conversion of legacy rows — content saved before v3 in
 * the old plain-markup grammar (*bold*, _italic_, ~underline~, `code`,
 * legacy **bold+red**, [color]...[/color], "> " quote lines, "• " bullet
 * lines, [label](url) links) — into that same HTML subset. The first time a
 * legacy row is edited and saved it becomes sanitized HTML permanently.
 *
 * The old reverse direction (HTML -> markup, run on every editor keystroke)
 * was deleted with v3: converting the editor's DOM back into the ambiguous
 * markup grammar was the root cause of the recurring "preview fine,
 * published broken" corruption bugs — nested formatting, line breaks inside
 * styled runs, and browser-specific DOM shapes each round-tripped into
 * escaped literal marker characters baked into the stored text.
 *
 * ESCAPING NOTE: legacy content may contain backslash-escaped literals
 * (\*, \_, \~, \`, \[, \]) written by the old editor so an author's own
 * asterisks/underscores weren't misread as tokens. unescapeLiteral below
 * strips those on import — the backslash was a storage detail of the old
 * format and must never render.
 */

// ---------------------------------------------------------------------------
// markup -> HTML
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function unescapeLiteral(text: string): string {
  return text.replace(/\\([*_~`[\]])/g, "$1");
}

/** Reverses the old editor's literal-escaping before HTML-escaping, so the
 * import shows the author's original character (never a visible backslash). */
function escapeHtmlUnescapingLiterals(text: string): string {
  return escapeHtml(unescapeLiteral(text));
}

const FORMAT_TOKEN_REGEX =
  /((?<!\\)\*\*(?<!\\)_[\s\S]+?(?<!\\)_(?<!\\)\*\*|(?<!\\)_(?<!\\)\*\*[\s\S]+?(?<!\\)\*\*(?<!\\)_|(?<!\\)\*(?<!\\)_[\s\S]+?(?<!\\)_(?<!\\)\*|(?<!\\)_(?<!\\)\*[\s\S]+?(?<!\\)\*(?<!\\)_|(?<!\\)\*\*[\s\S]+?(?<!\\)\*\*|(?<!\\)~[\s\S]+?(?<!\\)~|(?<!\\)`[\s\S]+?(?<!\\)`|(?<!\\)\*[\s\S]+?(?<!\\)\*|(?<!\\)_[\s\S]+?(?<!\\)_)/g;

const COLOR_TOKEN_REGEX =
  /(\[(?:red|orange|green|blue)\][\s\S]*?\[\/(?:red|orange|green|blue)\])/g;
const COLOR_SPAN_REGEX = /^\[(red|orange|green|blue)\]([\s\S]*)\[\/(?:red|orange|green|blue)\]$/;

const EXPLICIT_LINK_REGEX = /\[([^[\]]+)\]\((https?:\/\/[^\s()]+)\)/g;

/** [label](url) -> <a href="url">label</a>; everything else escaped as plain text. */
function inlineLinksToHtml(text: string): string {
  if (!text.includes("](http")) return escapeHtmlUnescapingLiterals(text);
  let out = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  EXPLICIT_LINK_REGEX.lastIndex = 0;
  while ((match = EXPLICIT_LINK_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) out += escapeHtmlUnescapingLiterals(text.slice(lastIndex, match.index));
    const [, label, url] = match;
    out += `<a href="${escapeHtml(url)}">${escapeHtmlUnescapingLiterals(label)}</a>`;
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) out += escapeHtmlUnescapingLiterals(text.slice(lastIndex));
  return out;
}

/** Inner content of a format token — recurses the full color+format
 * pipeline so nested legacy structure ("[blue]~*text*~[/blue]",
 * "*[blue]x[/blue]*" in either nesting order) imports correctly.
 * Terminates because every level consumes at least one token pair. */
function tokenInnerToHtml(text: string, theme: "light" | "dark"): string {
  return colorTokensToHtml(text, theme);
}

/** Bold/italic/underline/code (and the combined/legacy-red variants) -> HTML. */
function formatTokensToHtml(text: string, theme: "light" | "dark"): string {
  const parts = text.split(FORMAT_TOKEN_REGEX);
  return parts
    .map((part) => {
      let match: RegExpMatchArray | null;
      if ((match = part.match(/^\*\*_([\s\S]+?)_\*\*$/)) || (match = part.match(/^_\*\*([\s\S]+?)\*\*_$/))) {
        return `<b style="color:#ef4444"><i>${tokenInnerToHtml(match[1], theme)}</i></b>`;
      }
      if ((match = part.match(/^\*_([\s\S]+?)_\*$/)) || (match = part.match(/^_\*([\s\S]+?)\*_$/))) {
        return `<b><i>${tokenInnerToHtml(match[1], theme)}</i></b>`;
      }
      if ((match = part.match(/^\*\*([\s\S]+?)\*\*$/))) {
        return `<b style="color:#ef4444">${tokenInnerToHtml(match[1], theme)}</b>`;
      }
      if ((match = part.match(/^~([\s\S]+?)~$/))) {
        return `<u>${tokenInnerToHtml(match[1], theme)}</u>`;
      }
      if ((match = part.match(/^`([\s\S]+?)`$/))) {
        return `<code>${escapeHtmlUnescapingLiterals(match[1])}</code>`;
      }
      if ((match = part.match(/^\*([\s\S]+?)\*$/))) {
        return `<b>${tokenInnerToHtml(match[1], theme)}</b>`;
      }
      if ((match = part.match(/^_([\s\S]+?)_$/))) {
        return `<i>${tokenInnerToHtml(match[1], theme)}</i>`;
      }
      return inlineLinksToHtml(part);
    })
    .join("");
}

/** Outermost [color]...[/color] spans -> <span style="color:...">, recursing format handling inside. */
function colorTokensToHtml(text: string, theme: "light" | "dark"): string {
  const parts = text.split(COLOR_TOKEN_REGEX);
  return parts
    .map((part) => {
      const spanMatch = part.match(COLOR_SPAN_REGEX);
      if (spanMatch) {
        const [, colorName, inner] = spanMatch;
        const hex = COLOR_HEX[colorName]?.[theme];
        return `<span style="color:${hex ?? "inherit"}">${formatTokensToHtml(inner, theme)}</span>`;
      }
      return formatTokensToHtml(part, theme);
    })
    .join("");
}

/**
 * Normalizes the wrong-nesting-order shape a since-fixed serializer bug
 * briefly stored — format markers OUTSIDE the color pair, e.g.
 * "*[blue]x[/blue]*" — into the canonical color-outermost order
 * "[blue]*x*[/blue]" that the importer's color-first parsing expects.
 * Without this, the color split ran first and left the orphaned markers as
 * literal asterisks/tildes. Runs to a fixpoint (max 3 passes) so doubly
 * nested cases ("*_[red]x[/red]_*") normalize fully.
 */
function normalizeLegacyColorNesting(text: string): string {
  const NESTED = /(?<!\\)([*_~])\[(red|orange|green|blue)\]([\s\S]+?)\[\/\2\](?<!\\)\1/g;
  let prev = text;
  for (let i = 0; i < 3; i++) {
    const next = prev.replace(NESTED, "[$2]$1$3$1[/$2]");
    if (next === prev) break;
    prev = next;
  }
  return prev;
}

function inlineMarkupToHtml(text: string, theme: "light" | "dark"): string {
  if (text === "") return "<br>";
  return colorTokensToHtml(normalizeLegacyColorNesting(text), theme);
}

/**
 * Converts a full legacy stored announcement string into an HTML string in
 * the v3 subset — one <div>/<blockquote>/<ul><li> per stored line, in
 * original order.
 *
 * Legacy quote lines are wrapped in <i>: the old renderer forced italics on
 * every quote via CSS; v3's shared surface styling deliberately doesn't
 * (italics inside a quote are now the author's choice), so the import makes
 * the italics explicit to preserve exactly how legacy content always looked.
 */
export function markupToEditableHtml(markup: string, theme: "light" | "dark"): string {
  if (!markup) return "<div><br></div>";
  const lines = markup.split(/\n/);
  return lines
    .map((line) => {
      if (line.startsWith("> ")) {
        return `<blockquote><i>${inlineMarkupToHtml(line.slice(2), theme)}</i></blockquote>`;
      }
      if (line.startsWith("• ")) {
        return `<ul><li>${inlineMarkupToHtml(line.slice(2), theme)}</li></ul>`;
      }
      return `<div>${inlineMarkupToHtml(line, theme)}</div>`;
    })
    .join("");
}
