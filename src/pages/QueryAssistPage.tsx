/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Send, Plus, MessageSquare, Copy, Check, AlertTriangle, RefreshCw, Tag, Trash2, Sparkles } from "lucide-react";
import { CustomSelect } from "../components/CustomSelect";
import { ClippedButton } from "../components/ClippedButton";

interface QueryAssistPageProps {
  theme: "light" | "dark";
}

interface KbCategoryLite {
  id: number;
  name: string;
  type: "insurer" | "general";
  planNames: string[];
}

interface ChatSessionLite {
  id: number;
  title: string | null;
  categoryId: number | null;
  planTags: string[];
  updatedAt: string;
}

interface ChatSource {
  title: string;
  categoryName: string;
}

interface ChatMessageLite {
  id: number;
  role: "user" | "assistant";
  content: string;
  sources: ChatSource[] | null;
  createdAt: string;
}

const GENERAL_VALUE = "general";

/** Splits Query Assist's dual-section model output ("1. ANSWER" / "2.
 * MESSAGE FOR SHARING" — see queryAssist.ts's system instruction) into two
 * pieces for separate rendering, so the advisor can copy just the
 * customer-safe MESSAGE FOR SHARING block on its own. */
function splitAnswer(content: string): { answer: string; share: string | null } {
  const marker = /\n?\s*2\.\s*MESSAGE FOR SHARING\s*\n?/i;
  const match = marker.exec(content);
  const stripAnswerHeader = (s: string) => s.replace(/^\s*1\.\s*ANSWER\s*\n?/i, "").trim();
  if (!match) return { answer: stripAnswerHeader(content), share: null };
  const answerPart = stripAnswerHeader(content.slice(0, match.index));
  const sharePart = content.slice(match.index + match[0].length).trim();
  return { answer: answerPart, share: sharePart || null };
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
 * "Query Assist" — advisor-facing chat over the Knowledge Base (see
 * src/server/knowledgeBase/queryAssist.ts). Open to every tier: choose an
 * insurer (or "General" for a cross-insurer question), optionally one or
 * more of that insurer's plans, then ask — answers are grounded only in
 * the matching documents/announcements, with inline Primary Reference
 * citations and a separate customer-safe "message for sharing" block.
 */
export function QueryAssistPage({ theme }: QueryAssistPageProps) {
  const dark = theme === "dark";

  const [categories, setCategories] = useState<KbCategoryLite[]>([]);
  const [sessions, setSessions] = useState<ChatSessionLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessageLite[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [selectedCategoryValue, setSelectedCategoryValue] = useState<string>("");
  const [selectedPlanTags, setSelectedPlanTags] = useState<string[]>([]);

  const [questionInput, setQuestionInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const threadEndRef = useRef<HTMLDivElement>(null);

  const loadSessions = async () => {
    try {
      const res = await fetch("/api/query-assist/sessions");
      const body = await res.json().catch(() => ({}));
      if (res.ok) setSessions(body.entries || []);
    } catch {
      // Session history is a nice-to-have — a failed refresh shouldn't block asking questions.
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [catRes] = await Promise.all([fetch("/api/query-assist/categories"), loadSessions()]);
        const catBody = await catRes.json().catch(() => ({}));
        if (!catRes.ok) throw new Error(catBody.error || `Failed to load insurers (HTTP ${catRes.status}).`);
        setCategories(catBody.entries || []);
      } catch (err: any) {
        setLoadError(err.message || "Failed to load Query Assist.");
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

  const startNewChat = () => {
    setCurrentSessionId(null);
    setMessages([]);
    setSendError(null);
  };

  const openSession = async (session: ChatSessionLite) => {
    setLoadingMessages(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/query-assist/sessions/${session.id}/messages`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load conversation (HTTP ${res.status}).`);
      setCurrentSessionId(session.id);
      setMessages(body.entries || []);
      setSelectedCategoryValue(session.categoryId === null ? GENERAL_VALUE : String(session.categoryId));
      setSelectedPlanTags(session.planTags || []);
    } catch (err: any) {
      setSendError(err.message || "Failed to load this conversation.");
    } finally {
      setLoadingMessages(false);
    }
  };

  const deleteSession = async (session: ChatSessionLite, e: MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("Delete this conversation?")) return;
    try {
      await fetch(`/api/query-assist/sessions/${session.id}`, { method: "DELETE" });
      if (currentSessionId === session.id) startNewChat();
      await loadSessions();
    } catch {
      setSendError("Failed to delete this conversation.");
    }
  };

  const togglePlanTag = (plan: string) => {
    setSelectedPlanTags(prev => (prev.includes(plan) ? prev.filter(p => p !== plan) : [...prev, plan]));
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
    const optimisticUser: ChatMessageLite = { id: -Date.now(), role: "user", content: question, sources: null, createdAt: new Date().toISOString() };
    setMessages(prev => [...prev, optimisticUser]);
    setQuestionInput("");

    try {
      const payload: Record<string, unknown> = { question };
      if (currentSessionId !== null) {
        payload.sessionId = currentSessionId;
      } else {
        payload.categoryId = selectedCategoryValue === GENERAL_VALUE ? null : Number(selectedCategoryValue);
        payload.planTags = selectedPlanTags;
      }
      const res = await fetch("/api/query-assist/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to get an answer (HTTP ${res.status}).`);
      setCurrentSessionId(body.sessionId);
      setMessages(prev => [
        ...prev,
        { id: -Date.now() - 1, role: "assistant", content: body.answer, sources: body.sources || null, createdAt: new Date().toISOString() },
      ]);
      loadSessions();
    } catch (err: any) {
      setSendError(err.message || "Failed to get an answer. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const inputClass = `w-full px-3 py-2 rounded-lg text-xs font-medium border outline-none transition-colors ${
    dark ? "bg-white/[0.04] border-white/[0.1] text-white placeholder:text-stone-500 focus:border-sky-500/50" : "bg-white border-stone-300 text-stone-900 placeholder:text-stone-400 focus:border-sky-500"
  }`;
  const cardClass = dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-stone-200";

  const categoryOptions = [
    { value: GENERAL_VALUE, label: "General (not tied to one insurer)" },
    ...categories.filter(c => c.type === "insurer").map(c => ({ value: String(c.id), label: c.name })),
  ];

  if (loading) {
    return <div className="text-xs font-semibold text-content-muted py-8 text-center">Loading Query Assist…</div>;
  }

  return (
    <div className="space-y-5 text-left">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-3 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${dark ? "text-white" : "text-[#111827]"}`}>
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: dark ? "#00D3F3" : "#4673a9" }} />
            <span>Query Assist</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            Ask a question about an insurer's plan(s) and get an answer grounded only in the Knowledge Base's documents and announcements.
          </p>
        </div>
        <ClippedButton size="md" onClick={startNewChat} className="bg-[var(--tab-active-bg)] text-[var(--tab-active-text)] px-4 py-2 text-[11px] font-black uppercase tracking-wider flex items-center gap-2">
          <Plus className="w-3.5 h-3.5" /> New Chat
        </ClippedButton>
      </div>

      {loadError && (
        <div className={`text-xs font-semibold px-3 py-2 rounded-lg border flex items-center gap-2 ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {loadError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
        {/* Session history sidebar */}
        <div className={`rounded-xl border p-3 space-y-1.5 lg:max-h-[560px] overflow-y-auto ${cardClass}`}>
          <span className="block text-[10px] font-bold uppercase tracking-wide text-content-muted px-1 mb-1">Recent conversations</span>
          {sessions.length === 0 && <span className="block text-[11px] font-semibold text-content-muted px-1 italic">No conversations yet.</span>}
          {sessions.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => openSession(s)}
              className={`w-full text-left px-2.5 py-2 rounded-lg text-[11px] font-semibold flex items-start justify-between gap-1.5 transition-colors cursor-pointer ${
                currentSessionId === s.id
                  ? dark ? "bg-sky-500/15 text-sky-300" : "bg-sky-50 text-sky-700"
                  : dark ? "text-stone-300 hover:bg-white/[0.05]" : "text-stone-700 hover:bg-stone-50"
              }`}
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <MessageSquare className="w-3 h-3 shrink-0" />
                <span className="truncate">{s.title || "Untitled"}</span>
              </span>
              <span onClick={e => deleteSession(s, e)} className="shrink-0 opacity-50 hover:opacity-100 cursor-pointer" title="Delete">
                <Trash2 className="w-3 h-3" />
              </span>
            </button>
          ))}
        </div>

        {/* Main chat panel */}
        <div className={`rounded-xl border p-4 flex flex-col space-y-3 ${cardClass}`}>
          {/* Scope selector */}
          <div className="flex flex-wrap items-end gap-3 pb-3 border-b border-dashed border-stone-300/30">
            <div className="w-full sm:w-64">
              <label className="block text-[10px] font-bold uppercase tracking-wide text-content-muted mb-1">Insurer</label>
              <CustomSelect
                theme={theme}
                value={selectedCategoryValue}
                onChange={v => { setSelectedCategoryValue(v); setSelectedPlanTags([]); }}
                placeholder="Choose an insurer or General"
                options={categoryOptions}
                disabled={scopeLocked}
              />
            </div>
            {selectedCategory && selectedCategory.planNames.length > 0 && (
              <div className="flex-1 min-w-[200px]">
                <label className="block text-[10px] font-bold uppercase tracking-wide text-content-muted mb-1 flex items-center gap-1"><Tag className="w-3 h-3" /> Plan(s) — optional</label>
                <div className="flex flex-wrap gap-1.5">
                  {selectedCategory.planNames.map(plan => (
                    <button
                      key={plan}
                      type="button"
                      disabled={scopeLocked}
                      onClick={() => togglePlanTag(plan)}
                      className={`px-2 py-1 rounded text-[10.5px] font-bold border transition-colors ${
                        selectedPlanTags.includes(plan)
                          ? dark ? "bg-sky-500/20 border-sky-500/40 text-sky-300" : "bg-sky-100 border-sky-300 text-sky-700"
                          : dark ? "bg-white/[0.04] border-white/[0.1] text-stone-400 hover:bg-white/[0.08]" : "bg-white border-stone-300 text-stone-500 hover:bg-stone-50"
                      } ${scopeLocked ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      {plan}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {scopeLocked && (
              <span className="text-[10.5px] font-semibold text-content-muted italic">Scope locked for this conversation — start a New Chat to change it.</span>
            )}
          </div>

          {/* Thread */}
          <div className="flex-1 min-h-[320px] max-h-[480px] overflow-y-auto space-y-3 pr-1">
            {loadingMessages && <div className="text-xs font-semibold text-content-muted text-center py-6">Loading conversation…</div>}
            {!loadingMessages && messages.length === 0 && (
              <div className="text-xs font-semibold text-content-muted text-center py-10 flex flex-col items-center gap-2">
                <Sparkles className="w-5 h-5 opacity-50" />
                Choose an insurer above and ask your first question.
              </div>
            )}
            {messages.map(m => {
              if (m.role === "user") {
                return (
                  <div key={m.id} className="flex justify-end">
                    <div className={`max-w-[80%] px-3 py-2 rounded-xl text-xs font-semibold ${dark ? "bg-sky-500/20 text-sky-100" : "bg-sky-100 text-sky-900"}`}>
                      {m.content}
                    </div>
                  </div>
                );
              }
              const { answer, share } = splitAnswer(m.content);
              return (
                <div key={m.id} className="flex justify-start">
                  <div className={`max-w-[92%] w-full px-3.5 py-3 rounded-xl space-y-2.5 ${dark ? "bg-white/[0.04] border border-white/[0.08]" : "bg-stone-50 border border-stone-200"}`}>
                    <div>
                      <span className="block text-[9.5px] font-bold uppercase tracking-wider text-content-muted mb-1">Answer</span>
                      <p className={`text-xs whitespace-pre-wrap leading-relaxed ${dark ? "text-stone-200" : "text-stone-800"}`}>{answer}</p>
                    </div>
                    {share && (
                      <div className={`p-2.5 rounded-lg border ${dark ? "bg-emerald-500/10 border-emerald-500/25" : "bg-emerald-50 border-emerald-200"}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9.5px] font-bold uppercase tracking-wider text-emerald-500">Message for sharing</span>
                          <CopyButton text={share} dark={dark} />
                        </div>
                        <p className={`text-xs whitespace-pre-wrap leading-relaxed ${dark ? "text-emerald-200" : "text-emerald-900"}`}>{share}</p>
                      </div>
                    )}
                    {m.sources && m.sources.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {m.sources.map(s => (
                          <span key={s.title} className={`text-[9.5px] font-bold px-2 py-0.5 rounded border ${dark ? "bg-white/[0.04] border-white/[0.12] text-stone-400" : "bg-white border-stone-200 text-stone-500"}`}>
                            {s.title}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {sending && (
              <div className="flex justify-start">
                <div className={`px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 ${dark ? "bg-white/[0.04] text-stone-400" : "bg-stone-50 text-stone-500"}`}>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Checking the Knowledge Base…
                </div>
              </div>
            )}
            <div ref={threadEndRef} />
          </div>

          {sendError && (
            <div className={`text-xs font-semibold px-3 py-2 rounded-lg border flex items-center gap-2 ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {sendError}
            </div>
          )}

          {/* Input */}
          <div className="flex items-end gap-2 pt-2 border-t border-dashed border-stone-300/30">
            <textarea
              value={questionInput}
              onChange={e => setQuestionInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendQuestion(); }
              }}
              placeholder="Ask a question about this insurer's plan(s)…"
              disabled={sending}
              rows={2}
              className={`${inputClass} resize-none`}
            />
            <ClippedButton size="md" onClick={sendQuestion} disabled={sending || !questionInput.trim()} className="bg-[var(--tab-active-bg)] text-[var(--tab-active-text)] px-4 py-2.5 shrink-0">
              <Send className="w-4 h-4" />
            </ClippedButton>
          </div>
        </div>
      </div>
    </div>
  );
}
