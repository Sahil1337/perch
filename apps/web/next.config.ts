import type { NextConfig } from "next";

// Static export: `next build` emits `out/`, which scripts/postbuild.mjs copies into
// apps/server/ui/ — the directory the published `perch` package serves at `/`.
// See docs/architecture/monorepo.md, "How the frontend ships inside the server package".
const nextConfig: NextConfig = {
  output: "export",
  // The server mounts the bundle as static files with an SPA fallback, so emitting
  // `/x/index.html` rather than `/x.html` keeps directory-style URLs working.
  trailingSlash: true,
  // Dev only: lets the app be reached via 127.0.0.1 as well as localhost.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
