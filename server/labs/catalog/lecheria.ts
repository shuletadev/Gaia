import { z } from "zod";
import { flag } from "../kit.ts";
import type { Blueprint } from "../blueprints.ts";

const lecheriaSchema = z.object({
  redundancy: z.enum(["LRS", "ZRS", "GRS"]).default("LRS"),
  includeReplica: flag(true),
});
type Lecheria = z.infer<typeof lecheriaSchema>;

export const lecheria: Blueprint<any> = {
  id: "cr-lecheria-almacenamiento",
  category: "Showcase",
  title: "Dairy cooperative: storage administration",
  tagline: "Keys, SAS tokens, a firewall, soft delete, versioning, Azure Files and object replication on two accounts",
  code: "clech",
  deployMinutes: [3, 6],
  icons: ["Microsoft.Storage/storageAccounts", "Microsoft.Network/virtualNetworks"],
  fields: [
    {
      key: "redundancy",
      label: "Redundancy of the main account",
      kind: "select",
      options: [
        { value: "LRS", label: "LRS (one datacenter)" },
        { value: "ZRS", label: "ZRS (three zones)" },
        { value: "GRS", label: "GRS (also a paired region)" },
      ],
      default: "LRS",
    },
    { key: "includeReplica", label: "Second account for object replication", kind: "toggle", default: true },
  ],
  schema: lecheriaSchema,
  steps: (p: Lecheria) => [
    { name: "network", label: "Virtual network with the Storage service endpoint", type: "Microsoft.Network/virtualNetworks" },
    { name: "storage", label: "Main storage account, container, share and data protection", type: "Microsoft.Storage/storageAccounts" },
    ...(p.includeReplica ? [{ name: "replica", label: "Second storage account (replica)", type: "Microsoft.Storage/storageAccounts" }] : []),
    { name: "lifecycle", label: "Lifecycle rule", type: "Microsoft.Storage/storageAccounts/managementPolicies" },
  ],
  // Capacity is a few KB; the service endpoint, soft delete and versioning cost nothing extra at this size.
  meters: (p: Lecheria) => [
    { label: `Storage (${p.includeReplica ? "two accounts, " : ""}a few KB of sample files)`, serviceName: "Storage", skuName: "Standard", meterName: "Standard", unitsPerHour: 1, fixedHourly: 0 },
  ],
  notes: ["Capacity, operations and versions kept", "GRS adds geo-replication charges; object replication bills for the data copied", "Retrieving from Archive is billed and takes hours"],
  armParams: (p: Lecheria) => ({ redundancy: p.redundancy, includeReplica: p.includeReplica }),
  regionFree: ["Microsoft.Storage/storageAccounts/managementPolicies"],
  content: [{ kind: "blob-upload", label: "Milk collection reports and example contracts", accountOutput: "storageAccount", container: "documentos", source: { generator: "dairy-docs" } }],
  timingKey: (p: Lecheria) => `${p.redundancy}/${p.includeReplica ? "replica" : "single"}`,
  stages: () => [{ label: "Deploy" }],
  presets: [
    { label: "Cheapest", params: { redundancy: "LRS", includeReplica: false } },
    { label: "Full demo", params: { redundancy: "GRS", includeReplica: true } },
  ],
  alternatives: (p: Lecheria) => (p.redundancy === "GRS" ? [{ params: { redundancy: "LRS" } as Partial<Lecheria>, loses: "Protection against the loss of a whole region" }] : []),
  scenario: {
    story:
      "A dairy cooperative in Zona Norte stores the daily milk collection reports and its producers' contracts in Azure Storage. A producer's assistant asks for access to one contract, the office wants only its own network to reach the account, and the manager wants a copy of the files in a second account in case someone deletes something by mistake. The documents are synthetic and the cooperative is fictional.",
    objectives: [
      "Create a SAS token and a stored access policy, and explain why they are safer than handing out an account key",
      "Rotate an access key and see what stops working",
      "Turn on the firewall for selected networks and see the portal, a laptop and the office subnet get different answers",
      "Recover a deleted blob and an earlier version, and take a share snapshot of the Azure Files share",
      "Set up object replication to the second account, and read the lifecycle rule that moves old documents to Cool and Archive",
    ],
    exams: [
      "AZ-104: configure access to storage (firewalls and virtual networks, SAS tokens, stored access policies, access keys)",
      "AZ-104: configure and manage storage accounts (redundancy, object replication, encryption, Storage Explorer and AzCopy)",
      "AZ-104: configure Azure Files and Blob Storage (tiers, soft delete, snapshots, lifecycle management, versioning)",
    ],
  },
};
