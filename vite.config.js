import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SHARE_PAGES, shareMetaTags } from "./src/share-meta.js";

const root = dirname(fileURLToPath(import.meta.url));
const SHARE_BLOCK = /<!-- share-meta[\s\S]*?<!-- \/share-meta -->/;

// The markers are kept in the output: the home page's HTML is transformed
// first, then copied and re-transformed for every other page.
function withShareMeta(html, id) {
  return html.replace(SHARE_BLOCK, () => `<!-- share-meta -->\n    ${shareMetaTags(id)}\n    <!-- /share-meta -->`);
}

// Link previewers (WhatsApp, Facebook...) don't run JavaScript, so every
// page needs its own real HTML file with its own preview tags: the site's
// index.html is copied to e.g. dist/birthdays/index.html with the
// birthday page's tags. The app itself is the same on every path.
function sharePages() {
  return {
    name: "share-pages",
    enforce: "post",
    transformIndexHtml(html, ctx) {
      return ctx.path === "/index.html" ? withShareMeta(html, "home") : html;
    },
    generateBundle(_, bundle) {
      const home = bundle["index.html"];
      for (const [id, page] of Object.entries(SHARE_PAGES)) {
        if (page.path === "/") continue;
        this.emitFile({ type: "asset", fileName: `${page.path.slice(1)}/index.html`, source: withShareMeta(String(home.source), id) });
      }
    }
  };
}

export default {
  plugins: [sharePages()],
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:5174"
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        callcentreAgent: resolve(root, "callcentre/index.html"),
        callcentreAdmin: resolve(root, "callcentre/admin.html")
      }
    }
  }
};
