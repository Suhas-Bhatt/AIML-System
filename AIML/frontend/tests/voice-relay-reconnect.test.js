import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const relayPath = path.join(
  fileURLToPath(new URL("../../backend/voice-relay.js", import.meta.url)),
);

function readVoiceRelaySource() {
  return fs.readFileSync(relayPath, "utf8");
}

describe("backend/voice-relay.js reconnect & lifecycle (source checks)", () => {
  it("defines Volcengine reconnect tuning constants", () => {
    const src = readVoiceRelaySource();
    assert.match(src, /const MAX_VOLC_RECONNECT_ATTEMPTS = 3;/);
    assert.match(src, /const VOLC_RECONNECT_DELAY_MS = 1000;/);
  });

  it("implements autoReconnectVolcengine and session reconnect events", () => {
    const src = readVoiceRelaySource();
    assert.match(src, /async function autoReconnectVolcengine\(\)/);
    assert.ok(src.includes('"session_reconnecting"'));
    assert.ok(src.includes('"session_reconnected"'));
  });

  it("uses 2000ms keep-alive intervals for silence audio (not 5000ms)", () => {
    const src = readVoiceRelaySource();
    const keepAliveIntervals = src.match(
      /keepAliveInterval = setInterval\([\s\S]*?, 2000\);/g,
    );
    assert.equal(
      keepAliveIntervals?.length,
      3,
      "mic test, post-reconnect, and main interview keep-alive intervals",
    );
    for (const block of keepAliveIntervals ?? []) {
      assert.equal(
        /, 5000\)/.test(block),
        false,
        "each keep-alive block should end at 2000ms, not 5000ms",
      );
    }
  });

  it("marks interviews done and detaches Volcengine listeners when the browser closes", () => {
    const src = readVoiceRelaySource();
    assert.ok(
      src.includes(`browserWs.on("close", () => {`),
    );
    assert.ok(src.includes("interviewDone = true;"));
    assert.ok(src.includes("volcWs?.removeAllListeners();"));
  });

  it("installs a 10s safety timeout after farewell audio is queued", () => {
    const src = readVoiceRelaySource();
    assert.ok(
      src.includes(
        "Farewell TTS timed out after 10s — forcing interview end",
      ),
    );
    assert.match(
      src,
      /setTimeout\(\(\) => \{[\s\S]*?endInterview\(\);[\s\S]*?\}, 10_000\);/,
    );
  });
});

