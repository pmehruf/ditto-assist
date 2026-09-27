/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Send, Plus, MessageSquare, Copy, Check, AlertTriangle, RefreshCw, Tag, Trash2, ExternalLink, Library, BookOpen, FileText, Building2, ChevronDown } from "lucide-react";
import { CustomSelect } from "../components/CustomSelect";
import { ClippedButton } from "../components/ClippedButton";
import { renderSimpleMarkdown, stripMarkdownForCopy } from "../utils/simpleMarkdown";
import { realPlanNames } from "../utils/kbPlanNames";
import { HEALTH_FAQ_LIBRARY_URL, TERM_FAQ_LIBRARY_URL } from "../constants/productAssistLibrary";
import type { LoggedUser } from "../types/user";

/** Health/Term — see the shared "announcement_team" enum this reuses
 * (schema.ts) and server.ts's resolveCallerDomain for the authoritative,
 * server-side version of this same rule. */
type ProductAssistDomain = "Health" | "Term";

/** Client-side mirror of server.ts's teamForTags — which single domain (if
 * any) a caller's tags restrict them to. undefined = no restriction (no
 * tags, or both tags), matching the same "both/neither = sees both"
 * precedent already established for Dedicated Announcements/Did You Know. */
function domainRestrictionForTags(tags: string[] | null | undefined): ProductAssistDomain | undefined {
  const set = new Set(tags ?? []);
  const hasHealth = set.has("Health");
  const hasTerm = set.has("Term");
  if (hasHealth && !hasTerm) return "Health";
  if (hasTerm && !hasHealth) return "Term";
  return undefined;
}

/** Mirrors QuotaStatus in src/server/knowledgeBase/productAssistQuota.ts —
 * the caller's own live credit status, returned by GET /api/product-assist/
 * quota and echoed back in every /api/product-assist/ask response. */
interface ProductAssistQuotaStatus {
  matchedGroups: { id: number; name: string }[];
  unlimited: boolean;
  dailyLimit: number | null;
  monthlyLimit: number | null;
  dailyUsed: number;
  monthlyUsed: number;
  dailyRemaining: number | null;
  monthlyRemaining: number | null;
  extraCredits: number;
  warningThresholdPercent: number;
  monthlyUtilizationPercent: number | null;
  state: "unlimited" | "ok" | "warning" | "daily_exceeded" | "at_limit";
}

interface ProductAssistPageProps {
  theme: "light" | "dark";
  currentUser: LoggedUser | null;
}

interface KbCategoryLite {
  id: number;
  name: string;
  type: "insurer" | "general" | "fundamentals";
  planNames: string[];
}

interface ChatSource {
  title: string;
  categoryName: string;
  /** brochure/policy_wording/prospectus/addon/other — see 0034's schema
   * comment and productAssist.ts's DOCUMENT_TYPE_LABEL. */
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

// ── Product Assist Library — read-only navigator over the same Knowledge
// Base data /api/product-assist/categories draws its plan selector from (see
// server.ts's /api/product-assist/library). Never a second resource store —
// just a nested view of insurer -> plan -> resources / insurer resources. */
interface LibraryResource {
  id: number;
  title: string;
  documentType: ChatSource["documentType"];
  sourceUrl: string | null;
  type: "pdf" | "web" | "sheet";
}
interface LibraryPlan {
  name: string;
  resources: LibraryResource[];
}
interface LibraryInsurer {
  id: number;
  name: string;
  plans: LibraryPlan[];
  insurerResources: LibraryResource[];
}
interface LibraryData {
  playbook: { sourceUrl: string | null };
  insurers: LibraryInsurer[];
}

interface LocalChatMessage {
  id: string;
  role: "user" | "assistant";
  /** User turn: the question as typed. Assistant turn: the verified,
   * advisor-facing answer (productAssist.ts's structured "answer" field). */
  content: string;
  /** Assistant only — the customer-facing paraphrase (structured "share"
   * field), or null when the model didn't reach a genuine, sufficiently-
   * certain sourced answer to draft one from. `undefined` (as opposed to
   * `null`) marks a message saved before this structured-output migration —
   * see splitAnswer's legacy fallback below for how those still render. */
  share?: string | null;
  sources: ChatSource[] | null;
  createdAt: string;
}

/**
 * A conversation, held ENTIRELY client-side (see the storage helpers below)
 * — Product Assist deliberately keeps no server-side record of advisor
 * conversations (see server.ts's POST /api/product-assist/ask, which is
 * stateless and never touches the database). Each browser's own history is
 * its own; nothing here syncs across devices or is visible to an admin.
 */
interface LocalChatSession {
  id: string;
  title: string;
  /** Health/Term (2026-09) — which vertical this conversation's insurer/plan
   * scope belongs to. `undefined` marks a conversation saved before this
   * field existed, which is always implicitly "Health" (Term didn't exist
   * yet) — see openSession's fallback below. */
  domain?: ProductAssistDomain;
  categoryId: number | null;
  planTags: string[];
  messages: LocalChatMessage[];
  updatedAt: string;
}

const GENERAL_VALUE = "general";
const SESSIONS_STORAGE_KEY = "productAssist.sessions.v1";
// Pre-rename key (2026-08: "Query Assist" -> "Product Assist" naming
// cleanup) — loadLocalSessions falls back to this if the new key is empty,
// so a browser with existing conversation history saved under the old name
// doesn't just silently lose it after this deploy.
const LEGACY_SESSIONS_STORAGE_KEY = "queryAssist.sessions.v1";
// How many prior turns to resend as context on each follow-up — mirrors
// productAssist.ts's own MAX_HISTORY_TURNS cap, sent generously here since the
// server does its own trimming.
const HISTORY_TURNS_TO_SEND = 8;

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function loadLocalSessions(): LocalChatSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY) ?? localStorage.getItem(LEGACY_SESSIONS_STORAGE_KEY);
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

/** AI/Product Assist message avatar — the source PNG carries its own dark
 * vignette rather than true alpha transparency; `isolate` + `mix-blend-screen`
 * erases that vignette against whatever's behind it, so it reads as a clean
 * floating character in both themes instead of a dark square. `object-contain`
 * keeps the full character uncropped/unstretched, per spec.
 *
 * Sized larger than AdvisorAvatar's box (w-11 vs w-8) even though both
 * render as squares: this source image is a wide 3:2 frame (vs the advisor
 * avatar's near-square ~1:1 crop), so object-contain letterboxes it down to
 * ~2/3 of a same-size box's height — without the size bump the character
 * itself renders visibly smaller side-by-side, even though the boxes match. */
function BotAvatar() {
  return (
    <div className="shrink-0 w-11 h-11 isolate">
      <img
        src="/assets/.aistudio/bot-mascot-avatar.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="w-full h-full object-contain select-none mix-blend-screen"
      />
    </div>
  );
}

/** Advisor/user message avatar — this source PNG already has a true
 * transparent background, so it's placed directly with no blend trick. */
function AdvisorAvatar() {
  return (
    <div className="shrink-0 w-8 h-8 mt-0.5">
      <img
        src="/assets/.aistudio/advisor-mascot-avatar.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="w-full h-full object-contain select-none"
      />
    </div>
  );
}

/** One resource row inside the Library's Plans / Insurer Resources lists —
 * deliberately the SAME openable-vs-plain-pill rule already used for a chat
 * answer's Sources (see the m.sources rendering below): a real http(s)
 * sourceUrl (a "web" resource) opens in a new tab, everything else (a "pdf"
 * resource never persists its raw file — see schema.ts's sourceUrl comment)
 * renders as a plain, unclickable row with just its title/doc-type label. */
function LibraryResourceList({ resources }: { resources: LibraryResource[] }) {
  if (resources.length === 0) {
    return <p className="text-[10.5px] font-medium text-[#8CA0B3] italic px-2.5 py-1">No resources yet.</p>;
  }
  // Labeled by document type (Policy Wording / Prospectus / Brochure /
  // Add-on) rather than the resource's own title — the Plan/Insurer
  // Resources heading above already gives the plan context, and a real
  // title here is often "<Insurer> <Plan> ..." long enough that at this
  // sidebar's width it truncates to an indistinguishable prefix with no
  // real signal left (see the screenshot that prompted this). The full
  // title is still available as a hover tooltip. A resource whose
  // documentType is "other" (no label — see SOURCE_DOCUMENT_TYPE_LABEL)
  // falls back to its title, since there's nothing else to show. When two+
  // resources in the same list land on the same label (e.g. two Policy
  // Wording docs for one plan), a " (2)"/" (3)" suffix is appended so they
  // don't render as identical, indistinguishable rows.
  const baseLabels = resources.map(r => SOURCE_DOCUMENT_TYPE_LABEL[r.documentType] || r.title);
  const totalByLabel = new Map<string, number>();
  for (const b of baseLabels) totalByLabel.set(b, (totalByLabel.get(b) ?? 0) + 1);
  const seenSoFar = new Map<string, number>();

  return (
    <div className="flex flex-col gap-0.5">
      {resources.map((r, i) => {
        const base = baseLabels[i];
        const occurrence = (seenSoFar.get(base) ?? 0) + 1;
        seenSoFar.set(base, occurrence);
        const label = totalByLabel.get(base)! > 1 ? `${base} (${occurrence})` : base;
        const isOpenable = !!r.sourceUrl && /^https?:\/\//i.test(r.sourceUrl);
        const rowClass = "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10.5px] font-medium min-w-0";
        return isOpenable ? (
          <a
            key={r.id}
            href={r.sourceUrl!}
            target="_blank"
            rel="noopener noreferrer"
            title={r.title}
            className={`${rowClass} text-[#8CA0B3] hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer`}
          >
            <FileText className="w-3 h-3 shrink-0 opacity-60" />
            <span className="flex-1 truncate">{label}</span>
            <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-60" />
          </a>
        ) : (
          <div key={r.id} title={r.title} className={`${rowClass} text-[#8CA0B3]`}>
            <FileText className="w-3 h-3 shrink-0 opacity-60" />
            <span className="flex-1 truncate">{label}</span>
          </div>
        );
      })}
    </div>
  );
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

/**
 * The compact "utilization bar" required by the Credit & Usage Management
 * spec (2026-08, redesigned 2026-09 into two separate bars). Monthly is the
 * real ceiling — it's the only thing that can ever actually block a
 * request (see productAssistQuota.ts's ENFORCEMENT MODEL comment) — so its
 * bar behaves like before: proportional fill, red once truly exhausted.
 * Daily is now purely a pacing indicator: it fills to 100% and STAYS there
 * once the day's typical allowance is used up (it never overflows past
 * full, and never blocks), so it can't be confused with an actual limit.
 * Renders nothing while quota hasn't loaded yet, so it never shifts layout
 * on first paint.
 */
function ProductAssistUtilizationBar({ quota, dark }: { quota: ProductAssistQuotaStatus | null; dark: boolean }) {
  if (!quota) return null;

  if (quota.unlimited) {
    return (
      <div className={`text-[10.5px] font-bold shrink-0 ${dark ? "text-stone-400" : "text-stone-500"}`}>Unlimited Product Assist access</div>
    );
  }

  const monthlyLimit = quota.monthlyLimit;
  const monthlyUsed = Math.round(quota.monthlyUsed * 100) / 100;
  const monthlyPct = quota.monthlyUtilizationPercent === null ? 0 : Math.min(100, Math.max(0, quota.monthlyUtilizationPercent));

  const monthlyStateColor =
    quota.state === "at_limit"
      ? dark
        ? "text-rose-300"
        : "text-rose-600"
      : quota.state === "warning"
      ? dark
        ? "text-amber-300"
        : "text-amber-600"
      : dark
      ? "text-stone-300"
      : "text-stone-600";
  const monthlyBarColor = quota.state === "at_limit" ? "#f43f5e" : quota.state === "warning" ? "#f59e0b" : dark ? "#00D3F3" : "#4673a9";

  const dailyLimit = quota.dailyLimit;
  const dailyUsed = Math.round(quota.dailyUsed * 100) / 100;
  const dailyExceeded = quota.state === "daily_exceeded";
  // Capped at 100 and never past it — daily is a pacing figure, not a hard
  // cap, so the bar communicates "you've used today's typical share" by
  // filling and staying full rather than by overflowing its own track.
  const dailyPct = dailyLimit === null || dailyLimit <= 0 ? 0 : Math.min(100, Math.max(0, (dailyUsed / dailyLimit) * 100));
  const dailyBarColor = dailyExceeded ? "#f59e0b" : dark ? "#00D3F3" : "#4673a9";
  const dailyTextColor = dailyExceeded ? (dark ? "text-amber-300" : "text-amber-600") : dark ? "text-stone-500" : "text-stone-400";

  return (
    <div className="flex flex-col items-start sm:items-end gap-1.5 shrink-0 min-w-[160px]">
      <div className="w-full flex flex-col items-start sm:items-end gap-0.5">
        <span className={`text-[10.5px] font-bold ${monthlyStateColor}`}>
          {monthlyUsed}/{monthlyLimit ?? "—"} monthly credits
        </span>
        <div className={`w-40 h-1.5 rounded-full overflow-hidden ${dark ? "bg-white/10" : "bg-stone-200"}`}>
          <div className="h-full rounded-full transition-all" style={{ width: `${monthlyPct}%`, backgroundColor: monthlyBarColor }} />
        </div>
      </div>

      {dailyLimit !== null && (
        <div className="w-full flex flex-col items-start sm:items-end gap-0.5">
          <span className={`text-[10px] font-semibold ${dailyTextColor}`}>
            {dailyUsed}/{dailyLimit} today
          </span>
          <div className={`w-40 h-1 rounded-full overflow-hidden ${dark ? "bg-white/10" : "bg-stone-200"}`}>
            <div className="h-full rounded-full transition-all" style={{ width: `${dailyPct}%`, backgroundColor: dailyBarColor }} />
          </div>
        </div>
      )}

      {quota.state === "at_limit" && (
        <span className={`text-[10px] font-bold ${dark ? "text-rose-300" : "text-rose-600"}`}>Limit reached — contact a Developer for more credits.</span>
      )}
      {dailyExceeded && (
        <span className={`text-[10px] font-semibold ${dark ? "text-amber-300" : "text-amber-600"}`}>
          Today's typical pace reached — still available from your monthly balance.
        </span>
      )}
    </div>
  );
}

/** LEGACY ONLY — productAssist.ts now returns "answer"/"share" as separate
 * structured JSON fields (see LocalChatMessage's `content`/`share`), so a
 * freshly-received message no longer needs this parsed out of one combined
 * string. Kept only so a conversation already sitting in someone's
 * localStorage from before that migration (holding the old combined
 * "---SHARE---"-delimited text, or even older "2. MESSAGE FOR SHARING" text)
 * still renders correctly instead of breaking — see the `m.share ===
 * undefined` branch below. Defensively strips a stray heading line either
 * way in case the model ever echoed one out of habit. */
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

/** Pulls the trailing "**References**" list (see productAssist.ts's CITATION
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
 * "Product Assist" — advisor-facing chat over the Knowledge Base (see
 * src/server/knowledgeBase/productAssist.ts). Open to every tier: choose an
 * insurer (or "General" for a cross-insurer question), optionally one or
 * more of that insurer's plans, then ask — answers are grounded only in
 * the matching documents/announcements, with inline Primary Reference
 * citations and a separate customer-safe "message for sharing" block.
 *
 * Conversation history is local-memory only — held in this browser's
 * localStorage, never sent anywhere but back to the /ask endpoint as
 * short-lived context for the CURRENT request. Nothing is persisted server
 * side (see server.ts's POST /api/product-assist/ask).
 */
export function ProductAssistPage({ theme, currentUser }: ProductAssistPageProps) {
  const dark = theme === "dark";

  // Health/Term (2026-09) — undefined restriction means the caller (no
  // tags, or both tags) may use either domain and gets an actual toggle;
  // a single-tag caller is locked to that one domain, matching
  // resolveCallerDomain's server-side enforcement exactly (this client
  // check is only for UI convenience — the server never trusts it alone).
  const domainRestriction = domainRestrictionForTags(currentUser?.tags);
  const [domain, setDomain] = useState<ProductAssistDomain>(domainRestriction ?? "Health");

  const [categories, setCategories] = useState<KbCategoryLite[]>([]);
  const [sessions, setSessions] = useState<LocalChatSession[]>(() => loadLocalSessions());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalChatMessage[]>([]);

  const [selectedCategoryValue, setSelectedCategoryValue] = useState<string>("");
  // Picking a plan chip is optional, not required — if the advisor skips
  // it, the server infers a plan directly from the question text where
  // possible (or asks a clarifying question when it genuinely can't be
  // determined and matters for the answer); see productAssist.ts's
  // detectMentionedPlanNames / SELECTED SCOPE handling.
  const [selectedPlanTags, setSelectedPlanTags] = useState<string[]>([]);
  // Sidebar Library section — collapsed by default (see the restructured
  // sidebar below); expanding it pushes Recent Conversations down inline,
  // it never floats/overlays.
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [library, setLibrary] = useState<LibraryData | null>(null);
  // Library nesting: "Insurance Resources" itself + each expanded insurer +
  // each expanded plan — three independent collapse levels, all collapsed
  // by default so opening Library never dumps the whole KB tree at once.
  const [insuranceResourcesOpen, setInsuranceResourcesOpen] = useState(false);
  const [expandedInsurerIds, setExpandedInsurerIds] = useState<Set<number>>(new Set());
  const [expandedPlanKeys, setExpandedPlanKeys] = useState<Set<string>>(new Set());

  const [questionInput, setQuestionInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Credit & Usage Management (2026-08) — the caller's own live quota
  // status, fetched once on load and refreshed from the /ask response's
  // `quota` field after every question (see productAssistQuota.ts on the
  // server). Never blocks rendering the chat itself if this fetch fails.
  const [quota, setQuota] = useState<ProductAssistQuotaStatus | null>(null);

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
        const catRes = await fetch(`/api/product-assist/categories?domain=${domain}`);
        const catBody = await catRes.json().catch(() => ({}));
        if (!catRes.ok) throw new Error(catBody.error || `Failed to load insurers (HTTP ${catRes.status}).`);
        setCategories(catBody.entries || []);
      } catch (err: any) {
        setLoadError(err.message || "Failed to load Product Assist.");
      } finally {
        setLoading(false);
      }

      // Library load is independent of (and never blocks) the categories/
      // chat load above — a failed or slow Library fetch must never stop an
      // advisor from asking a question, since chat itself doesn't depend on
      // it. Silently leaves the Library showing just Core Resources on
      // failure rather than surfacing a second error banner for a purely
      // supplementary nav feature.
      try {
        const libRes = await fetch(`/api/product-assist/library?domain=${domain}`);
        const libBody = await libRes.json().catch(() => ({}));
        if (libRes.ok) {
          setLibrary({ playbook: libBody.playbook ?? { sourceUrl: null }, insurers: libBody.insurers ?? [] });
        }
      } catch {
        // Non-fatal — see comment above.
      }

      // Same non-fatal pattern for the utilization bar's initial state —
      // shown before the advisor asks their first question. Quota is
      // shared across both domains (one credit pool per advisor), so this
      // doesn't need to re-run on a domain switch — but re-running it here
      // too is harmless and keeps this effect simple as a single "domain
      // changed, reload everything scoped to it" block.
      try {
        const quotaRes = await fetch("/api/product-assist/quota");
        const quotaBody = await quotaRes.json().catch(() => ({}));
        if (quotaRes.ok) setQuota(quotaBody.quota ?? null);
      } catch {
        // Non-fatal — see comment above.
      }
    })();
  }, [domain]);

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
  // No placeholder text when no plan was picked — absence of a selected
  // plan already communicates that no plan was chosen (see the removed
  // "No specific plan" chip); showing a substitute label here would just
  // reintroduce the same thing under a different name.
  const lockedPlanLabel = selectedPlanTags.length > 0 ? selectedPlanTags.join(", ") : null;
  const sortedSessions = [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const saveSessions = (next: LocalChatSession[]) => {
    setSessions(next);
    persistLocalSessions(next);
  };

  const startNewChat = () => {
    setCurrentSessionId(null);
    setMessages([]);
    setSendError(null);
    // Insurer/plan scope is per-conversation, not a sticky global default —
    // without this, the picker stayed unlocked (scopeLocked correctly goes
    // false once messages/currentSessionId clear) but still showed
    // whichever insurer/plan the previous chat had selected, so "New Chat"
    // looked like it silently carried over the old scope instead of
    // starting fresh.
    setSelectedCategoryValue("");
    setSelectedPlanTags([]);
  };

  const openSession = (session: LocalChatSession) => {
    setCurrentSessionId(session.id);
    setMessages(session.messages);
    // A session saved before the domain field existed is always implicitly
    // "Health" (Term didn't exist yet) — see LocalChatSession's doc comment.
    setDomain(session.domain ?? "Health");
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

  // Switching domain mid-selection invalidates whatever insurer/plan was
  // already picked (category ids are domain-scoped — see kb_categories.
  // domain) — reset both, same as startNewChat's own reasoning. Only
  // reachable while scope is unlocked (see the toggle's render guard
  // below), so this never fires mid-conversation.
  const switchDomain = (next: ProductAssistDomain) => {
    if (next === domain) return;
    setDomain(next);
    setSelectedCategoryValue("");
    setSelectedPlanTags([]);
  };

  const togglePlanTag = (plan: string) => {
    setSelectedPlanTags(prev => (prev.includes(plan) ? prev.filter(p => p !== plan) : [...prev, plan]));
  };

  // Library tree toggles — purely local expand/collapse UI state, never
  // touches the chat scope selector (see the Library's own doc comment:
  // navigation here is read-only and independent of it).
  const toggleLibraryInsurer = (id: number) => {
    setExpandedInsurerIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleLibraryPlan = (key: string) => {
    setExpandedPlanKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const sendQuestion = async () => {
    const question = questionInput.trim();
    if (!question || sending) return;
    if (currentSessionId === null && !selectedCategoryValue) {
      setSendError("Choose an insurer (or General) before asking.");
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
      const res = await fetch("/api/product-assist/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId, planTags, question, history, domain }),
      });
      const body = await res.json().catch(() => ({}));
      // Refresh the utilization bar from whatever the server computed —
      // present on a normal answer AND on a 429 quota-exceeded response
      // (see server.ts's /api/product-assist/ask), so a blocked question
      // still updates the bar to reflect the true current state.
      if (body.quota) setQuota(body.quota);
      if (!res.ok) throw new Error(body.error || `Failed to get an answer (HTTP ${res.status}).`);

      const assistantMsg: LocalChatMessage = {
        id: genId(),
        role: "assistant",
        content: body.answer,
        share: body.share ?? null,
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
          domain,
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
    // "General" now searches every KB category's document chunks in the
    // domain (not just FAQ/Playbook — see productAssist.ts's General-scope
    // broadening), so the label no longer names specific sources.
    { value: GENERAL_VALUE, label: "General" },
    ...categories.filter(c => c.type === "insurer").map(c => ({ value: String(c.id), label: c.name })),
  ];

  if (loading) {
    return <div className="text-xs font-semibold text-content-muted py-8 text-center">Loading Product Assist…</div>;
  }

  return (
    <div className="space-y-5 text-left lg:flex lg:flex-col lg:flex-1 lg:min-h-0">
      {/* New Chat now lives at the top of the sidebar (see below) — moving
          it out of the header frees a full row of width/height for the
          workspace, and matches "New Chat" reading as the sidebar's own
          primary action rather than a page-level one. */}
      <div className="shrink-0 pb-3 border-b border-stone-200 dark:border-stone-800 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${dark ? "text-white" : "text-[#111827]"}`}>
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: dark ? "#00D3F3" : "#4673a9" }} />
            <span>Product Assist</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            Ask. Verify. Understand. Get answers to your product queries, backed by references you can verify.
          </p>
        </div>
        <ProductAssistUtilizationBar quota={quota} dark={dark} />
      </div>

      {loadError && (
        <div className={`shrink-0 text-xs font-semibold px-3 py-2 rounded-lg border flex items-center gap-2 ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {loadError}
        </div>
      )}

      {/* Sidebar + main card share one grid row so they always end up the
          same height — at lg+ this row fills whatever vertical space is
          left between the header above and the app's footer below (see
          App.tsx's product_assist branch of the flush-fit layout used by a
          couple of other data-dense pages), so only the lists/thread
          inside each card scroll, never the page itself. Below lg the
          cards stack and the page scrolls normally, which reads better on
          a narrow/short viewport than a forced fixed-height layout. */}
      <div className="grid grid-cols-1 lg:grid-cols-[clamp(200px,16vw,280px)_1fr] gap-5 lg:flex-1 lg:min-h-0">
        {/* Sidebar — a distinct, always-dark-navy surface (the same locked
            --sidebar-bg/#020D18 token the app's own main left nav uses, in
            BOTH themes) rather than transparent, so it reads unmistakably
            as its own zone next to the workspace. New Chat is pinned at the
            top as the sidebar's primary action; Library and Recent
            Conversations share one scrollable region below it, in that
            order, so an expanded Library pushes the conversation list down
            inline (never an overlay) and the whole region scrolls on its
            own once it's taller than the viewport. */}
        <div
          className="min-w-0 flex flex-col min-h-0 lg:h-full rounded-2xl overflow-hidden"
          style={{ backgroundColor: dark ? "#020D18" : "var(--sidebar-bg)" }}
        >
          <div className="shrink-0 p-3">
            <ClippedButton
              size="md"
              onClick={startNewChat}
              // Dark theme: fixed literal #1C2937 bg / white text —
              // unchanged. Light theme: a mid-tone blue-grey rather than a
              // near-white tint (the earlier #E3E8EF read as too pale/low-
              // presence) — reuses var(--border-strong)'s exact existing
              // value (#8A9BB0), already the app's own established
              // "structural blue-grey" token, with #1C2937 itself as the
              // text ink for contrast (~5.4:1). Still the same blue-grey
              // family as dark theme, no new/invented color, just more
              // visible than the last pass.
              className={
                dark
                  ? "w-full bg-[#1C2937] text-white px-4 py-2 text-[11px] font-black uppercase tracking-wider flex items-center justify-center gap-2"
                  : "w-full bg-[var(--border-strong)] text-[#1C2937] px-4 py-2 text-[11px] font-black uppercase tracking-wider flex items-center justify-center gap-2"
              }
            >
              <Plus className="w-3.5 h-3.5" /> New Chat
            </ClippedButton>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-3 pb-3 flex flex-col gap-1">
            {/* Library — collapsed by default; expands/collapses inline. */}
            <button
              type="button"
              onClick={() => setLibraryOpen(v => !v)}
              aria-expanded={libraryOpen}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-[10.5px] font-bold uppercase tracking-wide text-[#C4CDD8] hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              <Library className="w-3.5 h-3.5 shrink-0" />
              <span className="flex-1 text-left">Library</span>
              <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${libraryOpen ? "rotate-180" : ""}`} />
            </button>
            {libraryOpen && (
              <div className="flex flex-col gap-0.5 pl-1.5 pb-1">
                {/* Core Resources — always the top row(s) once Library is
                    open, no further expand/collapse of their own. Product
                    Playbook opens its existing kb_resources sourceUrl
                    directly (same Google Sheet link Knowledge Base
                    Management already exposes to admins — nothing new is
                    revealed); the FAQ item deliberately does NOT resolve to
                    its own resource/sourceUrl — its Sheet stays internal —
                    and instead opens the configured external destination
                    (see HEALTH_FAQ_LIBRARY_URL/TERM_FAQ_LIBRARY_URL's own
                    comments). Playbook is shown for both domains — Term got
                    its own Playbook in 2026-09 (see server.ts's
                    /api/product-assist/library, which already resolves the
                    domain-appropriate kb_resources row); this button used to
                    be Health-only from before that shipped, which hid a
                    fully-wired Term Playbook from the sidebar. */}
                <span className="block text-[9px] font-bold uppercase tracking-[0.1em] text-[#8CA0B3] opacity-70 px-2.5 pt-1 pb-0.5">
                  Core Resources
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (library?.playbook.sourceUrl) window.open(library.playbook.sourceUrl, "_blank", "noopener,noreferrer");
                  }}
                  disabled={!library?.playbook.sourceUrl}
                  title={library?.playbook.sourceUrl ? "Open Product Playbook" : "Not yet connected"}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-[#C4CDD8] hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-[#C4CDD8]"
                >
                  <BookOpen className="w-3 h-3 shrink-0 opacity-70" />
                  <span className="flex-1 text-left truncate">Product Playbook</span>
                  {library?.playbook.sourceUrl && <ExternalLink className="w-3 h-3 shrink-0 opacity-50" />}
                </button>
                <a
                  href={domain === "Health" ? HEALTH_FAQ_LIBRARY_URL : TERM_FAQ_LIBRARY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={domain === "Health" ? "Open Health FAQ" : "Open Term FAQ"}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-[#C4CDD8] hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
                >
                  <FileText className="w-3 h-3 shrink-0 opacity-70" />
                  <span className="flex-1 text-left truncate">{domain === "Health" ? "Health FAQ" : "Term FAQ"}</span>
                  <ExternalLink className="w-3 h-3 shrink-0 opacity-50" />
                </a>

                {/* Insurance Resources — built entirely from the same KB
                    categories/resources /api/product-assist/library reads live
                    off the database, so a plan rename/delete/disable or a
                    new insurer resource shows up here automatically, no
                    hardcoded list. Omits an insurer branch with nothing to
                    show (see the endpoint's own filter). */}
                {library && library.insurers.length > 0 && (
                  <div className="flex flex-col gap-0.5 mt-1.5">
                    <button
                      type="button"
                      onClick={() => setInsuranceResourcesOpen(v => !v)}
                      aria-expanded={insuranceResourcesOpen}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[9px] font-bold uppercase tracking-[0.1em] text-[#8CA0B3] opacity-70 hover:opacity-100 hover:bg-white/[0.06] transition-colors cursor-pointer"
                    >
                      <span className="flex-1 text-left">Insurance Resources</span>
                      <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${insuranceResourcesOpen ? "rotate-180" : ""}`} />
                    </button>
                    {insuranceResourcesOpen && (
                      <div className="flex flex-col gap-0.5">
                        {library.insurers.map(insurer => {
                          const isInsurerOpen = expandedInsurerIds.has(insurer.id);
                          return (
                            <div key={insurer.id} className="flex flex-col gap-0.5">
                              <button
                                type="button"
                                onClick={() => toggleLibraryInsurer(insurer.id)}
                                aria-expanded={isInsurerOpen}
                                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] font-bold text-[#C4CDD8] hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
                              >
                                <Building2 className="w-3 h-3 shrink-0 opacity-70" />
                                <span className="flex-1 text-left truncate">{insurer.name}</span>
                                <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${isInsurerOpen ? "rotate-180" : ""}`} />
                              </button>
                              {isInsurerOpen && (
                                <div className="flex flex-col gap-0.5 pl-4 pb-0.5">
                                  {insurer.plans.length > 0 && (
                                    <>
                                      <span className="block text-[9px] font-bold uppercase tracking-wide text-[#8CA0B3] opacity-60 px-2.5 pt-0.5 pb-0.5">
                                        Plans
                                      </span>
                                      {insurer.plans.map(plan => {
                                        const planKey = `${insurer.id}:${plan.name}`;
                                        const isPlanOpen = expandedPlanKeys.has(planKey);
                                        return (
                                          <div key={planKey} className="flex flex-col gap-0.5">
                                            <button
                                              type="button"
                                              onClick={() => toggleLibraryPlan(planKey)}
                                              aria-expanded={isPlanOpen}
                                              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-[#C4CDD8] hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
                                            >
                                              <span className="flex-1 text-left truncate">{plan.name}</span>
                                              <ChevronDown className={`w-3 h-3 shrink-0 opacity-60 transition-transform ${isPlanOpen ? "rotate-180" : ""}`} />
                                            </button>
                                            {isPlanOpen && (
                                              <div className="pl-4 pb-1">
                                                <LibraryResourceList resources={plan.resources} />
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </>
                                  )}
                                  {insurer.insurerResources.length > 0 && (
                                    <>
                                      <span className="block text-[9px] font-bold uppercase tracking-wide text-[#8CA0B3] opacity-60 px-2.5 pt-1 pb-0.5">
                                        Insurer Resources
                                      </span>
                                      <div className="pl-2.5 pb-0.5">
                                        <LibraryResourceList resources={insurer.insurerResources} />
                                      </div>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <span className="shrink-0 block text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#C4CDD8] opacity-80 pt-2 pb-2 mt-1 border-t border-white/[0.08]">
              Recent conversations
            </span>
            {sortedSessions.length === 0 && (
              <span className="block text-[11px] font-semibold text-[#8CA0B3] px-1 italic">No conversations yet.</span>
            )}
            {sortedSessions.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => openSession(s)}
                // Selected state reads via a left accent bar + full-contrast
                // text — a nav-rail "current item" cue — rather than a
                // filled pill background, so the list stays lightweight
                // typography instead of a stack of small cards. Unselected
                // rows carry no border/fill at all, only a hover tint.
                // Always the "light text on dark surface" palette now,
                // regardless of page theme — the sidebar itself no longer
                // changes with theme, so its content shouldn't either.
                className={`group w-full text-left pl-2.5 pr-2 py-2 border-l-2 text-[11px] font-semibold flex items-start justify-between gap-1.5 transition-colors cursor-pointer ${
                  currentSessionId === s.id
                    ? "border-l-sky-400 text-sky-300"
                    : "border-l-transparent text-[#8CA0B3] hover:bg-white/[0.06] hover:text-white"
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
          className={`min-w-0 rounded-2xl border shadow-card flex flex-col min-h-0 lg:h-full overflow-hidden ${
            dark ? "bg-white/[0.035] border-white/[0.09]" : "bg-surface border-[var(--border-strong)]"
          }`}
        >
          {/* Scope band — now an actual darker container (the same
              always-dark-navy surface as the sidebar, so the two visually
              relate) rather than a bare divider, with lighter controls
              floating on top of it: dark container -> lighter control ->
              brighter/accent selected state. Once locked it collapses to a
              single compact summary line — the full insurer-select +
              plan-chip controls have nothing left to do at that point.
              Layout is a fixed column stack (selector row, then a
              full-width, freely-wrapping chip row) rather than trying to
              keep them on one line via flex-wrap soup — predictable, and
              guaranteed not to overflow at any zoom level or width, since
              the chip row always gets the band's full width to wrap within
              instead of whatever's left over next to the selector. */}
          <div
            className="shrink-0 border-b border-white/[0.08] min-w-0"
            style={{ backgroundColor: dark ? "#020D18" : "var(--sidebar-bg)" }}
          >
            {scopeLocked ? (
              <div className="flex items-center gap-2 px-4 py-2.5 text-[10.5px] font-semibold min-w-0">
                <span className="opacity-50 shrink-0" title="Locked — start a new chat to change insurer or plans.">🔒</span>
                {/* Domain badge — only shown when it isn't already obvious
                    (a single-tag advisor only ever sees one domain, so
                    labeling every conversation with it would be noise). */}
                {domainRestriction === undefined && (
                  <>
                    <span className="text-[#8CA0B3] truncate">{domain === "Health" ? "Health" : "Term"}</span>
                    <span className="opacity-30 shrink-0">·</span>
                  </>
                )}
                <span className="text-white truncate">{lockedInsurerLabel}</span>
                {lockedPlanLabel && (
                  <>
                    <span className="opacity-30 shrink-0">·</span>
                    <span className="text-[#8CA0B3] truncate">{lockedPlanLabel}</span>
                  </>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 px-4 py-3 min-w-0">
                {/* Health/Term toggle (2026-09) — only rendered for an
                    advisor whose tags don't already restrict them to one
                    domain (see domainRestriction's comment); a single-tag
                    advisor never sees a choice that isn't actually theirs
                    to make. Disappears once scope locks, same as the
                    insurer/plan controls below it. */}
                {domainRestriction === undefined && (
                  <div className="w-full sm:w-auto inline-flex items-center gap-1 rounded-lg bg-white/[0.06] p-1">
                    {(["Health", "Term"] as const).map(d => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => switchDomain(d)}
                        className={`px-3 py-1.5 rounded-md text-[10.5px] font-bold uppercase tracking-wide transition-colors cursor-pointer ${
                          domain === d ? "bg-[#01334F] text-[#AEDCF4]" : "text-[#8CA0B3] hover:text-white hover:bg-white/[0.06]"
                        }`}
                      >
                        {d} Insurance
                      </button>
                    ))}
                  </div>
                )}
                <div className="w-full sm:w-auto sm:min-w-[240px] sm:max-w-sm">
                  <CustomSelect
                    theme={theme}
                    value={selectedCategoryValue}
                    onChange={v => { setSelectedCategoryValue(v); setSelectedPlanTags([]); }}
                    placeholder="Choose an insurer or General"
                    options={categoryOptions}
                    // Lighter than the band behind it (dark container ->
                    // lighter control), full width of its own responsive
                    // wrapper rather than a fixed px width — wide enough
                    // that a long selected insurer name is never clipped,
                    // and never wider than its wrapper's cap, so it can't
                    // force horizontal overflow at any zoom level.
                    triggerClassName="w-full flex items-center justify-between gap-2 text-xs font-bold pl-3 pr-8 py-2 rounded-lg border outline-none transition-colors relative cursor-pointer bg-white/[0.08] border-white/[0.16] text-white hover:bg-white/[0.12]"
                  />
                </div>
                {selectedCategory && selectablePlanNames.length > 0 && (
                  // Freely wraps onto as many rows as the band needs —
                  // never a single fixed-height horizontally-scrolling
                  // strip, so a plan can never disappear/clip at the edge
                  // regardless of insurer plan count, container width, or
                  // browser zoom. Picking a plan here is optional — if the
                  // advisor skips it, the server tries to infer the plan
                  // directly from the question text, and asks for
                  // clarification itself when it genuinely can't tell (see
                  // productAssist.ts's SELECTED SCOPE / AMBIGUITY handling).
                  <div className="w-full min-w-0 flex flex-wrap items-center gap-1.5">
                    <Tag className="w-3 h-3 shrink-0 text-[#8CA0B3]" />
                    {selectablePlanNames.map(plan => (
                      <button
                        key={plan}
                        type="button"
                        onClick={() => togglePlanTag(plan)}
                        className={`whitespace-nowrap px-2 py-1 rounded text-[10.5px] font-bold border transition-colors cursor-pointer ${
                          // Fixed literal #01334F / #AEDCF4 — identical in
                          // both themes, no dark/light branching, no blue.
                          selectedPlanTags.includes(plan)
                            ? "bg-[#01334F] border-[#01334F] text-[#AEDCF4]"
                            : "bg-white/[0.07] border-white/[0.14] text-[#C4CDD8] hover:bg-white/[0.12]"
                        }`}
                      >
                        {plan}
                      </button>
                    ))}
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
              // Sized down from w-48/56 + gap-2/py-6 — that generous sizing
              // was tuned before the app-wide auto-zoom feature (autoZoom.ts)
              // shipped; at a zoomed-in desktop scale it read as oversized
              // and pushed the "Write your query" input toward/past the
              // fold. Same illustration, same copy, just a smaller footprint.
              <div className="flex flex-col items-center justify-center gap-1.5 text-center py-4">
                {/* The duo illustration as the empty state's main visual
                    anchor — sized generously since it's the focal point,
                    plain (no card/background of its own). The source PNG
                    carries its own dark vignette rather than true alpha
                    transparency; `isolate` + `mix-blend-screen` erases that
                    vignette against whatever's behind it (screen-blending
                    black is a no-op, so only the character/glow pixels
                    show) instead of pasting a visible dark rectangle into
                    the light theme. */}
                <div className="isolate w-36 sm:w-44">
                  <img
                    src="/assets/.aistudio/bot-advisor-mascot-duo.png"
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    className="w-full h-auto select-none mix-blend-screen"
                  />
                </div>
                {/* Instruction copy — always the same regardless of whether
                    an insurer/plan is picked yet (no more of a "choose an
                    insurer first" variant), since it now explains the
                    selectors themselves rather than just nudging toward
                    them. Purely informational text — changes nothing about
                    how the selectors above or query handling below work. */}
                <div className="space-y-1.5 max-w-sm">
                  <p className={`text-xs font-black ${dark ? "text-white" : "text-stone-800"}`}>
                    Ask smarter. Get better answers.
                  </p>
                  <p className="text-[11px] font-medium text-content-muted leading-relaxed">
                    Choose the right context first — select an <span className="font-bold">insurer and plan</span> for
                    product-specific questions, or <span className="font-bold">General</span> for
                    broader insurance and Ditto-related queries.
                  </p>
                  <p className="text-[11px] font-medium text-content-muted">
                    <span className="font-bold">Best format:</span> Context + Situation + Specific Question
                  </p>
                  <p className="text-[11px] font-medium text-content-muted">
                    Need more clarity? <span className="font-bold">Ask a follow-up in the same chat.</span>
                  </p>
                </div>
              </div>
            )}
            {messages.map(m => {
              if (m.role === "user") {
                return (
                  <div key={m.id} className="flex justify-end items-end gap-2">
                    <div className={`max-w-[80%] px-3.5 py-2 rounded-2xl rounded-tr-md text-xs font-semibold shadow-soft ${dark ? "bg-sky-500/20 text-sky-100" : "bg-sky-100 text-sky-900"}`}>
                      {m.content}
                    </div>
                    <AdvisorAvatar />
                  </div>
                );
              }
              // `m.share === undefined` marks a pre-migration message still
              // holding the old combined "---SHARE---"-delimited text in
              // localStorage (see LocalChatMessage's doc comment) — fall
              // back to parsing it apart. A current message already has
              // `answer`/`share` as separate fields straight from the server
              // (productAssist.ts's structured JSON output), nothing to split.
              const legacy = m.share === undefined;
              const { answer, share: rawShare } = legacy ? splitAnswer(m.content) : { answer: m.content, share: m.share };
              const { body, references } = splitReferences(answer);
              // The model is told never to include a References list in
              // "share" (see productAssist.ts's NO DRAFT RULE paragraph), but
              // doesn't always comply — running it through the same
              // splitReferences used for the Answer above defensively drops
              // one if it slips in, since a Draft Message is meant to be
              // copy-pasted straight to a customer as plain text, not carry
              // an internal citation list. Only the legacy text-parsing path
              // can still contain the old literal NO_DRAFT_AVAILABLE
              // sentinel — a current message already has share as real JSON
              // null instead, which the `rawShare ? ... : null` short-
              // circuits before this check ever runs.
              const shareBody = rawShare ? splitReferences(rawShare).body : null;
              const share = shareBody && shareBody.trim().toUpperCase() !== "NO_DRAFT_AVAILABLE" ? shareBody : null;
              return (
                <div key={m.id} className="flex justify-start gap-2 max-w-[92%]">
                  {/* The AI mascot gives the response its own identity as a
                      chat message rather than a bordered panel — mirrors the
                      advisor avatar's alignment cue on the opposite side of
                      the thread. */}
                  <BotAvatar />
                  {/* Message surface — lifted off the workspace behind it by
                      shadow + a hue shift alone, deliberately with NO
                      border in either theme. The outer workspace card
                      already owns the one real border/edge in this layout;
                      stacking a second border around every answer is what
                      produced the "card inside a card" look before.
                      bg-surface-tint (not a dark-only bg-white/[alpha]) so
                      the AI bubble sits in the SAME blue-tinted surface
                      family as the advisor's own sky-blue bubble below in
                      BOTH themes — related (same family, both blue-toned)
                      but distinguishable (advisor = a more saturated sky
                      fill, "stronger"; AI = the softer --surface-tint wash,
                      "lighter") purely via the --surface-tint/sky-* tokens
                      already in the palette, not a new color. A drop-shadow
                      reads as "this floats above," a different (and here,
                      correct) cue from "this is boxed in." */}
                  <div className="min-w-0 flex-1 px-4 py-4 rounded-2xl rounded-tl-md space-y-4 shadow-card bg-surface-tint">
                    {/* Answer — the verified response to the advisor's question. */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[9.5px] font-bold uppercase tracking-wider text-content-muted">Answer</span>
                        <CopyButton text={stripMarkdownForCopy(body)} dark={dark} />
                      </div>
                      <div className={proseClass}>{renderSimpleMarkdown(body)}</div>
                    </div>

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

                    {/* References — the advisor's verification path. Placed
                        below the Draft Message so the customer-facing draft
                        reads as the primary takeaway and References as
                        supporting detail beneath it. A hairline top divider
                        + quieter/smaller type marks it as nested-inside-the-
                        answer content, without a second filled background
                        box competing with the answer's own surface. Content
                        is untouched — this only changes how it's presented. */}
                    {references && (
                      <div className={`pt-2.5 border-t ${dark ? "border-white/[0.08]" : "border-stone-900/[0.08]"}`}>
                        <span className="block text-[9.5px] font-bold uppercase tracking-wider text-content-muted opacity-70 mb-1">References</span>
                        <div className={`text-[11px] leading-relaxed [&_ul]:space-y-1 [&_li]:pl-0.5 ${dark ? "text-stone-400" : "text-stone-600"}`}>
                          {renderSimpleMarkdown(references)}
                        </div>
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
                <BotAvatar />
                <div className={`px-4 py-3 rounded-2xl rounded-tl-md text-xs font-semibold flex items-center gap-2 shadow-card bg-surface-tint ${dark ? "text-stone-400" : "text-stone-500"}`}>
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

          {/* Composer band — the outer padding wrapper has no fill of its
              own (just a hairline divider), so the workspace's own
              background continues through in both themes. The qa-composer
              div below is THE card — one single surface covering the input
              area and the area around the send button alike, so there's no
              separately-colored inner rectangle. Dark theme: fixed #1E2C3C
              — unchanged. Light theme: a pale tint of that exact same
              #1E2C3C blue-grey (#E3E8EF, same hue lightened — see the New
              Chat button's comment above), not the dark fill itself and not
              a new hue, with a hairline border since a light card needs one
              to read as raised off the page the way the dark fill did by
              contrast alone. */}
          <div className={`shrink-0 px-4 py-3.5 border-t ${dark ? "border-white/[0.07]" : "border-[var(--border)]"}`}>
            <div
              className={`qa-composer flex items-end gap-2 rounded-xl pl-3 pr-1.5 py-1.5 shadow-card transition-colors focus-within:ring-2 ${
                dark
                  ? "bg-[#1E2C3C] focus-within:ring-white/[0.15]"
                  : "bg-[#E3E8EF] border border-[var(--border-strong)] focus-within:ring-[#1E2C3C]/15"
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
                // Fully transparent — no background/border of its own, so
                // the parent card's fill shows straight through with no
                // visible seam. Text ink flips with the card: white on the
                // dark #1E2C3C fill, #1E2C3C itself on the pale light-theme
                // tint (see index.css's "PRODUCT ASSIST QUERY INPUT
                // EXCEPTION" — a higher-specificity global rule forces this
                // element's color/background in light theme, so the actual
                // light-theme color is set there, not by this class; kept
                // here too so the class list stays accurate/self-documenting).
                className={`flex-1 min-w-0 bg-transparent border-none outline-none resize-none text-xs font-medium py-1.5 max-h-[35vh] sm:max-h-40 overflow-y-hidden ${
                  dark ? "text-white placeholder:text-white/40" : "text-[#1E2C3C] placeholder:text-[#1E2C3C]/45"
                }`}
              />
              <button
                type="button"
                onClick={sendQuestion}
                disabled={sending || !questionInput.trim()}
                title="Send"
                // Must stay visibly distinct from the card's #1E2C3C fill it
                // sits on. Light theme: the #01334F/#AEDCF4 pairing already
                // used for the selected-plan accent — contrasts fine against
                // the pale #E3E8EF light-theme composer. Dark theme: that
                // same #01334F is itself a dark navy, nearly indistinguishable
                // from the #1E2C3C composer it sits on — swapped for the
                // app's own bright cyan accent (#00D3F3, the same token the
                // "Product Assist" header bar already uses in dark theme)
                // with a dark icon, so the button reads clearly in both
                // themes without inventing a new color family.
                className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center cursor-pointer transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${
                  dark ? "bg-[#00D3F3] text-[#020D18]" : "bg-[#01334F] text-[#AEDCF4]"
                }`}
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
