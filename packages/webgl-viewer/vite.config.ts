import dts from "unplugin-dts/vite";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // 库产物不压缩：交给消费方的打包器压缩，未压缩产物 + sourcemap 便于调试。
    minify: false,
    sourcemap: true,
    lib: {
      entry: "./src/index.ts",
      name: "WebGLImageViewer",
      fileName: () => `index.js`,
      formats: ["es"],
    },
    rollupOptions: {
      external: ["react"],
    },
  },
  plugins: [
    dts({
      include: ["src/**/*.ts", "src/**/*.tsx"],
      // 测试文件不进 dist（否则会产出 *.test.d.ts）。
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      outDirs: ["dist"],
      tsconfigPath: "tsconfig.json",
    }),
  ],
});
