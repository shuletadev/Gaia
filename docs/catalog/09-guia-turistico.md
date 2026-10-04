# 09 · Tourist guide chat

Blueprint `cr-guia-turistico` · code `cguia` · **Status: Spec** · Batch 2 · **Blocked on access and cost review**

**Exam mapping:** AI-900 (generative AI workloads: large language models, prompts, copilots, retrieval-augmented answers, responsible AI and content filtering).

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

## Student activities
Ask the same question with and without the brochures; try to make it invent a schedule; try a prompt injection and see
the filter; write a better system prompt.

## Student-mode policy pack
Not offered to students in v1: the instructor runs one shared deployment and projects it, because model access and cost
are the riskiest in the catalog.

## Build notes and risks
- **Model access may need approval** and availability changes by region; verify before promising it in a course.
- Per-token cost can run away with a class of students; hard quota and cap required before any student use.
- Search tier choice drives the hourly cost; decide after pricing check.
- Soft-delete purge needed on destroy.
