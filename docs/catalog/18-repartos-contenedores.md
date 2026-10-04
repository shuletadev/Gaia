# 18 · Repartos Rapidito: containers

Blueprint `cr-repartos-contenedores` · code `crepar` · **Status: Built** (Bicep, blueprint, tests; not deployed to Azure) · Batch 4

**Exam mapping:** AZ-900 (compute types: containers, virtual machines, functions; application hosting options) · AZ-104 (provision and manage containers: Container Registry, Container Instances, Container Apps, sizing and scaling).

## Scenario
A food-delivery startup in San José has an order-tracking page that works on the developers' laptops and breaks on the server
because the machines differ. They put it in a container; the class compares three ways to run and store one in Azure.

## Students learn
What a container is versus a VM; importing an image into a registry; running the same image on Container Instances and Container
Apps and comparing billing and scaling; HTTP-based scaling down to zero and back; sizing CPU and memory.

## Architecture / Knobs
Container registry (Basic or Standard, admin user off, starts empty), a container group on Container Instances (0.5 vCPU, 1 GB,
public DNS name, Microsoft's hello-world image), and a Container Apps consumption environment with one app (0.25 vCPU, 0.5 GiB,
external ingress, scale rule: one replica per 10 concurrent requests). Knobs: `registrySku`, `minReplicas` (0 or 1), `maxReplicas`.

## Cost and time
About $0.04/h (registry about $0.007, container group about $0.03; a scale-to-zero app costs nothing idle). Deploy 3 to 7 min.

## Class activities (instructor-led)
```bash
az acr import --name <registro> --source mcr.microsoft.com/azuredocs/aci-helloworld:latest --image repartos:v1
az acr repository list --name <registro>
az container logs --name <lab>-aci --resource-group <lab>
```
Open the registry's repositories; open both URLs; with `minReplicas` 0 wait idle and reload (cold start), then generate traffic with
a browser loop or `hey`/`ab` and watch replicas under Revisions and replicas; edit CPU and memory in the portal and read the new
revision; stop and start the container group and compare with scale to zero.

## Build notes and risks
- Container Instances and Container Apps are not in every region; preflight checks the types. Providers `Microsoft.ContainerInstance`, `Microsoft.ContainerRegistry` and `Microsoft.App` must be registered.
- The environment has no log workspace, to avoid an extra billable resource: log streaming works, log queries do not. Add one if the class needs it.
- Images come from Microsoft's public registry, so no build step is needed. Pushing a student's own image needs Docker or `az acr build`.

## As built
- Modules `registry`, `instance`, `app` (inside `lab`). The gate checks the container app's URL (non-blocking).
