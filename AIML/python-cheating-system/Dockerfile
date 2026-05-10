FROM python:3.11-slim

# System deps for OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libsm6 libxext6 libxrender-dev libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . .

# Download YOLOv8n weights if not present
RUN python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')" || true

EXPOSE 8000

CMD ["python", "run.py"]
