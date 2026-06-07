"""
proctoring/monitoring/memory_monitor.py

OPTIMIZATION: Process memory monitoring
Tracks RAM, CPU, and other resources to detect leaks and inefficiencies.

Usage:
    from proctoring.monitoring.memory_monitor import MemoryMonitor
    
    monitor = MemoryMonitor()
    monitor.start()
    
    # ... run your code ...
    
    stats = monitor.get_stats()
    print(stats)
"""

import psutil
import os
import threading
import time
import logging
from typing import Dict, Any, Optional
from dataclasses import dataclass, asdict
from datetime import datetime

logger = logging.getLogger(__name__)


@dataclass
class ProcessStats:
    """Snapshot of process memory and CPU statistics"""
    timestamp: float
    pid: int
    rss_mb: float  # Resident Set Size (physical RAM)
    vms_mb: float  # Virtual Memory Size
    cpu_percent: float  # CPU usage percentage
    cpu_num: int  # Number of CPUs used
    num_threads: int  # Number of threads
    num_fds: int  # Number of file descriptors
    
    def __str__(self) -> str:
        return (
            f"[{datetime.fromtimestamp(self.timestamp).isoformat()}] "
            f"RSS: {self.rss_mb:.1f}MB | VMS: {self.vms_mb:.1f}MB | "
            f"CPU: {self.cpu_percent:.1f}% | Threads: {self.num_threads} | "
            f"FDs: {self.num_fds}"
        )


class MemoryMonitor:
    """
    Thread-safe memory and CPU monitor for long-running processes.
    
    Features:
    - Periodic sampling of process stats
    - Peak memory tracking
    - Memory trend detection
    - CSV export for analysis
    """
    
    def __init__(self, interval_sec: float = 5.0, max_samples: int = 1000):
        """
        Args:
            interval_sec: Sampling interval in seconds
            max_samples: Maximum number of samples to keep (circular buffer)
        """
        self.interval = interval_sec
        self.max_samples = max_samples
        self._process = psutil.Process(os.getpid())
        self._samples: list[ProcessStats] = []
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._monitor_thread: Optional[threading.Thread] = None
        self._is_running = False
    
    def start(self) -> None:
        """Start monitoring in background thread"""
        if self._is_running:
            logger.warning("[MemoryMonitor] Already running")
            return
        
        self._stop_event.clear()
        self._monitor_thread = threading.Thread(
            target=self._monitor_loop,
            daemon=True,
            name="MemoryMonitor"
        )
        self._monitor_thread.start()
        self._is_running = True
        logger.info("[MemoryMonitor] Started (interval: {:.1f}s)".format(self.interval))
    
    def stop(self) -> None:
        """Stop monitoring and wait for thread to finish"""
        if not self._is_running:
            return
        
        self._stop_event.set()
        if self._monitor_thread and self._monitor_thread.is_alive():
            self._monitor_thread.join(timeout=5.0)
        self._is_running = False
        logger.info("[MemoryMonitor] Stopped")
    
    def _monitor_loop(self) -> None:
        """Background monitoring loop"""
        try:
            while not self._stop_event.is_set():
                try:
                    stats = self._collect_stats()
                    with self._lock:
                        self._samples.append(stats)
                        # Keep only last N samples (circular buffer)
                        if len(self._samples) > self.max_samples:
                            self._samples.pop(0)
                except Exception as e:
                    logger.error(f"[MemoryMonitor] Error collecting stats: {e}")
                
                self._stop_event.wait(self.interval)
        
        except Exception as e:
            logger.exception(f"[MemoryMonitor] Fatal error: {e}")
    
    def _collect_stats(self) -> ProcessStats:
        """Collect current process statistics"""
        try:
            with self._process.oneshot():
                mem_info = self._process.memory_info()
                rss_mb = mem_info.rss / (1024 * 1024)
                vms_mb = mem_info.vms / (1024 * 1024)
                
                try:
                    cpu_percent = self._process.cpu_percent(interval=0.1)
                except Exception:
                    cpu_percent = 0.0
                
                try:
                    num_fds = self._process.num_fds()
                except (AttributeError, psutil.AccessDenied):
                    num_fds = 0
                
                return ProcessStats(
                    timestamp=time.time(),
                    pid=self._process.pid,
                    rss_mb=rss_mb,
                    vms_mb=vms_mb,
                    cpu_percent=cpu_percent,
                    cpu_num=self._process.cpu_num(),
                    num_threads=self._process.num_threads(),
                    num_fds=num_fds,
                )
        except Exception as e:
            logger.error(f"Error collecting stats: {e}")
            raise
    
    def get_stats(self) -> Dict[str, Any]:
        """Get current statistics summary"""
        with self._lock:
            if not self._samples:
                return {"error": "No samples collected yet"}
            
            latest = self._samples[-1]
            samples_copy = list(self._samples)
        
        if len(samples_copy) < 2:
            return asdict(latest)
        
        # Calculate statistics
        rss_values = [s.rss_mb for s in samples_copy]
        vms_values = [s.vms_mb for s in samples_copy]
        cpu_values = [s.cpu_percent for s in samples_copy]
        
        return {
            "latest": asdict(latest),
            "memory_rss": {
                "current_mb": rss_values[-1],
                "peak_mb": max(rss_values),
                "min_mb": min(rss_values),
                "avg_mb": sum(rss_values) / len(rss_values),
                "trend": "increasing" if rss_values[-1] > rss_values[0] else "stable/decreasing",
            },
            "memory_vms": {
                "current_mb": vms_values[-1],
                "peak_mb": max(vms_values),
            },
            "cpu": {
                "current_percent": cpu_values[-1],
                "avg_percent": sum(cpu_values) / len(cpu_values),
                "peak_percent": max(cpu_values),
            },
            "samples": len(samples_copy),
            "duration_sec": samples_copy[-1].timestamp - samples_copy[0].timestamp,
        }
    
    def get_latest(self) -> Optional[ProcessStats]:
        """Get latest sample"""
        with self._lock:
            return self._samples[-1] if self._samples else None
    
    def export_csv(self, filepath: str) -> bool:
        """Export samples to CSV file"""
        try:
            import csv
            with self._lock:
                samples_copy = list(self._samples)
            
            if not samples_copy:
                logger.warning("[MemoryMonitor] No samples to export")
                return False
            
            with open(filepath, 'w', newline='') as csvfile:
                fieldnames = [f for f in asdict(samples_copy[0]).keys()]
                writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
                writer.writeheader()
                for sample in samples_copy:
                    writer.writerow(asdict(sample))
            
            logger.info(f"[MemoryMonitor] Exported {len(samples_copy)} samples to {filepath}")
            return True
        
        except Exception as e:
            logger.error(f"[MemoryMonitor] Error exporting CSV: {e}")
            return False


# Global monitor instance
_global_monitor: Optional[MemoryMonitor] = None


def start_global_monitor(interval_sec: float = 5.0) -> MemoryMonitor:
    """Start the global memory monitor"""
    global _global_monitor
    if _global_monitor is None:
        _global_monitor = MemoryMonitor(interval_sec=interval_sec)
        _global_monitor.start()
    return _global_monitor


def stop_global_monitor() -> None:
    """Stop the global memory monitor"""
    global _global_monitor
    if _global_monitor:
        _global_monitor.stop()
        _global_monitor = None


def get_global_monitor() -> Optional[MemoryMonitor]:
    """Get the global memory monitor"""
    return _global_monitor
