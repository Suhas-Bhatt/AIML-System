const LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL =
  process.env.LOG_LEVEL ||
  (process.env.NODE_ENV === "production" ? "info" : "debug");

function ts() {
  return new Date().toISOString().replace("T", " ").slice(0, -1);
}

function fmt(level, mod) {
  return `${ts()} ${level.toUpperCase().padEnd(5)} [${mod}]`;
}

export function createLogger(mod) {
  return {
    debug(...args) {
      if (LEVELS.debug >= LEVELS[MIN_LEVEL])
        console.debug(fmt("debug", mod), ...args);
    },
    info(...args) {
      if (LEVELS.info >= LEVELS[MIN_LEVEL])
        console.log(fmt("info", mod), ...args);
    },
    warn(...args) {
      if (LEVELS.warn >= LEVELS[MIN_LEVEL])
        console.warn(fmt("warn", mod), ...args);
    },
    error(...args) {
      console.error(fmt("error", mod), ...args);
    },
  };
}

export const logger = createLogger("app");
