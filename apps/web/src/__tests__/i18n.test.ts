import { describe, expect, it } from "vitest";

import { currentSupportedLanguages } from "~/@types/constants";
import { getI18n, initialLanguageReady, loadLanguageBundle } from "~/i18n";

// jsdom 的 navigator.language 是 en-US → 初始语言为 en（静态预置），
// 因此模块导入即同步可用，不依赖任何动态语言包（见 i18n.ts 的测试路径约定）。
describe("i18n bootstrap", () => {
  it("preloads en synchronously and resolves initialLanguageReady", async () => {
    await initialLanguageReady;

    const i18n = getI18n();
    expect(i18n.hasResourceBundle("en", "app")).toBe(true);
    expect(i18n.language).toBe("en");
  });

  it("has a lazily loadable bundle for every supported language", async () => {
    const i18n = getI18n();

    for (const language of currentSupportedLanguages) {
      await loadLanguageBundle(language);
      expect.soft(i18n.hasResourceBundle(language, "app"), language).toBe(true);

      const bundle = i18n.getResourceBundle(language, "app") as Record<
        string,
        unknown
      >;
      expect.soft(Object.keys(bundle).length, language).toBeGreaterThan(0);
    }
  });

  it("normalizes the legacy jp alias onto the ja bundle", async () => {
    const i18n = getI18n();

    await loadLanguageBundle("jp");
    expect(i18n.hasResourceBundle("ja", "app")).toBe(true);
    expect(i18n.hasResourceBundle("jp", "app")).toBe(false);
  });

  it("ignores unsupported languages without throwing", async () => {
    await expect(loadLanguageBundle("fr-FR")).resolves.toBeUndefined();
    expect(getI18n().hasResourceBundle("fr-FR", "app")).toBe(false);
  });

  it("registers the dynamically imported bundle content", async () => {
    const i18n = getI18n();
    const { default: zhCn } = await import("@locales/app/zh-CN.json");

    await loadLanguageBundle("zh-CN");

    expect(i18n.getResourceBundle("zh-CN", "app")).toEqual(zhCn);
  });
});
