import { z } from "zod";
import { flag } from "../kit.ts";
import type { Blueprint } from "../blueprints.ts";

const municipioSchema = z.object({
  appTier: z.enum(["F1", "B1"]).default("F1"),
  appHasAccess: flag(true),
});
type Municipio = z.infer<typeof municipioSchema>;

export const municipio: Blueprint<any> = {
  id: "cr-municipio-accesos",
  category: "Showcase",
  title: "Municipalidad de Grecia: who can do what",
  tagline: "Roles at three scopes, and a web app that reads a report with its managed identity only while it has the role",
  code: "cmuni",
  deployMinutes: [3, 6],
  icons: ["Microsoft.ManagedIdentity/userAssignedIdentities", "Microsoft.Authorization/roleAssignments", "Microsoft.Storage/storageAccounts", "Microsoft.Web/sites"],
  fields: [
    {
      key: "appTier",
      label: "App Service plan",
      kind: "select",
      options: [
        { value: "F1", label: "Free (F1)" },
        { value: "B1", label: "Basic (B1)" },
      ],
      default: "F1",
    },
    { key: "appHasAccess", label: "Web app starts with read access to the reports", kind: "toggle", default: true },
  ],
  schema: municipioSchema,
  steps: () => [
    { name: "identities", label: "Three identities (audit, operations, data)", type: "Microsoft.ManagedIdentity/userAssignedIdentities" },
    { name: "storage", label: "Storage account with the reports container", type: "Microsoft.Storage/storageAccounts" },
    { name: "app", label: "Web app with its own identity", type: "Microsoft.Web/sites" },
    { name: "roles", label: "Role assignments at group, resource and container scope", type: "Microsoft.Authorization/roleAssignments" },
  ],
  // Identities, role assignments and idle storage are free.
  meters: (p: Municipio) => [
    { label: "Identities and role assignments (free)", serviceName: "Azure Role Based Access Control", skuName: "Free", meterName: "Free", unitsPerHour: 1, fixedHourly: 0 },
    { label: "Storage (idle)", serviceName: "Storage", skuName: "Standard", meterName: "Standard", unitsPerHour: 1, fixedHourly: 0 },
    p.appTier === "F1"
      ? { label: "App Service Free", serviceName: "Azure App Service", skuName: "F1", meterName: "F1", unitsPerHour: 1, fixedHourly: 0 }
      : { label: "App Service Basic B1", serviceName: "Azure App Service", productName: "Azure App Service Basic Plan - Linux", skuName: "B1", meterName: "B1", unitsPerHour: 1 },
  ],
  notes: ["Needs Owner or User Access Administrator on the subscription to create role assignments", "Role changes can take a few minutes to reach the web app"],
  armParams: (p: Municipio) => ({ appTier: p.appTier, appHasAccess: p.appHasAccess }),
  extraTypes: ["Microsoft.Web/serverfarms"],
  regionFree: ["Microsoft.Authorization/roleAssignments"],
  content: [{ kind: "blob-upload", label: "Water report (example)", accountOutput: "storageAccount", container: "informes", source: { generator: "municipal-report" } }],
  timingKey: (p: Municipio) => p.appTier,
  stages: () => [{ label: "Deploy", gate: { kind: "http-ok", label: "Web app answers", timeoutMin: 10, blocking: false } }],
  presets: [
    { label: "Allowed", params: { appTier: "F1", appHasAccess: true } },
    { label: "Denied (class adds the role)", params: { appTier: "F1", appHasAccess: false } },
  ],
  scenario: {
    story:
      "The Municipalidad de Grecia (fictional) lets three groups work in one Azure subscription: auditors who only look, operations staff who manage the storage account, and a data team that reads and writes the water reports. The mayor asks who exactly can do what, and why the internal reports page stopped working after someone cleaned up permissions. The three groups are stand-in identities, and the page uses its own managed identity instead of a key.",
    objectives: [
      "Assign a built-in role at resource group, resource and container scope, and say what each scope includes",
      "Read the IAM blade: role assignments, Check access and the effective permissions of one identity",
      "Tell control-plane roles (Contributor) from data-plane roles (Storage Blob Data Reader) with a real failure",
      "Remove and re-add the web app's role and watch access disappear and return, then explain least privilege and Zero Trust",
      "Explain managed identities, and why they beat keys and passwords in code",
    ],
    exams: [
      "AZ-900: Azure role-based access control, Zero Trust and defense in depth",
      "AZ-104: manage access to Azure resources (built-in roles, assign roles at different scopes, interpret access assignments)",
    ],
  },
};
