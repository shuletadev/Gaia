# 23 · Feria del Agricultor: voice, vision and images

Blueprint `cr-feria-voz-vision` · code `cferia` · **Status: Built** (Bicep, blueprint, tests; not deployed to Azure) · Batch 5 (AI-901)

**Exam mapping:** AI-901 (text and speech: spoken prompts with a multimodal model, a lightweight app with Azure Speech · computer vision and image generation: visual input in prompts, new visual outputs · AI workloads and responsible AI).

## Scenario
A farmers' market in Zarcero wants a stand-owner to photograph a crate and ask what is wrong with the produce, a visitor to ask about
the schedule out loud, and the committee to produce the poster without a designer.

## Students learn
Sending an image with a question and judging the answer; spoken questions to an audio-capable model versus speech-to-text then a
text model; Azure Speech with an es-CR voice; generating and iterating an image; the same ideas as short client programs.

## Architecture / Knobs
Foundry resource and project with `vision` (gpt-5-mini, multimodal), optional `voz` (gpt-audio-mini) and optional `afiche`
(gpt-image-1-mini). Azure Speech is part of the resource. Four Python examples in `blueprints/cr-feria-voz-vision/muestras/`.
Knobs: `audioModel`, `imageModel`, `capacityK`.

## Cost and time
Pay per use (tokens, images, audio, characters), idle $0. Deploy 4 to 9 min. Lifetime: a class.

## Class activities (instructor-led)
Foundry portal: chat playground with a photo of a stand (bring your own); audio playground with a spoken question; Speech
playground (speech to text in es-CR, text to speech with `es-CR-MariaNeural` and `es-CR-JuanNeural`); image playground for the poster.
Then run `vision.py`, `voz_modelo.py`, `afiche.py` and `habla.py`. Discuss disclosure of generated images and photos of people.

## Build notes and risks
- **Region matters.** On 2026-10-04 `gpt-audio-mini` was offered in Central US, East US 2 and Sweden Central; `gpt-image-1-mini` only in East US 2 and Sweden Central. The image model defaults to off for that reason; use the "Everything" preset in East US 2 or Sweden Central. Image models may also need access approval.
- The Python examples were **not run** against a real subscription. `habla.py` uses the account key and region (the SDK's identity flow is more involved); the others use the identity and need Azure AI User on the project.
- Capacity for an image deployment is images per minute, not tokens: the lab asks for the minimum.

## As built
- One module `ai` (shared Foundry module). The audio and image deployments are added to the template's `deployments` array only when chosen.
