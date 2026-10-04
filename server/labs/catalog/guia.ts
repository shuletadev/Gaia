import { z } from "zod";
import type { Blueprint, PriceMeter } from "../blueprints.ts";

const guiaSchema = z.object({
  model: z.enum(["gpt-5-mini", "gpt-5-nano", "gpt-5.4-nano"]).default("gpt-5-mini"),
  capacityK: z.coerce.number().int().min(1).max(50).default(10),
  searchTier: z.enum(["free", "basic"]).default("free"),
});
type Guia = z.infer<typeof guiaSchema>;

const searchMeter = (tier: Guia["searchTier"]): PriceMeter =>
  tier === "basic"
    ? { label: "AI Search Basic", serviceName: "Azure Cognitive Search", productName: "Azure AI Search", skuName: "Basic", meterName: "Basic Unit", unitsPerHour: 1 }
    : { label: "AI Search Free", serviceName: "Azure Cognitive Search", skuName: "Free", meterName: "Free", unitsPerHour: 1, fixedHourly: 0 };

export const guia: Blueprint<any> = {
  id: "cr-guia-turistico",
  category: "Showcase",
  title: "Tourist guide chat",
  tagline: "A chat model that answers from a tourism office's brochures, and what happens when it does not",
  code: "cguia",
  deployMinutes: [5, 12],
  icons: ["Microsoft.CognitiveServices/accounts", "Microsoft.Search/searchServices", "Microsoft.Storage/storageAccounts"],
  fields: [
    {
      key: "model",
      label: "Chat model",
      kind: "select",
      options: [
        { value: "gpt-5-mini", label: "gpt-5-mini" },
        { value: "gpt-5-nano", label: "gpt-5-nano (smaller)" },
        { value: "gpt-5.4-nano", label: "gpt-5.4-nano (smaller, newer)" },
      ],
      default: "gpt-5-mini",
    },
    { key: "capacityK", label: "Tokens per minute (thousands): the cost cap", kind: "int", min: 1, max: 50, default: 10 },
    {
      key: "searchTier",
      label: "AI Search tier",
      kind: "select",
      options: [
        { value: "free", label: "Free (one per subscription)" },
        { value: "basic", label: "Basic (about $0.10/h)" },
      ],
      default: "free",
    },
  ],
  schema: guiaSchema,
  steps: () => [
    { name: "ai", label: "Foundry resource, project and chat model", type: "Microsoft.CognitiveServices/accounts" },
    { name: "search", label: "AI Search service", type: "Microsoft.Search/searchServices" },
    { name: "storage", label: "Brochures storage", type: "Microsoft.Storage/storageAccounts" },
  ],
  // Tokens are billed per use and the deployment's tokens-per-minute is a hard ceiling; idle costs nothing but the search tier.
  meters: (p: Guia) => [
    { label: "Chat model (pay per token)", serviceName: "Foundry Models", skuName: "GlobalStandard", meterName: "Tokens", unitsPerHour: 1, fixedHourly: 0 },
    searchMeter(p.searchTier),
    { label: "Storage (idle)", serviceName: "Storage", skuName: "Standard", meterName: "Standard", unitsPerHour: 1, fixedHourly: 0 },
  ],
  notes: [
    "Model tokens are billed per use; the tokens-per-minute setting caps how fast a class can spend",
    "Model availability and access change over time and by region: check the model is offered to the subscription before class",
    "The free AI Search tier allows one service per subscription",
  ],
  armParams: (p: Guia) => ({ model: p.model, capacityK: p.capacityK, searchTier: p.searchTier }),
  // Accounts, projects, deployments and search services have their own regional availability.
  extraTypes: ["Microsoft.CognitiveServices/accounts/deployments"],
  regionFree: ["Microsoft.CognitiveServices/accounts/deployments"],
  content: [{ kind: "blob-upload", label: "Tourism office brochures", accountOutput: "storageAccount", container: "folletos", source: { generator: "tourism-brochures" } }],
  timingKey: (p: Guia) => `${p.model}/${p.searchTier}`,
  stages: () => [{ label: "Deploy" }],
  presets: [
    { label: "Cheapest", params: { model: "gpt-5-nano", capacityK: 5, searchTier: "free" } },
    { label: "Standard class", params: { model: "gpt-5-mini", capacityK: 10, searchTier: "free" } },
  ],
  alternatives: (p: Guia) => [
    ...(p.searchTier === "basic" ? [{ params: { searchTier: "free" } as Partial<Guia>, loses: "Capacity: the free search tier has small limits and only one per subscription" }] : []),
    ...(p.model === "gpt-5-mini" ? [{ params: { model: "gpt-5-nano" } as Partial<Guia>, loses: "Answer quality: the smaller model is cheaper and weaker" }] : []),
  ],
  scenario: {
    story:
      "A tourism office in Monteverde wants a chat assistant that answers visitors' questions about trails, schedules and prices, in Spanish and English, using only its own brochures, and that never invents an opening hour. The brochures here are synthetic and the reserve is fictional. The class compares the model with and without the brochures.",
    objectives: [
      "Explain what a large language model is and why it can invent facts",
      "Write a system prompt that sets the role, the language and the limits",
      "Ground the answers on documents and compare them with answers from the model alone",
      "See content filtering and refusals, and discuss privacy and prompt injection",
    ],
    exams: ["AI-900: generative AI workloads (large language models, prompts, copilots, retrieval-augmented answers)", "AI-900: responsible AI (content filtering, transparency, privacy)"],
  },
};
