# 22 · Cooperativa Ahorro Verde: a Foundry agent

Blueprint `cr-cooperativa-agente` · code `cagent` · **Status: Built** (Bicep, blueprint, tests; not deployed to Azure) · Batch 5 (AI-901)

**Exam mapping:** AI-901 (implement generative AI apps and agents by using Foundry: prompts, deploy a model, a chat client with the SDK, a single agent, a client for the agent · model components and configurations · responsible AI).

## Scenario
A savings cooperative in Grecia answers the same questions all day: loan requirements, deposit rates, hours. The manager wants an
assistant that answers from the cooperative's own documents, never invents a rate, and that the web team can call from the website.

## Students learn
System and user prompts; deploying a model and reading its settings; creating an agent in the portal with instructions and file
search; calling the model and the agent from short Python clients with an identity (no key); off-topic and injection tests.

## Architecture / Knobs
Foundry resource (AIServices, project management on) with one project and one model deployment named `agente` (capacity is the cost
cap), plus a storage account with `documentos/` (three Spanish documents and the suggested agent instructions) and `codigo/`
(`chat_client.py`, `agent_client.py`), with CORS for the Foundry portal. Knobs: `model` (gpt-5-mini, gpt-5-nano, gpt-5.4-nano), `capacityK`.

## Cost and time
Pay per token, idle $0. Deploy 4 to 9 min. Lifetime: a class. File search creates a vector store (billed by size after a free allowance).

## Class activities (instructor-led)
Give yourself **Azure AI User** on the project. In the Foundry portal: chat with the deployment, change the system prompt, then create
an agent with the suggested instructions, attach the three documents (file search) and run the five test questions in
`instrucciones-del-agente.md`, including the off-topic and the injection ones. Run `chat_client.py`, then `agent_client.py` with the
agent's name (they read `PROJECT_ENDPOINT` from the lab outputs and use `az login`).

## Build notes and risks
- **Not run against a real subscription.** The agent client follows Microsoft's own sample in `mslearn-ai-fundamentals` (`azure-ai-projects` 2.1 or newer, `agent_reference`); the SDK moves fast, so check it before class.
- The agent itself is data-plane and is not in the template, on purpose: creating it is the exam skill.
- Model access and quota are per subscription and region. Soft delete: destroy purges the account (name starts with the lab name).
- Shared module `blueprints/shared/foundry.bicep` (account, project, deployments one at a time) is used by labs 22 to 24. Lab 09 keeps its own module.

## As built
- Modules `ai` and `storage`. Model versions live in `server/labs/catalog/foundry.ts`, checked with `az cognitiveservices model list` on 2026-10-04.
