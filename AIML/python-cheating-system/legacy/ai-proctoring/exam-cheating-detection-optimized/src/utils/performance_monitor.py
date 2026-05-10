"""
Resource monitor — psutil-based.

Addresses review issue #18 ("no resource monitoring") and the adaptive
mode requested in #13. When CPU or RAM exceeds the threshold for the
sampling window, we fire a callback so the engine can downshift FPS
budgets. (Threads check their target_fps periodically — they pick up
the new value automatically since each loop reads it fresh.)
"""

import threading
import time
from typing import Callable, Optional

try:
    import psutil
    _HAVE_PSUTIL = True
except ImportError:
    _HAVE_PSUTIL = False


class PerformanceMonitor(threading.Thread):
    def __init__(self, config: dict,
                 on_mode_change: Optional[Callable[[str, dict], None]] = None):
        super().__init__(daemon=True, name="PerformanceMonitor")
        cfg = config.get("performance", {})
        self.enabled = cfg.get("monitor_enabled", True) and _HAVE_PSUTIL
        self.cpu_high = float(cfg.get("cpu_high_threshold", 85))
        self.ram_high = float(cfg.get("ram_high_threshold", 85))
        self.cooldown = float(cfg.get("cooldown_sec", 5))
        self.modes = cfg.get("modes", {})
        self._on_mode_change = on_mode_change
        self._stop = threading.Event()
        self.current_mode = "high"
        self.last_cpu = 0.0
        self.last_ram = 0.0

    def stop(self):
        self._stop.set()

    def run(self):
        if not self.enabled:
            return
        while not self._stop.is_set():
            try:
                self.last_cpu = psutil.cpu_percent(interval=1.0)
                self.last_ram = psutil.virtual_memory().percent
            except Exception:
                self.last_cpu = self.last_ram = 0.0

            new_mode = self.current_mode
            if self.last_cpu > self.cpu_high or self.last_ram > self.ram_high:
                new_mode = "low"
            elif self.last_cpu < self.cpu_high * 0.7 and self.last_ram < self.ram_high * 0.7:
                new_mode = "high"

            if new_mode != self.current_mode:
                self.current_mode = new_mode
                if self._on_mode_change:
                    self._on_mode_change(new_mode, self.modes.get(new_mode, {}))

            self._stop.wait(self.cooldown)

    def snapshot(self) -> dict:
        return {
            "cpu": self.last_cpu,
            "ram": self.last_ram,
            "mode": self.current_mode,
        }
