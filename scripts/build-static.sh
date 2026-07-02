#!/bin/sh
set -e

# 静态站点构建脚本（Vercel、Netlify、Cloudflare Pages 等平台）。
# 只负责编排：缓存恢复 -> pnpm build -> 缓存同步 -> 校验产物。
# 所有新鲜度/降级决策（S3 凭据缺失、生产硬失败、manifest 复用）
# 由 apps/web/scripts/precheck.ts 单点负责，它在 `pnpm build` 内运行。

echo "[build] Starting static site build..."

CACHE_REPO_URL="${REPO_URL:-${BUILDER_REPO_URL:-}}"
CACHE_REPO_TOKEN="${REPO_TOKEN:-${GIT_TOKEN:-}}"

if [ -n "$CACHE_REPO_URL" ] && [ -n "$CACHE_REPO_TOKEN" ]; then
  echo "[build] Restoring manifest and thumbnails from the remote cache repository..."
  if ! pnpm exec tsx scripts/artifact-cache.ts restore; then
    echo "[build] Remote cache restore failed; continuing with local files or a rebuild from S3"
  fi
else
  MISSING_CACHE_CONFIG=""
  if [ -z "$CACHE_REPO_URL" ]; then
    MISSING_CACHE_CONFIG="REPO_URL/BUILDER_REPO_URL"
  fi
  if [ -z "$CACHE_REPO_TOKEN" ]; then
    if [ -n "$MISSING_CACHE_CONFIG" ]; then
      MISSING_CACHE_CONFIG="$MISSING_CACHE_CONFIG, REPO_TOKEN/GIT_TOKEN"
    else
      MISSING_CACHE_CONFIG="REPO_TOKEN/GIT_TOKEN"
    fi
  fi
  echo "[build] Remote cache repository not configured, missing: $MISSING_CACHE_CONFIG"
fi

echo "[build] Running pnpm build (precheck decides freshness/fallback)..."
if ! pnpm build; then
  echo "[build] Build failed"
  exit 1
fi

if [ -n "$CACHE_REPO_URL" ] && [ -n "$CACHE_REPO_TOKEN" ]; then
  echo "[build] Saving refreshed manifest and thumbnails to the remote cache repository..."
  if ! pnpm exec tsx scripts/artifact-cache.ts save; then
    echo "[build] Remote cache save failed; static output was built but the next build may not reuse the cache"
  fi
else
  echo "[build] Remote cache repository not configured, skipping cache save"
fi

# 验证构建输出
OUTPUT_DIR="apps/web/dist"
if [ ! -f "$OUTPUT_DIR/index.html" ]; then
  echo "[build] Error: build output is incomplete, index.html not found"
  exit 1
fi

echo "[build] Build complete. Output directory: $OUTPUT_DIR"
