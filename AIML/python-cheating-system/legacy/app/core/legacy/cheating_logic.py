"""Temporal accumulator-based cheating score engine.
Prevents jitter by requiring violations to persist for N frames before penalising."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class CheatingLogic:
    score: float = 0.0
    _acc: dict[str, int] = field(default_factory=lambda: {
        "face_missing": 0,
        "looking_away": 0,
        "mouth_moving": 0,
        "noise": 0,
    })

    # frames a violation must persist before incrementing score
    THRESHOLDS: dict[str, int] = field(default_factory=lambda: {
        "face_missing": 15,
        "looking_away": 25,
        "mouth_moving": 10,
        "noise": 5,
        "objects": 1,
    })
    WEIGHTS: dict[str, float] = field(default_factory=lambda: {
        "face_missing": 0.5,
        "multiple_faces": 5.0,
        "looking_away": 1.0,
        "phone_detected": 10.0,
        "book_detected": 3.0,
        "mouth_moving": 2.0,
        "suspicious_noise": 4.0,
        "identity_mismatch": 15.0,
    })

    def update(self, detections: dict) -> dict:
        violations: list[str] = []

        # Face count
        count = detections.get("face_count", 0)
        if count == 0:
            self._acc["face_missing"] += 1
            if self._acc["face_missing"] >= self.THRESHOLDS["face_missing"]:
                self.score += self.WEIGHTS["face_missing"]
                violations.append("No face detected")
        else:
            self._acc["face_missing"] = max(0, self._acc["face_missing"] - 2)
            if count > 1:
                self.score += self.WEIGHTS["multiple_faces"]
                violations.append(f"Multiple faces ({count})")

        # Head pose
        pose = detections.get("pose", "Forward")
        if pose != "Forward":
            self._acc["looking_away"] += 1
            if self._acc["looking_away"] >= self.THRESHOLDS["looking_away"]:
                self.score += self.WEIGHTS["looking_away"]
                violations.append(f"User is {pose}")
        else:
            self._acc["looking_away"] = max(0, self._acc["looking_away"] - 2)

        # Objects
        for obj in detections.get("objects", []):
            if obj == "cell phone":
                self.score += self.WEIGHTS["phone_detected"]
                violations.append("Mobile phone detected")
            elif obj in {"book", "laptop"}:
                self.score += self.WEIGHTS["book_detected"]
                violations.append(f"Suspicious {obj} detected")

        # Mouth
        if detections.get("mouth_moving"):
            self._acc["mouth_moving"] += 1
            if self._acc["mouth_moving"] >= self.THRESHOLDS["mouth_moving"]:
                self.score += self.WEIGHTS["mouth_moving"]
                violations.append("Talking detected")
        else:
            self._acc["mouth_moving"] = max(0, self._acc["mouth_moving"] - 1)

        # Audio
        if detections.get("audio_level", 0) > 0.05:
            self._acc["noise"] += 1
            if self._acc["noise"] >= self.THRESHOLDS["noise"]:
                self.score += self.WEIGHTS["suspicious_noise"]
                violations.append("Suspicious noise detected")
        else:
            self._acc["noise"] = max(0, self._acc["noise"] - 1)

        # Identity
        if detections.get("identity_match") is False:
            self.score += self.WEIGHTS["identity_mismatch"]
            violations.append("Identity mismatch detected")

        status = "Safe"
        if self.score > 25:
            status = "Cheating"
        elif self.score > 15:
            status = "Suspicious"
        elif self.score > 5:
            status = "Warning"

        return {
            "status": status,
            "score": round(self.score, 2),
            "violations": list(set(violations)),
        }

    def reset(self) -> None:
        self.score = 0.0
        for k in self._acc:
            self._acc[k] = 0
