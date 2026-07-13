// 构建期资产生成的共享库：OG 图片、SVG 文本渲染、manifest 照片加载。
// 之前散落在仓库根 scripts/ 里，被 apps/web 的 vite 插件用 ../../../../ 深路径引用；
// 收拢成 workspace 包后消费方统一走 '@afilmory/build-assets'。
export {
  type GeneratedImageArtifact,
  generateOGImage,
} from "./generate-og-image.ts";
export {
  DEFAULT_BUILD_MANIFEST_PATH,
  resolveBuildManifestPath,
} from "./manifest-path.ts";
export { buildTimePhotoLoader } from "./photo-loader.ts";
export {
  measureSVGText,
  renderSVGText,
  wrapSVGText,
} from "./svg-text-renderer.ts";
