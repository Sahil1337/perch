import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// TanStack Start in SPA mode: `vite build` prerenders the shell once and emits `dist/client/`,
// which scripts/postbuild.mjs copies into apps/server/ui/ — the directory the published `perch`
// package serves at `/`. Start's server half never runs; there are no server functions and no SSR.
// See docs/architecture/monorepo.md, "How the frontend ships inside the server package".
export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackStart({
      spa: {
        enabled: true,
        prerender: {
          // The shell has to land on `index.html` at the root of the build: that is the file
          // apps/server/src/server/routes/ui.ts returns for every unmatched non-/api GET. Start
          // would otherwise name it `_shell.html`, which the fallback would never look for.
          outputPath: "/index",
        },
      },
      prerender: {
        // `/x/index.html` rather than `/x.html`, which is what Next's `trailingSlash: true` bought
        // us: the bundle is mounted as plain static files, so a directory-style URL only resolves
        // if the directory is real. Start defaults this on — pinned because the whole static mount
        // depends on it.
        autoSubfolderIndex: true,
      },
    }),
    viteReact(),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    // Pinned rather than left to Vite's "next free port" walk: apps/server's dev script allow-lists
    // this exact origin for CORS, so a port picked because 5173 was busy would be a browser error
    // with no hint as to why. Failing to start is the louder, shorter problem.
    port: 5173,
    strictPort: true,
  },
});
