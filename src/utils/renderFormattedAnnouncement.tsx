/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";

/**
 * Formatting rules for announcement content:
 *   **text**  -> Bold and Red        (legacy — still rendered, no longer
 *                                      offered as its own toolbar button;
 *                                      superseded by the general color
 *                                      picker below)
 *   *text*    -> Bold
 *   _text_    -> Italic (combinable with either bold variant above,
 *                 e.g. **_text_** or _**text**_ -> Bold + Red + Italic,
 *                      *_text_* or _*text*_     -> Bold + Italic)
 *   [red]text[/red]                  -> Text color (red/orange/green/blue).
 *                 Always the OUTERMOST wrapper — the Content toolbar's
 *                 color button always wraps the full current selection
 *                 (including any existing *и_ markers), so color can wrap
 *                 bold/italic but never the reverse. Inner content still
 *                 runs through the exact same bold/italic parsing above.
 *   > text                           -> Quote line. Consecutive quoted
 *                 lines are grouped into one blockquote-styled block;
 *                 everything inside still supports color/bold/italic/links.
 *   [label](https://url)             -> Explicit link with custom label.
 *                 Bare "https://..." URLs elsewhere in the text still
 *                 auto-link exactly as before (unchanged legacy behavior).
 *
 * Real line breaks (actual newline characters from pressing Enter in the
 * textarea) are preserved. The old rule that treated a literal typed
 * backslash-n ("\n") as a line-break has been removed.
 *
 * BACKWARD COMPATIBILITY: every addition below (color tags, quote lines,
 * explicit links) is an ADDITIVE pass that only activates when its specific
 * token is present. Content with none of those tokens — i.e. every
 * announcement written before this feature existed — takes exactly the
 * same code path it always did: the color split finds nothing to split on,
 * the quote grouping produces one single "normal" block containing every
 * line, and the link pass finds no explicit-link syntax and falls straight
 * through to the original bare-URL auto-linking.
 */

// Ordered so the more specific (combined) markers are tried before the
// simpler ones — this prevents "**_text_**" from being mis-split as
// "*" + "*_text_*" + "*", etc.
const FORMAT_TOKEN_REGEX =
  /(\*\*_[\s\S]+?_\*\*|_\*\*[\s\S]+?\*\*_|\*_[\s\S]+?_\*|_\*[\s\S]+?\*_|\*\*[\s\S]+?\*\*|\*[\s\S]+?\*|_[\s\S]+?_)/g;

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
  if (!hasExplicitLink && !text.includes("http://") && !text.includes("https://")) return text;

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
    if (!segment.includes("http://") && !segment.includes("https://")) return segment;
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
        part
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
        {label}
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
  const boldOnly = /^\*([\s\S]+?)\*$/;
  const italicOnly = /^_([\s\S]+?)_$/;

  let content: string;
  let bold = false;
  let italic = false;
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
  } else if ((match = segment.match(boldOnly))) {
    content = match[1];
    bold = true;
  } else if ((match = segment.match(italicOnly))) {
    content = match[1];
    italic = true;
  } else {
    return <span key={key}>{renderTextWithLinks(segment, key, effectiveTheme)}</span>;
  }

  const classNames = [bold ? "font-extrabold" : "", italic ? "italic" : ""]
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
    : effectiveTheme === "dark"
      ? "#2DD4BF"
      : "#0B5C56";

  return (
    <span key={key} className={classNames || undefined} style={{ color }}>
      {renderTextWithLinks(content, key, effectiveTheme)}
    </span>
  );
}

// Bold/italic token split + render — extracted verbatim from the body that
// used to live inline in renderFormattedAnnouncement's line loop, so it can
// be called both for plain text AND recursively for the inner content of a
// color span (see renderColorAwareTokens below). Behavior for callers that
// never touch color is unchanged.
function renderFormatTokens(text: string, keyPrefix: string, effectiveTheme: "light" | "dark") {
  const subParts = text.split(FORMAT_TOKEN_REGEX);
  return subParts.map((subPart, subIdx) =>
    renderFormattedSegment(subPart, `${keyPrefix}-${subIdx}`, effectiveTheme)
  );
}

// Splits out [color]...[/color] spans (always the outermost wrapper — see
// file header) and recurses the existing bold/italic renderer into each
// one's inner content; anything that isn't a color span runs through the
// unmodified renderFormatTokens exactly as before. Text with no color tags
// produces a single non-matching split part, so this is a no-op wrapper
// around the original behavior for all pre-existing announcement content.
function renderColorAwareTokens(text: string, keyPrefix: string, effectiveTheme: "light" | "dark") {
  const parts = text.split(COLOR_TOKEN_REGEX);
  return parts.map((part, i) => {
    const spanMatch = part.match(COLOR_SPAN_REGEX);
    if (spanMatch) {
      const [, colorName, inner] = spanMatch;
      const hex = COLOR_HEX[colorName]?.[effectiveTheme] ?? undefined;
      return (
        <span key={`${keyPrefix}-color-${i}`} style={hex ? { color: hex } : undefined}>
          {renderFormatTokens(inner, `${keyPrefix}-color-${i}`, effectiveTheme)}
        </span>
      );
    }
    return renderFormatTokens(part, `${keyPrefix}-plain-${i}`, effectiveTheme);
  });
}

// Rating-badge detection + color/bold/italic/link rendering for ONE line of
// text (with the "> " quote prefix, if any, already stripped by the
// caller). Extracted so both plain lines and quote-block lines share the
// exact same rendering, and reused unchanged from what used to be the
// inline body of the lines.map() callback below.
function renderLineContent(line: string, keyPrefix: string, effectiveTheme: "light" | "dark") {
  const ratingRegex = /\b(Rating\s*:\s*-?[1-5]|Rating\s+-?[1-5]|Rated\s*:\s*-?[1-5]|Rated\s+-?[1-5]|R-?[1-5]|rating\s*:\s*-?[1-5]|rating\s+-?[1-5]|rated\s*:\s*-?[1-5]|rated\s+-?[1-5]|r-?[1-5])\b/gi;
  const ratingParts = line.split(ratingRegex);

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
        // Light-theme classes were "bg-amber-55"/"border-amber-205" —
        // neither is a real Tailwind shade (the scale only has
        // 50/100/200/...), so both rules silently produced no styling,
        // leaving only the (valid) text-amber-800 color with no pill
        // background or border. Fixed to the real 50/200 shades used
        // by every other rating's light-theme pill.
        ratingColor = effectiveTheme === "dark" ? "bg-amber-500/10 text-amber-400 border border-amber-500/15 font-extrabold" : "bg-amber-50 text-amber-800 border border-amber-200 font-extrabold";
      } else if (ratingNum === 4) {
        // Deliberately the SAME literal colors in both themes (no
        // dark:/light branch) — this used to reuse the "bg-blue-55
        // text-blue-800 border-blue-200" classes, but those are part
        // of the app's global accent compatibility layer (index.css),
        // which silently remaps them to the *current* theme's accent
        // tokens regardless of which branch picked them. That's why a
        // dark-tuned variant here still rendered low-contrast/hard to
        // see: the class names looked theme-aware but the underlying
        // CSS variables always resolved to whichever theme was active.
        // Hardcoded hex values below sidestep that layer entirely, so
        // Rating 4 always looks exactly like it does in Light theme.
        ratingColor = "bg-[#E1EAF7] text-[#0754B7] border border-[#B9D2F2] font-extrabold";
      } else if (ratingNum === -1) {
        ratingColor = effectiveTheme === "dark" ? "bg-purple-500/10 text-purple-400 border border-purple-500/15 font-extrabold" : "bg-purple-50 text-purple-800 border-purple-200 font-extrabold";
      } else if (ratingNum === 0) {
        // Same invalid-shade issue as rating 3 above: "text-stone-605"
        // isn't a real Tailwind shade, so this rendered with no text
        // color override (just the pill background/border). Fixed to
        // the real stone-600 shade.
        ratingColor = effectiveTheme === "dark" ? "bg-stone-500/10 text-stone-400 border border-stone-500/15 font-extrabold" : "bg-stone-100 text-stone-600 border border-stone-200 font-extrabold";
      } else {
        // Same issue again: "text-teal-850" isn't a real shade — fixed
        // to teal-800, matching the "800" text-shade convention used
        // by the other light-theme pills (amber-800, purple-800).
        ratingColor = effectiveTheme === "dark" ? "bg-teal-500/10 text-teal-400 border border-teal-500/15 font-extrabold" : "bg-teal-50 text-teal-800 border border-teal-200 font-extrabold";
      }
      return (
        <span key={`${keyPrefix}-rating-${partIdx}`} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold mx-0.5 ${ratingColor}`}>
          {part}
        </span>
      );
    }

    return renderColorAwareTokens(part, `${keyPrefix}-fmt-${partIdx}`, effectiveTheme);
  });
}

export function renderFormattedAnnouncement(rawText: string, theme: "light" | "dark", forceLightContrast?: boolean) {
  if (!rawText) return null;
  const lines = rawText.split(/\n/); // Real line breaks only.
  const effectiveTheme = forceLightContrast ? "light" : theme;

  // Group consecutive "> "-prefixed lines into a single blockquote block;
  // every other line stays in its own "normal" block of one. Content with
  // no "> " lines at all — i.e. every announcement written before this
  // feature existed — collapses to one normal block containing every line
  // in order, which renders identically to the original implementation.
  type Block = { type: "normal" | "quote"; lines: string[]; startIdx: number };
  const blocks: Block[] = [];
  lines.forEach((line, idx) => {
    const isQuote = line.startsWith("> ");
    const stripped = isQuote ? line.slice(2) : line;
    const last = blocks[blocks.length - 1];
    if (last && last.type === (isQuote ? "quote" : "normal")) {
      last.lines.push(stripped);
    } else {
      blocks.push({ type: isQuote ? "quote" : "normal", lines: [stripped], startIdx: idx });
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
