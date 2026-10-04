/**
 * Resource type -> official Azure icon file (name without the numeric prefix used in the icon set).
 * Shared by the UI and scripts/fetch-icons.ts, which extracts exactly these files.
 */
export const ICON_SLUGS: Record<string, string> = {
  // Networking
  "microsoft.network/azurefirewalls": "Firewalls",
  "microsoft.network/firewallpolicies": "Azure-Firewall-Policy",
  "microsoft.network/applicationgateways": "Application-Gateways",
  "microsoft.network/applicationgatewaywebapplicationfirewallpolicies": "Web-Application-Firewall-Policies(WAF)",
  "microsoft.network/frontdoorwebapplicationfirewallpolicies": "Web-Application-Firewall-Policies(WAF)",
  "microsoft.network/publicipaddresses": "Public-IP-Addresses",
  "microsoft.network/publicipprefixes": "Public-IP-Prefixes",
  "microsoft.network/networksecuritygroups": "Network-Security-Groups",
  "microsoft.network/applicationsecuritygroups": "Application-Security-Groups",
  "microsoft.network/routetables": "Route-Tables",
  "microsoft.network/virtualnetworks": "Virtual-Networks",
  "microsoft.network/networkinterfaces": "Network-Interfaces",
  "microsoft.network/networkwatchers": "Network-Watcher",
  "microsoft.network/privatednszones": "DNS-Zones",
  "microsoft.network/dnszones": "DNS-Zones",
  "microsoft.network/dnsresolvers": "DNS-Private-Resolver",
  "microsoft.network/privateendpoints": "Private-Endpoints",
  "microsoft.network/privatelinkservices": "Private-Link-Service",
  "microsoft.network/bastionhosts": "Bastions",
  "microsoft.network/virtualnetworkgateways": "Virtual-Network-Gateways",
  "microsoft.network/localnetworkgateways": "Local-Network-Gateways",
  "microsoft.network/connections": "Connections",
  "microsoft.network/natgateways": "NAT",
  "microsoft.network/loadbalancers": "Load-Balancers",
  "microsoft.network/frontdoors": "Front-Door-and-CDN-Profiles",
  "microsoft.cdn/profiles": "Front-Door-and-CDN-Profiles",
  "microsoft.network/expressroutecircuits": "ExpressRoute-Circuits",
  "microsoft.network/ipgroups": "IP-Groups",
  "microsoft.network/virtualwans": "Virtual-WANs",
  "microsoft.network/virtualhubs": "Virtual-WAN-Hub",
  "microsoft.network/ddosprotectionplans": "DDoS-Protection-Plans",
  "microsoft.network/serviceendpointpolicies": "Service-Endpoint-Policies",
  // Integration / web
  "microsoft.apimanagement/service": "API-Management-Services",
  "microsoft.web/serverfarms": "App-Service-Plans",
  "microsoft.web/sites": "App-Services",
  "microsoft.web/sites#functionapp": "Function-Apps",
  "microsoft.web/staticsites": "Static-Apps",
  "microsoft.web/connections": "API-Connections",
  "microsoft.eventgrid/systemtopics": "System-Topic",
  "microsoft.eventgrid/topics": "Event-Grid-Topics",
  "microsoft.eventgrid/domains": "Event-Grid-Domains",
  // Compute / containers
  "microsoft.compute/virtualmachines": "Virtual-Machine",
  "microsoft.compute/disks": "Disks",
  "microsoft.compute/snapshots": "Disks-Snapshots",
  "microsoft.compute/availabilitysets": "Availability-Sets",
  "microsoft.containerservice/managedclusters": "Kubernetes-Services",
  "microsoft.app/containerapps": "Worker-Container-App",
  "microsoft.app/managedenvironments": "Container-Apps-Environments",
  "microsoft.containerregistry/registries": "Container-Registries",
  "microsoft.containerinstance/containergroups": "Container-Instances",
  // Backup
  "microsoft.recoveryservices/vaults": "Recovery-Services-Vaults",
  "microsoft.dataprotection/backupvaults": "Backup-Vault",
  // Data / security / identity
  "microsoft.storage/storageaccounts": "Storage-Accounts",
  "microsoft.keyvault/vaults": "Key-Vaults",
  "microsoft.documentdb/databaseaccounts": "Azure-Cosmos-DB",
  "microsoft.sql/servers/databases": "SQL-Database",
  "microsoft.managedidentity/userassignedidentities": "Managed-Identities",
  // Data, AI and governance (the training catalog's labs). Child resources share their parent's icon; the pack has no
  // icon for locks or role assignments, so those keep the letter-tile fallback.
  "microsoft.sql/servers": "SQL-Server",
  "microsoft.synapse/workspaces": "Azure-Synapse-Analytics",
  // The AI labs' accounts are Foundry resources (kind AIServices), so they use the Foundry icons from the July 2026 release.
  "microsoft.cognitiveservices/accounts": "AI-Foundry",
  "microsoft.cognitiveservices/accounts/projects": "Foundry-Project",
  "microsoft.cognitiveservices/accounts/deployments": "Foundry-Models",
  "microsoft.search/searchservices": "Cognitive-Search",
  "microsoft.machinelearningservices/workspaces": "Machine-Learning",
  "microsoft.machinelearningservices/workspaces/computes": "Machine-Learning",
  "microsoft.authorization/policyassignments": "Policy",
  "microsoft.consumption/budgets": "Cost-Budgets",
  "microsoft.storage/storageaccounts/managementpolicies": "Storage-Accounts",
  "microsoft.insights/diagnosticsettings": "Diagnostics-Settings",
  // Monitoring
  "microsoft.operationalinsights/workspaces": "Log-Analytics-Workspaces",
  "microsoft.insights/components": "Application-Insights",
  "microsoft.insights/webtests": "Web-Test",
  "microsoft.insights/actiongroups": "Alerts",
  "microsoft.insights/activitylogalerts": "Alerts",
  "microsoft.insights/metricalerts": "Alerts",
  "microsoft.insights/scheduledqueryrules": "Alerts",
  "microsoft.alertsmanagement/actionrules": "Alerts",
  "microsoft.insights/autoscalesettings": "Monitor",
  "microsoft.insights/datacollectionrules": "Data-Collection-Rules",
  "microsoft.insights/workbooks": "Workbooks",
  "microsoft.dashboard/grafana": "Azure-Managed-Grafana",
  // Containers of everything
  "microsoft.resources/resourcegroups": "Resource-Groups",
  "microsoft.resources/subscriptions": "Subscriptions",
};

export function iconSlugFor(type: string, kind?: string): string | undefined {
  const t = type.toLowerCase();
  if (t === "microsoft.web/sites" && kind?.toLowerCase().includes("functionapp")) return ICON_SLUGS["microsoft.web/sites#functionapp"];
  return ICON_SLUGS[t];
}
