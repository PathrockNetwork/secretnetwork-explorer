import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, proxy API calls to the Fastify server. The API binds API_HOST (the
// Tailscale address in this deployment, loopback by default), so the proxy
// target must match it rather than assuming localhost.
const target = `http://${process.env.API_HOST ?? "127.0.0.1"}:${process.env.API_PORT ?? 3000}`;

export default defineConfig({
  plugins: [react()],
  build: {
    // The API's CSP allows fonts from 'self' only, so tiny font subsets must
    // ship as files rather than being inlined as data: URIs.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
  },
  server: {
    proxy: {
      "/api": target,
      "/health": target,
    },
  },
});
