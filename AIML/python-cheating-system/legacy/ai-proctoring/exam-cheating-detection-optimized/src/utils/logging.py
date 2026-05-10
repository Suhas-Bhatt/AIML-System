"""
Plain text alert log — append-only.

Used for human-readable session logs alongside the JSON violation log.
"""

import os
from datetime import datetime
from typing import Dict


class AlertLogger:
    def __init__(self, config: dict):
        self.log_path = config["logging"]["log_path"]
        os.makedirs(self.log_path, exist_ok=True)
        self.cooldown = float(config["logging"].get("alert_cooldown", 10))
        self.last: Dict[str, float] = {}
        self.log_file = os.path.join(self.log_path, "alerts.log")

    def log(self, alert_type: str, message: str):
        now = datetime.now().timestamp()
        if now - self.last.get(alert_type, 0.0) < self.cooldown:
            return None
        self.last[alert_type] = now
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        line = f"{ts} - {alert_type.upper()}: {message}"
        with open(self.log_file, "a") as f:
            f.write(line + "\n")
        return line
