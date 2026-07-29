/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";

/**
 * Formatting rules for announcement content (v2 — rebuilt to fix the paste/
 * color/combination bugs in the original implementation; see
 * ANNOUNCEMENT_EDITOR_REBUILD.md for the full before/after writeup):
 *
 *   *text*    -> Bold
 *   _text_    -> Italic
 *   ~text~    -> Underline
 *   `text`    -> Code (monospace, subtle background)
 *   (any of the above can nest/combine, e.g. *_text_* -> Bold + Italic)
 *
 *   **text**  -> Bold and Red        (LEGACY ONLY — still rendered for any
 *                 announcement written before the general color picker
 *                 existed; the editor never produces this anymore. Combos
 *                 like **_text_** or _**text**_ -> Bold + Red + Italic still
 *                 render exactly as they always did.)
 *
 *   [red]text[/red]                  -> Text color (red/orange/green/blue).
 *                 Always the OUTERMOST wrapper. Inner content still runs
 *                 through the exact same bold/italic/underline/code parsing.
 *   > text                           -> Quote line. Consecutive quoted
 *                 lines are grouped into one blockquote-styled block.
 *   • text                           -> Bulleted list line. Consecutive
 *                 bulleted lines are grouped into one real <ul> block
 *                 (previously stored but never actually rendered as a list —
 *                 fixed here).
 *   [label](https://url)             -> Explicit link with custom label.
 *                 Bare "https://..." URLs elsewhere in the text still
 *                 auto-link exactly as before.
 *
 * ESCAPING (new): a literal `*`, `_`, `~`, backtick, `[` or `]` that the
 * author actually typed or pasted as plain text (e.g. "check_in", "5 * 3",
 * "call *now*" meant literally) is stored backslash-escaped by the editor
 * (see announcementEditorHtml.ts) so it can never be misread as a
 * formatting token here. This is the fix for "pasted content becomes bold":
 * previously, any literal asterisk/underscore that happened to appear in
 * plain typed or pasted text (extremely common — emphasis in a pasted
 * email, a variable name, "config_value") was silently reinterpreted as a
 * real bold/italic marker by this exact regex parser, because there was no
 * way to distinguish "the user's own character" from "a real token". The
 * regexes below use a negative-lookbehind (`(?<!\\)`) on every delimiter so
 * an escaped character never starts/ends a token, and `unescapeLiteral`
 * below strips the backslash back out at the very end, just before display.
 * Content written before this fix never contains a backslash-escape, so
 * this is purely additive — zero change to any existing announcement that
 * doesn't happen to need escaping.
 *
 * BACKWARD COMPATIBILITY: every token above is an ADDITIVE pass that only
 * activates when its specific token is present. Content with none of these
 * tokens — i.e. every announcement written before this feature existed —
 * takes exactly the same code path it always did.
 */

function unescapeLiteral(text: string): string {
  return text.replace(/\\([*_~`[\]])/g, "$1");
}

// Ordered so the more specific (combined) markers are tried before the
// simpler ones — this prevents "**_text_**" from being mis-split as
// "*" + "*_text_*" + "*", etc. Each delimiter carries a `(?<!\\)` guard so
// an escaped character (the author's own literal `*`/`_`/etc., see file
// header) is never treated as a token boundary.
const FORMAT_TOKEN_REGEX =
  /((?<!\\)\*\*(?<!\\)_[\s\S]+?(?<!\\)_(?<!\\)\*\*|(?<!\\)_(?<!\\)\*\*[\s\S]+?(?<!\\)\*\*(?<!\\)_|(?<!\\)\*(?<!\\)_[\s\S]+?(?<!\\)_(?<!\\)\*|(?<!\\)_(?<!\\)\*[\s\S]+?(?<!\\)\*(?<!\\)_|(?<!\\)\*\*[\s\S]+?(?<!\\)\*\*|(?<!\\)~[\s\S]+?(?<!\\)~|(?<!\\)`[\s\S]+?(?<!\\)`|(?<!\\)\*[\s\S]+?(?<!\\)\*|(?<!\\)_[\s\S]+?(?<!\\)_)/g;

// Outermost color wrapper — see file header. Non-greedy so
// "[red]a[/red] and [blue]b[/blue]" splits into two separate color spans
// rather than one span spanning both.
const COLOR_TOKEN_REGEX =
  /(\[(?:red|orange|green|blue)\][\s\S]*?\[\/(?:red|orange|green|blue)\])/g;
const COLOR_SPAN_REGEX = /^\[(red|orange|green|blue)\]([\s\S]*)\[\/(?:red|orange|green|blue)\]$/;

// Fixed hex values, matching the existing convention in this file: red is
// deliberately flat/non-theme-reactive (same as the legacy bold+red
// styling below), blue mirrors the app's existing link-color pair exactly
// so "blue text" and "a link" read as the same blue. Green pulls from
// Tailwind's emerald-500-600, already used nearby for success alerts.
// Orange was previously amber-500/600 (#f59e0b/#d97706) — a fairly vivid,
// saturated tone that read as too strong/harsh for body text at length.
// Dialed back one step further into a muted, dustier amber-700/800 pairing
// so "orange text" stays clearly distinguishable from the other three
// colors while being easier on the eyes over a full paragraph.
export const COLOR_HEX: Record<string, { light: string; dark: string }> = {
  red: { light: "#ef4444", dark: "#ef4444" },
  orange: { light: "#92400e", dark: "#b45309" },
  green: { light: "#059669", dark: "#10b981" },
  blue: { light: "#0754B7", dark: "#00D3F3" },
};

// The color picker's "Black/White" swatch and its "Clear Formatting" action
// are the same operation: both remove any [color]...[/color] wrapper so the
// text falls back to the surrounding default ink color (which already IS
// black in light theme / white in dark theme via normal inheritance). No
// dedicated "default" color token is needed in the grammar — there is
// simply no color wrapper at all once cleared.

// Explicit "[label](https://url)" links — matched before bare-URL
// auto-detection so a URL inside the parens is never double-processed.
// http(s)-only by construction: nothing else can appear here and become a
// clickable href, which is what keeps this safe against javascript:/data:
// URIs even though the source text is user-authored.
const EXPLICIT_LINK_REGEX = /\[([^[\]]+)\]\((https?:\/\/[^\s()]+)\)/g;

// Announcements routinely carry a Drive/ditto.sh link to the actual
// attachment (PDF, deck, doc) — e.g. "The entire narrative is available in
// the PDF:- https://ditto.sh/j3wz74" — but until now that text rendered as
// flat, non-clickable prose, so the attachment was invisible unless someone
// copy-pasted the raw URL out by hand. This finds bare http(s) URLs inside
// any run of text and turns them into real links (new tab, with a small
// external-link glyph so they read as "opens something" at a glance).
const URL_SPLIT_REGEX = /(https?:\/\/[^\s<>"')]+)/g;
const IS_URL_REGEX = /^https?:\/\//;

function renderTextWithLinks(text: string, keyPrefix: string, effectiveTheme: "light" | "dark") {
  const hasExplicitLink = text.includes("](http");
  if (!hasExplicitLink && !text.includes("http://") && !text.includes("https://")) {
    return unescapeLiteral(text);
  }

  // Resolved directly from effectiveTheme (a plain JS value the caller
  // already computed) instead of emitting both a base class and a
  // Tailwind `dark:` variant. Both announcement cards now have a FIXED
  // background regardless of the app's real light/dark toggle — QA is
  // always light-blue, General is always dark-navy — so a `dark:` class
  // would key off the wrong thing (the ambient toggle) rather than this
  // card's own fixed background, producing mismatched colors between the
  // two ambient themes even though the card itself never changes.
  const linkColor = effectiveTheme === "dark" ? "#00D3F3" : "#0754B7";

  const renderBareUrls = (segment: string, segKey: string) => {
    if (!segment.includes("http://") && !segment.includes("https://")) return unescapeLiteral(segment);
    return segment.split(URL_SPLIT_REGEX).map((part, i) =>
      IS_URL_REGEX.test(part) ? (
        <a
          key={`${segKey}-link-${i}`}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 decoration-1 hover:opacity-80 break-all font-semibold"
          style={{ color: linkColor }}
        >
          {part}
          <ExternalLink className="inline-block w-3 h-3 ml-0.5 -mt-0.5" />
        </a>
      ) : (
        unescapeLiteral(part)
      )
    );
  };

  if (!hasExplicitLink) return renderBareUrls(text, keyPrefix);

  // Explicit-link pass: walk the text splitting out [label](url) spans,
  // running the existing bare-URL logic (unchanged) on everything between
  // them.
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  EXPLICIT_LINK_REGEX.lastIndex = 0;
  while ((match = EXPLICIT_LINK_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(renderBareUrls(text.slice(lastIndex, match.index), `${keyPrefix}-t${i}`));
    }
    const [, label, url] = match;
    nodes.push(
      <a
        key={`${keyPrefix}-elink-${i}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 decoration-1 hover:opacity-80 break-all font-semibold"
        style={{ color: linkColor }}
      >
        {unescapeLiteral(label)}
        <ExternalLink className="inline-block w-3 h-3 ml-0.5 -mt-0.5" />
      </a>
    );
    lastIndex = match.index + match[0].length;
    i++;
  }
  if (lastIndex < text.length) {
    nodes.push(renderBareUrls(text.slice(lastIndex), `${keyPrefix}-t${i}`));
  }
  return nodes;
}

function renderFormattedSegment(segment: string, key: string, effectiveTheme: "light" | "dark") {
  const boldRedItalic1 = /^\*\*_([\s\S]+?)_\*\*$/;
  const boldRedItalic2 = /^_\*\*([\s\S]+?)\*\*_$/;
  const boldItalic1 = /^\*_([\s\S]+?)_\*$/;
  const boldItalic2 = /^_\*([\s\S]+?)\*_$/;
  const boldRed = /^\*\*([\s\S]+?)\*\*$/;
  const underlineOnly = /^~([\s\S]+?)~$/;
  const codeOnly = /^`([\s\S]+?)`$/;
  const boldOnly = /^\*([\s\S]+?)\*$/;
  const italicOnly = /^_([\s\S]+?)_$/;

  let content: string;
  let bold = false;
  let italic = false;
  let underline = false;
  let code = false;
  let red = false;
  let match: RegExpMatchArray | null;

  if ((match = segment.match(boldRedItalic1)) || (match = segment.match(boldRedItalic2))) {
    content = match[1];
    bold = true;
    red = true;
    italic = true;
  } else if ((match = segment.match(boldItalic1)) || (match = segment.match(boldItalic2))) {
    content = match[1];
    bold = true;
    italic = true;
  } else if ((match = segment.match(boldRed))) {
    content = match[1];
    bold = true;
    red = true;
  } else if ((match = segment.match(underlineOnly))) {
    content = match[1];
    underline = true;
  } else if ((match = segment.match(codeOnly))) {
    content = match[1];
    code = true;
  } else if ((match = segment.match(boldOnly))) {
    content = match[1];
    bold = true;
  } else if ((match = segment.match(italicOnly))) {
    content = match[1];
    italic = true;
  } else {
    return <span key={key}>{renderTextWithLinks(segment, key, effectiveTheme)}</span>;
  }

  if (code) {
    // Inline code renders as its own monospace/background span and does not
    // recurse bold/italic/underline inside it (matches how Slack/Google
    // Chat/GitHub treat inline code — its contents are shown verbatim).
    return (
      <code
        key={key}
        className={`px-1 py-0.5 rounded font-mono text-[0.92em] ${
          effectiveTheme === "dark" ? "bg-white/10 text-stone-100" : "bg-black/[0.06] text-stone-800"
        }`}
      >
        {unescapeLiteral(content)}
      </code>
    );
  }

  const classNames = [bold ? "font-extrabold" : "", italic ? "italic" : "", underline ? "underline underline-offset-2" : ""]
    .filter(Boolean)
    .join(" ");

  // Resolved directly from effectiveTheme via inline style rather than a
  // base class + Tailwind `dark:` variant. Both announcement cards have a
  // FIXED background regardless of the app's real light/dark toggle (QA is
  // always light-blue, General is always dark-navy), so `dark:` classes
  // keyed off the ambient toggle produced mismatched colors whenever the
  // ambient theme differed from the card's own fixed styling — e.g.
  // General's card is the same dark-navy card in an ambient-light session
  // as in an ambient-dark one, but the red/green text used to render
  // differently between the two anyway.
  //
  // Colors below match the red/green already used for "mandatory"/
  // "optional" callouts on the PED x Surgery mapping cards
  // (DisclosureMap.tsx) for visual consistency across the app: a single
  // flat red (#ef4444, Tailwind red-500) that isn't theme-reactive at all
  // there, and a teal/emerald green that's darker on light backgrounds and
  // brighter on dark ones (DisclosureMap.tsx uses var(--teal), which
  // resolves to these same two hex values light vs dark).
  const color = red
    ? "#ef4444"
    : bold || italic || underline
      ? (effectiveTheme === "dark" ? "#2DD4BF" : "#0B5C56")
      : undefined;

  return (
    <span key={key} className={classNames || undefined} style={color ? { color } : undefined}>
      {renderTextWithLinks(content, key, effectiveTheme)}
    </span>
  );
}

// Bold/italic/underline/code token split + render — extracted verbatim from
// the body that used to live inline in renderFormattedAnnouncement's line
// loop, so it can be called both for plain text AND recursively for the
// inner content of a color span (see renderLineContent below).
// Behavior for callers that never touch color is unchanged.
function renderFormatTokens(text: string, keyPrefix: string, effectiveTheme: "light" | "dark") {
  const subParts = text.split(FORMAT_TOKEN_REGEX);
  return subParts.map((subPart, subIdx) =>
    renderFormattedSegment(subPart, `${keyPrefix}-${subIdx}`, effectiveTheme)
  );
}

// Rating-badge detection + bold/italic/underline/code/link rendering for a
// run of text that has ALREADY had any [color]...[/color] wrapper peeled off
// by renderLineContent below. Deliberately runs AFTER color-span extraction,
// not before: rating detection used to run first (splitting the raw line on
// "rated 3" etc.), which silently broke any color span containing a rating
// badge into three fragments — one with only the opening "[red]", the badge
// itself, and one with only the closing "[/red]" — so neither fragment ever
// contained a matching open+close pair and both literal tags leaked into the
// rendered output as raw text instead of coloring anything. Running this
// AFTER color extraction means a rating badge can appear inside a colored
// span (or outside one) and the color wrapper is never at risk of being
// split apart by it.
function renderRatingAwareTokens(text: string, keyPrefix: string, effectiveTheme: "light" | "dark") {
  const ratingRegex = /\b(Rating\s*:\s*-?[1-5]|Rating\s+-?[1-5]|Rated\s*:\s*-?[1-5]|Rated\s+-?[1-5]|R-?[1-5]|rating\s*:\s*-?[1-5]|rating\s+-?[1-5]|rated\s*:\s*-?[1-5]|rated\s+-?[1-5]|r-?[1-5])\b/gi;
  const ratingParts = text.split(ratingRegex);

  return ratingParts.map((part, partIdx) => {
    if (ratingRegex.test(part)) {
      const match = part.match(/-?[1-5]/);
      const ratingNum = match ? parseInt(match[0], 10) : 1;
      let ratingColor = "";
      if (ratingNum === 1) {
        ratingColor = effectiveTheme === "dark" ? "bg-red-500/15 text-red-400 border border-red-500/25 font-extrabold shadow-[0_0_8px_rgba(239,68,68,0.25)]" : "bg-red-50 text-red-700 border border-red-200 font-extrabold";
      } else if (ratingNum === 2) {
        ratingColor = effectiveTheme === "dark" ? "bg-orange-500/10 text-orange-400 border border-orange-500/20 font-extrabold" : "bg-orange-50 text-orange-700 border-orange-200 font-extrabold";
      } else if (ratingNum === 3) {
        ratingColor = effectiveTheme === "dark" ? "bg-amber-500/10 text-amber-400 border border-amber-500/15 font-extrabold" : "bg-amber-50 text-amber-800 border border-amber-200 font-extrabold";
      } else if (ratingNum === 4) {
        ratingColor = "bg-[#E1EAF7] text-[#0754B7] border border-[#B9D2F2] font-extrabold";
      } else if (ratingNum === -1) {
        ratingColor = effectiveTheme === "dark" ? "bg-purple-500/10 text-purple-400 border border-purple-500/15 font-extrabold" : "bg-purple-50 text-purple-800 border-purple-200 font-extrabold";
      } else if (ratingNum === 0) {
        ratingColor = effectiveTheme === "dark" ? "bg-stone-500/10 text-stone-400 border border-stone-500/15 font-extrabold" : "bg-stone-100 text-stone-600 border border-stone-200 font-extrabold";
      } else {
        ratingColor = effectiveTheme === "dark" ? "bg-teal-500/10 text-teal-400 border border-teal-500/15 font-extrabold" : "bg-teal-50 text-teal-800 border border-teal-200 font-extrabold";
      }
      return (
        <span key={`${keyPrefix}-rating-${partIdx}`} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold mx-0.5 ${ratingColor}`}>
          {part}
        </span>
      );
    }

    return renderFormatTokens(part, `${keyPrefix}-fmt-${partIdx}`, effectiveTheme);
  });
}

// Splits out [color]...[/color] spans (always the outermost wrapper — see
// file header) BEFORE any rating-badge detection runs (see
// renderRatingAwareTokens above for why the order matters), then recurses
// the rating+format renderer into each span's inner content; anything that
// isn't a color span runs through the same rating+format renderer directly.
// Text with no color tags produces a single non-matching split part, so
// this is a no-op wrapper around the original behavior for all pre-existing
// announcement content. Plain lines, quote-block lines, and bullet lines
// all share this exact same rendering.
function renderLineContent(line: string, keyPrefix: string, effectiveTheme: "light" | "dark") {
  const parts = line.split(COLOR_TOKEN_REGEX);
  return parts.map((part, i) => {
    const spanMatch = part.match(COLOR_SPAN_REGEX);
    if (spanMatch) {
      const [, colorName, inner] = spanMatch;
      const hex = COLOR_HEX[colorName]?.[effectiveTheme] ?? undefined;
      return (
        <span key={`${keyPrefix}-color-${i}`} style={hex ? { color: hex } : undefined}>
          {renderRatingAwareTokens(inner, `${keyPrefix}-color-${i}`, effectiveTheme)}
        </span>
      );
    }
    return renderRatingAwareTokens(part, `${keyPrefix}-plain-${i}`, effectiveTheme);
  });
}

export function renderFormattedAnnouncement(rawText: string, theme: "light" | "dark", forceLightContrast?: boolean) {
  if (!rawText) return null;
  const lines = rawText.split(/\n/); // Real line breaks only.
  const effectiveTheme = forceLightContrast ? "light" : theme;

  // Group consecutive "> "-prefixed lines into one blockquote block and
  // consecutive "• "-prefixed lines into one real <ul> block; every other
  // line stays in its own "normal" block of one. Content with none of these
  // prefixes — i.e. every announcement written before quote/bullet support
  // existed — collapses to one normal block containing every line in
  // order, which renders identically to the original implementation.
  type Block = { type: "normal" | "quote" | "bullet"; lines: string[]; startIdx: number };
  const blocks: Block[] = [];
  lines.forEach((line, idx) => {
    const isQuote = line.startsWith("> ");
    const isBullet = !isQuote && line.startsWith("• ");
    const type: Block["type"] = isQuote ? "quote" : isBullet ? "bullet" : "normal";
    const stripped = isQuote || isBullet ? line.slice(2) : line;
    const last = blocks[blocks.length - 1];
    if (last && last.type === type) {
      last.lines.push(stripped);
    } else {
      blocks.push({ type, lines: [stripped], startIdx: idx });
    }
  });

  return (
    <span className="block space-y-1 text-xs md:text-[13px]">
      {blocks.map((block, blockIdx) => {
        if (block.type === "quote") {
          return (
            <div
              key={`quote-${blockIdx}`}
              className={`my-1.5 pl-3 py-1 border-l-2 italic ${
                effectiveTheme === "dark" ? "border-white/20 text-white/80" : "border-black/15 text-black/70"
              }`}
            >
              {block.lines.map((line, i) => (
                <div key={`q-${blockIdx}-${i}`} style={{ minHeight: "1.2em" }}>
                  {renderLineContent(line, `q${blockIdx}-${i}`, effectiveTheme)}
                </div>
              ))}
            </div>
          );
        }

        if (block.type === "bullet") {
          return (
            <ul key={`bullet-${blockIdx}`} className="my-1 list-disc pl-5 space-y-0.5">
              {block.lines.map((line, i) => (
                <li key={`b-${blockIdx}-${i}`}>
                  {renderLineContent(line, `b${blockIdx}-${i}`, effectiveTheme)}
                </li>
              ))}
            </ul>
          );
        }

        return block.lines.map((line, i) => {
          const lineIdx = block.startIdx + i;
          // Default one-line gap after the title (line 0), so authors don't
          // have to remember to leave a manual blank line — but skip it if
          // they already did (lines[1] === ""), so the two don't stack into
          // a double gap.
          const isTitleLine = lineIdx === 0 && lines.length > 1 && line.trim() !== "" && lines[1].trim() !== "";
          return (
            <div key={`line-${lineIdx}`} style={{ minHeight: "1.2em" }} className={isTitleLine ? "mb-3" : undefined}>
              {renderLineContent(line, `l${lineIdx}`, effectiveTheme)}
            </div>
          );
        });
      })}
    </span>
  );
}
