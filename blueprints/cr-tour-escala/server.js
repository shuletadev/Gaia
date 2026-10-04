const http = require("http");
const version = process.env.APP_VERSION || "1";
const template = Buffer.from("__PAGE__", "base64").toString("utf8");
http
  .createServer((q, r) => {
    const u = new URL(q.url, "http://localhost");
    if (u.pathname === "/health") {
      r.writeHead(200, { "content-type": "text/plain" });
      return r.end("ok");
    }
    if (u.pathname === "/work") {
      // Burn CPU for a moment: this is what makes autoscale react.
      const end = Date.now() + Math.min(Number(u.searchParams.get("ms")) || 500, 2000);
      while (Date.now() < end) {}
      r.writeHead(200, { "content-type": "text/plain" });
      return r.end("listo");
    }
    const instance = String(process.env.WEBSITE_INSTANCE_ID || "local").slice(0, 8);
    r.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    r.end(template.split("__VERSION__").join(version).split("__INSTANCE__").join(instance));
  })
  .listen(process.env.PORT || 8080);
