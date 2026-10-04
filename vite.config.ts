import { defineConfig } from "vite";

// BMKG's public API is called through a dev proxy to avoid CORS issues
// during local development. Production builds can point VITE_BMKG_BASE_URL
// at their own proxy (see .env.example).
export default defineConfig({
  base: "./",
  server: {
    proxy: {
      "/proxy/bmkg": {
        target: "https://api.bmkg.go.id",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/bmkg/, ""),
      },
    },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 4000,
  },
});
