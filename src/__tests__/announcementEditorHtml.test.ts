/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { markupToEditableHtml } from "../utils/announcementEditorHtml";

/**
 * markupToEditableHtml is the pure, DOM-free half of the live-editor
 * conversion (see announcementEditorHtml.ts's file header) — it's what runs
 * whenever content is loaded INTO the contentEditable surface (opening the
 * form, switching to Edit on an existing announcement, clearing the form).
 * Fully testable here since it's just string-in/string-out.
 *
 * Its counterpart, editableHtmlToMarkup, needs a real `DOMParser` (a browser
 * API not available in this Vitest project's plain "node" environment — see
 * vitest.config.ts) and so isn't covered by an automated test here; it was
 * instead written defensively (accepts both <b>/<strong>, <i>/<em>,
 * <span>/<font>, both rgb()/hex color formats) and should be exercised by
 * hand in a real browser before relying on it. These tests still act as an
 * implicit contract check on that side: the exact tag shapes asserted below
 * are exactly what editableHtmlToMarkup's parsing assumes it will receive.
 */
describe("markupToEditableHtml", () => {
  it("wraps an empty string as a single empty line", () => {
    expect(markupToEditableHtml("", "dark")).toBe("<div><br></div>");
  });

  it("wraps plain text with no tokens in a single div", () => {
    expect(markupToEditableHtml("Just plain text", "dark")).toBe("<div>Just plain text</div>");
  });

  it("renders bold", () => {
    expect(markupToEditableHtml("*bold*", "dark")).toBe("<div><b>bold</b></div>");
  });

  it("renders italic", () => {
    expect(markupToEditableHtml("_italic_", "dark")).toBe("<div><i>italic</i></div>");
  });

  it("renders combined bold+italic (both marker orders)", () => {
    expect(markupToEditableHtml("*_both_*", "dark")).toBe("<div><b><i>both</i></b></div>");
    expect(markupToEditableHtml("_*both*_", "dark")).toBe("<div><b><i>both</i></b></div>");
  });

  it("renders legacy bold+red (**) as an inline-colored <b>", () => {
    expect(markupToEditableHtml("**legacy**", "dark")).toBe('<div><b style="color:#ef4444">legacy</b></div>');
  });

  it("renders legacy bold+red+italic combos", () => {
    expect(markupToEditableHtml("**_x_**", "dark")).toBe('<div><b style="color:#ef4444"><i>x</i></b></div>');
    expect(markupToEditableHtml("_**x**_", "dark")).toBe('<div><b style="color:#ef4444"><i>x</i></b></div>');
  });

  it("renders an explicit color span wrapping plain text", () => {
    expect(markupToEditableHtml("[blue]note[/blue]", "dark")).toBe('<div><span style="color:#00D3F3">note</span></div>');
  });

  it("resolves the color hex per theme", () => {
    expect(markupToEditableHtml("[blue]note[/blue]", "light")).toBe('<div><span style="color:#0754B7">note</span></div>');
  });

  it("nests bold/italic inside a color span (color outermost)", () => {
    expect(markupToEditableHtml("[green]*strong point*[/green]", "dark")).toBe(
      '<div><span style="color:#10b981"><b>strong point</b></span></div>'
    );
  });

  it("renders an explicit link", () => {
    expect(markupToEditableHtml("[Click here](https://ditto.sh/abc)", "dark")).toBe(
      '<div><a href="https://ditto.sh/abc">Click here</a></div>'
    );
  });

  it("renders a quote line as a blockquote, stripping the '> ' prefix", () => {
    expect(markupToEditableHtml("> quoted text", "dark")).toBe("<blockquote>quoted text</blockquote>");
  });

  it("renders a bullet line as a <ul><li>, stripping the '• ' prefix", () => {
    expect(markupToEditableHtml("• item one", "dark")).toBe("<ul><li>item one</li></ul>");
  });

  it("renders each line of a multi-line announcement independently", () => {
    const markup = "Title line\n\n*Bold* and _italic_\n> a quote\n• a bullet";
    expect(markupToEditableHtml(markup, "dark")).toBe(
      "<div>Title line</div>" +
        "<div><br></div>" +
        "<div><b>Bold</b> and <i>italic</i></div>" +
        "<blockquote>a quote</blockquote>" +
        "<ul><li>a bullet</li></ul>"
    );
  });

  it("escapes HTML-significant characters in plain text so they can't break out of the contentEditable markup", () => {
    expect(markupToEditableHtml("5 < 10 & 10 > 5", "dark")).toBe("<div>5 &lt; 10 &amp; 10 &gt; 5</div>");
  });

  it("escapes HTML-significant characters inside formatted spans too", () => {
    expect(markupToEditableHtml("*<script>*", "dark")).toBe("<div><b>&lt;script&gt;</b></div>");
  });

  it("never emits a non-http(s) href for a link-shaped token (defense in depth, matches the read-side renderer's allowlist)", () => {
    // The toolbar's own link-insert flow always prefixes with https:// (see
    // QAAnnouncementForm.tsx confirmLinkPrompt), so this only matters for
    // hand-typed or pasted-in markup — belt-and-suspenders against a
    // javascript:/data: URI ever becoming a real href.
    const html = markupToEditableHtml("[click](javascript:alert(1))", "dark");
    expect(html).not.toContain("href=\"javascript:");
  });

  // v2 rebuild: underline + inline code (previously missing entirely — the
  // editor had no toolbar button and the grammar had no token for either).
  it("renders underline", () => {
    expect(markupToEditableHtml("~underlined~", "dark")).toBe("<div><u>underlined</u></div>");
  });

  it("renders inline code verbatim, without recursing bold/italic parsing inside it", () => {
    expect(markupToEditableHtml("`const x = *not bold*`", "dark")).toBe(
      "<div><code>const x = *not bold*</code></div>"
    );
  });

  // v2 rebuild: escaping fix for the "pasted content becomes bold" bug — a
  // literal delimiter character in plain text is stored backslash-escaped
  // (see announcementEditorHtml.ts's escapeLiteral/file header) and must be
  // shown to the author as their original literal character, never as a
  // visible backslash or as real formatting.
  it("unescapes a literal escaped asterisk back to a plain character (not bold)", () => {
    expect(markupToEditableHtml("call \\*now\\*", "dark")).toBe("<div>call *now*</div>");
  });

  it("unescapes a literal escaped underscore back to a plain character (not italic)", () => {
    expect(markupToEditableHtml("config\\_value", "dark")).toBe("<div>config_value</div>");
  });

  it("leaves a real (unescaped) token alone right next to literal escaped characters", () => {
    expect(markupToEditableHtml("*bold* and \\*not bold\\*", "dark")).toBe(
      "<div><b>bold</b> and *not bold*</div>"
    );
  });
});
