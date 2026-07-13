import { Button } from "@afilmory/ui";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";

export const NotFound = () => {
  const location = useLocation();
  const { t } = useTranslation();

  return (
    <div className="prose dark:prose-invert mx-auto flex min-h-svh max-w-2xl flex-col px-6 text-center">
      <main className="flex grow flex-col items-center justify-center">
        <h1 className="text-balance">{t("error.not-found.title")}</h1>
        <p className="text-pretty">{t("error.not-found.description")}</p>
        <p className="max-w-full">
          {t("error.not-found.path")}:{" "}
          <code className="break-all">{location.pathname}</code>
        </p>

        <p>
          <Button asChild className="h-11 px-4">
            <Link to="/" replace>
              {t("common.home")}
            </Link>
          </Button>
        </p>
      </main>
    </div>
  );
};
