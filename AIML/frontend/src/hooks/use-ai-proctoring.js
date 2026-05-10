import { useCallback, useEffect, useRef, useState } from "react";

export function useAIProctoring({
  sessionId,
  stream,
  enabled,
  intervalMs = 1000,
  onDetection,
}) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const wsRef = useRef(null);
  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const intervalRef = useRef(null);

  const sendFrame = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !stream || !videoRef.current) {
      return;
    }

    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
      canvasRef.current.width = 640;
      canvasRef.current.height = 480;
    }

    const canvas = canvasRef.current;
    const video = videoRef.current;
    const ctx = canvas.getContext("2d");

    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frameBase64 = canvas.toDataURL("image/jpeg", 0.7);
      
      wsRef.current.send(JSON.stringify({
        frame: frameBase64,
        audio_level: 0 // Audio processing can be added here if needed
      }));
    }
  }, [stream]);

  useEffect(() => {
    if (!enabled || !sessionId) return;

    const wsUrl = `ws://localhost:8000/ws/proctor/${sessionId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      console.log("[AI-Proctoring] WebSocket connected");
    };

    ws.onmessage = (event) => {
      const result = JSON.parse(event.data);
      setLastResult(result);
      onDetection?.(result);
    };

    ws.onclose = () => {
      setIsConnected(false);
      console.log("[AI-Proctoring] WebSocket disconnected");
    };

    ws.onerror = (err) => {
      console.error("[AI-Proctoring] WebSocket error:", err);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [enabled, sessionId, onDetection]);

  useEffect(() => {
    if (enabled && stream && isConnected) {
      if (!videoRef.current) {
        videoRef.current = document.createElement("video");
      }
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(console.error);

      intervalRef.current = setInterval(sendFrame, intervalMs);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, stream, isConnected, sendFrame, intervalMs]);

  return { isConnected, lastResult };
}
