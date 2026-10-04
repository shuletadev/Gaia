import { z } from "zod";
import { flag } from "../kit.ts";
import type { Blueprint } from "../blueprints.ts";

const tourSchema = z.object({
  maxInstances: z.coerce.number().int().min(2).max(3).default(3),
  healthCheck: flag(true),
});
type Tour = z.infer<typeof tourSchema>;

export const tour: Blueprint<any> = {
  id: "cr-tour-escala",
  category: "Showcase",
  title: "Tour operator: scale and uptime",
  tagline: "App Service that grows when busy, a staging slot to update without downtime, and a health check",
  code: "ctour",
  deployMinutes: [4, 8],
  icons: ["Microsoft.Web/sites", "Microsoft.Web/serverfarms", "Microsoft.Insights/components"],
  fields: [
    { key: "maxInstances", label: "Most instances autoscale may add", kind: "int", min: 2, max: 3, default: 3 },
    { key: "healthCheck", label: "Health check on /health", kind: "toggle", default: true },
  ],
  schema: tourSchema,
  steps: () => [
    { name: "monitor", label: "Log Analytics and Application Insights", type: "Microsoft.OperationalInsights/workspaces" },
    { name: "plan", label: "App Service plan and autoscale rules", type: "Microsoft.Web/serverfarms" },
    { name: "app", label: "Web app and staging slot", type: "Microsoft.Web/sites" },
  ],
  // One Standard (S1) instance to start with; autoscale adds more only while the CPU is busy.
  meters: () => [
    { label: "App Service Standard S1 (per instance)", serviceName: "Azure App Service", productName: "Azure App Service Standard Plan - Linux", skuName: "S1", meterName: "S1 App", unitsPerHour: 1 },
    { label: "Application Insights and logs (small)", serviceName: "Azure Monitor", skuName: "Free", meterName: "Free", unitsPerHour: 1, fixedHourly: 0 },
  ],
  notes: ["Each instance autoscale adds costs the same again while it runs (up to the maximum you chose)", "Log Analytics beyond the free allowance (capped at 1 GB/day)"],
  armParams: (p: Tour) => ({ maxInstances: p.maxInstances, healthCheck: p.healthCheck }),
  extraTypes: ["Microsoft.Insights/autoscalesettings", "Microsoft.Insights/components"],
  timingKey: (p: Tour) => `${p.maxInstances}`,
  stages: () => [{ label: "Deploy", gate: { kind: "http-ok", label: "Production site answers", timeoutMin: 12, blocking: false } }],
  presets: [
    { label: "Small", params: { maxInstances: 2, healthCheck: true } },
    { label: "Full", params: { maxInstances: 3, healthCheck: true } },
  ],
  alternatives: (p: Tour) => (p.maxInstances > 2 ? [{ params: { maxInstances: 2 } as Partial<Tour>, loses: "One instance of headroom during a busy period" }] : []),
  scenario: {
    story:
      "A tour operator in Guanacaste gets almost all its bookings in the weeks before December. The site crawls in high season and goes down for a while whenever the team publishes an update. The owner wants it to grow when busy, shrink when quiet, and update without downtime. The page has a button that simulates the busy season.",
    objectives: [
      "Explain vertical versus horizontal scaling and elasticity with a live example",
      "See an autoscale rule add an instance when the CPU is busy, and remove it afterward",
      "Stage an update in a deployment slot and swap it into production with no downtime",
      "Explain availability, regions versus availability zones, and what a health check does",
    ],
    exams: ["AZ-900: cloud concepts (high availability, scalability, elasticity, reliability)", "AZ-900: Azure architecture and services (App Service, regions and availability)"],
  },
};
