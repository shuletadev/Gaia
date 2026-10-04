# 08 · Tourist reviews

Blueprint `cr-resenas-turismo` · code `cresen` · **Status: Built** (Bicep, blueprint, tests; not yet deployed to Azure) · Batch 1

**Exam mapping:** AI-901 (common text analysis techniques: keyword extraction, entity detection, sentiment analysis, summarization; responsible AI). *Was AI-900, retired 30 June 2026.*

## Scenario
A hotel group in La Fortuna gets hundreds of reviews in Spanish and English on several sites. The manager reads a few
and misses the pattern: is the problem the breakfast, the noise, or the road? She wants the computer to tell her.

## Students learn
- Run sentiment analysis, key-phrase extraction and language detection on Spanish and English text.
- Translate reviews between Spanish and English.
- Read the results critically: sarcasm, slang ("tuanis", "mae") and mixed-sentiment reviews.
- Explain the difference between sentiment on a document and on each sentence.

## Architecture
Azure AI services account (Language and Translator capabilities) and a Storage account with a `resenas` container
holding about 50 **synthetic** reviews in Spanish and English (some with Costa Rican slang). Studio-based; no custom app.

## Knobs
`dataset`: small / with slang / mixed languages.

## Cost and time
Pay per text record, idle about $0 (free tiers exist with monthly limits). Deploy 2 to 4 min. Lifetime: one class.

## Class activities (instructor-led)
Analyze the whole set; chart sentiment by topic by hand from the key phrases; find three reviews the model got wrong
and explain why; translate a review and judge the quality.

## Build notes and risks
- Shares the AI-services Bicep module with lab 07; build them together.
- Soft-deleted accounts must be purged on destroy.
- Synthetic reviews must be written by us; avoid real names and real businesses.
- Language availability and slang handling vary; test with the actual studio before class.

## As built
- Same AI services module as lab 07, with Language Studio as the CORS origin. 60 synthetic reviews (or 20) in Spanish and English, some with Costa Rican slang and some sarcastic, generated at deploy time.
- Destroy purges the soft-deleted AI account.
