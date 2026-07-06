import i18next from "i18next";
import { atom } from "jotai";
import { initReactI18next } from "react-i18next";

import { currentSupportedLanguages } from "./@types/constants";
import { resources } from "./@types/resources";
import { siteConfig } from "./config";
import {
  detectPreferredLanguage,
  getBrowserLanguageCandidates,
  getFallbackLanguages,
  resolveSupportedLanguage,
} from "./lib/language";

const i18n = i18next.createInstance();
const fallbackLanguages = getFallbackLanguages(siteConfig.language);

// 在 i18n.init 之前完成语言检测（复刻原 LanguageDetector 的 navigator/htmlTag 顺序），
// 这样 bootstrap 才知道该动态加载哪个语言包，并能与 manifest 请求并行发出。
const initialLanguage = detectPreferredLanguage(
  getBrowserLanguageCandidates(),
  fallbackLanguages[0],
);

// 语言包按需加载：en 静态打包兜底（resources），其余每个语言是独立的小 chunk，
// 避免 6 份语言 JSON 全部进入首屏关键路径。glob 路径相对本文件指向仓库根 locales/。
const localeBundleLoaders = import.meta.glob<Record<string, string>>(
  "../../../locales/app/*.json",
  { import: "default" },
);

const syncDocumentLanguage = (language: string | undefined) => {
  if (typeof document === "undefined") return;

  const resolvedLanguage =
    resolveSupportedLanguage(language) ??
    resolveSupportedLanguage(fallbackLanguages[0]) ??
    "en";
  document.documentElement.lang = resolvedLanguage;
};

// init 在模块加载时同步发起（jsdom 测试路径依赖 en 已预置、无需 await 网络式导入）。
const i18nReady = i18n
  .use(initReactI18next)
  .init({
    fallbackLng: fallbackLanguages,
    defaultNS: "app",
    lng: initialLanguage,
    nonExplicitSupportedLngs: false,
    resources,
    supportedLngs: currentSupportedLanguages,
  })
  .then(() => {
    // initialLanguage 一定是受支持代码，优先用 language：
    // 非 en 语言包此刻可能尚未注册，resolvedLanguage 会临时回退成 en。
    syncDocumentLanguage(i18n.language ?? i18n.resolvedLanguage);
  });

const loadedLanguages = new Set<string>(Object.keys(resources));

// 动态加载指定语言的翻译包并注册到 i18next。幂等；未知语言静默退回（由 en 兜底）。
// 若未来加入运行时语言切换，切换前先 await 此函数再 changeLanguage 即可。
export async function loadLanguageBundle(language: string): Promise<void> {
  const resolved = resolveSupportedLanguage(language);
  if (!resolved || loadedLanguages.has(resolved)) return;

  const loader = localeBundleLoaders[`../../../locales/app/${resolved}.json`];
  if (!loader) return;

  // 动态导入立即发出（与 init 并行），注册则等 init 建好 resource store 之后。
  const [bundle] = await Promise.all([loader(), i18nReady]);
  if (loadedLanguages.has(resolved)) return;

  i18n.addResourceBundle(resolved, "app", bundle, true, true);
  loadedLanguages.add(resolved);

  // addResourceBundle 不会让 i18next 重算 resolvedLanguage；
  // 对当前激活语言重新 changeLanguage 一次，保持 resolvedLanguage 与旧行为一致。
  if (i18n.language === resolved && i18n.resolvedLanguage !== resolved) {
    await i18n.changeLanguage(resolved);
  }
}

// bootstrap 在首次渲染前 await 此 Promise（与 manifest / 关键路由并行），
// 保证非英文用户不会闪现一帧英文兜底文案。en 用户此处为同步空操作。
// 语言包加载失败不致命（en 兜底），吞掉错误避免 bootstrap 整体进入错误页。
export const initialLanguageReady: Promise<void> = loadLanguageBundle(
  initialLanguage,
).catch((error: unknown) => {
  console.error(
    `[i18n] Failed to load locale bundle for "${initialLanguage}", falling back to en:`,
    error,
  );
});

i18n.on("languageChanged", (language) => {
  syncDocumentLanguage(language);
});

export const i18nAtom = atom(i18n);

export const getI18n = () => {
  return i18n;
};
