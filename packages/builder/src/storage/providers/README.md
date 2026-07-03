# 存储提供商

`StorageConfig` 是以 `provider` 字段判别的联合类型，`StorageManager` 据此分发到具体实现：

- `provider: "s3"` → `S3StorageProvider`（默认；历史配置缺失 `provider` 字段时由 `normalizeStorageConfig` 兜底成 `"s3"`）
- `provider: "local"` → `LocalFileSystemProvider`（零凭据的本地文件系统源）

两个 provider 共享的逻辑放在 provider 中立的模块里，避免第二个实现出现后规则漂移：

- `../supported-formats.ts`：`isSupportedImageKey` 扩展名谓词（`listImages`、Live Photo 配对、`SourceScanner` 共用）。
- `../live-photo.ts`：`detectLivePhotoPairs` 纯 key 配对逻辑。
- `../exclude-regex.ts`：`excludeRegex` 的宽容编译（无效正则告警并忽略，不崩构建）。

## 排除逻辑的分层约定

排除分两层，各司其职（不要在 provider 里重复实现另一层）：

1. **provider 层**：只应用自身配置里的静态 `excludeRegex`（S3 / local 语义对等），在列举时生效；`listObjectKeys` 按契约不应用任何排除。
2. **manager 层**：`StorageManager.excludeFilters`（`addExcludeFilter` / `addExcludePrefix`）是跨 provider 的动态过滤，例如 thumbnail-storage 插件排除远端缩略图前缀。

## S3 提供商（`s3-provider.ts`）

本仓库默认的静态站点配置面向 S3 兼容对象存储。原始照片保留在 S3 或兼容服务中，Builder 在构建期读取源对象、生成缩略图和 manifest；生产部署不会打包原图。

### 配置来源

根目录 `builder.config.ts` 使用：

```ts
storage: {
  provider: "s3",
  bucket: env.S3_BUCKET_NAME,
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  prefix: env.S3_PREFIX,
  customDomain: env.S3_CUSTOM_DOMAIN,
  excludeRegex: env.S3_EXCLUDE_REGEX,
  // forcePathStyle: true,  // 默认按 endpoint 推导，见下方「寻址风格」
  keepAlive: true,
  maxSockets: 64,
  connectionTimeoutMs: 5_000,
  socketTimeoutMs: 30_000,
  requestTimeoutMs: 20_000,
  idleTimeoutMs: 10_000,
  totalTimeoutMs: 60_000,
  retryMode: "standard",
  maxAttempts: 3,
  downloadConcurrency: 8,
}
```

### 环境变量

Builder 刷新 manifest 时必需：

| 变量                   | 说明          |
| ---------------------- | ------------- |
| `S3_BUCKET_NAME`       | bucket 名称   |
| `S3_ACCESS_KEY_ID`     | access key ID |
| `S3_SECRET_ACCESS_KEY` | secret key    |

可选：

| 变量               | 默认值                               | 说明                         |
| ------------------ | ------------------------------------ | ---------------------------- |
| `S3_REGION`        | `us-east-1`                          | S3 region                    |
| `S3_ENDPOINT`      | `https://s3.us-east-1.amazonaws.com` | S3 或兼容服务 endpoint       |
| `S3_PREFIX`        | 空                                   | 只扫描指定 key prefix        |
| `S3_CUSTOM_DOMAIN` | 空                                   | 生成公开 URL 时使用的 CDN 域 |
| `S3_EXCLUDE_REGEX` | 空                                   | 排除对象 key 的正则表达式    |

### 支持的服务

只要兼容 AWS S3 API 即可，包括：

- AWS S3
- MinIO
- 阿里云 OSS S3-compatible endpoint
- 腾讯云 COS S3-compatible endpoint
- 其他 S3-compatible provider

不同 provider 的 endpoint 和公开 URL 规则可能不同。若配置了 `S3_CUSTOM_DOMAIN`，公开 URL 会优先使用该域名。

### Public URL 生成规则

`S3StorageProvider.generatePublicUrl(key)`：

1. 有 `customDomain` 时：`customDomain + encoded key`。
2. AWS endpoint 或未设置 endpoint 时：`https://<bucket>.s3.<region>.amazonaws.com/<encoded key>`。
3. 阿里云 OSS endpoint 时：把 bucket 插入 endpoint host。
4. 其他自定义 endpoint 时：`endpoint/<bucket>/<encoded key>`。

所有 key 会按 URL path segment 安全编码。

### 寻址风格（`forcePathStyle`）

S3 客户端在构建期取数所用的寻址风格必须与 `generatePublicUrl` 对外公布的
URL 风格一致，否则自建服务（如 MinIO）会出现「公开 URL 是 path-style、
客户端却按 virtual-hosted-style 取数失败」的错配。默认推导矩阵
（`resolveForcePathStyle`，见 `../../s3/client.ts`）：

| endpoint                        | 客户端寻址风格             | `forcePathStyle` 默认值 |
| ------------------------------- | -------------------------- | ----------------------- |
| 未设置                          | virtual-hosted（AWS 默认） | `false`                 |
| 包含 `amazonaws.com`            | virtual-hosted             | `false`                 |
| 包含 `aliyuncs.com`             | virtual-hosted             | `false`                 |
| 其他自定义 endpoint（MinIO 等） | path-style                 | `true`                  |

显式配置 `forcePathStyle: true / false` 时跳过推导，以配置为准——用于
推导不符合实际服务的场景（例如自定义域名指向的 S3 网关只支持
virtual-hosted-style，或 AWS 兼容服务只支持 path-style）。
`customDomain` 只影响公开 URL（走 CDN），不参与推导。

### 网络和重试

下载单个对象时会使用：

- `downloadConcurrency` 控制 provider 内部下载并发。
- `requestTimeoutMs`、`idleTimeoutMs`、`totalTimeoutMs` 控制超时。
- `maxAttempts` 和标准 backoff 控制重试。
- 大文件会输出内存压力警告。

## 本地文件系统提供商（`local-provider.ts`）

`provider: "local"` 以 `basePath` 为根递归扫描照片源目录，不需要任何对象存储凭据：

```ts
storage: {
  provider: "local",
  basePath: path.resolve(__dirname, "photos"),
  // baseUrl: "/photos",        // originalUrl 前缀，默认 "/photos"
  // excludeRegex: "^drafts/",  // 语义与 S3 的 excludeRegex 对等
}
```

- **key**：相对 `basePath` 的 posix 路径（与 S3 key 语义一致），列举结果按 key 稳定排序。
- **StorageObject 元数据**：`size` / `lastModified` 来自 `fs.stat`；`etag` 是由 stat 派生的弱 etag（`mtimeMs-size`），不做内容哈希——它诚实地只声明"stat 变了"，用于兜住 `needsUpdate` 的 mtime "变新才算变" 判定漏掉的同尺寸回滚场景。
- **公开 URL**：`baseUrl`（默认 `/photos`）+ 编码后的 key。dev 下 `apps/web/plugins/vite/photos-static.ts` 按同一约定把 `/photos/*` 映射到仓库根的 `photos/` 目录，因此 manifest 里的 originalUrl 开箱即用。
- **Live Photo / 图片过滤**：与 S3 共用 `live-photo.ts` 与 `supported-formats.ts`。
- **uploadFile / deleteFile**：写入/删除 `basePath` 下的文件；本地文件系统没有对象元数据，`contentType` / `cacheControl` 会被忽略；删除不存在的 key 与 S3 一样静默成功。
- **安全**：所有 key 解析后必须仍在 `basePath` 内，越界 key 一律拒绝。

## 扫描与过滤（两个 provider 通用）

- `listImages()` 只返回支持的图片扩展名。
- 支持格式定义在 `packages/builder/src/constants/index.ts`：
  `.jpg`, `.jpeg`, `.png`, `.webp`, `.bmp`, `.tiff`, `.tif`, `.heic`, `.heif`, `.hif`。
- `excludeRegex` 可排除某些 key，例如 `.*\.txt$`。
- S3 专属：`S3_PREFIX` 限制扫描前缀，`maxFileLimit` 限制扫描数量。

## Live Photo 检测

`detectLivePhotoPairs`（两个 provider 共用）在对象列表中按同目录、同基础文件名匹配图片和视频：

- 图片扩展名来自支持图片格式。
- 视频扩展名为 `.mov`。
- 分组内先按 key 稳定排序，配对结果与列举顺序无关。
- 匹配结果用于 manifest 的 `video: { type: "live-photo", ... }`。

## 构建缓存

`REPO_URL`/`REPO_TOKEN` 只用于缓存生成的 manifest 和缩略图，帮助 CI 增量构建。它不是照片存储方式，也不会改变 provider 的源对象读取逻辑。

## 常见问题

- **缺少 S3 凭据**：`precheck` 会在已有 `generated/photos-manifest.json` 时复用 manifest；没有 manifest 时构建失败。想完全绕开凭据，用 `provider: "local"`。
- **URL 不是预期 CDN 域名**：确认 `S3_CUSTOM_DOMAIN` 是否设置，且不要在 key 中重复写 CDN path。
- **照片没有出现在 manifest**：检查扩展名、`S3_PREFIX` 和 `excludeRegex`。
- **首次构建慢**：首次需要下载和处理全部照片，后续会基于现有 manifest 增量复用。
