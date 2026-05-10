"use client";

import { useAIProctoring } from '../../hooks/use-ai-proctoring.js';
import { trpc } from '../../lib/trpc/client.js';
import { useCallback, useEffect, useRef } from "react";
import { useToast } from '../../hooks/use-toast.js';

export function AIProctoringManager({
  sessionId,
  stream,
  enabled,
}) {
  const { toast } = useToast();
  const reportMutation = trpc.session.reportAntiCheatingViolation.useMutation();
  
  // Cooldowns to avoid spamming the database with the same violation
  const lastViolationTs = useRef({});
  const COOLDOWN_MS = 10000; // 10 seconds between same violation type

  const reportViolation = useCallback((type, detail) => {
    const now = Date.now();
    if (now - (lastViolationTs.current[type] || 0) < COOLDOWN_MS) return;
    
    lastViolationTs.current[type] = now;
    
    reportMutation.mutate({
      sessionId,
      violation: {
        type,
        timestamp: now,
        detail,
      },
    });

    // Notify user (Optional: you might want this to be silent or visible)
    if (type === "ai_cell_phone") {
        toast({
            title: "Proctoring Alert",
            description: "Mobile device detected in frame.",
            variant: "destructive",
        });
    }
  }, [sessionId, reportMutation, toast]);

  const handleDetection = useCallback((result) => {
    if (!result.success) return;

    // Use the Agent's confirmed violations instead of raw detections
    if (result.violations && result.violations.length > 0) {
      result.violations.forEach((violationType) => {
        reportViolation(violationType, `Confirmed by AI Agent: ${violationType}`);
      });
    }

  }, [reportViolation]);

  useAIProctoring({
    sessionId,
    stream,
    enabled,
    onDetection: handleDetection,
  });

  // This component doesn't render anything visible, it just manages the background AI logic
  return null;
}
