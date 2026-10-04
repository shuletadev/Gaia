# 06 · Tour operator: scale and uptime

Blueprint `cr-tour-escala` · code `ctour` · **Status: Spec** · Batch 2

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

## Student activities
Generate load with a provided script or a browser tab loop; watch the instance count; deploy a changed page to the
slot and swap; break the health check and see the instance taken out of rotation.

## Student-mode policy pack
App Service plans Standard only, instance count capped at 3, one slot, no Premium tiers, no zone redundancy.

## Build notes and risks
- Needs real page content: zip-deploy content kind or a public container image.
- Load generation in class by 30 students multiplies cost: the cap matters most here.
- Autoscale takes minutes to react; plan the activity timing.
- Slots and autoscale are not available on Free or Basic, so the preflight should explain a downgrade clearly.
