"""
reports/report_generator.py

Generates recruiter-ready reports from a completed (or live) proctoring session.

JSON report: always available
PDF report:  requires `pip install reportlab`
"""

import io
import time
from collections import defaultdict
from typing import Dict, Any, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from api.session_manager import ProctoringSession


class ReportGenerator:
    """
    Usage:
        gen    = ReportGenerator(session)
        report = gen.generate_json()   # dict
        pdf    = gen.generate_pdf()    # bytes
    """

    SEVERITY_WEIGHT = {"CRITICAL": 10, "HIGH": 6, "WARNING": 3, "LOW": 1}

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
                "report_generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
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
        total     = len(self.violations)
        by_sev    = defaultdict(int)
        by_type   = defaultdict(int)
        for v in self.violations:
            by_sev[v.get("severity", "UNKNOWN")] += 1
            by_type[v.get("type", "UNKNOWN")]    += 1

        duration = self.status.get("duration_s", 0)
        vpm      = round((total / (duration / 60)) if duration > 60 else total, 2)

        return {
            "total_violations":        total,
            "violations_per_minute":   vpm,
            "by_severity":             dict(by_sev),
            "by_type":                 dict(by_type),
            "critical_violations":     by_sev.get("CRITICAL", 0),
            "high_violations":         by_sev.get("HIGH", 0),
            "session_duration_minutes": round(duration / 60, 1),
            "monitoring_status":       "completed" if not self.session.is_running else "live",
        }

    def _build_timeline(self) -> List[Dict[str, Any]]:
        """Group violations by minute for activity heatmap."""
        if not self.violations or not self.session.started_at:
            return []

        start_ms = self.session.started_at * 1000
        by_minute: Dict[int, List[Dict]] = defaultdict(list)

        for v in self.violations:
            ts_ms  = v.get("timestamp", start_ms)
            minute = int((ts_ms - start_ms) / 60_000)
            by_minute[minute].append({
                "type":           v.get("type"),
                "severity":       v.get("severity"),
                "detail":         v.get("detail"),
                "formatted_time": v.get("formatted_time"),
            })

        timeline = []
        for minute in sorted(by_minute.keys()):
            events = by_minute[minute]
            timeline.append({
                "minute":      minute,
                "label":       f"Min {minute}–{minute+1}",
                "event_count": len(events),
                "events":      events,
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
                "first_at":     vs[0].get("formatted_time"),
                "last_at":      vs[-1].get("formatted_time"),
                "severities":   {s: severities.count(s) for s in set(severities)},
                "description":  self._describe_type(vtype),
            }
        return breakdown

    def _calculate_risk_score(self) -> Dict[str, Any]:
        """0–100 weighted risk score."""
        if not self.violations:
            return {"score": 0, "label": "Clean", "color": "green"}

        raw = sum(self.SEVERITY_WEIGHT.get(v.get("severity", "LOW"), 1)
                  for v in self.violations)

        # Normalise: 100 points = 10 critical violations
        score = min(int((raw / 100) * 100), 100)

        label = "Clean"
        color = "green"
        if score >= 75:
            label, color = "High Risk",    "red"
        elif score >= 45:
            label, color = "Medium Risk",  "orange"
        elif score >= 15:
            label, color = "Low Risk",     "yellow"

        return {"score": score, "label": label, "color": color, "raw_weight": raw}

    def _top_concerns(self) -> List[Dict[str, Any]]:
        """Rank violations by severity weight and frequency."""
        by_type: Dict[str, Dict[str, Any]] = {}
        for v in self.violations:
            t = v.get("type", "UNKNOWN")
            if t not in by_type:
                by_type[t] = {"type": t, "count": 0, "weight": 0, "severity": v.get("severity")}
            by_type[t]["count"]  += 1
            by_type[t]["weight"] += self.SEVERITY_WEIGHT.get(v.get("severity", "LOW"), 1)

        ranked = sorted(by_type.values(), key=lambda x: x["weight"], reverse=True)
        return ranked[:5]  # top 5

    def _recommendations(self, risk_score: Dict, breakdown: Dict) -> List[str]:
        recs = []
        score = risk_score.get("score", 0)

        if score == 0:
            recs.append("✅ No suspicious activity detected. Session appears clean.")
            return recs

        if score >= 75:
            recs.append("🔴 HIGH RISK: Recommend immediate manual review of this session.")

        if "OBJECT_EVENT" in breakdown:
            recs.append("📱 Phone detected. Candidate may have accessed unauthorized resources.")

        if "FACE_DATA" in breakdown:
            fd = breakdown["FACE_DATA"]
            if "CRITICAL" in fd.get("severities", {}):
                recs.append("👤 Candidate was absent from camera. Identity cannot be confirmed for those periods.")
            elif "HIGH" in fd.get("severities", {}):
                recs.append("👥 Multiple faces detected. Unauthorized person may have assisted the candidate.")

        if "GAZE_DATA" in breakdown and breakdown["GAZE_DATA"]["count"] >= 5:
            recs.append("👀 Candidate frequently looked away from the screen. May indicate reference material use.")

        if "TAB_SWITCH" in breakdown:
            recs.append("🖥️ Tab switching detected. Candidate may have looked up answers in another browser tab.")

        if not recs:
            recs.append("⚠️ Low-level anomalies detected. Manual review recommended.")

        return recs

    @staticmethod
    def _describe_type(vtype: str) -> str:
        return {
            "FACE_DATA":    "Face count anomaly (zero faces or multiple faces detected)",
            "OBJECT_EVENT": "Unauthorized object detected (phone/device)",
            "GAZE_DATA":    "Candidate looked away from screen",
            "TAB_SWITCH":   "Browser tab or window focus lost",
        }.get(vtype, vtype)

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

        # ── Header ────────────────────────────────────────────────────
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

        # ── Risk score ────────────────────────────────────────────────
        story.append(Paragraph("Risk Assessment", H2))
        rs = report["risk_score"]
        risk_color = {"green": colors.green, "yellow": colors.orange,
                      "orange": colors.darkorange, "red": colors.red}.get(rs["color"], colors.black)
        story.append(Paragraph(
            f'<font color="{rs["color"]}"><b>Risk Level: {rs["label"]} ({rs["score"]}/100)</b></font>', NM
        ))
        story.append(Spacer(1, 0.3*cm))

        # ── Summary table ─────────────────────────────────────────────
        story.append(Paragraph("Violation Summary", H2))
        summary = report["summary"]
        summary_data = [
            ["Metric", "Value"],
            ["Total Violations",      str(summary["total_violations"])],
            ["Violations / Minute",   str(summary["violations_per_minute"])],
            ["Critical Violations",   str(summary["critical_violations"])],
            ["High Violations",       str(summary["high_violations"])],
            ["Session Duration (min)", str(summary["session_duration_minutes"])],
        ]
        t = Table(summary_data, colWidths=[9*cm, 7*cm])
        t.setStyle(TableStyle([
            ("BACKGROUND",   (0, 0), (-1, 0), colors.HexColor("#2d3748")),
            ("TEXTCOLOR",    (0, 0), (-1, 0), colors.white),
            ("FONTNAME",     (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE",     (0, 0), (-1,-1), 10),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor("#f7fafc"), colors.white]),
            ("GRID",         (0, 0), (-1,-1), 0.5, colors.grey),
            ("PADDING",      (0, 0), (-1,-1), 6),
        ]))
        story.append(t)
        story.append(Spacer(1, 0.5*cm))

        # ── Timeline ──────────────────────────────────────────────────
        if report["timeline"]:
            story.append(Paragraph("Activity Timeline", H2))
            tl_data = [["Minute", "Events", "Has Critical"]]
            for entry in report["timeline"]:
                has_crit = "⚠️ Yes" if entry["has_critical"] else "No"
                tl_data.append([entry["label"], str(entry["event_count"]), has_crit])
            tl_table = Table(tl_data, colWidths=[5*cm, 5*cm, 6*cm])
            tl_table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2d3748")),
                ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
                ("FONTNAME",   (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE",   (0, 0), (-1,-1), 9),
                ("ROWBACKGROUNDS", (0, 1), (-1,-1), [colors.HexColor("#f7fafc"), colors.white]),
                ("GRID",       (0, 0), (-1,-1), 0.5, colors.grey),
                ("PADDING",    (0, 0), (-1,-1), 5),
            ]))
            story.append(tl_table)
            story.append(Spacer(1, 0.5*cm))

        # ── Recommendations ───────────────────────────────────────────
        story.append(Paragraph("Recommendations", H2))
        for rec in report["recommendations"]:
            story.append(Paragraph(f"• {rec}", NM))
        story.append(Spacer(1, 0.3*cm))

        # ── Detailed violations ───────────────────────────────────────
        if self.violations:
            story.append(Paragraph("Detailed Violation Log", H2))
            viol_data = [["Time", "Type", "Severity", "Detail"]]
            for v in self.violations:
                viol_data.append([
                    v.get("formatted_time", ""),
                    v.get("type", ""),
                    v.get("severity", ""),
                    v.get("detail", "")[:60],
                ])
            vt = Table(viol_data, colWidths=[4*cm, 4*cm, 3*cm, 5*cm])
            vt.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2d3748")),
                ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
                ("FONTNAME",   (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE",   (0, 0), (-1,-1), 8),
                ("ROWBACKGROUNDS", (0, 1), (-1,-1), [colors.HexColor("#f7fafc"), colors.white]),
                ("GRID",       (0, 0), (-1,-1), 0.5, colors.grey),
                ("PADDING",    (0, 0), (-1,-1), 4),
            ]))
            story.append(vt)

        doc.build(story)
        return buf.getvalue()
