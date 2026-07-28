import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import { unified } from "@astrojs/markdown-remark";
import rehypeSanitize from "rehype-sanitize";

export default defineConfig({
  site: "https://aperitivi-urbani.pages.dev",
  trailingSlash: "ignore",
  output: "static",
  adapter: cloudflare({
    imageService: "passthrough",
    prerenderEnvironment: "node",
  }),
  markdown: {
    processor: unified({ rehypePlugins: [rehypeSanitize] }),
  },
});
