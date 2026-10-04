import { z } from "zod";
import type { Blueprint } from "../blueprints.ts";
import { deployment, REGION_NOTES } from "./foundry.ts";

const feriaSchema = z.object({
  audioModel: z.enum(["none", "gpt-audio-mini"]).default("gpt-audio-mini"),
  imageModel: z.enum(["none", "gpt-image-1-mini"]).default("none"),
  capacityK: z.coerce.number().int().min(1).max(50).default(10),
});
type Feria = z.infer<typeof feriaSchema>;

export const feria: Blueprint<any> = {
  id: "cr-feria-voz-vision",
  category: "Showcase",
  title: "Feria del Agricultor: voice, vision and images",
  tagline: "A multimodal model that sees photos, an audio model for spoken questions, image generation and Azure Speech",
  code: "cferia",
  deployMinutes: [4, 9],
  icons: ["Microsoft.CognitiveServices/accounts"],
  fields: [
    {
      key: "audioModel",
      label: "Audio model (spoken questions)",
      kind: "select",
      options: [
        { value: "gpt-audio-mini", label: "gpt-audio-mini" },
        { value: "none", label: "None" },
      ],
      default: "gpt-audio-mini",
    },
    {
      key: "imageModel",
      label: "Image generation model",
      kind: "select",
      options: [
        { value: "none", label: "None (not offered in every region)" },
        { value: "gpt-image-1-mini", label: "gpt-image-1-mini (East US 2, Sweden Central)" },
      ],
      default: "none",
    },
    { key: "capacityK", label: "Tokens per minute (thousands) per model: the cost cap", kind: "int", min: 1, max: 50, default: 10 },
  ],
  schema: feriaSchema,
  steps: () => [{ name: "ai", label: "Foundry resource, project and model deployments", type: "Microsoft.CognitiveServices/accounts" }],
  // Everything is billed per use (tokens, images, audio seconds, characters); an idle resource costs nothing.
  meters: (p: Feria) => [
    { label: "Chat model with image input (pay per token)", serviceName: "Foundry Models", skuName: "GlobalStandard", meterName: "Tokens", unitsPerHour: 1, fixedHourly: 0 },
    ...(p.audioModel !== "none" ? [{ label: "Audio model (pay per token)", serviceName: "Foundry Models", skuName: "GlobalStandard", meterName: "Tokens", unitsPerHour: 1, fixedHourly: 0 }] : []),
    ...(p.imageModel !== "none" ? [{ label: "Image generation (pay per image)", serviceName: "Foundry Models", skuName: "GlobalStandard", meterName: "Images", unitsPerHour: 1, fixedHourly: 0 }] : []),
    { label: "Azure Speech (pay per use)", serviceName: "Cognitive Services", skuName: "Standard", meterName: "Standard", unitsPerHour: 1, fixedHourly: 0 },
  ],
  notes: [
    "All usage is billed per use; each deployment's tokens-per-minute setting caps how fast a class can spend",
    REGION_NOTES.audio,
    REGION_NOTES.image,
    "The class files (Python) are in the repository folder blueprints/cr-feria-voz-vision/muestras and were not run against a real subscription",
    "The person who runs the clients needs the Azure AI User role on the project",
  ],
  armParams: (p: Feria) => ({
    deployments: [
      deployment("vision", "gpt-5-mini", p.capacityK),
      ...(p.audioModel !== "none" ? [deployment("voz", p.audioModel, p.capacityK)] : []),
      // Image deployments are limited by images per minute rather than tokens; the smallest quota is plenty for a class.
      ...(p.imageModel !== "none" ? [deployment("afiche", p.imageModel, 1)] : []),
    ],
  }),
  extraTypes: ["Microsoft.CognitiveServices/accounts/deployments", "Microsoft.CognitiveServices/accounts/projects"],
  regionFree: ["Microsoft.CognitiveServices/accounts/deployments", "Microsoft.CognitiveServices/accounts/projects"],
  timingKey: (p: Feria) => `${p.audioModel}/${p.imageModel}`,
  stages: () => [{ label: "Deploy" }],
  presets: [
    { label: "Voice and vision", params: { audioModel: "gpt-audio-mini", imageModel: "none", capacityK: 10 } },
    { label: "Everything (East US 2 or Sweden Central)", params: { audioModel: "gpt-audio-mini", imageModel: "gpt-image-1-mini", capacityK: 10 } },
    { label: "Vision only", params: { audioModel: "none", imageModel: "none", capacityK: 5 } },
  ],
  alternatives: (p: Feria) => (p.imageModel !== "none" ? [{ params: { imageModel: "none" } as Partial<Feria>, loses: "Image generation: the model is only offered in some regions" }] : []),
  scenario: {
    story:
      "The Feria del Agricultor in Zarcero (fictional) wants three things for next season: a stand-owner can photograph a crate and ask what is wrong with the produce, a visitor can ask about the schedule out loud while walking, and the committee can produce the poster without hiring a designer. The class uses one Foundry project to try all of it, and Azure Speech to transcribe and read text in Costa Rican Spanish.",
    objectives: [
      "Send an image together with a question to a multimodal model and judge the answer, including its mistakes",
      "Ask a spoken question to an audio-capable model and compare it with speech-to-text followed by a text model",
      "Use Azure Speech in the Foundry portal: recognize speech and synthesize it with an es-CR voice",
      "Generate an image from a prompt, change the prompt, and discuss ownership, bias and disclosure",
      "Build the same ideas as short client programs and explain what changes between a playground and an application",
    ],
    exams: [
      "AI-901: implement AI solutions for text and speech (spoken prompts with a multimodal model, a lightweight app with Azure Speech)",
      "AI-901: implement AI solutions with computer vision and image generation (visual input in prompts, new visual outputs)",
      "AI-901: identify AI workloads (speech recognition and synthesis, computer vision, image generation) and responsible AI considerations",
    ],
  },
};
