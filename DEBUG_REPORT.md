# Production Debug Report — Declaration Assistant WebApp

## Bugs Fixed

### 1. Announcement Card Had No Styling (Functional Bug)
**File:** `src/App.tsx`  
**What happened:** The `containerStyle` variable (which sets a color-coded gradient background + border based on announcement type — amber for Special Instructions, emerald for General, rose for QA) was being computed correctly but was **never applied** to the card `div`. The card always rendered as a plain unstyled box.  
**Fix:** Applied `containerStyle` + `border` + `rounded-2xl` to the wrapper `div`.

### 2. OverlapRuleCompliance Not Rendered (Missing Feature)
**File:** `src/App.tsx`  
**What happened:** The component was imported at line 77 but never rendered anywhere in JSX.  
**Fix:** Added `<OverlapRuleCompliance theme={theme} />` to the Declaration Map tab (below `<DisclosureMap />`).

---

## Dead Code Removed

### Dead Imports (2 removed)
- `PendingPedApproval` (default import) — component disabled, comment at line 10371 confirms
- `ExpandableRationale` — imported but never rendered anywhere

### Dead State Variables (4 removed)
- `resourcePlan` — declared, never read or set anywhere in the app
- `resourceSearch` — declared, never read or set anywhere
- `resourceTab` — declared, never read or set anywhere
- `tableSearchQuery` — declared, never read or set anywhere

### Dead State + Effect (1 removed)
- `pendingActivePeds` + its `useEffect` — state was initialized from localStorage and persisted back, but the value was never consumed anywhere in the UI or logic

### Dead useMemo Computations (3 removed)
- `suitabilityStats` — computed plan question stats for `SuitabilityExclusionsCard`, which is an orphaned file never imported
- `activeQueryStats` — same situation  
- `unregisteredUniquePeds` — computed a filtered PED list from audit logs, never referenced in JSX

---

## Orphaned Component Files (Not Removed)

These files exist in `/src/components/` but are not imported or rendered anywhere. They are harmless (won't affect the build) but are dead code:

- `WorkflowProgressTracker.tsx`
- `SuitabilityExclusionsCard.tsx`  
- `ExpandableRationale.tsx`

Delete them if no longer needed.

---

*All changes applied to `src/App.tsx`. File reduced from ~10,700 lines to ~11,015 lines (OverlapRuleCompliance addition offset the removals).*
