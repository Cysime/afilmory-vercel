import { appendFileSync, chmodSync, mkdirSync } from "node:fs";
import path from "node:path";

import type { ConsolaInstance } from "consola";
import consola from "consola";

export type LogLevel =
  | "log"
  | "info"
  | "success"
  | "warn"
  | "error"
  | "debug"
  | "trace"
  | "start"
  | "fatal";

export interface LogMessage {
  tag: string;
  level: LogLevel | string;
  args: unknown[];
  timestamp: Date;
}

type LogListener = (message: LogMessage) => void;

let listener: LogListener | null = null;
const additionalListeners = new Set<LogListener>();
let forwardToConsole = true;

export function setLogListener(
  newListener: LogListener | null,
  options: { forwardToConsole?: boolean } = {},
): void {
  listener = newListener;
  if (options.forwardToConsole !== undefined) {
    forwardToConsole = options.forwardToConsole;
  }
}

export function setConsoleForwarding(enabled: boolean): void {
  forwardToConsole = enabled;
}

/** Add a sink without replacing the TUI/test listener managed by setLogListener. */
export function addLogListener(newListener: LogListener): () => void {
  additionalListeners.add(newListener);
  return () => additionalListeners.delete(newListener);
}

function notifyListener(
  tag: string,
  level: LogLevel | string,
  args: unknown[],
): void {
  const message: LogMessage = {
    tag,
    level,
    args,
    timestamp: new Date(),
  };
  listener?.(message);
  if (additionalListeners.size > 0) {
    for (const additionalListener of additionalListeners) {
      additionalListener(message);
    }
  }
}

function combineTags(parentTag: string, childTag: string): string {
  if (!parentTag) return childTag;
  return `${parentTag}/${childTag}`;
}

function wrapInstance(instance: ConsolaInstance, tag: string): ConsolaInstance {
  return new Proxy(instance, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);

      if (property === "withTag") {
        return (...args: any[]) => {
          const modifier = String(args[0] ?? "");
          const nextTag = modifier ? combineTags(tag, modifier) : tag;
          const nextInstance = Reflect.apply(
            value,
            target,
            args,
          ) as ConsolaInstance;
          return wrapInstance(nextInstance, nextTag);
        };
      }

      if (typeof value !== "function") {
        return value;
      }

      return (...args: any[]) => {
        notifyListener(tag, String(property), args);

        if (forwardToConsole) {
          return Reflect.apply(value, target, args);
        }

        return;
      };
    },
  });
}

function createTaggedLogger(tag: string): ConsolaInstance {
  return wrapInstance(consola.withTag(tag), tag);
}

export const logger = {
  main: createTaggedLogger("MAIN"),
  s3: createTaggedLogger("S3"),
  image: createTaggedLogger("IMAGE"),
  thumbnail: createTaggedLogger("THUMBNAIL"),
  thumbhash: createTaggedLogger("THUMBHASH"),
  exif: createTaggedLogger("EXIF"),
  fs: createTaggedLogger("FS"),
  worker: (id: number) => createTaggedLogger(`WORKER-${id}`),
};

export interface LoggerObservabilityConfig {
  verbose: boolean;
  level: "info" | "warn" | "error" | "debug";
  outputToFile: boolean;
  logFilePath?: string;
}

const CONFIGURED_LEVELS: Record<LoggerObservabilityConfig["level"], number> = {
  error: 0,
  warn: 1,
  info: 3,
  debug: 4,
};

const MESSAGE_LEVELS: Record<string, number> = {
  fatal: 0,
  error: 0,
  warn: 1,
  log: 2,
  info: 3,
  success: 3,
  ready: 3,
  start: 3,
  debug: 4,
  trace: 5,
};

function setLoggerLevel(level: number): void {
  consola.level = level;
  logger.main.level = level;
  logger.s3.level = level;
  logger.image.level = level;
  logger.thumbnail.level = level;
  logger.thumbhash.level = level;
  logger.exif.level = level;
  logger.fs.level = level;
}

function formatFileArgument(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Apply the observability section used by the CLI and cluster workers.
 * Returns a cleanup callback for embedders that keep the process alive.
 */
export function configureLoggerObservability(
  config: LoggerObservabilityConfig,
): () => void {
  const configuredLevel = config.verbose
    ? MESSAGE_LEVELS.trace
    : CONFIGURED_LEVELS[config.level];
  setLoggerLevel(configuredLevel);

  if (!config.outputToFile) return () => {};

  const logFilePath = path.resolve(
    config.logFilePath?.trim() || "afilmory-builder.log",
  );
  mkdirSync(path.dirname(logFilePath), { recursive: true, mode: 0o700 });
  appendFileSync(
    logFilePath,
    `\n# Afilmory Builder log started ${new Date().toISOString()}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  if (process.platform !== "win32") chmodSync(logFilePath, 0o600);

  return addLogListener((message) => {
    const messageLevel = MESSAGE_LEVELS[message.level] ?? MESSAGE_LEVELS.info;
    if (messageLevel > configuredLevel) return;
    try {
      const rendered = message.args.map(formatFileArgument).join(" ");
      appendFileSync(
        logFilePath,
        `${message.timestamp.toISOString()} [${message.level.toUpperCase()}] [${message.tag}] ${rendered}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
    } catch {
      // Logging must never turn a successful photo build into a failure after
      // the file was opened successfully during configuration.
    }
  });
}

export type Logger = typeof logger;
export type WorkerLogger = ReturnType<typeof logger.worker>;
