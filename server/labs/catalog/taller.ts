import { z } from "zod";
import { flag } from "../kit.ts";
import type { Blueprint } from "../blueprints.ts";

const tallerSchema = z.object({
  vmSize: z.enum(["Standard_B1s", "Standard_B1ms", "Standard_B2s"]).default("Standard_B1s"),
  paasTier: z.enum(["F1", "B1"]).default("F1"),
  autoShutdown: flag(true),
});
type Taller = z.infer<typeof tallerSchema>;

export const taller: Blueprint<any> = {
  id: "cr-taller-servidores",
  category: "Showcase",
  title: "Taller Los Ángeles: servers (IaaS vs PaaS)",
  tagline: "The same appointment page on a virtual machine and on App Service, side by side",
  code: "ctall",
  deployMinutes: [4, 9],
  icons: ["Microsoft.Compute/virtualMachines", "Microsoft.Web/sites", "Microsoft.Network/networkSecurityGroups"],
  fields: [
    {
      key: "vmSize",
      label: "VM size",
      kind: "select",
      options: [
        { value: "Standard_B1s", label: "B1s (1 vCPU, 1 GB)" },
        { value: "Standard_B1ms", label: "B1ms (1 vCPU, 2 GB)" },
        { value: "Standard_B2s", label: "B2s (2 vCPU, 4 GB)" },
      ],
      default: "Standard_B1s",
    },
    {
      key: "paasTier",
      label: "App Service plan",
      kind: "select",
      options: [
        { value: "F1", label: "Free (F1)" },
        { value: "B1", label: "Basic (B1)" },
      ],
      default: "F1",
    },
    { key: "autoShutdown", label: "Shut the VM down every night", kind: "toggle", default: true },
  ],
  schema: tallerSchema,
  steps: () => [
    { name: "network", label: "Network, firewall rules and public IP", type: "Microsoft.Network/networkSecurityGroups" },
    { name: "vm", label: "Virtual machine (IaaS)", type: "Microsoft.Compute/virtualMachines" },
    { name: "paas", label: "App Service (PaaS)", type: "Microsoft.Web/sites" },
  ],
  meters: (p: Taller) => {
    const size = p.vmSize.replace("Standard_", "");
    return [
      { label: `VM ${size}`, serviceName: "Virtual Machines", productName: "Virtual Machines BS Series", skuName: size, meterName: size, unitsPerHour: 1 },
      // $2.40 per month (E4, 32 GiB): the Retail Prices API lists disks per month, not per hour.
      { label: "Standard SSD disk (30 GB)", serviceName: "Storage", skuName: "E4 LRS", meterName: "E4 LRS Disk", unitsPerHour: 1, fixedHourly: 2.4 / 730 },
      { label: "Public IP", serviceName: "Virtual Network", productName: "IP Addresses", skuName: "Standard", meterName: "Standard IPv4 Static Public IP", unitsPerHour: 1 },
      p.paasTier === "F1"
        ? { label: "App Service Free", serviceName: "Azure App Service", skuName: "F1", meterName: "F1", unitsPerHour: 1, fixedHourly: 0 }
        : { label: "App Service Basic B1", serviceName: "Azure App Service", productName: "Azure App Service Basic Plan - Linux", skuName: "B1", meterName: "B1", unitsPerHour: 1 },
    ];
  },
  notes: ["The estimate assumes the VM runs all the time; the nightly shutdown stops compute charges but not the disk and IP", "Outbound bandwidth beyond the free allowance"],
  armParams: (p: Taller) => ({ vmSize: p.vmSize, paasTier: p.paasTier, autoShutdown: p.autoShutdown }),
  quotas: () => ({ VirtualNetworks: 1, NetworkSecurityGroups: 1, IPv4StandardSkuPublicIpAddresses: 1 }),
  vmSizes: (p: Taller) => [p.vmSize],
  timingKey: (p: Taller) => `${p.vmSize}/${p.paasTier}`,
  paramHooks: [{ fromStage: 0, hook: "vm-password", label: "VM admin password", validateWith: { adminPassword: "Validation-Placeholder-1!" } }],
  // The VM is the slow part (it installs a web server on first boot), so it is what the gate waits for.
  stages: () => [{ label: "Deploy", gate: { kind: "http-ok", label: "VM web page answers", timeoutMin: 15, blocking: false } }],
  alternatives: (p: Taller) => [
    ...(p.vmSize !== "Standard_B1s" ? [{ params: { vmSize: "Standard_B1s" } as Partial<Taller>, loses: "Memory and CPU headroom on the VM" }] : []),
    ...(p.paasTier === "B1" ? [{ params: { paasTier: "F1" } as Partial<Taller>, loses: "Always-on and the Basic plan's capacity (Free sleeps and has a daily CPU quota)" }] : []),
  ],
  presets: [
    { label: "Cheapest", params: { vmSize: "Standard_B1s", paasTier: "F1" } },
    { label: "Roomier", params: { vmSize: "Standard_B2s", paasTier: "B1" } },
  ],
  scenario: {
    story:
      "Taller Los Ángeles is a car repair shop in Alajuela. Its appointment page runs on an old PC under the counter, and when the PC dies, so do the appointments. The owner's nephew says to put it on a server in the cloud. Here the same page runs on a virtual machine you manage and on App Service that Azure manages, so the class can compare them.",
    objectives: [
      "Place IaaS, PaaS and SaaS on a real example and draw the shared-responsibility line for each",
      "List everything a VM needs around it (disk, network interface, public IP, firewall rules) versus a PaaS host",
      "Read a bill by resource and see how tags and auto-shutdown change it",
      "Explain why a stopped VM still costs money",
    ],
    exams: ["AZ-900: cloud concepts (IaaS, PaaS, shared responsibility)", "AZ-900: cost management and tags"],
  },
};
