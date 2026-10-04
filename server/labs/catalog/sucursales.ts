import { z } from "zod";
import { flag } from "../kit.ts";
import type { Blueprint } from "../blueprints.ts";

const sucursalesSchema = z.object({
  vmSize: z.enum(["Standard_B1s", "Standard_B1ms"]).default("Standard_B1s"),
  clientVm: flag(true),
});
type Sucursales = z.infer<typeof sucursalesSchema>;

const vmCount = (p: Sucursales) => (p.clientVm ? 3 : 2);

export const sucursales: Blueprint<any> = {
  id: "cr-sucursales-red",
  category: "Showcase",
  title: "Branch network (AZ-104)",
  tagline: "Hub and spokes with peering, a load balancer over two servers, NSGs and private DNS",
  code: "csucur",
  deployMinutes: [8, 15],
  icons: ["Microsoft.Network/virtualNetworks", "Microsoft.Network/loadBalancers", "Microsoft.Compute/virtualMachines"],
  fields: [
    {
      key: "vmSize",
      label: "VM size",
      kind: "select",
      options: [
        { value: "Standard_B1s", label: "B1s (1 vCPU, 1 GB)" },
        { value: "Standard_B1ms", label: "B1ms (1 vCPU, 2 GB)" },
      ],
      default: "Standard_B1s",
    },
    { key: "clientVm", label: "Add a client VM in the Grecia branch", kind: "toggle", default: true },
  ],
  schema: sucursalesSchema,
  steps: (p: Sucursales) => [
    { name: "network", label: "Networks, peering, NSGs and private DNS", type: "Microsoft.Network/virtualNetworks" },
    { name: "web", label: "Load balancer and two web servers", type: "Microsoft.Network/loadBalancers" },
    ...(p.clientVm ? [{ name: "client", label: "Client VM in the Grecia branch", type: "Microsoft.Compute/virtualMachines" }] : []),
  ],
  meters: (p: Sucursales) => {
    const size = p.vmSize.replace("Standard_", "");
    return [
      { label: `VMs ${size}`, serviceName: "Virtual Machines", productName: "Virtual Machines BS Series", skuName: size, meterName: size, unitsPerHour: vmCount(p) },
      // $2.40 per month each (E4, 32 GiB); the Retail Prices API lists disks per month.
      { label: "Standard SSD disks (30 GB)", serviceName: "Storage", skuName: "E4 LRS", meterName: "E4 LRS Disk", unitsPerHour: vmCount(p), fixedHourly: 2.4 / 730 },
      { label: "Public IP (load balancer)", serviceName: "Virtual Network", productName: "IP Addresses", skuName: "Standard", meterName: "Standard IPv4 Static Public IP", unitsPerHour: 1 },
      // Global meter: the first five rules are included.
      { label: "Standard load balancer", serviceName: "Load Balancer", skuName: "Standard", meterName: "Standard Included LB Rules and Outbound Rules", armRegion: "Global", unitsPerHour: 1 },
    ];
  },
  notes: ["Data processed by the load balancer (per GB) and outbound data transfer", "Peering between networks in the same region is billed per GB of traffic"],
  armParams: (p: Sucursales) => ({ vmSize: p.vmSize, clientVm: p.clientVm }),
  quotas: () => ({ VirtualNetworks: 3, NetworkSecurityGroups: 2, IPv4StandardSkuPublicIpAddresses: 1 }),
  vmSizes: (p: Sucursales) => [p.vmSize],
  paramHooks: [{ fromStage: 0, hook: "vm-password", label: "VM admin password", validateWith: { adminPassword: "Validation-Placeholder-1!" } }],
  // Private DNS zones are global; availability sets and load balancers follow the region.
  extraTypes: ["Microsoft.Network/privateDnsZones", "Microsoft.Compute/availabilitySets", "Microsoft.Network/networkSecurityGroups"],
  regionFree: ["Microsoft.Network/privateDnsZones"],
  timingKey: (p: Sucursales) => `${p.vmSize}/${p.clientVm}`,
  stages: () => [{ label: "Deploy", gate: { kind: "http-ok", label: "Load balancer answers", timeoutMin: 15, blocking: false } }],
  presets: [
    { label: "With client (full exercise)", params: { clientVm: true } },
    { label: "Servers only (cheaper)", params: { clientVm: false } },
  ],
  alternatives: (p: Sucursales) => [
    ...(p.clientVm ? [{ params: { clientVm: false } as Partial<Sucursales>, loses: "The client VM: no way to test spoke-to-spoke traffic from the Grecia branch" }] : []),
    ...(p.vmSize !== "Standard_B1s" ? [{ params: { vmSize: "Standard_B1s" } as Partial<Sucursales> , loses: "Memory on every VM" }] : []),
  ],
  scenario: {
    story:
      "A savings cooperative has a head office in San Ramón and branches in Grecia and Naranjo. Branch staff must reach the central web system and nothing else, and the system must keep working when one server fails or is being updated. The class builds and inspects the network: a hub, two spokes, peering, security rules, a load balancer and private names.",
    objectives: [
      "Plan address ranges that do not overlap, and peer a hub to two spokes",
      "Explain why peering is not transitive and test that two spokes cannot reach each other",
      "Control traffic with network security group rules and read the effective rules",
      "See a Standard load balancer spread requests, and a failed server drop out of rotation",
      "Resolve servers by private DNS name from another network",
    ],
    exams: ["AZ-104: implement and manage virtual networking (VNets, peering, NSGs, load balancing, private DNS)", "AZ-104: deploy and manage Azure compute resources (virtual machines, availability sets)"],
  },
};
