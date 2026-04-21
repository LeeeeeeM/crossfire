import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_BACKEND_HTTP_TARGET || "http://127.0.0.1:8787";
  const wsTarget = env.VITE_BACKEND_WS_TARGET || "ws://127.0.0.1:8787";

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5174,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true
        },
        "/ws": {
          target: wsTarget,
          ws: true,
          changeOrigin: true
        }
      }
    }
  };
});
