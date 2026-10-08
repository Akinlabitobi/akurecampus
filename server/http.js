export const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8"
};

export function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Access-Control-Allow-Origin": "*" });
  if (Buffer.isBuffer(body) || typeof body === "string") {
    res.end(body);
    return;
  }
  res.end(JSON.stringify(body));
}

export function parseBody(req, maxLength = 1_000_000) {
  return new Promise((resolveBody, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > maxLength) reject(new Error("Request body too large"));
    });
    req.on("end", () => {
      try {
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

export function cleanText(value) {
  return String(value ?? "").trim().slice(0, 500);
}

export function cleanCode(value) {
  return cleanText(value).replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 10);
}
