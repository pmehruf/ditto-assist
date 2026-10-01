/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared types/context/hook for the in-app confirm()/alert() system — split
 * out of DialogContext.tsx (2026-09) purely so that component file only
 * exports the component itself (Fast Refresh's react-refresh/only-export-
 * components rule: a file mixing component + hook/context exports loses hot-
 * reload isolation — same reasoning as specialInstructionTypes.ts's own
 * split). Consumed by DialogContext.tsx (which builds the Provider around
 * this context) and by every component that calls `useDialog()`.
 */

import { createContext, useContext } from "react";

export type DialogTone = "danger" | "neutral" | "info";

export interface ConfirmOptions {
  /** The question/statement itself — write it complete, e.g. `Delete "${name}"? This cannot be undone.` (no auto-appended boilerplate). */
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Default "danger" — a red confirm button + AlertTriangle icon, for delete/revoke actions. "neutral" is a plain accent button + HelpCircle icon, for non-destructive confirmations (e.g. a bulk field update). */
  tone?: DialogTone;
}

export interface AlertOptions {
  message: string;
  title?: string;
  okLabel?: string;
  /** Default "info". "danger" is used for failure/error notices. */
  tone?: DialogTone;
}

export type PendingDialog =
  | { id: number; kind: "confirm"; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { id: number; kind: "alert"; options: AlertOptions; resolve: (value: void) => void };

export interface DialogContextValue {
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
  alertUser: (options: AlertOptions | string) => Promise<void>;
}

export const DialogContext = createContext<DialogContextValue | null>(null);

/** Throws if called outside `<DialogProvider>` — a missing provider should
 * fail loudly during development, not silently no-op a confirmation. */
export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog() must be called within <DialogProvider> (see main.tsx)");
  return ctx;
}
