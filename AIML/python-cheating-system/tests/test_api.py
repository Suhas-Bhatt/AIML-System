"""Basic smoke tests for the AI service endpoints."""
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "healthy"
    assert "active_sessions" in data


def test_start_and_stop_session():
    r = client.post("/api/v1/session/start", json={"session_id": "test-123"})
    assert r.status_code == 200
    assert r.json()["status"] == "started"

    r = client.post("/api/v1/session/stop/test-123")
    assert r.status_code == 200
    assert r.json()["status"] == "stopped"


def test_stop_nonexistent_session():
    r = client.post("/api/v1/session/stop/nonexistent")
    assert r.status_code == 404


def test_frame_missing_frame_field():
    r = client.post("/api/v1/proctor/frame", json={"session_id": "x"})
    assert r.status_code == 422


def test_frame_bad_base64():
    r = client.post("/api/v1/proctor/frame", json={
        "session_id": "test-bad",
        "frame": "data:image/jpeg;base64,notvalidbase64!!!",
        "audio_level": 0.0,
    })
    assert r.status_code == 200
    data = r.json()
    # Should gracefully return failure
    assert data["success"] is False or data.get("status") == "Safe"
