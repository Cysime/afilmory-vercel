import { currentSupportedLanguages } from "~/@types/constants";

const normalizeTag = (language: string): string =>
  language.trim().replaceAll("_", "-").toLowerCase();

export const resolveSupportedLanguage = (
  language: string | null | undefined,
): string | null => {
  if (!language) return null;

  const normalized = normalizeTag(language);
  if (!normalized) return null;

  if (normalized === "zh" || normalized.startsWith("zh-")) {
    const parts = new Set(normalized.split("-"));
    if (parts.has("hk") || parts.has("mo")) return "zh-HK";
    if (parts.has("tw") || parts.has("hant")) return "zh-TW";
    return "zh-CN";
  }

  if (
    normalized === "jp" ||
    normalized === "ja" ||
    normalized.startsWith("ja-")
  ) {
    return "ja";
  }

  if (normalized === "ko" || normalized.startsWith("ko-")) {
    return "ko";
  }

  if (normalized === "en" || normalized.startsWith("en-")) {
    return "en";
  }

  const exactMatch = currentSupportedLanguages.find(
    (supportedLanguage) => supportedLanguage.toLowerCase() === normalized,
  );

  return exactMatch ?? null;
};

export const normalizeDetectedLanguage = (language: string): string =>
  resolveSupportedLanguage(language) ?? language;

// 复刻 i18next-browser-languagedetector 的 order: ["navigator", "htmlTag"] 检测来源，
// 作为纯输入收集器，便于在 i18n.init 之前拿到候选语言（并可单测）。
export const getBrowserLanguageCandidates = (): string[] => {
  const candidates: string[] = [];

  if (typeof navigator !== "undefined") {
    if (Array.isArray(navigator.languages)) {
      candidates.push(...navigator.languages);
    }
    if (navigator.language) {
      candidates.push(navigator.language);
    }
  }

  if (typeof document !== "undefined") {
    const htmlLang = document.documentElement.lang;
    if (htmlLang) {
      candidates.push(htmlLang);
    }
  }

  return candidates;
};

// 在 i18n.init 之前解析出首选语言：第一个能归一化为受支持语言的候选胜出，
// 否则退回站点配置的 fallback。返回值一定是受支持的语言代码。
export const detectPreferredLanguage = (
  candidates: Iterable<string | null | undefined>,
  fallbackLanguage: string | null | undefined,
): string => {
  for (const candidate of candidates) {
    const resolved = resolveSupportedLanguage(candidate);
    if (resolved) return resolved;
  }

  return resolveSupportedLanguage(fallbackLanguage) ?? "en";
};

export const getFallbackLanguages = (
  configuredLanguage: string | null | undefined,
): string[] => {
  const fallbackLanguage = resolveSupportedLanguage(configuredLanguage) ?? "en";

  return fallbackLanguage === "en" ? ["en"] : [fallbackLanguage, "en"];
};
