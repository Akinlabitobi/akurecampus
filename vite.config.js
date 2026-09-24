import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default {
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
