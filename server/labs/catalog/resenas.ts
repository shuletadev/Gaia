import { z } from "zod";
import type { Blueprint } from "../blueprints.ts";

const resenasSchema = z.object({ dataset: z.enum(["full", "small"]).default("full") });

export const resenas: Blueprint<any> = {
  id: "cr-resenas-turismo",
  category: "Showcase",
  title: "Tourist reviews",
  tagline: "Sentiment, key phrases and translation on Spanish and English hotel reviews",
  code: "cresen",
  deployMinutes: [2, 5],
  icons: ["Microsoft.CognitiveServices/accounts", "Microsoft.Storage/storageAccounts"],
  fields: [
    {
      key: "dataset",
      label: "Reviews",
      kind: "select",
      options: [
        { value: "full", label: "60 reviews" },
        { value: "small", label: "20 reviews (quick demo)" },
      ],
      default: "full",
    },
  ],
  schema: resenasSchema,
  steps: () => [
    { name: "ai", label: "Azure AI services account", type: "Microsoft.CognitiveServices/accounts" },
    { name: "storage", label: "Sample reviews storage", type: "Microsoft.Storage/storageAccounts" },
  ],
  meters: () => [
    { label: "AI services (pay per text record)", serviceName: "Cognitive Services", skuName: "S0", meterName: "S0", unitsPerHour: 1, fixedHourly: 0 },
    { label: "Storage (idle)", serviceName: "Storage", skuName: "Standard", meterName: "Standard", unitsPerHour: 1, fixedHourly: 0 },
  ],
  notes: ["Each text record analyzed and each character translated is billed per use", "Storage capacity and operations"],
  armParams: () => ({}),
  content: [{ kind: "blob-upload", label: "Sample reviews", accountOutput: "storageAccount", container: "muestras", source: { generator: "tourist-reviews" } }],
  timingKey: (p: z.infer<typeof resenasSchema>) => p.dataset,
  stages: () => [{ label: "Deploy" }],
  scenario: {
    story:
      "A hotel group in La Fortuna gets hundreds of reviews in Spanish and English on several sites. The manager reads a few and misses the pattern: is the problem the breakfast, the noise or the road? She wants the computer to tell her. The reviews here are synthetic, with some Costa Rican slang to see where the model struggles.",
    objectives: [
      "Run sentiment analysis, key-phrase extraction and language detection on Spanish and English text",
      "Translate reviews between Spanish and English and judge the quality",
      "Read results critically: sarcasm, slang and mixed-sentiment reviews",
      "Explain the difference between sentiment for a whole review and for each sentence",
    ],
    exams: ["AI-901: common text analysis techniques (keyword extraction, entity detection, sentiment analysis, summarization)", "AI-901: principles of responsible AI (fairness, inclusiveness, transparency)"],
  },
};
