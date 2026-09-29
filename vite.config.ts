import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { cdnAdapter } from "@vinext/cloudflare/cache/cdn-adapter";

export default defineConfig({
  plugins: [
    vinext({
      cache: { cdn: cdnAdapter() },
    }),
    cloudflare({
      // V5 builds with wrangler.v5.jsonc; unset keeps the V3 default.
      ...(process.env.CIJD_WRANGLER_CONFIG ? { configPath: process.env.CIJD_WRANGLER_CONFIG } : {}),
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
