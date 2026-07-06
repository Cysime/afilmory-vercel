import { m } from "motion/react";
import { useTranslation } from "react-i18next";

export const MapErrorState = () => {
  const { t } = useTranslation();

  return (
    <m.div
      className="flex h-full w-full items-center justify-center"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="text-center">
        <m.div
          className="mb-4 text-4xl"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          ❌
        </m.div>
        <m.div
          className="text-lg font-medium text-red-900 dark:text-red-100"
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
        >
          {t("explore.map.error.title")}
        </m.div>
        <m.p
          className="text-sm text-red-600 dark:text-red-400"
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.3 }}
        >
          {t("explore.map.error.description")}
        </m.p>
      </div>
    </m.div>
  );
};
