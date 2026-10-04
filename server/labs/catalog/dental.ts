import { z } from "zod";
import { flag } from "../kit.ts";
import type { Blueprint } from "../blueprints.ts";

const dentalSchema = z.object({
  vaultRedundancy: z.enum(["LocallyRedundant", "GeoRedundant"]).default("LocallyRedundant"),
  protectVm: flag(true),
  retentionDays: z.coerce.number().int().min(1).max(30).default(7),
});
type Dental = z.infer<typeof dentalSchema>;

export const dental: Blueprint<any> = {
  id: "cr-dental-respaldo",
  category: "Showcase",
  title: "Clínica Dental Sonrisa: backup and recovery",
  tagline: "A server protected by a Recovery Services vault and a daily policy, plus a Backup vault to compare",
  code: "cdent",
  deployMinutes: [5, 10],
  icons: ["Microsoft.RecoveryServices/vaults", "Microsoft.Compute/virtualMachines", "Microsoft.DataProtection/backupVaults"],
  fields: [
    {
      key: "vaultRedundancy",
      label: "Where backup copies are kept",
      kind: "select",
      options: [
        { value: "LocallyRedundant", label: "Locally redundant (cheapest)" },
        { value: "GeoRedundant", label: "Geo-redundant (also a paired region)" },
      ],
      default: "LocallyRedundant",
    },
    { key: "protectVm", label: "Protect the server at deployment", kind: "toggle", default: true },
    { key: "retentionDays", label: "Days a restore point is kept", kind: "int", min: 1, max: 30, default: 7 },
  ],
  schema: dentalSchema,
  steps: () => [
    { name: "server", label: "Server (virtual machine, network and public IP)", type: "Microsoft.Compute/virtualMachines" },
    { name: "vault", label: "Recovery Services vault, daily policy and protection", type: "Microsoft.RecoveryServices/vaults" },
  ],
  meters: (p: Dental) => [
    { label: "VM B1s", serviceName: "Virtual Machines", productName: "Virtual Machines BS Series", skuName: "B1s", meterName: "B1s", unitsPerHour: 1 },
    // $2.40 per month (E4, 32 GiB): the Retail Prices API lists disks per month, not per hour.
    { label: "Standard SSD disk (30 GB)", serviceName: "Storage", skuName: "E4 LRS", meterName: "E4 LRS Disk", unitsPerHour: 1, fixedHourly: 2.4 / 730 },
    { label: "Public IP", serviceName: "Virtual Network", productName: "IP Addresses", skuName: "Standard", meterName: "Standard IPv4 Static Public IP", unitsPerHour: 1 },
    // Azure Backup bills a protected instance (under 50 GB) at $10 a month, plus the backup storage it uses.
    { label: p.protectVm ? "Backup protected instance (VM, $10/month)" : "Backup protected instance (none yet)", serviceName: "Backup", skuName: "Azure VM", meterName: "Azure VM Protected Instance", unitsPerHour: 1, fixedHourly: p.protectVm ? 10 / 730 : 0 },
  ],
  notes: ["Backup storage grows with each restore point kept (about $0.02 per GB-month, locally redundant)", "Geo-redundant vaults cost about twice as much per GB", "The estimate assumes the server runs all the time"],
  armParams: (p: Dental) => ({ vaultRedundancy: p.vaultRedundancy, protectVm: p.protectVm, retentionDays: p.retentionDays }),
  extraTypes: ["Microsoft.Network/publicIPAddresses", "Microsoft.Network/networkSecurityGroups"],
  quotas: () => ({ VirtualNetworks: 1, NetworkSecurityGroups: 1, IPv4StandardSkuPublicIpAddresses: 1 }),
  vmSizes: () => ["Standard_B1s"],
  timingKey: (p: Dental) => `${p.protectVm ? "protected" : "plain"}`,
  paramHooks: [{ fromStage: 0, hook: "vm-password", label: "VM admin password", validateWith: { adminPassword: "Validation-Placeholder-1!" } }],
  stages: () => [{ label: "Deploy" }],
  presets: [
    { label: "Cheapest", params: { vaultRedundancy: "LocallyRedundant", protectVm: false, retentionDays: 7 } },
    { label: "Class demo", params: { vaultRedundancy: "LocallyRedundant", protectVm: true, retentionDays: 7 } },
  ],
  alternatives: (p: Dental) => (p.vaultRedundancy === "GeoRedundant" ? [{ params: { vaultRedundancy: "LocallyRedundant" } as Partial<Dental>, loses: "A copy of the backups in the paired region" }] : []),
  scenario: {
    story:
      "Clínica Dental Sonrisa in Cartago keeps its appointment list and patient files on one small server. Last winter a power surge corrupted the disk and the receptionist re-typed two weeks of appointments from paper. The owner wants automatic daily copies she can restore from, and to know what happens if the whole building floods. All files here are examples; no real patients exist.",
    objectives: [
      "Explain what a Recovery Services vault, a backup policy and a restore point are, and how a Backup vault differs",
      "Run a backup on demand, follow the job and read the backup report and alerts",
      "Delete a file on the server and recover it from a restore point (file recovery) or restore the whole disk",
      "Choose between locally redundant and geo-redundant backups and explain the cost and the cross-region restore trade-off",
      "Describe what Azure Site Recovery adds (replication to another region and failover), and why it is a separate decision",
    ],
    exams: ["AZ-104: implement backup and recovery (Recovery Services vault, Backup vault, backup policies, backup and restore, Site Recovery, backup reports and alerts)"],
  },
};
