"""
proctoring/detectors/yolo_model_manager.py

OPTIMIZATION: Singleton YOLO model manager
- Loads YOLO model ONCE on application startup
- Reuses model across all sessions
- Reduces memory from ~200MB × N_sessions to ~200MB total
- Reduces initialization time from 200ms × N_sessions to 200ms total

Usage:
    from proctoring.detectors.yolo_model_manager import get_yolo_model
    
    model = get_yolo_model()
    results = model(frame, verbose=False, imgsz=320)
"""

import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Global YOLO model instance
_YOLO_MODEL: Optional[object] = None
_MODEL_AVAILABLE: bool = False
_MODEL_PATH: str = os.path.join(
    os.path.dirname(__file__), "..", "..", "models", "yolov8n.pt"
)


def initialize_yolo_model() -> bool:
    """
    Initialize YOLO model at application startup.
    Call this ONCE in FastAPI lifespan.
    
    Returns:
        True if model initialized successfully, False otherwise
    """
    global _YOLO_MODEL, _MODEL_AVAILABLE
    
    if _YOLO_MODEL is not None:
        logger.info("[YOLO] Model already initialized (singleton)")
        return _MODEL_AVAILABLE
    
    try:
        from ultralytics import YOLO
        
        # Use model path if it exists, otherwise download default
        model_path = _MODEL_PATH if os.path.exists(_MODEL_PATH) else "yolov8n.pt"
        logger.info(f"[YOLO] Initializing model from: {model_path}")
        
        _YOLO_MODEL = YOLO(model_path)
        _MODEL_AVAILABLE = True
        
        logger.info("[YOLO] Model initialized successfully (singleton)")
        return True
        
    except ImportError:
        logger.warning(
            "[YOLO] ultralytics not installed — object detection disabled. "
            "Run: pip install ultralytics"
        )
        _MODEL_AVAILABLE = False
        return False
        
    except Exception as e:
        logger.error(f"[YOLO] Failed to initialize model: {e}")
        _MODEL_AVAILABLE = False
        return False


def get_yolo_model() -> Optional[object]:
    """
    Get the global YOLO model instance.
    
    IMPORTANT: Call initialize_yolo_model() in FastAPI lifespan FIRST.
    
    Returns:
        YOLO model instance, or None if initialization failed
    """
    if _YOLO_MODEL is None:
        logger.error("[YOLO] Model not initialized. Call initialize_yolo_model() first.")
        return None
    return _YOLO_MODEL


def is_model_available() -> bool:
    """Check if YOLO model is available for inference."""
    return _MODEL_AVAILABLE and _YOLO_MODEL is not None


def release_yolo_model() -> None:
    """
    Release YOLO model resources.
    Call this in FastAPI lifespan shutdown.
    """
    global _YOLO_MODEL, _MODEL_AVAILABLE
    
    if _YOLO_MODEL is not None:
        try:
            logger.info("[YOLO] Releasing model resources...")
            # YOLO models don't have explicit dispose, but we can clear the reference
            _YOLO_MODEL = None
            _MODEL_AVAILABLE = False
            logger.info("[YOLO] Model released")
        except Exception as e:
            logger.error(f"[YOLO] Error releasing model: {e}")
