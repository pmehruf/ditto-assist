/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

interface GridTextureProps {
  /** Accepts a plain string too since some callers type theme loosely. */
  theme: "light" | "dark" | string;
  /** Tailwind z-index class for the overlay layer. Defaults to "z-20" to match the original Login/Home usage. */
  zIndexClassName?: string;
}

/**
 * Shared "grid" texture overlay — a subtle repeating scanline pattern used to
 * give bordered cards/sections a consistent, premium visual identity across
 * the app. Originally only present on the Login screen and the Declaration
 * Assistant "Home" intro card (LookupIntroPage.tsx); extracted here so it can
 * be dropped into any `relative`/`overflow-hidden` bordered container.
 *
 * Usage: place inside a `position: relative` card, absolutely positioned to
 * fill it. By design this renders as a faint veneer OVER the card's content
 * (z-20, vs. content typically at z-10) — the lines are thin and mostly
 * transparent, so text stays readable while giving a consistent scan-line
 * sheen across cards, matching the Login/Home page treatment.
 *
 * @example
 * <div className="relative overflow-hidden rounded-2xl border">
 *   <GridTexture theme={theme} />
 *   <div className="relative z-10">... card content ...</div>
 * </div>
 */
export function GridTexture({ theme, zIndexClassName = "z-20" }: GridTextureProps) {
  if (theme === "dark") {
    return (
      <div
        className={`absolute inset-0 pointer-events-none select-none opacity-80 ${zIndexClassName}`}
        style={{
          backgroundImage: `linear-gradient(rgba(18,16,16,0) 50%, rgba(0,0,0,0.15) 50%), linear-gradient(90deg, rgba(255,0,0,0.03), rgba(0,255,0,0.01), rgba(0,0,255,0.03))`,
          backgroundSize: "100% 3px, 3px 100%"
        }}
      />
    );
  }
  return (
    <div
      className={`absolute inset-0 pointer-events-none select-none opacity-50 ${zIndexClassName}`}
      style={{
        backgroundImage: `linear-gradient(rgba(70,115,169,0) 50%, rgba(70,115,169,0.14) 50%), linear-gradient(90deg, rgba(70,115,169,0.07), rgba(255,255,255,0), rgba(70,115,169,0.07))`,
        backgroundSize: "100% 3px, 3px 100%"
      }}
    />
  );
}

export default GridTexture;
