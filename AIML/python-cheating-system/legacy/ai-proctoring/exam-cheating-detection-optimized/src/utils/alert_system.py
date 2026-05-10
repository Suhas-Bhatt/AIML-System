"""
Voice alert system — gTTS + pygame.

Kept close to the original API so main.py is a drop-in. Improvements:
  - Tolerates missing audio backends (no-op fallback)
  - Cooldown is enforced via the SuspicionValidator anyway, but we keep
    a per-type cooldown here as a belt-and-braces safety net.
"""

import os
import tempfile
import threading
import time
from typing import Dict


class AlertSystem:
    def __init__(self, config: dict):
        self.config = config
        self.cooldown = float(config["logging"].get("alert_cooldown", 10))
        self.enabled = config["logging"]["alert_system"].get("voice_alerts", True)
        self.last_alert: Dict[str, float] = {}

        self._mixer_ok = False
        self._gtts_ok = False
        if self.enabled:
            try:
                import pygame
                pygame.mixer.init()
                self._mixer_ok = True
            except Exception:
                self._mixer_ok = False
            try:
                from gtts import gTTS  # noqa: F401
                self._gtts_ok = True
            except Exception:
                self._gtts_ok = False

        self.messages = {
            "FACE_DISAPPEARED":  "Please look at the screen.",
            "MULTIPLE_FACES":    "We detected multiple people.",
            "OBJECT_DETECTED":   "Unauthorized object detected.",
            "GAZE_AWAY":         "Please focus on your screen.",
            "TALKING_DETECTED":  "Please remain silent during the exam.",
            "LIVENESS_FAILED":   "Please move naturally so we can confirm your presence.",
            "AUDIO_DETECTED":    "Voice activity detected.",
        }

    # ------------------------------------------------------------------
    def speak(self, alert_type: str):
        if not (self.enabled and self._mixer_ok and self._gtts_ok):
            return
        now = time.time()
        if now - self.last_alert.get(alert_type, 0.0) < self.cooldown:
            return
        self.last_alert[alert_type] = now

        msg = self.messages.get(alert_type)
        if not msg:
            return

        threading.Thread(target=self._play, args=(msg,), daemon=True).start()

    def _play(self, text: str):
        try:
            from gtts import gTTS
            import pygame
            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as fp:
                path = fp.name
            try:
                gTTS(text=text, lang="en").save(path)
                pygame.mixer.music.load(path)
                pygame.mixer.music.play()
                while pygame.mixer.music.get_busy():
                    time.sleep(0.1)
                pygame.mixer.music.unload()
            finally:
                try:
                    os.unlink(path)
                except OSError:
                    pass
        except Exception as e:
            print(f"[AlertSystem] TTS failed: {e}")
