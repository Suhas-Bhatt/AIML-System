import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-webgl";
import * as blazeface from "@tensorflow-models/blazeface";
import * as cocoSsd from "@tensorflow-models/coco-ssd";

let faceModel = null;
let objectModel = null;

async function loadModels() {
  await tf.ready();
  faceModel = await blazeface.load();
  objectModel = await cocoSsd.load();
  self.postMessage({ type: "MODELS_LOADED" });
}

loadModels().catch((err) => {
  self.postMessage({ type: "ERROR", error: err.message });
});

self.addEventListener("message", async (e) => {
  if (e.data.type === "PROCESS_FRAME") {
    if (!faceModel || !objectModel) return;
    
    const { imageBitmap, frameWidth } = e.data;
    try {
      const faces = await faceModel.estimateFaces(imageBitmap, false);
      const objects = await objectModel.detect(imageBitmap);

      const violations = [];

      if (objects.some(p => p.class === "cell phone")) {
        violations.push("ai_cell_phone");
      }

      if (faces.length === 0) {
        violations.push("ai_no_face");
      } else if (faces.length > 1) {
        violations.push("ai_multiple_faces");
      } else {
        const face = faces[0];
        if (face.topLeft && face.bottomRight) {
          const faceWidth = face.bottomRight[0] - face.topLeft[0];
          const faceRatio = faceWidth / frameWidth;
          if (faceRatio < 0.15) {
            violations.push("ai_face_too_far");
          }
        }
      }

      self.postMessage({ type: "DETECTION_RESULT", violations });
    } catch (err) {
      console.warn("Worker frame error", err);
    } finally {
      // Free the bitmap memory
      if (imageBitmap && typeof imageBitmap.close === 'function') {
        imageBitmap.close();
      }
    }
  }
});
