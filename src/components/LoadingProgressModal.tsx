import React, { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { progressService, ProgressState } from "../lib/progressService";

export function LoadingProgressModal() {
  const [state, setState] = useState<ProgressState>(() => progressService.getState());

  useEffect(() => {
    const unsubscribe = progressService.subscribe((newState) => {
      setState(newState);
    });
    return () => unsubscribe();
  }, []);

  if (!state.isOpen) return null;

  const isIndeterminate = state.isIndeterminate || state.progress === null;
  const displayPercent = !isIndeterminate && typeof state.progress === "number"
    ? Math.min(100, Math.max(0, Math.round(state.progress)))
    : null;
  const isCompleted = state.status === "completed" || (displayPercent !== null && displayPercent >= 100);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="progress-modal-title"
    >
      <div className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col items-center text-center gap-4 animate-scaleUpCenter overflow-hidden">
        
        {/* Decorative background glow */}
        <div className="absolute -top-12 -right-12 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-12 -left-12 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

        {/* Icon Header */}
        <div className="relative">
          {isCompleted ? (
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shadow-sm transition-all duration-300 scale-105">
              <CheckCircle2 className="w-7 h-7 stroke-[2.5]" />
            </div>
          ) : (
            <div className="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/80 flex items-center justify-center text-blue-600 dark:text-blue-400 shadow-sm">
              <Loader2 className="w-7 h-7 stroke-[2.2] animate-spin" />
            </div>
          )}
        </div>

        {/* Friendly Action Label */}
        <div className="space-y-1 max-w-full px-2">
          <h3
            id="progress-modal-title"
            className="text-base font-extrabold text-slate-800 dark:text-slate-100 tracking-tight leading-snug break-words"
          >
            {state.label}
          </h3>
          <p className="text-xs font-semibold text-slate-400 dark:text-slate-500">
            {isCompleted ? "Completed" : "Please wait a moment…"}
          </p>
        </div>

        {/* Progress Bar with Percentage Counter if determinate, otherwise indeterminate spinner indicator */}
        {!isIndeterminate && displayPercent !== null ? (
          <div className="w-full space-y-2 mt-1">
            <div className="flex items-center justify-between text-xs font-bold text-slate-600 dark:text-slate-300 px-1">
              <span className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500 font-extrabold">
                {isCompleted ? "Completed" : "Progress"}
              </span>
              <span className="font-mono font-black text-blue-600 dark:text-blue-400 text-sm">
                {displayPercent}%
              </span>
            </div>

            <div
              className="relative w-full bg-slate-100 dark:bg-slate-800/80 h-3 rounded-full overflow-hidden p-0.5 border border-slate-200/50 dark:border-slate-700/50"
              role="progressbar"
              aria-valuenow={displayPercent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={`h-full rounded-full transition-all duration-200 ease-out ${
                  isCompleted
                    ? "bg-gradient-to-r from-emerald-500 to-teal-500"
                    : "bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 shadow-xs shadow-blue-500/50"
                }`}
                style={{ width: `${Math.max(4, displayPercent)}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export interface InlineProgressBarProps {
  progress?: number | null;
  label?: string;
  className?: string;
  isIndeterminate?: boolean;
}

export function InlineProgressBar({ progress, label, className = "", isIndeterminate = false }: InlineProgressBarProps) {
  const showIndeterminate = isIndeterminate || progress === undefined || progress === null;
  const displayPercent = !showIndeterminate && typeof progress === "number"
    ? Math.min(100, Math.max(0, Math.round(progress)))
    : null;
  const isCompleted = displayPercent !== null && displayPercent >= 100;

  return (
    <div className={`w-full space-y-2 p-4 rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 ${className}`}>
      <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
        <div className="flex items-center gap-2 truncate pr-2">
          {isCompleted ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          ) : (
            <Loader2 className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin shrink-0" />
          )}
          <span className="truncate font-semibold">{label || (isCompleted ? "Completed" : "Processing…")}</span>
        </div>
        {displayPercent !== null && (
          <span className="font-mono font-black text-blue-600 dark:text-blue-400 shrink-0">
            {displayPercent}%
          </span>
        )}
      </div>

      {!showIndeterminate && displayPercent !== null && (
        <div
          className="relative w-full bg-slate-200/80 dark:bg-slate-800/80 h-2.5 rounded-full overflow-hidden"
          role="progressbar"
          aria-valuenow={displayPercent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`h-full rounded-full transition-all duration-200 ease-out ${
              isCompleted
                ? "bg-gradient-to-r from-emerald-500 to-teal-500"
                : "bg-gradient-to-r from-blue-600 to-indigo-600"
            }`}
            style={{ width: `${Math.max(3, displayPercent)}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default LoadingProgressModal;
