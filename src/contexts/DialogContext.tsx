/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * In-app confirm/alert dialogs — replaces the browser's native
 * `window.confirm()`/`window.alert()` (the plain OS-chrome popups that used
 * to interrupt every delete/revoke action and every save-error across the
 * app) with a themed modal that matches the rest of the UI, at the user's
 * explicit request ("I want the errors/confirmations to pop within the app
 * UI, like a proper system").
 *
 * Usage: call `useDialog()` (src/hooks/useDialog.ts) from any component
 * under `<DialogProvider>` (mounted once in main.tsx, so every component in
 * the tree has it with no prop-drilling) to get `{ confirm, alertUser }`:
 *
 *   const { confirm, alertUser } = useDialog();
 *   const ok = await confirm(`Delete "${name}"? This cannot be undone.`);
 *   if (!ok) return;
 *   ...
 *   await alertUser("Failed to save changes. Please try again.");
 *
 * Both accept either a plain string (message only, using the sensible
 * defaults below) or a full options object when a custom title/labels/tone
 * is useful. Both return a Promise so callers can `await` them exactly like
 * the native functions they replace — the only real behavior change from
 * `window.confirm`/`window.alert` is that these are async (non-blocking) and
 * rendered as themed React UI instead of native browser chrome.
 *
 * This file exports ONLY the `DialogProvider` component — the context
 * object, `useDialog()` hook, and option types live in
 * src/hooks/useDialog.ts instead, so Fast Refresh's react-refresh/only-
 * export-components rule keeps this component's hot-reload isolated (same
 * split specialInstructionTypes.ts uses for the same reason).
 *
 * Deliberately built with Tailwind's `dark:` variant (see index.css's
 * `@custom-variant dark (&:where(.dark, .dark *))`) rather than a `theme`
 * prop: this Provider is mounted once at the very root (main.tsx), outside
 * every page's own `theme` state, so it has no prop access to it — but it
 * doesn't need one, since `document.documentElement`'s "dark" class (see
 * App.tsx's theme effect) already drives every `dark:` class app-wide.
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, HelpCircle, Info, XCircle } from "lucide-react";
import { DialogContext, type AlertOptions, type ConfirmOptions, type DialogTone, type PendingDialog } from "../hooks/useDialog";

let nextDialogId = 1;

const TONE_ICON: Record<DialogTone, typeof AlertTriangle> = {
  danger: AlertTriangle,
  neutral: HelpCircle,
  info: Info,
};

const TONE_ICON_CLASS: Record<DialogTone, string> = {
  danger: "text-red-500 dark:text-red-400",
  neutral: "text-sky-600 dark:text-sky-400",
  info: "text-sky-600 dark:text-sky-400",
};

const TONE_CONFIRM_BUTTON_CLASS: Record<DialogTone, string> = {
  danger: "bg-red-600 hover:bg-red-700 text-white",
  neutral: "bg-sky-600 hover:bg-sky-700 text-white",
  info: "bg-sky-600 hover:bg-sky-700 text-white",
};

function defaultTitle(kind: "confirm" | "alert", tone: DialogTone): string {
  if (kind === "confirm") return tone === "danger" ? "Confirm Destructive Action" : "Confirm";
  return tone === "danger" ? "Error" : "Notice";
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<PendingDialog[]>([]);
  const current = queue[0];

  const confirm = useCallback((options: ConfirmOptions | string): Promise<boolean> => {
    const opts: ConfirmOptions = typeof options === "string" ? { message: options } : options;
    return new Promise<boolean>((resolve) => {
      setQueue((q) => [...q, { id: nextDialogId++, kind: "confirm", options: opts, resolve }]);
    });
  }, []);

  const alertUser = useCallback((options: AlertOptions | string): Promise<void> => {
    const opts: AlertOptions = typeof options === "string" ? { message: options } : options;
    return new Promise<void>((resolve) => {
      setQueue((q) => [...q, { id: nextDialogId++, kind: "alert", options: opts, resolve }]);
    });
  }, []);

  const settle = useCallback((result: boolean) => {
    setQueue((q) => {
      const [front, ...rest] = q;
      if (front) {
        if (front.kind === "confirm") front.resolve(result);
        else front.resolve();
      }
      return rest;
    });
  }, []);

  const value = useMemo(() => ({ confirm, alertUser }), [confirm, alertUser]);

  const tone: DialogTone = current?.options.tone ?? (current?.kind === "alert" ? "info" : "danger");
  const ToneIcon = current ? TONE_ICON[tone] : AlertTriangle;
  const title = current ? current.options.title || defaultTitle(current.kind, tone) : "";

  // Confirm dismisses as "cancel" (false); alert dismisses as plain
  // acknowledgment (no return value) — both via the same settle(false) path,
  // Escape and backdrop-click included, matching how a native
  // confirm()/alert() treats Escape/outside-click as "not confirmed".
  const dismiss = () => settle(false);

  return (
    <DialogContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {current && (
          <motion.div
            key={current.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[999] flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
            onClick={dismiss}
            onKeyDown={(e) => {
              if (e.key === "Escape") dismiss();
            }}
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              role={current.kind === "confirm" ? "alertdialog" : "alert"}
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm vp-modal vp-scroll p-6 rounded-2xl border shadow-2xl text-left bg-white border-stone-200 text-stone-900 dark:bg-[#0b1427] dark:border-[#1c3258] dark:text-white"
            >
              <div className="flex justify-between items-center pb-3 border-b border-stone-200 dark:border-stone-800">
                <div className="flex items-center gap-2">
                  <ToneIcon className={`w-4 h-4 shrink-0 ${TONE_ICON_CLASS[tone]}`} />
                  <h3 className="text-xs font-black uppercase tracking-wider">{title}</h3>
                </div>
                <button
                  type="button"
                  autoFocus
                  onClick={dismiss}
                  className="p-1 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 hover:text-stone-900 dark:hover:text-white transition-colors cursor-pointer"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              <div className="py-4 text-left">
                <p className="text-xs font-semibold text-stone-500 dark:text-stone-400 leading-relaxed whitespace-pre-line">
                  {current.options.message}
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-stone-200 dark:border-stone-800">
                {current.kind === "confirm" ? (
                  <>
                    <button
                      type="button"
                      onClick={dismiss}
                      className="px-4 py-2 text-xs font-bold text-stone-400 hover:text-stone-900 dark:hover:text-white cursor-pointer"
                    >
                      {current.options.cancelLabel || "Cancel"}
                    </button>
                    <button
                      type="button"
                      onClick={() => settle(true)}
                      className={`px-5 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-97 cursor-pointer ${TONE_CONFIRM_BUTTON_CLASS[tone]}`}
                    >
                      {current.options.confirmLabel || (tone === "danger" ? "Delete" : "Confirm")}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => settle(true)}
                    className={`px-5 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-97 cursor-pointer ${TONE_CONFIRM_BUTTON_CLASS[tone]}`}
                  >
                    {current.options.okLabel || "OK"}
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </DialogContext.Provider>
  );
}
