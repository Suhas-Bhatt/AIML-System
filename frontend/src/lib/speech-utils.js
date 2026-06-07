/** Browser speech fallbacks — matches test_interview_app behaviour. */

export function isBrowserSTTAvailable() {
  return !!(typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition));
}

export function isBrowserTTSAvailable() {
  return !!(typeof window !== "undefined" && window.speechSynthesis);
}

export function createBrowserRecognizer({ lang = "en-US", onInterim, onFinal, onError, onEnd }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;

  const recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = lang;

  recognition.onresult = (event) => {
    let interim = "";
    let finalText = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const part = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalText += part + " ";
      } else {
        interim += part;
      }
    }
    if (interim) onInterim?.(interim.trim());
    if (finalText.trim()) onFinal?.(finalText.trim());
  };

  recognition.onerror = (event) => onError?.(event.error);
  recognition.onend = () => onEnd?.();

  return recognition;
}

export function speakWithBrowser(text, lang = "en-US") {
  return new Promise((resolve) => {
    if (!isBrowserTTSAvailable() || !text?.trim()) {
      resolve(false);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;

    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find((v) => v.name.includes("Google") && v.lang.startsWith(lang.slice(0, 2)));
    if (preferred) utterance.voice = preferred;

    utterance.rate = 1.0;
    utterance.onend = () => resolve(true);
    utterance.onerror = () => resolve(false);
    window.speechSynthesis.speak(utterance);
  });
}

export function cancelBrowserSpeech() {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* noop */
  }
}

export function preloadBrowserVoices() {
  if (!isBrowserTTSAvailable()) return;
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
  };
}
