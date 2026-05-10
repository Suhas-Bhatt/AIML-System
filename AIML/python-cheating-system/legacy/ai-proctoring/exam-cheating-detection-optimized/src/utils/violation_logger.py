"""
Violation logger — episode-based.

Addresses review issues #15 ("logging too heavy"), #17 ("report only at
shutdown"), and the "Better Logging Strategy" recommendation.

Instead of one entry per detector loop, we log episodes:

  {
      "type":         "GAZE_AWAY",
      "started_at":   "2026-05-07T11:32:14.219",
      "ended_at":     "2026-05-07T11:32:18.711",
      "duration_sec": 4.49,
      "evidence":     ["reports/violation_captures/GAZE_AWAY_*.jpg"],
      "metadata":     {...}
  }

And we save to disk every N seconds (default 30) so the report survives
a crash.
"""

import json
import os
import threading
import time
from datetime import datetime
from typing import Optional


class ViolationLogger:
    def __init__(self, config: dict):
        out = config["global"]["output_path"]
        os.makedirs(out, exist_ok=True)
        self.log_file = os.path.join(out, "violations.json")
        self.save_interval = float(config.get("logging", {}).get("violation_save_interval", 30))

        self._lock = threading.Lock()
        self._episodes: list = []                 # closed episodes
        self._open: dict = {}                     # type -> open-episode dict
        self._last_save = time.time()

    # ------------------------------------------------------------------
    def on_event(self, event: dict, evidence_paths: Optional[list] = None):
        """Fed by the main loop. Event format from SuspicionValidator:
            {type, phase, started_at, duration, data}
        """
        v_type = event.get("type")
        phase = event.get("phase")
        if not v_type or not phase:
            return

        with self._lock:
            if phase == "started":
                self._open[v_type] = {
                    "type": v_type,
                    "started_at": datetime.fromtimestamp(
                        event.get("started_at", time.time())
                    ).isoformat(),
                    "ended_at": None,
                    "duration_sec": None,
                    "evidence": evidence_paths or [],
                    "metadata": event.get("data", {}),
                }
            elif phase == "resolved":
                if v_type in self._open:
                    ep = self._open.pop(v_type)
                    ep["ended_at"] = datetime.now().isoformat()
                    ep["duration_sec"] = round(event.get("duration", 0.0), 3)
                    self._episodes.append(ep)

        self._maybe_save()

    def add_evidence(self, v_type: str, path: str):
        """Attach a screenshot path to the currently open episode of v_type."""
        with self._lock:
            ep = self._open.get(v_type)
            if ep is not None:
                ep["evidence"].append(path)

    # ------------------------------------------------------------------
    def get_violations(self) -> list:
        """Returns all closed + currently-open episodes as a flat list.

        For consumers (report generator) that just want everything.
        """
        with self._lock:
            out = list(self._episodes)
            for ep in self._open.values():
                # Flush a snapshot of the open episode without modifying it.
                snap = dict(ep)
                snap["ended_at"] = snap["ended_at"] or "ongoing"
                out.append(snap)
            return out

    # ------------------------------------------------------------------
    def _maybe_save(self):
        now = time.time()
        if now - self._last_save < self.save_interval:
            return
        self._last_save = now
        self.save()

    def save(self):
        """Atomic write so a crash mid-save can't corrupt the file."""
        with self._lock:
            data = {
                "saved_at": datetime.now().isoformat(),
                "episodes": list(self._episodes),
                "open_episodes": list(self._open.values()),
            }
        tmp = self.log_file + ".tmp"
        try:
            with open(tmp, "w") as f:
                json.dump(data, f, indent=2)
            os.replace(tmp, self.log_file)
        except Exception as e:
            print(f"[ViolationLogger] save failed: {e}")
