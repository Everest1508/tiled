import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Relative base so the build works on GitHub Pages, Netlify or any static host.
// `vite build --mode artifact` makes one self-contained HTML file (used for the claude.ai artifact).
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [react(), ...(mode === "artifact" ? [viteSingleFile()] : [])],
  build: mode === "artifact" ? { outDir: "dist-artifact" } : undefined,
  test: { environment: "node" },
}));
