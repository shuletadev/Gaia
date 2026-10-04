import { z } from "zod";
import type { Blueprint } from "../blueprints.ts";

const repartosSchema = z.object({
  registrySku: z.enum(["Basic", "Standard"]).default("Basic"),
  minReplicas: z.coerce.number().int().min(0).max(1).default(0),
  maxReplicas: z.coerce.number().int().min(1).max(5).default(3),
});
type Repartos = z.infer<typeof repartosSchema>;

export const repartos: Blueprint<any> = {
  id: "cr-repartos-contenedores",
  category: "Showcase",
  title: "Repartos Rapidito: containers",
  tagline: "A registry, a container on Container Instances and a container app that scales to zero",
  code: "crepar",
  deployMinutes: [3, 7],
  icons: ["Microsoft.ContainerRegistry/registries", "Microsoft.ContainerInstance/containerGroups", "Microsoft.App/containerApps"],
  fields: [
    {
      key: "registrySku",
      label: "Container registry tier",
      kind: "select",
      options: [
        { value: "Basic", label: "Basic (about $0.17/day)" },
        { value: "Standard", label: "Standard (about $0.67/day)" },
      ],
      default: "Basic",
    },
    { key: "minReplicas", label: "Replicas kept running when idle (0 = scale to zero)", kind: "int", min: 0, max: 1, default: 0 },
    { key: "maxReplicas", label: "Most replicas", kind: "int", min: 1, max: 5, default: 3 },
  ],
  schema: repartosSchema,
  steps: () => [
    { name: "registry", label: "Container registry", type: "Microsoft.ContainerRegistry/registries" },
    { name: "instance", label: "Container group (Container Instances)", type: "Microsoft.ContainerInstance/containerGroups" },
    { name: "app", label: "Environment and container app (Container Apps)", type: "Microsoft.App/containerApps" },
  ],
  // The registry bills a daily fee, the container group bills per second for 0.5 vCPU and 1 GB, and a scale-to-zero app bills only while it handles requests.
  meters: (p: Repartos) => [
    p.registrySku === "Standard"
      ? { label: "Container Registry Standard", serviceName: "Container Registry", skuName: "Standard", meterName: "Standard Registry Unit", unitsPerHour: 1 / 24 }
      : { label: "Container Registry Basic", serviceName: "Container Registry", skuName: "Basic", meterName: "Basic Registry Unit", unitsPerHour: 1 / 24 },
    { label: "Container Instances vCPU (0.5)", serviceName: "Container Instances", productName: "Container Instances", skuName: "Standard", meterName: "Standard vCPU Duration", unitsPerHour: 0.5 },
    { label: "Container Instances memory (1 GB)", serviceName: "Container Instances", productName: "Container Instances", skuName: "Standard", meterName: "Standard Memory Duration", unitsPerHour: 1 },
    { label: p.minReplicas === 0 ? "Container app (scales to zero)" : "Container app (one idle replica)", serviceName: "Azure Container Apps", skuName: "Standard", meterName: "Standard vCPU Idle Usage", unitsPerHour: 1, fixedHourly: p.minReplicas === 0 ? 0 : 0.003 },
  ],
  notes: ["Container Apps bill per request and for the seconds a replica is active; the monthly free grant covers a small demo", "Images stored in the registry bill by size (the demo stores none until the class imports one)"],
  armParams: (p: Repartos) => ({ registrySku: p.registrySku, minReplicas: p.minReplicas, maxReplicas: p.maxReplicas }),
  // Container Instances are not offered in every region.
  extraTypes: ["Microsoft.App/managedEnvironments"],
  timingKey: (p: Repartos) => `${p.registrySku}/${p.minReplicas}`,
  stages: () => [{ label: "Deploy", gate: { kind: "http-ok", label: "Container app answers", timeoutMin: 8, blocking: false } }],
  presets: [
    { label: "Cheapest", params: { registrySku: "Basic", minReplicas: 0, maxReplicas: 2 } },
    { label: "Always on", params: { registrySku: "Standard", minReplicas: 1, maxReplicas: 5 } },
  ],
  alternatives: (p: Repartos) => [
    ...(p.registrySku === "Standard" ? [{ params: { registrySku: "Basic" } as Partial<Repartos>, loses: "Registry throughput and storage included in the tier" }] : []),
    ...(p.minReplicas === 1 ? [{ params: { minReplicas: 0 } as Partial<Repartos>, loses: "A warm replica: the first request after idle waits for a start" }] : []),
  ],
  scenario: {
    story:
      "Repartos Rapidito is a food delivery startup in San José. The developers' order-tracking page works on their laptops and breaks on the server because the machines differ. They put it in a container. Here the class compares the three ways to run one in Azure: a single container that always runs, a container app that grows with demand and sleeps when quiet, and a private registry that stores the images.",
    objectives: [
      "Explain what a container is and how it differs from a virtual machine",
      "Import an image into a container registry and read its repositories and tags",
      "Run the same image on Container Instances and on Container Apps, and compare how each is billed and scaled",
      "Watch a container app scale on HTTP traffic, down to zero and back up, and change the CPU and memory it asks for",
    ],
    exams: [
      "AZ-900: compute types (containers, virtual machines, functions) and application hosting options",
      "AZ-104: provision and manage containers (Container Registry, Container Instances, Container Apps, sizing and scaling)",
    ],
  },
};
