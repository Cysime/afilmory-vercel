import { useCallback, useEffect, useRef, useState } from "react";

import { getI18n } from "~/i18n";
import { formatUnknownError } from "~/lib/format-error";
import {
  isStaleRuntimeError,
  recoverFromStaleRuntimeError,
  recoverStaleRuntime,
} from "~/lib/stale-runtime-recovery";

export const BootstrapError = ({ error }: { error: unknown }) => {
  const i18n = getI18n();
  const message = formatUnknownError(error);
  const recoveryRef = useRef(false);
  const [isRecovering, setIsRecovering] = useState(false);

  const retryAfterCleanup = useCallback(async () => {
    setIsRecovering(true);
    await recoverStaleRuntime({ force: true });
  }, []);

  useEffect(() => {
    if (!isStaleRuntimeError(error)) {
      return;
    }
    if (recoveryRef.current) {
      return;
    }

    recoveryRef.current = true;
    setIsRecovering(true);
    void recoverFromStaleRuntimeError(error).then((result) => {
      if (!result.reloadRequested) {
        setIsRecovering(false);
      }
    });
  }, [error]);

  if (isRecovering) {
    return (
      <div
        className="flex min-h-svh items-center justify-center bg-black text-white"
        role="status"
        aria-live="polite"
      >
        {i18n.t("loading.default")}…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-6 text-white">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur">
        <h1 className="text-3xl font-semibold text-pretty">
          {i18n.t("error.title")}
        </h1>
        <p className="mt-3 text-sm leading-6 text-pretty text-white/70">
          {i18n.t("error.temporary.description")}
        </p>
        <p className="mt-4 text-sm leading-6 text-white/70">{message}</p>
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => void retryAfterCleanup()}
            className="min-h-11 rounded-full bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-white/90"
          >
            {i18n.t("error.reload")}
          </button>
          <a
            href="/"
            className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10"
          >
            {i18n.t("common.home")}
          </a>
        </div>
      </div>
    </div>
  );
};
