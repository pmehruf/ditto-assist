/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  FileSpreadsheet,
  Check,
  Copy,
  Search,
  Filter,
  Info,
  LogOut,
  Sun,
  Moon,
  User,
  Activity,
  ArrowRight,
  ArrowLeft,
  PanelLeftOpen,
  PanelLeftClose,
  Clock,
  Menu,
  AlertCircle,
  Target,
  Flag,
  Sliders,
  History,
  Bell,
  LockKeyhole,
  Eye,
  Home,
  Megaphone,
  ClipboardPlus
} from "lucide-react";

import {
  PLANS,
  getPlanConfig,
  TOP_PED_DICTIONARY,
  MatchOutput
} from "./types.js";

import {
  matchSpecificIllness,
  normalizePlanName,
  MASTER_ILLNESSES,
} from "./specificIllnessEngine";

import {
  classifyDeterministic,
  finalizeOutput,
  sanitizeOutput,
  applyPostGuards
} from "./engine.js";

import { SCRIPT_DICTIONARY } from "./constants/scriptDictionary";
import { DEFAULT_FEATURE_PERMISSIONS } from "./constants/featurePermissions";
import { AuditLogEntry, ReportedIssue, QAAnnouncement } from "./types/announcements";
import { LoggedUser, UserProfile } from "./types/user";
import { DraftPlan } from "./types/plans";
import { FeaturePermission } from "./types/permissions";
import { ChangeLogEntry } from "./types/changeLog";
import { DeclarationMapIcon } from "./components/icons";
import { GridTexture } from "./components/GridTexture";
import { PrimaryCtaButton } from "./components/PrimaryCtaButton";
import { DittoMascot } from "./components/mascots/DittoMascot";
import { DittoWordmark } from "./components/mascots/DittoWordmark";
import { MascotWithFallback } from "./components/mascots/MascotWithFallback";
import { QAAnnouncementForm } from "./components/forms/QAAnnouncementForm";
import { renderFormattedAnnouncement } from "./utils/renderFormattedAnnouncement";
import { parseGlobalLogTimestamp, formatDisplayTimestamp } from "./utils/timestamps";
import { translateMatchTypeToLayman, translateFallbackToLayman, translateSourceToLayman } from "./utils/labelTranslation";
import { usePersistentState } from "./hooks/usePersistentState";
import { ErrorBoundary, TabLoadingFallback } from "./components/ErrorBoundary";

// ─────────────────────────────────────────────
// Lazy-loaded tab pages (Phase 2: Performance)
// ─────────────────────────────────────────────
// Each tab's page component is its own code-split chunk, fetched only when
// the user actually navigates to that tab. This keeps the initial bundle
// limited to the app shell + whichever tab is active on first paint
// ("lookup", which loads eagerly below since it's the default landing tab).
// All nine are named exports, so each lazy() call resolves the named export
// into the { default } shape React.lazy requires.
const LookupIntroPage = lazy(() =>
  import("./pages/LookupIntroPage").then((m) => ({ default: m.LookupIntroPage }))
);
const LookupPage = lazy(() =>
  import("./pages/LookupPage").then((m) => ({ default: m.LookupPage }))
);
const ResourcesPage = lazy(() =>
  import("./pages/ResourcesPage").then((m) => ({ default: m.ResourcesPage }))
);
const ProfileAccessPage = lazy(() =>
  import("./pages/ProfileAccessPage").then((m) => ({ default: m.ProfileAccessPage }))
);
const PlanScopePage = lazy(() =>
  import("./pages/PlanScopePage").then((m) => ({ default: m.PlanScopePage }))
);
const MyActivityPage = lazy(() =>
  import("./pages/MyActivityPage").then((m) => ({ default: m.MyActivityPage }))
);
const AuditPage = lazy(() =>
  import("./pages/AuditPage").then((m) => ({ default: m.AuditPage }))
);
const AnnouncementLogPage = lazy(() =>
  import("./pages/AnnouncementLogPage").then((m) => ({ default: m.AnnouncementLogPage }))
);
const FlaggedResponsesPage = lazy(() =>
  import("./pages/FlaggedResponsesPage").then((m) => ({ default: m.FlaggedResponsesPage }))
);

export default function App() {
  const [activeTab, setActiveTab] = useState<"lookup" | "audit" | "profile_access" | "plan_scope" | "resources" | "active_questions" | "my_activity" | "qa_announcement_log" | "flagged_responses">("lookup");
  const [qaAnnouncements, setQaAnnouncements] = useState<QAAnnouncement[]>(() => {
    try {
      const saved = localStorage.getItem("ditto_qa_announcements");
      if (saved) {
        const parsed = JSON.parse(saved) as QAAnnouncement[];
        // Drop the old hardcoded "Special Instructions" seed announcement
        // (that type has been removed from the app entirely) if it's still
        // present in a returning user's localStorage.
        return parsed.filter(item => item.id !== "ann-special-chronic" && (item.type as string) !== "Special Instructions");
      }
    } catch (_) {}
    return [
      {
        id: "ann-1",
        announcement: "Care Supreme Gastroenterology payout rule update: Wait lists now mandate medical director approval for standard hernia repair.",
        effectiveDate: "2026-06-11",
        category: "Gastroenterology",
        addedBy: "Rebecca S (Admin)",
        rating: 4
      },
      {
        id: "ann-2",
        announcement: "Activ One Max Payment schedule revisions for orthopaedic slip disc conditions. Effective immediately, require strict MRI scan date matching.",
        effectiveDate: "2026-06-10",
        category: "Orthopaedic / Rheumatological",
        addedBy: "Mehruf P (Owner)",
        rating: 2
      },
      {
        id: "ann-3",
        announcement: "Optima Secure eye procedures mapping guidelines: Advanced laser surgeries with clinic filters now require mandatory ophthalmology signature.",
        effectiveDate: "2026-06-25",
        category: "Eye",
        addedBy: "Shashank J (Admin)",
        rating: 5
      },
      {
        id: "ann-4",
        announcement: "Activ Fit Preferred ENT category disclaimer: Deviated nasal septum (DNS) wait times lowered to 12 months for corporate groups.",
        effectiveDate: "2026-06-15",
        category: "ENT",
        addedBy: "Mehruf P (Owner)",
        rating: 3
      }
    ];
  });

  // Sync announcements
  useEffect(() => {
    try {
      localStorage.setItem("ditto_qa_announcements", JSON.stringify(qaAnnouncements));
    } catch (_) {}
  }, [qaAnnouncements]);

  const activeAnnouncements = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Announcements without an effectiveDate are treated as always-current
    // (day 0 — never "in the past", always sorted alongside today's items).
    const getDaysDiff = (dateStr?: string) => {
      if (!dateStr) return 0;
      const todayDate = new Date();
      todayDate.setHours(0, 0, 0, 0);
      const targetDate = new Date(dateStr);
      targetDate.setHours(0, 0, 0, 0);
      const diffTime = targetDate.getTime() - todayDate.getTime();
      return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    };

    // Filter out General announcements whose Valid Till Date is reached
    const unexpiredAnnouncements = qaAnnouncements.filter(item => {
      if (item.type === "General Announcement") {
        if (item.validTillDate) {
          const tillDate = new Date(item.validTillDate);
          tillDate.setHours(0, 0, 0, 0);
          if (today.getTime() >= tillDate.getTime()) {
            return false;
          }
        }
      }
      return true;
    });

    // Separate future (and today) announcements vs past announcements
    const futureAnnouncements = unexpiredAnnouncements
      .filter(item => getDaysDiff(item.effectiveDate) >= 0)
      .sort((a, b) => getDaysDiff(a.effectiveDate) - getDaysDiff(b.effectiveDate)); // closest future first

    const pastAnnouncements = unexpiredAnnouncements
      .filter(item => getDaysDiff(item.effectiveDate) < 0)
      .sort((a, b) => getDaysDiff(b.effectiveDate) - getDaysDiff(a.effectiveDate)); // closest/latest past first

    if (futureAnnouncements.length >= 5) {
      // If there are 5 or more future effective date announcements, this 5 count is not applicable.
      return futureAnnouncements;
    } else {
      // If there are less than 5 announcements, play previous latest announcements to match the count as 5 minimum always.
      const needed = 5 - futureAnnouncements.length;
      const extraPast = pastAnnouncements.slice(0, needed);
      return [...futureAnnouncements, ...extraPast];
    }
  }, [qaAnnouncements]);

  const [noticeIndex, setNoticeIndex] = useState<number>(0);
  const [slideDirection, setSlideDirection] = useState<"right-to-left" | "left-to-right">("right-to-left");

  useEffect(() => {
    if (activeAnnouncements.length <= 1) return;
    const currentText = activeAnnouncements[noticeIndex % activeAnnouncements.length]?.announcement || "";
    // Give 5 seconds base + 50ms per character for dynamic reading pace
    const dynamicDelay = Math.max(5000, currentText.length * 50);
    
    const timer = setTimeout(() => {
      setSlideDirection("right-to-left");
      setNoticeIndex((prev) => (prev + 1) % activeAnnouncements.length);
    }, dynamicDelay);
    
    return () => clearTimeout(timer);
  }, [noticeIndex, activeAnnouncements]);

  const [isMismatchesExpanded, setIsMismatchesExpanded] = useState<boolean>(false);

  // Scroll to the top when switching views/pages or loading the application
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    const scrollContainer = document.getElementById("main-scrollable-body");
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    }
  }, [activeTab]);

  const [showIntro, setShowIntro] = useState<boolean>(true);
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [isMobileWindow, setIsMobileWindow] = useState<boolean>(typeof window !== "undefined" ? window.innerWidth < 768 : false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobileWindow(window.innerWidth < 768);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState<boolean>(false);
  const [profileOpen, setProfileOpen] = useState<boolean>(false);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const [profileMenuPos, setProfileMenuPos] = useState<{ bottom: number; left: number } | null>(null);

  // My Activity Section Navigation View States
  const [myActivitySearch, setMyActivitySearch] = useState<string>("");
  const [myActivityPlanFilter, setMyActivityPlanFilter] = useState<string>("All");
  const [myActivityStartDate, setMyActivityStartDate] = useState<string>("");
  const [myActivityEndDate, setMyActivityEndDate] = useState<string>("");
  const [expandedLogIndex, setExpandedLogIndex] = useState<string | null>(null);

  // Active Login State — the source of truth is the real server session (an
  // httpOnly cookie set by /api/auth/google/callback after a verified
  // @joinditto.in Google sign-in), checked on mount via GET /api/auth/session
  // below. There is no localStorage fallback anymore: an expired/missing
  // server session always means logged out.
  const [currentUser, setCurrentUser] = useState<LoggedUser | null>(null);
  const [authChecking, setAuthChecking] = useState<boolean>(true);

  // Users Database (mocking production directory)
  const [usersList, setUsersList] = usePersistentState<UserProfile[]>("ditto_users_list", () => {
    return [
      { email: "mehruf.p@joinditto.in", name: "Mehruf P", tactId: "TACT-101", tier: "Owner", status: "Active" },
      { email: "rebecca.s@joinditto.in", name: "Rebecca S", tactId: "TACT-102", tier: "Admin", status: "Active" },
      { email: "shashank@joinditto.in", name: "Shashank J", tactId: "TACT-103", tier: "General", status: "Active" }
    ];
  });

  // Keep the logged-in user's profile fields in sync if their entry in
  // usersList changes elsewhere (persistence for usersList itself is handled
  // by the usePersistentState hook above).
  useEffect(() => {
    if (currentUser) {
      const match = usersList.find(u => u.email.toLowerCase() === currentUser.email.toLowerCase());
      if (match) {
        if (match.name !== currentUser.name || match.tactId !== currentUser.tactId || match.tier !== currentUser.tier) {
          const updatedUser = { ...currentUser, name: match.name, tactId: match.tactId, tier: match.tier };
          setCurrentUser(updatedUser);
        }
      }
    }
  }, [usersList, currentUser]);

  // Accessibility: trap keyboard focus within an open drawer; Escape closes; restore focus on close.
  useEffect(() => {
    const drawerId = isMenuOpen ? "left-nav-drawer" : isRightSidebarOpen ? "right-controls-drawer" : null;
    if (!drawerId) return;
    const closeDrawer = isMenuOpen ? () => setIsMenuOpen(false) : () => setIsRightSidebarOpen(false);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const getFocusable = (): HTMLElement[] => {
      const container = document.getElementById(drawerId);
      if (!container) return [];
      return Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
    };
    const focusTimer = setTimeout(() => {
      const focusables = getFocusable();
      if (focusables.length) focusables[0].focus();
    }, 60);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeDrawer();
        return;
      }
      if (e.key !== "Tab") return;
      const items = getFocusable();
      if (!items.length) return;
      const container = document.getElementById(drawerId);
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement;
      if (e.shiftKey) {
        if (active === first || !container?.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !container?.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown, true);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [isMenuOpen, isRightSidebarOpen]);

  // Draft plans submitted for approval
  const [draftPlans, setDraftPlans] = usePersistentState<DraftPlan[]>(
    "ditto_draft_plans",
    () => [
      {
        name: "Activ One Safeguard [DRAFT]",
        submittedBy: "Rebecca S",
        submittedAt: "2026-06-02",
        status: "Pending Approval",
        questions: [
          "Are you suffering from any chronic kidney disease?",
          "Have you had any history of organ transplantation?",
          "Any other congenital or endocrine disease?"
        ]
      },
      {
        name: "Care Elite Protect [DRAFT]",
        submittedBy: "Shashank J",
        submittedAt: "2026-06-03",
        status: "Pending Approval",
        questions: [
          "Do you have any active psychiatric or nervous disorders?",
          "History of bypass surgeries or major heart ailments?",
          "Any other non-disclosed ailments?"
        ]
      }
    ],
    {
      deserialize: (raw) => {
        const parsed = JSON.parse(raw) as DraftPlan[];
        const seen = new Set<string>();
        return parsed.filter(d => {
          if (!d || !d.name || seen.has(d.name)) return false;
          seen.add(d.name);
          return true;
        });
      },
    }
  );

  // Production plans list (persisted dynamically)
  const [productionPlans, setProductionPlans] = usePersistentState<string[]>(
    "ditto_production_plans",
    () => PLANS
  );

  // Questions index records for approved draft plans
  const [promotedPlans, setPromotedPlans] = usePersistentState<Record<string, string[]>>(
    "ditto_promoted_plans_questions",
    () => ({})
  );

  // Master Insurer Metadata layer
  const [insurerMetadata, setInsurerMetadata] = usePersistentState<Record<string, string>>(
    "ditto_insurer_metadata",
    () => ({
      "Optima Secure": "HDFC ERGO",
      "Care Supreme": "Care Health Insurance",
      "Activ One Max": "Aditya Birla Health Insurance",
      "Activ Fit Preferred": "Aditya Birla Health Insurance",
      "Activ One Safeguard [DRAFT]": "Aditya Birla Health Insurance",
      "Care Elite Protect [DRAFT]": "Care Health Insurance"
    })
  );

  // Master Change Log State
  const [changeLogs, setChangeLogs] = usePersistentState<ChangeLogEntry[]>(
    "ditto_change_logs",
    () => [
      {
        id: "log-1",
        timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000 * 3).toISOString(), // 3 days ago
        userName: "System Seed Engine",
        role: "Owner",
        actionType: "Draft Approved",
        planName: "Optima Secure",
        description: "Initial framework deployment for Optima Secure. 11 questionnaire paths activated."
      },
      {
        id: "log-2",
        timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000 * 2).toISOString(), // 2 days ago
        userName: "Ramesh Sharma",
        role: "Admin",
        actionType: "Insurer Edited",
        planName: "Care Supreme",
        description: "Updated insurer metadata mapped to Care Health Insurance."
      },
      {
        id: "log-3",
        timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000 * 1.5).toISOString(), // 1.5 days ago
        userName: "Rebecca S",
        role: "Admin",
        actionType: "Draft Created",
        planName: "Activ One Safeguard [DRAFT]",
        description: "Initiated raw framework setup and declarations indexing for Activ One Safeguard."
      }
    ]
  );

  // Activity Log States
  const [auditSubTab, setAuditSubTab] = useState<"user" | "modification">("user");
  const [historySearch, setHistorySearch] = useState("");
  const [historyActionFilter, setHistoryActionFilter] = useState("All");

  // Master Question tags map (keeps legacy lists compatible but tags them elegantly)
  const [planQuestionsState, setPlanQuestionsState] = useState<Record<string, Array<{ text: string, tag: "Specific" | "Umbrella" | "Catch-all" }>>>((() => {
    // Always re-derive base plan questions from getPlanConfig() as the live source of truth.
    // This prevents stale localStorage data from overriding the correct question lists.
    const base = getPlanConfig();
    const res: Record<string, Array<{ text: string, tag: "Specific" | "Umbrella" | "Catch-all" }>> = {};

    Object.keys(base).forEach(planName => {
      const config = base[planName];
      const combinedQuestions = [...config.questions];
      if (config.hasUmbrella) {
        combinedQuestions.push(...config.umbrellaQuestions);
      }

      res[planName] = combinedQuestions.map(qText => {
        let tag: "Specific" | "Umbrella" | "Catch-all" = "Specific";
        const normQ = qText.toLowerCase().trim();
        const normAnyOther = config.anyOther ? config.anyOther.toLowerCase().trim() : "";
        const normUmbrellas = (config.umbrellaQuestions || []).map(uq => uq.toLowerCase().trim());

        if (normUmbrellas.includes(normQ)) {
          tag = "Umbrella";
        } else if (normQ === normAnyOther) {
          tag = "Catch-all";
        }
        return { text: qText, tag };
      });
    });

    // Restore user-created DRAFT plans from localStorage (not present in base config).
    try {
      const saved = localStorage.getItem("ditto_plan_questions_state");
      if (saved) {
        const parsed = JSON.parse(saved);
        Object.keys(parsed).forEach(planName => {
          if (!base[planName]) {
            res[planName] = parsed[planName];
          }
        });
      }
    } catch (_) {}

    if (!res["Activ One Safeguard [DRAFT]"]) {
      res["Activ One Safeguard [DRAFT]"] = [
        { text: "Are you suffering from any chronic kidney disease?", tag: "Specific" },
        { text: "Have you had any history of organ transplantation?", tag: "Specific" },
        { text: "Any other congenital or endocrine disease?", tag: "Catch-all" }
      ];
    }
    if (!res["Care Elite Protect [DRAFT]"]) {
      res["Care Elite Protect [DRAFT]"] = [
        { text: "Do you have any active psychiatric or nervous disorders?", tag: "Specific" },
        { text: "History of bypass surgeries or major heart ailments?", tag: "Specific" },
        { text: "Any other non-disclosed ailments?", tag: "Catch-all" }
      ];
    }

    return res;
  }));

  useEffect(() => {
    try {
      localStorage.setItem("ditto_plan_questions_state", JSON.stringify(planQuestionsState));
    } catch (_) {}
  }, [planQuestionsState]);

  // Master Simulated Role State
  const [simulatedRole, setSimulatedRole] = usePersistentState<"General" | "Admin" | "Owner" | null>(
    "ditto_simulated_role",
    () => null,
    {
      serialize: (value) => value as string,
      deserialize: (raw) => raw as "General" | "Admin" | "Owner" | null,
      removeWhenFalsy: true,
    }
  );

  let baseUserTier: "General" | "Admin" | "Owner" = "General";
  if (currentUser) {
    if (currentUser.email?.toLowerCase().trim() === "mehruf.p@joinditto.in") {
      baseUserTier = "Owner";
    } else {
      baseUserTier = "General";
    }
  }
  const effectiveTier = simulatedRole || baseUserTier;

  // Dynamic Feature Permissions Governance State
  const [featurePermissions, setFeaturePermissions] = usePersistentState<FeaturePermission[]>(
    "ditto_feature_permissions",
    () => DEFAULT_FEATURE_PERMISSIONS
  );

  // Unified dynamic hasAccess governance function
  const hasAccess = (featureId: string, actionType: "Viewer" | "Editor"): boolean => {
    const tier = effectiveTier;
    if (tier === "Owner") return true;

    const perm = featurePermissions.find(p => p.id === featureId);
    if (!perm) return true; // Default open fallback for unrecognized features

    const level = tier === "Admin" ? perm.adminAccess : perm.generalAccess;
    if (level === "Editor") return true;
    if (level === "Viewer") return actionType === "Viewer";
    return false;
  };

  // Owner Passcode authentication states
  const [ownerPasscode, setOwnerPasscodeState] = useState<string>(() => {
    try {
      const saved = localStorage.getItem("ditto_owner_passcode");
      return saved || "1234"; // Default passcode
    } catch (_) {
      return "1234";
    }
  });

  const setOwnerPasscode = (code: string) => {
    setOwnerPasscodeState(code);
    try {
      localStorage.setItem("ditto_owner_passcode", code);
    } catch (_) {}
  };

  const [isPasscodeModalOpen, setIsPasscodeModalOpen] = useState<boolean>(false);
  const [passcodeAttempt, setPasscodeAttempt] = useState<string>("");
  const [passcodeError, setPasscodeError] = useState<string | null>(null);
  const [onPasscodeSuccess, setOnPasscodeSuccess] = useState<(() => void) | null>(null);
  const [passcodeActionLabel, setPasscodeActionLabel] = useState<string>("");

  const requestOwnerPasscode = (actionDescription: string, onSuccess: () => void) => {
    if (!hasAccess("clear_activity", "Editor")) {
      alert(`Forbidden: Clearance Tier is ${effectiveTier}. This destructive operation requires additional permissions or higher clearance.`);
      return;
    }
    setOnPasscodeSuccess(() => onSuccess);
    setPasscodeAttempt("");
    setPasscodeError(null);
    setPasscodeActionLabel(actionDescription);
    setIsPasscodeModalOpen(true);
  };

  const handleVerifyPasscode = () => {
    if (passcodeAttempt === ownerPasscode) {
      setIsPasscodeModalOpen(false);
      if (onPasscodeSuccess) {
        onPasscodeSuccess();
      }
    } else {
      setPasscodeError("Invalid passport key. Action verification failed.");
    }
  };

  // Derived legacy support for general admin checks
  const currentUserRole = effectiveTier === "Admin" || effectiveTier === "Owner" ? "admin" : "advisor";

  // Real-time toggler cycles between: General -> Admin -> Owner
  const toggleUserRole = () => {
    if (!currentUser) return;
    let nextTier: "General" | "Admin" | "Owner" = "General";
    if (currentUser.tier === "General") nextTier = "Admin";
    else if (currentUser.tier === "Admin") nextTier = "Owner";
    else if (currentUser.tier === "Owner") nextTier = "General";

    const updatedUser = { ...currentUser, tier: nextTier };
    setCurrentUser(updatedUser);
    // Sync list
    setUsersList(prev => prev.map(u => u.email === currentUser.email ? { ...u, tier: nextTier } : u));
  };

  // Plan Configurations dynamically expanded with promoted and draft plans!
  const planConfigs = useMemo(() => {
    const base = getPlanConfig();
    
    // Merge all production plans (including base and promoted ones) using latest planQuestionsState
    productionPlans.forEach(name => {
      const qState = planQuestionsState[name];
      if (qState) {
        const specifics = qState.filter(q => q.tag === "Specific").map(q => q.text);
        const umbrellas = qState.filter(q => q.tag === "Umbrella").map(q => q.text);
        const catchAllOpt = qState.find(q => q.tag === "Catch-all")?.text || "Other Medical Conditions";

        const categoryMap: Record<string, string | number> = {};
        const categoriesList = [
          { key: "diabetes", regex: /diabet|sugar|glucose/i },
          { key: "hypertension", regex: /hyperten|blood pressure\b|bp high|bp\s+high/i },
          { key: "lipid", regex: /lipid|cholesterol|triglyceride/i },
          { key: "respiratory", regex: /asthma|lung|tuberculosis|tb|respiratory|pleura|bronchitis|copd/i },
          { key: "neuro", regex: /stroke|paralysis|epilepsy|fits|seizure|neurolog|brain|spinal cord/i },
          { key: "psychiatric", regex: /psychiatr|mental|depress|anxiety|insomnia/i },
          { key: "digestive", regex: /ulcer|digestive|stomach|intestine|piles|fissure|fistula|appendix/i },
          { key: "liver", regex: /liver|jaundice|gall|hepatitis/i },
          { key: "kidney", regex: /kidney|renal|urinary|prostate|dialysis/i },
          { key: "reproductive", regex: /reproduct|ovarian|uterus|cervix|prostate|pcod|pcod|semen/i },
          { key: "endocrine", regex: /thyroid|endocrine|gland|goiter|pituitary/i },
          { key: "blood", regex: /blood disorder|anaemia|anemia|haemophilia|thalassaemia|genetic/i },
          { key: "skin", regex: /skin|psoriasis|dermatitis|keloid/i },
          { key: "neoplasm", regex: /cancer|tumour|tumor|cyst|polyp|growth/i },
          { key: "autoimmune", regex: /autoimmune|sle|lupus|rheumatoid arthritis/i },
          { key: "ent", regex: /ear|nose|throat|tonsil|sinus/i },
          { key: "eye", regex: /eye|vision|cataract|glaucoma/i }
        ];

        specifics.forEach((qText) => {
          categoriesList.forEach((cat) => {
            if (cat.regex.test(qText)) {
              categoryMap[cat.key] = qText;
            }
          });
        });

        base[name] = {
          ...base[name],
          questions: [...specifics, catchAllOpt],
          anyOther: catchAllOpt,
          hasUmbrella: umbrellas.length > 0,
          umbrellaQuestions: umbrellas,
          categoryMap: base[name]?.categoryMap || categoryMap
        };
      }
    });

    // Merge active draft plans
    draftPlans.forEach(draft => {
      const questionsWithTags = planQuestionsState[draft.name] || draft.questions.map(q => {
        let tag: "Specific" | "Umbrella" | "Catch-all" = "Specific";
        if (q.toLowerCase().includes("other") || q.toLowerCase().includes("any other")) tag = "Catch-all";
        return { text: q, tag };
      });

      const specifics = questionsWithTags.filter(q => q.tag === "Specific").map(q => q.text);
      const umbrellas = questionsWithTags.filter(q => q.tag === "Umbrella").map(q => q.text);
      const catchAllOpt = questionsWithTags.find(q => q.tag === "Catch-all")?.text || "Other Medical Conditions";

      const categoryMap: Record<string, string | number> = {};
      const categoriesList = [
        { key: "diabetes", regex: /diabet|sugar|glucose/i },
        { key: "hypertension", regex: /hyperten|blood pressure\b|bp high|bp\s+high/i },
        { key: "lipid", regex: /lipid|cholesterol|triglyceride/i },
        { key: "respiratory", regex: /asthma|lung|tuberculosis|tb|respiratory|pleura|bronchitis|copd/i },
        { key: "neuro", regex: /stroke|paralysis|epilepsy|fits|seizure|neurolog|brain|spinal cord/i },
        { key: "psychiatric", regex: /psychiatr|mental|depress|anxiety|insomnia/i },
        { key: "digestive", regex: /ulcer|digestive|stomach|intestine|piles|fissure|fistula|appendix/i },
        { key: "liver", regex: /liver|jaundice|gall|hepatitis/i },
        { key: "kidney", regex: /kidney|renal|urinary|prostate|dialysis/i },
        { key: "reproductive", regex: /reproduct|ovarian|uterus|cervix|prostate|pcod|pcod|semen/i },
        { key: "endocrine", regex: /thyroid|endocrine|gland|goiter|pituitary/i },
        { key: "blood", regex: /blood disorder|anaemia|anemia|haemophilia|thalassaemia|genetic/i },
        { key: "skin", regex: /skin|psoriasis|dermatitis|keloid/i },
        { key: "neoplasm", regex: /cancer|tumour|tumor|cyst|polyp|growth/i },
        { key: "autoimmune", regex: /autoimmune|sle|lupus|rheumatoid arthritis/i },
        { key: "ent", regex: /ear|nose|throat|tonsil|sinus/i },
        { key: "eye", regex: /eye|vision|cataract|glaucoma/i }
      ];

      specifics.forEach((qText) => {
        categoriesList.forEach((cat) => {
          if (cat.regex.test(qText)) {
            categoryMap[cat.key] = qText;
          }
        });
      });

      base[draft.name] = {
        questions: [...specifics, catchAllOpt],
        anyOther: catchAllOpt,
        hasUmbrella: umbrellas.length > 0,
        umbrellaQuestions: umbrellas,
        categoryMap
      };
    });
    return base;
  }, [draftPlans, productionPlans, planQuestionsState]);

  const [dictionaryVersion, setDictionaryVersion] = useState<number>(0);

  // Theme support — dark default, toggleable dark mode, persistently saved
  const [theme, setTheme] = usePersistentState<"light" | "dark">(
    "ditto_crm_theme",
    () => "dark",
    {
      serialize: (value) => value,
      deserialize: (raw) => (raw === "light" || raw === "dark" ? raw : "dark"),
    }
  );
  const isDark = theme === "dark";
  const toggleTheme = React.useCallback(() => {
    setTheme(prev => prev === "dark" ? "light" : "dark");
  }, []);
  // Sync dark class on <html> whenever theme changes
  React.useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDark]);

  // First time layout / profile complete flow states
  const [isFirstTimeSetup, setIsFirstTimeSetup] = useState<boolean>(false);
  const [tempSsoEmail, setTempSsoEmail] = useState<string>("");
  const [tempSsoName, setTempSsoName] = useState<string>("");
  const [tempTactId, setTempTactId] = useState<string>("");

  // Verify the real Google session on mount and hydrate currentUser. Tier
  // still comes from the local usersList lookup for now (Google Groups RBAC
  // lands in Phase 4c) — this only replaces the *identity* check (who is
  // this) with the real, server-verified @joinditto.in login.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/session");
        if (!res.ok) return;
        const data = await res.json();
        const identity = data?.user as { email: string; name: string; picture?: string } | null;
        if (!identity || cancelled) return;

        const existingUser = usersList.find(u => u.email.toLowerCase() === identity.email.toLowerCase());
        if (existingUser && existingUser.status === "Active") {
          setCurrentUser({
            email: existingUser.email,
            name: existingUser.name,
            tactId: existingUser.tactId,
            tier: existingUser.tier,
            avatarUrl: identity.picture
          });
          setShowIntro(true);
          setActiveTab("lookup");
        } else {
          setTempSsoEmail(identity.email);
          setTempSsoName(identity.name);
          setTempTactId("");
          setIsFirstTimeSetup(true);
        }
      } catch (_) {
        // Network/parse error reaching the session endpoint: fall back to the login screen.
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    })();
    return () => { cancelled = true; };
    // Runs once on mount only; deliberately reads usersList's initial value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enforce role permission constraints dynamically using active permissions matrix
  useEffect(() => {
    if (currentUser) {
      if (!hasAccess(activeTab, "Viewer")) {
        // Fallback sequentially to ensure user isn't stuck on a forbidden tab
        const priorityTabs = ["lookup", "my_activity", "resources", "audit", "profile_access", "plan_scope", "flagged_responses"] as const;
        const available = priorityTabs.find(tab => hasAccess(tab, "Viewer")) || "lookup";
        setActiveTab(available);
      }
    }
  }, [currentUser, activeTab, featurePermissions, effectiveTier]);

  // Authentication State
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState<boolean>(false);

  // Search History tracking (as requested by user)
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditSearch, setAuditSearch] = useState<string>("");
  const [auditPlanFilter, setAuditPlanFilter] = useState<string>("All");
  const [auditTypeFilter, setAuditTypeFilter] = useState<string>("All");
  const [auditStartDate, setAuditStartDate] = useState<string>("");
  const [auditEndDate, setAuditEndDate] = useState<string>("");

  // (filteredAuditLogs / auditChartData used to be computed here; both moved
  // into src/pages/AuditPage.tsx, Phase 1.3, since they were only ever
  // consumed by the audit tab.)

  // ==========================================
  // VIEW 1: DECLARATION ASSISTANT STATE
  // ==========================================
  const SPECIFIC_ILLNESSES: Record<string, Array<{ category?: string; illness: string }>> = {
    "Activ Fit Preferred": [
      { category: "Eye", illness: "Cataract" },
      { category: "Eye", illness: "Glaucoma" },
      { category: "Eye", illness: "Refractive Error Correction" },
      { category: "Ear Nose Throat", illness: "Sinusitis" },
      { category: "Ear Nose Throat", illness: "Rhinitis" },
      { category: "Ear Nose Throat", illness: "Tonsillitis & Adenitis" },
      { category: "Ear Nose Throat", illness: "Tympanitis & Non Traumatic Perforation" },
      { category: "Ear Nose Throat", illness: "Deviated Nasal Septum" },
      { category: "Ear Nose Throat", illness: "Otitis Media" },
      { category: "Ear Nose Throat", illness: "Adenoiditis" },
      { category: "Ear Nose Throat", illness: "Mastoiditis" },
      { category: "Ear Nose Throat", illness: "Cholesteatoma" },
      { category: "Gynecology", illness: "All Cysts, Mass, Swelling, Lump, Granulomas, Polyps, Fibroids & Benign Tumour of the female genito urinary system" },
      { category: "Gynecology", illness: "Polycystic Ovarian Disease" },
      { category: "Gynecology", illness: "Uterine Prolapse" },
      { category: "Gynecology", illness: "Fibroids (Fibromyoma)" },
      { category: "Gynecology", illness: "Breast lumps (excluding Malignant)" },
      { category: "Gynecology", illness: "Dysfunctional Uterine Bleeding (DUB)" },
      { category: "Gynecology", illness: "Endometriosis" },
      { category: "Gynecology", illness: "Menorrhagia" },
      { category: "Gynecology", illness: "Pelvic Inflammatory Disease" },
      { category: "Orthopedic / Rheumatological", illness: "Gout" },
      { category: "Orthopedic / Rheumatological", illness: "Rheumatism, Rheumatoid Arthritis" },
      { category: "Orthopedic / Rheumatological", illness: "Non infective arthritis" },
      { category: "Orthopedic / Rheumatological", illness: "Osteoarthritis" },
      { category: "Orthopedic / Rheumatological", illness: "Osteoporosis" },
      { category: "Orthopedic / Rheumatological", illness: "Prolapse of the intervertebral disc" },
      { category: "Orthopedic / Rheumatological", illness: "Spondilosis, Spondioarthritis, Spondylopathies" },
      { category: "Orthopedic / Rheumatological", illness: "Ankylosing Spondilitis / Spondylopathies" },
      { category: "Orthopedic / Rheumatological", illness: "Psoriatic Arthritis / Arthropathy" },
      { category: "Orthopedic / Rheumatological", illness: "Internal Derangement of Knee / Ligament or Tendon or Meniscus" },
      { category: "Orthopedic / Rheumatological", illness: "Joint Replacement Surgery" },
      { category: "Orthopedic / Rheumatological", illness: "Non Specific Arthritis" },
      { category: "Gastroenterology", illness: "Stone in Gall Bladder, Bile duct & other parts of Biliary System" },
      { category: "Gastroenterology", illness: "Cholecystitis" },
      { category: "Gastroenterology", illness: "Pancreatitis" },
      { category: "Gastroenterology", illness: "Fissure, Fistula in ano, hemorrhoids (piles), Pilonidal Sinus, Ano-rectal & Perianal Abscess" },
      { category: "Gastroenterology", illness: "Rectal Prolapse" },
      { category: "Gastroenterology", illness: "Gastric or Duodenal Erosions or Ulcers + Gastritis & Duodenitis & Colitis" },
      { category: "Gastroenterology", illness: "Gastro Esophageal Reflux Disease (GERD)" },
      { category: "Gastroenterology", illness: "Cirrhosis" },
      { category: "Gastroenterology", illness: "Chronic Appendicitis" },
      { category: "Gastroenterology", illness: "Appendicular lump, Appendicular abscess" },
      { category: "Urogenital", illness: "Stones in Urinary system (Stone in the Kidney, Ureter, Urinary Bladder)" },
      { category: "Urogenital", illness: "Benign Hypertrophy / Enlargement of Prostate (BHP / BEP)" },
      { category: "Urogenital", illness: "Hernia, Hydrocele" },
      { category: "Urogenital", illness: "Varicocoele / Spermatocoele" },
      { category: "Skin", illness: "Skin tumour (unless malignant)" },
      { category: "Skin", illness: "All skin diseases" },
      { category: "General Surgery", illness: "Any swelling, tumour, cyst, nodule, ulcer, polyp Mass , Swelling, Lump, Granulomas, Benign Tumour anywhere in the body (unless malignant)" },
      { category: "General Surgery", illness: "Varicose veins, Varicose ulcers" }
    ],
    "Optima Secure": [
      { category: "Gastrointestinal", illness: "Pancreatitis" },
      { category: "Gastrointestinal", illness: "Diseases of gall bladder including cholecystitis" },
      { category: "Gastrointestinal", illness: "All forms of Cirrhosis" },
      { category: "Gastrointestinal", illness: "Perineal Abscesses" },
      { category: "Gastrointestinal", illness: "Cholecystectomy" },
      { category: "Gastrointestinal", illness: "Gastro Esophageal Reflux Disorder (GERD)" },
      { category: "Gastrointestinal", illness: "Perianal Abscesses" },
      { category: "Gastrointestinal", illness: "Ulcer and erosion of stomach and duodenum" },
      { category: "Gastrointestinal", illness: "Fissure/fistula in anus, Haemorrhoids including Gout and rheumatism" },
      { category: "Gastrointestinal", illness: "Rectal Prolapse" },
      { category: "Eye", illness: "Cataract and other disorders of lens and Retina" },
      { category: "Eye", illness: "Retinal detachment" },
      { category: "Eye", illness: "Glaucoma" },
      { category: "Orthopedic & Joints", illness: "Osteoarthritis and osteoporosis" },
      { category: "Orthopedic & Joints", illness: "Joint replacement surgeries" },
      { category: "Orthopedic & Joints", illness: "Ligament, Tendon and Meniscal tear" },
      { category: "Orthopedic & Joints", illness: "Non infective Arthritis" },
      { category: "Orthopedic & Joints", illness: "Surgery for prolapsed inter vertebral disc" },
      { category: "Gynecology & Gyne-Surgery", illness: "Fibroids (fibromyoma)" },
      { category: "Gynecology & Gyne-Surgery", illness: "Prolapsed Uterus" },
      { category: "Gynecology & Gyne-Surgery", illness: "Endometriosis" },
      { category: "Gynecology & Gyne-Surgery", illness: "Polycystic ovarian diseases" },
      { category: "Gynecology & Gyne-Surgery", illness: "Dilatation and curettage (D&C)" },
      { category: "Gynecology & Gyne-Surgery", illness: "Myomectomy for fibroids" },
      { category: "Gynecology & Gyne-Surgery", illness: "Hysterectomy" },
      { category: "Ear Nose Throat (ENT)", illness: "Tympanoplasty, Mastoidectomy" },
      { category: "Ear Nose Throat (ENT)", illness: "Nasal concha resection" },
      { category: "Ear Nose Throat (ENT)", illness: "Sinusitis, Rhinitis" },
      { category: "Ear Nose Throat (ENT)", illness: "Tonsillitis" },
      { category: "Ear Nose Throat (ENT)", illness: "Adenoidectomy, tonsillectomy" },
      { category: "Ear Nose Throat (ENT)", illness: "Nasal polypectomy" },
      { category: "Ear Nose Throat (ENT)", illness: "Surgery for Nasal septum deviation" },
      { category: "Urogenital (Urinary & Prostate)", illness: "Surgery of Genito urinary system unless necessitated by Malignancy" },
      { category: "Urogenital (Urinary & Prostate)", illness: "Surgery on prostate" },
      { category: "Urogenital (Urinary & Prostate)", illness: "Benign Hyperplasia of Prostate" },
      { category: "Urogenital (Urinary & Prostate)", illness: "Hernia" },
      { category: "Urogenital (Urinary & Prostate)", illness: "Calculus diseases of Urogenital system e.g. Kidneystone, Urinary Bladder Stone" },
      { category: "Urogenital (Urinary & Prostate)", illness: "Hydrocele/Rectocele" },
      { category: "Urogenital (Urinary & Prostate)", illness: "Varicocele" },
      { category: "Vascular & Skin", illness: "Surgery for varicose veins and varicose ulcers" },
      { category: "Vascular & Skin", illness: "Skin tumors" },
      { category: "Vascular & Skin", illness: "Pilonidal sinus" },
      { category: "Vascular & Skin", illness: "Benign tumors, cysts, nodules, polyps including breast lumps" },
      { category: "Vascular & Skin", illness: "Surgery for Perianal Abscesses" },
      { category: "Vascular & Skin", illness: "Fissurectomy, Haemorrhoidectomy, Fistulectomy, ENT surgeries" }
    ],
    "Care Supreme": [
      { category: "Orthopedic", illness: "Arthritis (if non-infective)" },
      { category: "Orthopedic", illness: "Rheumatism" },
      { category: "Orthopedic", illness: "Arthroscopic Knee Surgeries/ ACL Reconstruction/ Meniscal and Ligament Repair" },
      { category: "Orthopedic", illness: "Osteoarthritis and Osteoporosis" },
      { category: "Orthopedic", illness: "Spinal Disorders" },
      { category: "Orthopedic", illness: "Joint Replacement Surgery" },
      { category: "Urogenital & Hernia", illness: "Benign Prostatic Hypertrophy" },
      { category: "Urogenital & Hernia", illness: "Surgery of Genito-urinary system unless necessitated by malignancy" },
      { category: "Urogenital & Hernia", illness: "All types of Hernia & Hydrocele" },
      { category: "Urogenital & Hernia", illness: "Kidney Stone/ Ureteric Stone/ Lithotripsy/ Gall Bladder Stone" },
      { category: "Ear Nose Throat (ENT)", illness: "Nasal Septum Deviation, Sinusitis and realted disorders" },
      { category: "Ear Nose Throat (ENT)", illness: "Surgical treatments for Benign ear, nose and throat (ENT) disorders and surgeries (including but not limited to Adenoidectomy, Mastoidectomy, Tonsillectomy and Tympanoplasty)" },
      { category: "Tumours & Skin", illness: "Internal tumours, skin tumours, cysts, nodules, polyps including breast lumps (each of any kind) unless malignant" },
      { category: "Eye", illness: "Cataract" },
      { category: "Gastrointestinal", illness: "Fissure/Fistula in anus, Hemorrhoids/ Piles, Pilonidal Sinus, Gastric and Duodenal Ulcers" },
      { category: "Gastrointestinal", illness: "Varicose veins and varicose ulcers" },
      { category: "Neurology", illness: "Parkinson's or Alzheimer's disease or Dimentia" },
      { category: "Neurology", illness: "Gout" },
      { category: "Gynecology & Gyne-Surgery", illness: "Diatation and Curettage" },
      { category: "Gynecology & Gyne-Surgery", illness: "Hysterectomy for menorrhagia or Fibromyoma or prolapse of uterus unless necessitated by malignancy" },
      { category: "Gynecology & Gyne-Surgery", illness: "Myomectomy for fibroids" }
    ],
    "Activ One Max": [
      { category: "Eye", illness: "Cataract" },
      { category: "Eye", illness: "Glaucoma" },
      { category: "Eye", illness: "Refractive Error Correction" },
      { category: "Ear Nose Throat", illness: "Sinusitis" },
      { category: "Ear Nose Throat", illness: "Rhinitis" },
      { category: "Ear Nose Throat", illness: "Tonsillitis & Adenitis" },
      { category: "Ear Nose Throat", illness: "Tympanitis & Non Traumatic Perforation" },
      { category: "Ear Nose Throat", illness: "Deviated Nasal Septum" },
      { category: "Ear Nose Throat", illness: "Otitis Media" },
      { category: "Ear Nose Throat", illness: "Adenoiditis" },
      { category: "Ear Nose Throat", illness: "Mastoiditis" },
      { category: "Ear Nose Throat", illness: "Cholesteatoma" },
      { category: "Gynecology", illness: "All Cysts, Mass, Swelling, Lump, Granulomas, Polyps, Fibroids & Benign Tumour of the female genito urinary system" },
      { category: "Gynecology", illness: "Polycystic Ovarian Disease" },
      { category: "Gynecology", illness: "Uterine Prolapse" },
      { category: "Gynecology", illness: "Fibroids (Fibromyoma)" },
      { category: "Gynecology", illness: "Breast lumps (excluding Malignant)" },
      { category: "Gynecology", illness: "Dysfunctional Uterine Bleeding (DUB)" },
      { category: "Gynecology", illness: "Endometriosis" },
      { category: "Gynecology", illness: "Menorrhagia" },
      { category: "Gynecology", illness: "Pelvic Inflammatory Disease" },
      { category: "Orthopedic / Rheumatological", illness: "Gout" },
      { category: "Orthopedic / Rheumatological", illness: "Rheumatism, Rheumatoid Arthritis" },
      { category: "Orthopedic / Rheumatological", illness: "Non infective arthritis" },
      { category: "Orthopedic / Rheumatological", illness: "Osteoarthritis" },
      { category: "Orthopedic / Rheumatological", illness: "Osteoporosis" },
      { category: "Orthopedic / Rheumatological", illness: "Prolapse of the intervertebral disc" },
      { category: "Orthopedic / Rheumatological", illness: "Spondilosis, Spondioarthritis, Spondylopathies" },
      { category: "Orthopedic / Rheumatological", illness: "Ankylosing Spondilitis / Spondylopathies" },
      { category: "Orthopedic / Rheumatological", illness: "Psoriatic Arthritis / Arthropathy" },
      { category: "Orthopedic / Rheumatological", illness: "Internal Derangement of Knee / Ligament or Tendon / Meniscus Tear" },
      { category: "Orthopedic / Rheumatological", illness: "Joint Replacement Surgery" },
      { category: "Orthopedic / Rheumatological", illness: "Non Specific Arthritis" },
      { category: "Gastroenterology", illness: "Stone in Gall Bladder, Bile duct & other parts of Biliary System" },
      { category: "Gastroenterology", illness: "Cholecystitis" },
      { category: "Gastroenterology", illness: "Pancreatitis" },
      { category: "Gastroenterology", illness: "Fissure, Fistula in Ano, Hemorrhoids (Piles), Pilonidal Sinus, Ano-rectal & Perianal Abscess" },
      { category: "Gastroenterology", illness: "Rectal Prolapse" },
      { category: "Gastroenterology", illness: "Gastric or Duodenal Erosions or Ulcers + Gastritis & Duodenitis & Colitis" },
      { category: "Gastroenterology", illness: "Gastro Esophageal Reflux Disease (GERD)" },
      { category: "Gastroenterology", illness: "Cirrhosis" },
      { category: "Gastroenterology", illness: "Chronic Appendicitis" },
      { category: "Gastroenterology", illness: "Appendicular Lump, Appendicular Abscess" },
      { category: "Urogenital", illness: "Stones in Urinary System (Stone in the Kidney, Ureter, Urinary Bladder)" },
      { category: "Urogenital", illness: "Benign Hypertrophy / Enlargement of Prostate (BHP / BEP)" },
      { category: "Urogenital", illness: "Hernia, Hydrocele" },
      { category: "Urogenital", illness: "Varicocoele / Spermatocoele" },
      { category: "Skin & General", illness: "Skin Tumour (unless malignant)" },
      { category: "Skin & General", illness: "All Skin Diseases" },
      { category: "Skin & General", illness: "Any Swelling, Tumour, Cyst, Nodule, Ulcer, Polyp Mass, Swelling, Lump, Granulomas, Benign Tumour anywhere in the body (Unless Malignant)" },
      { category: "Skin & General", illness: "Varicose Veins, Varicose Ulcers" }
    ]
  };

  const checkIllnessInPlanSpecificList = (pedText: string, plan: string) => {
    if (!plan) return null;
    const matches = matchSpecificIllness(pedText);
    const normalized = normalizePlanName(plan);
    const match = matches.find(m => m.match_type !== "no_match" && m.plans_applicable.includes(normalized));
    if (match) {
      // Find the master illness definition to get the category
      const targetDef = MASTER_ILLNESSES.find(mi => mi.parent_illness === match.matched_listed_illness);
      return {
        category: targetDef ? targetDef.category : "General",
        illness: match.matched_listed_illness || "Specific Illness"
      };
    }
    return null;
  };

  const [selectedPlan, setSelectedPlan] = useState<string>("");
  const [illnessSearchQuery, setIllnessSearchQuery] = useState<string>("");
  const [pedInput, setPedInput] = useState<string>("");
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState<number>(-1);
  const [dynamicSuggestions, setDynamicSuggestions] = useState<string[]>(() => {
    // Categories that exist in TOP_PED_DICTIONARY purely so the deterministic
    // engine can special-case them (see engine.ts categoryKey handling for
    // "lifestyle" / "natural_life_stage") — they are habits or administrative
    // "no disease" entries, not PEDs, so they should never show up as
    // selectable suggestions even though they must stay in the dictionary
    // for classification to keep working.
    const NON_SUGGESTIBLE_CATEGORIES = new Set(["lifestyle", "natural_life_stage"]);

    // A handful of terms that are pure alternate spellings of one single
    // clinical word (not distinct colloquial phrasings worth keeping, unlike
    // e.g. "high bp" vs "hypertension" vs "hyperlipidimia" which are genuinely
    // different ways an advisor might search and stay in the list). Only the
    // single canonical spelling is kept in the dropdown; the dictionary
    // entries for the others are untouched so the engine still matches them
    // if an advisor types the variant spelling directly.
    const SUGGESTION_EXCLUSIONS = new Set([
      "gynaecomastia",
      "gynocomastia",
      "gyneacomastia",
    ]);

    const pedDictionarySuggestible = Object.entries(TOP_PED_DICTIONARY)
      .filter(([, category]) => !NON_SUGGESTIBLE_CATEGORIES.has(category))
      .map(([term]) => term);

    const combined = [
      ...SCRIPT_DICTIONARY,
      ...pedDictionarySuggestible,
      "dvt",
      "deep vein thrombosis",
      "pulmonary embolism",
      "thromboembolism",
      "gangrene",
      "essential tremor",
      "bell's palsy",
      "trigeminal neuralgia",
      "rheumatoid arthritis",
      "ankylosing spondylitis",
      "sarcoidosis",
      "carpal tunnel",
      "plantar fasciitis"
    ];

    // Case-insensitive de-dupe (first occurrence wins) — this is what
    // collapses things like "COPD" (scriptDictionary.ts) and "copd"
    // (TOP_PED_DICTIONARY) down to a single entry, before case-correction
    // below decides the final display form.
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const raw of combined) {
      const item = raw.trim();
      if (!item) continue;
      const key = item.toLowerCase();
      if (seen.has(key) || SUGGESTION_EXCLUSIONS.has(key)) continue;
      seen.add(key);
      deduped.push(item);
    }

    // A handful of terms whose punctuation/format doesn't fit clean word-by-word
    // capitalization — corrected as exact overrides rather than parsed.
    const EXACT_OVERRIDES: Record<string, string> = {
      "covid.19": "COVID-19",
    };

    // Standard medical acronyms/abbreviations that should always render in
    // full capitals (or their conventional mixed case) no matter where they
    // fall in the term — this is what turns "pcod" / "cad" into "PCOD" / "CAD".
    const ACRONYM_MAP: Record<string, string> = {
      gdm: "GDM", pcl: "PCL", lscs: "LSCS", tkr: "TKR", thr: "THR", cmv: "CMV",
      mvp: "MVP", chf: "CHF", afib: "AFib", vt: "VT", vf: "VF", sss: "SSS",
      av: "AV", lbbb: "LBBB", rbbb: "RBBB", hcm: "HCM", mi: "MI", cad: "CAD",
      ihd: "IHD", cabg: "CABG", ptca: "PTCA", icd: "ICD", rhd: "RHD",
      copd: "COPD", ild: "ILD", osa: "OSA", cva: "CVA", tia: "TIA", ms: "MS",
      mnd: "MND", gbs: "GBS", gad: "GAD", ocd: "OCD", adhd: "ADHD",
      ptsd: "PTSD", ibs: "IBS", ibd: "IBD", gerd: "GERD", gord: "GORD",
      apd: "APD", ckd: "CKD", esrd: "ESRD", uti: "UTI", aki: "AKI",
      bph: "BPH", pcos: "PCOS", pcod: "PCOD", ivf: "IVF", ra: "RA",
      avn: "AVN", cah: "CAH", siadh: "SIADH", hcc: "HCC", rcc: "RCC",
      nsclc: "NSCLC", dcis: "DCIS", lcis: "LCIS", cml: "CML", cll: "CLL",
      aml: "AML", all: "ALL", nhl: "NHL", dns: "DNS", sob: "SOB",
      tsh: "TSH", hb: "Hb", gbm: "GBM", asd: "ASD", vsd: "VSD",
      g6pd: "G6PD", dka: "DKA", niddm: "NIDDM", iddm: "IDDM", igt: "IGT",
      ifg: "IFG", hba1c: "HbA1c", tmt: "TMT", pih: "PIH", dvt: "DVT",
      std: "STD", hpv: "HPV", hiv: "HIV", aids: "AIDS", mctd: "MCTD",
      sma: "SMA", "h.": "H.",
    };

    // Named ("eponymous") conditions — capitalized regardless of position in
    // the phrase, since these are proper nouns (e.g. "non hodgkin lymphoma").
    // Note: eponyms that are always the first word of their term (Parkinson's,
    // Alzheimer's, Cushing's, Raynaud, Marfan, etc.) don't need an entry here —
    // the sentence-case rule below already capitalizes the first word.
    const EPONYM_MAP: Record<string, string> = {
      hodgkin: "Hodgkin", barre: "Barre", marie: "Marie", tooth: "Tooth",
      danlos: "Danlos", willebrand: "Willebrand",
    };

    const toDisplayCase = (term: string): string => {
      const lowerWhole = term.toLowerCase();
      if (EXACT_OVERRIDES[lowerWhole]) return EXACT_OVERRIDES[lowerWhole];

      return term
        .split(" ")
        .map((word, idx) => {
          if (!word) return word;
          const lower = word.toLowerCase();
          const bare = lower.replace(/[^a-z0-9']/g, "");
          if (ACRONYM_MAP[lower]) return ACRONYM_MAP[lower];
          if (ACRONYM_MAP[bare]) return ACRONYM_MAP[bare];
          if (EPONYM_MAP[lower]) return EPONYM_MAP[lower];
          if (idx === 0) return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
          return word.toLowerCase();
        })
        .join(" ");
    };

    // Final safety pass: case-correction can occasionally make two distinct
    // source strings converge on the same display text — de-dupe once more.
    const finalSeen = new Set<string>();
    const final: string[] = [];
    for (const item of deduped.map(toDisplayCase)) {
      const key = item.toLowerCase();
      if (finalSeen.has(key)) continue;
      finalSeen.add(key);
      final.push(item);
    }
    return final.sort();
  });
  const [mappingUpdateStatus, setMappingUpdateStatus] = useState<Record<string, { status: "idle" | "loading" | "success" | "error"; error?: string }>>({});
  const [userAdvisoryToggle, setUserAdvisoryToggle] = useState<boolean | null>(null);
  const [advisoryHasBeenExpanded, setAdvisoryHasBeenExpanded] = useState<boolean>(false);
  const [resultsFocusMode, setResultsFocusMode] = useState<boolean>(false);

  const [lookupPeds, setLookupPeds] = useState<string[]>([]);
  const [lookupResults, setLookupResults] = useState<Array<{
    ped: string;
    result: MatchOutput;
    source: string;
  }>>([]);
  const [isLookupLoading, setIsLookupLoading] = useState<boolean>(false);
  const isResultsActive = (resultsFocusMode && lookupResults.length > 0) || isLookupLoading;
  const [copiedPedMap, setCopiedPedMap] = useState<Record<string, boolean>>({});


  // Reported Mismatch Issues States
  const [reportedIssues, setReportedIssues] = usePersistentState<ReportedIssue[]>(
    "ditto_reported_issues",
    () => [
      {
        id: "seed-1",
        timestamp: new Date(Date.now() - 3600000 * 4).toISOString(),
        userEmail: "shashank@joinditto.in",
        userName: "Shashank J",
        userTactId: "TACT-102",
        planName: "Optima Secure",
        pedInput: "gdm during previous pregnancy",
        matchedQuestion: "Is the proposed relationship a biological mother, or have you had any complications during delivery?",
        matchType: "P1",
        source: "Insurers Policy Wording Handbook",
        explanation: "Since GDM (Gestational Diabetes Mellitus) represents pregnancy complications, advisor needs to declare it against the delivery complications question.",
        issueNotes: "This should map to the specific endocrine/maternal diabetes clause under Section D rather than Delivery complications, because GDM is assessed for 48 months under HDFC Ergo internal underwriters guidelines.",
        status: "Urgent"
      }
    ]
  );

  const [reportingItem, setReportingItem] = useState<{
    planName: string;
    pedInput: string;
    mappedQuestion: string;
    matchType: string;
    source: string;
    explanation: string;
  } | null>(null);

  const [reportingNotes, setReportingNotes] = useState<string>("");
  const [reportedIssuesFilter, setReportedIssuesFilter] = useState<string>("All Open"); // All Open, Pending, Urgent, Resolved, Ignored, All
  const [ownerResolutionNotes, setOwnerResolutionNotes] = useState<Record<string, string>>({});
  
  // Custom non-blocking confirmation states to avoid iframe-blocked confirm Window dialogs
  const [deletingAnnouncementId, setDeletingAnnouncementId] = useState<string | null>(null);
  const [editingAnnouncementId, setEditingAnnouncementId] = useState<string | null>(null);
  const [confirmingResetDefaults, setConfirmingResetDefaults] = useState<boolean>(false);

  const resultsRef = useRef<HTMLDivElement>(null);
  const mappingResultCardRef = useRef<HTMLDivElement>(null);
  const rightHeaderRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const pedInputRef = useRef<HTMLInputElement>(null);

  // (Persistence for `theme` is handled by the usePersistentState hook above;
  // the <html> "dark" class is kept in sync by the effect near isDark's
  // declaration, so this used to be a duplicate of both.)

  // Load Search logs
  useEffect(() => {
    try {
      const savedLogs = localStorage.getItem("ditto_ped_search_history");
      if (savedLogs) {
        setAuditLogs(JSON.parse(savedLogs));
      }
    } catch (_) {}
  }, []);

  const saveAuditLog = (ped: string, plan: string, result: MatchOutput, source: string) => {
    const newEntry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      userEmail: currentUser?.email || "advisor@joinditto.in",
      planName: plan,
      pedInput: ped,
      matchedQuestion: result.matched_question,
      matchType: result.match_type,
      source: source || "Deterministic Engine",
      explanation: result.explanation
    };

    setAuditLogs(prev => {
      const updated = [newEntry, ...prev].slice(0, 400); // Limit to 400 records
      try {
        localStorage.setItem("ditto_ped_search_history", JSON.stringify(updated));
      } catch (_) {}
      return updated;
    });
  };

  const handleClearAuditHistory = () => {
    requestOwnerPasscode("Clear all activity audit logs permanently", () => {
      setAuditLogs([]);
      try {
        localStorage.removeItem("ditto_ped_search_history");
      } catch (_) {}
    });
  };

  const ALL_CATEGORIES = [
    { key: "diabetes", label: "Diabetes & Metabolic" },
    { key: "hypertension", label: "Hypertension / High BP" },
    { key: "lipid", label: "Cholesterol / Lipid" },
    { key: "respiratory", label: "Asthma / Respiratory" },
    { key: "neuro", label: "Neurological Diseases" },
    { key: "psychiatric", label: "Psychiatric / Mental" },
    { key: "digestive", label: "Digestive / Gastrointestinal" },
    { key: "liver", label: "Liver & Gall Bladder" },
    { key: "endocrine", label: "Thyroid & Endocrine" },
    { key: "kidney", label: "Kidney / Renal" },
    { key: "reproductive", label: "Reproductive Organs" },
    { key: "blood", label: "Blood Disorders" },
    { key: "skin", label: "Skin & Dermatology" },
    { key: "neoplasm", label: "Cancer & Growth Tumours" },
    { key: "autoimmune", label: "Autoimmune & Immunity" },
    { key: "ent", label: "ENT (Ear, Nose, Throat)" },
    { key: "eye", label: "Ocular & Eye Disorders" },
    { key: "covid", label: "Covid-19" },
    { key: "genetic", label: "Genetic / Congenital" },
    { key: "musculoskeletal", label: "Musculoskeletal / Joint" },
    { key: "hiv", label: "HIV / AIDS / STD" },
    { key: "acute_infection", label: "Acute Infections & Fever" },
    { key: "acute_trauma", label: "Acute Trauma & Cuts" },
    { key: "ambiguous_symptom", label: "Ambiguous Subjective Symptoms" },
    { key: "lifestyle", label: "Habits (Smoking / Drinking)" },
    { key: "natural_life_stage", label: "Natural Stage (Pregnancy, General Checkups)" }
  ];

  const findCategoryForQuestion = (plan: string, matchedQuestion: string): string => {
    const config = planConfigs[plan];
    if (!config || !config.categoryMap) return "ambiguous_symptom";
    
    for (const [cat, qText] of Object.entries(config.categoryMap)) {
      if (typeof qText === "string" && qText === matchedQuestion) {
        return cat;
      }
      if (typeof qText === "number" && config.questions[qText] === matchedQuestion) {
        return cat;
      }
    }
    return "ambiguous_symptom";
  };

  const handlePersistMapping = async (ped: string, category: string) => {
    const pedClean = ped.trim();
    if (!pedClean || !category) return;

    setMappingUpdateStatus(prev => ({
      ...prev,
      [pedClean]: { status: "loading" }
    }));

    try {
      const response = await fetch("/api/add-ped-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ped: pedClean, category })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to commit mapping to codebase");
      }

      // Write directly to live in-memory deterministic index in the client session
      const pedLower = pedClean.toLowerCase().replace(/[^\w\s]/g, "").trim();
      TOP_PED_DICTIONARY[pedLower] = category;
      setDictionaryVersion(prev => prev + 1);

      setMappingUpdateStatus(prev => ({
        ...prev,
        [pedClean]: { status: "success" }
      }));
    } catch (err: unknown) {
      console.error("Failed to commit mapping: ", err);
      const message = err instanceof Error ? err.message : "Codebase persistence failure";
      setMappingUpdateStatus(prev => ({
        ...prev,
        [pedClean]: { status: "error", error: message }
      }));
    }
  };

  // Synchronize dynamic backgrounds for plans to look elegant in Light/Dark
  const getPlanTheme = (plan: string) => {
    switch (plan) {
      case "Optima Secure":
        return { 
          bgClass: "bg-red-50 text-red-800 border-red-300 dark:bg-rose-950/20 dark:text-rose-300 dark:border-rose-900",
          badgeClass: "bg-red-500 text-white",
          borderHex: "#F43F5E"
        };
      case "Care Supreme":
        return { 
          bgClass: "bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/20 dark:text-amber-300 dark:border-amber-900",
          badgeClass: "bg-amber-500 text-amber-950 font-bold",
          borderHex: "#D97706"
        };
      case "Activ One Max":
      case "Activ Fit Preferred":
        return { 
          bgClass: "bg-blue-50 text-[#117FDA] border-blue-100 dark:bg-blue-950/20 dark:text-sky-350 dark:border-blue-900/45",
          badgeClass: "bg-[#117FDA] text-white",
          borderHex: "#117FDA"
        };
      default:
        return { 
          bgClass: "bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/20 dark:text-emerald-300 dark:border-emerald-900",
          badgeClass: "bg-emerald-600 text-white",
          borderHex: "#059669"
        };
    }
  };

  // Redirects to the real, server-side Google OAuth flow (src/server/auth/).
  // Domain restriction to @joinditto.in is enforced server-side on the
  // callback -- this client only kicks off the redirect.
  const handleGoogleSSO = () => {
    setLoginError(null);
    window.location.href = "/api/auth/google/login";
  };

  const handleProfileCompletion = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    const nameClean = tempSsoName.trim();
    const tactClean = tempTactId.trim();

    if (!nameClean || !tactClean) {
      setLoginError("Full Name and TACT ID are mandatory fields to active your portal account.");
      return;
    }

    setLoginLoading(true);

    // Identity (email/name) is already server-verified via the real Google
    // session; this only records the internal TACT ID and (for now) assigns
    // tier from the local usersList lookup -- Google Groups RBAC replaces
    // this tier assignment in Phase 4c.
    const existingUser = usersList.find(u => u.email.toLowerCase() === tempSsoEmail.toLowerCase());
    const assignedTier = existingUser ? existingUser.tier : "General";

    const newUserProfile: UserProfile = {
      email: tempSsoEmail.toLowerCase().trim(),
      name: nameClean,
      tactId: tactClean,
      tier: assignedTier,
      status: "Active"
    };

    setUsersList(prev => {
      // Exclude previous pending records
      const filtered = prev.filter(u => u.email.toLowerCase() !== tempSsoEmail.toLowerCase());
      return [...filtered, newUserProfile];
    });

    const sessionUser: LoggedUser = {
      email: tempSsoEmail.toLowerCase().trim(),
      name: nameClean,
      tactId: tactClean,
      tier: assignedTier
    };

    setCurrentUser(sessionUser);
    setShowIntro(true);
    setActiveTab("lookup");

    // Clear setup
    setIsFirstTimeSetup(false);
    setTempSsoEmail("");
    setTempSsoName("");
    setTempTactId("");
    setLoginLoading(false);
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setShowIntro(true);
    // Clear the real server session cookie too. Fire-and-forget: even if
    // this fails, the client-side state is already cleared.
    fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  };

  // Daily 12 AM auto-logout — schedules a timeout to fire at the next midnight
  useEffect(() => {
    const scheduleNextMidnightReset = () => {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      const msUntilMidnight = midnight.getTime() - now.getTime();
      return setTimeout(() => {
        handleLogout();
        scheduleNextMidnightReset();
      }, msUntilMidnight);
    };
    const timerId = scheduleNextMidnightReset();
    return () => clearTimeout(timerId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ==========================================
  // DECLARATION ASSISTANT: MULTI-PED EVALUATION
  // ==========================================
  const executeLookupAll = async (peds: string[], plan: string) => {
    if (peds.length === 0) {
      setLookupResults([]);
      return;
    }
    
    // Set loading
    setIsLookupLoading(true);
    const tempResults: Array<{ ped: string; result: MatchOutput; source: string }> = [];
    const config = planConfigs[plan];

    for (const ped of peds) {
      const trimmedPed = ped.trim();
      if (!trimmedPed) continue;

      // Deterministic classification locally
      const clientMatch = classifyDeterministic(trimmedPed, plan, config);
      if (clientMatch) {
        const sanitized = sanitizeOutput(clientMatch, trimmedPed, config);
        const guarded = applyPostGuards(sanitized, trimmedPed, plan, config);
        const finalRes = finalizeOutput(guarded, trimmedPed, config, config.questions);
        
        tempResults.push({
          ped: trimmedPed,
          result: finalRes,
          source: "Deterministic Underwriting Rule"
        });
        saveAuditLog(trimmedPed, plan, finalRes, "Deterministic Underwriting Rule");
      } else {
        // Fetch from API
        try {
          const response = await fetch("/api/match", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ planName: plan, ped: trimmedPed })
          });
          const data = await response.json();
          tempResults.push({
            ped: trimmedPed,
            result: data,
            source: data.source || "Clinical Guidance System AI"
          });
          saveAuditLog(trimmedPed, plan, data, data.source || "Clinical Guidance System AI");
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          const fallbackResult: MatchOutput = {
            ped_input: trimmedPed,
            match_type: "FALLBACK" as const,
            matched_question: config.anyOther,
            explanation: `Underwriting API offline. System safely routed entry as other conditions: ${message}`
          };
          tempResults.push({
            ped: trimmedPed,
            result: fallbackResult,
            source: "Disaster Recovery Local Rules"
          });
          saveAuditLog(trimmedPed, plan, fallbackResult, "Disaster Recovery Local Rules");
        }
      }
    }

    setLookupResults(tempResults);
    setIsLookupLoading(false);
    setResultsFocusMode(true);
  };

  const handleClearLookupFields = () => {
    setPedInput("");
    setLookupPeds([]);
    setLookupResults([]);
    setResultsFocusMode(false);
    setUserAdvisoryToggle(null);
    setAdvisoryHasBeenExpanded(false);
  };

  const handleMapAnotherPed = () => {
    setPedInput("");
    setResultsFocusMode(false);
    setTimeout(() => {
      const element = document.getElementById("ped-input");
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      setTimeout(() => {
        if (pedInputRef.current) {
          pedInputRef.current.focus();
        }
      }, 200);
    }, 100);
  };

  const handlePreFillDemoData = () => {
    setSelectedPlan("Optima Secure");
    const demoConditions = ["Diabetes Type 2", "Hypertension", "Asthma"];
    setLookupPeds(demoConditions);
    executeLookupAll(demoConditions, "Optima Secure");
  };

  const handleAddLookupPed = (pedText: string) => {
    const trimmed = pedText.trim();
    if (!trimmed) return;
    if (!lookupPeds.includes(trimmed)) {
      setLookupPeds([...lookupPeds, trimmed]);
    }
    setPedInput("");
    
    // Auto refocus inside input field without exiting cursor
    setTimeout(() => {
      if (pedInputRef.current) {
        pedInputRef.current.focus();
      }
    }, 0);
  };

  // Clear lookup results if lookupPeds has no items left
  useEffect(() => {
    if (lookupPeds.length === 0) {
      setLookupResults([]);
    }
  }, [lookupPeds.length]);

  // Automatically scroll the first matched row into view when a match is found
  useEffect(() => {
    if (activeTab === "lookup" && lookupResults.length > 0 && !isLookupLoading) {
      setTimeout(() => {
        const firstMatchedRow = document.querySelector(".matched-question-row");
        if (firstMatchedRow) {
          firstMatchedRow.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }, 150);
    }
  }, [lookupResults, activeTab, isLookupLoading]);

  // CSV Export Utility
  const downloadCSV = (data: Record<string, unknown>[], filename: string) => {
    if (data.length === 0) return;
    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(","),
      ...data.map(row =>
        headers.map(field => {
          let val = row[field];
          if (typeof val === "object") val = JSON.stringify(val);
          return `"${String(val || "").replace(/"/g, '""')}"`;
        }).join(",")
      )
    ].join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Convert stars or simple markdown to clean highlighted spans
  const formatMarkdownText = (text: string) => {
    if (!text) return "";
    const split = text.split(/(\*\*?[^*]+\*\*?)/g);
    return split.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={i} className="font-bold text-stone-900 dark:text-white">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("*") && part.endsWith("*")) {
        return <strong key={i} className="font-bold text-[#117FDA] dark:text-[#60a5fa] bg-blue-500/5 dark:bg-blue-500/10 px-1 rounded">{part.slice(1, -1)}</strong>;
      }
      return part;
    });
  };

  // Verifying the real Google session with the server — avoid flashing the
  // login screen (or the app) before we know the answer.
  if (authChecking) {
    return (
      <div className={`h-screen w-full flex items-center justify-center ${
        isDark ? "bg-[#001322] text-[#F5F7FA]" : "bg-[#F1F6FB] text-stone-900"
      }`}>
        <RefreshCw className={`w-6 h-6 animate-spin ${isDark ? "text-cyan-400" : "text-blue-600"}`} />
      </div>
    );
  }

  // Render Login state if not authenticated
  if (!currentUser) {
    return (
      <div className={`h-screen max-h-screen flex flex-col md:flex-row font-sans relative overflow-hidden w-full transition-all duration-500 ${
        isDark 
          ? "bg-[#001322] text-[#F5F7FA]" 
          : "bg-[#F1F6FB] text-stone-900"
      }`}>
        {/* Modern, Simple, and Futuristic Ambient Background */}
        <div
          className={`absolute inset-0 pointer-events-none z-0 select-none transition-all duration-500 ${
            isDark ? "opacity-90" : "opacity-[0.70]"
          }`}
          style={{
            backgroundImage: isDark
              ? `url("/assets/.aistudio/background-pattern-dark.svg")`
              : `url("/assets/.aistudio/background-pattern-light.svg")`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
          }}
        />

        {/* Optimized grid / texture overlay based on theme to prevent moire and maintain premium feel */}
        <GridTexture theme={theme} />

        {/* LEFT SIDE: Neural Policy Network Graphic & Atmosphere */}
        <div className="hidden md:flex md:w-3/5 relative overflow-hidden bg-transparent p-8 lg:p-12 flex-col justify-between transition-colors duration-500">
          {/* Subtle animated mesh background */}
          <div className="absolute inset-0 z-0 pointer-events-none opacity-85 animate-fade-in">
            <div className={`absolute top-[10%] left-[10%] w-[350px] h-[350px] rounded-full blur-[120px] animate-pulse ${isDark ? "bg-blue-500/6" : "bg-blue-500/10"}`} style={{ animationDuration: "8s" }} />
            <div className={`absolute bottom-[20%] right-[10%] w-[400px] h-[400px] rounded-full blur-[140px] animate-pulse ${isDark ? "bg-blue-400/5" : "bg-blue-400/8"}`} style={{ animationDuration: "12s" }} />
          </div>

          {/* Logo & Brand Header */}
          <div className="z-10 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center p-1.5 shadow-lg shadow-blue-500/15">
              <Sparkles className="w-5 h-5 text-white animate-spin" style={{ animationDuration: "15s" }} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <DittoWordmark className="text-lg" isWhite={isDark} />
              </div>
            </div>
          </div>

          {/* Core Info & Graphic Mesh */}
          <div className="z-10 my-auto max-w-[1000px] space-y-8 relative">
            <div className="space-y-4">
              <div className="flex items-center gap-2 select-none">
                <div className="w-8 h-0.5" style={{ backgroundColor: "var(--accent)" }} />
                <span className="font-black uppercase tracking-widest" style={{ color: "var(--accent)", fontSize: "15px" }}>
                  DECLARATION ENGINE ACTIVE
                </span>
              </div>
              <h1 
                className="font-black tracking-wider leading-[1.0] uppercase select-none font-sans flex flex-col gap-1 text-left"
              >
                <span 
                  className="bg-clip-text text-transparent bg-gradient-to-r"
                  style={{
                    width: "700px",
                    maxWidth: "100%",
                    fontSize: "60px",
                    display: "block",
                    backgroundImage: "var(--gradient-heading)"
                  }}
                >
                  PAYMENT GUIDANCE
                </span>
                <span 
                  className="bg-clip-text text-transparent bg-gradient-to-r"
                  style={{
                    width: "900px",
                    maxWidth: "100%",
                    fontSize: "60px",
                    display: "block",
                    backgroundImage: "var(--gradient-accent)"
                  }}
                >
                  DELIVERED INTELLIGENTLY
                </span>
              </h1>
              <p 
                className={`text-sm font-medium leading-relaxed ${isDark ? "text-slate-300" : "text-stone-600"}`}
                style={{
                  width: "700px",
                  maxWidth: "100%"
                }}
              >
                Enter your customer's PEDs and instantly find where they should be declared, whether they are covered under the plan's specific illness list, and the correct declaration approach when multiple questions seem applicable.
              </p>
            </div>

            {/* Simulated Live Analytics Grid */}
            <div className={`grid grid-cols-4 gap-2 lg:gap-4 pt-4 border-t ${isDark ? "border-slate-800" : "border-stone-300"}`}>
              <div className="space-y-1">
                <span className={`text-[9px] lg:text-xs font-black uppercase tracking-wider block font-mono ${isDark ? "text-slate-400" : "text-stone-500"}`}>Accuracy</span>
                <span className="text-base lg:text-xl font-black font-mono flex items-center gap-1" style={{ color: "var(--accent)" }}>
                  99.94%
                </span>
              </div>
              <div className="space-y-1">
                <span className={`text-[9px] lg:text-xs font-black uppercase tracking-wider block font-mono ${isDark ? "text-slate-400" : "text-stone-500"}`}>Avg Lookup</span>
                <span className="text-base lg:text-xl font-black font-mono" style={{ color: "var(--accent)" }}>
                  &lt;350ms
                </span>
              </div>
              <div className="space-y-1">
                <span className={`text-[9px] lg:text-xs font-black uppercase tracking-wider block font-mono ${isDark ? "text-slate-400" : "text-stone-500"}`}>Plans Covered</span>
                <span className="text-base lg:text-xl font-black font-mono" style={{ color: "var(--accent)" }}>
                  4 Active
                </span>
              </div>
              <div className="space-y-1">
                <span className={`text-[9px] lg:text-xs font-black uppercase tracking-wider block font-mono ${isDark ? "text-slate-400" : "text-stone-500"}`}>Conditions</span>
                <span className="text-base lg:text-xl font-black font-mono" style={{ color: "var(--accent)" }}>
                  900+
                </span>
              </div>
            </div>
          </div>

          {/* Footer of left side */}
          <div className={`z-10 flex items-center justify-between font-bold font-mono uppercase tracking-wider ${isDark ? "text-slate-500" : "text-stone-550"}`} style={{ fontSize: "10px" }}>
            <span>YOUR PAYMENT GUIDE🤖</span>
          </div>
        </div>

        {/* RIGHT SIDE: Authentication Container (Glass Panel) */}
        <div className="flex-1 flex flex-col justify-between p-6 md:p-8 lg:p-10 relative bg-transparent transition-colors duration-500 overflow-y-auto">
          {/* Subtle responsive background blobs for mobile */}
          <div className="md:hidden absolute inset-0 z-0 pointer-events-none opacity-25">
            <div className={`absolute top-1/4 left-1/4 w-80 h-80 rounded-full blur-[100px] ${isDark ? "bg-blue-500/5" : "bg-blue-500/10"}`} />
            <div className={`absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full blur-[100px] ${isDark ? "bg-cyan-500/5" : "bg-sky-500/10"}`} />
          </div>

          {/* Core Navigation Top Bar */}
          <div className="flex items-center justify-end z-10 w-full mb-8">
            {/* Premium Theme Switch Toggle */}
            <button
              onClick={toggleTheme}
              className={`p-2 rounded-xl border transition-all cursor-pointer flex items-center justify-center shadow-sm select-none ${
                isDark 
                  ? "bg-[#03101a]/95 border-white/[0.08] text-slate-250 hover:text-white hover:border-blue-500/40 hover:bg-slate-900/50" 
                  : "bg-white border-stone-200 text-stone-705 hover:bg-stone-50 hover:text-stone-900"
              }`}
              title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {isDark ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-slate-700" />}
            </button>
          </div>

          <div className="my-auto w-full max-w-md mx-auto z-10 py-4">
            <AnimatePresence mode="wait">
              {isFirstTimeSetup ? (
                <motion.div
                  key="first-time-setup"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  className={`rounded-3xl p-8 shadow-xl border flex flex-col gap-6 text-left transition-all duration-300 ${
                    isDark 
                      ? "bg-[#03101a]/95 border-white/[0.08] shadow-black/40 text-slate-100" 
                      : "bg-white border-stone-200 shadow-stone-200/50 text-stone-900"
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center border shadow-sm ${
                        isDark ? "bg-slate-900 border-blue-900/50" : "bg-blue-50 border-blue-200"
                      }`}>
                        <User className={`w-4 h-4 ${isDark ? "text-cyan-400" : "text-blue-600"}`} />
                      </div>
                      <h2 className={`text-sm font-black uppercase tracking-widest font-mono ${isDark ? "text-white" : "text-stone-900"}`}>
                        Create Workforce Profile
                      </h2>
                    </div>
                    <p className={`text-xs leading-relaxed font-semibold pt-1 ${isDark ? "text-slate-300" : "text-stone-600"}`}>
                      First-time workspace verification detected. Complete your profile credentials to construct your permanent security card.
                    </p>
                  </div>

                  <div className={`border rounded-2xl px-4 py-3.5 text-xs tracking-tight flex items-center justify-between font-bold font-mono ${
                    isDark 
                      ? "bg-blue-955/20 border-blue-900/40 text-blue-300" 
                      : "bg-blue-50/50 border-blue-100 text-blue-700"
                  }`}>
                    <span className="truncate">Email: {tempSsoEmail}</span>
                    <span className="text-[9px] bg-blue-900 text-white px-2 py-0.5 rounded-full border border-cyan-500 font-extrabold select-none">GSuite Verified</span>
                  </div>

                  {loginError && (
                    <div className={`border p-4 rounded-2xl text-xs leading-normal font-bold flex items-start gap-2.5 ${
                      isDark 
                        ? "bg-red-950/20 border-red-900/30 text-red-300" 
                        : "bg-red-50 border-red-200 text-red-600"
                    }`}>
                      <AlertTriangle className={`w-4.5 h-4.5 shrink-0 mt-0.5 ${isDark ? "text-red-400" : "text-red-500"}`} />
                      <span>{loginError}</span>
                    </div>
                  )}

                  <form onSubmit={handleProfileCompletion} className="space-y-5">
                    <div className="space-y-2">
                      <label className={`block text-[10px] font-black uppercase tracking-wider font-mono ${isDark ? "text-slate-400" : "text-stone-500"}`}>
                        Full Name
                      </label>
                      <input
                        type="text"
                        value={tempSsoName}
                        onChange={(e) => {
                          setTempSsoName(e.target.value);
                          setLoginError(null);
                        }}
                        placeholder="e.g. Shashank J"
                        className={`w-full px-4 py-3 rounded-2xl border outline-none text-xs transition-all font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 ${
                          isDark 
                            ? "bg-[#102236] border-[#1e3e5c] text-white placeholder:text-slate-500" 
                            : "bg-stone-50 border-stone-200 text-stone-900 placeholder:text-stone-400 font-bold"
                        }`}
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <label className={`block text-[10px] font-black uppercase tracking-wider font-mono ${isDark ? "text-slate-400" : "text-stone-500"}`}>
                        TACT ID (Workforce Registration)
                      </label>
                      <input
                        type="text"
                        value={tempTactId}
                        onChange={(e) => {
                          setTempTactId(e.target.value);
                          setLoginError(null);
                        }}
                        placeholder="e.g. TACT-128"
                        className={`w-full px-4 py-3 rounded-2xl border outline-none text-xs transition-all font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 ${
                          isDark 
                            ? "bg-[#102236] border-[#1e3e5c] text-white placeholder:text-slate-500" 
                            : "bg-stone-50 border-stone-200 text-stone-900 placeholder:text-stone-400 font-bold"
                        }`}
                        required
                      />
                    </div>

                    <PrimaryCtaButton
                      theme={theme}
                      type="submit"
                      disabled={loginLoading}
                      className="w-full !flex items-center justify-center gap-2 mt-3"
                    >
                      {loginLoading ? (
                        <RefreshCw className="w-4 h-4 animate-spin text-current" />
                      ) : (
                        <span>ACTIVATE PROFILE & LOG IN</span>
                      )}
                    </PrimaryCtaButton>
                  </form>

                  <button
                    type="button"
                    onClick={() => {
                      setIsFirstTimeSetup(false);
                      setTempSsoEmail("");
                      setTempSsoName("");
                      setTempTactId("");
                      setLoginError(null);
                    }}
                    className={`w-full text-center text-[10px] font-black tracking-widest uppercase mt-1 cursor-pointer select-none ${
                      isDark ? "text-slate-400 hover:text-white" : "text-stone-500 hover:text-stone-800"
                    }`}
                  >
                    Cancel SSO
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key="secure-login"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  className={`rounded-3xl p-6 md:p-8 shadow-xl border flex flex-col items-start text-left gap-6 transition-all duration-300 w-full ${
                    isDark 
                      ? "bg-[#03101a]/95 border-white/[0.08] shadow-black/40 text-slate-100" 
                      : "bg-white border-stone-200 shadow-stone-200/50 text-stone-900"
                  }`}
                >
                  <div className="flex flex-col items-start text-left w-full">
                    <MascotWithFallback 
                      src="/assets/.aistudio/thumbs-up-mascot.png" 
                      alt="Thumbs up Mascot" 
                      className="w-16 h-16 object-contain mb-3 animate-fade-in"
                      type="doctor"
                    />
                    
                    <div className="flex items-center gap-2 mb-2 select-none">
                      <div className="w-6 h-0.5" style={{ backgroundColor: "var(--accent)" }} />
                      <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--accent)" }}>
                        PORTAL ACCESS
                      </span>
                    </div>

                    <h2 className={`text-2xl font-black uppercase tracking-wider ${isDark ? "text-white" : "text-stone-900"}`}>
                      DITTO ADVISOR PORTAL
                    </h2>
                    <p className={`text-xs leading-relaxed font-semibold mt-2 ${isDark ? "text-[#9CA3AF]" : "text-stone-650"}`}>
                      Your @joinditto.in ID gets you in. Everything else is ready for your next PED Mapping session.
                    </p>
                  </div>

                  {loginError && (
                    <div className={`border p-4 rounded-2xl text-xs leading-normal font-bold flex items-start gap-2.5 w-full text-left ${
                      isDark 
                        ? "bg-red-950/20 border-red-900/30 text-red-300" 
                        : "bg-red-50 border-red-200 text-red-600"
                    }`}>
                      <AlertTriangle className={`w-4.5 h-4.5 shrink-0 mt-0.5 ${isDark ? "text-red-400" : "text-red-500"}`} />
                      <span>{loginError}</span>
                    </div>
                  )}

                  <button
                    onClick={handleGoogleSSO}
                    disabled={loginLoading}
                    className={`w-full py-4 text-xs font-black uppercase tracking-widest rounded-2xl flex items-center justify-center gap-3 transition-all cursor-pointer shadow-sm active:scale-98 select-none ${
                      isDark 
                        ? "bg-white text-stone-950 hover:bg-stone-150" 
                        : "bg-stone-900 text-white hover:bg-stone-800"
                    }`}
                  >
                    {loginLoading ? (
                      <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
                    ) : (
                      <>
                        <svg className="w-4.5 h-4.5 animate-pulse" viewBox="0 0 24 24">
                          <path
                            fill="#ea4335"
                            d="M5.266 9.765A7.077 7.077 0 0112 4.909c1.69 0 3.218.6 4.418 1.582l3.51-3.51C17.642 1.09 14.974 0 12 0 7.354 0 3.307 2.67 1.242 6.551l4.024 3.214z"
                          />
                          <path
                            fill="#4285f4"
                            d="M23.49 12.273c0-.818-.073-1.609-.208-2.373H12v4.5h6.464a5.534 5.534 0 01-2.4 3.627l3.75 2.91c2.19-2.023 3.476-5 3.476-8.664z"
                          />
                          <path
                            fill="#fbbc05"
                            d="M5.266 14.235A7.086 7.086 0 014.909 12c0-.791.132-1.55.357-2.261L1.242 6.551A11.936 11.936 0 000 12c0 2.002.49 3.89 1.348 5.561l3.918-3.326z"
                          />
                          <path
                            fill="#34a853"
                            d="M12 24c3.24 0 5.958-1.077 7.942-2.923l-3.75-2.91c-1.037.695-2.368 1.109-4.192 1.109-3.224 0-5.951-2.173-6.924-5.1l-4.024 3.214C3.307 21.33 7.354 24 12 24z"
                          />
                        </svg>
                        <span>SIGN IN WITH GOOGLE</span>
                      </>
                    )}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer of right side */}
          <div className={`z-10 flex justify-end text-[11px] font-bold font-mono uppercase tracking-wider ${isDark ? "text-slate-500" : "text-stone-550"} mt-4 md:mt-0`}>
            <span>©️BLISS GUIDES . DITTO</span>
          </div>
        </div>

      </div>
    );
  }

  const renderSidebarContent = (isMobile: boolean = false) => {
    return (
      <div className={`h-full flex flex-col ${
        theme === "dark" ? "bg-[#03101a] text-[#F5F7FA]" : "bg-[#9ea9b1] text-stone-950"
      }`}>
        {/* Header */}
        <div 
          style={{ borderColor: theme === "dark" ? "" : "#2f384b" }}
          className={`p-5 border-b flex items-center justify-between ${
            theme === "dark" ? "border-white/[0.08] bg-[#03101a]" : "bg-[#9ea9b1]"
          }`}
        >
          <div className="flex flex-col">
            <span className={`text-xs font-bold uppercase tracking-wider ${theme === "dark" ? "text-stone-400" : "text-stone-950 font-black"}`}>Ditto Compliance</span>
            <span className={`text-[10px] font-medium ${theme === "dark" ? "text-[#9CA3AF]" : "text-stone-900 font-bold"}`}>Medical Declaration Mapping Workspace</span>
          </div>
          <button
            onClick={() => setIsMenuOpen(false)}
            className={`p-1.5 rounded-lg transition-all cursor-pointer ${
              theme === "dark" 
                ? "hover:bg-white/5 text-[#9CA3AF] hover:text-[#F5F7FA]" 
                : "hover:bg-black/10 text-stone-900 hover:text-stone-950"
            }`}
            title="Collapse Menu"
          >
            <PanelLeftClose className="w-5 h-5" />
          </button>
        </div>

        {/* Categories / Navigation items */}
        <div role="navigation" aria-label="Workspace navigation" className="flex-grow p-4 space-y-1.5 overflow-y-auto">
          <span className={`block text-[10px] font-bold tracking-wider px-2 mb-2 ${theme === "dark" ? "text-[#9CA3AF]" : "text-[#03101a] font-extrabold"}`}>
            Advisor Zone
          </span>

          {hasAccess("lookup", "Viewer") && (
            <>
              <button
                onClick={() => {
                  setActiveTab("lookup");
                  setShowIntro(true);
                  if (isMobile) setIsMenuOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-xs flex items-center gap-3 transition-all cursor-pointer border-l-2 ${
                  activeTab === "lookup" && showIntro
                    ? theme === "dark"
                      ? "border-l-blue-600 bg-stone-850/40 text-white font-bold" 
                      : "border-l-blue-700 bg-white/45 text-stone-950 font-black"
                    : theme === "dark"
                      ? "border-l-transparent text-[#9CA3AF] hover:bg-stone-800/15 hover:text-[#F5F7FA] font-medium"
                      : "border-l-transparent text-stone-900 hover:bg-white/20 hover:text-stone-950 font-semibold"
                } rounded-r-lg border-y-transparent border-r-transparent`}
              >
                <Home className={`w-4 h-4 shrink-0 ${theme === "dark" ? "text-blue-500" : "text-[#054496]"}`} />
                <span>Home</span>
              </button>

              <button
                onClick={() => {
                  setActiveTab("lookup");
                  setShowIntro(false);
                  if (isMobile) setIsMenuOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-xs flex items-center gap-3 transition-all cursor-pointer border-l-2 ${
                  activeTab === "lookup" && !showIntro
                    ? theme === "dark"
                      ? "border-l-blue-600 bg-stone-850/40 text-white font-bold" 
                      : "border-l-blue-700 bg-white/45 text-stone-950 font-black"
                    : theme === "dark"
                      ? "border-l-transparent text-[#9CA3AF] hover:bg-stone-800/15 hover:text-[#F5F7FA] font-medium"
                      : "border-l-transparent text-stone-900 hover:bg-white/20 hover:text-stone-950 font-semibold"
                } rounded-r-lg border-y-transparent border-r-transparent`}
              >
                <Sparkles className={`w-4 h-4 shrink-0 ${theme === "dark" ? "text-blue-500" : "text-[#054496]"}`} />
                <span>Declaration Assistant</span>
              </button>
            </>
          )}

          {hasAccess("resources", "Viewer") && (
            <button
              onClick={() => {
                setActiveTab("resources");
                if (isMobile) setIsMenuOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-xs flex items-center gap-3 transition-all cursor-pointer border-l-2 ${
                activeTab === "resources" 
                  ? theme === "dark"
                    ? "border-l-blue-600 bg-stone-850/40 text-white font-bold" 
                    : "border-l-blue-700 bg-white/45 text-stone-950 font-black"
                  : theme === "dark"
                    ? "border-l-transparent text-[#9CA3AF] hover:bg-stone-800/15 hover:text-[#F5F7FA] font-medium"
                    : "border-l-transparent text-stone-900 hover:bg-white/20 hover:text-stone-950 font-semibold"
              } rounded-r-lg border-y-transparent border-r-transparent`}
            >
              <DeclarationMapIcon width={16} height={16} color="currentColor" className={`shrink-0 ${theme === "dark" ? "text-blue-500" : "text-[#054496]"}`} />
              <span>Declaration Map</span>
            </button>
          )}

          {hasAccess("my_activity", "Viewer") && (
            <button
              onClick={() => {
                setActiveTab("my_activity");
                if (isMobile) setIsMenuOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-xs flex items-center gap-3 transition-all cursor-pointer border-l-2 ${
                activeTab === "my_activity" 
                  ? theme === "dark"
                    ? "border-l-blue-600 bg-stone-850/40 text-white font-bold" 
                    : "border-l-blue-700 bg-white/45 text-stone-950 font-black"
                  : theme === "dark"
                    ? "border-l-transparent text-[#9CA3AF] hover:bg-stone-800/15 hover:text-[#F5F7FA] font-medium"
                    : "border-l-transparent text-stone-900 hover:bg-white/20 hover:text-stone-950 font-semibold"
              } rounded-r-lg border-y-transparent border-r-transparent`}
            >
              <History className={`w-4 h-4 shrink-0 ${theme === "dark" ? "text-blue-500" : "text-[#054496]"}`} />
              <span>My Activity</span>
            </button>
          )}

          {(hasAccess("audit", "Viewer") || hasAccess("profile_access", "Viewer") || hasAccess("plan_scope", "Viewer")) && (
            <>
              <div 
                style={{ borderColor: theme === "dark" ? "" : "#2f384b" }}
                className={`border-t my-3.5 ${theme === "dark" ? "border-white/[0.06]" : ""}`} 
              />

              <span className={`block text-[10px] font-bold tracking-wider px-2 mb-2 ${theme === "dark" ? "text-[#9CA3AF]" : "text-[#03101a] font-extrabold"}`}>
                Admin Zone
              </span>

              {hasAccess("qa_announcement_log", "Viewer") && (
                <button
                  onClick={() => {
                    setActiveTab("qa_announcement_log");
                    if (isMobile) setIsMenuOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center gap-3 transition-all cursor-pointer border-l-2 ${
                    activeTab === "qa_announcement_log" 
                      ? theme === "dark"
                        ? "border-l-blue-600 bg-stone-850/40 text-white font-bold" 
                        : "border-l-blue-700 bg-white/45 text-stone-950 font-black"
                      : theme === "dark"
                        ? "border-l-transparent text-[#9CA3AF] hover:bg-stone-800/15 hover:text-[#F5F7FA] font-medium"
                        : "border-l-transparent text-stone-900 hover:bg-white/20 hover:text-stone-950 font-semibold"
                  } rounded-r-lg border-y-transparent border-r-transparent`}
                >
                  <Megaphone className={`w-4 h-4 shrink-0 ${theme === "dark" ? "text-blue-500" : "text-[#054496]"}`} />
                  <span>Announcement Manager</span>
                </button>
              )}

              {hasAccess("audit", "Viewer") && (
                <button
                  onClick={() => {
                    setActiveTab("audit");
                    if (isMobile) setIsMenuOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center gap-3 transition-all cursor-pointer border-l-2 ${
                    activeTab === "audit" 
                      ? theme === "dark"
                        ? "border-l-blue-600 bg-stone-850/40 text-white font-bold" 
                        : "border-l-blue-700 bg-white/45 text-stone-950 font-black"
                      : theme === "dark"
                        ? "border-l-transparent text-[#9CA3AF] hover:bg-stone-800/15 hover:text-[#F5F7FA] font-medium"
                        : "border-l-transparent text-stone-900 hover:bg-white/20 hover:text-stone-950 font-semibold"
                  } rounded-r-lg border-y-transparent border-r-transparent`}
                >
                  <Clock className={`w-4 h-4 shrink-0 ${theme === "dark" ? "text-blue-500" : "text-[#054496]"}`} />
                  <span>Activity Log</span>
                </button>
              )}

              {hasAccess("plan_scope", "Viewer") && (
                <button
                  onClick={() => {
                    setActiveTab("plan_scope");
                    if (isMobile) setIsMenuOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center gap-3 transition-all cursor-pointer border-l-2 ${
                    activeTab === "plan_scope" 
                      ? theme === "dark"
                        ? "border-l-blue-600 bg-stone-850/40 text-white font-bold" 
                        : "border-l-blue-700 bg-white/45 text-stone-950 font-black"
                      : theme === "dark"
                        ? "border-l-transparent text-[#9CA3AF] hover:bg-stone-800/15 hover:text-[#F5F7FA] font-medium"
                        : "border-l-transparent text-stone-900 hover:bg-white/20 hover:text-stone-950 font-semibold"
                  } rounded-r-lg border-y-transparent border-r-transparent`}
                >
                  <ClipboardPlus className={`w-4 h-4 shrink-0 ${theme === "dark" ? "text-blue-500" : "text-[#054496]"}`} />
                  <span>Specific Illness Ledger</span>
                </button>
              )}

              {hasAccess("profile_access", "Viewer") && (
                <button
                  onClick={() => {
                    setActiveTab("profile_access");
                    if (isMobile) setIsMenuOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center gap-3 transition-all cursor-pointer border-l-2 ${
                    activeTab === "profile_access" 
                      ? theme === "dark"
                        ? "border-l-blue-600 bg-stone-850/40 text-white font-bold" 
                        : "border-l-blue-700 bg-white/45 text-stone-950 font-black"
                      : theme === "dark"
                        ? "border-l-transparent text-[#9CA3AF] hover:bg-stone-800/15 hover:text-[#F5F7FA] font-medium"
                        : "border-l-transparent text-stone-900 hover:bg-white/20 hover:text-stone-950 font-semibold"
                  } rounded-r-lg border-y-transparent border-r-transparent`}
                >
                  <User className={`w-4 h-4 shrink-0 ${theme === "dark" ? "text-blue-500" : "text-[#054496]"}`} />
                  <span>User Management</span>
                </button>
              )}

              {hasAccess("flagged_responses", "Viewer") && (
                <button
                  onClick={() => {
                    setActiveTab("flagged_responses");
                    if (isMobile) setIsMenuOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center gap-3 transition-all cursor-pointer border-l-2 ${
                    activeTab === "flagged_responses" 
                      ? theme === "dark"
                        ? "border-l-blue-600 bg-stone-850/40 text-white font-bold" 
                        : "border-l-blue-700 bg-white/45 text-stone-950 font-black"
                      : theme === "dark"
                        ? "border-l-transparent text-[#9CA3AF] hover:bg-stone-800/15 hover:text-[#F5F7FA] font-medium"
                        : "border-l-transparent text-stone-900 hover:bg-white/20 hover:text-stone-950 font-semibold"
                  } rounded-r-lg border-y-transparent border-r-transparent`}
                >
                  <AlertCircle className={`w-4 h-4 shrink-0 ${theme === "dark" ? "text-blue-500" : "text-[#054496]"}`} />
                  <span>Flagged Responses</span>
                </button>
              )}

            </>
          )}
        </div>
      </div>
    );
  };

  // Active Main UI App
  return (
    <div className={`h-screen font-sans flex flex-row antialiased relative ${
      isDark 
        ? "bg-[#001322] text-slate-100" 
        : "bg-[#F1F6FB] text-stone-900"
    } w-full overflow-hidden`}>

      {/* EXPANDABLE LEFT SIDEBAR WITH MOTION WIDTH ANIMATION */}
      <motion.aside 
        animate={{ width: isMenuOpen ? 260 : (isMobileWindow ? 0 : 60) }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className={`${isMobileWindow ? "absolute left-0 top-0 h-full shadow-2xl" : "relative h-full"} flex flex-col shrink-0 z-50 overflow-hidden ${
          isDark ? "bg-[#03101a] border-r border-white/[0.08]" : "bg-[#9ea9b1] border-r border-stone-300"
        }`}
      >
        {isMenuOpen ? (
          <div className="w-full h-full flex flex-col overflow-hidden">
            {renderSidebarContent(false)}
          </div>
        ) : (
          <div 
            style={{ borderRadius: "0px", backgroundColor: !isDark ? "#9ea9b1" : undefined }}
            className="w-full h-full flex flex-col items-center py-6 gap-3 overflow-hidden"
          >
            {/* Click to expand button */}
            <button 
              onClick={() => setIsMenuOpen(true)}
              className={`w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer transition-all ${
                isDark ? "hover:bg-white/5" : "hover:bg-black/[0.12]"
              }`}
              title="Expand Navigation Menu"
            >
              <PanelLeftOpen className="w-5 h-5" style={{ color: !isDark ? "#0e1016" : "#9a9c9e" }} />
            </button>

            <div className={`w-10 border-b ${isDark ? "border-white/[0.08]" : "border-stone-200/50"} my-1`} />

            {/* Collapsed Menu Items of Active Tools */}
            <div 
              style={{ paddingLeft: "5px", paddingRight: "5px", borderRadius: "0px", backgroundColor: !isDark ? "#9ea9b1" : undefined }}
              className="flex flex-col gap-2 w-full flex-grow overflow-y-auto py-2 items-center no-scrollbar"
            >
              {hasAccess("lookup", "Viewer") && (
                <>
                  <button 
                    onClick={() => {
                      setActiveTab("lookup");
                      setShowIntro(true);
                    }}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer transition-all ${
                      activeTab === "lookup" && showIntro
                        ? "bg-blue-600/15 text-blue-400 border border-blue-500/30"
                        : isDark ? "hover:bg-white/5" : "hover:bg-black/[0.12]"
                    }`}
                    style={{ color: activeTab === "lookup" && showIntro ? "var(--accent)" : "var(--text-muted)" }}
                    title="Home"
                  >
                    <Home style={{ width: "18px", height: "18px" }} />
                  </button>

                  <button 
                    onClick={() => {
                      setActiveTab("lookup");
                      setShowIntro(false);
                    }}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer transition-all ${
                      activeTab === "lookup" && !showIntro
                        ? "bg-blue-600/15 text-blue-400 border border-blue-500/30"
                        : isDark ? "hover:bg-white/5" : "hover:bg-black/[0.12]"
                    }`}
                    style={{ color: activeTab === "lookup" && !showIntro ? "var(--accent)" : "var(--text-muted)" }}
                    title="Declaration Assistant"
                  >
                    <Sparkles style={{ width: "18px", height: "18px" }} />
                  </button>
                </>
              )}

              {hasAccess("resources", "Viewer") && (
                <button 
                  onClick={() => setActiveTab("resources")}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer transition-all ${
                    activeTab === "resources" 
                      ? "bg-blue-600/15 text-blue-400 border border-blue-500/30"
                      : isDark ? "hover:bg-white/5" : "hover:bg-black/[0.12]"
                  }`}
                  style={{ color: activeTab === "resources" ? "var(--accent)" : "var(--text-muted)" }}
                  title="Declaration Map"
                >
                  <DeclarationMapIcon width={18} height={18} color="currentColor" />
                </button>
              )}

              {hasAccess("my_activity", "Viewer") && (
                <button 
                  onClick={() => setActiveTab("my_activity")}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer transition-all ${
                    activeTab === "my_activity" 
                      ? "bg-blue-600/15 text-blue-400 border border-blue-500/30"
                      : isDark ? "hover:bg-white/5" : "hover:bg-black/[0.12]"
                  }`}
                  style={{ color: activeTab === "my_activity" ? "var(--accent)" : "var(--text-muted)" }}
                  title="My Activity"
                >
                  <History style={{ width: "18px", height: "18px" }} />
                </button>
              )}

              {hasAccess("qa_announcement_log", "Viewer") && (
                <button 
                  onClick={() => setActiveTab("qa_announcement_log")}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer transition-all relative ${
                    activeTab === "qa_announcement_log" 
                      ? "bg-blue-600/15 text-blue-400 border border-blue-500/30"
                      : isDark ? "hover:bg-white/5" : "hover:bg-black/[0.12]"
                  }`}
                  style={{ color: activeTab === "qa_announcement_log" ? "var(--accent)" : "var(--text-muted)" }}
                  title="Announcement Manager"
                >
                  <Megaphone style={{ width: "18px", height: "18px" }} />
                </button>
              )}

              {hasAccess("audit", "Viewer") && (
                <button 
                  onClick={() => setActiveTab("audit")}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer transition-all ${
                    activeTab === "audit" 
                      ? "bg-blue-600/15 text-blue-400 border border-blue-500/30"
                      : isDark ? "hover:bg-white/5" : "hover:bg-black/[0.12]"
                  }`}
                  style={{ color: activeTab === "audit" ? "var(--accent)" : "var(--text-muted)" }}
                  title="Activity Log"
                >
                  <Clock style={{ width: "18px", height: "18px" }} />
                </button>
              )}

              {hasAccess("plan_scope", "Viewer") && (
                <button 
                  onClick={() => setActiveTab("plan_scope")}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer transition-all ${
                    activeTab === "plan_scope" 
                      ? "bg-blue-600/15 text-blue-400 border border-blue-500/30"
                      : isDark ? "hover:bg-white/5" : "hover:bg-black/[0.12]"
                  }`}
                  style={{ color: activeTab === "plan_scope" ? "var(--accent)" : "var(--text-muted)" }}
                  title="Specific Illness Ledger"
                >
                  <ClipboardPlus style={{ width: "18px", height: "18px" }} />
                </button>
              )}

              {hasAccess("profile_access", "Viewer") && (
                <button 
                  onClick={() => setActiveTab("profile_access")}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer transition-all ${
                    activeTab === "profile_access" 
                      ? "bg-blue-600/15 text-blue-400 border border-blue-500/30"
                      : isDark ? "hover:bg-white/5" : "hover:bg-black/[0.12]"
                  }`}
                  style={{ color: activeTab === "profile_access" ? "var(--accent)" : "var(--text-muted)" }}
                  title="User Management"
                >
                  <User style={{ width: "18px", height: "18px" }} />
                </button>
              )}

              {hasAccess("flagged_responses", "Viewer") && (
                <button 
                  onClick={() => setActiveTab("flagged_responses")}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer transition-all relative ${
                    activeTab === "flagged_responses" 
                      ? "bg-blue-600/15 text-blue-400 border border-blue-500/30"
                      : isDark ? "hover:bg-white/5" : "hover:bg-black/[0.12]"
                  }`}
                  style={{ color: activeTab === "flagged_responses" ? "var(--accent)" : "var(--text-muted)" }}
                  title="Flagged Responses"
                >
                  <AlertCircle style={{ width: "18px", height: "18px" }} />
                </button>
              )}
            </div>

            {/* Bottom Profile Action */}
            <div 
              style={{ borderWidth: "0px", paddingTop: "0px" }}
              className="relative mt-auto pt-4 border-t border-white/[0.05] w-full flex justify-center"
            >
              <button
                ref={profileButtonRef}
                onClick={() => {
                  if (!profileOpen && profileButtonRef.current) {
                    const rect = profileButtonRef.current.getBoundingClientRect();
                    // Anchor the card's bottom edge to the button's bottom edge so it
                    // grows upward — the button sits at the very bottom of the sidebar,
                    // so growing downward (from rect.top) pushed the card off-screen.
                    const bottom = Math.max(12, window.innerHeight - rect.bottom);
                    setProfileMenuPos({ bottom, left: rect.right + 8 });
                  }
                  setProfileOpen(!profileOpen);
                }}
                className="rounded-full flex items-center justify-center cursor-pointer transition-all shrink-0 overflow-hidden bg-[#20C4C7]"
                style={{ width: "35px", height: "35px", backgroundColor: "#206147", borderColor: "#b9b97a", borderStyle: "solid", borderWidth: "1px" }}
                title="View user credentials & active profile details"
              >
                {currentUser?.avatarUrl || currentUser?.photoUrl ? (
                  <img
                    src={currentUser.avatarUrl || currentUser.photoUrl}
                    alt={currentUser.name}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="font-bold text-xs uppercase text-white">
                    {currentUser?.name?.charAt(0) || "M"}
                  </div>
                )}
              </button>

              {createPortal(
                <AnimatePresence>
                  {profileOpen && profileMenuPos && (
                    <>
                      <div
                        className="fixed inset-0 z-[9998] cursor-default"
                        onClick={() => setProfileOpen(false)}
                      />
                      <motion.div
                        initial={{ opacity: 0, x: 10, scale: 0.95 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={{ opacity: 0, x: 10, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        style={{
                          bottom: profileMenuPos.bottom,
                          left: profileMenuPos.left,
                          maxHeight: "calc(100vh - 24px)",
                          overflowY: "auto",
                        }}
                        className={`fixed w-64 rounded-lg border shadow-xl z-[9999] p-4 font-sans text-left ${
                          theme === "dark"
                            ? "bg-[#12151A] border-[#252A34] text-white shadow-black/80"
                            : "bg-white border-stone-200 text-stone-900 shadow-stone-300"
                        }`}
                      >
                      <div className="space-y-3">
                        <div className="border-b pb-2 border-dashed border-stone-700/50 dark:border-stone-200/50">
                          <p className="text-xs font-bold leading-tight">
                            {currentUser?.name}
                          </p>
                        </div>

                        <div className="space-y-2 text-xs">
                          <div className={`flex flex-col p-1.5 rounded ${theme === "dark" ? "bg-stone-900/60" : "bg-stone-50"}`}>
                            <span className="text-[10px] font-medium text-stone-400 dark:text-stone-500">Email ID:</span>
                            <span className="font-mono text-[10.5px] truncate mt-0.5">{currentUser?.email || "advisor@joinditto.in"}</span>
                          </div>

                          <div className={`flex justify-between items-center p-1.5 rounded ${theme === "dark" ? "bg-stone-900/60" : "bg-stone-50"}`}>
                            <span className="text-[10px] font-medium text-stone-400 dark:text-stone-500">Access Level:</span>
                            <span className={`px-1.5 py-0.5 rounded text-[8.5px] font-black uppercase tracking-wider ${
                              currentUser?.tier === "Owner"
                                ? "bg-red-500/10 text-red-500"
                                : currentUser?.tier === "Admin"
                                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                : "bg-blue-500/10 text-blue-600 dark:text-sky-400"
                            }`}>
                              {currentUser?.tier || "General"}
                            </span>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-stone-700/50 dark:border-stone-250">
                          <button
                            onClick={() => {
                              setProfileOpen(false);
                              handleLogout();
                            }}
                            className="w-full py-2 px-3 border border-red-500/20 hover:border-red-500 bg-red-500/5 hover:bg-red-500/10 text-xs font-bold text-red-500 rounded-md transition-all cursor-pointer flex items-center justify-center gap-1.5"
                          >
                            <LogOut className="w-3.5 h-3.5" />
                            <span>Log Out</span>
                          </button>
                        </div>
                      </div>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>,
                document.body
              )}
            </div>
          </div>
        )}
      </motion.aside>

      {/* MAIN APPLICATION CONTENT AREA */}
      <div className="flex-grow flex flex-col min-w-0 h-full overflow-hidden relative">
      {/* Modern, Simple, and Futuristic Ambient Background (Combining premium organic digital waves and soft light/dark glow) */}
      <div
        className={`absolute inset-0 pointer-events-none z-0 select-none transition-all duration-500 ${
          isDark ? "opacity-90" : "opacity-[0.70]"
        }`}
        style={{
          backgroundImage: isDark
            ? `url("/assets/.aistudio/background-pattern-dark.svg")`
            : `url("/assets/.aistudio/background-pattern-light.svg")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />

      {/* Dynamic Animated Mesh System (Background Atmosphere for BOTH dark and light modes, preserving original branding) */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden select-none">
        {/* Top-left glow */}
        <div className={`absolute top-[-15%] left-[-15%] w-[60%] h-[60%] rounded-full blur-[100px] sm:blur-[120px] md:blur-[150px] animate-pulse ${
          isDark ? "bg-blue-600/12 opacity-[0.35]" : "bg-blue-400/20 opacity-[0.25]"
        }`} style={{ animationDuration: "14s" }} />
        {/* Bottom-right glow */}
        <div className={`absolute bottom-[-15%] right-[-15%] w-[70%] h-[70%] rounded-full blur-[110px] sm:blur-[130px] md:blur-[180px] animate-pulse ${
          isDark ? "bg-[#3B82F6]/10 opacity-[0.35]" : "bg-[#2563EB]/15 opacity-[0.20]"
        }`} style={{ animationDuration: "20s" }} />
      </div>

      <a href="#main-content" className="skip-to-content">Skip to main content</a> {/* HEADER BAR: Frosted floating glass compliance console bar */}
      <div className="p-4 pb-0 shrink-0 select-none relative z-40 w-full lg:w-[99%] xl:w-[98%] max-w-[1850px] mx-auto">
        <header className={`rounded-2xl border transition-all duration-300 ${
          theme === "dark" 
            ? "border-white/[0.08] bg-[#03101a] text-white shadow-[0_8px_32px_rgba(0,0,0,0.55)] hover:border-white/[0.12]" 
            : "border-slate-200 bg-[#163c62] text-slate-100 shadow-[0_4px_20px_rgba(0,0,0,0.05)] hover:border-slate-300/80"
        }`}>
          <div className="w-full flex items-center justify-between relative gap-4" style={{ backgroundColor: "var(--header-bg)", height: "54px", borderRadius: "16px", borderColor: "transparent", borderStyle: "none", borderWidth: "0px", paddingLeft: "20px", paddingRight: "20px", marginLeft: "0px", marginRight: "0px", marginTop: "-5px", marginBottom: "0px", paddingTop: "0px", paddingBottom: "0px" }}>
          
          {/* Back Arrow navigation replacing the sandwich menu icon */}
          <div className="flex items-center gap-3.5 shrink-0 z-10">
            <button
              onClick={() => {
                if (activeTab === "lookup" && !showIntro) {
                  setShowIntro(true);
                } else {
                  setActiveTab("lookup");
                  setShowIntro(true);
                }
              }}
              className="p-1.5 transition-all cursor-pointer flex items-center justify-center shrink-0"
              style={{
                backgroundColor: "transparent",
                borderColor: "transparent",
                color: "#94a3b8",
                borderRadius: "6px"
              }}
              title="Go Back" aria-label="Go back"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" style={{ fontSize: "18px", width: "25px", height: "20px", marginRight: "-5px", marginLeft: "-14px", color: "#ffffff", borderColor: "#ffffff" }} />
            </button>

            <button
              onClick={() => {
                setActiveTab("lookup");
                setShowIntro(true);
              }}
              className="text-left cursor-pointer hover:opacity-85 transition-opacity focus:outline-none select-none"
              title="Home (Go to Compliance & Policy Mapping Engine)" aria-label="Go to home — Declaration Assistant"
            >
              <div className="flex items-center gap-2">
                <DittoWordmark className="text-lg" isWhite={true} style={{ backgroundColor: "transparent" }} imgStyle={{ marginLeft: "-6px", marginBottom: "5px", width: "55px", height: "20px", paddingLeft: "0px" }} firstSpanStyle={{ color: "#fefefe" }} secondSpanStyle={{ color: "#1e7af5" }} />
              </div>
            </button>
          </div>

          {/* TAB CONTROLS (Page Context Breadcrumb) - Absolutely Centered on Desktop */}
          <div className="md:absolute md:left-1/2 md:-translate-x-1/2 flex items-center gap-2 z-10 pointer-events-auto">
            {(() => {
              if (activeTab === "lookup" && showIntro) {
                return (
                  <button
                    onClick={() => setIsMenuOpen(prev => !prev)}
                    style={{ 
                      backgroundColor: "transparent",
                      borderColor: "transparent",
                      color: "#ffffff",
                      borderWidth: "0px",
                      boxShadow: "none",
                      borderRadius: "12px"
                    }}
                    className="title-badge-btn px-6 py-2 justify-center text-xs sm:text-sm font-black uppercase tracking-widest border-0 duration-300 transition-all flex items-center gap-2.5 cursor-pointer whitespace-nowrap active:scale-95 hover:scale-[1.02]"
                    title="Current workspace tab view"
                  >
                    <Home className="title-badge-icon w-4 h-4 shrink-0 text-cyan-400" style={{ color: theme !== "dark" ? "#ffffff" : "#fafafa", paddingRight: "0px", marginRight: "-6px", width: "15px", height: "15px", marginBottom: "2px", marginTop: "1px" }} />
                    <span style={{ fontSize: "13px", color: "#f9f9fc", paddingTop: "0px", paddingBottom: "0px", lineHeight: "13px", marginLeft: "2px", marginTop: "1px" }} className="title-badge-text font-sans font-black uppercase tracking-wider">
                      Advisor Home
                    </span>
                  </button>
                );
              }
              const tabMeta = {
                lookup: { label: "Declaration Assistant", icon: <Sparkles className="w-4.5 h-4.5 shrink-0 text-cyan-400" /> },
                my_activity: { label: "My Activity", icon: <History className="w-4.5 h-4.5 shrink-0 text-cyan-400" /> },
                resources: { label: "Declaration Map", icon: <DeclarationMapIcon color="currentColor" className="w-4.5 h-4.5 shrink-0 text-cyan-400" /> },
                audit: { label: "Activity Log", icon: <Clock className="w-4.5 h-4.5 shrink-0 text-cyan-400" /> },
                profile_access: { label: "User Management", icon: <User className="w-4.5 h-4.5 shrink-0 text-cyan-400" /> },
                plan_scope: { label: "Specific Illness Ledger", icon: <ClipboardPlus className="w-4.5 h-4.5 shrink-0 text-cyan-400" /> },
                flagged_responses: { label: "Flagged Responses", icon: <AlertCircle className="w-4.5 h-4.5 shrink-0 text-cyan-400" /> },
                
                qa_announcement_log: { label: "Announcement Manager", icon: <Megaphone className="w-4.5 h-4.5 shrink-0 text-cyan-400" /> }
              };
              const meta = tabMeta[activeTab] || tabMeta.lookup;
              return (
                <button
                  onClick={() => setIsMenuOpen(prev => !prev)}
                  style={{ 
                    backgroundColor: "transparent",
                    borderColor: "transparent",
                    color: "#ffffff",
                    borderWidth: "0px",
                    boxShadow: "none"
                  }}
                  className="title-badge-btn px-6 py-2 justify-center text-xs sm:text-sm font-black uppercase tracking-widest border-0 duration-300 transition-all flex items-center gap-2.5 cursor-pointer whitespace-nowrap active:scale-95 hover:scale-[1.02]"
                  title="Current workspace tab view"
                >
                  {React.cloneElement(meta.icon, { 
                    className: "title-badge-icon w-4.5 h-4.5 shrink-0 text-cyan-400",
                    style: { color: theme !== "dark" ? "#ffffff" : "#fafafa", borderColor: "transparent", paddingRight: "0px", marginRight: "-6px", width: "15px", height: "15px", marginBottom: "2px", marginTop: "1px" } 
                  })}
                  <span 
                    style={{ fontSize: "13px", color: "#f9f9fc", paddingTop: "0px", paddingBottom: "0px", lineHeight: "13px", marginLeft: "2px", marginTop: "1px" }}
                    className="title-badge-text font-sans font-black uppercase tracking-wider"
                  >
                    {meta.label}
                  </span>
                </button>
              );
            })()}
          </div>

          {/* ACTIVE USER INFO & HEADER NAVIGATION CONTROLS */}
          <div className="flex items-center gap-2.5 shrink-0 z-10">
            {/* Theme Toggle & Direct Log Out */}
            <div 
              className="flex items-center justify-center gap-1.5 p-1" 
              style={{
                backgroundColor: "transparent",
                borderColor: "transparent"
              }}
            >
                {/* Flagged Mismatches Notification Icon (Request 3) */}
                {hasAccess("flagged_responses", "Viewer") && (
                  <button
                    onClick={() => {
                      setActiveTab("flagged_responses");
                      setShowIntro(false);
                    }}
                    className="p-1.5 rounded transition-all cursor-pointer relative flex items-center justify-center mr-1"
                    title="Flagged Mismatches"
                    aria-label="View flagged mismatches"
                  >
                    <Bell className="w-4 h-4 text-[#5dc0b4] hover:text-[#5dc0b4] transition-colors" style={{ width: "20px", height: "20px" }} />
                    {reportedIssues.filter(issue => issue.status === "Pending" || issue.status === "Urgent").length > 0 && (
                      <span className="absolute top-1 right-1 flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                      </span>
                    )}
                  </button>
                )}

                {/* Dark / Light theme toggle */}
                <button
                  onClick={toggleTheme}
                  className="p-1.5 rounded transition-all cursor-pointer"
                  title={theme === "dark" ? "Switch to Light mode" : "Switch to Dark mode"} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} aria-pressed={theme === "dark"}
                >
                  {theme === "dark"
                    ? <Sun className="w-4 h-4" aria-hidden="true" style={{ width: "20px", height: "20px", color: "#ff7b00" }} />
                    : <Moon className="w-4 h-4" aria-hidden="true" style={{ width: "20px", height: "20px", color: "#a089c8" }} />
                  }
                </button>

                {/* Direct Logout (Request 2) */}
                <button
                  onClick={handleLogout}
                  className="p-1.5 rounded transition-all cursor-pointer text-red-500 hover:text-red-400"
                  title="Direct Logout"
                  aria-label="Direct logout"
                >
                  <LogOut className="w-4 h-4" aria-hidden="true" style={{ width: "20px", height: "20px", color: "#9a9c9e" }} />
                </button>
              </div>
            </div>
          </div>
        </header>
    </div>

      {/* Persistent simulation banner */}
      {simulatedRole && (
        <div className="bg-amber-500 text-stone-950 px-4 py-2 text-xs font-black flex items-center justify-between gap-4 shadow-md sticky top-[61px] z-30 select-none animate-slide-down shrink-0">
          <div className="flex items-center gap-2">
            <span className="bg-stone-950 text-amber-400 px-1.5 py-0.5 rounded text-[9.5px] uppercase font-mono tracking-widest leading-none">Simulation mode</span>
            <span>Viewing as: <b className="uppercase">{simulatedRole === "General" ? "Advisor" : simulatedRole}</b> — your <b className="uppercase">{currentUser?.tier === "General" ? "Advisor" : currentUser?.tier}</b> permissions are still active.</span>
          </div>
          <button
            onClick={() => setSimulatedRole(null)}
            className="px-3 py-1 bg-stone-950 text-white rounded-lg text-[10px] uppercase font-black tracking-wider hover:bg-stone-900 leading-none transition-all duration-150 cursor-pointer"
          >
            Exit view
          </button>
        </div>
      )}

      {/* RIGHT CONTROLS DRAWER PANEL */}
      <AnimatePresence>
        {isRightSidebarOpen && (
          <>
            {/* Backdrop overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsRightSidebarOpen(false)}
              className="fixed inset-0 bg-black/60 z-50 backdrop-blur-xs cursor-pointer"
            />

            {/* Drawer Container */}
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              id="right-controls-drawer" role="dialog" aria-modal="true" aria-label="Workspace controls" className={`fixed top-0 right-0 h-full w-80 border-l z-54 shadow-2xl flex flex-col font-sans p-6 text-left ${
                theme === "dark" 
                  ? "bg-[#12151A] border-[#252A34] text-white" 
                  : "bg-white border-stone-300 text-stone-900"
              }`}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b pb-4 mb-6 border-dashed border-stone-700/50 dark:border-stone-200/50">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-[#3B82F6]" />
                  <span className="text-xs font-bold uppercase tracking-wider">Workspace Controls</span>
                </div>
                <button
                  onClick={() => setIsRightSidebarOpen(false)}
                  className={`p-1 rounded-lg transition-all cursor-pointer ${
                    theme === "dark" 
                      ? "hover:bg-stone-800/50 text-[#9CA3AF] hover:text-[#F5F7FA]" 
                      : "hover:bg-stone-100 text-stone-650 hover:text-stone-900"
                  }`}
                  title="Close Controls Panel"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              {/* Controls Stack in the requested order: Tier, View As, Theme Switch */}
              <div className="space-y-6 flex-grow overflow-y-auto">
                
                {/* 1. Tier (User Access Switcher) */}
                {currentUser?.tier === "Owner" && (
                  <div className="space-y-2">
                    <label className={`block text-[10px] font-bold uppercase tracking-wider ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
                      App Access Tier
                    </label>
                    <div className={`p-4 rounded-lg border flex flex-col gap-3 ${
                      theme === "dark" ? "bg-[#171B22] border-[#252A34]" : "bg-stone-50 border-stone-200"
                    }`}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">Current Tier</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          currentUser?.tier === "Owner"
                            ? "bg-red-500/10 text-red-500 border border-red-500/10"
                            : "bg-blue-500/10 text-sky-500 border border-blue-500/10"
                        }`}>
                          {currentUser?.tier || "General"}
                        </span>
                      </div>
                      <button
                        onClick={toggleUserRole}
                        className={`w-full py-2 px-3 text-xs font-semibold rounded-md border transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                          theme === "dark"
                            ? "bg-[#12151A] border-[#252A34] text-white hover:border-stone-700 hover:bg-stone-800/30"
                            : "bg-white border-stone-250 text-stone-800 hover:bg-stone-100 font-medium shadow-xs"
                        }`}
                        title="Toggle app access role instantly"
                      >
                        <User className="w-3.5 h-3.5 text-[#3B82F6]" />
                        <span>Switch Credentials Tier</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* 2. View As (Simulated Role Switcher) */}
                {currentUser?.tier === "Owner" && (
                  <div className="space-y-2">
                    <label className={`block text-[10px] font-bold uppercase tracking-wider ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
                      Simulation View As
                    </label>
                    <div className={`p-4 rounded-lg border flex flex-col gap-2 ${
                      theme === "dark" ? "bg-[#171B22] border-[#252A34]" : "bg-stone-50 border-stone-200"
                    }`}>
                      <span className="text-xs font-medium">Select Preview Profile</span>
                      <select
                        value={simulatedRole || ""}
                        onChange={(e) => {
                          const val = (e.target.value as "General" | "Admin" | "Owner" | "") || null;
                          setSimulatedRole(val);
                        }}
                        className={`w-full text-xs font-semibold p-2 rounded-md border outline-none cursor-pointer ${
                          theme === "dark" 
                            ? "bg-[#12151A] border-[#252A34] text-white focus:border-stone-700" 
                            : "bg-white border-stone-250 text-stone-850 focus:border-blue-500 shadow-xs"
                        }`}
                      >
                        <option value="">Default Profile</option>
                        <option value="Admin">Admin View</option>
                        <option value="General">Advisor View</option>
                      </select>
                    </div>
                  </div>
                )}


              </div>

              {/* Drawer Footer info */}
              <div className="pt-4 border-t border-dashed border-stone-700/50 dark:border-stone-200/50 text-[10px] text-stone-500 dark:text-stone-400 font-medium">
                Adjust rules, security scopes and test setups dynamically.
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* SCROLLABLE BODY AREA */}
      <div 
        id="main-scrollable-body" 
        className={`flex-grow flex flex-col min-w-0 bg-transparent relative z-10 ${
          showIntro && activeTab === "lookup" ? "lg:overflow-hidden overflow-y-auto" : "overflow-y-auto"
        }`}
      >
        {/* BODY WRAPPER with centering content constraint */}
        <main 
          id="main-content" 
          tabIndex={-1} 
          style={{ color: "#000000", marginTop: showIntro && activeTab === "lookup" ? "2px" : "6px", marginBottom: showIntro && activeTab === "lookup" ? "2px" : "12px" }} 
          className={`flex-grow w-full p-3 sm:p-4 bg-transparent outline-none ${
            showIntro && activeTab === "lookup" ? "lg:p-3 xl:p-4 pt-1 sm:pt-1.5 flex flex-col justify-center" : "lg:p-5 pt-1.5 sm:pt-2"
          }`}
        >
          {/* Expanded premium layout container, reducing margin distance to human-optimal minimums */}
          <div className={`w-full lg:w-[98%] xl:w-[96%] max-w-[1550px] mx-auto ${showIntro && activeTab === "lookup" ? "flex-grow flex flex-col" : ""}`}>
        <AnimatePresence mode="wait">
          {/* TAB 1: INTRO PAGE / ONBOARDING */}
          {activeTab === "lookup" && showIntro && (
            <motion.div
              key="intro"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              style={{ width: "100%", maxWidth: "100%", marginTop: "2px", marginBottom: "2px" }}
              className="py-1 sm:py-2 space-y-2 flex-grow flex flex-col justify-center"
            >
              <ErrorBoundary theme={theme} label="Declaration Assistant">
                <Suspense fallback={<TabLoadingFallback theme={theme} />}>
                  <LookupIntroPage theme={theme} isDark={isDark} setShowIntro={setShowIntro} />
                </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}
          {/* TAB 1: DECLARATION ASSISTANT (ACTIVE SCREEN) */}
          {activeTab === "lookup" && !showIntro && (
            <motion.div
              key="lookup"
              initial={{ opacity: 0, x: "100vw" }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: "100vw" }}
              transition={{ 
                type: "tween", 
                duration: 0.55, 
                ease: [0.25, 1, 0.5, 1] // Fluid high-speed deceleration
              }}
              style={{
                width: "100%",
                maxWidth: "1400px",
                paddingLeft: "30px",
                paddingRight: "30px",
                paddingTop: "0px",
                paddingBottom: "0px",
                marginLeft: "auto",
                marginRight: "auto",
                marginTop: "0px",
                marginBottom: "10px"
              }}
              className="flex flex-col gap-4"
            >
              <ErrorBoundary theme={theme} label="Declaration Assistant">
              <Suspense fallback={<TabLoadingFallback theme={theme} />}>
              <LookupPage
                theme={theme}
                isResultsActive={isResultsActive}
                selectedPlan={selectedPlan}
                setSelectedPlan={setSelectedPlan}
                productionPlans={productionPlans}
                pedInput={pedInput}
                setPedInput={setPedInput}
                pedInputRef={pedInputRef}
                activeSuggestionIndex={activeSuggestionIndex}
                setActiveSuggestionIndex={setActiveSuggestionIndex}
                dynamicSuggestions={dynamicSuggestions}
                lookupPeds={lookupPeds}
                setLookupPeds={setLookupPeds}
                handleAddLookupPed={handleAddLookupPed}
                isLookupLoading={isLookupLoading}
                lookupResults={lookupResults}
                executeLookupAll={executeLookupAll}
                handleClearLookupFields={handleClearLookupFields}
                handleMapAnotherPed={handleMapAnotherPed}
                setReportingItem={setReportingItem}
                setReportingNotes={setReportingNotes}
                mappingResultCardRef={mappingResultCardRef}
                resultsRef={resultsRef}
                sidebarRef={sidebarRef}
                rightHeaderRef={rightHeaderRef}
                illnessSearchQuery={illnessSearchQuery}
                setIllnessSearchQuery={setIllnessSearchQuery}
                specificIllnessesDict={SPECIFIC_ILLNESSES}
                planConfigs={planConfigs}
                checkIllnessInPlanSpecificList={checkIllnessInPlanSpecificList}
                setActiveTab={setActiveTab}
                userAdvisoryToggle={userAdvisoryToggle}
                setUserAdvisoryToggle={setUserAdvisoryToggle}
                advisoryHasBeenExpanded={advisoryHasBeenExpanded}
                setAdvisoryHasBeenExpanded={setAdvisoryHasBeenExpanded}
                qaAnnouncements={qaAnnouncements}
                activeAnnouncements={activeAnnouncements}
                noticeIndex={noticeIndex}
                setNoticeIndex={setNoticeIndex}
                slideDirection={slideDirection}
                setSlideDirection={setSlideDirection}
              />
              </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}

          {/* TAB 1B: ADVISOR QUERY AUDIT TRAIL VIEW (content extracted to src/pages/AuditPage.tsx, Phase 1.3) */}
          {activeTab === "audit" && (
            <motion.div
              key="audit"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              <ErrorBoundary theme={theme} label="Activity Log">
              <Suspense fallback={<TabLoadingFallback theme={theme} />}>
              <AuditPage
                theme={theme}
                auditSubTab={auditSubTab}
                setAuditSubTab={setAuditSubTab}
                auditLogs={auditLogs}
                auditSearch={auditSearch}
                setAuditSearch={setAuditSearch}
                auditPlanFilter={auditPlanFilter}
                setAuditPlanFilter={setAuditPlanFilter}
                auditTypeFilter={auditTypeFilter}
                setAuditTypeFilter={setAuditTypeFilter}
                auditStartDate={auditStartDate}
                setAuditStartDate={setAuditStartDate}
                auditEndDate={auditEndDate}
                setAuditEndDate={setAuditEndDate}
                downloadCSV={downloadCSV}
                historySearch={historySearch}
                setHistorySearch={setHistorySearch}
                historyActionFilter={historyActionFilter}
                setHistoryActionFilter={setHistoryActionFilter}
                changeLogs={changeLogs}
              />
              </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}


          {/* TAB 1D: MY ACTIVITY INTERACTIVE VIEW (content extracted to src/pages/MyActivityPage.tsx, Phase 1.3) */}
          {activeTab === "my_activity" && (
            <motion.div
              key="my_activity"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
            >
              <ErrorBoundary theme={theme} label="My Activity">
              <Suspense fallback={<TabLoadingFallback theme={theme} />}>
              <MyActivityPage
                auditLogs={auditLogs}
                currentUser={currentUser}
                theme={theme}
                myActivitySearch={myActivitySearch}
                setMyActivitySearch={setMyActivitySearch}
                myActivityPlanFilter={myActivityPlanFilter}
                setMyActivityPlanFilter={setMyActivityPlanFilter}
                myActivityStartDate={myActivityStartDate}
                setMyActivityStartDate={setMyActivityStartDate}
                myActivityEndDate={myActivityEndDate}
                setMyActivityEndDate={setMyActivityEndDate}
                expandedLogIndex={expandedLogIndex}
                setExpandedLogIndex={setExpandedLogIndex}
              />
              </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}


          {/* TAB 1C: DECLARATION MAP INTERACTIVE VIEW (content extracted to src/pages/ResourcesPage.tsx, Phase 1.3) */}
          {activeTab === "resources" && (
            <motion.div
              key="resources"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              <ErrorBoundary theme={theme} label="Declaration Map">
                <Suspense fallback={<TabLoadingFallback theme={theme} />}>
                  <ResourcesPage theme={theme} />
                </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}

          {/* TAB 4: PROFILE & ACCESS MANAGEMENT (content extracted to src/pages/ProfileAccessPage.tsx, Phase 1.3) */}
          {activeTab === "profile_access" && currentUser && (
            <motion.div
              key="profile_access"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
            >
              <ErrorBoundary theme={theme} label="Profile & Access Management">
              <Suspense fallback={<TabLoadingFallback theme={theme} />}>
              <ProfileAccessPage
                currentUser={currentUser}
                effectiveTier={effectiveTier}
                usersList={usersList}
                setUsersList={setUsersList}
                ownerPasscode={ownerPasscode}
                setOwnerPasscode={setOwnerPasscode}
                featurePermissions={featurePermissions}
                setFeaturePermissions={setFeaturePermissions}
                hasAccess={hasAccess}
              />
              </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}

          {/* TAB 5: SPECIFIC ILLNESS LEDGER (content extracted to src/pages/PlanScopePage.tsx, Phase 1.3) */}
          {activeTab === "plan_scope" && currentUser && (
            <motion.div
              key="plan_scope"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
            >
              <ErrorBoundary theme={theme} label="Specific Illness Ledger">
                <Suspense fallback={<TabLoadingFallback theme={theme} />}>
                  <PlanScopePage
                    productionPlans={productionPlans}
                    theme={theme}
                  />
                </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}

          {/* TAB 6: QA ANNOUNCEMENT LOG PANEL (content extracted to src/pages/AnnouncementLogPage.tsx, Phase 1.3) */}
          {activeTab === "qa_announcement_log" && (
            <motion.div
              key="qa_announcement_log"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-6 text-left"
            >
              <ErrorBoundary theme={theme} label="QA Announcement Log">
              <Suspense fallback={<TabLoadingFallback theme={theme} />}>
              <AnnouncementLogPage
                theme={theme}
                qaAnnouncements={qaAnnouncements}
                setQaAnnouncements={setQaAnnouncements}
                currentUser={currentUser}
                setChangeLogs={setChangeLogs}
                editingAnnouncementId={editingAnnouncementId}
                setEditingAnnouncementId={setEditingAnnouncementId}
                deletingAnnouncementId={deletingAnnouncementId}
                setDeletingAnnouncementId={setDeletingAnnouncementId}
              />
              </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}


          {/* TAB 7: FLAGGED RESPONSES (MAPPING MISMATCHES) PANEL (content extracted to src/pages/FlaggedResponsesPage.tsx, Phase 1.3) */}
          {activeTab === "flagged_responses" && (
            <motion.div
              key="flagged_responses"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-6 text-left"
            >
              <ErrorBoundary theme={theme} label="Flagged Responses">
              <Suspense fallback={<TabLoadingFallback theme={theme} />}>
              <FlaggedResponsesPage
                theme={theme}
                reportedIssues={reportedIssues}
                setReportedIssues={setReportedIssues}
                reportedIssuesFilter={reportedIssuesFilter}
                setReportedIssuesFilter={setReportedIssuesFilter}
                ownerResolutionNotes={ownerResolutionNotes}
                setOwnerResolutionNotes={setOwnerResolutionNotes}
                effectiveTier={effectiveTier}
                requestOwnerPasscode={requestOwnerPasscode}
              />
              </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}


        </AnimatePresence>
          </div> {/* CLOSES centering wrapper */}
        </main>
      </div> {/* CLOSES flex-grow flex flex-col min-w-0 overflow-y-auto */}

      {/* Global Mismatch Reporting Modal */}
      <AnimatePresence>
        {reportingItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-55 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className={`w-full max-w-lg p-6 rounded-2xl border shadow-2xl text-left ${
                theme === "dark" ? "bg-[#0b1427] border-[#1c3258] text-white" : "bg-white border-stone-200 text-stone-900"
              }`}
            >
              <div className="flex justify-between items-center pb-3 border-b border-stone-200 dark:border-stone-800">
                <div className="flex items-center gap-2 min-w-0">
                  <Flag className="w-4 h-4 text-red-500 animate-pulse shrink-0" />
                  <h3 className="text-xs font-black uppercase tracking-wider truncate">
                    Flag "{reportingItem.pedInput}"
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setReportingItem(null)}
                  className="p-1 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 hover:text-white transition-colors cursor-pointer shrink-0"
                >
                  <XCircle className="w-5 h-5 font-bold" />
                </button>
              </div>

              <div className="py-4 text-left">
                <label className="block text-[10px] font-black uppercase tracking-wider text-stone-450 font-sans mb-1.5">
                  Reason for Flagging <span className="text-red-500 font-bold">*</span>
                </label>
                <textarea
                  required
                  autoFocus
                  rows={4}
                  value={reportingNotes}
                  placeholder="Explain what's wrong with this mapping..."
                  onChange={(e) => setReportingNotes(e.target.value)}
                  className="w-full text-xs p-3 rounded-xl border outline-none bg-stone-50 border-stone-250 dark:bg-stone-950 dark:border-stone-800 focus:border-red-500 focus:ring-1 focus:ring-red-500 font-semibold"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-stone-200 dark:border-stone-800">
                <button
                  type="button"
                  onClick={() => {
                    setReportingItem(null);
                    setReportingNotes("");
                  }}
                  className="px-4 py-2 text-xs font-bold text-stone-400 hover:text-[#111827] dark:hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <PrimaryCtaButton
                  theme={theme}
                  variant="danger"
                  disabled={!reportingNotes.trim()}
                  onClick={() => {
                    if (!reportingNotes.trim()) return;
                    const newIssue: ReportedIssue = {
                      id: "issue-" + Date.now(),
                      timestamp: new Date().toISOString(),
                      userEmail: currentUser?.email || "unknown@joinditto.in",
                      userName: currentUser?.name || "Advisor",
                      userTactId: currentUser?.tactId || "TACT-000",
                      planName: reportingItem.planName,
                      pedInput: reportingItem.pedInput,
                      matchedQuestion: reportingItem.mappedQuestion,
                      matchType: reportingItem.matchType,
                      source: reportingItem.source,
                      explanation: reportingItem.explanation,
                      issueNotes: reportingNotes,
                      status: "Pending",
                    };
                    setReportedIssues(prev => [newIssue, ...prev]);
                    setReportingItem(null);
                    setReportingNotes("");
                  }}
                >
                  Submit Report
                </PrimaryCtaButton>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Owner Passcode Verification Modal — gates destructive actions like permanent record deletion */}
      <AnimatePresence>
        {isPasscodeModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-55 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className={`w-full max-w-sm p-6 rounded-2xl border shadow-2xl text-left ${
                theme === "dark" ? "bg-[#0b1427] border-[#1c3258] text-white" : "bg-white border-stone-200 text-stone-900"
              }`}
            >
              <div className="flex justify-between items-center pb-3 border-b border-stone-200 dark:border-stone-800">
                <div className="flex items-center gap-2">
                  <LockKeyhole className="w-4 h-4 text-red-500" />
                  <h3 className="text-xs font-black uppercase tracking-wider">Owner Verification Required</h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsPasscodeModalOpen(false);
                    setPasscodeAttempt("");
                    setPasscodeError(null);
                  }}
                  className="p-1 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 hover:text-white transition-colors cursor-pointer"
                >
                  <XCircle className="w-5 h-5 font-bold" />
                </button>
              </div>

              <div className="space-y-4 py-4 text-left">
                <p className="text-xs font-semibold text-stone-500 dark:text-stone-400 leading-relaxed">
                  {passcodeActionLabel || "This is a destructive action."} Enter the owner passcode to confirm.
                </p>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-black uppercase tracking-wider text-stone-450 font-sans">
                    Owner Passcode
                  </label>
                  <input
                    type="password"
                    autoFocus
                    value={passcodeAttempt}
                    onChange={(e) => {
                      setPasscodeAttempt(e.target.value);
                      if (passcodeError) setPasscodeError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleVerifyPasscode();
                      }
                    }}
                    placeholder="Enter passcode"
                    className={`w-full text-xs font-semibold p-2.5 rounded-lg border outline-none ${
                      theme === "dark"
                        ? "bg-[#12151A] border-[#252A34] text-white focus:border-red-500"
                        : "bg-white border-stone-250 text-stone-850 focus:border-red-500 shadow-sm"
                    }`}
                  />
                  {passcodeError && (
                    <p className="text-[11px] font-bold text-red-500">{passcodeError}</p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-stone-200 dark:border-stone-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsPasscodeModalOpen(false);
                    setPasscodeAttempt("");
                    setPasscodeError(null);
                  }}
                  className="px-4 py-2 text-xs font-bold text-stone-400 hover:text-[#111827] dark:hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!passcodeAttempt}
                  onClick={handleVerifyPasscode}
                  className="px-5 py-2.5 text-xs font-black uppercase tracking-widest bg-red-600 hover:bg-red-700 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl transition-all shadow-md active:scale-97 cursor-pointer"
                >
                  Verify & Continue
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
}
