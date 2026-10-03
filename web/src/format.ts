export const usd = (n?: number, digits = 2) =>
  n === undefined || Number.isNaN(n) ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });

export const usd0 = (n?: number) => usd(n, 0);

export function relTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - now;
  const abs = Math.abs(ms);
  const m = Math.round(abs / 60_000);
  if (m < 1) return "just now";
  const text = m < 60 ? `${m}m` : m < 48 * 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.round(m / 1440)}d`;
  return ms >= 0 ? `in ${text}` : `${text} ago`;
}

const TYPE_LABELS: Record<string, string> = {
  "microsoft.network/azurefirewalls": "Firewall",
  "microsoft.network/firewallpolicies": "Firewall policy",
  "microsoft.network/applicationgateways": "App Gateway",
  "microsoft.network/applicationgatewaywebapplicationfirewallpolicies": "WAF policy",
  "microsoft.apimanagement/service": "API Management",
  "microsoft.network/publicipaddresses": "Public IP",
  "microsoft.network/networksecuritygroups": "NSG",
  "microsoft.network/routetables": "Route table",
  "microsoft.network/virtualnetworks": "VNet",
  "microsoft.network/networkinterfaces": "NIC",
  "microsoft.network/networkwatchers": "Network Watcher",
  "microsoft.network/privatednszones": "Private DNS",
  "microsoft.network/privateendpoints": "Private endpoint",
  "microsoft.network/bastionhosts": "Bastion",
  "microsoft.network/virtualnetworkgateways": "VNet gateway",
  "microsoft.network/natgateways": "NAT gateway",
  "microsoft.network/loadbalancers": "Load balancer",
  "microsoft.network/frontdoors": "Front Door",
  "microsoft.cdn/profiles": "Front Door / CDN",
  "microsoft.compute/virtualmachines": "VM",
  "microsoft.compute/disks": "Disk",
  "microsoft.compute/snapshots": "Snapshot",
  "microsoft.containerservice/managedclusters": "AKS",
  "microsoft.web/serverfarms": "App Service plan",
  "microsoft.web/sites": "App Service",
  "microsoft.storage/storageaccounts": "Storage",
  "microsoft.keyvault/vaults": "Key Vault",
  "microsoft.operationalinsights/workspaces": "Log Analytics",
  "microsoft.insights/components": "App Insights",
  "microsoft.insights/webtests": "Availability test",
  "microsoft.insights/actiongroups": "Action group",
  "microsoft.insights/autoscalesettings": "Autoscale",
  "microsoft.managedidentity/userassignedidentities": "Managed identity",
  "microsoft.eventgrid/systemtopics": "Event Grid topic",
  "microsoft.resources/resourcegroups": "Resource group",
};

export function typeLabel(type: string): string {
  return TYPE_LABELS[type.toLowerCase()] ?? type.split("/").pop() ?? type;
}

export const portalUrl = (id: string, tenantId?: string) =>
  `https://portal.azure.com/${tenantId ? `#@${tenantId}` : "#"}/resource${id}`;
