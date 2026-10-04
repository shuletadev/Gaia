# 05 · Cooperativa: governance

Blueprint `cr-cooperativa-gobierno` · code `ccoop` · **Status: Spec** · Batch 1

**Exam mapping:** AZ-900 (management and governance: Azure Policy, resource locks, tags, cost management and budgets, role-based access).

## Scenario
A savings cooperative in San Ramón has three departments sharing one Azure subscription. Last month someone created a
large server in the wrong region and nobody noticed until the bill arrived. The manager wants rules, protection for
the accounting data and an alert before money runs out.

## Students learn
- Assign a policy and watch it block a non-compliant resource (allowed regions, required tag, allowed SKUs).
- Protect a resource with a `CanNotDelete` lock and see what it prevents.
- Create a budget with alerts and read cost by tag.
- Assign a built-in role at resource-group scope and explain least privilege.

## Architecture
Resource group with: policy assignments (allowed locations, require tag `centroCosto`, allowed storage SKUs), a storage
account "libros-contables" with a delete lock, a budget at the group with an 80 percent alert, tagged sample resources,
and an optional Reader role assignment for a supplied principal.

## Knobs
`locations` allowed list, `requireTag` on/off, `budgetUsd`, `readerPrincipalId` (optional).

## Cost and time
Effectively free (policy, locks and budgets cost nothing; storage pennies). Deploy 2 to 3 min. Lifetime: one class.

## Student activities
Try to create a resource in a blocked region and read the denial; remove the tag requirement and see compliance
change; try to delete the locked account; open the budget and the cost-by-tag view.

## Student-mode policy pack
This lab *is* a policy demonstration: students may create policy assignments only inside their own group. They may not
change or remove the platform's own policies or locks.

## Build notes and risks
- **A delete lock blocks deleting the lab's resource group.** Destroy must remove locks first (the delete planner already reports locks; the lab destroy path needs a step).
- Policy changes take several minutes to apply; the guide must say so.
- Budget alert emails need a contact address (the lab owner).
- Role assignments need a real principal ID, so keep it optional.
