import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { handleApi } from "./server/api.js";
import { distDir, port, useSupabase } from "./server/config.js";
import { ensureDb } from "./server/db.js";
import { mimeTypes, send } from "./server/http.js";

function serveStatic(req, res, url) {
  let filePath = join(distDir, url.pathname === "/" ? "index.html" : url.pathname);
  if (!filePath.startsWith(distDir)) {
    send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }
  // A request for a nested route directory (e.g. /callcentre or /callcentre/)
  // resolves to that directory's own index.html, not the site's root one.
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }
  if (!existsSync(filePath)) filePath = join(distDir, "index.html");
  if (!existsSync(filePath)) {
    send(res, 404, "Run npm run build first.", "text/plain; charset=utf-8");
    return;
  }
  send(res, 200, readFileSync(filePath), mimeTypes[extname(filePath)] || "application/octet-stream");
}

export async function requestHandler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api") && await handleApi(req, res, url)) return;
  } catch (error) {
    // A route handler threw without its own try/catch (e.g. readDb() itself
    // failing) -- surface a clean JSON error instead of an opaque platform
    // crash page, and never leave the response hanging.
    if (!res.headersSent) send(res, 500, { error: error.message || "Something went wrong." });
    return;
  }
  serveStatic(req, res, url);
}

if (!process.env.VERCEL) {
  createServer(requestHandler).listen(port, "127.0.0.1", () => {
    if (!useSupabase) ensureDb();
    console.log(`Harvesters Akure server running at http://127.0.0.1:${port}`);
    console.log(`Database: ${useSupabase ? "Supabase" : "local JSON file"}`);
  });
}
