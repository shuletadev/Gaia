# 24 · Coffee cooperative files: Content Understanding

Blueprint `cr-expedientes-contenido` · code `cexped` · **Status: Built** (Bicep, blueprint, tests; not deployed to Azure) · Batch 5 (AI-901)

**Exam mapping:** AI-901 (information extraction with Content Understanding in Foundry: documents and forms, images, audio and video, a lightweight extraction app · techniques to extract information from text, images, audio and video · responsible AI).

## Scenario
A coffee cooperative keeps invoices as PDFs, photos of the harvest, soil reports and the voice messages inspectors leave after each
visit. The administrator wants the numbers and names pulled out instead of retyped.

## Students learn
Running a prebuilt analyzer and reading fields with confidence; analyzing an image, an audio clip and a video clip; creating a small
custom analyzer; which models sit behind an analyzer; why a person still reviews low-confidence fields; privacy of voice and images.

## Architecture / Knobs
Foundry resource and project with `gpt-4.1`, `gpt-4.1-mini` and `text-embedding-3-large` deployments (the models the prebuilt
analyzers need), and a storage account with `expedientes/`: synthetic invoices and receipts (as in lab 07) and synthetic farm photos
and soil reports (as in lab 10), CORS for the studios. Knobs: `sampleSet`, `capacityK`.

## Cost and time
Pay per page, image or minute, plus tokens; idle $0. Deploy 4 to 9 min. Lifetime: a class.

## Class activities (instructor-led)
Give yourself **Cognitive Services User** on the resource. In Content Understanding Studio use **Add resource** to connect the
lab's resource and map its default models to the three deployments (or let Studio auto-deploy). Run `prebuilt-invoice` on an
invoice and `prebuilt-receipt` on a receipt; `prebuilt-imageSearch` on a farm photo; record a 30-second Spanish voice message with a
phone, upload it, and run `prebuilt-audioSearch`; do the same with a short video. Create a custom analyzer for soil reports.

## Build notes and risks
- **Region:** Content Understanding was offered in West US, Sweden Central and Australia East when this was checked; launch in one of them. The lab does not check this at launch.
- The default-model mapping is a data-plane step (Studio, or `PATCH /contentunderstanding/defaults`); it is not in the template.
- No audio or video is generated: synthetic speech or footage would not be meaningful, so the instructor brings a short clip (no real third-party recordings).
- The lab does not replace lab 07 (Document Intelligence Studio with the same synthetic invoices): they are two routes to the same task.

## As built
- Modules `ai` and `storage`. Two blob uploads into one container with disjoint folders.
