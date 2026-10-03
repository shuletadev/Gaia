import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import forge from "node-forge";
import type { ArmClient } from "../azure/arm.ts";
import { DATA_DIR } from "../config.ts";
import type { HookKind } from "./blueprints.ts";

/** Context a hook gets before a stage: who/where the lab is and the outputs of earlier stages. */
export interface HookCtx {
  arm: Pick<ArmClient, "post">;
  labName: string;
  subscriptionId: string;
  region: string;
  params: Record<string, unknown>;
  outputs: Record<string, unknown>;
}

/** Returns extra template parameters for this and later stages. */
export type ParamHook = (ctx: HookCtx) => Promise<Record<string, unknown>>;

export const labDataDir = (labName: string) => resolve(DATA_DIR, "labs", labName);

/**
 * Self-hosted gateway access token. Generated from the gateway's key through ARM so it never has to be
 * copied from the portal; valid 30 days (longer than any lab lifetime).
 */
const apimGatewayToken: ParamHook = async (c) => {
  const apim = String(c.outputs.apimName || `${c.labName}-apim`);
  const gw = String(c.outputs.gatewayName || "lab-gateway");
  const expiry = new Date(Date.now() + 29 * 24 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const r = await c.arm.post<{ value: string }>(
    `/subscriptions/${c.subscriptionId}/resourceGroups/${c.labName}/providers/Microsoft.ApiManagement/service/${apim}/gateways/${gw}/generateToken?api-version=2024-05-01`,
    { keyType: "primary", expiry },
  );
  if (!r?.value) throw new Error("APIM returned no gateway token");
  return { gatewayToken: `GatewayKey ${r.value}` };
};

export interface LabCerts {
  caPem: string;
  serverPfxBase64: string;
  serverPfxPassword: string;
  clientCertPem: string;
  clientKeyPem: string;
  /** Client certificate + key as PFX (password CLIENT_PFX_PASSWORD) for Windows curl/PowerShell. */
  clientPfxBase64: string;
}

/** Lab-only, local file: a fixed password keeps the copy-paste commands simple. */
export const CLIENT_PFX_PASSWORD = "labctl";

function makeCert(subjectCn: string, key: forge.pki.rsa.KeyPair, issuer: { cert?: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey }, ext: object[], days = 30) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = key.publicKey;
  cert.serialNumber = `01${randomBytes(8).toString("hex")}`;
  cert.validity.notBefore = new Date(Date.now() - 3_600_000);
  cert.validity.notAfter = new Date(Date.now() + days * 24 * 3_600_000);
  cert.setSubject([{ name: "commonName", value: subjectCn }, { name: "organizationName", value: "labctl" }]);
  cert.setIssuer(issuer.cert ? issuer.cert.subject.attributes : [{ name: "commonName", value: subjectCn }, { name: "organizationName", value: "labctl" }]);
  cert.setExtensions(ext);
  cert.sign(issuer.key, forge.md.sha256.create());
  return cert;
}

/** A lab CA plus a server certificate for `host` and a client certificate, all signed by the CA. */
export function generateLabCerts(host: string): LabCerts {
  const caKey = forge.pki.rsa.generateKeyPair(2048);
  const ca = makeCert("labctl lab CA", caKey, { key: caKey.privateKey }, [{ name: "basicConstraints", cA: true, critical: true }, { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true }]);
  const serverKey = forge.pki.rsa.generateKeyPair(2048);
  const server = makeCert(host, serverKey, { cert: ca, key: caKey.privateKey }, [
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", serverAuth: true },
    { name: "subjectAltName", altNames: [{ type: 2, value: host }] },
  ]);
  const clientKey = forge.pki.rsa.generateKeyPair(2048);
  const client = makeCert("labctl client", clientKey, { cert: ca, key: caKey.privateKey }, [
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", clientAuth: true },
  ]);
  const serverPfxPassword = randomBytes(18).toString("base64url");
  const p12 = forge.pkcs12.toPkcs12Asn1(serverKey.privateKey, [server, ca], serverPfxPassword, { algorithm: "3des" });
  const clientP12 = forge.pkcs12.toPkcs12Asn1(clientKey.privateKey, [client, ca], CLIENT_PFX_PASSWORD, { algorithm: "3des" });
  return {
    clientPfxBase64: forge.util.encode64(forge.asn1.toDer(clientP12).getBytes()),
    caPem: forge.pki.certificateToPem(ca),
    serverPfxBase64: forge.util.encode64(forge.asn1.toDer(p12).getBytes()),
    serverPfxPassword,
    clientCertPem: forge.pki.certificateToPem(client),
    clientKeyPem: forge.pki.privateKeyToPem(clientKey.privateKey),
  };
}

/** Certificates are generated once per lab and kept locally, so retries reuse the same ones. */
export function labCerts(labName: string, host: string, dir = labDataDir(labName)): LabCerts & { dir: string } {
  const file = resolve(dir, "certs.json");
  if (existsSync(file)) return { ...(JSON.parse(readFileSync(file, "utf8")) as LabCerts), dir };
  const certs = generateLabCerts(host);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(certs), { mode: 0o600 });
  writeFileSync(resolve(dir, "ca.pem"), certs.caPem);
  writeFileSync(resolve(dir, "client.pem"), certs.clientCertPem);
  writeFileSync(resolve(dir, "client.key"), certs.clientKeyPem, { mode: 0o600 });
  writeFileSync(resolve(dir, "client.pfx"), Buffer.from(certs.clientPfxBase64, "base64"), { mode: 0o600 });
  return { ...certs, dir };
}

export const mtlsHost = (labName: string, region: string) => `${labName}.${region}.cloudapp.azure.com`;

/**
 * Copy-paste requests for the lab. Windows curl (Schannel) needs the PFX, TLS 1.2 for a key that is not
 * in the certificate store, and --ssl-no-revoke because the lab CA publishes no revocation list.
 */
export function mtlsCommands(dir: string, host: string) {
  return {
    clientCertFolder: dir,
    windowsRequest: `curl --tls-max 1.2 --ssl-no-revoke --cert-type P12 --cert "${resolve(dir, "client.pfx")}:${CLIENT_PFX_PASSWORD}" --cacert "${resolve(dir, "ca.pem")}" https://${host}/headers`,
  };
}

const mtlsCerts: ParamHook = async (c) => {
  const certs = labCerts(c.labName, mtlsHost(c.labName, c.region));
  return {
    serverPfx: certs.serverPfxBase64,
    serverPfxPassword: certs.serverPfxPassword,
    clientCaCert: Buffer.from(certs.caPem).toString("base64"),
  };
};

/** Random admin password meeting Azure complexity rules; nothing listens for it (no SSH port is opened). */
export function vmPassword(): string {
  return `Lc${randomBytes(18).toString("base64url")}!7a`;
}

export const PARAM_HOOKS: Record<HookKind, ParamHook> = {
  "vm-password": async () => ({ adminPassword: vmPassword() }),
  "apim-gateway-token": apimGatewayToken,
  "mtls-certs": mtlsCerts,
};
