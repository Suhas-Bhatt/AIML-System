import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-webgl";
import * as faceLandmarksDetection from "@tensorflow-models/face-landmarks-detection";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import "@mediapipe/face_mesh"; // Required for Face Mesh

let faceModel = null;
let objectModel = null;
let isLoaded = false;

async function loadModels() {
  try {
    // Explicitly set WebGL backend for hardware acceleration
    await tf.setBackend('webgl');
    await tf.ready();
    
    // Load face mesh (Face Landmarks Detection)
    const model = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;
    const detectorConfig = {
      runtime: 'tfjs',
      refineLandmarks: true // Required for iris tracking
    };
    faceModel = await faceLandmarksDetection.createDetector(model, detectorConfig);
    
    // Load object detection
    objectModel = await cocoSsd.load();
    
    isLoaded = true;
    self.postMessage({ type: "INIT_SUCCESS" });
  } catch (e) {
    self.postMessage({ type: "INIT_ERROR", error: e.message });
  }
}

function calculateGaze(keypoints) {
  // We need to calculate if the iris is centered relative to the eye corners
  // A simple heuristic: x-distance of iris to left corner / total eye width
  // Indices for MediaPipe Face Mesh:
  // Left eye corners: 33 (left), 133 (right)
  // Left iris center: 468
  const leftCorner = keypoints[33];
  const rightCorner = keypoints[133];
  const iris = keypoints[468];
  
  if (!leftCorner || !rightCorner || !iris) return "CENTER";

  const eyeWidth = Math.abs(rightCorner.x - leftCorner.x);
  const irisDist = Math.abs(iris.x - leftCorner.x);
  
  // Ratio of iris position relative to eye width
  const ratio = irisDist / eyeWidth;
  
  // Ratios < 0.35 mean looking far left (depending on camera mirror)
  // Ratios > 0.65 mean looking far right
  if (ratio < 0.35) return "LEFT";
  if (ratio > 0.65) return "RIGHT";
  return "CENTER";
}

self.onmessage = async (e) => {
  if (e.data.type === "INIT") {
    loadModels();
    return;
  }
  
  if (e.data.type === "PROCESS_FRAME") {
    if (!isLoaded || !faceModel || !objectModel) {
      // Send empty violations if not loaded yet
      self.postMessage({ type: "RESULT", violations: [] });
      return;
    }
    
    const imageData = e.data.imageData; 
    
    try {
      // Estimate faces
      const faces = await faceModel.estimateFaces(imageData, { flipHorizontal: false });
      // Detect objects
      const objects = await objectModel.detect(imageData);
      
      const violations = [];
      
      // 1. Phone check
      if (objects.some(p => p.class === "cell phone")) {
        violations.push("ai_cell_phone");
      }
      
      // 2. Face check
      if (faces.length === 0) {
        violations.push("ai_no_face");
      } else if (faces.length > 1) {
        violations.push("ai_multiple_faces");
      } else {
        const face = faces[0];
        // 3. Distance check (using bounding box)
        if (face.box) {
          const faceWidth = face.box.width;
          const frameWidth = imageData.width;
          const faceRatio = faceWidth / frameWidth;
          
          if (faceRatio < 0.15) { // Face takes up less than 15% of width
            violations.push("ai_face_too_far");
          }
        }
        
        // 4. Gaze check
        if (face.keypoints) {
          const gaze = calculateGaze(face.keypoints);
          if (gaze !== "CENTER") {
            violations.push("ai_gaze_violation");
          }
        }
      }
      
      self.postMessage({ type: "RESULT", violations });
      
    } catch (err) {
      console.error("Worker processing error:", err);
      // Failsafe
      self.postMessage({ type: "RESULT", violations: [] });
    }
  }
};
