import { z } from "zod";
import { flag } from "../kit.ts";
import type { Blueprint } from "../blueprints.ts";

const ferreteriaSchema = z.object({
  errorThreshold: z.coerce.number().int().min(1).max(20).default(3),
  maintenanceRule: flag(true),
});
type Ferreteria = z.infer<typeof ferreteriaSchema>;

export const ferreteria: Blueprint<any> = {
  id: "cr-ferreteria-monitoreo",
  category: "Showcase",
  title: "Ferretería El Tornillo: monitoring and alerts",
  tagline: "A web shop that logs to Azure Monitor, with metric, log and service-health alerts to the owner",
  code: "cferre",
  deployMinutes: [4, 8],
  icons: ["Microsoft.Web/sites", "Microsoft.OperationalInsights/workspaces", "Microsoft.Insights/components"],
  fields: [
    { key: "errorThreshold", label: "Server errors in 5 minutes that fire the alert", kind: "int", min: 1, max: 20, default: 3 },
    { key: "maintenanceRule", label: "Mute alerts Sunday 02:00 to 04:00 (processing rule)", kind: "toggle", default: true },
  ],
  schema: ferreteriaSchema,
  steps: () => [
    { name: "monitor", label: "Log Analytics workspace and Application Insights", type: "Microsoft.OperationalInsights/workspaces" },
    { name: "app", label: "Web shop (App Service) and its diagnostic settings", type: "Microsoft.Web/sites" },
    { name: "alerts", label: "Action group and alert rules", type: "Microsoft.Insights/metricAlerts" },
  ],
  // A Basic B1 plan is the only steady cost; Azure Monitor charges only for log volume and a few cents per log-alert rule.
  meters: () => [
    { label: "App Service Basic B1", serviceName: "Azure App Service", productName: "Azure App Service Basic Plan - Linux", skuName: "B1", meterName: "B1", unitsPerHour: 1 },
    { label: "Log Analytics and Application Insights (small, capped at 1 GB/day)", serviceName: "Azure Monitor", skuName: "Free", meterName: "Free", unitsPerHour: 1, fixedHourly: 0 },
  ],
  notes: ["Log Analytics ingestion beyond the free allowance (capped at 1 GB a day)", "A log-alert rule is billed per evaluation (a few cents a month)", "Email notifications are free"],
  armParams: (p: Ferreteria, ctx) => ({ contactEmail: ctx.owner, errorThreshold: p.errorThreshold, maintenanceRule: p.maintenanceRule }),
  // Alerts, action groups, diagnostic settings and processing rules are not regional; the metric alerts and
  // log alert are created by the template but are not steps of their own.
  extraTypes: [
    "Microsoft.Insights/components",
    "Microsoft.Insights/actionGroups",
    "Microsoft.Insights/scheduledQueryRules",
    "Microsoft.Insights/activityLogAlerts",
    "Microsoft.Insights/diagnosticSettings",
    "Microsoft.AlertsManagement/actionRules",
    "Microsoft.Web/serverfarms",
  ],
  regionFree: [
    "Microsoft.Insights/metricAlerts",
    "Microsoft.Insights/actionGroups",
    "Microsoft.Insights/activityLogAlerts",
    "Microsoft.Insights/diagnosticSettings",
    "Microsoft.AlertsManagement/actionRules",
  ],
  timingKey: (p: Ferreteria) => (p.maintenanceRule ? "rule" : "plain"),
  stages: () => [{ label: "Deploy", gate: { kind: "http-ok", label: "Web shop answers", timeoutMin: 10, blocking: false } }],
  presets: [
    { label: "Sensitive", params: { errorThreshold: 1, maintenanceRule: false } },
    { label: "Standard", params: { errorThreshold: 3, maintenanceRule: true } },
  ],
  scenario: {
    story:
      "Ferretería El Tornillo, a hardware store in Heredia, sells online. Last month the payment step broke on a Saturday night and the owner found out on Monday from an angry customer. She wants Azure to tell her when the shop slows down or fails, and to see what happened afterwards. The page has buttons that send normal, failing and slow requests so the class can watch the monitoring react.",
    objectives: [
      "Read a metric chart (requests, server errors, response time) and say what each tells you",
      "Query the web server's logs with a KQL query in Log Analytics",
      "Explain the difference between a metric alert, a log alert, an activity log alert and a service health alert",
      "Follow an alert from the rule to the action group and the email, and mute it in a maintenance window with a processing rule",
      "Open Application Insights and find the failing requests, and open Azure Advisor and Service Health in the portal",
    ],
    exams: [
      "AZ-900: monitoring tools in Azure (Azure Monitor, Log Analytics, alerts, Application Insights, Service Health, Advisor)",
      "AZ-104: monitor resources (metrics, log settings, KQL queries, alert rules, action groups, alert processing rules)",
    ],
  },
};
