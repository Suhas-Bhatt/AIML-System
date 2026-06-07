"""
Anti-Cheating Rules Engine
Fix applied: Rule="noisy_environment" → Rule("noisy_environment", ...
(was a syntax error that crashed the entire import)
"""

import time
import logging
import numpy as np
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, field
from enum import Enum
from collections import deque, defaultdict


class RiskLevel(Enum):
    LOW      = "low"
    MEDIUM   = "medium"
    HIGH     = "high"
    CRITICAL = "critical"


class CheatingPattern(Enum):
    IDENTITY_FRAUD       = "identity_fraud"
    COLLABORATION        = "collaboration"
    RESOURCE_USAGE       = "resource_usage"
    ATTENTION_DEFICIT    = "attention_deficit"
    SUSPICIOUS_BEHAVIOR  = "suspicious_behavior"
    ENVIRONMENT_VIOLATION = "environment_violation"


@dataclass
class Rule:
    name:           str
    pattern:        CheatingPattern
    risk_level:     RiskLevel
    threshold:      float
    window_seconds: int
    enabled:        bool = True
    adaptive:       bool = True


@dataclass
class RuleViolation:
    rule_name:  str
    pattern:    CheatingPattern
    risk_level: RiskLevel
    confidence: float
    timestamp:  float
    evidence:   Dict[str, Any]
    session_id: str


class AntiCheatingRulesEngine:
    """Advanced rules engine for detecting sophisticated cheating patterns."""

    def __init__(self, config: Optional[Dict] = None):
        self.logger = logging.getLogger(__name__)
        self.config = config or {}
        self.rules = self._initialize_rules()

        self.session_data:        Dict[str, Dict]              = {}
        self.violation_history:   Dict[str, List[RuleViolation]] = {}
        self.adaptive_thresholds: Dict[str, float]             = {}
        self.baseline_data:       Dict[str, Dict]              = {}

        self.pattern_detectors = {
            CheatingPattern.IDENTITY_FRAUD:       self._detect_identity_fraud,
            CheatingPattern.COLLABORATION:        self._detect_collaboration,
            CheatingPattern.RESOURCE_USAGE:       self._detect_resource_usage,
            CheatingPattern.ATTENTION_DEFICIT:    self._detect_attention_deficit,
            CheatingPattern.SUSPICIOUS_BEHAVIOR:  self._detect_suspicious_behavior,
            CheatingPattern.ENVIRONMENT_VIOLATION: self._detect_environment_violation,
        }

    # ------------------------------------------------------------------
    # Rule definitions
    # ------------------------------------------------------------------

    def _initialize_rules(self) -> List[Rule]:
        return [
            # Identity Fraud
            Rule("multiple_faces",         CheatingPattern.IDENTITY_FRAUD,       RiskLevel.HIGH,     0.80, 60),
            Rule("face_mismatch",          CheatingPattern.IDENTITY_FRAUD,       RiskLevel.CRITICAL, 0.90, 30),
            Rule("identity_inconsistency", CheatingPattern.IDENTITY_FRAUD,       RiskLevel.MEDIUM,   0.70, 120),

            # Collaboration
            Rule("unauthorized_person",    CheatingPattern.COLLABORATION,        RiskLevel.CRITICAL, 0.95, 10),
            Rule("background_changes",     CheatingPattern.COLLABORATION,        RiskLevel.MEDIUM,   0.60, 300),
            Rule("voice_detection",        CheatingPattern.COLLABORATION,        RiskLevel.HIGH,     0.80, 60),

            # Resource Usage
            Rule("phone_usage",            CheatingPattern.RESOURCE_USAGE,       RiskLevel.CRITICAL, 0.90, 5),
            Rule("tab_switching",          CheatingPattern.RESOURCE_USAGE,       RiskLevel.HIGH,     0.70, 30),
            Rule("unauthorized_applications", CheatingPattern.RESOURCE_USAGE,    RiskLevel.MEDIUM,   0.60, 60),

            # Attention Deficit
            Rule("prolonged_absence",      CheatingPattern.ATTENTION_DEFICIT,    RiskLevel.HIGH,     0.80, 120),
            Rule("frequent_lookaway",      CheatingPattern.ATTENTION_DEFICIT,    RiskLevel.MEDIUM,   0.60, 180),
            Rule("sleep_detection",        CheatingPattern.ATTENTION_DEFICIT,    RiskLevel.CRITICAL, 0.90, 30),

            # Suspicious Behaviour
            Rule("repetitive_movements",   CheatingPattern.SUSPICIOUS_BEHAVIOR,  RiskLevel.LOW,      0.50, 240),
            Rule("unnatural_gaze",         CheatingPattern.SUSPICIOUS_BEHAVIOR,  RiskLevel.MEDIUM,   0.70, 90),
            Rule("suspicious_timing",      CheatingPattern.SUSPICIOUS_BEHAVIOR,  RiskLevel.HIGH,     0.80, 60),

            # Environment
            Rule("inadequate_lighting",    CheatingPattern.ENVIRONMENT_VIOLATION, RiskLevel.LOW,     0.60, 300),
            # BUG FIX: was  Rule="noisy_environment", ...   (missing opening parenthesis — syntax error)
            Rule("noisy_environment",      CheatingPattern.ENVIRONMENT_VIOLATION, RiskLevel.MEDIUM,  0.70, 180),
            Rule("multiple_devices",       CheatingPattern.ENVIRONMENT_VIOLATION, RiskLevel.HIGH,    0.80, 60),
        ]

    # ------------------------------------------------------------------
    # Session management
    # ------------------------------------------------------------------

    def initialize_session(self, session_id: str, initial_data: Dict[str, Any]):
        self.session_data[session_id] = {
            "start_time": time.time(),
            "events": [],
            "face_samples": [],
            "gaze_samples": [],
            "object_detections": [],
            "environment_data": {},
            "baseline_established": False,
            "risk_score": 0.0,
        }
        self.violation_history[session_id] = []
        self.adaptive_thresholds[session_id] = {}
        self.logger.info(f"Initialized anti-cheating tracking for session {session_id}")

    # ------------------------------------------------------------------
    # Event processing
    # ------------------------------------------------------------------

    def process_event(self, session_id: str, event_data: Dict[str, Any]) -> List[RuleViolation]:
        if session_id not in self.session_data:
            self.initialize_session(session_id, event_data)

        violations = []
        session = self.session_data[session_id]

        event_data = dict(event_data)  # shallow copy
        event_data.setdefault("timestamp", time.time())
        session["events"].append(event_data)

        if not session["baseline_established"] and len(session["events"]) >= 50:
            self._establish_baseline(session_id)

        for rule in self.rules:
            if not rule.enabled:
                continue
            try:
                violation = self._check_rule(session_id, rule, event_data)
                if violation:
                    violations.append(violation)
                    self.violation_history[session_id].append(violation)
                    if rule.adaptive:
                        self._update_adaptive_threshold(session_id, rule, violation.confidence)
            except Exception as e:
                self.logger.error(f"Error checking rule {rule.name}: {e}")

        self._update_risk_score(session_id)
        return violations

    def _check_rule(self, session_id: str, rule: Rule,
                    event_data: Dict[str, Any]) -> Optional[RuleViolation]:
        detector = self.pattern_detectors.get(rule.pattern)
        if not detector:
            return None
        try:
            confidence, evidence = detector(session_id, rule, event_data)
            threshold = self.adaptive_thresholds.get(
                f"{session_id}_{rule.name}", rule.threshold
            )
            if confidence >= threshold:
                return RuleViolation(
                    rule_name=rule.name,
                    pattern=rule.pattern,
                    risk_level=rule.risk_level,
                    confidence=confidence,
                    timestamp=time.time(),
                    evidence=evidence,
                    session_id=session_id,
                )
        except Exception as e:
            self.logger.error(f"Detector error for {rule.name}: {e}")
        return None

    # ------------------------------------------------------------------
    # Pattern detectors
    # ------------------------------------------------------------------

    def _detect_identity_fraud(self, session_id, rule, event_data):
        session = self.session_data[session_id]
        confidence, evidence = 0.0, {}

        if rule.name == "multiple_faces" and event_data.get("type") == "FACE_DATA":
            n = event_data.get("count", 0)
            if n > 1:
                confidence = min(n / 3.0, 1.0)
                evidence = {"face_count": n, "faces": event_data.get("faces", [])}

        elif rule.name == "identity_inconsistency" and event_data.get("type") == "FACE_DATA":
            session["face_samples"].append(event_data)
            if len(session["face_samples"]) >= 10:
                confidence = self._analyze_face_consistency(session_id)
                evidence = {"sample_count": len(session["face_samples"])}

        return confidence, evidence

    def _detect_collaboration(self, session_id, rule, event_data):
        confidence, evidence = 0.0, {}
        if rule.name == "unauthorized_person" and event_data.get("type") == "FACE_DATA":
            n = event_data.get("count", 0)
            if n > 1:
                confidence = 0.95
                evidence = {"unauthorized_faces": n - 1}
        return confidence, evidence

    def _detect_resource_usage(self, session_id, rule, event_data):
        confidence, evidence = 0.0, {}
        if rule.name == "phone_usage" and event_data.get("type") == "OBJECT_EVENT":
            if event_data.get("label") == "phone":
                confidence = 0.9
                evidence = {"object": "phone"}
        elif rule.name == "tab_switching" and event_data.get("type") == "TAB_SWITCH":
            confidence = 0.85
            evidence = {"event": "tab_switch"}
        return confidence, evidence

    def _detect_attention_deficit(self, session_id, rule, event_data):
        session = self.session_data[session_id]
        confidence, evidence = 0.0, {}

        if rule.name == "prolonged_absence" and event_data.get("type") == "FACE_DATA":
            if event_data.get("count", 1) == 0:
                recent_with_face = [
                    e for e in session["events"][-50:]
                    if e.get("type") == "FACE_DATA" and e.get("count", 0) > 0
                ]
                if recent_with_face:
                    absence = time.time() - recent_with_face[-1]["timestamp"]
                    if absence > rule.threshold:
                        confidence = min(absence / 300.0, 1.0)
                        evidence = {"absence_seconds": round(absence, 1)}

        elif rule.name == "frequent_lookaway" and event_data.get("type") == "GAZE_DATA":
            if event_data.get("looking_away"):
                session["gaze_samples"].append(event_data)
                recent = session["gaze_samples"][-30:]
                if len(recent) >= 20:
                    freq = sum(1 for s in recent if s.get("looking_away")) / len(recent)
                    if freq > 0.3:
                        confidence = freq
                        evidence = {"lookaway_frequency": round(freq, 2)}

        return confidence, evidence

    def _detect_suspicious_behavior(self, session_id, rule, event_data):
        confidence, evidence = 0.0, {}
        if rule.name == "unnatural_gaze" and event_data.get("type") == "GAZE_DATA":
            yaw   = abs(event_data.get("head_yaw", 0))
            pitch = abs(event_data.get("head_pitch", 0))
            if yaw > 45 or pitch > 30:
                confidence = min((yaw + pitch) / 100.0, 1.0)
                evidence = {"yaw": round(yaw, 1), "pitch": round(pitch, 1)}
        return confidence, evidence

    def _detect_environment_violation(self, session_id, rule, event_data):
        # Stubs — implement lighting / audio analysis as needed
        return 0.0, {"status": "not_implemented"}

    # ------------------------------------------------------------------
    # Analytics helpers
    # ------------------------------------------------------------------

    def _analyze_face_consistency(self, session_id: str) -> float:
        samples = self.session_data[session_id]["face_samples"][-20:]
        if len(samples) < 10:
            return 0.0
        counts = [s.get("count", 0) for s in samples]
        variance = float(np.var(counts))
        return min(variance / 4.0, 1.0)

    def _establish_baseline(self, session_id: str):
        events = self.session_data[session_id]["events"][:50]
        face_counts = [e.get("count", 0) for e in events if e.get("type") == "FACE_DATA"]
        self.baseline_data[session_id] = {
            "avg_face_count": float(np.mean(face_counts)) if face_counts else 0,
            "established_at": time.time(),
        }
        self.session_data[session_id]["baseline_established"] = True
        self.logger.info(f"Baseline established for session {session_id}")

    def _update_adaptive_threshold(self, session_id: str, rule: Rule, confidence: float):
        key = f"{session_id}_{rule.name}"
        current = self.adaptive_thresholds.get(key, rule.threshold)
        if confidence > current * 1.2:
            self.adaptive_thresholds[key] = min(current * 1.05, rule.threshold * 1.5)
        elif confidence > current * 0.9:
            self.adaptive_thresholds[key] = max(current * 0.98, rule.threshold * 0.7)

    def _update_risk_score(self, session_id: str):
        weights = {RiskLevel.LOW: 1, RiskLevel.MEDIUM: 2, RiskLevel.HIGH: 3, RiskLevel.CRITICAL: 5}
        violations = self.violation_history.get(session_id, [])[-20:]
        total = sum(weights.get(v.risk_level, 1) * v.confidence for v in violations)
        self.session_data[session_id]["risk_score"] = min(total / 100.0, 1.0)

    # ------------------------------------------------------------------
    # Reporting
    # ------------------------------------------------------------------

    def get_session_risk_assessment(self, session_id: str) -> Dict[str, Any]:
        if session_id not in self.session_data:
            return {"error": "Session not found"}

        session    = self.session_data[session_id]
        violations = self.violation_history.get(session_id, [])

        by_pattern: Dict[str, List[RuleViolation]] = defaultdict(list)
        for v in violations:
            by_pattern[v.pattern.value].append(v)

        pattern_risks = {}
        for pattern, vs in by_pattern.items():
            pattern_risks[pattern] = {
                "count":           len(vs),
                "avg_confidence":  round(float(np.mean([v.confidence for v in vs])), 3),
                "max_risk_level":  max(vs, key=lambda v: ["low","medium","high","critical"].index(v.risk_level.value)).risk_level.value,
                "latest_violation": max(v.timestamp for v in vs),
            }

        return {
            "session_id":          session_id,
            "overall_risk_score":  round(session["risk_score"], 3),
            "total_violations":    len(violations),
            "pattern_risks":       pattern_risks,
            "baseline_established": session["baseline_established"],
            "session_duration":    round(time.time() - session["start_time"], 1),
            "recommendations":     self._recommendations(session, pattern_risks),
        }

    def _recommendations(self, session: Dict, pattern_risks: Dict) -> List[str]:
        recs = []
        if session["risk_score"] > 0.7:
            recs.append("High overall risk — recommend manual review")
        if "identity_fraud" in pattern_risks and pattern_risks["identity_fraud"]["max_risk_level"] in ("high", "critical"):
            recs.append("Identity fraud detected — verify candidate identity")
        if "resource_usage" in pattern_risks and pattern_risks["resource_usage"]["max_risk_level"] == "critical":
            recs.append("Critical resource usage (phone/tab) — consider session termination")
        if "attention_deficit" in pattern_risks and pattern_risks["attention_deficit"]["count"] >= 5:
            recs.append("Frequent attention issues — verify candidate engagement")
        if not recs:
            recs.append("No significant risks detected — session appears normal")
        return recs

    def get_active_rules(self) -> List[Dict]:
        return [
            {
                "name":           r.name,
                "pattern":        r.pattern.value,
                "risk_level":     r.risk_level.value,
                "threshold":      r.threshold,
                "window_seconds": r.window_seconds,
                "enabled":        r.enabled,
                "adaptive":       r.adaptive,
            }
            for r in self.rules
        ]
