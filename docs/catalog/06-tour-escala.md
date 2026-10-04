# 06 · Tour operator: scale and uptime

Blueprint `cr-tour-escala` · code `ctour` · **Status: Built** (Bicep, blueprint, tests; not yet deployed to Azure) · Batch 2

**Exam mapping:** AZ-900 (cloud concepts: high availability, scalability, elasticity, reliability, predictability; architecture: App Service, regions and availability).

## Scenario
A tour operator in Guanacaste gets almost all its bookings in the weeks before December. Its site slows to a crawl in
high season and goes down during updates. The owner wants it to grow when busy, shrink when quiet, and update without
downtime.

## Students learn
- Explain vertical vs horizontal scaling and elasticity with a live example.
- Configure an autoscale rule and see instances change.
- Use a deployment slot to stage an update and swap it with no downtime.
- Explain availability, the difference between a region and an availability zone, and what a health check does.

## Architecture
App Service plan (Standard, which supports slots and autoscale), a web app with a `staging` slot, autoscale rule
(CPU above 70 percent adds an instance, up to 3), a health-check path, Application Insights (workspace-based).

## Knobs
`planSku` (Basic/Standard: shows what slots and autoscale need), `maxInstances`, `healthCheck` on/off.

## Cost and time
About $0.10/hour per Standard instance, so up to about $0.30/hour while scaled out. Deploy 4 to 7 min. Lifetime: **short** (2 to 4 hours).

## Class activities (instructor-led)
Generate load with a provided script or a browser tab loop; watch the instance count; deploy a changed page to the
slot and swap; break the health check and see the instance taken out of rotation.

## Build notes and risks
- Needs real page content: zip-deploy content kind or a public container image.
- The load button runs from whoever opens the page: the instructor demonstrates it once; a whole class pressing it would multiply the cost.
- Autoscale takes minutes to react; plan the activity timing.
- Slots and autoscale are not available on Free or Basic, so the preflight should explain a downgrade clearly.

## As built
- Standard S1 Linux ($0.095/h per instance). Autoscale: add an instance above 70% CPU for 5 minutes, remove one below 30% for 10, up to 2 or 3 instances.
- A staging slot runs version 2 of the same page; production runs version 1. The page shows the version and the instance that answered, and has a button that simulates the busy season (8 parallel requests for 30 seconds against /work, which burns CPU).
- Both pages come from one Node server delivered through an app setting; no deployment step. Verified locally: /health, /work, version and instance tokens, and the load button.
- Application Insights (workspace-based) is wired in through app settings.
