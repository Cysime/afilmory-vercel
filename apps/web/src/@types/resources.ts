import en from "@locales/app/en.json";

import type { ns } from "./constants";

// 只静态打包英文作为永远可用的兜底文案；其余语言包在 bootstrap 阶段
// 按检测到的语言动态加载（见 ~/i18n.ts 的 loadLanguageBundle），
// 避免 6 份语言 JSON 全部进入首屏关键路径 chunk。
export const resources = {
  en: {
    app: en,
  },
} satisfies Record<"en", Record<(typeof ns)[number], Record<string, string>>>;
