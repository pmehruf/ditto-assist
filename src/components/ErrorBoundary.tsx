/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

// ─────────────────────────────────────────────
// ErrorBoundary
// ─────────────────────────────────────────────
// React error boundaries must be class components (there is no Hooks
// equivalent of getDerivedStateFromError / componentDidCatch as of React 19).
// Used to wrap each lazily-loaded tab (Phase 2: Performance) so that a
// render-time crash in one tab's content is contained to that tab instead
// of unmounting the entire app shell (nav, header, modals, etc.).
interface ErrorBoundaryProps {
  children: ReactNode;
  theme?: "light" | "dark";
  /** Human-readable name of the section being guarded, e.g. "Activity Log". */
  label?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  // Explicit field type annotations below because this project has no
  // @types/react installed (React 19 ships without bundled TS types here);
  // without them, TypeScript infers `Component`'s generics from React's
  // plain-JS source instead of the declared ErrorBoundaryProps/State, and
  // `this.props`/`this.state` fail to resolve. `declare` on `props` avoids
  // emitting a redundant assignment (the base Component constructor already
  // sets it), while `state` needs a real assignment below.
  declare props: ErrorBoundaryProps;
  declare setState: (
    state: Partial<ErrorBoundaryState> | ((prev: ErrorBoundaryState) => Partial<ErrorBoundaryState>),
    callback?: () => void
  ) => void;
  state: ErrorBoundaryState;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Surfaced to the console for diagnosis; deliberately does not use any
    // remote logging service, since none exists in this codebase.
    console.error(
      `[ErrorBoundary${this.props.label ? `: ${this.props.label}` : ""}] Caught render error:`,
      error,
      errorInfo
    );
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const theme = this.props.theme ?? "dark";
      return (
        <div
          className={`rounded-2xl border p-8 md:p-12 shadow-xl text-center max-w-2xl mx-auto space-y-5 ${
            theme === "dark" ? "bg-[#14161a] border-stone-800" : "bg-white border-stone-200 shadow-sm"
          }`}
        >
          <div className="w-16 h-16 rounded-full bg-red-400/10 border border-red-500/20 flex items-center justify-center mx-auto text-red-400">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2
              className={`text-base font-black uppercase tracking-wider ${
                theme === "dark" ? "text-white" : "text-[#111827]"
              }`}
            >
              {this.props.label ? `${this.props.label} hit an error` : "Something went wrong"}
            </h2>
            <p
              className={`text-xs font-semibold max-w-md mx-auto leading-relaxed ${
                theme === "dark" ? "text-stone-400" : "text-stone-600"
              }`}
            >
              This section couldn't render due to an unexpected error. The rest of the app is unaffected —
              try reloading this section below.
            </p>
          </div>
          <div className="pt-2">
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center gap-1.5 px-5 py-2 text-[10px] bg-stone-800 hover:bg-stone-700 text-stone-200 hover:text-white rounded-xl font-extrabold uppercase tracking-widest cursor-pointer transition-all active:scale-95"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// ───────────────────────────────────────────
// TabLoadingFallback
// ───────────────────────────────────────────
// Suspense fallback shown while a lazily-loaded tab's chunk is being
// fetched. Mirrors the RefreshCw + animate-spin loading convention already
// used elsewhere in App.tsx (e.g. the lookup submit button's busy state).
export function TabLoadingFallback({ theme = "dark" }: { theme?: "light" | "dark" }) {
  return (
    <div className="flex items-center justify-center py-24">
      <RefreshCw
        className={`w-6 h-6 animate-spin ${theme === "dark" ? "text-blue-400" : "text-blue-500"}`}
      />
    </div>
  );
}
