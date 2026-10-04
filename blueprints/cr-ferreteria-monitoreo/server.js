const http = require("http");
const template = Buffer.from("__PAGE__", "base64").toString("utf8");
const log = (level, msg, extra) => (level === "error" ? console.error : console.log)(JSON.stringify(Object.assign({ level: level, msg: msg }, extra)));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
http
  .createServer(async (q, r) => {
    const u = new URL(q.url, "http://localhost");
    const text = (code, body) => {
      r.writeHead(code, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      r.end(body);
    };
    if (u.pathname === "/health") return text(200, "ok");
    if (u.pathname === "/compra") {
      // A normal order: a short, slightly random wait.
      await pause(40 + Math.floor(Math.random() * 160));
      log("info", "compra registrada", { producto: "martillo", total: 4500 });
      return text(200, "gracias por su compra");
    }
    if (u.pathname === "/error") {
      // What a broken payment gateway looks like to the platform: a 500 and an error in the log.
      log("error", "falló el cobro: la pasarela de pago no respondió", { pasarela: "demo" });
      return text(500, "error del servidor");
    }
    if (u.pathname === "/lento") {
      await pause(4000);
      log("warn", "catálogo lento", { ms: 4000 });
      return text(200, "catálogo cargado");
    }
    r.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    r.end(template);
  })
  .listen(process.env.PORT || 8080);
