/**
 * Manifest 版本策略（刻意不做迁移）。
 *
 * 严格与宽松两个解析入口都硬性拒绝非当前版本——没有迁移代码，也不打算写。
 * 版本升级 = 全量重建：builder 读到版本不匹配的缓存 manifest 时丢弃它并从头
 * 重新生成；web 端在启动时对不匹配的 manifest 抛 BootstrapError 显示诊断页。
 * 这条路线很便宜：缩略图靠 `.encoding` 签名标记与 artifact cache 增量再生，
 * 不会因 manifest 重建而全量重算。
 *
 * 升级 CURRENT_MANIFEST_VERSION 时必须同步处理（grep 清单）：
 * - packages/schema/src/version.ts（本文件的常量）
 * - 各包测试夹具与断言（grep `version: 2` / `"version": 2` / `toBe(2)`）
 * - apps/web/e2e/fixtures/photos-manifest.json —— 用
 *   scripts/create-synthetic-e2e-fixture.ts（pnpm fixture:e2e）重新生成
 *
 * 详见 packages/schema/README.md 的 "Versioning" 一节。
 */
export const AFILMORY_MANIFEST_SCHEMA = "afilmory.manifest" as const;
export const CURRENT_MANIFEST_VERSION = 2 as const;

export type ManifestSchema = typeof AFILMORY_MANIFEST_SCHEMA;
export type ManifestVersion = typeof CURRENT_MANIFEST_VERSION;
