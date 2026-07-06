import { useEffect, useRef, useState } from "react";

/**
 * React Hook: 用于单个 blob URL 的管理
 * 生产路径的 URL 回收统一走 LRU 缓存的清理回调；这里只服务组件内
 * 临时 blob（如调试页的本地文件预览），随 blob 变化 / 组件卸载 revoke。
 */
export function useBlobUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const currentUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (currentUrlRef.current) {
      URL.revokeObjectURL(currentUrlRef.current);
      currentUrlRef.current = null;
    }

    if (!blob) {
      setUrl(null);
      return;
    }

    const newUrl = URL.createObjectURL(blob);
    currentUrlRef.current = newUrl;
    setUrl(newUrl);

    return () => {
      if (currentUrlRef.current === newUrl) {
        URL.revokeObjectURL(newUrl);
        currentUrlRef.current = null;
      }
    };
  }, [blob]);

  return url;
}
