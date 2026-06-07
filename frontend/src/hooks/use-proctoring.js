"use client";

import * as tf from "@tensorflow/tfjs";
import * as blazeface from "@tensorflow-models/blazeface";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import { useState, useEffect, useRef } from "react";

export function useProctoring({ videoRef, active = false }) {
  const [faceModel, setFaceModel] = useState(null);
  const [objectModel, setObjectModel] = useState(null);
  const [modelError, setModelError] = useState(null);
  
  // Warning States
  const [faceWarningActive, setFaceWarningActive] = useState(false);
  const [faceWarningMessage, setFaceWarningMessage] = useState("");
  const [phoneWarningActive, setPhoneWarningActive] = useState(false);

  const missingFaceCount = useRef(0);
  const detectionInterval = useRef(null);

  // Load models once
  useEffect(() => {
    let mounted = true;
    const loadModels = async () => {
      try {
        await tf.ready();
        const [fModel, oModel] = await Promise.all([
          blazeface.load(),
          cocoSsd.load()
        ]);
        if (mounted) {
          setFaceModel(fModel);
          setObjectModel(oModel);
        }
      } catch (err) {
        console.error("Failed to load AI models", err);
        if (mounted) {
          setModelError(err.message || "Failed to load models.");
        }
      }
    };
    loadModels();
    return () => { mounted = false; };
  }, []);

  // Run detection when active
  useEffect(() => {
    if (active && faceModel && objectModel && videoRef?.current) {
      detectionInterval.current = setInterval(async () => {
        if (videoRef.current && videoRef.current.readyState === 4) {
          try {
            // 1. Face Detection
            const facePredictions = await faceModel.estimateFaces(videoRef.current, false);
            if (facePredictions.length === 0) {
              missingFaceCount.current += 1;
              if (missingFaceCount.current >= 3) {
                setFaceWarningMessage("No face detected! Please stay in front of the camera.");
                setFaceWarningActive(true);
              }
            } else if (facePredictions.length > 1) {
              setFaceWarningMessage("Multiple faces detected! You must be alone during the interview.");
              setFaceWarningActive(true);
              missingFaceCount.current = 0;
            } else {
              // Exactly 1 face
              missingFaceCount.current = 0;
              setFaceWarningActive(false);
            }

            // 2. Phone Detection
            const objPredictions = await objectModel.detect(videoRef.current);
            const phoneDetected = objPredictions.some(pred => pred.class === 'cell phone');
            
            if (phoneDetected) {
              setPhoneWarningActive(true);
            } else {
              setPhoneWarningActive(false);
            }

          } catch (e) {
            console.error("AI detection error", e);
          }
        }
      }, 1000);
    }
    
    return () => {
      if (detectionInterval.current) {
        clearInterval(detectionInterval.current);
      }
    };
  }, [active, faceModel, objectModel, videoRef]);

  return {
    modelsReady: !!(faceModel && objectModel),
    modelError,
    faceWarningActive,
    faceWarningMessage,
    phoneWarningActive
  };
}
