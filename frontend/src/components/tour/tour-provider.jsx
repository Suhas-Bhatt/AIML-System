"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import {
  TOUR_STEPS,
  TOUR_EDIT_URL_KEY,
  getStoredTourState,
  setStoredTourState,
} from './tour-steps.js';

const TourContext = createContext(null);

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used inside TourProvider");
  return ctx;
}

export function useTourSafe() {
  return useContext(TourContext);
}

export function TourProvider({ children }) {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [showKey, setShowKey] = useState(0);
  const [showRecoveryHint, setShowRecoveryHint] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);

  useEffect(() => {
    const stored = getStoredTourState();
    if (stored) {
      if (stored.completed) {
        setCompleted(true);
      } else if (!stored.dismissed) {
        setStepIndex(stored.currentStep);
        setActive(true);
      }
    } else {
      setShowWelcome(true);
    }
    setReady(true);
  }, []);

  const persist = useCallback(
    (idx, completed = false, dismissed = false) => {
      setStoredTourState({
        currentStep: idx,
        completed,
        dismissed,
      });
    },
    [],
  );

  useEffect(() => {
    if (active && pathname.includes("/edit/")) {
      try {
        localStorage.setItem(TOUR_EDIT_URL_KEY, pathname);
      } catch {}
    }
  }, [active, pathname]);

  const currentStep = active ? TOUR_STEPS[stepIndex] ?? null : null;

  const isStepOnCurrentPage = useCallback(
    (step) => {
      if (!step) return false;
      return pathname.includes(step.page);
    },
    [pathname],
  );

  const next = useCallback(() => {
    const nextIdx = stepIndex + 1;
    if (nextIdx >= TOUR_STEPS.length) {
      setActive(false);
      setCompleted(true);
      setShowCelebration(true);
      persist(nextIdx, true);
      return;
    }
    setStepIndex(nextIdx);
    persist(nextIdx);
  }, [stepIndex, persist]);

  const prev = useCallback(() => {
    const prevIdx = Math.max(0, stepIndex - 1);
    setStepIndex(prevIdx);
    persist(prevIdx);
  }, [stepIndex, persist]);

  const skip = useCallback(() => {
    setActive(false);
    setShowRecoveryHint(true);
    persist(stepIndex, false, true);
  }, [stepIndex, persist]);

  const clearRecoveryHint = useCallback(() => {
    setShowRecoveryHint(false);
  }, []);

  const dismiss = useCallback(() => {
    setActive(false);
    setCompleted(true);
    persist(stepIndex, true, true);
  }, [stepIndex, persist]);

  const start = useCallback(() => {
    if (active) {
      const step = TOUR_STEPS[stepIndex];
      if (step && pathname.includes(step.page)) {
        setShowKey((k) => k + 1);
        return;
      }
      for (let i = stepIndex - 1; i >= 0; i--) {
        if (pathname.includes(TOUR_STEPS[i].page)) {
          setStepIndex(i);
          setShowKey((k) => k + 1);
          persist(i);
          return;
        }
      }
    }
    setStepIndex(0);
    setActive(true);
    setCompleted(false);
    setShowKey((k) => k + 1);
    persist(0);
  }, [active, stepIndex, pathname, persist]);

  const goToStep = useCallback(
    (idx) => {
      const clamped = Math.max(0, Math.min(idx, TOUR_STEPS.length - 1));
      setStepIndex(clamped);
      setActive(true);
      setCompleted(false);
      setShowKey((k) => k + 1);
      persist(clamped);
    },
    [persist],
  );

  const completeStep = useCallback(
    (stepId) => {
      if (!active) return;
      const step = TOUR_STEPS[stepIndex];
      if (step && step.id === stepId) {
        next();
      }
    },
    [active, stepIndex, next],
  );

  const restart = useCallback(() => {
    setActive(false);
    setStepIndex(0);
    setCompleted(false);
    setShowWelcome(true);
    persist(0, false, false);
  }, [persist]);

  const acceptWelcome = useCallback(() => {
    setShowWelcome(false);
    setStepIndex(0);
    setActive(true);
    setCompleted(false);
    setShowKey((k) => k + 1);
    persist(0);
  }, [persist]);

  const dismissWelcome = useCallback(() => {
    setShowWelcome(false);
  }, []);

  const dismissCelebration = useCallback(() => {
    setShowCelebration(false);
  }, []);

  const value = useMemo(
    () => ({
      active: active && ready,
      completed,
      currentStep: isStepOnCurrentPage(currentStep) ? currentStep : null,
      stepIndex,
      totalSteps: TOUR_STEPS.length,
      steps: TOUR_STEPS,
      showKey,
      showRecoveryHint,
      showWelcome: showWelcome && ready,
      next,
      prev,
      skip,
      dismiss,
      start,
      goToStep,
      completeStep,
      clearRecoveryHint,
      restart,
      acceptWelcome,
      dismissWelcome,
      showCelebration,
      dismissCelebration,
    }),
    [
      active,
      ready,
      completed,
      currentStep,
      isStepOnCurrentPage,
      stepIndex,
      showKey,
      showRecoveryHint,
      showWelcome,
      showCelebration,
      next,
      prev,
      skip,
      dismiss,
      start,
      goToStep,
      completeStep,
      clearRecoveryHint,
      restart,
      acceptWelcome,
      dismissWelcome,
      dismissCelebration,
    ],
  );

  return (
    <TourContext.Provider value={value}>{children}</TourContext.Provider>
  );
}
