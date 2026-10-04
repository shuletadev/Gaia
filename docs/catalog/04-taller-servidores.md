# 04 · Taller Los Ángeles: servers (IaaS vs PaaS)

Blueprint `cr-taller-servidores` · code `ctall` · **Status: Built** (Bicep, blueprint, tests; not yet deployed to Azure) · Batch 1

**Exam mapping:** AZ-900 (cloud concepts: IaaS, PaaS, SaaS, shared responsibility, consumption model) · AZ-900 (management and governance: cost factors, tags, auto-shutdown).

## Scenario
A car repair shop in Alajuela runs its appointment page on an old PC under the counter. When the PC dies, so do the
appointments. The owner's nephew says "put it on a server in the cloud". The class compares two ways to do that.

## Students learn
- Place IaaS, PaaS and SaaS on a real example, and draw the shared-responsibility line for each.
- See what a VM needs around it (disk, network interface, IP, NSG) versus a PaaS host.
- Read a bill by resource and see how tags and auto-shutdown change it.
- Explain why the same page costs and demands differently on each host.

## Architecture
**IaaS side:** one small Linux VM (B-series), managed disk, NIC, Standard public IP, NSG allowing only HTTP, a web page
installed by cloud-init, auto-shutdown schedule. **PaaS side:** a Linux App Service (Free or Basic) or a public
container image serving the same page. Tags `centroCosto`, `dueño`. No inbound SSH: access through the portal (Run
Command / Serial console).

## Knobs
`vmSize` (two or three B-series sizes), `autoShutdown` on/off and time, `paasTier` (Free/Basic).

## Cost and time
IaaS about $0.02/hour all-in (VM, disk, IP); PaaS Free or about $0.02/hour on Basic. Deploy 4 to 8 min. Lifetime: one class.

## Class activities (instructor-led)
Open both pages; list every resource the VM needs versus the App Service; stop and start the VM and watch the cost
meter; find which tasks (patching, scaling) are theirs on each side; add a tag and filter Cost Analysis by it.

## Build notes and risks
- **Built as designed**: the VM page comes from cloud-init; the App Service page comes from a tiny Node startup command fed through an app setting, so neither needs a deployment step. Verify both on the first real deploy (App Service startup-command quoting is the likeliest snag).
- Prices checked against the Retail Prices API: default $0.021/h, "Roomier" preset $0.076/h.
- Admin password comes from the existing `vm-password` hook; students never need it.
- Page content on App Service needs either a zip-deploy content kind or a public container image (`mcr.microsoft.com/appsvc/staticsite`); verify when building.
- VM size quota (B-series) can be 0 on new subscriptions; the preflight VM-size check already reports it.
- Standard public IPs have a regional quota and an hourly charge:
