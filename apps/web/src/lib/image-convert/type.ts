import type { LoadingCallbacks } from "../image-loading-types";

// 转换结果接口
// 不携带 object URL：URL 的唯一所有者是 regularImageCache（逐出时 revoke），
// 策略层只产出 blob，避免出现无人回收的第二个 URL。
export interface ConversionResult {
  blob: Blob;
  convertedSize: number;
  format: string;
  originalSize: number;
}

// 图像转换策略接口
export interface ImageConverterStrategy {
  /**
   * 检测是否需要转换此格式
   */
  shouldConvert: (blob: Blob) => Promise<boolean>;

  /**
   * 执行转换
   */
  convert: (
    blob: Blob,
    originalUrl: string,
    callbacks?: LoadingCallbacks,
  ) => Promise<ConversionResult>;

  /**
   * 策略名称，用于日志和调试
   */
  getName: () => string;

  /**
   * 获取支持的格式
   */
  getSupportedFormats: () => string[];
}
