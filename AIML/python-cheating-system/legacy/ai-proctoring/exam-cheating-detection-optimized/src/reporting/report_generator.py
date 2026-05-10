"""
Report generator — updated for episode-based violation data.

Each violation now has start/end/duration/evidence, so the timeline is
much more meaningful (a 5-minute look-away counts as one event, not 50).

Uses HTML by default; PDF only if wkhtmltopdf is configured.
"""

import os
import logging
from datetime import datetime
from typing import Optional

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from jinja2 import Environment, FileSystemLoader


class ReportGenerator:
    def __init__(self, config: dict):
        self.config = config.get("reporting", {})
        self.output_dir = self.config.get("output_dir", "./reports/generated")
        self.image_dir = self.config.get("image_dir",
                                         os.path.join(self.output_dir, "images"))
        os.makedirs(self.output_dir, exist_ok=True)
        os.makedirs(self.image_dir, exist_ok=True)

        template_path = os.path.join(os.path.dirname(__file__), "templates")
        self.env = Environment(loader=FileSystemLoader(template_path))

        self.severity_map = self.config.get("severity_levels", {
            "FACE_DISAPPEARED": 3,
            "GAZE_AWAY": 2,
            "TALKING_DETECTED": 4,
            "MULTIPLE_FACES": 5,
            "OBJECT_DETECTED": 5,
            "LIVENESS_FAILED": 4,
            "AUDIO_DETECTED": 2,
        })
        self.log = logging.getLogger("ReportGenerator")

    # ------------------------------------------------------------------
    def generate(self, student_info: dict, violations: list,
                 output_format: str = "html") -> Optional[str]:
        try:
            stats = self._stats(violations)
            timeline_img = self._timeline(violations, student_info["id"])
            heatmap_img = self._heatmap(violations, student_info["id"])

            data = {
                "student": student_info,
                "violations": violations,
                "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "stats": stats,
                "timeline_image": timeline_img,
                "heatmap_image": heatmap_img,
                "has_images": bool(timeline_img or heatmap_img),
            }
            html = self.env.get_template("base_report.html").render(data)
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            base = os.path.join(self.output_dir, f"report_{student_info['id']}_{ts}")

            # Try PDF only if wkhtmltopdf is actually present.
            wk = self.config.get("wkhtmltopdf_path", "")
            if output_format == "pdf" and wk and os.path.exists(wk):
                try:
                    import pdfkit
                    cfg_pdf = pdfkit.configuration(wkhtmltopdf=wk)
                    out = base + ".pdf"
                    pdfkit.from_string(html, out, configuration=cfg_pdf,
                                       options={"enable-local-file-access": None,
                                                "quiet": ""})
                    return out
                except Exception as e:
                    self.log.warning(f"PDF gen failed, falling back to HTML: {e}")

            out = base + ".html"
            with open(out, "w", encoding="utf-8") as f:
                f.write(html)
            return out
        except Exception as e:
            self.log.error(f"Report generation failed: {e}")
            return None

    # ------------------------------------------------------------------
    def _stats(self, violations: list) -> dict:
        stats = {
            "total": len(violations),
            "by_type": {},
            "total_severity": 0,
            "total_violation_seconds": 0.0,
        }
        for v in violations:
            t = v.get("type", "UNKNOWN")
            stats["by_type"][t] = stats["by_type"].get(t, 0) + 1
            stats["total_severity"] += self.severity_map.get(t, 1)
            try:
                d = v.get("duration_sec") or 0
                stats["total_violation_seconds"] += float(d) if d else 0.0
            except (TypeError, ValueError):
                pass
        stats["avg_severity"] = (stats["total_severity"] / stats["total"]) if stats["total"] else 0
        return stats

    def _parse_ts(self, s):
        if not s:
            return None
        try:
            return datetime.fromisoformat(s)
        except (ValueError, TypeError):
            return None

    def _timeline(self, violations, sid):
        if not violations:
            return None
        try:
            times, sev, labels = [], [], []
            for v in violations:
                t = self._parse_ts(v.get("started_at"))
                if t is None:
                    continue
                times.append(t)
                sev.append(self.severity_map.get(v.get("type"), 1))
                labels.append(v.get("type", ""))
            if not times:
                return None

            plt.figure(figsize=(12, 5))
            plt.plot(times, sev, "o-", markersize=8)
            for t, s, lbl in zip(times, sev, labels):
                plt.annotate(lbl, (t, s), textcoords="offset points",
                             xytext=(0, 10), ha="center", fontsize=8)
            plt.title(f"Violation Timeline — {sid}")
            plt.xlabel("Time")
            plt.ylabel("Severity")
            plt.grid(True, linestyle="--", alpha=0.6)
            plt.xticks(rotation=45)
            plt.tight_layout()
            path = os.path.join(self.image_dir, f"timeline_{sid}.png")
            plt.savefig(path, dpi=140, bbox_inches="tight")
            plt.close()
            return path
        except Exception as e:
            self.log.error(f"timeline failed: {e}")
            return None

    def _heatmap(self, violations, sid):
        if not violations:
            return None
        try:
            counts = {}
            for v in violations:
                t = v.get("type", "UNKNOWN")
                counts[t] = counts.get(t, 0) + 1
            ordered = sorted(counts.items(), key=lambda x: x[1], reverse=True)
            types, vals = zip(*ordered)
            plt.figure(figsize=(10, 5))
            colors = [plt.cm.Reds(self.severity_map.get(t, 1) / 5) for t in types]
            bars = plt.barh(types, vals, color=colors, edgecolor="black", linewidth=0.7)
            for bar in bars:
                w = bar.get_width()
                plt.text(w + 0.2, bar.get_y() + bar.get_height() / 2,
                         f"{int(w)}", va="center", ha="left", fontsize=10)
            plt.title(f"Violation Frequency — {sid}")
            plt.xlabel("Count")
            plt.ylabel("Violation Type")
            plt.grid(True, linestyle="--", alpha=0.3, axis="x")
            plt.tight_layout()
            path = os.path.join(self.image_dir, f"heatmap_{sid}.png")
            plt.savefig(path, dpi=140, bbox_inches="tight")
            plt.close()
            return path
        except Exception as e:
            self.log.error(f"heatmap failed: {e}")
            return None
