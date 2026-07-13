const AFILMORY_SERVICE_WORKER_FILE_NAME = "sw.js";

function getCurrentUrl(): URL | null {
  if (typeof window === "undefined") return null;
  try {
    return new URL(window.location.href);
  } catch {
    return null;
  }
}

export function isAfilmoryServiceWorker(
  worker: Pick<ServiceWorker, "scriptURL"> | null | undefined,
): boolean {
  if (!worker) return false;
  const currentUrl = getCurrentUrl();
  if (!currentUrl) return false;

  try {
    const scriptUrl = new URL(worker.scriptURL, currentUrl);
    const appBaseUrl = new URL(import.meta.env.BASE_URL, currentUrl.origin);
    const expectedScriptUrl = new URL(
      AFILMORY_SERVICE_WORKER_FILE_NAME,
      appBaseUrl,
    );
    return (
      scriptUrl.origin === currentUrl.origin &&
      scriptUrl.pathname === expectedScriptUrl.pathname
    );
  } catch {
    return false;
  }
}

export function isAfilmoryServiceWorkerRegistration(
  registration: Pick<
    ServiceWorkerRegistration,
    "active" | "installing" | "waiting"
  >,
): boolean {
  const workers = [
    registration.active,
    registration.waiting,
    registration.installing,
  ];
  return workers.some(isAfilmoryServiceWorker);
}
