/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { Check, Plus } from "lucide-react";
import { QAAnnouncement } from "../../types/announcements";
import { LoggedUser } from "../../types/user";
import { ChangeLogEntry } from "../../types/changeLog";

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
  const [announcementType, setAnnouncementType] = useState<"QA Announcement" | "General Announcement">("QA Announcement");
  const [text, setText] = useState("");
  const [date, setDate] = useState(""); // Optional — Date Selection is not required
  const [category, setCategory] = useState("General Compliance");
  const [title, setTitle] = useState("");
  const [validTillDate, setValidTillDate] = useState("2026-06-24");
  const [fromTeam, setFromTeam] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [rating, setRating] = useState(5); // Default to perfect score (5)
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Sync author if user changes
  useEffect(() => {
    if (currentUser) {
      setAuthorName(currentUser.name || currentUser.email || "Mehruf P (Owner)");
    } else {
      setAuthorName("Mehruf P (Owner)");
    }
  }, [currentUser]);

  // Handle editing state
  useEffect(() => {
    if (editingAnnouncementId) {
      const item = qaAnnouncements.find(p => p.id === editingAnnouncementId);
      if (item) {
        const itemType = item.type || "QA Announcement";
        setAnnouncementType(itemType);
        setText(item.announcement || "");
        setDate(item.effectiveDate || "");
        if (itemType !== "QA Announcement") {
          setTitle(item.title || item.category || "");
          setValidTillDate(item.validTillDate || "2026-06-24");
          setFromTeam(item.from || "");
        } else {
          setCategory(item.category || "General Compliance");
          setRating(item.rating ?? 5);
        }
      }
    } else {
      setText("");
      setDate("");
      setCategory("General Compliance");
      setTitle("");
      setRating(5);
      setValidTillDate("2026-06-24");
      setFromTeam("");
      setAnnouncementType("QA Announcement");
    }
  }, [editingAnnouncementId, qaAnnouncements]);

  const handleSubmit = (e: React.FormEvent) => {
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

    if (editingAnnouncementId) {
      // Edit in place
      setQaAnnouncements(prev => prev.map(item => {
        if (item.id === editingAnnouncementId) {
          const updated: QAAnnouncement = {
            ...item,
            announcement: text.trim(),
            effectiveDate: date,
            category: announcementType === "QA Announcement" ? category.trim() : title.trim(),
            type: announcementType,
            title: announcementType === "QA Announcement" ? category.trim() : title.trim(),
            rating: announcementType === "QA Announcement" ? rating : 0,
            validTillDate: announcementType !== "QA Announcement" ? validTillDate : undefined,
            from: announcementType === "General Announcement" ? (fromTeam.trim() || undefined) : undefined,
          };
          return updated;
        }
        return item;
      }));

      if (setChangeLogs) {
        setChangeLogs(prev => [
          {
            id: `log-${Date.now()}`,
            timestamp: new Date().toISOString(),
            userName: authorName.trim() || "Underwriting Specialist",
            // Phase 1.4: `role` never existed on LoggedUser (only `tier` does), so
            // `currentUser?.role` was always `undefined` here too (see the identical
            // fix in AnnouncementLogPage.tsx) — simplified to the constant it always
            // evaluated to; byte-identical runtime behavior to before.
            role: "Owner",
            actionType: "Announcement Edited",
            planName: announcementType === "QA Announcement" ? category.trim() : title.trim(),
            description: `Edited "${announcementType}" announcement: "${text.trim().substring(0, 50)}..."`
          },
          ...prev
        ]);
      }

      setSuccessMsg("Announcement updated successfully!");
      if (setEditingAnnouncementId) setEditingAnnouncementId(null);
    } else {
      // Create new
      const newNotice: QAAnnouncement = {
        id: `ann-${Date.now()}`,
        announcement: text.trim(),
        effectiveDate: date,
        category: announcementType === "QA Announcement" ? category.trim() : title.trim(),
        addedBy: authorName.trim() || "Underwriting Specialist",
        type: announcementType,
        title: announcementType === "QA Announcement" ? category.trim() : title.trim(),
        rating: announcementType === "QA Announcement" ? rating : 0,
        validTillDate: announcementType !== "QA Announcement" ? validTillDate : undefined,
        from: announcementType === "General Announcement" ? (fromTeam.trim() || undefined) : undefined,
      };

      setQaAnnouncements(prev => [newNotice, ...prev]);

      if (setChangeLogs) {
        setChangeLogs(prev => [
          {
            id: `log-${Date.now()}`,
            timestamp: new Date().toISOString(),
            userName: authorName.trim() || "Underwriting Specialist",
            // Phase 1.4: `role` never existed on LoggedUser (only `tier` does), so
            // `currentUser?.role` was always `undefined` here too (see the identical
            // fix in AnnouncementLogPage.tsx) — simplified to the constant it always
            // evaluated to; byte-identical runtime behavior to before.
            role: "Owner",
            actionType: "Announcement Added",
            planName: announcementType === "QA Announcement" ? category.trim() : title.trim(),
            description: `Added "${announcementType}" announcement: "${text.trim().substring(0, 50)}..."`
          },
          ...prev
        ]);
      }

      setSuccessMsg("Announcement added successfully!");
    }

    // Reset fields
    setText("");
    setTitle("");
    setFromTeam("");
    if (!editingAnnouncementId) {
      setCategory("General Compliance");
      setRating(5);
    }

    // Auto-clear success message after 6 seconds
    setTimeout(() => {
      setSuccessMsg("");
    }, 6000);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-left h-full flex flex-col justify-between">
      <div className="space-y-4">
        <div className="pb-2 border-b border-light-stone/5 dark:border-stone-800">
          <h3 className={`text-sm font-bold uppercase tracking-wider ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
            {editingAnnouncementId ? "Edit Announcement" : "Add New Announcement"}
          </h3>
          <p className="text-[11px] text-stone-500 mt-1">
            Add or modify compliance and payment guidelines directly in the announcement database.
          </p>
        </div>

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

        {/* Announcement Type Selector Option */}
        <div className="space-y-1.5 text-left">
          <label className={`block text-[10px] font-bold uppercase tracking-wider ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
            Announcement Type
          </label>
          <select
            value={announcementType}
            onChange={(e) => {
              setAnnouncementType(e.target.value as "QA Announcement" | "General Announcement");
              if (e.target.value === "QA Announcement") {
                setCategory("General Compliance");
              } else {
                setCategory(e.target.value);
              }
            }}
            className={`w-full text-xs font-semibold p-2.5 rounded-lg border outline-none cursor-pointer ${
              theme === "dark" 
                ? "bg-[#12151A] border-[#252A34] text-white focus:border-blue-500" 
                : "bg-white border-stone-250 text-stone-850 focus:border-blue-500 shadow-sm"
            }`}
          >
            <option value="QA Announcement">QA Announcement</option>
            <option value="General Announcement">General Announcement</option>
          </select>
        </div>

        {/* CONDITIONAL FORMS */}
        {announcementType === "QA Announcement" ? (
          <>
            {/* QA Title (uses Category field) */}
            <div className="space-y-1.5 text-left">
              <label className={`block text-[10px] font-bold uppercase tracking-wider ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
                Title
              </label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Care Supreme Gastroenterology payout rule update"
                className={`w-full text-xs font-semibold p-2.5 rounded-lg border outline-none ${
                  theme === "dark" 
                    ? "bg-[#12151A] border-[#252A34] text-white focus:border-blue-500 placeholder-stone-600" 
                    : "bg-white border-stone-250 text-stone-820 focus:border-blue-500 shadow-sm placeholder-stone-400"
                }`}
                required
              />
            </div>

            {/* Grid for Effective Date & Rating */}
            <div className="grid grid-cols-2 gap-3">
              {/* Effective Date input */}
              <div className="space-y-1.5 text-left">
                <label className={`block text-[10px] font-bold uppercase tracking-wider ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
                  Effective Date <span className="normal-case font-medium text-stone-400">(optional)</span>
                </label>
                <div className="relative">
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    onClick={(e) => {
                      try {
                        e.currentTarget.showPicker();
                      } catch (_) {}
                    }}
                    className={`w-full text-xs font-semibold p-2.5 rounded-lg border outline-none cursor-pointer ${
                      theme === "dark" 
                        ? "bg-[#12151A] border-[#252A34] text-white focus:border-blue-500" 
                        : "bg-white border-stone-250 text-stone-800 focus:border-blue-500 shadow-sm"
                    }`}
                  />
                </div>
              </div>

              {/* Rating input */}
              <div className="space-y-1.5 text-left">
                <label className={`block text-[10px] font-bold uppercase tracking-wider ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
                  Rating Score
                </label>
                <select
                  value={rating}
                  onChange={(e) => setRating(Number(e.target.value))}
                  className={`w-full text-xs font-semibold p-2.5 rounded-lg border outline-none cursor-pointer ${
                    theme === "dark" 
                      ? "bg-[#12151A] border-[#252A34] text-white focus:border-blue-500" 
                      : "bg-white border-stone-250 text-stone-850 focus:border-blue-500 shadow-sm"
                  }`}
                >
                  <option value={5}>Rating 5</option>
                  <option value={4}>Rating 4</option>
                  <option value={3}>Rating 3</option>
                  <option value={2}>Rating 2</option>
                  <option value={1}>Rating 1</option>
                  <option value={-1}>Highlighting</option>
                  <option value={0}>No Rating Applicable</option>
                </select>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* General Content forms */}
            <div className="space-y-1.5 text-left">
              <label className={`block text-[10px] font-bold uppercase tracking-wider ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Independence Day System Downtime Alert"
                className={`w-full text-xs font-semibold p-2.5 rounded-lg border outline-none ${
                  theme === "dark"
                    ? "bg-[#12151A] border-[#252A34] text-white focus:border-blue-500 placeholder-stone-605"
                    : "bg-white border-stone-250 text-stone-820 focus:border-blue-500 shadow-sm placeholder-stone-400"
                }`}
                required
              />
            </div>

            {/* Optional From (team/department) field */}
            <div className="space-y-1.5 text-left">
              <label className={`block text-[10px] font-bold uppercase tracking-wider ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
                From <span className="normal-case font-medium text-stone-400">(optional)</span>
              </label>
              <input
                type="text"
                value={fromTeam}
                onChange={(e) => setFromTeam(e.target.value)}
                placeholder="e.g. Underwriting Team"
                className={`w-full text-xs font-semibold p-2.5 rounded-lg border outline-none ${
                  theme === "dark"
                    ? "bg-[#12151A] border-[#252A34] text-white focus:border-blue-500 placeholder-stone-605"
                    : "bg-white border-stone-250 text-stone-820 focus:border-blue-500 shadow-sm placeholder-stone-400"
                }`}
              />
            </div>

            {/* Dates: Announcement Date and Valid Till Date */}
            <div className="grid grid-cols-2 gap-3">
              {/* Announcement Date */}
              <div className="space-y-1.5 text-left">
                <label className={`block text-[10px] font-bold uppercase tracking-wider ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
                  Announcement Date <span className="normal-case font-medium text-stone-400">(optional)</span>
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  onClick={(e) => {
                    try {
                      e.currentTarget.showPicker();
                    } catch (_) {}
                  }}
                  className={`w-full text-xs font-semibold p-2.5 rounded-lg border outline-none cursor-pointer ${
                    theme === "dark"
                      ? "bg-[#12151A] border-[#252A34] text-white focus:border-blue-500"
                      : "bg-white border-stone-250 text-stone-820 focus:border-blue-500 shadow-sm"
                  }`}
                />
              </div>

              {/* Valid Till Date */}
              <div className="space-y-1.5 text-left">
                <label className={`block text-[10px] font-bold uppercase tracking-wider ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
                  Valid Till Date
                </label>
                <input
                  type="date"
                  value={validTillDate}
                  onChange={(e) => setValidTillDate(e.target.value)}
                  onClick={(e) => {
                    try {
                      e.currentTarget.showPicker();
                    } catch (_) {}
                  }}
                  className={`w-full text-xs font-semibold p-2.5 rounded-lg border outline-none cursor-pointer ${
                    theme === "dark"
                      ? "bg-[#12151A] border-[#252A34] text-white focus:border-blue-500"
                      : "bg-white border-stone-250 text-stone-820 focus:border-blue-500 shadow-sm"
                  }`}
                  required
                />
              </div>
            </div>
          </>
        )}

        {/* Description Textarea */}
        <div className="space-y-1.5 text-left">
          <label className={`block text-[10px] font-bold uppercase tracking-wider ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
            Announcement Content
          </label>
          <textarea
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Formatting: **text** = Bold+Red, *text* = Bold, _text_ = Italic (combinable, e.g. **_text_**)"}
            className={`w-full text-xs font-semibold p-2.5 rounded-lg border outline-none resize-none ${
              theme === "dark" 
                ? "bg-[#12151A] border-[#252A34] text-white focus:border-blue-500 placeholder-stone-605" 
                : "bg-white border-stone-250 text-stone-850 focus:border-blue-500 shadow-sm placeholder-stone-400"
            }`}
          />
        </div>
      </div>

      <div className="pt-4">
        {editingAnnouncementId ? (
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-grow py-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold uppercase tracking-widest rounded-xl transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer shadow-md hover:shadow-blue-500/10 active:scale-[0.98]"
            >
              <Check className="w-4 h-4" />
              <span>Save Changes</span>
            </button>
            <button
              type="button"
              onClick={() => setEditingAnnouncementId && setEditingAnnouncementId(null)}
              className="px-4 py-3 bg-stone-500 hover:bg-stone-600 text-white text-xs font-extrabold uppercase tracking-widest rounded-xl transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Cancel</span>
            </button>
          </div>
        ) : (
          <button
            type="submit"
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold uppercase tracking-widest rounded-xl transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer shadow-md hover:shadow-blue-500/10 active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" />
            <span>Add Announcement</span>
          </button>
        )}
      </div>
    </form>
  );
}
