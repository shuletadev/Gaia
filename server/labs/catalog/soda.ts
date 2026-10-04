import { z } from "zod";
import type { Blueprint } from "../blueprints.ts";

const sodaSchema = z.object({
  redundancy: z.enum(["LRS", "GRS", "ZRS"]).default("LRS"),
  accessTier: z.enum(["Hot", "Cool"]).default("Hot"),
});
type Soda = z.infer<typeof sodaSchema>;

export const soda: Blueprint<any> = {
  id: "cr-soda-sitio-web",
  category: "Showcase",
  title: "Soda Doña Rosa: website and DNS",
  tagline: "A restaurant's menu site on Storage static hosting, with a DNS zone to practice records",
  code: "csoda",
  deployMinutes: [2, 5],
  icons: ["Microsoft.Storage/storageAccounts", "Microsoft.Network/dnsZones"],
  fields: [
    {
      key: "redundancy",
      label: "Storage redundancy",
      kind: "select",
      options: [
        { value: "LRS", label: "LRS (one datacenter)" },
        { value: "GRS", label: "GRS (also a paired region)" },
        { value: "ZRS", label: "ZRS (across zones; not in every region)" },
      ],
      default: "LRS",
    },
    {
      key: "accessTier",
      label: "Access tier",
      kind: "select",
      options: [
        { value: "Hot", label: "Hot (frequent reads)" },
        { value: "Cool", label: "Cool (cheaper to store)" },
      ],
      default: "Hot",
    },
  ],
  schema: sodaSchema,
  steps: () => [
    { name: "storage", label: "Storage account (static website)", type: "Microsoft.Storage/storageAccounts" },
    { name: "dns", label: "DNS zone and records", type: "Microsoft.Network/dnsZones" },
  ],
  meters: () => [
    { label: "Storage (idle)", serviceName: "Storage", skuName: "Standard", meterName: "Standard", unitsPerHour: 1, fixedHourly: 0 },
    // Azure DNS: about $0.50 per hosted zone per month.
    { label: "DNS zone", serviceName: "Azure DNS", skuName: "Public", meterName: "Hosted zone", unitsPerHour: 1, fixedHourly: 0.5 / 730 },
  ],
  notes: ["Storage capacity, read operations and outbound bandwidth", "DNS queries (per million)"],
  armParams: (p: Soda) => ({ redundancy: p.redundancy, accessTier: p.accessTier }),
  regionFree: ["Microsoft.Network/dnsZones"],
  content: [{ kind: "storage-static-site", label: "Menu website", accountOutput: "accountName", source: { dir: "site" } }],
  timingKey: (p: Soda) => `${p.redundancy}/${p.accessTier}`,
  stages: () => [{ label: "Deploy", gate: { kind: "http-ok", label: "Website answers", timeoutMin: 10, blocking: false } }],
  presets: [
    { label: "Cheapest", params: { redundancy: "LRS", accessTier: "Cool" } },
    { label: "Resilient", params: { redundancy: "GRS", accessTier: "Hot" } },
  ],
  alternatives: (p: Soda) => (p.redundancy !== "LRS" ? [{ params: { redundancy: "LRS" } as Partial<Soda>, loses: "Protection against a zone or regional failure" }] : []),
  scenario: {
    story:
      "Doña Rosa's soda in Cartago serves lunch to half the neighborhood, and customers keep asking for the menu and the hours online. She has no IT staff and a very small budget. Here her menu becomes a website for pennies, and the class practices the DNS records that would put it under her own name.",
    objectives: [
      "Host a static website from a Storage account and find its endpoint",
      "Explain what DNS does and read the A, CNAME and TXT records in a zone",
      "Read the region, redundancy and access tier of the account, and say what each costs",
      "Explain why serving a custom domain over HTTPS needs another service, and what it adds to the bill",
    ],
    exams: ["AZ-900: Azure architecture and services (storage accounts, redundancy, access tiers, DNS)", "AZ-900: cloud concepts (consumption-based pricing)"],
  },
};
