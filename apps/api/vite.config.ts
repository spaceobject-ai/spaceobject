import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite-plus";

// The Cloudflare plugin declares workerd-specific environment options that
// vitest's Node pool cannot reconcile, so it is skipped in test mode; the
// handler code itself (hono + WebCrypto) runs identically under Node.
export default defineConfig(({ mode }) => ({
  plugins: mode === "test" ? [] : [cloudflare()],
}));
