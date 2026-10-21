import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const uiPort = Number(process.env.GESTOR_UI_PORT) || 5173;
const apiOrigin = process.env.GESTOR_API_ORIGIN || "http://127.0.0.1:3333";

export default defineConfig({
  plugins: [react()],
  server: {
    // Windows: "localhost" no Vite 8 cai só em IPv6 (::1). A API escuta
    // 127.0.0.1 e o Brave resolve localhost em IPv4 — a janela não abre.
    host: "127.0.0.1",
    port: uiPort,
    strictPort: Boolean(process.env.GESTOR_UI_PORT),
    proxy: {
      "/api": apiOrigin,
    },
  },
});
