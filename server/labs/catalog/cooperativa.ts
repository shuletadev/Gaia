import { z } from "zod";
import { flag } from "../kit.ts";
import type { Blueprint } from "../blueprints.ts";

const coopSchema = z.object({
  allowedRegions: z.enum(["one", "us"]).default("us"),
  requireTag: flag(true),
  restrictStorage: flag(true),
  enforce: flag(true),
  budgetUsd: z.coerce.number().int().min(5).max(500).default(20),
});
type Coop = z.infer<typeof coopSchema>;

export const cooperativa: Blueprint<any> = {
  id: "cr-cooperativa-gobierno",
  category: "Showcase",
  title: "Cooperativa: governance",
  tagline: "Policies, a delete lock, a budget and cost-center tags on three departments' storage",
  code: "ccoop",
  deployMinutes: [2, 5],
  icons: ["Microsoft.Authorization/policyAssignments", "Microsoft.Storage/storageAccounts", "Microsoft.Consumption/budgets"],
  fields: [
    {
      key: "allowedRegions",
      label: "Allowed regions",
      kind: "select",
      options: [
        { value: "us", label: "Five main US regions" },
        { value: "one", label: "Only the lab's region" },
      ],
      default: "us",
    },
    { key: "requireTag", label: "Require a centroCosto tag", kind: "toggle", default: true },
    { key: "restrictStorage", label: "Only Standard_LRS storage", kind: "toggle", default: true },
    { key: "enforce", label: "Enforce (deny), not just report", kind: "toggle", default: true },
    { key: "budgetUsd", label: "Monthly budget (USD)", kind: "int", min: 5, max: 500, default: 20 },
  ],
  schema: coopSchema,
  steps: () => [
    { name: "storage", label: "Department storage accounts and delete lock", type: "Microsoft.Storage/storageAccounts" },
    { name: "policies", label: "Policy assignments", type: "Microsoft.Authorization/policyAssignments" },
    { name: "budget", label: "Monthly budget with alerts", type: "Microsoft.Consumption/budgets" },
  ],
  // Policies, locks and budgets are free; three idle storage accounts cost pennies a month.
  meters: () => [
    { label: "Policy, locks and budget (free)", serviceName: "Azure Policy", skuName: "Free", meterName: "Free", unitsPerHour: 1, fixedHourly: 0 },
    { label: "Storage (idle)", serviceName: "Storage", skuName: "Standard", meterName: "Standard", unitsPerHour: 1, fixedHourly: 0 },
  ],
  notes: ["Storage capacity and operations (nothing is stored by default)"],
  armParams: (p: Coop, ctx) => ({
    allowedRegions: p.allowedRegions,
    requireTag: p.requireTag,
    restrictStorage: p.restrictStorage,
    enforce: p.enforce,
    budgetUsd: p.budgetUsd,
    contactEmail: ctx.owner,
  }),
  // These types are not regional; the lock type is created by the template but is not a step.
  regionFree: ["Microsoft.Authorization/policyAssignments", "Microsoft.Consumption/budgets"],
  extraTypes: ["Microsoft.Authorization/locks"],
  timingKey: (p: Coop) => (p.enforce ? "enforce" : "report"),
  // Assignments are evaluated for new resources within minutes, but existing compliance can take up to about 30.
  stages: () => [{ label: "Deploy" }],
  presets: [
    { label: "Strict", params: { enforce: true, requireTag: true, restrictStorage: true, allowedRegions: "one" } },
    { label: "Report only", params: { enforce: false } },
  ],
  scenario: {
    story:
      "A savings cooperative in San Ramón has three departments sharing one Azure subscription. Last month someone created a large server in the wrong region and nobody noticed until the bill arrived. The manager wants rules, protection for the accounting data, and an alert before the money runs out.",
    objectives: [
      "Assign a policy and watch it block a non-compliant resource (allowed regions, required tag, allowed storage SKU)",
      "Protect a resource with a delete lock and see what it prevents",
      "Create a budget with alerts and group costs by tag",
      "Explain the difference between enforcing a policy and only reporting compliance",
    ],
    exams: ["AZ-900: management and governance (Azure Policy, resource locks, tags)", "AZ-900: cost management (budgets, cost analysis)"],
  },
};
