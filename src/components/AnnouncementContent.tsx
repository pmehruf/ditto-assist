/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { announcementContentToDisplayHtml, announcementSurfaceClasses } from "../utils/announcementHtml";

/**
 * THE renderer for published announcement content — used by the manager
 * gallery, the lookup-page carousel, and the read-and-acknowledge modal.
 * `forceLightContrast` keeps supporting the QA card's fixed light-blue
 * background regardless of the ambient theme (same contract the old
 * renderer had).
 *
 * Split out from ../utils/announcementHtml.ts (which holds the
 * sanitizer/formatting logic this component renders) so this file exports
 * only a component — see that file's header comment for why the split
 * matters (Vite Fast Refresh).
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
      // fully rebuilt against the whitelist sanitizer in announcementHtml.ts
      // — no input markup ever reaches this string unvalidated.
      dangerouslySetInnerHTML={{ __html: announcementContentToDisplayHtml(content, effectiveTheme) }}
    />
  );
}

export default AnnouncementContent;
