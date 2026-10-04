require("http").createServer((q, r) => {
  r.setHeader("content-type", "text/html; charset=utf-8");
  r.end(Buffer.from("__PAGE__", "base64"));
}).listen(process.env.PORT || 8080);
