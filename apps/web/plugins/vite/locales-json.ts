import { set } from "es-toolkit/compat";
import type { Plugin } from "vite";

import { LOCALES_PATH } from "./__internal__/constants";

export function localesJsonPlugin(): Plugin {
  return {
    name: "locales-json-transform",
    enforce: "pre",

    async transform(code, id) {
      // 点号展开只对 locales/ 生效；其他 JSON 模块（如 @pkg 的 package.json）
      // 顶层键含 "." 时不应被重构。
      if (!id.startsWith(LOCALES_PATH) || !id.endsWith(".json")) {
        return null;
      }

      const content = JSON.parse(code) as Record<string, unknown>;
      const obj: Record<string, unknown> = {};

      const keys = Object.keys(content);
      for (const accessorKey of keys) {
        set(obj, accessorKey, content[accessorKey]);
      }

      return {
        code: JSON.stringify(obj),
        map: null,
      };
    },
  };
}
