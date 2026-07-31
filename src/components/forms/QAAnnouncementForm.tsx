/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { Check, Plus, Bold, Italic, Underline, Code, List, Quote, Link2, Baseline, X } from "lucide-react";
import { QAAnnouncement } from "../../types/announcements";
import { LoggedUser } from "../../types/user";
import { ChangeLogEntry } from "../../types/changeLog";
import { ClippedButton } from "../ClippedButton";
import { CustomSelect } from "../CustomSelect";
import { markupToEditableHtml, editableHtmlToMarkup } from "../../utils/announcementEditorHtml";

/**
 * A single labelled field — label sits directly above its control with a
 * tight 4px gap so the two read as one unit instead of drifting apart.
 * Optional `hint` renders inline after the label (e.g. "optional") so an
 * annotation never costs a second line.
 *
 * Declared at module scope (NOT inside QAAnnouncementForm) on purpose: a
 * component defined inside a render function gets a new identity every
 * render, which would unmount/remount its children and make the text inputs
 * lose focus on every keystroke.
 */
function Field({
  label,
  hint,
  theme,
  children,
  className = "",
}: {
  label: React.ReactNode;
  hint?: string;
  theme: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1 text-left min-w-0 ${className}`}>
      <label
        className={`block text-[10px] font-bold uppercase tracking-wider leading-none ${
          theme === "dark" ? "text-stone-400" : "text-stone-500"
        }`}
      >
        {label}
        {hint && <span className="normal-case font-medium opacity-60 ml-1">({hint})</span>}
      </label>
      {children}
    </div>
  );
}

/**
 * Small caps section divider — groups related fields ("Announcement
 * Details", "Content") so the form reads as intentional sections rather
 * than a flat stack of unrelated controls.
 */
function SectionLabel({ children, theme }: { children: React.ReactNode; theme: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span
        className={`text-[9px] font-black uppercase tracking-[0.18em] shrink-0 ${
          /* stone-400 was too pale to read against the light card — a section
             header should be at least as legible as the field labels below
             it, which sit at stone-500. */
          theme === "dark" ? "text-stone-500" : "text-stone-600"
        }`}
      >
        {children}
      </span>
      <span className={`h-px flex-1 ${theme === "dark" ? "bg-white/[0.07]" : "bg-black/[0.07]"}`} />
    </div>
  );
}

/**
 * A single icon button in the Content formatting toolbar. `type="button"`
 * is load-bearing — this toolbar lives inside the announcement <form>, and
 * without it every button would submit the form on click instead of
 * applying formatting to the editor.
 */
function ToolbarButton({
  title,
  onClick,
  active,
  theme,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  theme: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`p-1.5 rounded-md transition-colors cursor-pointer ${
        active
          ? theme === "dark"
            ? "bg-blue-500/20 text-blue-400"
            : "bg-blue-100 text-blue-700"
          : theme === "dark"
            ? "text-stone-400 hover:bg-white/[0.07] hover:text-white"
            : "text-stone-500 hover:bg-black/[0.05] hover:text-stone-900"
      }`}
    >
      {children}
    </button>
  );
}

export function QAAnnouncementForm({
  theme,
  qaAnnouncements,
  setQaAnnouncements,
  currentUser,
  setChangeLogs,
  editingAnnouncementId,
  setEditingAnnouncementId
}: {
  theme: string;
  qaAnnouncements: QAAnnouncement[];
  setQaAnnouncements: React.Dispatch<React.SetStateAction<QAAnnouncement[]>>;
  currentUser: LoggedUser | null;
  setChangeLogs?: React.Dispatch<React.SetStateAction<ChangeLogEntry[]>>;
  editingAnnouncementId?: string | null;
  setEditingAnnouncementId?: (id: string | null) => void;
}) {
  // Today's date as YYYY-MM-DD — the default for Announcement Date (when
  // this notice was posted), distinct from Effective Date (when the policy
  // it describes actually takes effect, which stays optional/blank).
  const todayStr = () => new Date().toISOString().slice(0, 10);

  const [announcementType, setAnnouncementType] = useState<"QA Announcement" | "General Announcement">("QA Announcement");
  const [text, setText] = useState("");
  const [date, setDate] = useState(""); // Effective Date — Optional, when the policy/rule takes effect
  const [announcementDate, setAnnouncementDate] = useState(todayStr()); // Announcement Date — when this notice was posted; defaults to today but editable
  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [validTillDate, setValidTillDate] = useState(""); // Valid Till Date — optional; blank means the notice never auto-expires
  const [fromTeam, setFromTeam] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [rating, setRating] = useState(0); // 0 = unselected/"Select" — no rating applicable
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Content formatting toolbar + live-rendering editor.
  //
  // Per design feedback, there is no separate "Preview" mode: the editor
  // IS the preview, the same way Slack/Notion/Gmail compose boxes work —
  // Bold shows as bold immediately, a color picked shows as that color
  // immediately, etc. That means the authoring surface is a real
  // `contentEditable` div, not a plain `<textarea>` (a textarea can only
  // ever show plain monospace-ish text — there is no way to render actual
  // bold/colored/quoted text inside one).
  //
  // The STORAGE format is completely unchanged: `text` is still the exact
  // same plain-markup string every existing announcement and the read-side
  // renderer (renderFormattedAnnouncement.tsx) already understand. Only the
  // authoring surface changed. Two converters (announcementEditorHtml.ts)
  // bridge the two representations:
  //   - markupToEditableHtml(text) → sets the editor's innerHTML, but ONLY
  //     when content is loaded from OUTSIDE a keystroke (opening the form,
  //     switching to Edit on a different announcement, resetting after
  //     submit) — see the effects below.
  //   - editableHtmlToMarkup(editor.innerHTML) → reads the editor's current
  //     HTML back into `text` on every `input` event.
  // Normal typing therefore only ever READS from the DOM, never WRITES
  // `innerHTML` back into it — the browser's native contentEditable caret
  // handling is what keeps the cursor in place; there's no re-render to
  // guard against losing it.
  const editorRef = useRef<HTMLDivElement>(null);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [linkPromptOpen, setLinkPromptOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const linkInputRef = useRef<HTMLInputElement>(null);
  // Snapshotted as a live Range (not offsets — there's no single "position"
  // concept once the content is a DOM tree) so the selection survives focus
  // moving to the URL field below.
  const linkSelectionRef = useRef<Range | null>(null);
  const [boldActive, setBoldActive] = useState(false);
  const [italicActive, setItalicActive] = useState(false);
  const [underlineActive, setUnderlineActive] = useState(false);
  const [codeActive, setCodeActive] = useState(false);

  const effectiveTheme: "light" | "dark" = theme === "dark" ? "dark" : "light";

  // Re-reads the editor's current HTML back into `text` — called after
  // every keystroke and after every toolbar action.
  const syncTextFromDom = () => {
    const el = editorRef.current;
    if (!el) return;
    setText(editableHtmlToMarkup(el.innerHTML, effectiveTheme));
  };

  // Programmatically loads `markup` into the editor (see the effects below
  // for the only two times this should ever run: loading an existing
  // announcement for editing, and resetting the form). Never called from a
  // keystroke handler.
  const loadIntoEditor = (markup: string) => {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = markupToEditableHtml(markup, effectiveTheme);
  };

  // Text color palette — kept to hex values already used elsewhere in the
  // app (see renderFormattedAnnouncement.tsx's COLOR_HEX for why each one
  // was picked) so "red text" here is the same red as everywhere else.
  // Black/White sits first as an explicit, always-visible swatch (per
  // design feedback: the default text color should be a selectable option
  // in the palette itself, not only reachable via a separate reset action).
  const COLOR_OPTIONS = [
    { key: "red", label: "Red", swatch: "#ef4444" },
    { key: "orange", label: "Orange", swatch: theme === "dark" ? "#b45309" : "#92400e" },
    { key: "green", label: "Green", swatch: theme === "dark" ? "#10b981" : "#059669" },
    { key: "blue", label: "Blue", swatch: theme === "dark" ? "#00D3F3" : "#0754B7" },
  ] as const;
  const DEFAULT_COLOR_SWATCH = theme === "dark" ? "#f5f5f4" : "#111827";

  const applyBold = () => {
    editorRef.current?.focus();
    document.execCommand("bold");
    syncTextFromDom();
  };

  const applyItalic = () => {
    editorRef.current?.focus();
    document.execCommand("italic");
    syncTextFromDom();
  };

  const applyUnderline = () => {
    editorRef.current?.focus();
    document.execCommand("underline");
    syncTextFromDom();
  };

  // Inline code has no native execCommand, so this is a small manual
  // Range-based toggle: unwrap if the selection already sits entirely
  // inside one <code> element, otherwise wrap the selected fragment in a
  // fresh one. Requires a real (non-collapsed) selection, same as the
  // color picker — clicking with nothing selected is a no-op rather than
  // guessing what the author meant.
  const applyCode = () => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return;

    const closestCode = (node: Node): HTMLElement | null => {
      const startEl = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
      return (startEl?.closest("code") as HTMLElement | null) ?? null;
    };
    const startCode = closestCode(range.startContainer);
    const endCode = closestCode(range.endContainer);

    if (startCode && startCode === endCode && el.contains(startCode)) {
      // Toggle off — unwrap, keeping the text in place.
      const parent = startCode.parentNode;
      if (parent) {
        while (startCode.firstChild) parent.insertBefore(startCode.firstChild, startCode);
        parent.removeChild(startCode);
      }
      syncTextFromDom();
      return;
    }

    const codeEl = document.createElement("code");
    codeEl.appendChild(range.extractContents());
    range.insertNode(codeEl);
    const newRange = document.createRange();
    newRange.selectNodeContents(codeEl);
    sel.removeAllRanges();
    sel.addRange(newRange);
    syncTextFromDom();
  };

  // `execCommand('insertUnorderedList')` is one of the least consistent
  // native commands across browsers, and especially so against this
  // editor's "one stored line = one top-level <div>" model (see
  // announcementEditorHtml.ts's file header) — it doesn't reliably touch
  // exactly the current line(s) the way formatBlock does for the Quote
  // button. So this is a manual Range-based toggle instead, same idea as
  // applyCode's manual wrap/unwrap above: find the top-level line(s) the
  // selection spans, and either wrap each one's content in a single-item
  // <ul><li> (toggling on) or unwrap it back to a plain <div> (toggling
  // off), matching whatever editableHtmlToMarkup already expects to see.
  const applyBulletList = () => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return;
    const range = sel.getRangeAt(0);

    // The very first line, before Enter has ever been pressed, can still be
    // bare text/inline nodes sitting directly inside `el` rather than
    // wrapped in a line container — normalize that one-time case into a
    // real <div> line so everything below only ever deals with top-level
    // line elements.
    const isLineTag = (n: Node) =>
      n.nodeType === Node.ELEMENT_NODE && ["DIV", "P", "BLOCKQUOTE", "UL", "OL"].includes((n as Element).tagName);
    if (el.childNodes.length > 0 && !Array.from(el.childNodes).some(isLineTag)) {
      const wrapper = document.createElement("div");
      while (el.firstChild) wrapper.appendChild(el.firstChild);
      el.appendChild(wrapper);
    }

    const getLineEl = (node: Node | null): Element | null => {
      let n: Node | null = node;
      while (n && n.parentNode && n.parentNode !== el) n = n.parentNode;
      return n && n.nodeType === Node.ELEMENT_NODE && n.parentNode === el ? (n as Element) : null;
    };

    const startLine = getLineEl(range.startContainer);
    const endLine = getLineEl(range.endContainer);
    if (!startLine) return;

    const allLines = Array.from(el.children);
    const startIdx = allLines.indexOf(startLine);
    const endIdx = endLine ? allLines.indexOf(endLine) : startIdx;
    if (startIdx === -1) return;
    const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
    const targetLines = allLines.slice(lo, hi + 1);
    if (targetLines.length === 0) return;

    // Toggle off only if every targeted line is already a bullet; otherwise
    // toggle everything on, same "uniform state wins" rule the Bold/Italic
    // toolbar highlighting already implies.
    const allAlreadyBullets = targetLines.every((line) => line.tagName === "UL");
    let lastReplacement: Element | null = null;

    targetLines.forEach((line) => {
      if (allAlreadyBullets) {
        Array.from(line.children).forEach((li) => {
          const div = document.createElement("div");
          while (li.firstChild) div.appendChild(li.firstChild);
          el.insertBefore(div, line);
          lastReplacement = div;
        });
        el.removeChild(line);
      } else if (line.tagName !== "UL") {
        const ul = document.createElement("ul");
        const li = document.createElement("li");
        while (line.firstChild) li.appendChild(line.firstChild);
        ul.appendChild(li);
        el.replaceChild(ul, line);
        lastReplacement = ul;
      } else {
        lastReplacement = line;
      }
    });

    // Restore a collapsed caret at the end of the last line touched, so the
    // author can keep typing right where they left off.
    if (lastReplacement) {
      const newRange = document.createRange();
      newRange.selectNodeContents(lastReplacement);
      newRange.collapse(false);
      sel.removeAllRanges();
      sel.addRange(newRange);
    }

    syncTextFromDom();
  };

  // Toggles the current line(s) between a normal paragraph and a
  // blockquote — `execCommand('formatBlock', ...)` already operates on
  // whichever line(s) the selection spans, matching the old
  // "toggle a prefix on every selected line" behavior.
  const applyQuote = () => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const current = document.queryCommandValue("formatBlock");
    document.execCommand("formatBlock", false, current?.toLowerCase() === "blockquote" ? "div" : "blockquote");
    syncTextFromDom();
  };

  // Color is always applied as the OUTERMOST wrapper in the stored markup
  // (see renderFormattedAnnouncement.tsx's file header) — `foreColor`
  // naturally produces that shape here too, since it wraps a fresh <span>
  // around the current selection (any bold/italic tags inside the
  // selection stay nested inside that span). "Default" resets to `inherit`
  // rather than trying to surgically unwrap a color span — see
  // announcementEditorHtml.ts's `resolveNamedColor`, which treats an
  // unresolvable/inherited color as "no color tag" on the way back out.
  const applyColor = (color: "default" | "red" | "orange" | "green" | "blue") => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    setColorPickerOpen(false);
    if (color === "default") {
      // "inherit" is not a value execCommand('foreColor', ...) can parse —
      // Chromium's real, well-documented behavior for an unparseable color
      // argument is to silently fall back to some internal default that
      // renders as a brownish color, not to actually clear formatting. Pass
      // the real default swatch hex instead (same as every other color
      // button below); resolveNamedColor in announcementEditorHtml.ts
      // already treats anything this far from the 4 named colors as "no
      // color tag" on the way back out, so this still round-trips to a
      // clean, colorless line.
      document.execCommand("foreColor", false, DEFAULT_COLOR_SWATCH);
    } else {
      const swatch = COLOR_OPTIONS.find((c) => c.key === color)?.swatch;
      if (swatch) document.execCommand("foreColor", false, swatch);
    }
    syncTextFromDom();
  };

  // Insert Link — snapshots the current selection as a live Range (so it
  // survives focus moving to the URL field below), then on confirm inserts
  // a real <a> element at that Range. With nothing selected, inserts a
  // placeholder label pre-selected so the author can immediately type over
  // it — same UX as before, just operating on the DOM instead of a string.
  const openLinkPrompt = () => {
    const el = editorRef.current;
    if (!el) return;
    const sel = window.getSelection();
    linkSelectionRef.current = sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)
      ? sel.getRangeAt(0).cloneRange()
      : null;
    setLinkUrl("");
    setLinkPromptOpen(true);
    requestAnimationFrame(() => linkInputRef.current?.focus());
  };

  const cancelLinkPrompt = () => {
    setLinkPromptOpen(false);
    editorRef.current?.focus();
  };

  const confirmLinkPrompt = () => {
    const el = editorRef.current;
    const rawUrl = linkUrl.trim();
    if (!el || !rawUrl) {
      setLinkPromptOpen(false);
      return;
    }
    // Every link this editor produces gets an explicit http(s) scheme, so
    // it always matches the renderer's http(s)-only allowlist and can
    // never become a javascript:/data: URI.
    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

    el.focus();
    const sel = window.getSelection();
    const range = linkSelectionRef.current;
    if (sel && range) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    const hadSelection = !!(sel && !sel.isCollapsed);
    const label = hadSelection ? sel!.toString() : "link text";

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.textContent = label;

    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0);
      r.deleteContents();
      r.insertNode(anchor);
      if (hadSelection) {
        // Caret right after the newly-inserted link.
        r.setStartAfter(anchor);
        r.setEndAfter(anchor);
      } else {
        // Select the placeholder label so it's obvious it's editable and
        // the author can just start typing over it.
        r.selectNodeContents(anchor);
      }
      sel.removeAllRanges();
      sel.addRange(r);
    } else {
      // No usable selection at all (editor never had focus/a caret yet) —
      // degrade to appending at the end rather than silently doing nothing.
      el.appendChild(anchor);
    }

    setLinkPromptOpen(false);
    syncTextFromDom();
  };

  // Ctrl/Cmd+B, Ctrl/Cmd+I, Ctrl/Cmd+K, Ctrl/Cmd+Shift+8 — the same
  // shortcuts a modern rich-text editor uses for Bold, Italic, Underline,
  // Insert Link, and Bulleted List respectively.
  const handleContentKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    if (key === "b") {
      e.preventDefault();
      applyBold();
    } else if (key === "i") {
      e.preventDefault();
      applyItalic();
    } else if (key === "u") {
      e.preventDefault();
      applyUnderline();
    } else if (key === "k") {
      e.preventDefault();
      openLinkPrompt();
    } else if (e.shiftKey && (key === "8" || e.code === "Digit8")) {
      e.preventDefault();
      applyBulletList();
    }
  };

  // Force plain-text paste — pasting from Word/a webpage/another app can
  // carry arbitrary foreign HTML (fonts, colors, images, embedded styles).
  // editableHtmlToMarkup degrades unknown tags to plain text rather than
  // crashing, but foreign color spans could still misresolve against the
  // app's 4-color palette. Stripping to plain text on paste sidesteps that
  // entire class of surprise, and matches how most simplified rich-text
  // boxes (Slack, GitHub's comment box) handle paste by default.
  //
  // This alone does NOT fully explain the old "pasted content becomes
  // bold" bug, though — the real cause was that a literal asterisk/
  // underscore in plain pasted text (very common: "call *now*",
  // "config_value") was stored completely unescaped and later misread as a
  // real bold/italic marker by the read-side renderer's regex parser. The
  // actual fix lives in announcementEditorHtml.ts's `escapeLiteral`, which
  // backslash-escapes those characters when ANY plain text (typed or
  // pasted) is serialized to the stored markup, regardless of how it got
  // into the editor.
  const handleContentPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const plain = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, plain);
    syncTextFromDom();
  };

  // Tracks whether the caret is currently inside bold/italic/underline/code
  // text, so the toolbar buttons highlight to reflect it — same behavior as
  // Word/Google Docs/every other rich-text toolbar. Code has no native
  // queryCommandState, so it's tracked with a small manual ancestor check
  // instead.
  useEffect(() => {
    const handleSelectionChange = () => {
      const el = editorRef.current;
      if (!el) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return;
      setBoldActive(document.queryCommandState("bold"));
      setItalicActive(document.queryCommandState("italic"));
      setUnderlineActive(document.queryCommandState("underline"));
      const anchorEl = sel.anchorNode?.nodeType === Node.ELEMENT_NODE ? (sel.anchorNode as Element) : sel.anchorNode?.parentElement;
      setCodeActive(!!anchorEl?.closest("code"));
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);

  // Sync author if user changes
  useEffect(() => {
    if (currentUser) {
      setAuthorName(currentUser.name || currentUser.email || "Mehruf P (Developer)");
    } else {
      setAuthorName("Mehruf P (Developer)");
    }
  }, [currentUser]);

  // Handle editing state
  useEffect(() => {
    if (editingAnnouncementId) {
      const item = qaAnnouncements.find(p => p.id === editingAnnouncementId);
      if (item) {
        const itemType = item.type || "QA Announcement";
        setAnnouncementType(itemType);
        const announcementText = item.announcement || "";
        setText(announcementText);
        loadIntoEditor(announcementText);
        setDate(item.effectiveDate || "");
        setAnnouncementDate(item.announcementDate || todayStr());
        if (itemType !== "QA Announcement") {
          setTitle(item.title || item.category || "");
          setValidTillDate(item.validTillDate || "");
          setFromTeam(item.from || "");
        } else {
          setCategory(item.category || "");
          setRating(item.rating ?? 0);
        }
      }
    } else {
      setText("");
      loadIntoEditor("");
      setDate("");
      setAnnouncementDate(todayStr());
      setCategory("");
      setTitle("");
      setRating(0);
      setValidTillDate("");
      setFromTeam("");
      setAnnouncementType("QA Announcement");
    }
  }, [editingAnnouncementId, qaAnnouncements]);

  // Maps a server announcements-table row (server.ts / GET|POST|PUT
  // /api/announcements) into this app's client-side QAAnnouncement shape.
  const mapRow = (row: any): QAAnnouncement => ({
    id: String(row.id),
    announcement: row.announcement,
    effectiveDate: row.effectiveDate ?? undefined,
    category: row.category,
    addedBy: row.addedBy,
    rating: row.rating ?? undefined,
    type: row.type ?? "QA Announcement",
    validTillDate: row.validTillDate ?? undefined,
    title: row.title ?? undefined,
    from: row.fromTeam ?? undefined,
    announcementDate: row.announcementDate ?? undefined,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    if (!text.trim()) {
      setErrorMsg("Please provide the announcement description!");
      return;
    }
    // Date Selection is optional — no validation required.
    if (announcementType === "QA Announcement") {
      if (!category.trim()) {
        setErrorMsg("Please provide a category matching compliance rule!");
        return;
      }
    } else {
      if (!title.trim()) {
        setErrorMsg("Please provide a title!");
        return;
      }
    }

    // NOTE (audit fix, see Production_Readiness_Audit.md Finding 3):
    // announcements now round-trip through the server (announcements table)
    // instead of only ever being written to this browser's own
    // localStorage — otherwise an Admin publishing this would never be
    // visible to any other user's session.
    const payload = {
      announcement: text.trim(),
      effectiveDate: date || null,
      category: announcementType === "QA Announcement" ? category.trim() : title.trim(),
      type: announcementType,
      title: announcementType === "QA Announcement" ? category.trim() : title.trim(),
      rating: announcementType === "QA Announcement" ? rating : 0,
      validTillDate: announcementType !== "QA Announcement" ? (validTillDate || null) : null,
      fromTeam: announcementType === "General Announcement" ? (fromTeam.trim() || null) : null,
      // Distinct from effectiveDate — when this notice was posted, not when
      // the policy it describes takes effect. Applies to both types.
      announcementDate: announcementDate || null,
    };

    try {
      if (editingAnnouncementId) {
        const res = await fetch(`/api/announcements/${editingAnnouncementId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Failed to update announcement (HTTP ${res.status}).`);

        const updated = mapRow(body.entry);
        setQaAnnouncements(prev => prev.map(item => item.id === editingAnnouncementId ? updated : item));

        if (setChangeLogs) {
          setChangeLogs(prev => [
            {
              id: `log-${Date.now()}`,
              timestamp: new Date().toISOString(),
              userName: authorName.trim() || "Underwriting Specialist",
              role: "Developer",
              actionType: "Announcement Edited",
              planName: updated.category,
              description: `Edited "${announcementType}" announcement: "${text.trim().substring(0, 50)}..."`
            },
            ...prev
          ]);
        }

        setSuccessMsg("Announcement updated successfully!");
        if (setEditingAnnouncementId) setEditingAnnouncementId(null);
      } else {
        const res = await fetch("/api/announcements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Failed to create announcement (HTTP ${res.status}).`);

        const created = mapRow(body.entry);
        // The server also auto-deletes the oldest announcements of this
        // same type once the configured retention limit is exceeded (QA and
        // General pruned independently — see enforceRetentionLimit in
        // announcementsRepository.ts) and reports which ids it removed, so
        // this browser's own list drops them immediately too instead of
        // showing a stale entry until the next full refetch.
        const deletedIds: unknown[] = Array.isArray(body.deletedIds) ? body.deletedIds : [];
        setQaAnnouncements(prev => [
          created,
          ...prev.filter(item => !deletedIds.some(id => String(id) === item.id)),
        ]);

        if (setChangeLogs) {
          setChangeLogs(prev => [
            {
              id: `log-${Date.now()}`,
              timestamp: new Date().toISOString(),
              userName: authorName.trim() || "Underwriting Specialist",
              role: "Developer",
              actionType: "Announcement Added",
              planName: created.category,
              description: `Added "${announcementType}" announcement: "${text.trim().substring(0, 50)}..."`
            },
            ...prev
          ]);
        }

        setSuccessMsg("Announcement added successfully!");
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to save this announcement. Please try again.");
      return;
    }

    // Reset fields
    setText("");
    loadIntoEditor("");
    setTitle("");
    setFromTeam("");
    if (!editingAnnouncementId) {
      setCategory("");
      setRating(0);
      setDate("");
      setAnnouncementDate(todayStr());
    }

    // Auto-clear success message after 6 seconds
    setTimeout(() => {
      setSuccessMsg("");
    }, 6000);
  };

  // Three-part shell: a fixed header, a scrolling fields region, and a
  // pinned footer holding the submit button. This is what guarantees the
  // button is always reachable without scrolling the page — only the middle
  // region ever scrolls, and only when the fields genuinely overflow.
  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full min-h-0 text-left">
      {/* HEADER — fixed */}
      <div className="shrink-0 pb-2.5 mb-3 border-b border-light-stone/5 dark:border-stone-800">
        <h3 className={`text-sm font-bold uppercase tracking-wider ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
          {editingAnnouncementId ? "Edit Announcement" : "Add New Announcement"}
        </h3>
        <p className="text-[11px] text-stone-500 mt-0.5">
          Create and manage announcements displayed across the application.
        </p>
      </div>

      {/* FIELDS — the only scrolling region */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 flex flex-col gap-3.5">

        {/* Inline Alerts */}
        {errorMsg && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-semibold flex items-center justify-between">
            <span>⚠️ {errorMsg}</span>
            <button type="button" onClick={() => setErrorMsg("")} className="text-sm font-black hover:opacity-75 cursor-pointer">×</button>
          </div>
        )}
        {successMsg && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-xs font-semibold flex items-center justify-between">
            <span>✅ {successMsg}</span>
            <button type="button" onClick={() => setSuccessMsg("")} className="text-sm font-black hover:opacity-75 cursor-pointer">×</button>
          </div>
        )}

        {/* ── SECTION: Announcement Details ── */}
        <div className="shrink-0">
          <SectionLabel theme={theme}>Announcement Details</SectionLabel>
          <div className="space-y-3">
        <Field label="Type" theme={theme}>
          <CustomSelect
            theme={theme === "dark" ? "dark" : "light"}
            value={announcementType}
            onChange={(val) => setAnnouncementType(val as "QA Announcement" | "General Announcement")}
            triggerClassName={`w-full flex items-center justify-between gap-2 text-xs font-semibold pl-2.5 pr-8 py-2 rounded-lg border outline-none cursor-pointer relative ${
              theme === "dark"
                ? "bg-[#12151A] border-[#252A34] text-white focus:border-blue-500"
                : "bg-white border-stone-250 text-stone-850 focus:border-blue-500"
            }`}
            options={[
              { value: "QA Announcement", label: "QA Announcement" },
              { value: "General Announcement", label: "General Announcement" },
            ]}
          />
        </Field>

        {/* CONDITIONAL FORMS */}
        {announcementType === "QA Announcement" ? (
          <>
            {/* Title + Rating share one row; the two dates share the next —
                paired so related fields read together and the card uses its
                width instead of stacking every control full-width. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Title" theme={theme}>
                <input
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g. Weekly QA Highlights"
                  className={`w-full text-xs font-semibold px-2.5 py-2 rounded-lg border outline-none placeholder:font-normal ${
                    theme === "dark"
                      ? "bg-[#12151A] border-[#252A34] text-white focus:border-blue-500 placeholder-stone-600"
                      : "bg-white border-stone-250 text-stone-820 focus:border-blue-500 placeholder-stone-400"
                  }`}
                  required
                />
              </Field>

              <Field label="Rating" theme={theme}>
                <CustomSelect
                  theme={theme === "dark" ? "dark" : "light"}
                  value={String(rating)}
                  onChange={(val) => setRating(Number(val))}
                  placeholder="Select"
                  triggerClassName={`w-full flex items-center justify-between gap-2 text-xs font-semibold pl-2.5 pr-8 py-2 rounded-lg border outline-none cursor-pointer relative ${
                    theme === "dark"
                      ? "bg-[#12151A] border-[#252A34] text-white focus:border-blue-500"
                      : "bg-white border-stone-250 text-stone-850 focus:border-blue-500"
                  }`}
                  options={[
                    { value: "0", label: "Select" },
                    { value: "4", label: "Rating 4" },
                    { value: "3", label: "Rating 3" },
                    { value: "2", label: "Rating 2" },
                    { value: "1", label: "Rating 1" },
                    { value: "-1", label: "Highlighting" },
                  ]}
                />
              </Field>
            </div>

            {/* Two distinct dates: Announced = when this notice was posted
                (defaults to today, drives which announcements advisors see);
                Effective = when the rule it describes kicks in (optional). */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Announced" theme={theme}>
                <input
                  type="date"
                  title="Announcement date — when this notice was posted"
                  value={announcementDate}
                  onChange={(e) => setAnnouncementDate(e.target.value)}
                  onClick={(e) => {
                    try {
                      e.currentTarget.showPicker();
                    } catch (_) {}
                  }}
                  className={`w-full text-xs font-semibold px-2.5 py-2 rounded-lg border outline-none cursor-pointer ${
                    theme === "dark"
                      ? "bg-[#12151A] border-[#252A34] text-white focus:border-blue-500"
                      : "bg-white border-stone-250 text-stone-800 focus:border-blue-500"
                  }`}
                  required
                />
              </Field>

              <Field label="Effective" hint="optional" theme={theme}>
                <input
                  type="date"
                  title="Effective date (optional) — when the rule takes effect"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  onClick={(e) => {
                    try {
                      e.currentTarget.showPicker();
                    } catch (_) {}
                  }}
                  className={`w-full text-xs font-semibold px-2.5 py-2 rounded-lg border outline-none cursor-pointer ${
                    theme === "dark"
                      ? "bg-[#12151A] border-[#252A34] text-white focus:border-blue-500"
                      : "bg-white border-stone-250 text-stone-800 focus:border-blue-500"
                  }`}
                />
              </Field>
            </div>
          </>
        ) : (
          <>
            {/* General Content form — same paired-row rhythm as QA above. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Title" theme={theme}>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Independence Day Downtime Alert"
                  className={`w-full text-xs font-semibold px-2.5 py-2 rounded-lg border outline-none placeholder:font-normal ${
                    theme === "dark"
                      ? "bg-[#12151A] border-[#252A34] text-white focus:border-blue-500 placeholder-stone-605"
                      : "bg-white border-stone-250 text-stone-820 focus:border-blue-500 placeholder-stone-400"
                  }`}
                  required
                />
              </Field>

              <Field label="From" hint="optional" theme={theme}>
                <input
                  type="text"
                  title="From (optional) — originating team or department"
                  value={fromTeam}
                  onChange={(e) => setFromTeam(e.target.value)}
                  placeholder="e.g. Underwriting Team"
                  className={`w-full text-xs font-semibold px-2.5 py-2 rounded-lg border outline-none placeholder:font-normal ${
                    theme === "dark"
                      ? "bg-[#12151A] border-[#252A34] text-white focus:border-blue-500 placeholder-stone-605"
                      : "bg-white border-stone-250 text-stone-820 focus:border-blue-500 placeholder-stone-400"
                  }`}
                />
              </Field>
            </div>

            {/* Three distinct dates: Announced = when posted (drives which
                announcements advisors see); Effective = when the rule kicks
                in (optional); Valid Till = when this notice expires — left
                blank it never auto-expires (see the filter in App.tsx). */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Announced" theme={theme}>
                <input
                  type="date"
                  title="Announcement date — when this notice was posted"
                  value={announcementDate}
                  onChange={(e) => setAnnouncementDate(e.target.value)}
                  onClick={(e) => {
                    try {
                      e.currentTarget.showPicker();
                    } catch (_) {}
                  }}
                  className={`w-full text-xs font-semibold px-2.5 py-2 rounded-lg border outline-none cursor-pointer ${
                    theme === "dark"
                      ? "bg-[#12151A] border-[#252A34] text-white focus:border-blue-500"
                      : "bg-white border-stone-250 text-stone-820 focus:border-blue-500"
                  }`}
                  required
                />
              </Field>

              <Field label="Effective" hint="optional" theme={theme}>
                <input
                  type="date"
                  title="Effective date (optional) — when the rule takes effect"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  onClick={(e) => {
                    try {
                      e.currentTarget.showPicker();
                    } catch (_) {}
                  }}
                  className={`w-full text-xs font-semibold px-2.5 py-2 rounded-lg border outline-none cursor-pointer ${
                    theme === "dark"
                      ? "bg-[#12151A] border-[#252A34] text-white focus:border-blue-500"
                      : "bg-white border-stone-250 text-stone-820 focus:border-blue-500"
                  }`}
                />
              </Field>

              <Field label="Valid Till" hint="optional" theme={theme}>
                <input
                  type="date"
                  title="Valid till date (optional) — when this notice expires"
                  value={validTillDate}
                  onChange={(e) => setValidTillDate(e.target.value)}
                  onClick={(e) => {
                    try {
                      e.currentTarget.showPicker();
                    } catch (_) {}
                  }}
                  className={`w-full text-xs font-semibold px-2.5 py-2 rounded-lg border outline-none cursor-pointer ${
                    theme === "dark"
                      ? "bg-[#12151A] border-[#252A34] text-white focus:border-blue-500"
                      : "bg-white border-stone-250 text-stone-820 focus:border-blue-500"
                  }`}
                />
              </Field>
            </div>
          </>
        )}
          </div>
        </div>

        {/* ── SECTION: Content ──
            Grows to fill whatever vertical room this card actually has
            (flex-1 + the editor's h-full below), instead of a fixed pixel
            height that left a lot of dead space on a tall external monitor
            and felt cramped on a laptop screen. min-h-0 lets it shrink
            below its content size when space is tight; a min-h floor on
            the editor itself keeps it from collapsing to nothing on very
            short viewports. The fields region above (line ~596) is already
            overflow-y-auto, so if there's truly not enough room this area
            scrolls and the submit button still never gets pushed out of
            view. */}
        <div className="flex-1 min-h-0 flex flex-col">
          <SectionLabel theme={theme}>Content</SectionLabel>

          {/* Formatting toolbar — Bold, Italic, Underline, Code, Text
              Color, Quote, Bullet list, Link — with tooltips and keyboard
              shortcuts on every button. Authors never see or type the
              underlying markup: clicks and shortcuts apply real formatting
              live in the editor below (no separate Preview step — the
              editor IS the preview), and `text` (the plain-markup string
              every existing announcement and the read-side renderer
              already understand) is derived from the editor's content on
              every change. See announcementEditorHtml.ts's file header for
              how the two representations stay in sync. */}
          <div
            className={`relative flex items-center gap-0.5 mb-1.5 p-1 rounded-lg border shrink-0 ${
              theme === "dark" ? "bg-[#0d1015] border-[#252A34]" : "bg-stone-50 border-stone-200"
            }`}
          >
            <ToolbarButton title="Bold (Ctrl+B)" theme={theme} active={boldActive} onClick={applyBold}>
              <Bold className="w-3.5 h-3.5" />
            </ToolbarButton>
            <ToolbarButton title="Italic (Ctrl+I)" theme={theme} active={italicActive} onClick={applyItalic}>
              <Italic className="w-3.5 h-3.5" />
            </ToolbarButton>
            <ToolbarButton title="Underline (Ctrl+U)" theme={theme} active={underlineActive} onClick={applyUnderline}>
              <Underline className="w-3.5 h-3.5" />
            </ToolbarButton>
            <ToolbarButton title="Code" theme={theme} active={codeActive} onClick={applyCode}>
              <Code className="w-3.5 h-3.5" />
            </ToolbarButton>

            {/* Text Color — "A" + colored bar icon (Google Docs/Chat
                convention), replacing the old paint-palette icon. */}
            <div className="relative">
              <ToolbarButton
                title="Text Color"
                theme={theme}
                active={colorPickerOpen}
                onClick={() => setColorPickerOpen((v) => !v)}
              >
                <Baseline className="w-3.5 h-3.5" />
              </ToolbarButton>
              {colorPickerOpen && (
                <>
                  {/* Click-outside catcher — a full-viewport transparent
                      layer below the popover itself so any outside click
                      closes it without needing a document-level listener. */}
                  <div className="fixed inset-0 z-10" onClick={() => setColorPickerOpen(false)} />
                  <div
                    className={`absolute top-full left-0 mt-1 z-20 p-2 rounded-lg border shadow-lg ${
                      theme === "dark" ? "bg-[#151920] border-[#252A34]" : "bg-white border-stone-200"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      {/* Black/White — the default text color, now a real
                          selectable swatch in the palette itself rather
                          than only reachable via a separate reset action. */}
                      <button
                        type="button"
                        title="Default (Black/White)"
                        onClick={() => applyColor("default")}
                        className={`w-5 h-5 rounded-full cursor-pointer border-2 transition-all hover:scale-110 ${
                          theme === "dark" ? "border-white/20 hover:border-white/50" : "border-black/10 hover:border-black/30"
                        }`}
                        style={{ backgroundColor: DEFAULT_COLOR_SWATCH }}
                      />
                      {COLOR_OPTIONS.map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          title={c.label}
                          onClick={() => applyColor(c.key)}
                          className={`w-5 h-5 rounded-full cursor-pointer border-2 transition-all hover:scale-110 ${
                            theme === "dark" ? "border-white/20 hover:border-white/50" : "border-black/10 hover:border-black/30"
                          }`}
                          style={{ backgroundColor: c.swatch }}
                        />
                      ))}
                    </div>
                    {/* Explicit, labelled reset — same operation as the
                        Black/White swatch above, kept as its own row so
                        it's discoverable even if the swatch's meaning isn't
                        obvious at a glance. */}
                    <button
                      type="button"
                      onClick={() => applyColor("default")}
                      className={`mt-2 w-full text-left text-[10.5px] font-bold px-1.5 py-1 rounded-md cursor-pointer transition-colors ${
                        theme === "dark" ? "text-stone-400 hover:bg-white/[0.06] hover:text-white" : "text-stone-500 hover:bg-black/[0.05] hover:text-stone-900"
                      }`}
                    >
                      Clear Formatting
                    </button>
                  </div>
                </>
              )}
            </div>

            <ToolbarButton title="Quote" theme={theme} onClick={applyQuote}>
              <Quote className="w-3.5 h-3.5" />
            </ToolbarButton>
            <ToolbarButton title="Bulleted List (Ctrl+Shift+8)" theme={theme} onClick={applyBulletList}>
              <List className="w-3.5 h-3.5" />
            </ToolbarButton>
            <ToolbarButton title="Insert Link (Ctrl+K)" theme={theme} active={linkPromptOpen} onClick={openLinkPrompt}>
              <Link2 className="w-3.5 h-3.5" />
            </ToolbarButton>
          </div>

          {/* Insert Link row — appears in place of a native prompt() so
              confirming/cancelling stays inline with the rest of the
              editor. Opened by the Link button above or Ctrl+K. */}
          {linkPromptOpen && (
            <div
              className={`flex items-center gap-1.5 mb-1.5 p-1.5 rounded-lg border shrink-0 ${
                theme === "dark" ? "bg-[#0d1015] border-[#252A34]" : "bg-stone-50 border-stone-200"
              }`}
            >
              <Link2 className={`w-3.5 h-3.5 shrink-0 ml-1 ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`} />
              <input
                ref={linkInputRef}
                type="text"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    confirmLinkPrompt();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelLinkPrompt();
                  }
                }}
                placeholder="Paste or type a URL, then press Enter…"
                className={`flex-1 min-w-0 text-xs font-medium px-2 py-1 rounded-md border outline-none ${
                  theme === "dark"
                    ? "bg-[#12151A] border-[#252A34] text-white focus:border-blue-500 placeholder-stone-605"
                    : "bg-white border-stone-250 text-stone-850 focus:border-blue-500 placeholder-stone-400"
                }`}
              />
              <button
                type="button"
                title="Insert link"
                onClick={confirmLinkPrompt}
                disabled={!linkUrl.trim()}
                className="text-[11px] font-bold px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white cursor-pointer"
              >
                Insert
              </button>
              <button
                type="button"
                title="Cancel"
                onClick={cancelLinkPrompt}
                className={`p-1 rounded-md cursor-pointer ${
                  theme === "dark" ? "text-stone-400 hover:bg-white/[0.07]" : "text-stone-500 hover:bg-black/[0.05]"
                }`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Live-rendering editor — a real contentEditable surface, so
              Bold/Italic/Color/Quote/Bullets/Links show applied immediately
              as the author types or clicks a toolbar button, the same way
              Slack/Notion/Gmail's compose boxes work. No separate "Preview"
              step: this IS what the announcement will look like. `relative`
              wrapper + absolutely-positioned placeholder below stands in
              for the native `placeholder` attribute a plain textarea would
              have had — contentEditable elements don't support one. */}
          <div className="relative flex-1 min-h-0 flex flex-col">
            {text.trim() === "" && (
              <span
                className={`absolute top-3 left-3 text-[10.5px] leading-relaxed pointer-events-none select-none ${
                  theme === "dark" ? "text-stone-605" : "text-stone-400"
                }`}
              >
                Write the announcement…
              </span>
            )}
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onInput={syncTextFromDom}
              onKeyDown={handleContentKeyDown}
              onPaste={handleContentPaste}
              className={`w-full flex-1 min-h-[160px] text-xs font-semibold leading-relaxed p-3 rounded-lg border outline-none overflow-y-auto [&_blockquote]:pl-3 [&_blockquote]:border-l-2 [&_blockquote]:italic [&_ul]:list-disc [&_ul]:pl-5 [&_a]:underline [&_code]:font-mono [&_code]:text-[0.92em] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded ${
                theme === "dark"
                  ? "bg-[#12151A] border-[#252A34] text-white focus:border-blue-500 [&_blockquote]:border-white/20 [&_a]:text-[#00D3F3] [&_code]:bg-white/10"
                  : "bg-white border-stone-250 text-stone-850 focus:border-blue-500 [&_blockquote]:border-black/15 [&_a]:text-[#0754B7] [&_code]:bg-black/[0.06]"
              }`}
            />
          </div>
        </div>
      </div>

      {/* FOOTER — pinned; the submit button is always visible */}
      <div className="shrink-0 pt-3 mt-3 border-t border-light-stone/5 dark:border-stone-800">
        {editingAnnouncementId ? (
          <div className="flex gap-2">
            <ClippedButton
              type="submit"
              size="lg"
              cornerBg={theme === "dark" ? "#0e2236" : "#ffffff"}
              className="flex-grow py-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold uppercase tracking-widest gap-2 shadow-md hover:shadow-blue-500/10"
            >
              <Check className="w-4 h-4" />
              <span>Save Changes</span>
            </ClippedButton>
            <ClippedButton
              type="button"
              size="lg"
              onClick={() => setEditingAnnouncementId && setEditingAnnouncementId(null)}
              cornerBg={theme === "dark" ? "#0e2236" : "#ffffff"}
              className="px-4 py-3 bg-stone-500 hover:bg-stone-600 text-white text-xs font-extrabold uppercase tracking-widest gap-2"
            >
              <span>Cancel</span>
            </ClippedButton>
          </div>
        ) : (
          <ClippedButton
            type="submit"
            size="lg"
            cornerBg={theme === "dark" ? "#0e2236" : "#ffffff"}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold uppercase tracking-widest gap-2 shadow-md hover:shadow-blue-500/10"
          >
            <Plus className="w-4 h-4" />
            <span>Add Announcement</span>
          </ClippedButton>
        )}
      </div>
    </form>
  );
}
