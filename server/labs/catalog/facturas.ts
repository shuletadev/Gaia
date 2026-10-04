import { z } from "zod";
import type { Blueprint } from "../blueprints.ts";

const facturasSchema = z.object({ sampleSet: z.enum(["both", "invoices"]).default("both") });

export const facturas: Blueprint<any> = {
  id: "cr-facturas-escaner",
  category: "Showcase",
  title: "Invoice scanner",
  tagline: "Read dates, suppliers and totals from invoices and receipts with Document Intelligence",
  code: "cfact",
  deployMinutes: [2, 5],
  icons: ["Microsoft.CognitiveServices/accounts", "Microsoft.Storage/storageAccounts"],
  fields: [
    {
      key: "sampleSet",
      label: "Sample documents",
      kind: "select",
      options: [
        { value: "both", label: "Invoices and receipts" },
        { value: "invoices", label: "Invoices only" },
      ],
      default: "both",
    },
  ],
  schema: facturasSchema,
  steps: () => [
    { name: "ai", label: "Azure AI services account", type: "Microsoft.CognitiveServices/accounts" },
    { name: "storage", label: "Sample documents storage", type: "Microsoft.Storage/storageAccounts" },
  ],
  // Pay per page analyzed; an idle lab costs about nothing.
  meters: () => [
    { label: "AI services (pay per page)", serviceName: "Cognitive Services", skuName: "S0", meterName: "S0", unitsPerHour: 1, fixedHourly: 0 },
    { label: "Storage (idle)", serviceName: "Storage", skuName: "Standard", meterName: "Standard", unitsPerHour: 1, fixedHourly: 0 },
  ],
  notes: ["Each page analyzed is billed per use (Document Intelligence prebuilt models)", "Storage capacity and operations"],
  armParams: () => ({}),
  content: [{ kind: "blob-upload", label: "Sample invoices and receipts", accountOutput: "storageAccount", container: "muestras", source: { generator: "invoices-receipts" } }],
  timingKey: (p: z.infer<typeof facturasSchema>) => p.sampleSet,
  stages: () => [{ label: "Deploy" }],
  scenario: {
    story:
      "An accountant in Escazú receives supplier invoices as phone photos and PDFs and retypes them into a spreadsheet at the end of every month. She wants the computer to read the supplier, the date and the total, so she only has to check the result. The documents here are synthetic: no real company or person appears in them.",
    objectives: [
      "Describe what OCR and prebuilt document models do, and what they cannot do",
      "Analyze an invoice and a receipt in the studio and read the extracted fields with their confidence scores",
      "Explain why a person still reviews low-confidence fields",
      "Name the responsible-AI points for financial documents: privacy, errors and human oversight",
    ],
    exams: ["AI-901: identify AI workloads and information extraction techniques (OCR, document and receipt analysis)", "AI-901: principles of responsible AI (privacy, reliability, accountability)"],
  },
};
