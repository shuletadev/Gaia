import { z } from "zod";
import { flag } from "../kit.ts";
import type { Blueprint, PriceMeter } from "../blueprints.ts";

const pulperiaSchema = z.object({
  tier: z.enum(["basic", "serverless", "free"]).default("basic"),
  seedData: flag(true),
});
type Pulperia = z.infer<typeof pulperiaSchema>;

const dbMeter = (tier: Pulperia["tier"]): PriceMeter =>
  tier === "basic"
    ? // Billed per day ($0.161/day for 5 DTUs), so one hour is 1/24 of a unit.
      { label: "SQL Database Basic (5 DTU)", serviceName: "SQL Database", productName: "SQL Database Single Basic", skuName: "B", meterName: "B DTU", unitsPerHour: 1 / 24 }
    : tier === "serverless"
      ? // Billed per vCore-second while active; the database scales between 0.5 and 1 vCore and pauses when idle.
        { label: "SQL serverless (0.5 vCore, while active)", serviceName: "SQL Database", productName: "SQL Database General Purpose - Serverless - Compute Gen5", skuName: "1 vCore", meterName: "vCore", unitsPerHour: 0.5 }
      : { label: "SQL free offer", serviceName: "SQL Database", skuName: "Free", meterName: "Free", unitsPerHour: 1, fixedHourly: 0 };

export const pulperia: Blueprint<any> = {
  id: "cr-pulperia-inventario",
  category: "Showcase",
  title: "Pulpería Don Beto: inventory",
  tagline: "A corner store's stock in Azure SQL Database, with sample tables, views and data",
  code: "cpulp",
  deployMinutes: [3, 8],
  icons: ["Microsoft.Sql/servers", "Microsoft.Sql/servers/databases"],
  fields: [
    {
      key: "tier",
      label: "Pricing model",
      kind: "select",
      options: [
        { value: "basic", label: "Basic (fixed, about $5/month)" },
        { value: "serverless", label: "Serverless (pay while in use, pauses)" },
        { value: "free", label: "Free offer (one per subscription)" },
      ],
      default: "basic",
    },
    { key: "seedData", label: "Load the sample inventory", kind: "toggle", default: true },
  ],
  schema: pulperiaSchema,
  steps: () => [{ name: "sql", label: "Azure SQL server and database", type: "Microsoft.Sql/servers" }],
  meters: (p: Pulperia) => [dbMeter(p.tier)],
  notes: ["Storage beyond the included size", "Backups beyond the included storage", "Serverless compute while the database is active"],
  armParams: (p: Pulperia) => ({ tier: p.tier }),
  paramHooks: [{ fromStage: 0, hook: "vm-password", label: "SQL admin password", validateWith: { adminPassword: "Validation-Placeholder-1!" } }],
  content: [
    {
      kind: "sql-seed",
      label: "Sample inventory",
      serverOutput: "serverName",
      database: "pulperia",
      script: "seed.sql",
      adminUser: "pulperiaAdmin",
      passwordParam: "adminPassword",
      when: (p: Pulperia) => p.seedData,
    },
  ],
  timingKey: (p: Pulperia) => p.tier,
  stages: () => [{ label: "Deploy" }],
  presets: [
    { label: "Cheapest", params: { tier: "basic" } },
    { label: "Free offer", params: { tier: "free" } },
    { label: "Serverless", params: { tier: "serverless" } },
  ],
  alternatives: (p: Pulperia) => (p.tier === "serverless" ? [{ params: { tier: "basic" } as Partial<Pulperia>, loses: "Auto-pause and scaling: Basic has a fixed small size" }] : []),
  scenario: {
    story:
      "Don Beto runs a corner store in Heredia. Stock lives in a notebook, and he finds out something ran out when a customer asks for it. He wants to know what he has, what is running low, what it is worth, and what he sold this week. Here his inventory lives in a relational database the class can query.",
    objectives: [
      "Describe tables, rows, primary keys and foreign keys using products, suppliers and movements",
      "Run SELECT, JOIN and GROUP BY queries against Azure SQL Database",
      "Compare Azure SQL Database, SQL Managed Instance and SQL Server on a VM, and say why a corner store picks the first",
      "Contrast relational data with the document model of the pharmacy lab",
    ],
    exams: ["DP-900: relational data on Azure (tables, keys, SQL, Azure SQL options)", "AZ-900: Azure architecture and services (databases, PaaS)"],
  },
};
