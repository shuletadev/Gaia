# 13 · Branch network (later)

Blueprint `cr-sucursales-red` · code `csucur` · **Status: Built** (Bicep, blueprint, tests; not yet deployed to Azure) · Batch 3, after demand for AZ-104 is clear

**Exam mapping:** AZ-104 (implement and manage virtual networking: VNets, peering, NSGs, load balancing, private DNS; deploy and manage compute: VMs; monitor and maintain).

## Scenario
A cooperative with three branches (San Ramón, Grecia, Naranjo) wants each branch's staff to reach the central
accounting system, and nothing else, without opening it to the internet.

## Students learn (draft)
Design address ranges that do not overlap; peer a hub to spokes; control traffic with NSGs; balance two servers behind a
Standard load balancer; resolve names with a private DNS zone; read connection and flow diagnostics.

## Architecture (draft)
Hub VNet and two spoke VNets with peering, NSGs, two small VMs behind a Standard load balancer, a private DNS zone.
No Bastion or firewall (cost); access through Run Command.

## Cost and time
Moderate: two VMs, load balancer and public IPs, about $0.10 to $0.15/hour. Deploy 8 to 15 min. Lifetime: short.

## Build notes and risks
- Resembles the hub-and-spoke lab that was removed from the catalog; the old Bicep is in git history (`a805272`) as a reference.
- Quotas for public IPs and VM sizes will bite in a full class.
- Postpone until the AZ-104 business case is decided; the fundamentals batches come first.

## As built
- Built (it was an outline). Hub plus two spokes (central web servers, Grecia branch) with peering in both directions, so spoke to spoke is not reachable: non-transitive peering is the lesson.
- Standard load balancer over two nginx servers in an availability set (outbound rule so they can install nginx), a private DNS zone linked to all three networks with auto-registration on the web spoke, and an optional client VM with no public IP in the branch. About $0.077/h.
- Access is through Run Command in the portal; no SSH and no Bastion.
