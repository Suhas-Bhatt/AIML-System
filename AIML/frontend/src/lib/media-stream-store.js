/**
 * Module-level store for MediaStreams that need to persist across
 * client-side page navigations (e.g., onboarding → interview session).
 *
 * The "skipped" flags track when the user explicitly skipped a check
 * during onboarding, so downstream code knows not to re-prompt.
 */

let cameraStream = null;
let screenStream = null;
let cameraSkipped = false;
let screenSkipped = false;

export function setStoredCameraStream(stream) {
  cameraStream = stream;
  if (stream) cameraSkipped = false;
}

export function getStoredCameraStream() {
  if (cameraStream && cameraStream.active) return cameraStream;
  cameraStream = null;
  return null;
}

export function setCameraSkipped(skipped) {
  cameraSkipped = skipped;
}

export function wasCameraSkipped() {
  return cameraSkipped;
}

export function setStoredScreenStream(stream) {
  screenStream = stream;
  if (stream) screenSkipped = false;
}

export function getStoredScreenStream() {
  if (screenStream && screenStream.active) return screenStream;
  screenStream = null;
  return null;
}

export function setScreenSkipped(skipped) {
  screenSkipped = skipped;
}

export function wasScreenSkipped() {
  return screenSkipped;
}
