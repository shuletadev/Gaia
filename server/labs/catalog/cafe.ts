import { z } from "zod";
import type { Blueprint } from "../blueprints.ts";

const cafeSchema = z.object({
  dataset: z.enum(["clean", "messy"]).default("clean"),
  computeSize: z.enum(["Standard_DS2_v2", "Standard_DS3_v2"]).default("Standard_DS2_v2"),
});
type Cafe = z.infer<typeof cafeSchema>;

export const cafe: Blueprint<any> = {
  id: "cr-cafe-demanda",
  category: "Showcase",
  title: "Coffee: seasonal demand (machine learning)",
  tagline: "Train a no-code forecasting model on three years of a roaster's sales",
  code: "ccafe",
  deployMinutes: [4, 9],
  icons: ["Microsoft.MachineLearningServices/workspaces", "Microsoft.Storage/storageAccounts", "Microsoft.KeyVault/vaults"],
  fields: [
    {
      key: "dataset",
      label: "Sales data",
      kind: "select",
      options: [
        { value: "clean", label: "Clean (36 months)" },
        { value: "messy", label: "Messy (gaps, an outlier, a duplicate)" },
      ],
      default: "clean",
    },
    {
      key: "computeSize",
      label: "Training cluster size",
      kind: "select",
      options: [
        { value: "Standard_DS2_v2", label: "DS2 v2 (2 vCPU, about $0.15/h while a job runs)" },
        { value: "Standard_DS3_v2", label: "DS3 v2 (4 vCPU, about twice that)" },
      ],
      default: "Standard_DS2_v2",
    },
  ],
  schema: cafeSchema,
  steps: () => [
    { name: "storage", label: "Workspace storage and sales dataset", type: "Microsoft.Storage/storageAccounts" },
    { name: "monitor", label: "Log Analytics and Application Insights", type: "Microsoft.OperationalInsights/workspaces" },
    { name: "vault", label: "Key Vault", type: "Microsoft.KeyVault/vaults" },
    { name: "workspace", label: "Machine Learning workspace and compute cluster", type: "Microsoft.MachineLearningServices/workspaces" },
  ],
  // Idle, the lab costs pennies: the cluster has no nodes until a job runs, and only then is compute billed.
  meters: () => [
    { label: "ML workspace, storage, vault (idle)", serviceName: "Machine Learning", skuName: "Basic", meterName: "Workspace", unitsPerHour: 1, fixedHourly: 0 },
    { label: "Training cluster (0 nodes idle)", serviceName: "Virtual Machines", skuName: "DS2 v2", meterName: "DS2 v2", unitsPerHour: 1, fixedHourly: 0 },
  ],
  notes: ["Compute is billed per hour only while a training job runs (DS2 v2 is about $0.146/h), plus five idle minutes", "Automated ML can run for hours: set a short time limit in the job", "Storage, Key Vault and log ingestion are pennies"],
  armParams: (p: Cafe) => ({ computeSize: p.computeSize }),
  // The cluster size is checked against the regional vCPU quota (new subscriptions often start at zero for this family).
  vmSizes: (p: Cafe) => [p.computeSize],
  extraTypes: ["Microsoft.MachineLearningServices/workspaces/computes", "Microsoft.Insights/components"],
  content: [{ kind: "blob-upload", label: "Coffee sales dataset", accountOutput: "storageAccount", container: "datos", source: { generator: "coffee-demand" } }],
  timingKey: (p: Cafe) => p.computeSize,
  stages: () => [{ label: "Deploy" }],
  presets: [
    { label: "Clean data", params: { dataset: "clean" } },
    { label: "Messy data (teaches preparation)", params: { dataset: "messy" } },
  ],
  alternatives: (p: Cafe) => (p.computeSize === "Standard_DS3_v2" ? [{ params: { computeSize: "Standard_DS2_v2" } as Partial<Cafe>, loses: "Half the vCPUs: slower training, half the hourly cost" }] : []),
  scenario: {
    story:
      "A coffee roaster in Heredia sells more in the cold months and before the holidays, but orders beans by feel and either runs out or throws stock away. He has three years of monthly sales and wants a number to order from. The data here is synthetic, with an optional messy version that has gaps, an outlier and a duplicate row.",
    objectives: [
      "Tell regression, classification and clustering apart using coffee examples",
      "Explain features, labels, training data, test data and overfitting in plain words",
      "Train a forecasting or regression model without code and read its error metrics",
      "Judge whether a prediction is trustworthy and name what could make it wrong, such as a new competitor or a promotion",
    ],
    exams: ["AI-900: fundamental principles of machine learning on Azure (regression, classification, clustering, training and validation)", "AI-900: responsible AI considerations"],
  },
};
