const http = require("http");
const template = Buffer.from("__PAGE__", "base64").toString("utf8");
const account = process.env.STORAGE_ACCOUNT || "";
const blobBase = process.env.BLOB_BASE || "https://" + account + ".blob.core.windows.net";
const blobPath = "/informes/informes/informe-acueducto.txt";

// The app asks the platform for a token for Storage as its own managed identity. There is no key and no password anywhere.
async function getToken() {
  const endpoint = process.env.IDENTITY_ENDPOINT;
  if (!endpoint) throw new Error("Esta aplicación no tiene una identidad administrada.");
  const url = new URL(endpoint);
  url.searchParams.set("resource", "https://storage.azure.com/");
  url.searchParams.set("api-version", "2019-08-01");
  const res = await fetch(url, { headers: { "X-IDENTITY-HEADER": process.env.IDENTITY_HEADER || "" } });
  if (!res.ok) throw new Error("No se pudo obtener el token (" + res.status + ")");
  return (await res.json()).access_token;
}

async function readReport() {
  const token = await getToken();
  const res = await fetch(blobBase + blobPath, { headers: { authorization: "Bearer " + token, "x-ms-version": "2023-11-03" } });
  if (res.ok) return { ok: true, status: res.status, texto: await res.text() };
  return { ok: false, status: res.status, error: res.status === 403 ? "Acceso denegado: esta identidad no tiene un rol que le permita leer el contenedor." : "El almacenamiento respondió " + res.status };
}

http
  .createServer(async (q, r) => {
    const u = new URL(q.url, "http://localhost");
    if (u.pathname === "/health") {
      r.writeHead(200, { "content-type": "text/plain" });
      return r.end("ok");
    }
    if (u.pathname === "/leer") {
      let body;
      try {
        body = await readReport();
      } catch (e) {
        body = { ok: false, status: 0, error: String(e && e.message ? e.message : e) };
      }
      r.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      return r.end(JSON.stringify(body));
    }
    r.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    r.end(template.split("__ACCOUNT__").join(account));
  })
  .listen(process.env.PORT || 8080);
