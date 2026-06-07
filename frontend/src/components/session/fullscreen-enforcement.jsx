"use client";

import { useFullscreenEnforcement } from "../../hooks/use-fullscreen-enforcement.js";
import { trpc } from "../../lib/trpc/client.js";
import { AlertTriangle, Maximize } from "lucide-react";
import { useCallback, useRef } from "react";

/**
 * Invisible fullscreen enforcement — only shows a warning overlay when the
 * candidate exits fullscreen. Does not alter the main interview UI.
 */
export function FullscreenEnforcement({ enabled, sessionId, onTerminated }) {
  const reportMutation = trpc.session.reportAntiCheatingViolation.useMutation();
  const reportedRef = useRef(false);

  const reportExit = useCallback(() => {
    if (!sessionId || reportedRef.current) return;
    reportedRef.current = true;
    reportMutation.mutate({
      sessionId,
      violation: {
        type: "fullscreen_exit",
        timestamp: Date.now(),
        detail: "Candidate exited fullscreen during interview",
      },
    });
  }, [sessionId, reportMutation]);

  const { warningActive, timeLeft, returnToFullscreen } = useFullscreenEnforcement({
    enabled,
    onTerminated: () => {
      reportExit();
      onTerminated?.();
    },
    onWarningStart: reportExit,
  });

  if (!enabled || !warningActive) return null;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-xl border border-red-200 bg-white p-6 shadow-2xl dark:border-red-900 dark:bg-gray-900">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/50">
            <AlertTriangle className="h-7 w-7 text-red-600 dark:text-red-400" />
          </div>

          <h2 className="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
            Return to fullscreen
          </h2>

          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Fullscreen is required during this interview. Return within{" "}
            <span className="font-semibold text-red-600 dark:text-red-400">{timeLeft}s</span>{" "}
            or the session will end.
          </p>

          <button
            type="button"
            onClick={returnToFullscreen}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:bg-red-700 dark:hover:bg-red-600"
          >
            <Maximize className="h-4 w-4" />
            Return to Fullscreen
          </button>
        </div>
      </div>
    </div>
  );
}
