"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const WARNING_SECONDS = 5;

/**
 * Enforces mandatory fullscreen during an interview session.
 * Matches test_interview_app rules: 5 seconds to return or session terminates.
 */
export function useFullscreenEnforcement({ enabled, onTerminated, onWarningStart, onWarningEnd }) {
  const [warningActive, setWarningActive] = useState(false);
  const [timeLeft, setTimeLeft] = useState(WARNING_SECONDS);
  const timerRef = useRef(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const enterFullscreen = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    } catch {
      // Browser may block without user gesture — caller can retry on click
    }
  }, []);

  const returnToFullscreen = useCallback(async () => {
    clearTimer();
    setWarningActive(false);
    setTimeLeft(WARNING_SECONDS);
    onWarningEnd?.();
    await enterFullscreen();
  }, [clearTimer, enterFullscreen, onWarningEnd]);

  useEffect(() => {
    if (!enabled) return;

    enterFullscreen();

    const handleStateChange = () => {
      if (!enabledRef.current) return;

      const isHidden = document.hidden;
      const isNotFullscreen = !document.fullscreenElement;

      if (isHidden || isNotFullscreen) {
        // Only restart timer if it's not already warning
        if (!timerRef.current) {
          setWarningActive(true);
          setTimeLeft(WARNING_SECONDS);
          onWarningStart?.();
          
          timerRef.current = setInterval(() => {
            setTimeLeft((prev) => {
              if (prev <= 1) {
                clearTimer();
                setWarningActive(false);
                onTerminated?.();
                return 0;
              }
              return prev - 1;
            });
          }, 1000);
        }
      } else {
        clearTimer();
        setWarningActive(false);
        setTimeLeft(WARNING_SECONDS);
        onWarningEnd?.();
      }
    };

    document.addEventListener("fullscreenchange", handleStateChange);
    document.addEventListener("visibilitychange", handleStateChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleStateChange);
      document.removeEventListener("visibilitychange", handleStateChange);
      clearTimer();
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    };
  }, [enabled, enterFullscreen, clearTimer, onTerminated, onWarningStart, onWarningEnd]);

  return {
    warningActive,
    timeLeft,
    enterFullscreen,
    returnToFullscreen,
  };
}
