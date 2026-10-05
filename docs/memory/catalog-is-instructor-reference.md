---
name: catalog-is-instructor-reference
description: "Gaia's lab blueprints (14 at first, 22 now) are instructor demo material; students build Microsoft Learn's recommended labs instead"
metadata:
  node_type: memory
  type: project
  originSessionId: 8c633da8-44a4-4227-a1dd-10ebf615cc32
  modified: 2026-10-05T12:56:54.341Z
---

The labs in `blueprints/cr-*` (14 originally, 22 since 2026-10-04; Costa Rican scenarios: pharmacy, pulperia, soda, clinic...) are **instructor reference material**. The instructor deploys them to explain exam topics in class. **Students do not build them.**

The labs students build are the ones **recommended by Microsoft Learn** for each course.

**Why:** the user (Marco, an MCT who runs a certification-prep business with a partner) clarified this on 2026-10-04, after I had designed "student-mode policy packs" derived from the catalog cards, which was the wrong source.

**How to apply:**
- Never derive student guardrails (Azure Policy packs, allowed resource types, caps) from the catalog cards. They come from what the Microsoft Learn labs of each course deploy; an inventory of those is the next research task.
- Catalog work is demo quality: instructor talk track, scenario, visuals. No per-student ownership, caps or cleanup are needed for catalog labs.
- Student-side Gaia features (spend tracking, RBAC view, cleanup, lifecycle) apply to the Learn labs. Some Learn exercises use Microsoft's free sandbox and need no subscription; whether that is the plan is an open question to confirm with the user.
- The user wants to audit the catalog and deploy-test it later; do not deploy labs to their subscription until they say so.

See [[gaia-roadmap-decisions]] for the wider plan.
