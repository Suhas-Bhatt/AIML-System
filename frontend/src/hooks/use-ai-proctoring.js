import { useCallback, useEffect, useRef, useState } from "react";

const FRAME_INTERVAL_MS = 1500;

export function useAIProctoring({
  sessionId,
  stream,
  enabled,
  intervalMs = FRAME_INTERVAL_MS,
  onDetection,
}) {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);

  const videoRef = useRef(null);
  const intervalRef = useRef(null);
  const workerRef = useRef(null);
  const mountedRef = useRef(true);

  const onDetectionRef = useRef(onDetection);
  useEffect(() => { onDetectionRef.current = onDetection; }, [onDetection]);

  // Load Worker on mount
  useEffect(() => {
    let worker = null;
    try {
      worker = new Worker(new URL('../lib/proctoring-worker.js', import.meta.url));
      workerRef.current = worker;
      
      worker.onmessage = (e) => {
        if (e.data.type === "MODELS_LOADED") {
          setIsConnected(true);
        } else if (e.data.type === "DETECTION_RESULT") {
          if (e.data.violations && e.data.violations.length > 0) {
            onDetectionRef.current?.({ success: true, violations: e.data.violations });
          }
        } else if (e.data.type === "ERROR") {
          setError("Failed to load proctoring models: " + e.data.error);
        }
      };
    } catch (err) {
      console.error("Failed to initialize Web Worker", err);
      setError("Failed to initialize Web Worker");
    }

    return () => {
      if (worker) {
        worker.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  const processFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0) return;
    if (!workerRef.current || !isConnected) return;

    try {
      // Extract a frame efficiently
      const imageBitmap = await createImageBitmap(video);
      
      // Transfer the bitmap to the worker (zero-copy if supported)
      workerRef.current.postMessage({
        type: "PROCESS_FRAME",
        imageBitmap,
        frameWidth: video.videoWidth
      }, [imageBitmap]);
    } catch (e) {
      console.warn("Proctoring frame capture error", e);
    }
  }, [isConnected]);

  const stopInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled || !stream || !isConnected) {
      stopInterval();
      return;
    }

    if (!videoRef.current) {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      video.play().catch(e => console.warn("Background video play failed", e));
      videoRef.current = video;
    } else if (videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(e => console.warn("Background video play failed", e));
    }

    stopInterval();
    intervalRef.current = setInterval(() => {
      void processFrame();
    }, intervalMs);

    // Server-Side Audit Trail Snapshot (every 3 minutes)
    const auditInterval = setInterval(async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;
      
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageBase64 = canvas.toDataURL("image/jpeg", 0.7);
        
        await fetch("/api/proctoring/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, imageBase64 })
        });
      } catch (err) {
        console.warn("Server audit snapshot failed", err);
      }
    }, 3 * 60 * 1000); // 3 minutes

    return () => {
      stopInterval();
      clearInterval(auditInterval);
    };
  }, [enabled, stream, intervalMs, isConnected, processFrame, stopInterval]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { 
      mountedRef.current = false; 
      stopInterval();
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current = null;
      }
    };
  }, [stopInterval]);

  return { isConnected, lastResult: null, error };
}
