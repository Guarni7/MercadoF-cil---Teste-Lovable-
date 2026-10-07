import path from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Única fonte da versão do app: package.json (mesma do instalador Electron).
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8"));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
