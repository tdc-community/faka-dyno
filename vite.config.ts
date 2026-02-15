import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

declare const process: { env: Record<string, string | undefined> };

const appVersion = process.env.npm_package_version ?? "0.0.0";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/faka-dyno/",
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
});
