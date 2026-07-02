# App.tsx Internal Structure Map (Phase 1.1)

Produced ahead of decomposing `App()` into page components. `App()` itself spans
`src/App.tsx:121-9057` (~8,940 lines). Everything above line 121 is already
extracted (types/constants/utils/components — see Phase 1 prior work).

## 1. Tabs and their render sections

`activeTab` (line 123) drives which section renders. Confirmed render ranges:

| Tab value | Render lines | Notes |
|---|---|---|
| `lookup` (intro) | 3801-4081 | Landing/search screen (`showIntro === true`) |
| `lookup` (results) | 4081-5935 | Main PED lookup + results UI (`showIntro === false`) |
| `audit` | 5935-6533 | Audit/modification history sub-tabs |
| `my_activity` | 6533-7426 | Per-user activity log |
| `resources` | 7426-7460 | Static resources tab |
| `testing` | 7460-8332 | "Testing Workshop" — contains nested `testingSubTab` ("batch"/"smoke") |
| `profile_access` | 8332-8355 | Profile/role management (target of removal in Phase 4) |
| `plan_scope` | 8355-8383 | Plan scope manager |
| `qa_announcement_log` | 8383-8651 | Announcement authoring/log |
| `flagged_responses` | 8651-9057 | Reported/flagged output review |

**Dead union members confirmed:** the `activeTab` type (line 123) also lists
`"matrix"`, `"smoke"`, and `"active_questions"` — none of these ever appear in
a `setActiveTab(...)` call. `"matrix"`/`"smoke"` logic actually lives inside
the `testing` tab via `testingSubTab`, and `active_questions` is fully
unreachable. Candidate cleanup for Phase 1.5 (narrow the type to the 9 real
values).

## 2. State ownership (106 `useState` hooks in `App()`)

Grouped by the feature area that owns them (line numbers refer to the
declaration site):

- **Nav/shell (cross-tab):** `activeTab`(123), `showIntro`(280), `isMenuOpen`(281),
  `isMobileWindow`(282), `isRightSidebarOpen`(292), `profileOpen`(293), `theme`(845),
  `sidebarHeight`(1458)
- **Auth/session (cross-tab):** `currentUser`(303), `usersList`(312), `simulatedRole`(608),
  `featurePermissions`(637), `ownerPasscode`/passcode-modal state(673-693),
  login form state(886-890), SSO temp state(868-871)
- **Announcements:** `qaAnnouncements`(124), `noticeIndex`/`slideDirection`(247-248),
  `deletingAnnouncementId`/`editingAnnouncementId`/`confirmingResetDefaults`(1284-1286)
- **Plans/questions admin:** `draftPlans`(396), `productionPlans`(442), `promotedPlans`(457),
  `insurerMetadata`(472), `planQuestionsState`(542), `dictionaryVersion`(842)
- **Audit/change history:** `changeLogs`(494) — type is `any[]` (Phase 1.4 target),
  `auditSubTab`/`historySearch`/`historyActionFilter`(537-539),
  `auditLogs`/`auditSearch`/filters(893-898)
- **My Activity tab:** `myActivitySearch`, plan filter, date range, `expandedLogIndex`(296-300)
- **Lookup tab (main feature):** `selectedPlan`, `illnessSearchQuery`, `pedInput`,
  suggestion state, `mappingUpdateStatus`, advisory toggles, `resultsFocusMode`,
  `lookupPeds`, `lookupResults`(`any`-shaped array, Phase 1.4 target), `isLookupLoading`,
  `copiedPedMap`(1176-1217); plus sandbox/ledger demo state(264-269)
- **Flagged responses / reporting:** `reportedIssues`, `reportingItem`, `reportingNotes`,
  `reportingPriority`, `reportedIssuesFilter`, `ownerResolutionNotes`(1239-1281)
- **Matrix / Smoke test (legacy, folded into Testing tab):** `matrixPlanSelected`...`matrixLogicFilter`
  (1391-1413), `isSmokeRunning`...`leakExportMessage`(1418-1449)

## 3. Cross-tab dependency surface

State read by **more than one tab** (i.e. must move to shared/centralized state
first, since page-splitting will otherwise require prop-drilling them anyway):

`currentUser`, `theme`/`isDark`, `simulatedRole`/`effectiveTier`, `featurePermissions`
(via `hasAccess()`), `activeTab`/`showIntro`, `usersList`, `qaAnnouncements`
(referenced by the notice ticker on every tab), `isMobileWindow`, `isMenuOpen`/
`isRightSidebarOpen`.

Everything else in section 2 is read/written only within its own tab's render
range and is a safe candidate to co-locate with that tab's extracted page
component.

## 4. Persistence pattern (localStorage) — 13 of 23 `useEffect`s

Nearly every piece of admin/cross-cutting state is synced to `localStorage`
via its own dedicated `useEffect` (one `JSON.stringify` + `setItem` call per
state variable): `qaAnnouncements`(188), `usersList`(325), `draftPlans`(435),
`productionPlans`(450), `promotedPlans`(465), `insurerMetadata`(487),
`changeLogs`(530), `planQuestionsState`(601), `simulatedRole`(616),
`featurePermissions`(646), `reportedIssues`(1263), `theme`(1503), plus initial
hydration effects (e.g. `ditto_ped_search_history` at 1515).

This is the single biggest source of boilerplate in `App()` and the clearest
argument for Phase 1.2's centralized state layer: a `usePersistentState(key,
initial)` hook (or a reducer + single persistence middleware) can collapse
these ~13 duplicate effects into one reusable primitive, and doubles as the
seam where Phase 4's real-database migration will plug in later (swap the
localStorage read/write for a Data Access Layer call without touching the
UI code that owns the state).

## 5. Other cross-cutting `useEffect`s (10 non-persistence)

Window resize listener(284), drawer focus-trap(344), dark-mode class
toggle(859), route-guard on tab access via `hasAccess`(874), notice
ticker rotation(250), initial scroll-to-top(272), midnight audit-log
reset scheduler(1834), lookup-results-cleared-on-empty-input(1986),
scroll-to-first-match-on-results(1993), lookup tab height sync(1461).

## 6. Handler functions defined directly in `App()`

~30+ inline handlers before the JSX return (return starts ~line 2900+),
including `hasAccess`, `setOwnerPasscode`/`requestOwnerPasscode`/
`handleVerifyPasscode`, `toggleUserRole`, `checkIllnessInPlanSpecificList`,
`saveAuditLog`, `handleClearAuditHistory`, `findCategoryForQuestion`,
`handlePersistMapping` (calls `/api/add-ped-mapping`), `getPlanTheme`,
`validateEmailDomain`/`handleGoogleSSO`/`selectSSOAccount`/
`handleCustomSSOSubmit`/`handleProfileCompletion`/`handleLogout`,
`executeLookupAll` (calls `/api/match`), `handleClearLookupFields`,
`handleMapAnotherPed`, `handleWorkflowStepClick`, `handlePreFillDemoData`,
`handleAddLookupPed`, `handleAddMatrixPed`/`handleClearMatrixPeds`/
`runMatrixLiveTest`, `getSmokeLeaks`/`handleExportLeaks`, `downloadCSV`,
`formatMarkdownText`, `renderSidebarContent`.

Each belongs clearly to one feature area above and can move with its
corresponding page component in Phase 1.3.

## 7. Decomposition plan this map supports

1. **Phase 1.2** — introduce a shared context (session/theme/permissions/
   plans/users) plus a `usePersistentState` hook to remove the 13 duplicate
   localStorage effects.
2. **Phase 1.3** — extract one `src/pages/*.tsx` per real tab (9, after
   dropping the 3 dead union members), each pulling shared state from
   context and owning its local state + handlers per section 2/6 above.
3. **Phase 1.4** — while moving `changeLogs`/`lookupResults`/`onPasscodeSuccess`
   out of `App()`, give them real interfaces instead of `any`.
