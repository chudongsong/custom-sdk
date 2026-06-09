import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      name: "CustomAnalyticsSDK",
      formats: ["es"],
      fileName: (format) => `custom-analytics-sdk.${format}.js`
    },
    sourcemap: true,
    emptyOutDir: true,
    rollupOptions: {
      output: {
        exports: "named"
      }
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["tests/setup.ts"]
  }
});
