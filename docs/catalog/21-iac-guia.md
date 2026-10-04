# 21 · Infrastructure as code (instructor-led guide)

No blueprint (guide only, like card 15) · **Status: Written** · Batch 4

**Exam mapping:** AZ-900 (infrastructure as code, Azure Resource Manager and ARM templates) · AZ-104 (automate deployment with ARM templates or Bicep: interpret, modify, deploy, export a deployment, convert a template to Bicep).

## Scenario
Every lab in this catalog is itself a Bicep deployment, so the class already has real examples. The guide uses lab 05
(governance) or lab 03 (website) as the specimen.

## Students learn
Read a Bicep file (parameters, resources, modules, outputs); see the same thing as ARM JSON; export what exists in a resource group
and turn it into Bicep; change a parameter, preview with what-if and deploy.

## Class activities (instructor-led)
1. **Read it.** Open `blueprints/cr-cooperativa-gobierno/main.bicep` and `storage.bicep`: parameters with `@allowed`, the resource group,
   a module, outputs. Ask: what would change if `enforce` were false?
2. **Compile it.** `az bicep build --file main.bicep` and open the JSON: the same deployment, as ARM.
3. **Export what exists.** Deploy the lab from Gaia, then in the portal open the resource group, **Export template** (or
   `az group export --name <lab> > exportada.json`). Note what is missing or noisy.
4. **Convert.** `az bicep decompile --file exportada.json`, then read the warnings and clean up one resource.
5. **Change and preview.** In a scratch group:
   ```bash
   az group create --name rg-clase-iac --location centralus
   # blueprints/cr-fincas-archivo/storage.bicep: a storage account with a redundancy parameter
   az deployment group what-if --resource-group rg-clase-iac --template-file storage.bicep --parameters labName=lab-iac location=centralus tags='{}' enableVersioning=true redundancy=LRS
   az deployment group create  --resource-group rg-clase-iac --template-file storage.bicep --parameters labName=lab-iac location=centralus tags='{}' enableVersioning=true redundancy=LRS
   az deployment group what-if --resource-group rg-clase-iac --template-file storage.bicep --parameters labName=lab-iac location=centralus tags='{}' enableVersioning=true redundancy=GRS
   az group delete --name rg-clase-iac --yes
   ```
   (The first `what-if` shows "Create"; after deploying with LRS, the last one shows "Modify".)
6. **Compare** a template (declarative, repeatable) with clicking in the portal, and with imperative scripts (CLI or PowerShell).

## Build notes
- Nothing to deploy for this guide beyond a lab from the catalog. Keep a scratch group name consistent so Gaia's cleanup can adopt it.
- Gaia deploys each lab as a **deployment stack**; mention it as the way to manage and delete what a template created.
