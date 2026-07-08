import type {
  AfilmoryManifest,
  CameraInfo,
  LensInfo,
  LocationAdminInfo,
  LocationInfo,
  ManifestIndexes,
  ManifestSource,
  PhotoManifestItem,
  PickedExif,
  ToneAnalysis,
  ToneType,
  VideoSource,
} from "./types.ts";
import {
  AFILMORY_MANIFEST_SCHEMA,
  CURRENT_MANIFEST_VERSION,
} from "./version.ts";

const UNKNOWN_SOURCE: ManifestSource = { provider: "unknown" };
const VALID_TONE_TYPES = new Set<ToneType>([
  "low-key",
  "high-key",
  "normal",
  "high-contrast",
]);

export class ManifestValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid Afilmory manifest: ${issues.join("; ")}`);
    this.name = "ManifestValidationError";
    this.issues = issues;
  }
}

export type ManifestValidationResult =
  | {
      success: true;
      manifest: AfilmoryManifest;
    }
  | {
      success: false;
      issues: string[];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === "string";

const isBoolean = (value: unknown): value is boolean =>
  typeof value === "boolean";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

// ---------------------------------------------------------------------------
// 字段描述符：同一形状只描述一次，严格校验（check → issues）与宽松抢救
// （normalize → 默认值/丢弃）都从这一份描述派生，不再维护 validateX/normalizeX
// 双胞胎。check 返回相对路径 issue（以 " 自身文案"、".子字段" 或 "[下标]" 开头），
// 由上层拼接完整路径。
// ---------------------------------------------------------------------------

interface Field<T> {
  check: (value: unknown) => string[];
  normalize: (value: unknown) => T;
  /** normalize 时该字段不合法则整个对象放弃（判别/寻址字段，如 camera.model） */
  required?: boolean;
  /** normalize 结果为 undefined 时不写入键（保持历史输出形状：photo.isHDR/video 缺席） */
  omitUndefined?: boolean;
}

type Shape = Record<string, Field<unknown>>;

// Shape 与产出类型没有静态关联，而 normalizeShape 只拷贝 shape 里声明的键——
// 目标类型新增字段却漏写描述符时会编译通过、字段被两个入口静默剥掉。各 shape
// 声明处用 `satisfies ShapeFor<目标类型>` 把"每个键都有描述符"变成编译期约束
// （Field 对 T 协变，Field<T[K]> 仍可赋给 Field<unknown>，运行时不受影响）。
type ShapeFor<T> = { [K in keyof T]-?: Field<T[K]> };

function field<T>(
  guard: (value: unknown) => value is T,
  message: string,
  fallback: T,
): Field<T> {
  return {
    check: (value) => (guard(value) ? [] : [` ${message}`]),
    normalize: (value) => (guard(value) ? value : fallback),
  };
}

function requiredField<T>(
  guard: (value: unknown) => value is T,
  message: string,
): Field<T> {
  return {
    check: (value) => (guard(value) ? [] : [` ${message}`]),
    // guard 失败时 normalizeShape 已放弃整个对象，这里不会拿到非法值
    normalize: (value) => value as T,
    required: true,
  };
}

function optionalField<T>(
  guard: (value: unknown) => value is T,
  message: string,
  omitUndefined = false,
): Field<T | undefined> {
  return {
    check: (value) =>
      value === undefined || guard(value) ? [] : [` ${message}`],
    normalize: (value) => (guard(value) ? value : undefined),
    omitUndefined,
  };
}

function checkShape(shape: Shape, value: Record<string, unknown>): string[] {
  const issues: string[] = [];
  for (const [key, item] of Object.entries(shape)) {
    for (const message of item.check(value[key])) {
      issues.push(`.${key}${message}`);
    }
  }
  return issues;
}

function normalizeShape<T>(
  shape: Shape,
  value: Record<string, unknown>,
): T | null {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(shape)) {
    if (item.required && item.check(value[key]).length > 0) return null;
    const normalized = item.normalize(value[key]);
    if (normalized === undefined && item.omitUndefined) continue;
    result[key] = normalized;
  }
  return result as T;
}

function arrayField<T>(shape: Shape): Field<T[]> {
  return {
    check: (value) => {
      if (!Array.isArray(value)) return [" must be an array"];
      const issues: string[] = [];
      for (const [index, item] of value.entries()) {
        if (!isRecord(item)) {
          issues.push(`[${index}] must be an object`);
          continue;
        }
        for (const message of checkShape(shape, item)) {
          issues.push(`[${index}]${message}`);
        }
      }
      return issues;
    },
    normalize: (value) =>
      Array.isArray(value)
        ? value.flatMap((item) => {
            const normalized = isRecord(item)
              ? normalizeShape<T>(shape, item)
              : null;
            return normalized ? [normalized] : [];
          })
        : [],
  };
}

// 常用字段的简写工厂（文案与历史 issue 逐字一致）
const str = () => field(isString, "must be a string", "");
const num = (fallback: number) =>
  field(isFiniteNumber, "must be a number", fallback);
const requiredStr = () => requiredField(isString, "must be a string");
const optStr = (message = "must be a string") =>
  optionalField(isString, message);
const presentStr = () => optStr("must be a string when present");

// —— source ——

type S3Source = Extract<ManifestSource, { provider: "s3" }>;
type LocalSource = Extract<ManifestSource, { provider: "local" }>;

const s3SourceShape: Shape = {
  bucket: presentStr(),
  region: presentStr(),
  endpoint: presentStr(),
  prefix: presentStr(),
  customDomain: presentStr(),
} satisfies ShapeFor<Omit<S3Source, "provider">>;

const localSourceShape: Shape = {
  basePath: presentStr(),
  baseUrl: presentStr(),
} satisfies ShapeFor<Omit<LocalSource, "provider">>;

const sourceField: Field<ManifestSource> = {
  check: (value) => {
    if (!isRecord(value)) return [" must be an object"];
    if (value.provider === "unknown") return [];
    if (value.provider === "s3") return checkShape(s3SourceShape, value);
    if (value.provider === "local") return checkShape(localSourceShape, value);
    return [".provider must be 's3', 'local' or 'unknown'"];
  },
  normalize: (value) => {
    if (!isRecord(value)) return UNKNOWN_SOURCE;
    if (value.provider === "s3") {
      return {
        provider: "s3",
        ...normalizeShape<Omit<S3Source, "provider">>(s3SourceShape, value),
      };
    }
    if (value.provider === "local") {
      return {
        provider: "local",
        ...normalizeShape<Omit<LocalSource, "provider">>(
          localSourceShape,
          value,
        ),
      };
    }
    return UNKNOWN_SOURCE;
  },
};

// —— indexes ——

const cameraShape: Shape = {
  make: requiredStr(),
  model: requiredStr(),
  displayName: requiredStr(),
} satisfies ShapeFor<CameraInfo>;

const lensShape: Shape = {
  make: optStr(),
  model: requiredStr(),
  displayName: requiredStr(),
} satisfies ShapeFor<LensInfo>;

const indexesShape: Shape = {
  cameras: arrayField<CameraInfo>(cameraShape),
  lenses: arrayField<LensInfo>(lensShape),
} satisfies ShapeFor<ManifestIndexes>;

function normalizeIndexes(value: unknown): ManifestIndexes {
  return (
    (isRecord(value) &&
      normalizeShape<ManifestIndexes>(indexesShape, value)) || {
      cameras: [],
      lenses: [],
    }
  );
}

// —— toneAnalysis / location（null 表示"缺失"，undefined 与其他类型都非法）——

function nullableObjectField<T>(shape: Shape): Field<T | null> {
  return {
    check: (value) => {
      if (value === null) return [];
      if (!isRecord(value)) return [" must be null or an object"];
      return checkShape(shape, value);
    },
    normalize: (value) =>
      isRecord(value) ? normalizeShape<T>(shape, value) : null,
  };
}

const isToneType = (value: unknown): value is ToneType =>
  typeof value === "string" && VALID_TONE_TYPES.has(value as ToneType);

const toneAnalysisShape: Shape = {
  toneType: field(isToneType, "is invalid", "normal" as ToneType),
  brightness: num(0),
  contrast: num(0),
  shadowRatio: num(0),
  highlightRatio: num(0),
} satisfies ShapeFor<ToneAnalysis>;

const toneAnalysisField = nullableObjectField<ToneAnalysis>(toneAnalysisShape);

// Omit 列出的键不进 shape，由 locationField.normalize 手工抢救（见下）；
// LocationInfo 新增字段会在这里编译失败，倒逼作者显式选择两种归属之一。
const locationShape: Shape = {
  latitude: num(0),
  longitude: num(0),
} satisfies ShapeFor<
  Omit<
    LocationInfo,
    | "admin"
    | "adminI18n"
    | "adminKey"
    | "country"
    | "city"
    | "locationName"
    | "locationNameI18n"
  >
>;

// 键值对逐条抢救：坏值丢弃，全空则整体视为缺失（undefined）
function normalizeRecordOf<T>(
  value: unknown,
  normalizeItem: (item: unknown) => T | undefined,
): Record<string, T> | undefined {
  if (!isRecord(value)) return undefined;
  const record: Record<string, T> = {};
  for (const [key, item] of Object.entries(value)) {
    const normalized = normalizeItem(item);
    if (normalized !== undefined) record[key] = normalized;
  }
  return Object.keys(record).length > 0 ? record : undefined;
}

const adminInfoShape: Shape = {
  country: optStr(),
  countryCode: optStr(),
  region: optStr(),
  city: optStr(),
  district: optStr(),
} satisfies ShapeFor<LocationAdminInfo>;

function normalizeAdminInfo(value: unknown): LocationAdminInfo | undefined {
  if (!isRecord(value)) return undefined;
  const admin = normalizeShape<LocationAdminInfo>(
    adminInfoShape,
    value,
  ) as LocationAdminInfo;
  return Object.values(admin).some(Boolean) ? admin : undefined;
}

const locationField: Field<LocationInfo | null> = {
  check: nullableObjectField<LocationInfo>(locationShape).check,
  // admin/i18n 等字段严格模式从不校验（历史行为），仅在归一化时尽力抢救
  normalize: (value) => {
    if (!isRecord(value)) return null;
    const location = normalizeShape<LocationInfo>(
      locationShape,
      value,
    ) as LocationInfo;
    const admin = normalizeAdminInfo(value.admin);
    if (admin) location.admin = admin;
    const adminI18n = normalizeRecordOf(value.adminI18n, normalizeAdminInfo);
    if (adminI18n) location.adminI18n = adminI18n;
    const adminKey = normalizeAdminInfo(value.adminKey);
    if (adminKey) location.adminKey = adminKey;
    if (typeof value.country === "string") location.country = value.country;
    if (typeof value.city === "string") location.city = value.city;
    if (typeof value.locationName === "string") {
      location.locationName = value.locationName;
    }
    const locationNameI18n = normalizeRecordOf(
      value.locationNameI18n,
      (item) => (typeof item === "string" ? item : undefined),
    );
    if (locationNameI18n) location.locationNameI18n = locationNameI18n;
    return location;
  },
};

// —— video（可选字段：undefined 合法；type 判别的联合）——

type LivePhoto = Extract<VideoSource, { type: "live-photo" }>;
type MotionPhoto = Extract<VideoSource, { type: "motion-photo" }>;

const livePhotoShape: Shape = {
  videoUrl: requiredStr(),
  s3Key: requiredStr(),
} satisfies ShapeFor<Omit<LivePhoto, "type">>;

const motionPhotoShape: Shape = {
  offset: requiredField(isFiniteNumber, "must be a number"),
  size: optionalField(isFiniteNumber, "must be a number"),
  presentationTimestamp: optionalField(isFiniteNumber, "must be a number"),
} satisfies ShapeFor<Omit<MotionPhoto, "type">>;

const videoField: Field<VideoSource | undefined> = {
  check: (value) => {
    if (value === undefined) return [];
    if (!isRecord(value)) return [" must be an object"];
    if (value.type === "live-photo") return checkShape(livePhotoShape, value);
    if (value.type === "motion-photo") {
      return checkShape(motionPhotoShape, value);
    }
    return [".type is invalid"];
  },
  normalize: (value) => {
    if (!isRecord(value)) return;
    if (value.type === "live-photo") {
      const live = normalizeShape<Omit<LivePhoto, "type">>(
        livePhotoShape,
        value,
      );
      return live ? { type: "live-photo", ...live } : undefined;
    }
    if (value.type === "motion-photo") {
      const motion = normalizeShape<Omit<MotionPhoto, "type">>(
        motionPhotoShape,
        value,
      );
      return motion ? { type: "motion-photo", ...motion } : undefined;
    }
    return;
  },
  omitUndefined: true,
};

// —— EXIF 消毒：丢弃结构性危险值，而非字段白名单 ——
// PickedExif 表面很宽、web 端 formatter 本身是防御式的；这里只保证"已验证"的
// manifest 不携带函数/类实例等无法 JSON 序列化或有原型污染风险的值。
// 浅层判定：值必须是基元、普通对象或由它们组成的数组；普通对象内部不再深查。

function isPlainObject(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function isSafeExifValue(value: unknown): boolean {
  if (value === null) return true;
  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") return true;
  if (Array.isArray(value)) return value.every((item) => isSafeExifValue(item));
  return isPlainObject(value);
}

function normalizeExif(value: unknown): PickedExif | null {
  if (!isRecord(value)) return null;
  const exif: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    // JSON.parse 会把 "__proto__" 还原成自有键，直接赋值会触发原型污染——显式跳过
    if (key === "__proto__") continue;
    if (isSafeExifValue(item)) exif[key] = item;
  }
  return exif as PickedExif;
}

// —— photo ——
// 键顺序即历史上 item 字面量的构造顺序，保证归一化输出的 JSON 键序不变。

const photoShape: Shape = {
  id: str(),
  originalUrl: str(),
  thumbnailUrl: str(),
  thumbHash: field(
    (value): value is string | null =>
      value === null || typeof value === "string",
    "must be null or a string",
    null,
  ),
  width: num(0),
  height: num(0),
  aspectRatio: num(1),
  s3Key: str(),
  lastModified: str(),
  size: num(0),
  // etag 历史上从不参与校验（严格模式也放行任意类型），仅归一化
  etag: {
    check: () => [],
    normalize: (value) => (typeof value === "string" ? value : undefined),
  },
  exif: {
    check: (value) =>
      value === null || isRecord(value) ? [] : [" must be null or an object"],
    normalize: normalizeExif,
  },
  toneAnalysis: toneAnalysisField,
  location: locationField,
  title: str(),
  dateTaken: str(),
  tags: {
    check: (value) => (isStringArray(value) ? [] : [" must be a string array"]),
    // 每次返回新数组，避免共享的 fallback 实例被调用方原地修改后串扰
    normalize: (value) => (isStringArray(value) ? value : []),
  },
  description: str(),
  isHDR: optionalField(isBoolean, "must be a boolean", true),
  video: videoField,
} satisfies ShapeFor<PhotoManifestItem>;

function validatePhoto(
  value: unknown,
  index: number,
): { item: PhotoManifestItem | null; issues: string[] } {
  // 每张照片用独立的 issues 数组，避免一张坏照片污染整个 manifest 的校验结果。
  // 严格模式由调用方把这些 issues 汇入共享数组；宽松模式据此只丢弃出错的照片。
  const path = `photos[${index}]`;
  if (!isRecord(value)) {
    return { item: null, issues: [`${path} must be an object`] };
  }
  const issues = checkShape(photoShape, value).map(
    (message) => `${path}${message}`,
  );
  // photoShape 没有 required 字段：任何对象都能归一化出 item；
  // 是否保留由宽松入口按寻址字段（id/originalUrl/s3Key）另行判定。
  const item = normalizeShape<PhotoManifestItem>(
    photoShape,
    value,
  ) as PhotoManifestItem;
  return { item, issues };
}

export function createManifest({
  generatedAt = new Date().toISOString(),
  indexes = { cameras: [], lenses: [] },
  photos = [],
  source = UNKNOWN_SOURCE,
}: {
  generatedAt?: string;
  indexes?: {
    cameras?: CameraInfo[];
    lenses?: LensInfo[];
  };
  photos?: PhotoManifestItem[];
  source?: ManifestSource;
} = {}): AfilmoryManifest {
  return {
    schema: AFILMORY_MANIFEST_SCHEMA,
    version: CURRENT_MANIFEST_VERSION,
    generatedAt,
    source,
    photos,
    indexes: {
      cameras: indexes.cameras ?? [],
      lenses: indexes.lenses ?? [],
    },
  };
}

export function createEmptyManifest(): AfilmoryManifest {
  return createManifest();
}

export function isAfilmoryManifest(input: unknown): input is AfilmoryManifest {
  return validateManifest(input).success;
}

/**
 * 信封层校验：schema/version/generatedAt/photos-是数组，是严格与宽松
 * 两个入口共用的硬性前提，只在这里描述一次。source 全仓无读方且 normalize
 * 总能抢救成合法值（最差退回 UNKNOWN_SOURCE），因此只在严格模式
 * （`strictSource`）算作致命——例如新增 provider 值不应砖掉已部署的旧解析方。
 * `collectMore` 供严格模式在 source 与 photos 检查之间插入 indexes 校验，
 * 保持历史 issue 顺序。
 */
function validateEnvelope(
  input: Record<string, unknown>,
  strictSource: boolean,
  collectMore?: (issues: string[]) => void,
): string[] {
  const issues: string[] = [];
  if (input.schema !== AFILMORY_MANIFEST_SCHEMA) {
    issues.push(`schema must be '${AFILMORY_MANIFEST_SCHEMA}'`);
  }
  if (input.version !== CURRENT_MANIFEST_VERSION) {
    issues.push(`version must be ${CURRENT_MANIFEST_VERSION}`);
  }
  if (typeof input.generatedAt !== "string") {
    issues.push("generatedAt must be a string");
  }
  if (strictSource) {
    issues.push(
      ...sourceField.check(input.source).map((message) => `source${message}`),
    );
  }
  collectMore?.(issues);
  if (!Array.isArray(input.photos)) {
    issues.push("photos must be an array");
  }
  return issues;
}

export function validateManifest(input: unknown): ManifestValidationResult {
  if (!isRecord(input)) {
    return {
      success: false,
      issues: ["manifest must be an object"],
    };
  }

  const issues = validateEnvelope(input, true, (envelope) => {
    // indexes 只在严格模式整体校验；宽松模式视为派生数据、逐条抢救
    if (!isRecord(input.indexes)) {
      envelope.push("indexes must be an object");
    } else {
      envelope.push(
        ...checkShape(indexesShape, input.indexes).map(
          (message) => `indexes${message}`,
        ),
      );
    }
  });

  const photos: PhotoManifestItem[] = [];
  if (Array.isArray(input.photos)) {
    for (const [index, photo] of input.photos.entries()) {
      const { item, issues: photoIssues } = validatePhoto(photo, index);
      issues.push(...photoIssues);
      if (item) {
        photos.push(item);
      }
    }
  }

  if (issues.length > 0) {
    return {
      success: false,
      issues,
    };
  }

  return {
    success: true,
    manifest: createManifest({
      generatedAt: input.generatedAt as string,
      source: sourceField.normalize(input.source),
      photos,
      indexes: normalizeIndexes(input.indexes),
    }),
  };
}

export function assertManifest(input: unknown): AfilmoryManifest {
  const result = validateManifest(input);
  if (!result.success) {
    throw new ManifestValidationError(result.issues);
  }
  return result.manifest;
}

export function parseManifest(input?: unknown): AfilmoryManifest {
  const result = validateManifest(input);
  return result.success ? result.manifest : createEmptyManifest();
}

export interface SkippedPhoto {
  index: number;
  issues: string[];
}

export interface LenientManifestParseResult {
  manifest: AfilmoryManifest;
  skipped: SkippedPhoto[];
}

/**
 * 宽松解析：信封层（schema/version/generatedAt、photos 是否为数组）仍严格——
 * 任一项无效都抛 {@link ManifestValidationError}，由调用方决定如何降级（运行时显示诊断页，
 * 构建期丢弃缓存做全量重建）。
 *
 * source 不算信封的一部分：全仓没有任何读方，损坏时由 sourceField.normalize 抢救
 * （最差退回 provider "unknown"），绝不因它砖掉一个本可正常渲染的图库。
 *
 * 派生 indexes 与照片逐条容错：坏的 camera/lens 条目由 normalizeIndexes 丢弃；照片仅在
 * 无法寻址（非对象，或缺 id/originalUrl/s3Key 核心字段）时丢弃并记入 `skipped`，可恢复的
 * 字段问题（损坏的可选字段、可默认的数值）由 normalizer 抢救后保留。绝不让一张坏照片或
 * 一个坏索引条目清空整个图库或砖掉后续构建。
 *
 * 严格完整性仍由 {@link assertManifest} 提供，用于"刚生成的 manifest"等构建闸门。
 */
export function parseManifestLenient(
  input: unknown,
): LenientManifestParseResult {
  if (!isRecord(input)) {
    throw new ManifestValidationError(["manifest must be an object"]);
  }

  const envelopeIssues = validateEnvelope(input, false);
  if (envelopeIssues.length > 0) {
    throw new ManifestValidationError(envelopeIssues);
  }

  // indexes 是派生数据：逐条容错。坏的 camera/lens 条目由 normalizeIndexes 丢弃，
  // 绝不因单个坏索引条目抛掉整个 manifest（normalizeIndexes 永远返回一个对象）。
  const indexes = normalizeIndexes(input.indexes);

  const photos: PhotoManifestItem[] = [];
  const skipped: SkippedPhoto[] = [];
  for (const [index, photo] of (input.photos as unknown[]).entries()) {
    const { item, issues } = validatePhoto(photo, index);
    // 致命：无法构造照片对象，或缺少用于寻址/路由/查看的核心字段。其余问题
    // （损坏的可选字段、可默认的数值）已被 normalizer 抢救，照片仍能正常渲染，
    // 予以保留——只有真正无法使用的照片才丢弃并记入 `skipped`。
    const isFatal =
      item === null || !item.id || !item.originalUrl || !item.s3Key;
    if (isFatal) {
      skipped.push({ index, issues });
    } else {
      photos.push(item);
    }
  }

  return {
    manifest: createManifest({
      generatedAt: input.generatedAt as string,
      source: sourceField.normalize(input.source),
      photos,
      indexes,
    }),
    skipped,
  };
}
