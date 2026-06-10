import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

const root = resolve(new URL("../..", import.meta.url).pathname);
const examplesRoot = join(root, "examples");
const adminRoot = join(examplesRoot, "admin");
const gif = Buffer.from("R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==", "base64");

export function startMockServer({ port = 4173 } = {}) {
  const hits = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

    if (url.pathname === "/aly.gif") {
      hits.push({
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        raw: url.toString(),
        received_at: Date.now(),
        ip: clientIp(req),
        user_agent: req.headers["user-agent"] || "",
        referer: req.headers.referer || ""
      });
      res.writeHead(200, {
        "content-type": "image/gif",
        "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
        "content-length": String(gif.length)
      });
      res.end(gif);
      return;
    }

    if (url.pathname === "/__hits") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(hits, null, 2));
      return;
    }

    if (url.pathname === "/api/success") {
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store"
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    const candidates = staticFileCandidates(url.pathname);
    for (const file of candidates) {
      try {
        const body = await readStaticFile(file);
        res.writeHead(200, { "content-type": contentType(file) });
        res.end(body);
        return;
      } catch {
        // Try the next static root.
      }
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  return new Promise((resolveReady) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolveReady({
        server,
        hits,
        url: `http://127.0.0.1:${actualPort}`
      });
    });
  });
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (Array.isArray(forwarded)) return forwarded[0] || "";
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "";
}

function staticFileCandidates(pathname) {
  if (pathname === "/") return [join(examplesRoot, "index.html")];
  if (pathname === "/demo.js") return [join(examplesRoot, "sdk-demo.js")];
  if (pathname === "/admin") return [join(adminRoot, "index.html")];
  if (pathname.startsWith("/admin/")) return [safeResolve(adminRoot, pathname.replace(/^\/admin\/?/, ""))].filter(Boolean);

  return [
    safeResolve(examplesRoot, pathname),
    safeResolve(root, pathname)
  ].filter(Boolean);
}

function safeResolve(base, pathname) {
  const file = resolve(base, pathname.replace(/^\/+/, ""));
  if (file === base || file.startsWith(`${base}${sep}`)) return file;
  return null;
}

async function readStaticFile(file) {
  const body = await readFile(file);
  if (extname(file) !== ".html") return body;
  if (file === join(adminRoot, "index.html") || file.startsWith(`${adminRoot}${sep}`)) return body;

  const html = body.toString("utf8");
  return injectSdkLoader(html);
}

function injectSdkLoader(html) {
  if (html.includes("/sdk-demo.js")) return html;

  const script = '\n<script type="module" src="/sdk-demo.js"></script>\n';
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${script}</body>`);
  }
  return `${html}${script}`;
}

function contentType(file) {
  switch (extname(file)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".ttf":
      return "font/ttf";
    case ".eot":
      return "application/vnd.ms-fontobject";
    default:
      return "application/octet-stream";
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 4173);
  const { url } = await startMockServer({ port });
  console.log(`Mock site: ${url}`);
  console.log(`Hits: ${url}/__hits`);
}
