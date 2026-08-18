/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Send, Plus, MessageSquare, Copy, Check, AlertTriangle, RefreshCw, Tag, Trash2, Sparkles, ExternalLink } from "lucide-react";
import { CustomSelect } from "../components/CustomSelect";
import { ClippedButton } from "../components/ClippedButton";
import { renderSimpleMarkdown, stripMarkdownForCopy } from "../utils/simpleMarkdown";
import { realPlanNames } from "../utils/kbPlanNames";

interface QueryAssistPageProps {
  theme: "light" | "dark";
}

interface KbCategoryLite {
  id: number;
  name: string;
  type: "insurer" | "general";
  planNames: string[];
}

interface ChatSource {
  title: string;
  categoryName: string;
  /** brochure/policy_wording/prospectus/addon/other — see 0034's schema
   * comment and queryAssist.ts's DOCUMENT_TYPE_LABEL. */
  documentType: "brochure" | "policy_wording" | "prospectus" | "addon" | "other";
  /** Web resource's URL, or a PDF's original label/filename. Only http(s)
   * values are rendered as an openable link — a bare filename (legacy PDF
   * uploads with no real URL) still renders as a plain, unclickable pill. */
  sourceUrl: string | null;
}

const SOURCE_DOCUMENT_TYPE_LABEL: Record<ChatSource["documentType"], string> = {
  policy_wording: "Policy Wording",
  prospectus: "Prospectus",
  brochure: "Brochure",
  addon: "Add-on",
  other: "",
};

interface LocalChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: ChatSource[] | null;
  createdAt: string;
}

/**
 * A conversation, held ENTIRELY client-side (see the storage helpers below)
 * — Query Assist deliberately keeps no server-side record of advisor
 * conversations (see server.ts's POST /api/query-assist/ask, which is
 * stateless and never touches the database). Each browser's own history is
 * its own; nothing here syncs across devices or is visible to an admin.
 */
interface LocalChatSession {
  id: string;
  title: string;
  categoryId: number | null;
  planTags: string[];
  messages: LocalChatMessage[];
  updatedAt: string;
}

const GENERAL_VALUE = "general";
const SESSIONS_STORAGE_KEY = "queryAssist.sessions.v1";
// How many prior turns to resend as context on each follow-up — mirrors
// queryAssist.ts's own MAX_HISTORY_TURNS cap, sent generously here since the
// server does its own trimming.
const HISTORY_TURNS_TO_SEND = 8;

// Shown as one-tap starter chips on the empty state, once an insurer is
// chosen — generic enough to apply across insurers/plans rather than
// hardcoding any one product's terms. Purely a composer shortcut (fills the
// input, doesn't auto-send) so the advisor can still edit before asking.
const EXAMPLE_QUESTIONS = [
  "What are the waiting periods for pre-existing conditions?",
  "What's excluded from this plan's coverage?",
  "How does the claims process work for this plan?",
];

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function loadLocalSessions(): LocalChatSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistLocalSessions(sessions: LocalChatSession[]): void {
  try {
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // Storage full/unavailable (private browsing, quota) — the current
    // conversation still works, it just won't survive a refresh.
  }
}

function CopyButton({ text, dark }: { text: string; dark: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide border cursor-pointer transition-colors ${
        dark ? "bg-white/[0.06] border-white/[0.12] text-stone-300 hover:bg-white/[0.1]" : "bg-white border-stone-300 text-stone-600 hover:bg-stone-50"
      }`}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** Splits Query Assist's dual-part model output into an ANSWER and a
 * MESSAGE FOR SHARING piece — the app supplies both labels itself (see
 * queryAssist.ts's system instruction, which asks the model NOT to write
 * its own "ANSWER"/"MESSAGE FOR SHARING" headings), separated by a literal
 * "---SHARE---" line. Falls back to the older "2. MESSAGE FOR SHARING"
 * marker for any conversation still holding pre-migration text in
 * localStorage, and defensively strips a stray heading line either way in
 * case the model ever echoes one out of habit. */
function splitAnswer(content: string): { answer: string; share: string | null } {
  const sentinel = /\n?\s*-{2,}\s*SHARE\s*-{2,}\s*\n?/i;
  const legacyMarker = /\n?\s*2\.\s*MESSAGE FOR SHARING\s*\n?/i;
  const match = sentinel.exec(content) ?? legacyMarker.exec(content);

  const stripHeading = (s: string) =>
    s.replace(/^\s*(?:\d+\.\s*)?\**\s*(ANSWER|MESSAGE FOR SHARING)\s*\**\s*\n+/i, "").trim();

  if (!match) return { answer: stripHeading(content), share: null };
  const answerPart = stripHeading(content.slice(0, match.index));
  const sharePart = stripHeading(content.slice(match.index + match[0].length));
  return { answer: answerPart, share: sharePart || null };
}

/** Pulls the trailing "**References**" list (see queryAssist.ts's CITATION
 * FORMAT / OUTPUT FORMAT — the model always ends Part 1 with a bolded
 * "References" heading followed by a list) out of the answer body so it can
 * be rendered as its own clearly-labeled block instead of blending into the
 * end of the answer prose. Purely a rendering split — the reference content
 * itself is untouched. */
function splitReferences(text: string): { body: string; references: string | null } {
  const headingRe = /\n?\s*\*{0,2}References\*{0,2}\s*:?\s*\n+/i;
  const match = headingRe.exec(text);
  if (!match) return { body: text.trim(), references: null };
  const body = text.slice(0, match.index).trim();
  const references = text.slice(match.index + match[0].length).trim();
  return { body, references: references || null };
}

/**
 * "Query Assist" — advisor-facing chat over the Knowledge Base (see
 * src/server/knowledgeBase/queryAssist.ts). Open to every tier: choose an
 * insurer (or "General" for a cross-insurer question), optionally one or
 * more of that insurer's plans, then ask — answers are grounded only in
 * the matching documents/announcements, with inline Primary Reference
 * citations and a separate customer-safe "message for sharing" block.
 *
 * Conversation history is local-memory only — held in this browser's
 * localStorage, never sent anywhere but back to the /ask endpoint as
 * short-lived context for the CURRENT request. Nothing is persisted server
 * side (see server.ts's POST /api/query-assist/ask).
 */
export function QueryAssistPage({ theme }: QueryAssistPageProps) {
  const dark = theme === "dark";

  const [categories, setCategories] = useState<KbCategoryLite[]>([]);
  const [sessions, setSessions] = useState<LocalChatSession[]>(() => loadLocalSessions());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalChatMessage[]>([]);

  const [selectedCategoryValue, setSelectedCategoryValue] = useState<string>("");
  const [selectedPlanTags, setSelectedPlanTags] = useState<string[]>([]);
  // Tracks the advisor's deliberate "this question isn't about one specific
  // plan" choice — see the "No specific plan" chip below. Plan selection is
  // otherwise required (not optional) once an insurer with plans is chosen,
  // because the Product Playbook (the authoritative source for facts like
  // bonus/restoration terms) is only ever looked up for plans explicitly in
  // scope.planTags — an advisor who never picks a plan silently gets no
  // Playbook check at all, with no way to tell from the answer alone.
  const [noSpecificPlan, setNoSpecificPlan] = useState(false);

  const [questionInput, setQuestionInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const threadEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the composer as the advisor types — compact for a short
  // question, expanding up to the CSS max-height set on the textarea (see
  // the composer JSX below). Overflow is toggled explicitly rather than
  // left as a permanent `overflow-y-auto` — Windows/Chromium draws a
  // visible scrollbar (with up/down arrow buttons) on an overflow-y:auto
  // textarea even when its content doesn't actually overflow, which showed
  // up next to the send button on an empty/short, single-line question.
  // Scrolling only turns on once content genuinely exceeds the cap.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = parseFloat(getComputedStyle(el).maxHeight);
    const capped = Number.isFinite(maxHeight) ? maxHeight : Infinity;
    el.style.height = `${Math.min(el.scrollHeight, capped)}px`;
    el.style.overflowY = el.scrollHeight > capped ? "auto" : "hidden";
  }, [questionInput]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const catRes = await fetch("/api/query-assist/categories");
        const catBody = await catRes.json().catch(() => ({}));
        if (!catRes.ok) throw new Error(catBody.error || `Failed to load insurers (HTTP ${catRes.status}).`);
        setCategories(catBody.entries || []);
      } catch (err: any) {
        setLoadError(err.message || "Failed to load Product Assist.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const scopeLocked = currentSessionId !== null || messages.length > 0;
  const selectedCategory = categories.find(c => String(c.id) === selectedCategoryValue);
  // Excludes the "Add-on"/"Add-ons" pseudo-plan roster entry some insurer
  // categories carry (a tagging bucket for standalone rider documents, not
  // a real plan) — an advisor picking "the plan I'm asking about" should
  // never see it as an option. See isAddOnPlanName's comment.
  const selectablePlanNames = selectedCategory ? realPlanNames(selectedCategory.planNames) : [];
  // Once scope is locked, the full insurer-select + plan-chip controls have
  // nothing left to do — collapsing them to a single compact summary line
  // is what actually shrinks the scope band down to a real "toolbar"
  // footprint for the common case (an active conversation), rather than
  // carrying the same heavy pre-send controls for the whole chat.
  const lockedInsurerLabel = selectedCategoryValue === GENERAL_VALUE ? "General" : selectedCategory?.name ?? "Unknown insurer";
  const lockedPlanLabel = selectedPlanTags.length > 0 ? selectedPlanTags.join(", ") : selectablePlanNames.length > 0 ? "No specific plan" : null;
  const sortedSessions = [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const saveSessions = (next: LocalChatSession[]) => {
    setSessions(next);
    persistLocalSessions(next);
  };

  const startNewChat = () => {
    setCurrentSessionId(null);
    setMessages([]);
    setSendError(null);
  };

  const openSession = (session: LocalChatSession) => {
    setCurrentSessionId(session.id);
    setMessages(session.messages);
    setSelectedCategoryValue(session.categoryId === null ? GENERAL_VALUE : String(session.categoryId));
    setSelectedPlanTags(session.planTags);
    setSendError(null);
  };

  const deleteSession = (session: LocalChatSession, e: MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("Delete this conversation? This only removes it from this browser.")) return;
    saveSessions(sessions.filter(s => s.id !== session.id));
    if (currentSessionId === session.id) startNewChat();
  };

  const togglePlanTag = (plan: string) => {
    setNoSpecificPlan(false);
    setSelectedPlanTags(prev => (prev.includes(plan) ? prev.filter(p => p !== plan) : [...prev, plan]));
  };

  // The explicit opt-out from picking a real plan — see noSpecificPlan's
  // comment above. Deliberately its own action rather than "just leave the
  // chips unclicked", so skipping the Playbook check is a choice the
  // advisor visibly makes, not something that happens by default.
  const chooseNoSpecificPlan = () => {
    setSelectedPlanTags([]);
    setNoSpecificPlan(true);
  };

  const sendQuestion = async () => {
    const question = questionInput.trim();
    if (!question || sending) return;
    if (currentSessionId === null && !selectedCategoryValue) {
      setSendError("Choose an insurer (or General) before asking.");
      return;
    }
    if (currentSessionId === null && selectedCategory && selectablePlanNames.length > 0 && selectedPlanTags.length === 0 && !noSpecificPlan) {
      setSendError('Select a plan, or choose "No specific plan," before asking — this is what lets the Product Playbook be checked.');
      return;
    }

    setSending(true);
    setSendError(null);

    const priorMessages = messages;
    const categoryId = selectedCategoryValue === GENERAL_VALUE ? null : Number(selectedCategoryValue);
    const planTags = selectedPlanTags;

    const userMsg: LocalChatMessage = { id: genId(), role: "user", content: question, sources: null, createdAt: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setQuestionInput("");

    try {
      const history = priorMessages.slice(-HISTORY_TURNS_TO_SEND).map(m => ({ role: m.role, content: m.content }));
      const res = await fetch("/api/query-assist/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId, planTags, question, history }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to get an answer (HTTP ${res.status}).`);

      const assistantMsg: LocalChatMessage = {
        id: genId(),
        role: "assistant",
        content: body.answer,
        sources: body.sources || null,
        createdAt: new Date().toISOString(),
      };
      const finalMessages = [...priorMessages, userMsg, assistantMsg];
      setMessages(finalMessages);

      const now = new Date().toISOString();
      if (currentSessionId === null) {
        const newSession: LocalChatSession = {
          id: genId(),
          title: question.slice(0, 120),
          categoryId,
          planTags,
          messages: finalMessages,
          updatedAt: now,
        };
        setCurrentSessionId(newSession.id);
        saveSessions([newSession, ...sessions]);
      } else {
        saveSessions(sessions.map(s => (s.id === currentSessionId ? { ...s, messages: finalMessages, updatedAt: now } : s)));
      }
    } catch (err: any) {
      setSendError(err.message || "Failed to get an answer. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const proseClass = `text-xs leading-relaxed space-y-2 [&_ol]:mt-1 [&_ul]:mt-1 [&_li]:pl-0.5 ${dark ? "text-stone-200" : "text-stone-800"}`;

  const categoryOptions = [
    { value: GENERAL_VALUE, label: "General (not tied to one insurer)" },
    ...categories.filter(c => c.type === "insurer").map(c => ({ value: String(c.id), label: c.name })),
  ];

  if (loading) {
    return <div className="text-xs font-semibold text-content-muted py-8 text-center">Loading Product Assist…</div>;
  }

  return (
    <div className="space-y-5 text-left lg:flex lg:flex-col lg:flex-1 lg:min-h-0">
      <div className="shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-3 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${dark ? "text-white" : "text-[#111827]"}`}>
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: dark ? "#00D3F3" : "#4673a9" }} />
            <span>Product Assist</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            Ask. Verify. Understand. Get answers to your product queries, backed by references you can verify.
          </p>
        </div>
        <ClippedButton size="md" onClick={startNewChat} className="bg-[var(--tab-active-bg)] text-[var(--tab-active-text)] px-4 py-2 text-[11px] font-black uppercase tracking-wider flex items-center gap-2">
          <Plus className="w-3.5 h-3.5" /> New Chat
        </ClippedButton>
      </div>

      {loadError && (
        <div className={`shrink-0 text-xs font-semibold px-3 py-2 rounded-lg border flex items-center gap-2 ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {loadError}
        </div>
      )}

      {/* Sidebar + main card share one grid row so they always end up the
          same height — at lg+ this row fills whatever vertical space is
          left between the header above and the app's footer below (see
          App.tsx's query_assist branch of the flush-fit layout used by a
          couple of other data-dense pages), so only the lists/thread
          inside each card scroll, never the page itself. Below lg the
          cards stack and the page scrolls normally, which reads better on
          a narrow/short viewport than a forced fixed-height layout. */}
      <div className="grid grid-cols-1 lg:grid-cols-[clamp(200px,16vw,280px)_1fr] gap-5 lg:flex-1 lg:min-h-0">
        {/* Session history sidebar — deliberately carries NO card treatment
            at all (no border, no background fill, no radius, no shadow) so
            it can never be mistaken for a peer of the Chat Workspace below —
            it just sits directly on the page, the way a nav rail does, with
            only a plain typographic heading + hairline rule marking it as
            its own zone. The workspace is the one real container in this
            layout; everything else is comparatively "un-carded." */}
        <div className="flex flex-col min-h-0 lg:h-full overflow-hidden">
          <span className={`shrink-0 block text-[9.5px] font-bold uppercase tracking-[0.12em] text-content-muted opacity-70 pb-2 mb-2 border-b ${dark ? "border-white/[0.08]" : "border-[var(--border)]"}`}>
            Recent conversations
          </span>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5 no-scrollbar">
          {sortedSessions.length === 0 && <span className="block text-[11px] font-semibold text-content-muted px-1 italic">No conversations yet.</span>}
          {sortedSessions.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => openSession(s)}
              // Selected state reads via a left accent bar + full-contrast
              // text — a nav-rail "current item" cue — rather than a filled
              // pill background, so the list stays lightweight typography
              // instead of a stack of small cards. Unselected rows carry no
              // border/fill at all, only a hover tint.
              className={`group w-full text-left pl-2.5 pr-2 py-2 border-l-2 text-[11px] font-semibold flex items-start justify-between gap-1.5 transition-colors cursor-pointer ${
                currentSessionId === s.id
                  ? dark ? "border-l-sky-400 text-sky-300" : "border-l-sky-500 text-sky-700"
                  : dark
                    ? "border-l-transparent text-stone-400 hover:bg-white/[0.04] hover:text-stone-200"
                    : "border-l-transparent text-stone-600 hover:bg-stone-900/[0.035] hover:text-stone-800"
              }`}
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <MessageSquare className="w-3 h-3 shrink-0 opacity-70" />
                <span className="truncate">{s.title || "Untitled"}</span>
              </span>
              {/* Hidden until the row is hovered (or it's the open
                  conversation) to cut visual noise in the list — still the
                  same click target/handler, just not shown by default. */}
              <span
                onClick={e => deleteSession(s, e)}
                className={`shrink-0 cursor-pointer transition-opacity ${
                  currentSessionId === s.id
                    ? "opacity-50 hover:opacity-100"
                    : "opacity-0 pointer-events-none group-hover:opacity-50 group-hover:pointer-events-auto hover:!opacity-100"
                }`}
                title="Delete"
              >
                <Trash2 className="w-3 h-3" />
              </span>
            </button>
          ))}
          </div>
        </div>

        {/* Main chat panel — the primary container in this workspace: larger
            radius, brighter/more opaque surface, and a real shadow lift it
            above the sidebar's flat nav-rail treatment and the scope strip
            nested inside it below. */}
        <div
          className={`rounded-2xl border shadow-card flex flex-col min-h-0 lg:h-full overflow-hidden ${
            dark ? "bg-white/[0.035] border-white/[0.09]" : "bg-surface border-[var(--border-strong)]"
          }`}
        >
          {/* Scope band — a control STRIP, not a card: no fill of its own
              (the workspace's own bg-surface shows straight through), just
              a hairline divider marking it off from the conversation below.
              Once locked it collapses to a single compact summary line —
              the full insurer-select + plan-chip controls have nothing left
              to do at that point, so keeping them on screen for the whole
              conversation was the single biggest reason this band read as
              "another heavy card" rather than a toolbar. */}
          <div className={`shrink-0 border-b ${dark ? "border-white/[0.07]" : "border-[var(--border)]"}`}>
            {scopeLocked ? (
              <div className="flex items-center gap-2 px-4 py-2 text-[10.5px] font-semibold">
                <span className="opacity-50" title="Locked — start a new chat to change insurer or plans.">🔒</span>
                <span className={dark ? "text-stone-200" : "text-stone-800"}>{lockedInsurerLabel}</span>
                {lockedPlanLabel && (
                  <>
                    <span className="opacity-30">·</span>
                    <span className="text-content-muted opacity-80">{lockedPlanLabel}</span>
                  </>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2.5 px-4 py-2.5">
                <CustomSelect
                  theme={theme}
                  value={selectedCategoryValue}
                  onChange={v => { setSelectedCategoryValue(v); setSelectedPlanTags([]); setNoSpecificPlan(false); }}
                  placeholder="Choose an insurer or General"
                  options={categoryOptions}
                  // Matches the compact trigger sizing used for every other
                  // filter/select across the app (Audit, My Activity, Plan
                  // Management, …) instead of CustomSelect's larger default
                  // trigger, which read as oversized next to those.
                  triggerClassName={`w-44 shrink-0 flex items-center justify-between gap-2 text-xs font-bold pl-3 pr-8 py-1.5 rounded-lg border outline-none transition-colors relative cursor-pointer ${
                    dark ? "bg-white/[0.05] border-white/[0.1] text-white" : "bg-surface-inset border-[var(--border)] text-stone-900"
                  }`}
                />
                {selectedCategory && selectablePlanNames.length > 0 && (
                  // Single-line, horizontally-scrolling chip strip — however
                  // many plans an insurer has, this band never grows past
                  // one row. No longer "optional": the Product Playbook (the
                  // authoritative source for plan facts like bonus/
                  // restoration terms) is only ever checked for plans
                  // explicitly picked here, so choosing a plan or "No
                  // specific plan" is required before sending — see
                  // sendQuestion's validation and chooseNoSpecificPlan.
                  <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                    <Tag className="w-3 h-3 shrink-0 text-content-muted opacity-50" />
                    {selectablePlanNames.map(plan => (
                      <button
                        key={plan}
                        type="button"
                        onClick={() => togglePlanTag(plan)}
                        className={`shrink-0 whitespace-nowrap px-2 py-1 rounded text-[10.5px] font-bold border transition-colors cursor-pointer ${
                          selectedPlanTags.includes(plan)
                            ? dark ? "bg-sky-500/20 border-sky-500/40 text-sky-300" : "bg-sky-100 border-sky-300 text-sky-700"
                            : dark ? "bg-white/[0.04] border-white/[0.09] text-stone-500 hover:bg-white/[0.08]" : "bg-surface-inset border-[var(--border)] text-stone-500 hover:bg-white"
                        }`}
                      >
                        {plan}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={chooseNoSpecificPlan}
                      title="This question isn't about one specific plan — Playbook won't be checked."
                      className={`shrink-0 whitespace-nowrap px-2 py-1 rounded text-[10.5px] font-bold border border-dashed transition-colors cursor-pointer ${
                        noSpecificPlan
                          ? dark ? "bg-white/[0.1] border-white/[0.3] text-white" : "bg-stone-200 border-stone-400 text-stone-700"
                          : dark ? "bg-transparent border-white/[0.15] text-stone-500 hover:bg-white/[0.06]" : "bg-transparent border-[var(--border-strong)] text-stone-500 hover:bg-white"
                      }`}
                    >
                      No specific plan
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Thread — fills whatever space is left in the card (see the
              card's own lg:h-full above) rather than a fixed pixel/vh
              range, so it always reaches exactly to the card's bottom
              edge instead of leaving dead space on a tall viewport or
              overflowing the card on a short one. Below lg the card has
              no fixed height, so this falls back to a sensible minimum
              and the page scrolls normally. */}
          <div className="flex-1 min-h-[240px] lg:min-h-0 overflow-y-auto space-y-5 px-4 py-5">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-3 text-center py-10">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center ${dark ? "bg-sky-500/15 text-sky-300" : "bg-sky-100 text-sky-700"}`}>
                  <Sparkles className="w-4 h-4" />
                </div>
                <div className="space-y-1 max-w-sm">
                  <p className={`text-xs font-bold ${dark ? "text-white" : "text-stone-800"}`}>
                    {selectedCategoryValue ? "Ask your first question." : "Choose an insurer above and ask your first question."}
                  </p>
                  <p className="text-[11px] font-medium text-content-muted">
                    Ask about coverage, exclusions, waiting periods, add-ons, claims or plan benefits.
                  </p>
                </div>
                {selectedCategoryValue && (
                  <div className="flex flex-wrap justify-center gap-1.5 max-w-md">
                    {EXAMPLE_QUESTIONS.map(q => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setQuestionInput(q)}
                        className={`text-[10.5px] font-semibold px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
                          dark ? "bg-white/[0.04] border-white/[0.1] text-stone-300 hover:bg-white/[0.08]" : "bg-white border-stone-300 text-stone-600 hover:bg-stone-50"
                        }`}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {messages.map(m => {
              if (m.role === "user") {
                return (
                  <div key={m.id} className="flex justify-end">
                    <div className={`max-w-[80%] px-3.5 py-2 rounded-2xl rounded-tr-md text-xs font-semibold shadow-soft ${dark ? "bg-sky-500/20 text-sky-100" : "bg-sky-100 text-sky-900"}`}>
                      {m.content}
                    </div>
                  </div>
                );
              }
              const { answer, share } = splitAnswer(m.content);
              const { body, references } = splitReferences(answer);
              return (
                <div key={m.id} className="flex justify-start gap-2 max-w-[92%]">
                  {/* Small avatar badge gives the AI response its own
                      identity as a chat message rather than a bordered
                      panel — mirrors the user bubble's alignment cue on the
                      opposite side of the thread. */}
                  <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5 ${dark ? "bg-sky-500/20 text-sky-300" : "bg-sky-100 text-sky-700"}`}>
                    <Sparkles className="w-3 h-3" />
                  </div>
                  {/* Message surface — lifted off the workspace behind it by
                      shadow + a hue shift alone, deliberately with NO
                      border in either theme. The outer workspace card
                      already owns the one real border/edge in this layout;
                      stacking a second border around every answer is what
                      produced the "card inside a card" look before. Light
                      theme uses the accent-tinted surface tier (a subtle
                      blue wash, echoing the AI avatar/user-bubble accent)
                      rather than the neutral elevated tier, so it reads as
                      distinct even at a glance, without needing an outline.
                      A drop-shadow reads as "this floats above," a
                      different (and here, correct) cue from "this is boxed
                      in." */}
                  <div className={`min-w-0 flex-1 px-4 py-4 rounded-2xl rounded-tl-md space-y-4 shadow-card ${dark ? "bg-white/[0.06]" : "bg-surface-tint"}`}>
                    {/* Answer — the verified response to the advisor's question. */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[9.5px] font-bold uppercase tracking-wider text-content-muted">Answer</span>
                        <CopyButton text={stripMarkdownForCopy(body)} dark={dark} />
                      </div>
                      <div className={proseClass}>{renderSimpleMarkdown(body)}</div>
                    </div>

                    {/* References — the advisor's verification path. A
                        hairline top divider + quieter/smaller type marks it
                        as nested-inside-the-answer content, without a second
                        filled background box competing with the answer's
                        own surface. Content is untouched — this only
                        changes how it's presented. */}
                    {references && (
                      <div className={`pt-2.5 border-t ${dark ? "border-white/[0.08]" : "border-stone-900/[0.08]"}`}>
                        <span className="block text-[9.5px] font-bold uppercase tracking-wider text-content-muted opacity-70 mb-1">References</span>
                        <div className={`text-[11px] leading-relaxed [&_ul]:space-y-1 [&_li]:pl-0.5 ${dark ? "text-stone-400" : "text-stone-600"}`}>
                          {renderSimpleMarkdown(references)}
                        </div>
                      </div>
                    )}

                    {/* Draft Message — a ready-to-use customer-facing
                        paraphrase, not the final/only appropriate wording. */}
                    {share && (
                      <div className={`p-2.5 rounded-lg border ${dark ? "bg-emerald-500/10 border-emerald-500/25" : "bg-emerald-50 border-emerald-200"}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9.5px] font-bold uppercase tracking-wider text-emerald-500">Draft message</span>
                          <CopyButton text={stripMarkdownForCopy(share)} dark={dark} />
                        </div>
                        <div className={`${proseClass} ${dark ? "text-emerald-200" : "text-emerald-900"}`}>{renderSimpleMarkdown(share)}</div>
                      </div>
                    )}
                    {m.sources && m.sources.length > 0 && (
                      // Sources — the quietest, smallest-weight content in
                      // the whole answer, on purpose: a hairline divider and
                      // small text links, not another filled/bordered pill
                      // tray. It must read as "these support the answer
                      // above," never compete with it for attention.
                      <div className={`pt-2.5 border-t ${dark ? "border-white/[0.08]" : "border-stone-900/[0.08]"}`}>
                        <span className="block text-[9px] font-bold uppercase tracking-wider text-content-muted opacity-70 mb-1.5">Sources</span>
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                          {m.sources.map(s => {
                            const typeLabel = SOURCE_DOCUMENT_TYPE_LABEL[s.documentType];
                            // Only a real http(s) URL is openable for verification — a
                            // legacy PDF upload's sourceUrl is just its original
                            // filename (see pdfIngest.ts), which isn't a link.
                            const isOpenable = !!s.sourceUrl && /^https?:\/\//i.test(s.sourceUrl);
                            const linkClass = `inline-flex items-center gap-0.5 text-[10px] font-semibold ${dark ? "text-stone-500" : "text-stone-500"} ${isOpenable ? (dark ? "hover:text-sky-300 hover:underline" : "hover:text-sky-700 hover:underline") : ""}`;
                            const label = typeLabel ? `${s.title} · ${typeLabel}` : s.title;
                            return isOpenable ? (
                              <a
                                key={s.title}
                                href={s.sourceUrl!}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Open source document to verify"
                                className={linkClass}
                              >
                                {label}
                                <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                              </a>
                            ) : (
                              <span key={s.title} className={linkClass}>
                                {label}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {sending && (
              <div className="flex justify-start gap-2">
                <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5 ${dark ? "bg-sky-500/20 text-sky-300" : "bg-sky-100 text-sky-700"}`}>
                  <Sparkles className="w-3 h-3" />
                </div>
                <div className={`px-4 py-3 rounded-2xl rounded-tl-md text-xs font-semibold flex items-center gap-2 shadow-card ${dark ? "bg-white/[0.06] text-stone-400" : "bg-surface-tint text-stone-500"}`}>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Checking the Knowledge Base…
                </div>
              </div>
            )}
            <div ref={threadEndRef} />
          </div>

          {sendError && (
            <div className={`shrink-0 mx-4 mb-3 text-xs font-semibold px-3 py-2 rounded-lg border flex items-center gap-2 ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {sendError}
            </div>
          )}

          {/* Composer band — matches the Scope band's quiet "divider, no
              fill" treatment, so the workspace reads as one continuous
              surface with chrome strips top and bottom, not a third
              differently-shaded panel. The input pill itself is what
              carries the weight here: the brightest surface tone in the
              whole panel plus a real border + shadow, unmistakably the
              primary interaction point. Focus uses a self-contained ring
              rather than a wide glow shadow — a glow that size would get
              clipped by the workspace card's own overflow-hidden edge. */}
          <div className={`shrink-0 px-4 py-3.5 border-t ${dark ? "border-white/[0.07]" : "border-[var(--border)]"}`}>
            <div
              className={`qa-composer flex items-end gap-2 rounded-xl border pl-3 pr-1.5 py-1.5 shadow-card transition-colors focus-within:ring-2 ${
                dark
                  ? "bg-white/[0.09] border-white/[0.16] focus-within:border-sky-500/40 focus-within:ring-sky-500/20"
                  : "bg-surface border-[var(--border-strong)] focus-within:border-sky-400 focus-within:ring-sky-400/25"
              }`}
            >
              <textarea
                ref={textareaRef}
                value={questionInput}
                onChange={e => setQuestionInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendQuestion(); }
                }}
                placeholder="Write your query"
                disabled={sending}
                rows={1}
                // The blue box + suggestion strip some users see while typing
                // ("and / for / in") is the OS/browser's own spellcheck or
                // predictive-text overlay, not app styling — these
                // attributes opt the field out of every browser/extension
                // hook that can draw one (spellcheck, autocomplete,
                // autocorrect/autocapitalize on iOS/Safari, and Grammarly's
                // injected overlay specifically via the data- attributes).
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                data-gramm="false"
                data-gramm_editor="false"
                data-enable-grammarly="false"
                // Auto-grows with the JS height calc in the effect above,
                // up to this max-height (a bit shorter on small viewports so
                // it can't dominate a short screen) — beyond that it scrolls
                // internally instead of growing the composer further.
                className={`flex-1 min-w-0 bg-transparent border-none outline-none resize-none text-xs font-medium py-1.5 max-h-[35vh] sm:max-h-40 overflow-y-hidden ${
                  dark ? "text-white placeholder:text-stone-500" : "text-stone-900 placeholder:text-stone-400"
                }`}
              />
              <button
                type="button"
                onClick={sendQuestion}
                disabled={sending || !questionInput.trim()}
                title="Send"
                className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center cursor-pointer transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 bg-[var(--tab-active-bg)] text-[var(--tab-active-text)]"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
