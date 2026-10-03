import type { Blueprint } from "./blueprints.ts";

export interface ReproSuggestion {
  caseId?: string;
  blueprint: string;
  params: Record<string, unknown>;
  region?: string;
  ttlHours?: number;
  purpose: string;
  score: number;
  reasons: string[];
  alternatives: { blueprint: string; score: number; reasons: string[] }[];
}

interface Rule {
  blueprint: string;
  pattern: RegExp;
  weight: number;
  reason: string;
}

/** Signals an APIM / Azure Networking engineer would read in a case description. */
const RULES: Rule[] = [
  // APIM behind App Gateway, internal VNet
  { blueprint: "apim-internal-appgw", pattern: /\b(app(lication)?\s*gateway|appgw|agw|waf(_v2)?)\b/i, weight: 3, reason: "Application Gateway / WAF" },
  { blueprint: "apim-internal-appgw", pattern: /\binternal\s*(mode|vnet)?\b|\bvnet[- ]?inject(ed|ion)\b|\bstv2\b/i, weight: 3, reason: "APIM in internal / injected VNet mode" },
  { blueprint: "apim-internal-appgw", pattern: /\bbackend\s*health\b|\bunhealthy\b|\b502\b|\bbad gateway\b|\bhealth\s*probe\b|status-0123456789abcdef/i, weight: 2, reason: "Backend health / 502 symptoms" },
  { blueprint: "apim-internal-appgw", pattern: /\bprivate\s*dns\b|\bazure-api\.net\b|\bname resolution\b|\bnslookup\b/i, weight: 2, reason: "Private DNS for azure-api.net" },
  { blueprint: "apim-internal-appgw", pattern: /\b(3443|6390|management endpoint|network status|nsg rule)\b/i, weight: 2, reason: "APIM VNet dependencies / NSG" },
  { blueprint: "apim-internal-appgw", pattern: /\bdeveloper\s*(tier|sku)\b|\bpremium\b/i, weight: 1, reason: "Classic tier" },
  // Hub-spoke firewall
  { blueprint: "hub-spoke-firewall", pattern: /\b(azure\s*)?firewall\b|\bazfw\b/i, weight: 3, reason: "Azure Firewall" },
  { blueprint: "hub-spoke-firewall", pattern: /\bhub[- ]?(and[- ])?spoke\b|\bspokes?\b|\bpeering\b/i, weight: 3, reason: "Hub-spoke / peering" },
  { blueprint: "hub-spoke-firewall", pattern: /\budr\b|\broute\s*table\b|\bforced\s*tunnel(l)?ing\b|\bnext\s*hop\b|\b0\.0\.0\.0\/0\b|\basymmetric\b/i, weight: 3, reason: "UDR / forced tunnelling" },
  { blueprint: "hub-spoke-firewall", pattern: /\bsnat\b|\begress\b|\boutbound\b|\bapplication rule\b|\bnetwork rule\b|\bfqdn tag\b/i, weight: 2, reason: "Egress / SNAT / firewall rules" },
  // APIM v2 quick start
  { blueprint: "apim-v2-quickstart", pattern: /\b(basic|standard)\s*v2\b|\bv2\s*(tier|sku)\b|\bbasicv2\b|\bstandardv2\b/i, weight: 4, reason: "APIM v2 tier" },
  { blueprint: "apim-v2-quickstart", pattern: /\bpolic(y|ies)\b|\brate[- ]?limit\b|\bjwt\b|\bvalidate-jwt\b|\bset-header\b|\bcors\b|\bquota\b|\brewrite-uri\b|\bbackend\s*(url|service)\b/i, weight: 2, reason: "Gateway policy behaviour" },
  { blueprint: "apim-v2-quickstart", pattern: /\bapi\s*management\b|\bapim\b/i, weight: 1, reason: "API Management" },
];

/** Region names as people write them -> ARM names. */
const REGION_WORDS: [RegExp, string][] = [
  [/\bcentral\s*us\b|\bcentralus\b|\bcus\b/i, "centralus"],
  [/\beast\s*us\s*2\b|\beastus2\b|\beus2\b/i, "eastus2"],
  [/\beast\s*us\b(?!\s*2)|\beastus\b(?!2)/i, "eastus"],
  [/\bwest\s*us\s*2\b|\bwestus2\b|\bwus2\b/i, "westus2"],
  [/\bwest\s*us\s*3\b|\bwestus3\b|\bwus3\b/i, "westus3"],
  [/\bnorth\s*europe\b|\bnortheurope\b|\bneu\b/i, "northeurope"],
  [/\bwest\s*europe\b|\bwesteurope\b|\bweu\b/i, "westeurope"],
  [/\bcanada\s*central\b|\bcanadacentral\b/i, "canadacentral"],
];

/** DfM-style 16-digit case numbers, or "case <id>" / "SR <id>". */
export function extractCaseId(text: string): string | undefined {
  const dfm = /\b(\d{15,16})\b/.exec(text);
  if (dfm) return dfm[1];
  const labeled = /\b(?:case|sr|ticket|incident|icm)\s*(?:#|no\.?|number)?\s*[:\-]?\s*([A-Za-z0-9-]{5,40})\b/i.exec(text);
  return labeled?.[1];
}

export function suggestRepro(text: string, blueprints: Blueprint[], regions: string[], explicitCaseId?: string): ReproSuggestion {
  const scores = new Map<string, { score: number; reasons: string[] }>(blueprints.map((b) => [b.id, { score: 0, reasons: [] }]));
  for (const r of RULES) {
    const s = scores.get(r.blueprint);
    if (s && r.pattern.test(text)) {
      s.score += r.weight;
      s.reasons.push(r.reason);
    }
  }
  // Exported blueprints match on the names of the resource types they contain.
  for (const b of blueprints.filter((x) => x.custom)) {
    const s = scores.get(b.id)!;
    const words = [b.title, b.custom!.source.resourceGroup].map((w) => w.toLowerCase());
    for (const w of words) if (w.length > 3 && text.toLowerCase().includes(w)) {
      s.score += 4;
      s.reasons.push(`Mentions "${w}"`);
    }
  }
  const ranked = [...scores].sort((a, b) => b[1].score - a[1].score);
  const [bestId, best] = ranked[0] ?? ["apim-v2-quickstart", { score: 0, reasons: [] }];
  const blueprint = best.score > 0 ? bestId : "apim-v2-quickstart";

  const params: Record<string, unknown> = {};
  const reasons = best.score > 0 ? [...best.reasons] : ["No strong signal — starting from the quickest APIM lab"];
  if (blueprint === "apim-v2-quickstart" && /\bstandard\s*v2\b|\bstandardv2\b|\bvnet\s*integration\b|\bprivate\s*backend/i.test(text)) {
    params.sku = "StandardV2";
    reasons.push("Standard v2 (VNet integration / Standard v2 mentioned)");
  }
  if (blueprint === "apim-internal-appgw" && /\bdetection\s*mode\b|\bfalse\s*positive|\bwaf\s*(log|detection)\b/i.test(text)) {
    params.wafMode = "Detection";
    reasons.push("WAF in Detection mode (false positives / logging)");
  }
  if (blueprint === "hub-spoke-firewall") {
    const n = /\b(two|2|three|3)\s*spokes?\b/i.exec(text)?.[1]?.toLowerCase();
    if (n) {
      params.spokeCount = n === "three" || n === "3" ? 3 : 2;
      reasons.push(`${params.spokeCount} spokes`);
    } else if (/spoke[- ]?to[- ]?spoke|east[- ]?west/i.test(text)) {
      params.spokeCount = 2;
      reasons.push("2 spokes for spoke-to-spoke traffic");
    }
  }

  const region = REGION_WORDS.find(([re, r]) => regions.includes(r) && re.test(text))?.[1];
  if (region) reasons.push(`Region ${region}`);

  const caseId = explicitCaseId?.trim() || extractCaseId(text);
  const firstLine = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  const summary = firstLine.replace(/\b\d{15,16}\b/, "").replace(/[<>%&\\?/]/g, "").replace(/\s+/g, " ").replace(/^[\s\-–—:|,.#]+/, "").trim();
  const purpose = `${caseId ? `Case ${caseId}` : "Repro"}${summary ? `: ${summary}` : ""}`.slice(0, 80);

  return {
    caseId,
    blueprint,
    params,
    region,
    ttlHours: 24,
    purpose,
    score: best.score,
    reasons,
    alternatives: ranked.slice(1).filter(([, s]) => s.score > 0).map(([id, s]) => ({ blueprint: id, score: s.score, reasons: s.reasons })),
  };
}
