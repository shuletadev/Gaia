---
name: catalog-scope-az900-ai901-az104
description: "The instructor catalog is being built for AZ-900, AI-901 and AZ-104 only; AI-900 retired 30 June 2026 and AI-901 replaced it"
metadata:
  node_type: memory
  type: project
  originSessionId: 8c633da8-44a4-4227-a1dd-10ebf615cc32
  modified: 2026-10-04T20:18:03.189Z
---

On 2026-10-04 the user scoped the catalog build to **AZ-900, AI-901 and AZ-104 only** ("we can address the remaining certs later"). They wrote "AI-901" and it is real: AI-900 retired on 30 June 2026 and AI-901 (skills as of 15 April 2026) replaced it, Foundry-based and with no machine learning. Current outlines used: AZ-900 (20 July 2026), AZ-104 (17 April 2026).

Result: the catalog went from 14 to 22 labs (cards 16 to 24, card 21 is a guide only). Labs 07 to 09 were relabelled AI-901; lab 14 (ML) keeps an "AI-900 (retired)" tag as background. The catalog page shows a chip per exam code taken from `scenario.exams`, so every exam line must start with a known code (a test guards it).

**Why:** the business sells certification-prep classes; exam outlines change, and the retired AI-900 labs would have misled students.

**How to apply:** DP-900 and SC-900 cards stay as built and get no new labs until the user takes those exams up. Known gaps: VM scale sets, Bastion, private endpoints, user-defined routes (AZ-104). Nothing has been deployed to Azure yet; the user wants to audit first. See [[catalog-is-instructor-reference]] and [[gaia-roadmap-decisions]].
