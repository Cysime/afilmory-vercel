const PHOTO_PAGE_MODULE_KEY = './pages/(main)/photos/[photoId]/index.tsx'
const PHOTO_PAGE_PREFETCH_DELAY_MS = 100

type PhotoPagePrefetchModules = Record<string, (() => Promise<unknown>) | undefined>

export function isPhotoPageIntentTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false
  }

  const href = target.closest('a[href]')?.getAttribute('href')
  return Boolean(href?.startsWith('/photos/'))
}

export function installPhotoPagePrefetch(
  prefetchModules: PhotoPagePrefetchModules,
  browserWindow: Window = window,
): () => void {
  const loadPhotoPageModuleCandidate = prefetchModules[PHOTO_PAGE_MODULE_KEY]
  if (!loadPhotoPageModuleCandidate) {
    return () => {}
  }
  const loadPhotoPageModule: () => Promise<unknown> = loadPhotoPageModuleCandidate

  let isPrefetched = false
  let timeoutId: number | null = browserWindow.setTimeout(prefetchPhotoPage, PHOTO_PAGE_PREFETCH_DELAY_MS)

  function cleanup(): void {
    browserWindow.removeEventListener('pointerover', handleIntent, true)
    browserWindow.removeEventListener('pointerdown', handleIntent, true)
    browserWindow.removeEventListener('focusin', handleIntent, true)

    if (timeoutId !== null) {
      browserWindow.clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  function prefetchPhotoPage(): void {
    if (isPrefetched) {
      return
    }

    isPrefetched = true
    cleanup()
    void loadPhotoPageModule()
  }

  function handleIntent(event: Event): void {
    if (!isPhotoPageIntentTarget(event.target)) {
      return
    }

    prefetchPhotoPage()
  }

  browserWindow.addEventListener('pointerover', handleIntent, { capture: true, passive: true })
  browserWindow.addEventListener('pointerdown', handleIntent, { capture: true, passive: true })
  browserWindow.addEventListener('focusin', handleIntent, true)

  return cleanup
}
