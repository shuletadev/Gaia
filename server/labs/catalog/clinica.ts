import { z } from "zod";
import { flag } from "../kit.ts";
import type { Blueprint } from "../blueprints.ts";

const clinicaSchema = z.object({ networkLockdown: flag(true), auditLogs: flag(true) });
type Clinica = z.infer<typeof clinicaSchema>;

export const clinica: Blueprint<any> = {
  id: "cr-clinica-seguridad",
  category: "Showcase",
  title: "Clínica: protecting data",
  tagline: "Key Vault with RBAC and audit logs, a firewall, locked-down storage and an app identity",
  code: "cclin",
  deployMinutes: [3, 7],
  icons: ["Microsoft.KeyVault/vaults", "Microsoft.Network/networkSecurityGroups", "Microsoft.Storage/storageAccounts"],
  fields: [
    { key: "networkLockdown", label: "Lock down the records storage", kind: "toggle", default: true },
    { key: "auditLogs", label: "Send Key Vault audit logs to Log Analytics", kind: "toggle", default: true },
  ],
  schema: clinicaSchema,
  steps: () => [
    { name: "network", label: "Network and security group", type: "Microsoft.Network/networkSecurityGroups" },
    { name: "storage", label: "Patient-records storage", type: "Microsoft.Storage/storageAccounts" },
    { name: "monitor", label: "Log Analytics workspace", type: "Microsoft.OperationalInsights/workspaces" },
    { name: "vault", label: "Key Vault and secret", type: "Microsoft.KeyVault/vaults" },
    { name: "identity", label: "App identity and its role", type: "Microsoft.ManagedIdentity/userAssignedIdentities" },
  ],
  // Key Vault bills per operation, Log Analytics per GB beyond a free allowance, and the rest is free: pennies while idle.
  meters: () => [
    { label: "Key Vault, Log Analytics, storage (idle)", serviceName: "Key Vault", skuName: "Standard", meterName: "Operations", unitsPerHour: 1, fixedHourly: 0 },
    { label: "Network security group and virtual network (free)", serviceName: "Virtual Network", skuName: "Standard", meterName: "Free", unitsPerHour: 1, fixedHourly: 0 },
  ],
  notes: ["Key Vault operations (per 10,000)", "Log Analytics ingestion beyond the free allowance (capped at 1 GB/day by the lab)", "Do not enable paid Defender for Cloud plans: the lab uses the free posture view only"],
  armParams: (p: Clinica) => ({ networkLockdown: p.networkLockdown, auditLogs: p.auditLogs }),
  // The role assignment needs Owner or User Access Administrator; the preflight checks it. Roles and diagnostic settings are not regional.
  extraTypes: ["Microsoft.Authorization/roleAssignments", "Microsoft.Insights/diagnosticSettings"],
  regionFree: ["Microsoft.Authorization/roleAssignments", "Microsoft.Insights/diagnosticSettings"],
  timingKey: (p: Clinica) => `${p.networkLockdown}/${p.auditLogs}`,
  stages: () => [{ label: "Deploy" }],
  presets: [
    { label: "Locked down", params: { networkLockdown: true, auditLogs: true } },
    { label: "Open (for comparison)", params: { networkLockdown: false, auditLogs: false } },
  ],
  scenario: {
    story:
      "A private clinic in Cartago keeps appointment records and a database connection string in a shared document on a laptop. Last month a former employee still had access. The owner wants to know what \"secure\" would mean without hiring a security team: who can read what, what can reach the network, and who looked at a secret and when.",
    objectives: [
      "Explain defense in depth with layers students can point to: identity, network, data and monitoring",
      "Keep a secret in Key Vault and grant read access with a role instead of a password in a file",
      "Read a network security group and say what it allows and why",
      "Read the Defender for Cloud recommendations and secure score, and prioritize three",
      "Find in the audit log who accessed a secret",
    ],
    exams: ["SC-900: security solutions (network security groups, Defender for Cloud, key management, logging)", "SC-900: security concepts (defense in depth, shared responsibility, Zero Trust)", "AZ-900: identity, access and security (RBAC, defense in depth)"],
  },
};
