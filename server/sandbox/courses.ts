/**
 * What a student may do, per course, derived from what Microsoft's own labs deploy (docs/learn-labs/).
 * Only AZ-900 exists for now; AZ-104 and AI-901 need bigger answers (quota, role assignments, models): see docs/student-sandbox.md.
 */

export interface CoursePack {
  id: string;
  title: string;
  /** Default lifetime of a sandbox, in days. */
  ttlDays: number;
  /** Monthly budget on the student's group, in USD (alerts the admins; it does not stop spending). */
  budgetUsd: number;
  /** The only regions resources may be created in (the labs name Central US for locks, and "a region available to you" elsewhere). */
  allowedLocations: string[];
  /** Resource types the labs do not use that are costly or slow to remove. */
  blockedTypes: string[];
  /** Group names the lab text hard-codes, which the student replaces with their own group. */
  labGroupNames: string[];
}

export const AZ900: CoursePack = {
  id: "az-900",
  title: "AZ-900 Azure Fundamentals",
  ttlDays: 14,
  budgetUsd: 25,
  // Every lab is a portal exercise: a resource group, a VM, a storage account, a lock. East and Central US cover them.
  allowedLocations: ["centralus", "eastus", "eastus2", "westus", "westus2", "westus3", "southcentralus", "northcentralus"],
  blockedTypes: [
    "Microsoft.Network/applicationGateways",
    "Microsoft.Network/azureFirewalls",
    "Microsoft.Network/bastionHosts",
    "Microsoft.Network/virtualNetworkGateways",
    "Microsoft.Network/expressRouteCircuits",
    "Microsoft.Network/frontDoors",
    "Microsoft.Cdn/profiles",
    "Microsoft.Compute/virtualMachineScaleSets",
    "Microsoft.ContainerService/managedClusters",
    "Microsoft.RedHatOpenShift/openShiftClusters",
    "Microsoft.Sql/servers",
    "Microsoft.DBforPostgreSQL/flexibleServers",
    "Microsoft.DBforMySQL/flexibleServers",
    "Microsoft.DocumentDB/databaseAccounts",
    "Microsoft.Databricks/workspaces",
    "Microsoft.Synapse/workspaces",
    "Microsoft.Kusto/clusters",
    "Microsoft.MachineLearningServices/workspaces",
    "Microsoft.CognitiveServices/accounts",
    "Microsoft.ApiManagement/service",
  ],
  labGroupNames: ["IntroAzureRG"],
};

export const COURSES: Record<string, CoursePack> = { [AZ900.id]: AZ900 };

export function getCourse(id: string): CoursePack {
  const c = COURSES[id];
  if (!c) throw new Error(`Unknown course ${id}. Available: ${Object.keys(COURSES).join(", ")}`);
  return c;
}
