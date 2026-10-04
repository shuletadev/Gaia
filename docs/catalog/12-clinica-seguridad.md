# 12 · Clinic: protecting data

Blueprint `cr-clinica-seguridad` · code `cclin` · **Status: Spec** · Batch 1

**Exam mapping:** SC-900 (security solutions: network security groups, Defender for Cloud and secure score, key management, logging and monitoring; concepts: defense in depth, shared responsibility, Zero Trust) · AZ-900 (identity, access and security: RBAC, defense in depth).

## Scenario
A private clinic in Cartago keeps appointment records and a database connection string in a shared document on a
laptop. Last month a former employee still had access. The owner wants to know what "secure" would mean without
hiring a security team.

## Students learn
- Explain defense in depth with layers they can point to: identity, network, data, monitoring.
- Store a secret in Key Vault and read it with a managed identity instead of a password in a file.
- Read an NSG and say what it allows and why.
- Read Defender for Cloud recommendations and the secure score, and prioritize three.
- See who accessed a secret from the logs.

## Architecture
Key Vault (RBAC authorization) with a sample secret, a small app or script identity with a managed identity and a
role assignment, an NSG with allow and deny rules, a Storage account with network rules, a Log Analytics workspace
receiving the vault's audit logs, and Defender for Cloud's **free** posture view only (no paid plans enabled).

## Knobs
`networkLockdown` on/off (open vs restricted storage), `auditLogs` on/off.

## Cost and time
Low: Key Vault operations and log ingestion in pennies; no paid Defender plans. Deploy 3 to 6 min. Lifetime: one class.

## Student activities
Read the secret as the identity and as yourself; remove the role and see the access fail; read the audit log entry;
open the secure score and fix one recommendation; compare the lockdown on and off.

## Student-mode policy pack
Key Vault standard only, no paid Defender plans, no firewalls or Sentinel (discussed, not deployed), role assignments
only at their own group.

## Build notes and risks
- **Soft delete**: a deleted Key Vault keeps its name; destroy must purge it, and purge protection must stay off in labs.
- Never enable paid Defender plans by accident: policy must deny it for students.
- Role assignments need the deployer to hold a role that can assign roles.
- Sentinel and Azure Firewall are important SC-900 topics but costly; teach them as slides and screenshots.
