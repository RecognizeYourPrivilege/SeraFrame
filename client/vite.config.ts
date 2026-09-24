import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// BACK serves the built SPA and `/api` from one origin in production.
// In dev, `/api` is proxied only when MSW mocks are turned off.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
  build: {
    // Stable output consumed by the runtime image (`COPY --from=spa .../dist`).
    outDir: "dist",
    emptyOutDir: true,
  },
});
