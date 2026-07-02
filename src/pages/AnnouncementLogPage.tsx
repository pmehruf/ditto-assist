/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Dispatch, SetStateAction } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { QAAnnouncementForm } from "../components/forms/QAAnnouncementForm";
import { renderFormattedAnnouncement } from "../utils/renderFormattedAnnouncement";
import { QAAnnouncement } from "../types/announcements";
import { LoggedUser } from "../types/user";
import { ChangeLogEntry } from "../types/changeLog";

interface AnnouncementLogPageProps {
  theme: "light" | "dark";
  qaAnnouncements: QAAnnouncement[];
  setQaAnnouncements: Dispatch<SetStateAction<QAAnnouncement[]>>;
  currentUser: LoggedUser | null;
  setChangeLogs: Dispatch<SetStateAction<ChangeLogEntry[]>>;
  editingAnnouncementId: string | null;
  setEditingAnnouncementId: (id: string | null) => void;
  deletingAnnouncementId: string | null;
  setDeletingAnnouncementId: (id: string | null) => void;
}

/**
 * "Announcement Manager" (qa_announcement_log) tab content. Extracted
 * verbatim from App.tsx (Phase 1.3). The `activeTab === "qa_announcement_log"`
 * condition and wrapping `<motion.div key="qa_announcement_log">`
 * deliberately stay in App.tsx (see ResourcesPage.tsx for why).
 */
export function AnnouncementLogPage({
  theme,
  qaAnnouncements,
  setQaAnnouncements,
  currentUser,
  setChangeLogs,
  editingAnnouncementId,
  setEditingAnnouncementId,
  deletingAnnouncementId,
  setDeletingAnnouncementId,
}: AnnouncementLogPageProps) {
  return (
    <div className="space-y-6 text-left">
      {/* Header Box */}
      <div className={`p-6 rounded-2xl border transition-all ${
        theme === "dark" ? "bg-[#091520]/80 border-white/[0.08]" : "bg-white border-stone-200"
      }`}>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="space-y-1">
            <h2 className={`text-xl font-extrabold tracking-tight font-sans ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
              Announcement Manager
            </h2>
            <p className={`text-xs font-medium font-sans ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
              Manage and view compliance updates, premium policy exceptions, and payment guidelines with proximity-based visual urgency triggers.
            </p>
          </div>
        </div>
      </div>

      {/* Grid content split: Adder Form Left / List on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">

        {/* Form card (5 cols) */}
        <div className="col-span-1 lg:col-span-5 flex flex-col">
          <div className={`p-6 rounded-2xl border flex flex-col justify-between h-full ${
            theme === "dark" ? "bg-[#091520]/80 border-white/[0.08]" : "bg-white border-stone-200"
          }`}>
            {/* Inner components */}
            <QAAnnouncementForm
              theme={theme}
              qaAnnouncements={qaAnnouncements}
              setQaAnnouncements={setQaAnnouncements}
              currentUser={currentUser}
              setChangeLogs={setChangeLogs}
              editingAnnouncementId={editingAnnouncementId}
              setEditingAnnouncementId={setEditingAnnouncementId}
            />
          </div>
        </div>

        {/* List card (7 cols) */}
        <div className="col-span-1 lg:col-span-7 flex flex-col">
          <div className={`p-6 rounded-2xl border flex flex-col h-full ${
            theme === "dark" ? "bg-[#091520]/80 border-white/[0.08]" : "bg-white border-stone-200"
          }`}>
            <div className="space-y-4 h-full flex flex-col">
              <div className="flex justify-between items-center pb-2 border-b border-light-stone/5 dark:border-stone-800">
                <h3 className={`text-sm font-bold uppercase tracking-wider ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
                  Active Announcements ({qaAnnouncements.length})
                </h3>
                <span className="text-[10px] font-mono text-stone-500">
                  Active Sort: Absolute Proximity Rank
                </span>
              </div>

              <div className="space-y-3.5 flex-grow overflow-y-auto max-h-[500px] pr-1">
                {qaAnnouncements.length === 0 ? (
                  <div className="text-center py-20 text-xs italic text-stone-500 select-none">
                    No active announcements. Use the form on the left to add one.
                  </div>
                ) : (
                  [...qaAnnouncements]
                    .sort((a, b) => {
                      const today = new Date("2026-06-09");
                      const getDaysDiff = (dateStr: string) => {
                        const targetDate = new Date(dateStr);
                        const diffTime = targetDate.getTime() - today.getTime();
                        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                      };
                      return Math.abs(getDaysDiff(a.effectiveDate)) - Math.abs(getDaysDiff(b.effectiveDate));
                    })
                    .map((item) => {
                      const today = new Date("2026-06-09");
                      const diffDays = Math.ceil((new Date(item.effectiveDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

                      let highlightStyle = "";
                      let badgeText = "";
                      let badgeColor = "";

                      if (theme === "dark") {
                        if (diffDays === 0) {
                          highlightStyle = "border-red-500 bg-red-950/20 text-red-100 border-2";
                          badgeText = "CRITICAL TODAY";
                          badgeColor = "bg-red-500 text-white animate-pulse";
                        } else if (diffDays === 1) {
                          highlightStyle = "border-amber-500 bg-amber-950/20 text-amber-100 border-2";
                          badgeText = "IMMEDIATE IN 1 DAY";
                          badgeColor = "bg-amber-500 text-stone-950 font-black";
                        } else if (diffDays > 1 && diffDays <= 3) {
                          highlightStyle = "border-orange-500/80 bg-orange-950/10 text-orange-200 border";
                          badgeText = `CRITICAL IN ${diffDays} DAYS`;
                          badgeColor = "bg-orange-500/20 text-orange-400 border border-orange-500/30";
                        } else if (diffDays > 3 && diffDays <= 7) {
                          highlightStyle = "border-teal-500/50 bg-teal-950/10 text-teal-200 border";
                          badgeText = `UPCOMING IN ${diffDays} DAYS`;
                          badgeColor = "bg-teal-500/20 text-teal-400 border border-teal-500/30";
                        } else if (diffDays < 0) {
                          highlightStyle = "border-stone-800 bg-stone-900/30 text-stone-400 opacity-60 border";
                          const absVal = Math.abs(diffDays);
                          const label = absVal === 1 ? "DAY" : "DAYS";
                          badgeText = `EFFECTIVE ${absVal} ${label} AGO`;
                          badgeColor = "bg-stone-850 text-stone-500";
                        } else {
                          highlightStyle = "border-white/[0.04] bg-stone-900/40 text-[#D1D5DB] border";
                          badgeText = `IN ${diffDays} DAYS (${item.effectiveDate})`;
                          badgeColor = "bg-stone-900 text-stone-400";
                        }
                      } else {
                        if (diffDays === 0) {
                          highlightStyle = "border-red-500 bg-red-50 text-red-900 border-2 shadow-sm animate-pulse";
                          badgeText = "CRITICAL TODAY";
                          badgeColor = "bg-red-600 text-white";
                        } else if (diffDays === 1) {
                          highlightStyle = "border-amber-500 bg-amber-50 text-amber-900 border-2 shadow-sm";
                          badgeText = "IMMEDIATE IN 1 DAY";
                          badgeColor = "bg-amber-600 text-white font-bold";
                        } else if (diffDays > 1 && diffDays <= 3) {
                          highlightStyle = "border-orange-400 bg-orange-50 text-orange-900 border";
                          badgeText = `CRITICAL IN ${diffDays} DAYS`;
                          badgeColor = "bg-orange-100 text-orange-850 border border-orange-200";
                        } else if (diffDays > 3 && diffDays <= 7) {
                          highlightStyle = "border-teal-400 bg-teal-50 text-teal-900 border";
                          badgeText = `UPCOMING IN ${diffDays} DAYS`;
                          badgeColor = "bg-teal-100 text-teal-850 border border-teal-200";
                        } else if (diffDays < 0) {
                          highlightStyle = "border-stone-200 bg-stone-100 text-stone-500 opacity-70 border";
                          const absVal = Math.abs(diffDays);
                          const label = absVal === 1 ? "DAY" : "DAYS";
                          badgeText = `EFFECTIVE ${absVal} ${label} AGO`;
                          badgeColor = "bg-stone-200 text-stone-600";
                        } else {
                          highlightStyle = "border-stone-200 bg-white text-stone-700 border";
                          badgeText = `IN ${diffDays} DAYS (${item.effectiveDate})`;
                          badgeColor = "bg-stone-150 text-stone-650 border border-stone-200/50";
                        }
                      }

                      const customBgColor =
                        item.id === "ann-2" ? "#091d35" :
                        item.id === "ann-1" ? "#09351d" :
                        item.id === "ann-4" ? "#351709" : undefined;

                      const customSpanColor =
                        item.id === "ann-4" ? "#e2699b" : undefined;

                      return (
                        <div
                          key={item.id}
                          className={`p-4 rounded-xl text-left transition-all relative overflow-hidden flex flex-col justify-between ${highlightStyle}`}
                          style={customBgColor ? { backgroundColor: customBgColor } : undefined}
                        >
                          <div>
                            <div className="flex items-start justify-between gap-4 mb-2 flex-wrap">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className="text-[10px] uppercase font-mono font-bold bg-[#3B82F6]/10 text-[#3B82F6] px-2 py-0.5 rounded border border-[#3B82F6]/25"
                                  style={customSpanColor ? { color: customSpanColor } : undefined}
                                >
                                  {item.category}
                                </span>
                                {item.type && (
                                  <span className="text-[10px] uppercase font-mono font-bold bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded border border-amber-500/25">
                                    {item.type}
                                  </span>
                                )}
                                <span className={`text-[8px] uppercase font-black px-1.5 py-0.5 rounded tracking-widest ${badgeColor}`}>
                                  {badgeText}
                                </span>
                                {item.type === "QA Announcement" && item.rating !== undefined && item.rating > 0 && (
                                  <span className="text-[10px] uppercase font-mono font-bold bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded border border-emerald-500/25">
                                    Rating: {item.rating}
                                  </span>
                                )}
                              </div>

                              {deletingAnnouncementId === item.id ? (
                                <div className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/30 px-2 py-0.5 rounded-lg select-none">
                                  <span className="text-[9px] font-black uppercase text-red-500 tracking-wider">
                                    Sure?
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setQaAnnouncements(prev => prev.filter(p => p.id !== item.id));
                                      setDeletingAnnouncementId(null);
                                      // Log activity
                                      setChangeLogs(prev => [
                                        {
                                          id: `log-${Date.now()}`,
                                          timestamp: new Date().toISOString(),
                                          userName: currentUser?.name || "Mehruf P (Owner)",
                                          // Phase 1.4 resolution: `role` never existed on LoggedUser (only `tier`
                                          // does), so `(currentUser as any)?.role` was always `undefined` and this
                                          // always fell back to "Owner" — provably, for every possible currentUser.
                                          // Simplified to the constant it always evaluated to; this is a type-safety
                                          // cleanup only, with byte-identical runtime behavior to before.
                                          role: "Owner",
                                          actionType: "Announcement Deleted",
                                          planName: item.category,
                                          description: `Deleted "${item.type || 'QA Announcement'}" announcement: "${item.announcement.substring(0, 50)}..."`
                                        },
                                        ...prev
                                      ]);
                                    }}
                                    className="px-1.5 py-0.5 rounded text-[9px] bg-red-650 hover:bg-red-700 bg-red-600 text-white font-black cursor-pointer transition-colors"
                                  >
                                    Delete
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setDeletingAnnouncementId(null)}
                                    className="px-1.5 py-0.5 rounded text-[9px] bg-stone-500 hover:bg-stone-600 text-white font-black cursor-pointer transition-colors"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setEditingAnnouncementId(item.id)}
                                    className="p-1 rounded-md text-stone-400 hover:text-blue-500 hover:bg-blue-500/10 cursor-pointer transition-colors"
                                    title="Edit notice"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDeletingAnnouncementId(item.id);
                                    }}
                                    className="p-1 rounded-md text-stone-400 hover:text-red-500 hover:bg-red-500/10 cursor-pointer transition-colors"
                                    title="Delete notice"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                            <div className="text-xs leading-relaxed font-normal font-sans mb-3 text-stone-850 dark:text-stone-100">
                              {renderFormattedAnnouncement(item.announcement, theme)}
                            </div>
                          </div>

                          <div className="flex items-center justify-between text-[9px] font-mono text-stone-500 border-t border-dashed border-stone-200/20 pt-2 w-full animate-fade-in">
                            <span>By: <span className="font-semibold">{item.addedBy}</span></span>
                            <div className="flex gap-2.5">
                              <span>Date: <span className="font-semibold">{item.effectiveDate}</span></span>
                              {item.validTillDate && (
                                <span className="text-red-450 dark:text-red-400 font-bold bg-red-500/10 px-1 rounded">Valid Till: {item.validTillDate}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
