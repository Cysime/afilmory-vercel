// 仅收录 ISO 639-1 规范代码；"jp" 只是检测别名，由 normalizeDetectedLanguage 归一化为 "ja"。
const langs = ["en", "zh-CN", "zh-HK", "ja", "ko", "zh-TW"] as const;
export const currentSupportedLanguages = [...langs].sort() as string[];
export type MainSupportedLanguages = (typeof langs)[number];

export const ns = ["app"] as const;
export const defaultNS = "app" as const;
