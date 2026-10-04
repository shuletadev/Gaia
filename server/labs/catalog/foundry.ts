/**
 * Model versions for the Foundry labs (22 to 24). Checked against the subscription's model list on 2026-10-04
 * (az cognitiveservices model list); availability and versions change, so re-check before class.
 */
export const MODEL_VERSIONS: Record<string, string> = {
  "gpt-5-mini": "2025-08-07",
  "gpt-5-nano": "2025-08-07",
  "gpt-5.4-nano": "2026-03-17",
  "gpt-4.1": "2025-04-14",
  "gpt-4.1-mini": "2025-04-14",
  "gpt-audio-mini": "2025-12-15",
  "gpt-image-1-mini": "2025-10-06",
  "text-embedding-3-large": "1",
};

export interface FoundryDeployment {
  name: string;
  model: string;
  version: string;
  /** Thousands of tokens per minute: the deployment's own ceiling, and so the cost cap. */
  capacity: number;
}

/** One entry of the template's `deployments` array. */
export function deployment(name: string, model: string, capacityK: number): FoundryDeployment {
  const version = MODEL_VERSIONS[model];
  if (!version) throw new Error(`No known version for model ${model}`);
  return { name, model, version, capacity: capacityK };
}

/** Regions where each model family was offered (GlobalStandard) on 2026-10-04, for the notes shown at launch. */
export const REGION_NOTES = {
  audio: "gpt-audio-mini is offered in Central US, East US 2 and Sweden Central",
  image: "gpt-image-1-mini is offered in East US 2 and Sweden Central",
  contentUnderstanding: "Content Understanding is offered in West US, Sweden Central and Australia East",
};
