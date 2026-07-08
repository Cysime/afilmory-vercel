import type { StorageConfig } from "../storage/interfaces.js";
import type {
  BuilderConfig,
  BuilderConfigInput,
  UserBuilderSettings,
  WorkerPerformanceConfig,
} from "../types/config.js";

/**
 * 配置输入的形状描述、合并与校验。
 *
 * builder.config.ts 是每个 self-hoster 都要编辑的文件，所以这里必须 fail loud：
 * - 未登记的键收集成警告（不抛错，保留向前兼容），拼写错误一眼可见；
 * - 已知键上的类型错误直接抛出精确错误信息。
 *
 * 刻意手写描述表而不引入 zod：与 @afilmory/schema 的零依赖、零魔法风格一致。
 * 新增配置键时只需在对应 FIELDS 表登记一行。
 */

type LeafSpec =
  | { kind: "number" }
  | { kind: "boolean" }
  /** ignoreEmpty：空字符串视为未设置（保留旧行为：output 路径为空串时回退默认值） */
  | { kind: "string"; ignoreEmpty?: boolean }
  | { kind: "enum"; values: readonly string[] }
  /** Set<string> 或 string[]，合并时统一拷贝为新 Set */
  | { kind: "string-set" };

type FieldSpec = LeafSpec | { kind: "section"; fields: FieldSpecMap };

type FieldSpecMap = Readonly<Record<string, FieldSpec>>;

type LeafSpecMap = Readonly<Record<string, LeafSpec>>;

/**
 * Worker-pool tuning is a processing knob, so its canonical input path is
 * `system.processing.worker`. The resolved config still stores it at
 * `system.observability.performance.worker` (downstream consumers read that
 * path); mergeSystemSection routes both input paths there. Following the
 * schema's existing legacy-path pattern (provider-less storage treated as
 * legacy s3, legacy `token` still redacted), the old input path is honored
 * this release and only emits a deprecation warning.
 */
const WORKER_FIELDS: LeafSpecMap = {
  timeout: { kind: "number" },
  useClusterMode: { kind: "boolean" },
  workerConcurrency: { kind: "number" },
  workerCount: { kind: "number" },
};

const WORKER_INPUT_PATH = "system.processing.worker";
const LEGACY_WORKER_INPUT_PATH = "system.observability.performance.worker";

const SYSTEM_FIELDS: FieldSpecMap = {
  processing: {
    kind: "section",
    fields: {
      // Fallback task concurrency, used ONLY when buildManifest() is called
      // programmatically without options.concurrencyLimit. The CLI always
      // passes worker.workerCount as concurrencyLimit, so this knob has no
      // effect on CLI builds — tune worker.workerCount instead.
      defaultConcurrency: { kind: "number" },
      enableLivePhotoDetection: { kind: "boolean" },
      supportedFormats: { kind: "string-set" },
      digestSuffixLength: { kind: "number" },
      // Registered here for unknown-key suggestions; the actual merge is
      // routed by mergeSystemSection (see WORKER_FIELDS above).
      worker: { kind: "section", fields: WORKER_FIELDS },
    },
  },
  observability: {
    kind: "section",
    fields: {
      showProgress: { kind: "boolean" },
      showDetailedStats: { kind: "boolean" },
      logging: {
        kind: "section",
        fields: {
          verbose: { kind: "boolean" },
          level: { kind: "enum", values: ["info", "warn", "error", "debug"] },
          outputToFile: { kind: "boolean" },
          logFilePath: { kind: "string" },
        },
      },
    },
  },
};

const OUTPUT_FIELDS: FieldSpecMap = {
  manifestPath: { kind: "string", ignoreEmpty: true },
  thumbnailsDir: { kind: "string", ignoreEmpty: true },
  originalsDir: { kind: "string", ignoreEmpty: true },
};

// storage 是判别联合（见 storage/interfaces.ts），按 provider 分别登记键集；
// 把 s3 字段混进 local 配置属于配置错误，未知键警告能把它暴露出来。
const S3_STORAGE_FIELDS: LeafSpecMap = {
  bucket: { kind: "string" },
  region: { kind: "string" },
  endpoint: { kind: "string" },
  accessKeyId: { kind: "string" },
  secretAccessKey: { kind: "string" },
  prefix: { kind: "string" },
  customDomain: { kind: "string" },
  excludeRegex: { kind: "string" },
  maxFileLimit: { kind: "number" },
  keepAlive: { kind: "boolean" },
  maxSockets: { kind: "number" },
  connectionTimeoutMs: { kind: "number" },
  socketTimeoutMs: { kind: "number" },
  requestTimeoutMs: { kind: "number" },
  idleTimeoutMs: { kind: "number" },
  totalTimeoutMs: { kind: "number" },
  retryMode: { kind: "enum", values: ["standard", "adaptive", "legacy"] },
  maxAttempts: { kind: "number" },
  downloadConcurrency: { kind: "number" },
};

const LOCAL_STORAGE_FIELDS: LeafSpecMap = {
  basePath: { kind: "string" },
  baseUrl: { kind: "string" },
  excludeRegex: { kind: "string" },
};

const TOP_LEVEL_KEYS = [
  "storage",
  "user",
  "system",
  "output",
  "plugins",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** interface 没有隐式 index signature，这里做一个受控的类型接缝供通用合并器按键写入 */
function asMutableRecord(section: object): Record<string, unknown> {
  return section as Record<string, unknown>;
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return "an array";
  return `a value of type ${typeof value}`;
}

function invalidValueError(
  path: string,
  expected: string,
  value: unknown,
): Error {
  return new Error(
    `[config] Invalid value for "${path}": expected ${expected}, got ${describeValue(value)}`,
  );
}

function levenshtein(a: string, b: string): number {
  const distances = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = distances[0];
    distances[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const previous = distances[j];
      distances[j] = Math.min(
        distances[j] + 1,
        distances[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = previous;
    }
  }
  return distances[b.length];
}

function findClosestKey(
  key: string,
  candidates: readonly string[],
): string | null {
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = levenshtein(key, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  // 阈值 2：只提示明显的拼写错误，避免把毫不相干的键硬凑成建议
  return best !== null && bestDistance <= 2 && bestDistance < best.length
    ? best
    : null;
}

/** 未知键下如果还是对象，展开到叶子路径逐条告警（"system.procesing.thumbnailWidth" 比 "system.procesing" 更好定位） */
function enumerateLeafPaths(path: string, value: unknown): string[] {
  if (isPlainObject(value) && Object.keys(value).length > 0) {
    return Object.entries(value).flatMap(([key, child]) =>
      enumerateLeafPaths(`${path}.${key}`, child),
    );
  }
  return [path];
}

function reportUnknownKey(
  path: string,
  unknownKey: string,
  value: unknown,
  knownKeys: readonly string[],
  warnings: string[],
): void {
  const suggestion = findClosestKey(unknownKey, knownKeys);
  const hint = suggestion === null ? "" : ` — did you mean "${suggestion}"?`;
  for (const leafPath of enumerateLeafPaths(path, value)) {
    warnings.push(`[config] Unknown key "${leafPath}"${hint}`);
  }
}

/** 校验叶子值并返回归一化后的结果（string-set → 新 Set），类型不符时抛出精确错误 */
function checkLeafValue(spec: LeafSpec, value: unknown, path: string): unknown {
  switch (spec.kind) {
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw invalidValueError(path, "a finite number", value);
      }
      return value;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        throw invalidValueError(path, "a boolean", value);
      }
      return value;
    }
    case "string": {
      if (typeof value !== "string") {
        throw invalidValueError(path, "a string", value);
      }
      return value;
    }
    case "enum": {
      if (typeof value !== "string" || !spec.values.includes(value)) {
        throw invalidValueError(
          path,
          spec.values.map((item) => JSON.stringify(item)).join(" | "),
          value,
        );
      }
      return value;
    }
    case "string-set": {
      const items =
        value instanceof Set ? [...value] : Array.isArray(value) ? value : null;
      if (items === null || items.some((item) => typeof item !== "string")) {
        throw invalidValueError(path, "a Set or array of strings", value);
      }
      return new Set(items);
    }
  }
}

/**
 * 把输入的一个分区深合并进目标分区：
 * - 分区级 null/undefined 视为「未设置」，保留默认值（等价旧实现的 if (!overrides) return）；
 * - 叶子级 null/undefined 同样不覆盖默认值；
 * - 未登记的键收集警告并丢弃（旧实现是静默丢弃，现在丢弃但会大声告警）。
 */
function mergeSection(
  target: Record<string, unknown>,
  input: unknown,
  fields: FieldSpecMap,
  path: string,
  warnings: string[],
): void {
  if (input === undefined || input === null) return;
  if (!isPlainObject(input)) {
    throw invalidValueError(path, "an object", input);
  }
  for (const [key, value] of Object.entries(input)) {
    const spec = fields[key];
    const keyPath = `${path}.${key}`;
    if (!spec) {
      reportUnknownKey(keyPath, key, value, Object.keys(fields), warnings);
      continue;
    }
    if (value === undefined || value === null) continue;
    if (spec.kind === "section") {
      target[key] ??= {};
      mergeSection(
        target[key] as Record<string, unknown>,
        value,
        spec.fields,
        keyPath,
        warnings,
      );
      continue;
    }
    if (spec.kind === "string" && spec.ignoreEmpty && value === "") {
      // 保留旧行为：空字符串视为未设置，回退默认路径
      continue;
    }
    target[key] = checkLeafValue(spec, value, keyPath);
  }
}

/**
 * storage 只校验不合并：判别联合必须整体替换（把 s3 字段合并进 local 配置是错的）。
 * 未知键仅告警、不剔除——storage 对象原样透传给 provider 工厂，自定义扩展字段不受影响。
 */
function validateStorageConfig(
  value: unknown,
  path: string,
  warnings: string[],
): void {
  if (!isPlainObject(value)) {
    throw invalidValueError(path, "an object", value);
  }
  const { provider } = value;
  if (provider !== undefined && provider !== "s3" && provider !== "local") {
    throw invalidValueError(`${path}.provider`, `"s3" or "local"`, provider);
  }
  // provider 缺省时按 legacy s3 处理（normalizeStorageConfig 在运行时兜底），见 storage/interfaces.ts
  const fields =
    provider === "local" ? LOCAL_STORAGE_FIELDS : S3_STORAGE_FIELDS;
  const knownKeys = ["provider", ...Object.keys(fields)];
  for (const [key, fieldValue] of Object.entries(value)) {
    if (key === "provider") continue;
    const keyPath = `${path}.${key}`;
    const spec = fields[key];
    if (!spec) {
      reportUnknownKey(keyPath, key, fieldValue, knownKeys, warnings);
      continue;
    }
    if (fieldValue === undefined || fieldValue === null) continue;
    checkLeafValue(spec, fieldValue, keyPath);
  }
  if (provider === "local") {
    const { basePath } = value;
    if (typeof basePath !== "string" || basePath.length === 0) {
      throw new Error(
        `[config] Invalid value for "${path}.basePath": provider "local" requires a non-empty string basePath, got ${describeValue(basePath)}`,
      );
    }
  }
}

function ensureUserSettings(target: BuilderConfig): UserBuilderSettings {
  target.user ??= { storage: null };
  return target.user;
}

/**
 * Shape accepted from builder.config.ts. Extends BuilderConfigInput with the
 * canonical worker path (`system.processing.worker`); the legacy
 * `system.observability.performance.worker` path stays typed through
 * BuilderConfigInput and is honored with a deprecation warning this release.
 */
export type BuilderConfigFileInput = BuilderConfigInput & {
  system?: {
    processing?: {
      /** Worker-pool tuning: workerCount, workerConcurrency, useClusterMode, timeout. */
      worker?: Partial<WorkerPerformanceConfig>;
    };
  };
};

interface SystemWorkerInputSplit {
  /** system 输入去掉两个 worker 路径后的剩余部分（浅克隆，不改动调用方对象） */
  rest: Record<string, unknown>;
  canonicalWorker?: unknown;
  hasCanonicalWorker: boolean;
  legacyWorker?: unknown;
  hasLegacyWorker: boolean;
}

function splitWorkerInput(
  system: Record<string, unknown>,
): SystemWorkerInputSplit {
  const rest = { ...system };
  const split: SystemWorkerInputSplit = {
    rest,
    hasCanonicalWorker: false,
    hasLegacyWorker: false,
  };

  const { processing } = system;
  if (isPlainObject(processing) && "worker" in processing) {
    split.hasCanonicalWorker = true;
    split.canonicalWorker = processing.worker;
    const processingRest = { ...processing };
    delete processingRest.worker;
    rest.processing = processingRest;
  }

  const { observability } = system;
  if (
    isPlainObject(observability) &&
    isPlainObject(observability.performance)
  ) {
    const { performance } = observability;
    if ("worker" in performance) {
      split.hasLegacyWorker = true;
      split.legacyWorker = performance.worker;
      const performanceRest = { ...performance };
      delete performanceRest.worker;
      const observabilityRest = { ...observability };
      if (Object.keys(performanceRest).length > 0) {
        // performance 下的其余键仍走未知键告警（performance 已不再登记）
        observabilityRest.performance = performanceRest;
      } else {
        delete observabilityRest.performance;
      }
      rest.observability = observabilityRest;
    }
  }

  return split;
}

/**
 * system 分区的合并入口：worker 段的用户侧路径已迁到 system.processing.worker，
 * 但 resolved config 内部仍存放在 system.observability.performance.worker
 * （cli/photo-task-processor 等消费方读那里），所以两个输入路径都路由到内部位置。
 * 旧路径本版本继续生效，只发一条弃用告警；两者同时给出时新路径胜出。
 */
function mergeSystemSection(
  target: BuilderConfig,
  input: unknown,
  warnings: string[],
): void {
  if (input === undefined || input === null) return;
  if (!isPlainObject(input)) {
    throw invalidValueError("system", "an object", input);
  }

  const split = splitWorkerInput(input);
  if (split.hasLegacyWorker) {
    warnings.push(
      `[config] Deprecated key "${LEGACY_WORKER_INPUT_PATH}" — did you mean "${WORKER_INPUT_PATH}"? The legacy path still works this release.`,
    );
  }

  mergeSection(
    asMutableRecord(target.system),
    split.rest,
    SYSTEM_FIELDS,
    "system",
    warnings,
  );

  const workerTarget = asMutableRecord(
    target.system.observability.performance.worker,
  );
  // 先合并旧路径再合并新路径：canonical path wins when both are set
  if (split.hasLegacyWorker) {
    mergeSection(
      workerTarget,
      split.legacyWorker,
      WORKER_FIELDS,
      LEGACY_WORKER_INPUT_PATH,
      warnings,
    );
  }
  if (split.hasCanonicalWorker) {
    mergeSection(
      workerTarget,
      split.canonicalWorker,
      WORKER_FIELDS,
      WORKER_INPUT_PATH,
      warnings,
    );
  }
}

/**
 * 把 BuilderConfigFileInput 合并进（已克隆的）默认配置，原地修改 target。
 * 返回未知键警告列表，由调用方决定如何输出（resolveBuilderConfig 用 consola 大声打印）。
 * 已知键上的类型错误直接抛出。
 */
export function applyBuilderConfigInput(
  target: BuilderConfig,
  input: BuilderConfigFileInput,
): string[] {
  const warnings: string[] = [];
  if (input === undefined || input === null) return warnings;
  if (!isPlainObject(input)) {
    throw invalidValueError("config", "an object", input);
  }

  for (const [key, value] of Object.entries(input)) {
    if (!(TOP_LEVEL_KEYS as readonly string[]).includes(key)) {
      reportUnknownKey(key, key, value, TOP_LEVEL_KEYS, warnings);
    }
  }

  mergeSystemSection(target, input.system, warnings);

  // user 分区：user: null 视为未设置（config.user 保持 null）；
  // user: {} 会物化出 { storage: null }——保留旧 ensureUserSettings 行为
  if (input.user !== undefined && input.user !== null) {
    if (!isPlainObject(input.user)) {
      throw invalidValueError("user", "an object", input.user);
    }
    const user = ensureUserSettings(target);
    for (const [key, value] of Object.entries(input.user)) {
      if (key !== "storage") {
        reportUnknownKey(`user.${key}`, key, value, ["storage"], warnings);
      }
    }
    const userStorage = (input.user as { storage?: unknown }).storage;
    if (userStorage !== undefined) {
      // user.storage: null 是有效值——显式表示「未配置存储」
      if (userStorage !== null) {
        validateStorageConfig(userStorage, "user.storage", warnings);
      }
      user.storage = (userStorage ?? null) as StorageConfig | null;
    }
  }

  mergeSection(
    asMutableRecord(target.output),
    input.output,
    OUTPUT_FIELDS,
    "output",
    warnings,
  );

  // 顶层 storage 是 user.storage 的简写，且在 user 分区之后应用——
  // 两者同时给出时顶层胜出（保留旧实现的应用顺序）。
  // storage 整体按引用替换，不深克隆（插件/provider 依赖对象身份时行为不变）。
  if (input.storage !== undefined) {
    if (input.storage !== null) {
      validateStorageConfig(input.storage, "storage", warnings);
    }
    ensureUserSettings(target).storage = input.storage ?? null;
  }

  if (input.plugins !== undefined && input.plugins !== null) {
    if (!Array.isArray(input.plugins)) {
      throw invalidValueError("plugins", "an array", input.plugins);
    }
    // 数组整体替换而非拼接；浅拷贝保留插件对象/函数的引用
    target.plugins = [...input.plugins];
  }

  return warnings;
}

/**
 * DEBUG=1 配置输出里需要打码的 secret 字段路径（相对 resolved config 根）。
 * 新增含密钥的配置字段时在这里登记路径即可，打码逻辑无需改动。
 */
export const SECRET_CONFIG_PATHS: readonly string[] = [
  "user.storage.accessKeyId",
  "user.storage.secretAccessKey",
  // token 不在 S3Config 类型里，但历史配置可能带有，照旧打码
  "user.storage.token",
];

/** 返回打码后的副本（只沿 secret 路径浅拷贝），原配置对象不被修改 */
export function redactConfigSecrets(config: BuilderConfig): BuilderConfig {
  let sanitized = config;
  for (const secretPath of SECRET_CONFIG_PATHS) {
    sanitized = redactPath(sanitized, secretPath.split("."));
  }
  return sanitized;
}

function redactPath(root: BuilderConfig, segments: string[]): BuilderConfig {
  // 先确认路径存在（等价旧实现的 "accessKeyId" in storage 判断），不存在则原样返回
  let node: unknown = root;
  for (const segment of segments.slice(0, -1)) {
    if (typeof node !== "object" || node === null) return root;
    node = (node as Record<string, unknown>)[segment];
  }
  const leafKey = segments.at(-1)!;
  if (typeof node !== "object" || node === null || !(leafKey in node)) {
    return root;
  }

  const clonedRoot = { ...root };
  let cursor = asMutableRecord(clonedRoot);
  for (const segment of segments.slice(0, -1)) {
    cursor[segment] = { ...(cursor[segment] as Record<string, unknown>) };
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[leafKey] = "***";
  return clonedRoot;
}
