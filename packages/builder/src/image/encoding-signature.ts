import crypto from "node:crypto";

// 本模块必须保持零重依赖（仅 node:crypto）：scripts/artifact-cache.ts 通过
// "@afilmory/builder/thumbnail-encoding" 子路径引用签名常量做缓存校验，
// 不能为此拖入 sharp 等原生模块。

// 常量定义
// q80 + mozjpeg：600px 网格缩略图 q90 时普遍 200-450KB，移动端解码慢、浏览器内存
// 图像缓存留不住（虚拟列表滚回时重解码 → 闪烁）；q80+mozjpeg 视觉几乎无差，
// 体积约减半。
export const THUMBNAIL_QUALITY = 80;
export const THUMBNAIL_WIDTH = 600;

/**
 * 缩略图编码参数签名。写入缩略图目录的 `.encoding` 标记文件；CLI 启动时若磁盘
 * 标记与当前签名不一致（或缺失），等价于 --force-thumbnails 全量重生成。
 *
 * 动机：部署构建会从 artifact-cache 恢复旧缩略图 + manifest，增量模式据此判定
 * 「0 张需要处理」——改了质量/尺寸/格式参数却永远不会生效。签名机制让参数变更
 * 自动触发一次全量重生成，之后缓存里存的就是新参数产物，回到增量快路径。
 */
export const THUMBNAIL_ENCODING_SIGNATURE = `jpeg-w${THUMBNAIL_WIDTH}-q${THUMBNAIL_QUALITY}-mozjpeg-ca1`;

/**
 * Short, deterministic encoding version embedded in every immutable filename.
 * Changing any encoder parameter changes both the marker and the URL even if
 * the encoded pixels coincidentally hash to the same bytes.
 */
export const THUMBNAIL_ENCODING_VERSION = crypto
  .createHash("sha256")
  .update(THUMBNAIL_ENCODING_SIGNATURE)
  .digest("hex")
  .slice(0, 12);
