"""
Audio voice-activity detector.

Improvements:
  - Tracks voice "persistence" — voice must persist for N frames before
    counting as real (no more triggering on a single click or breath).
  - Exposes is_voice_active() for the mouth thread to combine with
    mouth-movement (review issue #10).
"""

import threading
import time
from collections import deque
from typing import Optional, Callable

import numpy as np
import sounddevice as sd


class AudioMonitor:
    def __init__(self, config: dict, on_voice_event: Optional[Callable] = None):
        cfg = config["detection"]["audio"]
        self.enabled = cfg.get("enabled", True)
        self.sample_rate = int(cfg.get("sample_rate", 16000))
        self.chunk_size = int(cfg.get("chunk_size", 512))
        self.energy_threshold = float(cfg.get("energy_threshold", 0.0015))
        self.zcr_threshold = float(cfg.get("zcr_threshold", 0.35))
        self.persist_sec = float(cfg.get("voice_persistence_sec", 0.4))

        self._on_voice_event = on_voice_event
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._stream = None

        # Sliding window of (timestamp, is_voice) for the last 1.5s.
        self._history: deque = deque(maxlen=64)
        self._last_event_time = 0.0
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    def start(self):
        if not self.enabled or self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=2.0)
        if self._stream is not None:
            try:
                self._stream.close()
            except Exception:
                pass

    # ------------------------------------------------------------------
    def is_voice_active(self) -> bool:
        """Used by the mouth thread to fuse mouth-movement with audio."""
        with self._lock:
            now = time.time()
            recent = [v for ts, v in self._history if now - ts < 1.0]
            if not recent:
                return False
            return sum(recent) / len(recent) > 0.5

    # ------------------------------------------------------------------
    def _run(self):
        def callback(indata, frames, t, status):
            if status:
                return
            audio = (indata[:, 0] * 32768).astype(np.int16)
            voice = self._is_voice(audio)
            now = time.time()

            with self._lock:
                self._history.append((now, voice))

                # Has voice persisted long enough?
                window = [(ts, v) for ts, v in self._history if now - ts <= self.persist_sec]
                if len(window) >= 4 and all(v for _, v in window):
                    if now - self._last_event_time > 0.8 and self._on_voice_event:
                        self._last_event_time = now
                        self._on_voice_event()

        try:
            self._stream = sd.InputStream(
                samplerate=self.sample_rate,
                channels=1,
                blocksize=self.chunk_size,
                callback=callback,
            )
            with self._stream:
                while self._running:
                    sd.sleep(100)
        except Exception as e:
            print(f"[AudioMonitor] stream failed: {e}")

    # ------------------------------------------------------------------
    def _is_voice(self, audio_int16) -> bool:
        a = audio_int16.astype(np.float32) / 32768.0
        energy = float(np.mean(a ** 2))
        if energy < self.energy_threshold:
            return False
        zcr = float(np.mean(np.abs(np.diff(np.sign(a)))))
        if zcr > self.zcr_threshold:
            return False
        return True
