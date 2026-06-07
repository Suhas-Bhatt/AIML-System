"use client";

import { useAIProctoring } from '../../hooks/use-ai-proctoring.js';
import { trpc } from '../../lib/trpc/client.js';
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from '../../hooks/use-toast.js';
import { Video } from "lucide-react";

function DraggablePip({ children }) {
  const containerRef = useRef(null);
  const dragState = useRef({ dragging: false, startX: 0, startY: 0, origX: 0, origY: 0 });
  const [pos, setPos] = useState({ right: 16, bottom: 64 });
  const [isDragging, setIsDragging] = useState(false);

  const onPointerDown = useCallback((e) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    container.setPointerCapture(e.pointerId);
    dragState.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.right,
      origY: pos.bottom,
    };
    setIsDragging(true);
  }, [pos]);

  const onPointerMove = useCallback((e) => {
    if (!dragState.current.dragging) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    setPos({
      right: Math.max(0, dragState.current.origX - dx),
      bottom: Math.max(0, dragState.current.origY - dy),
    });
  }, []);

  const onPointerUp = useCallback((e) => {
    if (!dragState.current.dragging) return;
    dragState.current.dragging = false;
    containerRef.current?.releasePointerCapture(e.pointerId);
    setIsDragging(false);
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute z-[100] overflow-hidden rounded-lg border bg-black shadow-lg select-none"
      style={{
        right: pos.right,
        bottom: pos.bottom,
        cursor: isDragging ? "grabbing" : "grab",
        touchAction: "none",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {children}
    </div>
  );
}

export function AIProctoringManager({
  sessionId,
  stream,
  enabled,
  preview = false,
}) {
  const { toast } = useToast();
  const reportMutation = trpc.session.reportAntiCheatingViolation.useMutation();
  const [ownStream, setOwnStream] = useState(null);

  const lastViolationTs = useRef({});
  const COOLDOWN_MS = 2000;

  const activeStream = stream ?? ownStream;

  useEffect(() => {
    if (!enabled || stream) return;

    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: 640, height: 480 } })
      .then((mediaStream) => {
        if (cancelled) {
          mediaStream.getTracks().forEach((t) => t.stop());
          return;
        }
        setOwnStream(mediaStream);
      })
      .catch((err) => {
        console.warn("[AI-Proctoring] Camera unavailable:", err);
      });

    return () => {
      cancelled = true;
      setOwnStream((prev) => {
        prev?.getTracks().forEach((t) => t.stop());
        return null;
      });
    };
  }, [enabled, stream]);

  const reportViolation = useCallback((type, detail) => {
    const now = Date.now();
    if (now - (lastViolationTs.current[type] || 0) < COOLDOWN_MS) return;

    lastViolationTs.current[type] = now;

    reportMutation.mutate({
      sessionId,
      violation: { type, timestamp: now, detail },
    });

    const messages = {
      ai_cell_phone: {
        title: "Proctoring Alert",
        description: "Mobile device detected in frame.",
      },
      ai_no_face: {
        title: "Proctoring Alert",
        description: "No face detected. Please stay in front of the camera.",
      },
      ai_multiple_faces: {
        title: "Proctoring Alert",
        description: "Multiple faces detected. You must be alone during the interview.",
      },
      ai_face_too_far: {
        title: "Proctoring Alert",
        description: "You are too far from the camera. Please sit closer.",
      },
      ai_gaze_violation: {
        title: "Proctoring Alert",
        description: "Please keep your eyes on the screen.",
      },
    };

    const msg = messages[type];
    if (msg) {
      toast({ ...msg, variant: "destructive" });
    }
  }, [sessionId, reportMutation, toast]);

  const handleDetection = useCallback((result) => {
    if (!result?.success) return;

    for (const violationType of result.violations ?? []) {
      reportViolation(violationType, `Webcam proctoring: ${violationType}`);
    }
  }, [reportViolation]);

  useAIProctoring({
    sessionId,
    stream: activeStream,
    enabled: enabled && !!activeStream && !preview,
    onDetection: handleDetection,
  });

  const videoRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video && activeStream) {
      video.srcObject = activeStream;
      video.play().catch(() => {});
    }
    return () => {
      if (video) video.srcObject = null;
    };
  }, [activeStream]);

  if (!activeStream) return null;

  return (
    <DraggablePip>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="h-32 w-48 object-cover"
        style={{ transform: "scaleX(-1)" }}
      />
      <div className="absolute bottom-1 left-1 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5">
        <Video className="h-2.5 w-2.5 text-white" />
        <span className="text-[9px] text-white">Camera</span>
      </div>
    </DraggablePip>
  );
}
