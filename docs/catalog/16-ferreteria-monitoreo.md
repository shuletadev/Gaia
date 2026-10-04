# 16 · Ferretería El Tornillo: monitoring and alerts

Blueprint `cr-ferreteria-monitoreo` · code `cferre` · **Status: Built** (Bicep, blueprint, tests; not deployed to Azure) · Batch 4

**Exam mapping:** AZ-900 (monitoring tools: Azure Monitor, Log Analytics, alerts, Application Insights, Service Health, Advisor) · AZ-104 (monitor resources: metrics, log settings, KQL queries, alert rules, action groups, alert processing rules).

## Scenario
A hardware store in Heredia sells online. Last month the payment step broke on a Saturday night and the owner found out on
Monday from an angry customer. She wants Azure to tell her when the shop slows down or fails, and to see what happened afterwards.

## Students learn
- Read a metric chart (requests, server errors, response time) and say what each tells you.
- Query the web server's logs with KQL in Log Analytics.
- Tell a metric alert, a log alert, an activity log alert and a service health alert apart.
- Follow an alert from the rule to the action group and the email; mute it in a maintenance window with a processing rule.
- Open Application Insights, Azure Advisor and Service Health in the portal.

## Architecture / Knobs
Log Analytics workspace (30 days, 1 GB/day cap), workspace-based Application Insights, a Basic B1 web app whose logs and metrics go
to the workspace (diagnostic settings), an action group (email), two metric alerts (5xx, response time), a log alert (KQL on
`requests`), an activity-log alert (web app deleted), a service-health alert, and an alert processing rule (Sunday 02:00 to 04:00).
Knobs: `errorThreshold`, `maintenanceRule`.

## Cost and time
About $0.02/h (the B1 plan; Azure Monitor charges only for log volume and a few cents per log-alert rule). Deploy 4 to 8 min.
Lifetime: a class.

## Class activities (instructor-led)
Press the three buttons on the shop's page (10 orders, 8 errors, 4 slow responses). Watch Requests and Http5xx in Metrics.
In Logs run `AppServiceHTTPLogs | where ScStatus >= 500 | summarize count() by bin(TimeGenerated, 1m)`. Wait for the email.
Show the alert rules, the action group, the processing rule and what "muting" does and does not do. Delete nothing; show the
activity log entry for any change. Open Advisor and Service Health (they have no template: read-only demos).

## Build notes and risks
- Metric alerts take a few minutes to fire; log alerts a few more. Plan the timing.
- The email goes to the signed-in owner (`ctx.owner`). Check the address before class.
- Application Insights auto-instrumentation for Node on Linux is turned on through app settings (same as lab 06).
- The log alert and processing-rule schemas are the likeliest first-deploy surprises (API versions `2022-06-15` and `2021-08-08`).

## As built
- Four modules: `monitor`, `app`, `alerts` (inside `lab`). Server is a tiny Node server shipped through an app setting: `/health`, `/compra`, `/error` (logs an error and returns 500), `/lento` (4 s). Spanish page with the three buttons.
- Azure's `deployment sub validate` accepted the template; nested resources were not deeply validated because the group does not exist yet.
