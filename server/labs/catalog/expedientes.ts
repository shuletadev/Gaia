import { z } from "zod";
import type { Blueprint } from "../blueprints.ts";
import { deployment, REGION_NOTES } from "./foundry.ts";

const expedientesSchema = z.object({
  sampleSet: z.enum(["invoices", "both"]).default("both"),
  capacityK: z.coerce.number().int().min(1).max(50).default(10),
});
type Expedientes = z.infer<typeof expedientesSchema>;

export const expedientes: Blueprint<any> = {
  id: "cr-expedientes-contenido",
  category: "Showcase",
  title: "Coffee cooperative files: Content Understanding",
  tagline: "Extract fields from invoices, describe photos, and transcribe a call, with the models the analyzers need",
  code: "cexped",
  deployMinutes: [4, 9],
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
    { key: "capacityK", label: "Tokens per minute (thousands) per model: the cost cap", kind: "int", min: 1, max: 50, default: 10 },
  ],
  schema: expedientesSchema,
  steps: () => [
    { name: "ai", label: "Foundry resource, project and the models the analyzers use", type: "Microsoft.CognitiveServices/accounts" },
    { name: "storage", label: "Storage with the synthetic documents and photos", type: "Microsoft.Storage/storageAccounts" },
  ],
  // Analysis is billed per page, image, or minute of audio and video; the models behind the analyzers bill per token.
  meters: () => [
    { label: "Content Understanding (pay per page, image or minute)", serviceName: "Cognitive Services", skuName: "Standard", meterName: "Standard", unitsPerHour: 1, fixedHourly: 0 },
    { label: "Models behind the analyzers (pay per token)", serviceName: "Foundry Models", skuName: "GlobalStandard", meterName: "Tokens", unitsPerHour: 1, fixedHourly: 0 },
    { label: "Storage (idle)", serviceName: "Storage", skuName: "Standard", meterName: "Standard", unitsPerHour: 1, fixedHourly: 0 },
  ],
  notes: [
    REGION_NOTES.contentUnderstanding,
    "Analysis is billed per page, per image and per minute of audio or video, plus the tokens of the models behind the analyzers",
    "After the deployment, connect the resource in Content Understanding Studio so its default models point at the three deployments",
    "The person who connects the resource needs the Cognitive Services User role",
  ],
  armParams: (p: Expedientes) => ({
    deployments: [deployment("gpt-4.1", "gpt-4.1", p.capacityK), deployment("gpt-4.1-mini", "gpt-4.1-mini", p.capacityK), deployment("text-embedding-3-large", "text-embedding-3-large", p.capacityK)],
  }),
  extraTypes: ["Microsoft.CognitiveServices/accounts/deployments", "Microsoft.CognitiveServices/accounts/projects"],
  regionFree: ["Microsoft.CognitiveServices/accounts/deployments", "Microsoft.CognitiveServices/accounts/projects"],
  content: [
    { kind: "blob-upload", label: "Synthetic invoices and receipts", accountOutput: "storageAccount", container: "expedientes", source: { generator: "invoices-receipts" } },
    { kind: "blob-upload", label: "Synthetic farm photos and soil reports", accountOutput: "storageAccount", container: "expedientes", source: { generator: "farm-archive" } },
  ],
  timingKey: (p: Expedientes) => p.sampleSet,
  stages: () => [{ label: "Deploy" }],
  presets: [
    { label: "Invoices only", params: { sampleSet: "invoices", capacityK: 5 } },
    { label: "Full set", params: { sampleSet: "both", capacityK: 10 } },
  ],
  scenario: {
    story:
      "A coffee cooperative in Los Santos keeps its paperwork in four shapes: supplier invoices as PDFs, photos of the harvest, soil reports, and the voice messages the field inspectors leave after each visit. The administrator wants the numbers and names pulled out automatically instead of retyped. The class uses Azure Content Understanding in Foundry to do it on all four, then compares what it extracts with what a person would. Invoices and photos are synthetic; the instructor brings a short audio or video clip of their own.",
    objectives: [
      "Run a prebuilt analyzer on a document and read the extracted fields with their confidence",
      "Analyze an image, an audio clip and a video clip, and compare what each modality returns",
      "Create a small custom analyzer that extracts the fields you choose, and check where it is wrong",
      "Explain why a person still reviews low-confidence fields, and the privacy risks of voice and images of people",
      "Build the extraction as a lightweight application call, and explain which models sit behind an analyzer",
    ],
    exams: [
      "AI-901: implement AI solutions for information extraction (documents and forms, images, audio and video, a lightweight extraction app with Content Understanding)",
      "AI-901: identify techniques to extract information from text, images, audio and video, and responsible AI considerations",
    ],
  },
};
