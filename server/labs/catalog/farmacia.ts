import { z } from "zod";
import type { Blueprint } from "../blueprints.ts";

const farmaciaSchema = z.object({ redundancy: z.enum(["LRS", "GRS"]).default("LRS") });

export const farmacia: Blueprint<any> = {
  id: "cr-farmacia-recibos",
  category: "Showcase",
  title: "Farmacia Pura Vida: digital receipts",
  tagline: "A Costa Rican pharmacy replaces paper receipts with a web front end, a sales database and receipt storage",
  code: "cfarm",
  deployMinutes: [3, 8],
  icons: ["Microsoft.Web/staticSites", "Microsoft.DocumentDB/databaseAccounts", "Microsoft.Storage/storageAccounts"],
  fields: [
    {
      key: "redundancy",
      label: "Storage redundancy",
      kind: "select",
      options: [
        { value: "LRS", label: "LRS (one datacenter)" },
        { value: "GRS", label: "GRS (also a paired region)" },
      ],
      default: "LRS",
    },
  ],
  schema: farmaciaSchema,
  steps: () => [
    { name: "storage", label: "Receipt storage", type: "Microsoft.Storage/storageAccounts" },
    { name: "cosmos", label: "Sales database (Cosmos DB serverless)", type: "Microsoft.DocumentDB/databaseAccounts" },
    { name: "web", label: "Web front end (Static Web App)", type: "Microsoft.Web/staticSites" },
  ],
  // Every service here is free or usage-based, so an idle lab costs about nothing.
  meters: () => [
    { label: "Static Web App (Free)", serviceName: "Azure Static Web Apps", skuName: "Free", meterName: "Free", unitsPerHour: 1, fixedHourly: 0 },
    { label: "Cosmos DB serverless (idle)", serviceName: "Azure Cosmos DB", skuName: "Serverless", meterName: "Serverless", unitsPerHour: 1, fixedHourly: 0 },
    { label: "Storage (idle)", serviceName: "Storage", skuName: "Standard", meterName: "Standard", unitsPerHour: 1, fixedHourly: 0 },
  ],
  notes: ["Cosmos DB request units and storage used", "Blob storage capacity and operations", "GRS adds geo-replication charges"],
  armParams: (p: z.infer<typeof farmaciaSchema>) => ({ redundancy: p.redundancy }),
  regionFree: ["Microsoft.Web/staticSites"],
  content: [{ kind: "static-web-app", label: "Pharmacy cashier app", dir: "app", siteOutput: "staticSiteName" }],
  timingKey: (p: z.infer<typeof farmaciaSchema>) => p.redundancy,
  stages: () => [{ label: "Deploy", gate: { kind: "http-ok", label: "Front end answers", timeoutMin: 10, blocking: false } }],
  scenario: {
    story:
      "Farmacia Pura Vida is a family pharmacy in San José. Every sale used to end with a paper receipt and a notebook for the day's totals. The owners want digital receipts customers can keep, a record of every sale for the monthly accounts, and a screen the cashier can open from any computer, without buying or maintaining a server.",
    objectives: [
      "Choose PaaS and serverless services instead of virtual machines, and explain why",
      "Explain storage redundancy (LRS vs GRS) and when a business pays for it",
      "Compare a relational and a document database for sales records",
      "Find the resources, region and costs of a workload in the portal",
    ],
    exams: ["AZ-900: cloud concepts, core Azure services, cost management", "DP-900: non-relational data (Cosmos DB, Blob storage)"],
  },
};
