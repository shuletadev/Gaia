# 05 · Cooperativa: governance

Blueprint `cr-cooperativa-gobierno` · code `ccoop` · **Status: Built** (Bicep, blueprint, tests; not yet deployed to Azure) · Batch 1

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
and (see build notes) no role assignment: students do that step themselves in the portal.

## Knobs
`allowedRegions` (five US regions or only the lab's), `requireTag`, `restrictStorage`, `enforce` (deny or report only), `budgetUsd`. The optional Reader principal was dropped: the launch form has no free-text field, and assigning a role is a student activity anyway.

## Cost and time
Effectively free (policy, locks and budgets cost nothing; storage pennies). Deploy 2 to 3 min. Lifetime: one class.

## Class activities (instructor-led)
Try to create a resource in a blocked region and read the denial; remove the tag requirement and see compliance
change; try to delete the locked account; open the budget and the cost-by-tag view.

## Build notes and risks
- **Built as designed**: three department storage accounts (tagged centroCosto), a `CanNotDelete` lock on the accounting one, three built-in policy assignments (allowed regions, require tag, Standard_LRS only), and a monthly budget with 80% and 100% alerts. Knobs: regions, tag rule, storage rule, enforce vs report only, budget amount.
- **Needs Owner**: policy assignments and locks need rights Contributor lacks. The preflight now says so before launch, and removing the lock on destroy needs the same.
- **Lock removal on destroy is implemented** (`removeLocks` in the engine): only locks on the lab group or its resources, never inherited ones.
- The `url` output is the resource group's portal link (there is no web page to check, so no readiness gate).
- Not verified on a real deploy: budget creation depends on the subscription type (Cost Management access).
- ~~A delete lock blocks deleting the lab group~~ handled by `removeLocks`.
- Policy changes take several minutes to apply; the guide must say so.
- Budget alert emails need a contact address (the lab owner).
- Students assign a role to a classmate in the portal; the guide should name the safe role (Reader) and scope (their own group).
