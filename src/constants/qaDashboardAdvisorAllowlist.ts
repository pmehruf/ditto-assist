/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * QA DASHBOARD — ADVISOR ALLOWLIST (DEPRECATED, no longer read anywhere)
 * ---------------------------------------------------------------
 * 2026-08-07: removed from qaDataEngine.ts/qaDashboardService.ts. This
 * static, manually-maintained list of TACT IDs drifted out of sync with
 * the real roster (118 shown here vs. 132 actually "Currently Employed" in
 * master_advisors) because nothing kept it updated as advisors joined or
 * left. Advisor eligibility for the roster views is now derived LIVE from
 * master_advisors column M ("Status" = "Currently Employed"), matching the
 * QA team's own source-of-truth spreadsheet formula — see
 * EMPLOYED_STATUS_VALUES in qaDataEngine.ts. Left in place (unused) rather
 * than deleted, in case anything still imports it or a rollback is needed.
 *
 * Original doc, for history:
 * Ported verbatim from the standalone QA Dashboard's SCORE_DASHBOARD_TACT_IDS
 * (BackendAPI.gs). Only these TACT IDs used to appear in the admin/guide/
 * mentor picker and the landing-page summary table.
 */
export const QA_SCORE_DASHBOARD_TACT_IDS = new Set<string>([
  "TACT487", "TACT493", "TACT546", "TACT548", "TACT590", "TACT609", "TACT642",
  "TACT659", "TACT686", "TACT712", "TACT714", "TACT737", "TACT739", "TACT768",
  "TACT772", "TACT804", "TACT851", "TACT854", "TACT857", "TACT873", "TACT874",
  "TACT878", "TACT899", "TACT902", "TACT905", "TACT929", "TACT930", "TACT932",
  "TACT933", "TACT945", "TACT946", "TACT947", "TACT948", "TACT950", "TACT975",
  "TACT985", "TACT1005", "TACT1006", "TACT1007", "TACT1016", "TACT1050",
  "TACT1092", "TACT1098", "TACT1060", "TACT1103", "TACT1116", "TACT1217",
  "TACT1229", "TACT1221", "TACT1228", "TACT1222", "TACT1225", "TACT1388",
  "TACT1389", "TACT1391", "TACT1392", "TACT1397", "TACT1400", "TACT1401",
  "TACT1710", "TACT1712", "TACT1719", "TACT1713", "TACT1717", "TACT1711",
  "TACT1524", "TACT1538", "TACT1540", "TACT1522", "TACT1529", "TACT1526",
  "TACT1532", "TACT1545", "TACT1533", "TACT1527", "TACT1521", "TACT1544",
  "TACT1528", "TACT1541", "TACT1525", "TACT1535", "TACT1810", "TACT1812",
  "TACT1813", "TACT1814", "TACT1815", "TACT1817", "TACT1818", "TACT1819",
  "TACT1669", "TACT1662", "TACT1664", "TACT1667", "TACT1671", "TACT1678",
  "TACT1666", "TACT1665", "TACT1661", "TACT1670", "TACT1829", "TACT1830",
  "TACT1833", "TACT1834", "TACT1840", "TACT1841", "TACT1832", "TACT1843",
  "TACT1842", "TACT1837", "TACT2108", "TACT2110", "TACT2112", "TACT2114",
  "TACT2115", "TACT2120", "TACT2121", "TACT2133", "TACT2291", "TACT2294",
  "TACT2295", "TACT2315", "TACT2321", "TACT1394", "TACT2318",
]);
