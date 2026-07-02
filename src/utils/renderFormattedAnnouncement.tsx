/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Formatting rules for announcement content:
 *   **text**  -> Bold and Red
 *   *text*    -> Bold
 *   _text_    -> Italic (combinable with either bold variant above,
 *                 e.g. **_text_** or _**text**_ -> Bold + Red + Italic,
 *                      *_text_* or _*text*_     -> Bold + Italic)
 *
 * Real line breaks (actual newline characters from pressing Enter in the
 * textarea) are preserved. The old rule that treated a literal typed
 * backslash-n ("\n") as a line-break has been removed.
 */

// Ordered so the more specific (combined) markers are tried before the
// simpler ones — this prevents "**_text_**" from being mis-split as
// "*" + "*_text_*" + "*", etc.
const FORMAT_TOKEN_REGEX =
  /(\*\*_[\s\S]+?_\*\*|_\*\*[\s\S]+?\*\*_|\*_[\s\S]+?_\*|_\*[\s\S]+?\*_|\*\*[\s\S]+?\*\*|\*[\s\S]+?\*|_[\s\S]+?_)/g;

function renderFormattedSegment(segment: string, key: string, forceLightContrast?: boolean) {
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
    return <span key={key}>{segment}</span>;
  }

  const classNames = [
    bold ? "font-extrabold" : "",
    italic ? "italic" : "",
    red
      ? (forceLightContrast ? "text-red-600" : "text-red-600 dark:text-red-400")
      : (forceLightContrast ? "" : "text-stone-900 dark:text-white"),
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span key={key} className={classNames || undefined}>
      {content}
    </span>
  );
}

export function renderFormattedAnnouncement(rawText: string, theme: "light" | "dark", forceLightContrast?: boolean) {
  if (!rawText) return null;
  const lines = rawText.split(/\n/); // Real line breaks only.
  const effectiveTheme = forceLightContrast ? "light" : theme;

  return (
    <span className="block space-y-1 text-xs md:text-[13px]">
      {lines.map((line, lineIdx) => {
        const ratingRegex = /\b(Rating\s*:\s*-?[1-5]|Rating\s+-?[1-5]|R-?[1-5]|rating\s*:\s*-?[1-5]|rating\s+-?[1-5]|r-?[1-5])\b/gi;
        const ratingParts = line.split(ratingRegex);

        const lineContent = ratingParts.map((part, partIdx) => {
          if (ratingRegex.test(part)) {
            const match = part.match(/-?[1-5]/);
            const ratingNum = match ? parseInt(match[0], 10) : 1;
            let ratingColor = "";
            if (ratingNum === 1) {
              ratingColor = effectiveTheme === "dark" ? "bg-red-500/15 text-red-400 border border-red-500/25 font-extrabold shadow-[0_0_8px_rgba(239,68,68,0.25)]" : "bg-red-50 text-red-700 border border-red-200 font-extrabold";
            } else if (ratingNum === 2) {
              ratingColor = effectiveTheme === "dark" ? "bg-orange-500/10 text-orange-400 border border-orange-500/20 font-extrabold" : "bg-orange-50 text-orange-700 border-orange-200 font-extrabold";
            } else if (ratingNum === 3) {
              ratingColor = effectiveTheme === "dark" ? "bg-amber-500/10 text-amber-400 border border-amber-500/15 font-extrabold" : "bg-amber-55 text-amber-800 border-amber-205 font-extrabold";
            } else if (ratingNum === 4) {
              ratingColor = effectiveTheme === "dark" ? "bg-blue-500/10 text-blue-400 border border-blue-500/15 font-extrabold" : "bg-blue-55 text-blue-800 border-blue-200 font-extrabold";
            } else if (ratingNum === -1) {
              ratingColor = effectiveTheme === "dark" ? "bg-purple-500/10 text-purple-400 border border-purple-500/15 font-extrabold" : "bg-purple-50 text-purple-800 border-purple-200 font-extrabold";
            } else if (ratingNum === 0) {
              ratingColor = effectiveTheme === "dark" ? "bg-stone-500/10 text-stone-400 border border-stone-500/15 font-extrabold" : "bg-stone-100 text-stone-605 border-stone-200 font-extrabold";
            } else {
              ratingColor = effectiveTheme === "dark" ? "bg-teal-500/10 text-teal-400 border border-teal-500/15 font-extrabold" : "bg-teal-50 text-teal-850 border-teal-200 font-extrabold";
            }
            return (
              <span key={`rating-${partIdx}`} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold mx-0.5 ${ratingColor}`}>
                {part}
              </span>
            );
          }

          const subParts = part.split(FORMAT_TOKEN_REGEX);
          return subParts.map((subPart, subIdx) =>
            renderFormattedSegment(subPart, `fmt-${partIdx}-${subIdx}`, forceLightContrast)
          );
        });

        return (
          <div key={`line-${lineIdx}`} style={{ minHeight: "1.2em" }}>
            {lineContent}
          </div>
        );
      })}
    </span>
  );
}
