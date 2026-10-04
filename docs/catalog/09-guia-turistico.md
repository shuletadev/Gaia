# 09 · Tourist guide chat

Blueprint `cr-guia-turistico` · code `cguia` · **Status: Built** (Bicep, blueprint, tests; not yet deployed to Azure) · Batch 2 · **Blocked on access and cost review**

**Exam mapping:** AI-901 (how generative AI models work, model deployment options and configuration parameters, effective system and user prompts, responsible AI). *Was AI-900, retired 30 June 2026.* The agent and SDK skills of AI-901 are in card 22.

## Scenario
A tourism office in Monteverde wants a chat assistant that answers visitors' questions about trails, schedules and
prices, in Spanish and English, using only its own brochures, and never invents an opening hour.

## Students learn
- Explain what a large language model is and why it can invent facts.
- Write a system prompt that sets role, language and limits.
- Ground answers on documents (retrieval) and see the difference.
- See content filtering and refusals; discuss privacy and prompt injection.

## Architecture
A model deployment in Azure AI Foundry / Azure OpenAI with a low capacity limit, an Azure AI Search index over a handful
of **synthetic** brochures, and the studio playground ("chat with your data"). No custom app in v1.

## Knobs
`grounding` on/off (the key teaching contrast), `capacity` (tokens per minute cap).

## Cost and time
Pay per token plus the search service (the paid search tiers bill by the hour; a free tier exists with limits). Cap
tokens per minute low. Deploy 5 to 10 min. Lifetime: one class.

## Class activities (instructor-led)
Ask the same question with and without the brochures; try to make it invent a schedule; try a prompt injection and see
the filter; write a better system prompt.

## Build notes and risks
- **Model access may need approval** and availability changes by region; verify before promising it in a course.
- The tokens-per-minute cap limits the cost even if the page is shared with a class.
- Search tier choice drives the hourly cost; decide after pricing check.
- Soft-delete purge needed on destroy.

## As built
- Built on a Foundry resource (AIServices with project management), a project, a chat model deployment capped by tokens per minute, an AI Search service (free or Basic) and a storage account with 5 synthetic brochures as PDFs.
- The model list was checked against the subscription on 2026-10-03: gpt-4o-mini is deprecating, so the options are gpt-5-mini (default), gpt-5-nano and gpt-5.4-nano. Model availability changes: re-check before class (az cognitiveservices model list).
- Not deployed. Model access, the free search tier (one per subscription) and regional availability are the likeliest first-deploy surprises. Still instructor-run only for students.
