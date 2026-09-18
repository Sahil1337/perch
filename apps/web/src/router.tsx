import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

/**
 * Start's required entry point: it calls this on the client to build the router, and once more at
 * build time to prerender the SPA shell. One route and no loaders, so there is nothing to configure
 * — preloading and scroll restoration would both be machinery for a screen that never navigates.
 */
export function getRouter() {
  return createRouter({ routeTree });
}
