const DEFAULT_VOICE_RELAY_PORT = "8766";
const DEFAULT_OPENAI_RELAY_PORT = "8767";
const DEFAULT_VOICE_RELAY_PATH = "/ws/voice";
const DEFAULT_OPENAI_RELAY_PATH = "/ws/openai-voice";
const READY_STATE_OPEN = 1;

export function isChineseVoiceLanguage(language) {
  if (!language) return false;
  const normalized = language.trim().toLowerCase();
  return (
    normalized === "zh" ||
    normalized.startsWith("zh-") ||
    normalized.includes("chinese") ||
    normalized.includes("中文")
  );
}

function deriveUrlFromBrowser(
  browserProtocol,
  browserHost,
  port,
  pathname = DEFAULT_VOICE_RELAY_PATH
) {
  if (!browserProtocol || !browserHost) return null;
  try {
    const protocol = browserProtocol === "https:" ? "wss:" : "ws:";
    const url = new URL(`${protocol}//${browserHost}${pathname}`);
    if (port) url.port = port;
    return url.toString();
  } catch {
    return null;
  }
}

function deriveSiblingRelayUrl(
  baseUrl,
  options
) {
  const url = new URL(baseUrl);
  if (typeof options.port === "string") {
    url.port = options.port;
  }
  if (typeof options.pathname === "string") {
    url.pathname = options.pathname;
  }
  return url.toString();
}

function isLocalBrowserHost(browserHost) {
  if (!browserHost) return false;
  const normalized = browserHost.replace(/:\d+$/, "").toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

export function resolveRelayUrls(options) {
  const shouldUseSameOriginProxy =
    !!options.browserProtocol &&
    !!options.browserHost &&
    !isLocalBrowserHost(options.browserHost);

  const voiceRelayUrl =
    options.voiceRelayUrl ||
    (shouldUseSameOriginProxy
      ? deriveUrlFromBrowser(
          options.browserProtocol,
          options.browserHost,
          undefined,
          DEFAULT_VOICE_RELAY_PATH
        )
      : null) ||
    deriveUrlFromBrowser(
      options.browserProtocol,
      options.browserHost,
      DEFAULT_VOICE_RELAY_PORT,
      DEFAULT_VOICE_RELAY_PATH
    ) ||
    `ws://localhost:${DEFAULT_VOICE_RELAY_PORT}`;

  const openAiRelayUrl =
    options.openAiRelayUrl ||
    (() => {
      try {
        const voiceUrl = new URL(voiceRelayUrl);
        if (
          shouldUseSameOriginProxy ||
          (!voiceUrl.port && voiceUrl.pathname === DEFAULT_VOICE_RELAY_PATH)
        ) {
          return deriveSiblingRelayUrl(voiceRelayUrl, {
            pathname: DEFAULT_OPENAI_RELAY_PATH,
          });
        }
        return deriveSiblingRelayUrl(voiceRelayUrl, {
          port: DEFAULT_OPENAI_RELAY_PORT,
        });
      } catch {
        return shouldUseSameOriginProxy
          ? deriveUrlFromBrowser(
              options.browserProtocol,
              options.browserHost,
              undefined,
              DEFAULT_OPENAI_RELAY_PATH
            ) || `ws://localhost:${DEFAULT_OPENAI_RELAY_PORT}`
          : `ws://localhost:${DEFAULT_OPENAI_RELAY_PORT}`;
      }
    })();

  return { voiceRelayUrl, openAiRelayUrl };
}

export function buildRelayTargets(options) {
  const { voiceRelayUrl, openAiRelayUrl } = resolveRelayUrls(options);
  if (options.primaryPreference === "voice") {
    return [
      { kind: "voice", url: voiceRelayUrl },
      { kind: "openai", url: openAiRelayUrl },
    ];
  }
  if (options.primaryPreference === "openai") {
    return [
      { kind: "openai", url: openAiRelayUrl },
      { kind: "voice", url: voiceRelayUrl },
    ];
  }
  return [
    { kind: "voice", url: voiceRelayUrl },
    { kind: "openai", url: openAiRelayUrl },
  ];
}

export function resolveRelayPrimaryPreference(
  value,
) {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "voice" || normalized === "openai") {
    return normalized;
  }
  return "voice";
}

export function relayDisplayName(kind) {
  return kind === "voice" ? "voice relay" : "OpenAI voice relay";
}

export function isRecoverableRelayErrorMessage(message) {
  if (!message) return false;
  return /(connection failed|connect timeout|websocket error|disconnected|timeout|failed to connect|mic test failed)/i.test(
    message
  );
}

function normalizeBinaryData(data) {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    const view = data;
    return view.buffer.slice(
      view.byteOffset,
      view.byteOffset + view.byteLength
    );
  }
  return null;
}

export class RelayConnector {
  constructor(options) {
    this.targets = options.targets;
    this.buildInitMessage = options.buildInitMessage;
    this.createSocket =
      options.createSocket ||
      ((url) => new WebSocket(url));
    this.readyTimeoutMs = options.readyTimeoutMs ?? 10_000;
    this.binaryType = options.binaryType;
    this.onJsonMessage = options.onJsonMessage;
    this.onBinaryMessage = options.onBinaryMessage;
    this.onConnected = options.onConnected;
    this.onFailover = options.onFailover;
    this.onPermanentFailure = options.onPermanentFailure;

    this.socket = null;
    this.currentIndex = -1;
    this.currentTarget = null;
    this.ready = false;
    this.destroyed = false;
    this.failoverPromise = null;
    this.attemptSerial = 0;
  }

  get target() {
    return this.currentTarget;
  }

  get isReady() {
    return this.ready;
  }

  get canFailover() {
    return this.targets.length > 1;
  }

  async connect() {
    this.destroyed = false;
    return this.connectCandidates(
      this.targets.map((_, index) => index),
      false
    );
  }

  async failover(reason) {
    if (this.destroyed || this.targets.length < 2 || this.currentIndex < 0) {
      return null;
    }
    if (this.failoverPromise) return this.failoverPromise;

    const from = this.currentTarget;
    const candidateIndices = this.targets
      .map((_, index) => index)
      .filter((index) => index !== this.currentIndex);

    this.ready = false;
    const activeSocket = this.socket;
    this.socket = null;
    if (activeSocket) {
      try {
        activeSocket.close();
      } catch {
        // noop
      }
    }

    this.failoverPromise = this.connectCandidates(
      candidateIndices,
      true,
      from ?? undefined,
      reason
    ).finally(() => {
      this.failoverPromise = null;
    });

    return this.failoverPromise;
  }

  sendJson(payload) {
    if (!this.socket || this.socket.readyState !== READY_STATE_OPEN) {
      return false;
    }
    this.socket.send(JSON.stringify(payload));
    return true;
  }

  close() {
    this.destroyed = true;
    this.ready = false;
    const activeSocket = this.socket;
    this.socket = null;
    if (!activeSocket) return;
    try {
      activeSocket.close();
    } catch {
      // noop
    }
  }

  async connectCandidates(
    candidateIndices,
    isFailover,
    from,
    reason
  ) {
    let lastError = null;

    for (const index of candidateIndices) {
      try {
        const target = await this.connectCandidate(index, isFailover);
        if (isFailover && from && from.url !== target.url) {
          this.onFailover?.({ from, to: target, reason: reason || "relay failover" });
        }
        return target;
      } catch (error) {
        lastError =
          error instanceof Error ? error : new Error(String(error));
      }
    }

    const finalError =
      lastError || new Error("All voice relay targets failed");
    this.onPermanentFailure?.(finalError);
    throw finalError;
  }

  connectCandidate(
    index,
    isFailover
  ) {
    const target = this.targets[index];
    const attemptId = ++this.attemptSerial;

    return new Promise((resolve, reject) => {
      const socket = this.createSocket(target.url);
      if (this.binaryType) {
        socket.binaryType = this.binaryType;
      }

      this.socket = socket;
      this.currentIndex = index;
      this.currentTarget = target;
      this.ready = false;

      let settled = false;
      const timer = setTimeout(() => {
        try {
          socket.close();
        } catch {
          // noop
        }
        if (!settled) {
          settled = true;
          reject(new Error(`${relayDisplayName(target.kind)} timed out before ready`));
        }
      }, this.readyTimeoutMs);

      const clear = () => clearTimeout(timer);

      socket.onopen = () => {
        if (this.destroyed || attemptId !== this.attemptSerial) return;
        socket.send(JSON.stringify(this.buildInitMessage()));
      };

      socket.onmessage = (event) => {
        if (this.destroyed) return;
        if (socket !== this.socket || attemptId !== this.attemptSerial) return;

        const binary = normalizeBinaryData(event.data);
        if (binary) {
          this.onBinaryMessage?.(binary, {
            target,
            isFailover,
            connector: this,
          });
          return;
        }

        if (typeof event.data !== "string") return;

        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }

        if (message.type === "ready" && !this.ready) {
          this.ready = true;
          clear();
          if (!settled) {
            settled = true;
            this.onConnected?.({
              target,
              isFailover,
              connector: this,
            });
            resolve(target);
          }
        }

        this.onJsonMessage(message, {
          target,
          isFailover,
          connector: this,
        });
      };

      socket.onerror = () => {
        if (settled || this.destroyed || this.ready) return;
        clear();
        settled = true;
        reject(new Error(`${relayDisplayName(target.kind)} websocket error`));
      };

      socket.onclose = () => {
        clear();
        if (this.destroyed) return;

        if (!this.ready) {
          if (!settled) {
            settled = true;
            reject(new Error(`${relayDisplayName(target.kind)} closed before ready`));
          }
          return;
        }

        if (socket !== this.socket) return;
        this.socket = null;
        this.ready = false;
        void this.failover(`${relayDisplayName(target.kind)} disconnected`).catch(() => {
          // onPermanentFailure already handles the user-facing surface
        });
      };
    });
  }
}
