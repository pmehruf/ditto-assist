import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Search,
  UserPlus,
  AlertTriangle,
  Check,
  ShieldCheck,
  X,
  UserCheck
} from "lucide-react";
import { UserProfile } from "../types/user";
import { FeaturePermission } from "../types/permissions";

interface ProfileAccessManagementProps {
  usersList: UserProfile[];
  setUsersList: React.Dispatch<React.SetStateAction<UserProfile[]>>;
  currentUser: { email: string; name: string; tactId: string; tier: "General" | "Admin" | "Owner" };
  ownerPasscode?: string;
  setOwnerPasscode?: (code: string) => void;
  featurePermissions: FeaturePermission[];
  setFeaturePermissions: React.Dispatch<React.SetStateAction<FeaturePermission[]>>;
  defaultFeaturePermissions: FeaturePermission[];
  hasAccess: (featureId: string, actionType: "Viewer" | "Editor") => boolean;
}

export default function ProfileAccessManagement({
  usersList,
  setUsersList,
  currentUser,
  ownerPasscode = "1234",
  setOwnerPasscode,
  featurePermissions,
  setFeaturePermissions,
  defaultFeaturePermissions,
  hasAccess
}: ProfileAccessManagementProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [statusFilter, setStatusFilter] = useState<"All" | "Active" | "Pending">("All");
  const [subTab, setSubTab] = useState<"directory" | "permissions">("directory");

  // Managing/Editing properties
  const [editName, setEditName] = useState("");
  const [editTactId, setEditTactId] = useState("");
  const [editTier, setEditTier] = useState<"General" | "Admin" | "Owner">("General");

  // Invite states
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteTactId, setInviteTactId] = useState("");
  const [inviteTier, setInviteTier] = useState<"General" | "Admin" | "Owner">("General");
  const [inviteError, setInviteError] = useState<string | null>(null);

  const isOwner = currentUser.tier === "Owner" || hasAccess("profile_access", "Editor");

  // Filter users based on Search Input and Status tab
  const filteredUsers = usersList.filter(u => {
    const term = searchQuery.toLowerCase().trim();
    const matchesQuery = (
      u.name.toLowerCase().includes(term) ||
      u.email.toLowerCase().includes(term) ||
      u.tactId.toLowerCase().includes(term) ||
      u.tier.toLowerCase().includes(term)
    );
    const matchesStatus = (
      statusFilter === "All" ||
      (statusFilter === "Active" && u.status === "Active") ||
      (statusFilter === "Pending" && u.status !== "Active")
    );
    return matchesQuery && matchesStatus;
  });

  const handleRowClick = (user: UserProfile) => {
    setSelectedUser(user);
    setEditName(user.name);
    setEditTactId(user.tactId);
    setEditTier(user.tier);
  };

  const handleSaveProfile = () => {
    if (!selectedUser) return;

    // Safety check: Cannot demote themselves
    if (selectedUser.email.toLowerCase() === currentUser.email.toLowerCase() && editTier !== "Owner") {
      alert("Demotion Restrained: An owner cannot demote themselves. There must be at least one owner present.");
      return;
    }

    setUsersList(prev => prev.map(u => {
      if (u.email.toLowerCase() === selectedUser.email.toLowerCase()) {
        return {
          ...u,
          name: editName.trim(),
          tactId: editTactId.trim(),
          tier: editTier
        };
      }
      return u;
    }));

    setSelectedUser(null);
  };

  const handleInviteUser = (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError(null);

    const name = inviteName.trim();
    const email = inviteEmail.trim().toLowerCase();
    const tact = inviteTactId.trim().toUpperCase();

    if (!name || !email || !tact) {
      setInviteError("All fields are required.");
      return;
    }

    if (!email.includes("@")) {
      setInviteError("Invalid email address format.");
      return;
    }

    // Check if email already exists
    const duplicate = usersList.find(u => u.email.toLowerCase() === email);
    if (duplicate) {
      setInviteError("An adviser or team member with this email already exists.");
      return;
    }

    const newUser: UserProfile = {
      name,
      email,
      tactId: tact,
      tier: inviteTier,
      status: "Pending First Login"
    };

    setUsersList(prev => [...prev, newUser]);
    setIsInviteModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* PAGE HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-ditto-border">
        <div>
          <h1 className="text-xl md:text-2xl font-black tracking-tight text-white flex items-center gap-2">
            <div className="w-8 h-0.5 flex-shrink-0 bg-[#00D3F3]" />
            <span>Profile & Access Management</span>
          </h1>
          <p className="text-xs text-stone-400 font-semibold mt-1.5 leading-relaxed">
            View and manage adviser profiles, active access tiers, and system administrative scopes.
          </p>
        </div>
      </div>

      {/* Dynamic Sub-tab Navigation */}
      <div className="flex border-b border-ditto-border pb-1 gap-6">
        <button
          type="button"
          onClick={() => setSubTab("directory")}
          className={`pb-2 px-1 text-xs uppercase tracking-wider font-extrabold transition-all cursor-pointer relative ${
            subTab === "directory"
              ? "text-white font-black"
              : "text-stone-400 hover:text-stone-200"
          }`}
        >
          <span>Team Directory</span>
          {subTab === "directory" && (
            <motion.div
              layoutId="subTabHighlight"
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-ditto-blue"
            />
          )}
        </button>
      </div>

      {/* TAB 1: TEAM DIRECTORY */}
      {subTab === "directory" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* FIRST COLUMN - USERS LIST (Full width if not owner, otherwise 2/3 width) */}
          <div className={`${currentUser.tier === "Owner" ? "lg:col-span-2" : "lg:col-span-3"} space-y-4`}>
          <div className="rounded-2xl border bg-ditto-card border-ditto-border p-5 shadow-xl">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3.5 mb-5 pb-3 border-b border-ditto-border">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest select-none border border-cyan-500 bg-blue-950/40 text-white shadow-[0_0_15px_rgba(6,182,212,0.35)] w-max">
                  <UserCheck className="w-3.5 h-3.5 text-white" />
                  <span>Active Organization Directory ({usersList.length} Accounts)</span>
                </div>
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => {
                      setInviteName("");
                      setInviteEmail("");
                      setInviteTactId(`TACT-${101 + usersList.length}`);
                      setInviteTier("General");
                      setInviteError(null);
                      setIsInviteModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 shadow-sm border border-emerald-500/20 cursor-pointer active:scale-95 transition-all w-max"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Invite Advisor</span>
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Filter Tabs */}
                <div className="flex bg-ditto-dark p-1 rounded-xl border border-ditto-border">
                  {(["All", "Active", "Pending"] as const).map(tab => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setStatusFilter(tab)}
                      className={`px-2.5 py-1 text-[9px] uppercase font-bold tracking-wider rounded-lg transition-all cursor-pointer ${
                        statusFilter === tab
                          ? "bg-ditto-blue text-white"
                          : "text-stone-400 hover:text-white"
                      }`}
                    >
                      {tab === "Pending" ? "Pending Login" : tab}
                    </button>
                  ))}
                </div>

                <div className="relative w-full sm:w-44">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-450" />
                  <input
                    type="text"
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full text-xs pl-8 pr-3 py-1.5 rounded-xl border outline-none bg-ditto-dark border-ditto-border text-stone-200 placeholder:text-stone-500 font-semibold focus:border-ditto-blue focus:ring-1 focus:ring-ditto-blue"
                  />
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-ditto-border text-stone-400 uppercase tracking-wider text-[10px] font-bold">
                    <th className="py-3 px-4">User / Email</th>
                    <th className="py-3 px-4">TACT ID</th>
                    <th className="py-3 px-4">Profile Tier</th>
                    <th className="py-3 px-4">Account Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ditto-border/50">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-stone-500 font-semibold">
                        No team accounts found matching query.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((user) => (
                      <tr
                        key={user.email}
                        onClick={() => handleRowClick(user)}
                        className="hover:bg-ditto-card-hover transition-colors cursor-pointer"
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-ditto-dark border border-ditto-blue/25 text-ditto-blue-light font-black flex items-center justify-center text-xs select-none uppercase shadow-xs">
                              {user.name.charAt(0)}
                            </div>
                            <div>
                              <p className="font-extrabold text-white">{user.name}</p>
                              <p className="text-[10px] text-stone-455 font-medium">{user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono font-semibold text-stone-300">
                          {user.tactId}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider ${
                            user.tier === "Owner"
                              ? "bg-red-500/15 text-red-400 border border-red-500/10"
                              : user.tier === "Admin"
                              ? "bg-amber-500/15 text-amber-400 border border-amber-500/10"
                              : "bg-ditto-blue/15 text-sky-350 border border-ditto-blue/20"
                          }`}>
                            {user.tier}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex px-2 py-0.5 rounded-md text-[9px] font-bold ${
                            user.status === "Active"
                              ? "bg-emerald-500/15 text-emerald-400"
                              : "bg-stone-500/15 text-stone-400 animate-pulse border border-ditto-border"
                          }`}>
                            {user.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* TAB 2: FEATURE ACCESS MATRIX - MOUNT OVERRIDES */}
      {subTab === "permissions" && !isOwner && (
        <div className="rounded-2xl border bg-ditto-card border-ditto-border p-8 md:p-12 shadow-xl text-center max-w-2xl mx-auto space-y-5">
          <div className="w-16 h-16 rounded-full bg-red-400/10 border border-red-500/20 flex items-center justify-center mx-auto text-red-400">
            <AlertTriangle className="w-8 h-8 animate-pulse text-red-400" />
          </div>
          <div className="space-y-2">
            <h2 className="text-base font-black text-white uppercase tracking-wider">
              Security Barrier: Exclusive Owner Space
            </h2>
            <p className="text-xs text-stone-400 font-semibold max-w-md mx-auto leading-relaxed">
              Your active permission identity is <span className="text-amber-400 font-black uppercase">{currentUser.tier}</span>. Modifying feature access overrides, permission tiers, and systemic bypass controls is restricted strictly to the <span className="text-red-400 font-black uppercase">System Owner</span>.
            </p>
          </div>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setSubTab("directory")}
              className="px-5 py-2 text-[10px] bg-stone-800 hover:bg-stone-700 text-stone-200 hover:text-white rounded-xl font-extrabold uppercase tracking-widest cursor-pointer transition-all active:scale-95"
            >
              Back to Team Directory
            </button>
          </div>
        </div>
      )}

      {subTab === "permissions" && isOwner && (
        <div className="rounded-2xl border bg-ditto-card border-ditto-border p-5 shadow-xl text-left space-y-6">
          <div className="pb-3 border-b border-ditto-border mb-4">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest select-none border border-cyan-500 bg-blue-950/40 text-white shadow-[0_0_15px_rgba(6,182,212,0.35)] mb-2">
              <ShieldCheck className="w-3.5 h-3.5 text-white animate-pulse" />
              <span>Systemic Feature Governance Console</span>
            </div>
            <p className="text-xs text-stone-400 font-semibold mt-1 leading-relaxed">
              Dynamically override access levels across the workspace. General users and Admins can be promoted to viewers or editors of privileged modules, or restricted from seeing them.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-ditto-border text-stone-400 uppercase tracking-wider text-[10px] font-bold">
                  <th className="py-3 px-4 w-[40%]">Feature Workspace Module</th>
                  <th className="py-3 px-4 text-center">Default Level</th>
                  <th className="py-3 px-4">General User Access</th>
                  <th className="py-3 px-4">Admin Access</th>
                  <th className="py-3 px-4 text-right">Owner Control</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ditto-border/50">
                {featurePermissions.map((perm) => (
                  <tr key={perm.id} className="hover:bg-ditto-card-hover transition-colors">
                    <td className="py-4 px-4 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-white text-xs">{perm.name}</span>
                        <code className="text-[10px] font-mono px-1.5 py-0.2 bg-ditto-dark text-stone-400 rounded-md">
                          {perm.id}
                        </code>
                      </div>
                      <p className="text-[11px] text-stone-400 font-semibold leading-relaxed">
                        {perm.description}
                      </p>
                    </td>
                    <td className="py-4 px-4 text-center">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${
                        perm.defaultTier === "Owner"
                          ? "bg-red-500/10 text-red-500 border border-red-500/10"
                          : perm.defaultTier === "Admin"
                          ? "bg-amber-500/10 text-amber-500 border border-amber-500/10"
                          : "bg-blue-500/10 text-sky-500 border border-blue-500/10"
                      }`}>
                        {perm.defaultTier}
                      </span>
                    </td>
                    <td className="py-4 px-4 font-semibold">
                      <div className="flex bg-ditto-dark p-0.5 rounded-lg border border-ditto-border max-w-[210px]">
                        {(["None", "Viewer", "Editor"] as const).map(opt => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => {
                              setFeaturePermissions(prev => prev.map(p => {
                                if (p.id === perm.id) {
                                  return { ...p, generalAccess: opt };
                                }
                                return p;
                              }));
                            }}
                            className={`flex-1 px-2 py-1 text-[9px] uppercase font-bold tracking-wider rounded-md transition-all cursor-pointer ${
                              perm.generalAccess === opt
                                ? opt === "None"
                                  ? "bg-red-500/20 text-red-400 border border-red-500/10"
                                  : opt === "Viewer"
                                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/10"
                                  : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/11"
                                : "text-stone-400 hover:text-white"
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="py-4 px-4 font-semibold">
                      <div className="flex bg-ditto-dark p-0.5 rounded-lg border border-ditto-border max-w-[210px]">
                        {(["None", "Viewer", "Editor"] as const).map(opt => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => {
                              setFeaturePermissions(prev => prev.map(p => {
                                if (p.id === perm.id) {
                                  return { ...p, adminAccess: opt };
                                }
                                return p;
                              }));
                            }}
                            className={`flex-1 px-2 py-1 text-[9px] uppercase font-bold tracking-wider rounded-md transition-all cursor-pointer ${
                              perm.adminAccess === opt
                                ? opt === "None"
                                  ? "bg-red-500/20 text-red-400 border border-red-500/10"
                                  : opt === "Viewer"
                                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/10"
                                  : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/11"
                                : "text-stone-400 hover:text-white"
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="py-4 px-4 text-right">
                      <span className="inline-flex px-2 py-0.5 bg-rose-500/10 text-rose-400 text-[8.5px] font-black uppercase tracking-wider rounded-lg border border-rose-500/10">
                        Locked (Editor)
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Preset Buttons for easy setting */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pt-4 border-t border-ditto-border">
            <span className="text-[10px] text-stone-450 font-semibold leading-relaxed">
              Changes take effect instantly for all team members. Use the **Shield icon** in the top rail to test different persona perspectives!
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setFeaturePermissions(defaultFeaturePermissions);
                }}
                className="px-3 py-1.5 border border-stone-800 hover:border-stone-600 text-stone-400 hover:text-white text-[10px] font-extrabold uppercase tracking-wider rounded-xl cursor-pointer transition-all hover:bg-white/5"
              >
                Restore Factory Defaults
              </button>
            </div>
          </div>
        </div>
      )}

      {/* POP-OUT PROFILE CARD DETAILS MODAL */}
      <AnimatePresence>
        {selectedUser && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="w-full max-w-sm rounded-[20px] bg-ditto-card border border-ditto-border p-6 text-left shadow-2xl relative"
            >
              <button
                onClick={() => setSelectedUser(null)}
                className="absolute right-4 top-4 p-1 rounded-lg text-stone-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-3 mb-5 pb-3 border-b border-ditto-border">
                <div className="w-10 h-10 rounded-full bg-ditto-blue/20 text-ditto-blue-light border border-ditto-blue/20 font-black text-sm flex items-center justify-center shadow-xs">
                  {selectedUser.name.charAt(0)}
                </div>
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">
                    {isOwner ? "Manage Profile Card" : "Profile Card (Read Only)"}
                  </h3>
                  <p className="text-[10px] text-stone-400 font-semibold">
                    Workforce Token Directory Entry
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[9px] font-black text-stone-400 mb-1 uppercase tracking-wider">
                    Full Name
                  </label>
                  <input
                    type="text"
                    disabled={!isOwner}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full text-xs px-3.5 py-2 rounded-xl outline-none bg-ditto-dark border border-ditto-border text-stone-200 font-bold focus:border-ditto-blue focus:ring-1 focus:ring-ditto-blue disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-[9px] font-black text-stone-400 mb-1 uppercase tracking-wider">
                    TACT ID Code
                  </label>
                  <input
                    type="text"
                    disabled={!isOwner}
                    value={editTactId}
                    onChange={(e) => setEditTactId(e.target.value)}
                    className="w-full text-xs px-3.5 py-2 rounded-xl outline-none bg-ditto-dark border border-ditto-border text-stone-200 font-mono font-bold focus:border-ditto-blue focus:ring-1 focus:ring-ditto-blue disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>

                <div>
                   <label className="block text-[9px] font-black text-stone-400 mb-1 uppercase tracking-wider">
                    Access Level Tier
                  </label>
                  <select
                    disabled={!isOwner}
                    value={editTier}
                    onChange={(e) => setEditTier(e.target.value as "General" | "Admin" | "Owner")}
                    className="w-full text-xs px-3 py-2 outline-none rounded-xl bg-ditto-dark border border-ditto-border text-stone-200 font-bold focus:border-ditto-blue focus:ring-1 focus:ring-ditto-blue disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <option value="General">General (Advisor)</option>
                    <option value="Admin">Admin</option>
                    <option value="Owner">Owner</option>
                  </select>
                </div>

                <div className="pt-2">
                  {isOwner ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setSelectedUser(null)}
                        className="flex-1 py-2 text-[10px] uppercase font-extrabold tracking-widest text-stone-400 bg-ditto-dark border border-ditto-border rounded-xl hover:text-white hover:bg-ditto-card-hover cursor-pointer text-center"
                      >
                        Discard
                      </button>
                      <button
                        onClick={handleSaveProfile}
                        className="flex-1 py-2 text-[10px] uppercase font-extrabold tracking-widest text-white bg-ditto-blue rounded-xl hover:bg-ditto-blue-light cursor-pointer text-center flex items-center justify-center gap-1.5 shadow-sm"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Commit</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setSelectedUser(null)}
                      className="w-full py-2 bg-ditto-dark border border-ditto-border hover:bg-ditto-card-hover text-white/90 text-[10px] font-extrabold uppercase tracking-widest rounded-xl cursor-pointer text-center"
                    >
                      Dismiss Dialog
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}

        {isInviteModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="w-full max-w-sm rounded-[20px] bg-ditto-card border border-ditto-border p-6 text-left shadow-2xl relative"
            >
              <button
                onClick={() => setIsInviteModalOpen(false)}
                className="absolute right-4 top-4 p-1 rounded-lg text-stone-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-3 mb-5 pb-3 border-b border-ditto-border">
                <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-black text-sm flex items-center justify-center shadow-xs">
                  <UserPlus className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">
                    Invite Advisor
                  </h3>
                  <p className="text-[10px] text-stone-400 font-semibold">
                    Register a new member to the directory
                  </p>
                </div>
              </div>

              {inviteError && (
                <div className="bg-red-950/40 border border-red-900 text-red-400 p-3 rounded-xl text-xs font-semibold leading-relaxed mb-4">
                  <span>{inviteError}</span>
                </div>
              )}

              <form onSubmit={handleInviteUser} className="space-y-4">
                <div>
                  <label className="block text-[9px] font-black text-stone-400 mb-1 uppercase tracking-wider">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Enter full name"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    className="w-full text-xs px-3.5 py-2 rounded-xl outline-none bg-ditto-dark border border-ditto-border text-stone-200 font-bold focus:border-ditto-blue focus:ring-1 focus:ring-ditto-blue"
                  />
                </div>

                <div>
                  <label className="block text-[9px] font-black text-stone-400 mb-1 uppercase tracking-wider">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="advisor-name@joinditto.in"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="w-full text-xs px-3.5 py-2 rounded-xl outline-none bg-ditto-dark border border-ditto-border text-stone-200 font-bold focus:border-ditto-blue focus:ring-1 focus:ring-ditto-blue"
                  />
                </div>

                <div>
                  <label className="block text-[9px] font-black text-stone-400 mb-1 uppercase tracking-wider">
                    TACT ID Code
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="TACT-###"
                    value={inviteTactId}
                    onChange={(e) => setInviteTactId(e.target.value)}
                    className="w-full text-xs px-3.5 py-2 rounded-xl outline-none bg-ditto-dark border border-ditto-border text-stone-200 font-mono font-bold focus:border-ditto-blue focus:ring-1 focus:ring-ditto-blue"
                  />
                </div>

                <div>
                   <label className="block text-[9px] font-black text-stone-400 mb-1 uppercase tracking-wider">
                    Access Level Tier
                  </label>
                  <select
                    value={inviteTier}
                    onChange={(e) => setInviteTier(e.target.value as "General" | "Admin" | "Owner")}
                    className="w-full text-xs px-3 py-2 outline-none rounded-xl bg-ditto-dark border border-ditto-border text-stone-200 font-bold focus:border-ditto-blue focus:ring-1 focus:ring-ditto-blue"
                  >
                    <option value="General">General (Advisor)</option>
                    <option value="Admin">Admin</option>
                    <option value="Owner">Owner</option>
                  </select>
                </div>

                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsInviteModalOpen(false)}
                    className="flex-1 py-2 text-[10px] uppercase font-extrabold tracking-widest text-stone-400 bg-ditto-dark border border-ditto-border rounded-xl hover:text-white hover:bg-ditto-card-hover cursor-pointer text-center"
                  >
                    Discard
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2 text-[10px] uppercase font-extrabold tracking-widest text-white bg-emerald-600 rounded-xl hover:bg-emerald-500 cursor-pointer text-center flex items-center justify-center gap-1.5 shadow-sm border-none"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Invite</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
