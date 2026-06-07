"""
reports/report_generator.py — PRODUCTION FIXED

Bugs fixed vs original:
1. CRASH FIX: _build_timeline crashed with TypeError because ISO timestamp strings
   were subtracted as integers. Now handles both ISO strings and unix floats.
2. LOGIC FIX: _calculate_risk_score normalization was (raw/100)*100 = raw,
   making it meaningless. Now uses a proper 0–100 scale.
3. DATA FIX: _describe_type used wrong violation type keys (FACE_DATA instead of
   FACE_NOT_DETECTED, etc.). Fixed to match actual ViolationEngine output types.
4. EDGE CASE: added guards for empty violations list throughout.
"""

import io
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from api.session_manager import ProctoringSession


def _parse_timestamp_to_unix(ts_raw) -> Optional[float]:
    """
    Safely convert a violation timestamp to unix seconds float.
    Handles:
      - ISO 8601 string: "2024-01-01T10:05:00.123Z"
      - Unix float seconds: 1704067500.0
      - Unix float milliseconds: 1704067500000.0 (detected heuristically)
      - None / missing
    """
    if ts_raw is None:
        return None

    if isinstance(ts_raw, (int, float)):
        ts_f = float(ts_raw)
        # Heuristic: if > year 3000 in seconds, it's probably milliseconds
        if ts_f > 32503680000:  # 32503680000 = year 3000 in unix seconds
            ts_f /= 1000.0
        return ts_f

    if isinstance(ts_raw, str):
        try:
            # Handle both "Z" suffix and "+00:00" offset
            cleaned = ts_raw.replace("Z", "+00:00")
            dt = datetime.fromisoformat(cleaned)
            return dt.timestamp()
        except (ValueError, TypeError):
            pass

    return None


class ReportGenerator:
    """
    Usage:
        gen    = ReportGenerator(session)
        report = gen.generate_json()   # dict
        pdf    = gen.generate_pdf()    # bytes
    """

    # Weight per severity — higher = more serious
    SEVERITY_WEIGHT = {"CRITICAL": 10, "HIGH": 6, "WARNING": 3, "LOW": 1}

    # Score thresholds
    RISK_THRESHOLDS = [
        (75, "High Risk",   "red"),
        (45, "Medium Risk", "orange"),
        (15, "Low Risk",    "yellow"),
        (0,  "Clean",       "green"),
    ]

    def __init__(self, session: "ProctoringSession"):
        self.session    = session
        self.violations = session.get_violations()
        self.status     = session.get_status()

    # ------------------------------------------------------------------
    # JSON report
    # ------------------------------------------------------------------

    def generate_json(self) -> Dict[str, Any]:
        summary    = self._build_summary()
        timeline   = self._build_timeline()
        breakdown  = self._build_breakdown()
        risk_score = self._calculate_risk_score()
        concerns   = self._top_concerns()
        recs       = self._recommendations(risk_score, breakdown)

        return {
            "meta": {
                "report_generated_at": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
                "session_id":          self.session.session_id,
                "interview_id":        self.session.interview_id,
                "candidate_name":      self.session.candidate_name,
                "session_duration_s":  self.status.get("duration_s", 0),
            },
            "summary":         summary,
            "risk_score":      risk_score,
            "top_concerns":    concerns,
            "breakdown":       breakdown,
            "timeline":        timeline,
            "recommendations": recs,
            "raw_violations":  self.violations,
        }

    def _build_summary(self) -> Dict[str, Any]:
        total   = len(self.violations)
        by_sev  = defaultdict(int)
        by_type = defaultdict(int)
        for v in self.violations:
            by_sev[v.get("severity", "UNKNOWN")]  += 1
            by_type[v.get("type",     "UNKNOWN")] += 1

        duration = self.status.get("duration_s", 0)
        vpm      = round((total / (duration / 60)) if duration > 60 else total, 2)

        return {
            "total_violations":          total,
            "violations_per_minute":     vpm,
            "by_severity":               dict(by_sev),
            "by_type":                   dict(by_type),
            "critical_violations":       by_sev.get("CRITICAL", 0),
            "high_violations":           by_sev.get("HIGH", 0),
            "session_duration_minutes":  round(duration / 60, 1),
            "monitoring_status":         "completed" if not self.session.is_running else "live",
        }

    def _build_timeline(self) -> List[Dict[str, Any]]:
        """
        Group violations by minute for activity heatmap.
        FIXED: correctly parses ISO timestamp strings instead of subtracting from int.
        """
        if not self.violations or not self.session.started_at:
            return []

        start_s = float(self.session.started_at)  # unix seconds
        by_minute: Dict[int, List[Dict]] = defaultdict(list)

        for v in self.violations:
            ts_s = _parse_timestamp_to_unix(v.get("timestamp"))
            if ts_s is None:
                ts_s = start_s  # fallback: place at session start

            minute = max(0, int((ts_s - start_s) / 60.0))
            by_minute[minute].append({
                "type":     v.get("type"),
                "severity": v.get("severity"),
                "details":  v.get("details", {}),
            })

        timeline = []
        for minute in sorted(by_minute.keys()):
            events = by_minute[minute]
            timeline.append({
                "minute":       minute,
                "label":        f"Min {minute}–{minute + 1}",
                "event_count":  len(events),
                "events":       events,
                "has_critical": any(e["severity"] == "CRITICAL" for e in events),
            })
        return timeline

    def _build_breakdown(self) -> Dict[str, Any]:
        """Per-type statistics."""
        by_type: Dict[str, List[Dict]] = defaultdict(list)
        for v in self.violations:
            by_type[v.get("type", "UNKNOWN")].append(v)

        breakdown = {}
        for vtype, vs in by_type.items():
            severities = [v.get("severity", "LOW") for v in vs]
            breakdown[vtype] = {
                "count":        len(vs),
                "first_at":     vs[0].get("timestamp"),
                "last_at":      vs[-1].get("timestamp"),
                "severities":   {s: severities.count(s) for s in set(severities)},
                "description":  self._describe_type(vtype),
            }
        return breakdown

    def _calculate_risk_score(self) -> Dict[str, Any]:
        """
        0–100 weighted risk score.
        FIXED: Normalization was (raw/100)*100 = raw (mathematically meaningless).
        Now: 50 weighted points = 100 score, capped at 100.
        (5 CRITICAL violations = 50 weight = max risk)
        """
        if not self.violations:
            return {"score": 0, "label": "Clean", "color": "green", "raw_weight": 0}

        raw = sum(
            self.SEVERITY_WEIGHT.get(v.get("severity", "LOW"), 1)
            for v in self.violations
        )

        # Scale: 50 raw points = 100 score
        score = min(int(raw * 2), 100)

        label, color = "Clean", "green"
        for threshold, lbl, clr in self.RISK_THRESHOLDS:
            if score >= threshold:
                label, color = lbl, clr
                break

        return {"score": score, "label": label, "color": color, "raw_weight": raw}

    def _top_concerns(self) -> List[Dict[str, Any]]:
        """Rank violation types by severity weight × frequency."""
        by_type: Dict[str, Dict[str, Any]] = {}
        for v in self.violations:
            t = v.get("type", "UNKNOWN")
            if t not in by_type:
                by_type[t] = {"type": t, "count": 0, "weight": 0, "severity": v.get("severity")}
            by_type[t]["count"]  += 1
            by_type[t]["weight"] += self.SEVERITY_WEIGHT.get(v.get("severity", "LOW"), 1)

        ranked = sorted(by_type.values(), key=lambda x: x["weight"], reverse=True)
        return ranked[:5]

    def _recommendations(self, risk_score: Dict, breakdown: Dict) -> List[str]:
        recs  = []
        score = risk_score.get("score", 0)

        if score == 0:
            recs.append("✅ No suspicious activity detected. Session appears clean.")
            return recs

        if score >= 75:
            recs.append("🔴 HIGH RISK: Recommend immediate manual review of this session.")

        # FIXED: use correct violation type keys matching ViolationEngine output
        if "PHONE_DETECTED" in breakdown or "OBJECT_EVENT" in breakdown:
            recs.append("📱 Unauthorized device detected. Candidate may have accessed external resources.")

        if "FACE_NOT_DETECTED" in breakdown:
            recs.append("👤 Candidate was absent from camera. Identity unconfirmable during those periods.")

        if "MULTIPLE_FACES" in breakdown:
            recs.append("👥 Multiple faces detected. Unauthorized person may have assisted the candidate.")

        if "GAZE_DEVIATION" in breakdown or "LOOKING_AWAY" in breakdown:
            total_gaze = (
                breakdown.get("GAZE_DEVIATION", {}).get("count", 0) +
                breakdown.get("LOOKING_AWAY", {}).get("count", 0)
            )
            if total_gaze >= 5:
                recs.append("👀 Candidate frequently looked away. May indicate external reference material use.")

        if "TAB_SWITCH" in breakdown or "WINDOW_BLUR" in breakdown:
            recs.append("🖥️ Tab switching detected. Candidate may have accessed answers in another browser tab.")

        if not recs:
            recs.append("⚠️ Low-level anomalies detected. Manual review recommended if score is borderline.")

        return recs

    @staticmethod
    def _describe_type(vtype: str) -> str:
        """
        FIXED: Keys now match actual ViolationEngine output types.
        Original used FACE_DATA, GAZE_DATA which are not emitted by ViolationEngine.
        """
        return {
            "FACE_NOT_DETECTED":  "No face detected — candidate absent from camera",
            "MULTIPLE_FACES":     "Multiple faces — unauthorized person may be present",
            "FACE_OBSCURED":      "Face obscured or partially visible",
            "PHONE_DETECTED":     "Mobile phone or unauthorized device detected",
            "OBJECT_EVENT":       "Unauthorized object detected in camera frame",
            "GAZE_DEVIATION":     "Candidate's gaze deviating from screen",
            "LOOKING_AWAY":       "Candidate looking away from screen",
            "TAB_SWITCH":         "Browser tab or window focus lost",
            "WINDOW_BLUR":        "Browser window lost focus",
            "FULLSCREEN_EXIT":    "Candidate exited fullscreen mode",
        }.get(vtype, f"Violation: {vtype}")

    # ------------------------------------------------------------------
    # PDF report (requires reportlab)
    # ------------------------------------------------------------------

    def generate_pdf(self) -> bytes:
        try:
            from reportlab.lib.pagesizes import A4
            from reportlab.lib.styles    import getSampleStyleSheet, ParagraphStyle
            from reportlab.lib.units     import cm
            from reportlab.lib           import colors
            from reportlab.platypus      import (
                SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
            )
        except ImportError:
            raise ImportError("reportlab is required for PDF generation. pip install reportlab")

        buf    = io.BytesIO()
        report = self.generate_json()
        doc    = SimpleDocTemplate(buf, pagesize=A4,
                                   leftMargin=2*cm, rightMargin=2*cm,
                                   topMargin=2*cm, bottomMargin=2*cm)
        styles = getSampleStyleSheet()
        story  = []

        H1 = ParagraphStyle("H1", parent=styles["Heading1"], fontSize=18, spaceAfter=8)
        H2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=13, spaceAfter=6, spaceBefore=14)
        NM = styles["Normal"]

        story.append(Paragraph("AI Proctoring Report", H1))
        story.append(HRFlowable(width="100%", thickness=1, color=colors.grey))
        story.append(Spacer(1, 0.3*cm))

        meta = report["meta"]
        story.append(Paragraph(f"<b>Candidate:</b> {meta['candidate_name']}", NM))
        story.append(Paragraph(f"<b>Session ID:</b> {meta['session_id']}", NM))
        story.append(Paragraph(f"<b>Interview ID:</b> {meta['interview_id']}", NM))
        story.append(Paragraph(f"<b>Duration:</b> {meta['session_duration_s'] / 60:.1f} minutes", NM))
        story.append(Paragraph(f"<b>Report Generated:</b> {meta['report_generated_at']}", NM))
        story.append(Spacer(1, 0.5*cm))

        # Risk score
        story.append(Paragraph("Risk Assessment", H2))
        rs = report["risk_score"]
        story.append(Paragraph(
            f'<font color="{rs["color"]}"><b>Risk Level: {rs["label"]} ({rs["score"]}/100)</b></font>', NM
        ))
        story.append(Spacer(1, 0.3*cm))

        # Summary table
        story.append(Paragraph("Violation Summary", H2))
        summary = report["summary"]
        summary_data = [
            ["Metric", "Value"],
            ["Total Violations",       str(summary["total_violations"])],
            ["Violations / Minute",    str(summary["violations_per_minute"])],
            ["Critical Violations",    str(summary["critical_violations"])],
            ["High Violations",        str(summary["high_violations"])],
            ["Session Duration (min)", str(summary["session_duration_minutes"])],
        ]
        t = Table(summary_data, colWidths=[9*cm, 7*cm])
        t.setStyle(TableStyle([
            ("BACKGROUND",     (0, 0), (-1, 0), colors.HexColor("#2d3748")),
            ("TEXTCOLOR",      (0, 0), (-1, 0), colors.white),
            ("FONTNAME",       (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE",       (0, 0), (-1,-1), 10),
            ("ROWBACKGROUNDS", (0, 1), (-1,-1), [colors.HexColor("#f7fafc"), colors.white]),
            ("GRID",           (0, 0), (-1,-1), 0.5, colors.grey),
            ("PADDING",        (0, 0), (-1,-1), 6),
        ]))
        story.append(t)
        story.append(Spacer(1, 0.5*cm))

        # Timeline
        if report["timeline"]:
            story.append(Paragraph("Activity Timeline", H2))
            tl_data = [["Minute", "Events", "Has Critical"]]
            for entry in report["timeline"]:
                tl_data.append([
                    entry["label"],
                    str(entry["event_count"]),
                    "⚠️ Yes" if entry["has_critical"] else "No",
                ])
            tl_table = Table(tl_data, colWidths=[5*cm, 5*cm, 6*cm])
            tl_table.setStyle(TableStyle([
                ("BACKGROUND",     (0, 0), (-1, 0), colors.HexColor("#2d3748")),
                ("TEXTCOLOR",      (0, 0), (-1, 0), colors.white),
                ("FONTNAME",       (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE",       (0, 0), (-1,-1), 9),
                ("ROWBACKGROUNDS", (0, 1), (-1,-1), [colors.HexColor("#f7fafc"), colors.white]),
                ("GRID",           (0, 0), (-1,-1), 0.5, colors.grey),
                ("PADDING",        (0, 0), (-1,-1), 5),
            ]))
            story.append(tl_table)
            story.append(Spacer(1, 0.5*cm))

        # Recommendations
        story.append(Paragraph("Recommendations", H2))
        for rec in report["recommendations"]:
            story.append(Paragraph(f"• {rec}", NM))
        story.append(Spacer(1, 0.3*cm))

        # Detailed violations
        if self.violations:
            story.append(Paragraph("Detailed Violation Log", H2))
            viol_data = [["Timestamp", "Type", "Severity", "Details"]]
            for v in self.violations:
                ts_raw = v.get("timestamp", "")
                ts_display = str(ts_raw)[:19] if ts_raw else ""  # trim to seconds
                details_str = str(v.get("details", ""))[:60]
                viol_data.append([
                    ts_display,
                    v.get("type", ""),
                    v.get("severity", ""),
                    details_str,
                ])
            vt = Table(viol_data, colWidths=[4.5*cm, 4*cm, 2.5*cm, 5*cm])
            vt.setStyle(TableStyle([
                ("BACKGROUND",     (0, 0), (-1, 0), colors.HexColor("#2d3748")),
                ("TEXTCOLOR",      (0, 0), (-1, 0), colors.white),
                ("FONTNAME",       (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE",       (0, 0), (-1,-1), 8),
                ("ROWBACKGROUNDS", (0, 1), (-1,-1), [colors.HexColor("#f7fafc"), colors.white]),
                ("GRID",           (0, 0), (-1,-1), 0.5, colors.grey),
                ("PADDING",        (0, 0), (-1,-1), 4),
            ]))
            story.append(vt)

        doc.build(story)
        return buf.getvalue()
