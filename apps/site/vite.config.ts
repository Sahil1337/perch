import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Lets an ngrok tunnel show the page on a phone. ngrok owns the DNS for these names, so allowing
// them does not reopen the rebinding hole the host check closes. Tunnel the built page (preview):
// dev serves some 540 unbundled modules, which don't finish loading through a free tunnel.
const tunnelHosts = [".ngrok-free.app"];

// One page, index.html. lab/ is a dev-only test page: `vite dev` serves any .html under the root,
// and the build reads only index.html, which keeps it out of the deploy.
export default defineConfig({
  plugins: [tailwindcss(), react()],
  build: {
    // three.js is the one big chunk (about 0.5 MB, the bird's renderer), and it is only fetched
    // after first paint; the default 500 kB warning would fire on every build for it.
    chunkSizeWarningLimit: 600,
  },
  server: {
    // Several agents run this app side by side on assigned ports; a silent walk to the next free
    // port would put one of them on another's page.
    strictPort: true,
    allowedHosts: tunnelHosts,
  },
  preview: {
    strictPort: true,
    allowedHosts: tunnelHosts,
  },
});
