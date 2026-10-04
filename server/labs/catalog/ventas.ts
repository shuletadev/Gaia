import { z } from "zod";
import { flag } from "../kit.ts";
import type { Blueprint } from "../blueprints.ts";

const ventasSchema = z.object({
  dataSize: z.enum(["one", "three"]).default("one"),
  openFirewall: flag(true),
});
type Ventas = z.infer<typeof ventasSchema>;

export const ventas: Blueprint<any> = {
  id: "cr-ventas-reporte",
  category: "Showcase",
  title: "Monthly sales report",
  tagline: "A data lake of sales files queried in place with serverless SQL",
  code: "cvent",
  deployMinutes: [5, 12],
  icons: ["Microsoft.Storage/storageAccounts", "Microsoft.Synapse/workspaces"],
  fields: [
    {
      key: "dataSize",
      label: "History",
      kind: "select",
      options: [
        { value: "one", label: "One year of sales" },
        { value: "three", label: "Three years of sales" },
      ],
      default: "one",
    },
    { key: "openFirewall", label: "Open the workspace firewall (class use, synthetic data)", kind: "toggle", default: true },
  ],
  schema: ventasSchema,
  steps: () => [
    { name: "lake", label: "Data lake storage", type: "Microsoft.Storage/storageAccounts" },
    { name: "workspace", label: "Synapse workspace (serverless SQL)", type: "Microsoft.Synapse/workspaces" },
  ],
  // Serverless SQL bills by data processed (about $5 per TB), so the sample files cost fractions of a cent.
  meters: () => [
    { label: "Synapse serverless SQL (per TB processed)", serviceName: "Azure Synapse Analytics", skuName: "Serverless", meterName: "Data processed", unitsPerHour: 1, fixedHourly: 0 },
    { label: "Data lake storage (idle)", serviceName: "Storage", skuName: "Standard", meterName: "Standard", unitsPerHour: 1, fixedHourly: 0 },
  ],
  notes: ["Serverless SQL: about $5 per TB of data processed by queries", "Data lake capacity and operations"],
  armParams: (p: Ventas) => ({ openFirewall: p.openFirewall }),
  paramHooks: [{ fromStage: 0, hook: "vm-password", label: "Synapse SQL admin password", validateWith: { adminPassword: "Validation-Placeholder-1!" } }],
  // The workspace's identity gets access to the lake through a role assignment (needs Owner or User Access Administrator).
  extraTypes: ["Microsoft.Authorization/roleAssignments"],
  regionFree: ["Microsoft.Authorization/roleAssignments"],
  content: [{ kind: "blob-upload", label: "Sample sales files", accountOutput: "dataLake", container: "ventas", source: { generator: "pharmacy-sales" } }],
  timingKey: (p: Ventas) => p.dataSize,
  stages: () => [{ label: "Deploy" }],
  alternatives: (p: Ventas) => (p.dataSize === "three" ? [{ params: { dataSize: "one" } as Partial<Ventas> }].map((a) => ({ ...a, loses: "Two years of history (less to compare season over season)" })) : []),
  scenario: {
    story:
      "The pharmacy from the receipts lab has a year of sales in files. The owner asks: which products sell most in the rainy season, which hours are busiest, and what should she order for December? She has no data team and wants a monthly report. The sales here are synthetic.",
    objectives: [
      "Describe a data lake and explain why files in a lake are not a database",
      "Query files in place with SQL, then aggregate by month, product and hour",
      "Explain batch versus streaming, and ETL versus ELT, using this example",
      "Explain why reading data needs its own permission, separate from managing the storage account",
    ],
    exams: ["DP-900: analytics workloads (data lake, batch vs streaming, ETL/ELT, data warehousing)", "DP-900: core data concepts"],
  },
};
