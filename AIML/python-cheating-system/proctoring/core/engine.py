import threading
import queue
import time

class DetectorWorker(threading.Thread):
    def __init__(self, buffer, event_queue, interval=5,
                 performance_monitor=None, adaptive_manager=None):
        super().__init__(daemon=True, name=self.__class__.__name__)
        self.buffer = buffer
        self.event_queue = event_queue
        self.interval = interval
        self.stop_event = threading.Event()
        self._last_processed_id = -1

    def run(self):
        frame_count = 0
        while not self.stop_event.is_set():
            frame, fid = self.buffer.get_frame_with_id()
            if frame is None or fid == self._last_processed_id:
                time.sleep(0.01)
                continue

            frame_count += 1
            if frame_count % self.interval == 0:
                self._last_processed_id = fid
                result = self.process(frame)
                if result:
                    self.event_queue.put(result)
            
            time.sleep(0.005)

    def process(self, frame):
        """Override in subclasses"""
        return None

    def stop(self):
        self.stop_event.set()

class SentinelEngine:

    def __init__(self, frame_buffer):
        self.frame_buffer = frame_buffer
        self.event_queue = queue.Queue(maxsize=100)
        self.workers = []
        self.threads = []
        self.stop_event = threading.Event()

    def add_worker(self, worker_class, interval=5):
        self.workers.append((worker_class, interval))

    def start(self):
        for worker_class, interval in self.workers:
            # Instantiate worker with buffer and queue
            # (Assuming workers follow the expected interface in standalone_test)
            t = worker_class(self.frame_buffer, self.event_queue, interval, self.stop_event)
            t.start()
            self.threads.append(t)

    def stop(self):
        self.stop_event.set()
        for t in self.threads:
            t.join(timeout=2.0)

    def get_engine_stats(self):
        return {
            "active_workers": len([t for t in self.threads if t.is_alive()]),
            "queue_size": self.event_queue.qsize()
        }
