import { z } from "zod";
import type { Blueprint } from "../blueprints.ts";
import { deployment } from "./foundry.ts";

const agenteSchema = z.object({
  model: z.enum(["gpt-5-mini", "gpt-5-nano", "gpt-5.4-nano"]).default("gpt-5-mini"),
  capacityK: z.coerce.number().int().min(1).max(50).default(10),
});
type Agente = z.infer<typeof agenteSchema>;

export const agente: Blueprint<any> = {
  id: "cr-cooperativa-agente",
  category: "Showcase",
  title: "Cooperativa Ahorro Verde: a Foundry agent",
  tagline: "A model in a Foundry project, the cooperative's documents, and the code for a chat client and an agent client",
  code: "cagent",
  deployMinutes: [4, 9],
  icons: ["Microsoft.CognitiveServices/accounts", "Microsoft.Storage/storageAccounts"],
  fields: [
    {
      key: "model",
      label: "Model",
      kind: "select",
      options: [
        { value: "gpt-5-mini", label: "gpt-5-mini" },
        { value: "gpt-5-nano", label: "gpt-5-nano (smaller)" },
        { value: "gpt-5.4-nano", label: "gpt-5.4-nano (smaller, newer)" },
      ],
      default: "gpt-5-mini",
    },
    { key: "capacityK", label: "Tokens per minute (thousands): the cost cap", kind: "int", min: 1, max: 50, default: 10 },
  ],
  schema: agenteSchema,
  steps: () => [
    { name: "ai", label: "Foundry resource, project and model deployment", type: "Microsoft.CognitiveServices/accounts" },
    { name: "storage", label: "Storage with the documents and the client scripts", type: "Microsoft.Storage/storageAccounts" },
  ],
  // Tokens are billed per use and the deployment's tokens-per-minute is a hard ceiling; idle costs nothing.
  meters: () => [
    { label: "Model (pay per token)", serviceName: "Foundry Models", skuName: "GlobalStandard", meterName: "Tokens", unitsPerHour: 1, fixedHourly: 0 },
    { label: "Storage (idle)", serviceName: "Storage", skuName: "Standard", meterName: "Standard", unitsPerHour: 1, fixedHourly: 0 },
  ],
  notes: [
    "Model tokens are billed per use; the tokens-per-minute setting caps how fast a class can spend",
    "The agent's file search creates a vector store, billed by size after the first free gigabyte a day",
    "The person who creates the agent needs the Azure AI User role on the project",
    "Model availability and access change by region: check the model is offered to the subscription before class",
  ],
  armParams: (p: Agente) => ({ deployments: [deployment("agente", p.model, p.capacityK)] }),
  extraTypes: ["Microsoft.CognitiveServices/accounts/deployments", "Microsoft.CognitiveServices/accounts/projects"],
  regionFree: ["Microsoft.CognitiveServices/accounts/deployments", "Microsoft.CognitiveServices/accounts/projects"],
  content: [{ kind: "blob-upload", label: "Cooperative documents and client scripts", accountOutput: "storageAccount", container: "documentos", source: { dir: "muestras" } }],
  timingKey: (p: Agente) => p.model,
  stages: () => [{ label: "Deploy" }],
  presets: [
    { label: "Cheapest", params: { model: "gpt-5-nano", capacityK: 5 } },
    { label: "Standard class", params: { model: "gpt-5-mini", capacityK: 10 } },
  ],
  alternatives: (p: Agente) => (p.model === "gpt-5-mini" ? [{ params: { model: "gpt-5-nano" } as Partial<Agente>, loses: "Answer quality: the smaller model is cheaper and weaker" }] : []),
  scenario: {
    story:
      "Cooperativa Ahorro Verde, a savings cooperative in Grecia, answers the same questions all day: loan requirements, deposit rates, opening hours. The manager wants an assistant that answers from the cooperative's own documents, never invents a rate, and that the web team can call from the website. The class builds it in Microsoft Foundry: first a plain model, then an agent with instructions and file search, then the few lines of Python that call each. The cooperative and its figures are fictional.",
    objectives: [
      "Write a system prompt and a user prompt, and see how the instructions change the answers",
      "Deploy a model, chat with it in the Foundry portal and read its configuration (tokens, temperature, deployment type)",
      "Create a single agent in the portal with instructions and file search over the cooperative's documents",
      "Call the model and the agent from a lightweight Python client with the Foundry SDK, using an identity instead of a key",
      "Test an off-topic question and a prompt injection, and explain responsible AI limits for an assistant that speaks for a business",
    ],
    exams: [
      "AI-901: implement generative AI apps and agents by using Foundry (prompts, deploy a model, a chat client with the SDK, a single agent, a client for the agent)",
      "AI-901: model components and configurations (how generative models work, choosing and deploying a model, configuration parameters)",
      "AI-901: principles of responsible AI (reliability and safety, privacy and security, transparency)",
    ],
  },
};
