"""
Mouth movement analysis using SHARED face landmarks.

Replaces the old MouthMonitor which ran its own MediaPipe FaceLandmarker.
Per review issue #10, mouth-only signals are too noisy; this module
just reports raw mouth-open. The decision to flag "talking" is made
by the suspicion validator after fusing this with audio activity.
"""

from typing import Optional


class MouthAnalyzer:
    """Computes lip separation from shared landmarks.

    Indices 13/14 are the inner upper/lower lip midpoints in MediaPipe
    Face Mesh — much less sensitive to smiles/yawns than mouth-corner
    distance.
    """

    def __init__(self, config: dict):
        self._open_thresh = float(
            config["detection"]["mouth"].get("open_threshold", 0.035)
        )

    def analyze(self, landmarks) -> Optional[float]:
        """Returns lip-separation in normalized coords, or None."""
        if landmarks is None:
            return None
        try:
            upper = landmarks[13].y
            lower = landmarks[14].y
        except (IndexError, AttributeError):
            return None
        return float(abs(lower - upper))

    def is_open(self, separation: float) -> bool:
        return separation >= self._open_thresh
