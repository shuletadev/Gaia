import { z } from "zod";
import { flag } from "../kit.ts";
import type { Blueprint } from "../blueprints.ts";

const fincasSchema = z.object({
  redundancy: z.enum(["LRS", "GRS"]).default("LRS"),
  enableVersioning: flag(true),
  lifecycleDays: z.coerce.number().int().min(1).max(90).default(30),
});
type Fincas = z.infer<typeof fincasSchema>;

export const fincas: Blueprint<any> = {
  id: "cr-fincas-archivo",
  category: "Showcase",
  title: "Coffee farms: photo archive",
  tagline: "Blob tiers, lifecycle rules, soft delete and versioning, plus Files, Queue and Table to compare",
  code: "cfinca",
  deployMinutes: [2, 5],
  icons: ["Microsoft.Storage/storageAccounts"],
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
    { key: "enableVersioning", label: "Keep blob versions", kind: "toggle", default: true },
    { key: "lifecycleDays", label: "Days before moving to Cool", kind: "int", min: 1, max: 90, default: 30 },
  ],
  schema: fincasSchema,
  steps: () => [
    { name: "storage", label: "Storage account, containers, share, queue and table", type: "Microsoft.Storage/storageAccounts" },
    { name: "lifecycle", label: "Lifecycle rule", type: "Microsoft.Storage/storageAccounts/managementPolicies" },
  ],
  meters: () => [{ label: "Storage (about 1 MB of sample files)", serviceName: "Storage", skuName: "Standard", meterName: "Standard", unitsPerHour: 1, fixedHourly: 0 }],
  notes: ["Blob capacity by tier and operations", "GRS adds geo-replication charges", "Retrieving from Archive is billed and takes hours"],
  armParams: (p: Fincas) => ({ redundancy: p.redundancy, enableVersioning: p.enableVersioning, lifecycleDays: p.lifecycleDays }),
  regionFree: ["Microsoft.Storage/storageAccounts/managementPolicies"],
  content: [{ kind: "blob-upload", label: "Sample photos and reports", accountOutput: "storageAccount", container: "fincas", source: { generator: "farm-archive" } }],
  timingKey: (p: Fincas) => p.redundancy,
  stages: () => [{ label: "Deploy" }],
  presets: [
    { label: "Cheapest", params: { redundancy: "LRS", enableVersioning: false } },
    { label: "Protected", params: { redundancy: "GRS", enableVersioning: true } },
  ],
  alternatives: (p: Fincas) => (p.redundancy === "GRS" ? [{ params: { redundancy: "LRS" } as Partial<Fincas>, loses: "Protection against the loss of a whole region" }] : []),
  scenario: {
    story:
      "A coffee cooperative in Los Santos has years of photos of harvests, soil tests and inspection reports on a few hard drives, and one of them already failed. This year's photos are used every day; the ones from five years ago almost never, but they must be kept. Here the archive moves to Azure Storage and the class decides what goes in Hot, Cool and Archive. All photos and reports are synthetic.",
    objectives: [
      "Place photos, reports and logs on the structured, semi-structured and unstructured data spectrum",
      "Choose Hot, Cool or Archive for different files and explain the cost trade-off and the retrieval delay",
      "Read a lifecycle rule that moves and deletes data automatically",
      "Explain soft delete, versioning and redundancy as protection against mistakes and failures",
      "Compare Blob, Files, Queue and Table storage by use case",
    ],
    exams: ["DP-900: non-relational data (unstructured data, blob storage) and core data concepts", "AZ-900: storage services, access tiers, redundancy and migration tools"],
  },
};
