import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: Number(process.env.PORT ?? 3000) },
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    // SPA mode: the wallet connector only runs in the browser. Server functions still run on the server.
    tanstackStart({ spa: { enabled: true } }),
    nitro({ preset: "bun" }),
    react(),
  ],
});
