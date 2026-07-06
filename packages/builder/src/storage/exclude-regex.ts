/**
 * 编译 provider 配置里的静态 excludeRegex。
 * 无效正则不应崩掉整个构建——交由调用方记录告警，然后当作未配置处理。
 * S3 与本地文件系统 provider 共用此宽容语义，避免两处实现漂移。
 */
export function compileExcludeRegex(
  pattern: string | undefined,
  onInvalid: (error: unknown) => void,
): RegExp | null {
  if (!pattern) return null;
  try {
    return new RegExp(pattern);
  } catch (error) {
    onInvalid(error);
    return null;
  }
}
