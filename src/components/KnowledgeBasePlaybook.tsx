/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BookOpen } from "lucide-react";
import { ConnectionRowCard, type BaseConnectionStatus } from "./connections/ConnectionRowCard";
import { iconColorFor } from "./connections/connectionIconColors";
import { formatPlaybookResyncMessage } from "./connections/playbookResyncMessage";

interface KnowledgeBasePlaybookProps {
  theme: "light" | "dark";
  /** Same resolveAccess()-backed evaluator every other governed feature's
   * page uses — see App.tsx's hasAccess(). Gates connect/disconnect/resync
   * on the "connections" governed feature (no longer a hardcoded
   * Developer-only exception as of 2026-09 — see featurePermissions.ts). */
  hasAccess: (featureId: string, actionType: "Viewer" | "Editor") => boolean;
  /** Bumped by ConnectionsPage.tsx's "Refresh All" to force a refetch. */
  refreshSignal?: number;
  /** Reports connected/attention state up for the page's summary stat bar. */
  onStatusChange?: (info: { connected: boolean; attention: boolean }) => void;
}

interface PlaybookConnectionStatus extends BaseConnectionStatus {
  resource: {
    status: "processing" | "active" | "error" | "archived";
    lastFetchedAt: string | null;
    errorMessage: string | null;
    planFactCount: number;
    narrativeChunkCount: number;
  } | null;
}

/**
 * "Product Playbook" row — one of the Connections page's "Data Sources".
 * Connect/disconnect the Playbook Sheet's own Google OAuth grant (separate
 * from the QA Dashboard's — see server.ts's /api/kb/playbook/* routes and
 * src/server/knowledgeBase/playbookIngest.ts) and trigger a manual resync.
 * A thin config wrapper around ConnectionRowCard (2026-09 redesign) — see
 * that component for the shared connect/disconnect/resync/stats mechanics;
 * this file supplies only what's actually specific to the Playbook: the
 * endpoints, copy, and its own resource fields.
 */
export function KnowledgeBasePlaybook({ theme, hasAccess, refreshSignal, onStatusChange }: KnowledgeBasePlaybookProps) {
  const dark = theme === "dark";
  const canManage = hasAccess("connections", "Editor");

  return (
    <ConnectionRowCard<PlaybookConnectionStatus>
      dark={dark}
      icon={<BookOpen className="w-4 h-4" />}
      iconColor={iconColorFor("violet", dark)}
      title="Product Playbook"
      purpose="The internal team's own plan-by-plan reference — takes precedence over general documents whenever it names exactly which sub-feature/variant applies to a plan (e.g. which bonus type is actually inbuilt)."
      usedBy="Product Assist's Q&A answers, whenever a plan-specific detail is being looked up."
      syncCadence="Refreshes automatically up to every 6 hours, only when someone actually opens a page that uses it. Use Resync to update it immediately after editing the Sheet."
      statusEndpoint="/api/kb/playbook/connection-status"
      connectHref="/api/kb/playbook/connect-google"
      disconnectEndpoint="/api/kb/playbook/connection"
      resyncEndpoint="/api/kb/playbook/resync"
      loadErrorFallback="Could not load the Product Playbook's connection status."
      gateByTier={{ canManage }}
      refreshSignal={refreshSignal}
      onStatusChange={onStatusChange}
      renderDetails={(status) => (
        <>
          {status.resource ? (
            <>
              Last synced: {status.resource.lastFetchedAt ? new Date(status.resource.lastFetchedAt).toLocaleString() : "never"} ·{" "}
              {status.resource.planFactCount} plan{status.resource.planFactCount === 1 ? "" : "s"} · {status.resource.narrativeChunkCount}{" "}
              reference excerpt{status.resource.narrativeChunkCount === 1 ? "" : "s"}
              {status.resource.status === "error" && (
                <span className={dark ? "text-red-300" : "text-red-600"}> · last sync failed: {status.resource.errorMessage}</span>
              )}
            </>
          ) : (
            "Never synced yet."
          )}
        </>
      )}
      formatResyncMessage={formatPlaybookResyncMessage}
    />
  );
}
