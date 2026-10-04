# 15 · Identity demo (instructor-led)

Blueprint: **none (guide only)** · **Status: Spec** · Batch 3

**Exam mapping:** SC-900 (concepts of security, compliance and identity; capabilities of Microsoft Entra: identities, authentication and MFA, Conditional Access, roles and governance) · AZ-900 (identity, access and security).

## Why no blueprint
Identity features live at the **tenant** level, not in a resource group: users, groups, MFA, Conditional Access and
role assignments. A student must not get the rights to change them in the business tenant, so this is a live
demonstration by the instructor, not a lab students deploy.

## Scenario
The clinic from lab 12 now wants staff to sign in once, with a second factor, and wants a visiting accountant to have
access to one folder for one month.

## What the instructor demonstrates
- Users, groups and a guest invitation (B2B).
- Multi-factor authentication and the security defaults.
- A Conditional Access policy (requires an Entra plan that includes it: **check the licence first**).
- A role assignment at resource-group scope, and the difference between Entra roles and Azure roles.
- Access reviews and privileged access, at concept level (higher plans).

## Gaia's part (later)
A checklist per demo, and eventually Microsoft Graph automation to create and clean up demo users in the business
tenant. Not before the platform phase.

## Gap to note
**SC-900 compliance solutions (Microsoft Purview, compliance and information protection)** are Microsoft 365 services.
They have no lab here; cover them with slides and a licensed demo tenant if you have one.

## Build notes and risks
- Which Entra plan the business tenant has decides what can be shown live.
- Demo accounts need a reset routine so the next class starts clean.
