import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

// Tiny static server for the fixture HTML pages. Used by the eval runner so
// the agent fetches the same way it would fetch a real URL.

const ROOT = resolve(new URL("../fixtures", import.meta.url).pathname);
const PORT = Number(process.env.EVAL_PORT ?? "4173");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "application/javascript",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const safe = url.pathname.replace(/\.\./g, "");
  const target = join(ROOT, safe === "/" ? "/index.html" : safe);
  if (!target.startsWith(ROOT + sep) && target !== ROOT) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  try {
    const stats = await stat(target);
    if (stats.isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    const data = await readFile(target);
    res.writeHead(200, { "content-type": MIME[extname(target)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`fixtures: http://localhost:${PORT}`);
});
