/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReactNode } from "react";

/**
 * Minimal markdown renderer for Query Assist's model output (see
 * src/server/knowledgeBase/queryAssist.ts's system instruction, which asks
 * the model for **bold**, numbered lists, and bullets). Not a
 * general-purpose markdown engine — this app has no markdown dependency
 * installed, and the model's output surface is narrow enough (bold spans,
 * numbered/bulleted lists, paragraphs) that a small hand-rolled block/inline
 * parser covers it without pulling in react-markdown. Renders **bold** runs
 * to <strong>, "1. "-prefixed line runs to <ol>, "- "/"* "-prefixed line
 * runs to <ul> (both bullet markers are accepted — the model doesn't always
 * follow the hyphen-only instruction, and "* " is unambiguous here since a
 * bold run always has a non-space character right after the leading "**"),
 * and everything else to <p> with <br> for in-paragraph line breaks.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(p => p !== "");
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={`${keyPrefix}-b-${i}`}>{part.slice(2, -2)}</strong>;
    }
    return <span key={`${keyPrefix}-t-${i}`}>{part}</span>;
  });
}

/** Strips the **bold** markers (keeping the enclosed text) before copying a
 * MESSAGE FOR SHARING block to the clipboard — a customer-facing paste
 * shouldn't show literal asterisks in whatever app the advisor pastes into. */
export function stripMarkdownForCopy(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1");
}

export function renderSimpleMarkdown(text: string): ReactNode {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let blockKey = 0;
  const numberedRe = /^\s*\d+\.\s+/;
  // A single "-" or "*" followed by whitespace is a bullet; "**bold**" never
  // matches since its second "*" isn't whitespace.
  const bulletRe = /^\s*[-*]\s+/;

  while (i < lines.length) {
    if (lines[i].trim() === "") {
      i++;
      continue;
    }

    if (numberedRe.test(lines[i])) {
      const items: string[] = [];
      while (i < lines.length && numberedRe.test(lines[i])) {
        items.push(lines[i].replace(numberedRe, ""));
        i++;
      }
      const key = blockKey++;
      blocks.push(
        <ol key={`b-${key}`} className="list-decimal pl-5 space-y-1">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `ol-${key}-${idx}`)}</li>
          ))}
        </ol>
      );
      continue;
    }

    if (bulletRe.test(lines[i])) {
      const items: string[] = [];
      while (i < lines.length && bulletRe.test(lines[i])) {
        items.push(lines[i].replace(bulletRe, ""));
        i++;
      }
      const key = blockKey++;
      blocks.push(
        <ul key={`b-${key}`} className="list-disc pl-5 space-y-1">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `ul-${key}-${idx}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !numberedRe.test(lines[i]) && !bulletRe.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    const key = blockKey++;
    blocks.push(
      <p key={`b-${key}`}>
        {paraLines.map((l, idx) => (
          <span key={idx}>
            {renderInline(l, `p-${key}-${idx}`)}
            {idx < paraLines.length - 1 && <br />}
          </span>
        ))}
      </p>
    );
  }

  return <>{blocks}</>;
}
