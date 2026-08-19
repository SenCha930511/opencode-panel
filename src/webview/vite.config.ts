import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Webview bundle. Fixed output names (main.js / main.css) so the host can
// build a strict CSP meta tag without parsing hashed filenames (todo 10).
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  // Relative asset URLs: the extension rewrites every resource through
  // asWebviewUri, so emitted paths must not be root-absolute.
  base: "./",
  define: {
    // Dev-only code paths (Vite dev-server HTML, _test hooks) key off this.
    __DEV__: JSON.stringify(mode !== "production"),
  },
  build: {
    outDir: "../../media/webview",
    emptyOutDir: true,
    sourcemap: mode !== "production",
    minify: mode === "production",
    rollupOptions: {
      output: {
        entryFileNames: "main.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (assetInfo) =>
          (assetInfo.names ?? []).some((n) => n.endsWith(".css"))
            ? "main.css"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
}));
