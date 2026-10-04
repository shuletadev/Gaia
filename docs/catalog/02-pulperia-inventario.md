# 02 · Pulpería Don Beto: inventory

Blueprint `cr-pulperia-inventario` · code `cpulp` · **Status: Spec** · Batch 1

**Exam mapping:** DP-900 (relational data on Azure: tables, keys, SQL, Azure SQL offerings) · AZ-900 (architecture and services: databases, PaaS).

## Scenario
Don Beto runs a corner store in Heredia. Today stock lives in a notebook and he finds out something ran out when a
customer asks. He wants to know what he has, what is low, and what he sold this week.

## Students learn
- Describe tables, rows, primary and foreign keys with a real inventory (`productos`, `proveedores`, `movimientos`).
- Run basic SQL (SELECT, JOIN, GROUP BY) against Azure SQL Database.
- Compare Azure SQL Database, SQL Managed Instance and SQL on a VM, and say why a pulpería picks the first.
- Contrast relational data with lab 01's document model.

## Architecture
Azure SQL Database (single database; serverless with auto-pause, or the free offer / Basic DTU), logical server with
Entra and SQL authentication, a firewall rule for the student's IP, and a small front end (see open questions).

## Knobs
`tier`: Free offer / Basic / serverless General Purpose (shows price vs capability). `seedData`: sample rows on or off.

## Cost and time
Free offer or about $5/month on Basic; serverless adds compute only while in use. Deploy 3 to 6 min. Lifetime: one class.

## Student activities
Connect with the portal's Query editor; write the five questions Don Beto asks ("what is below 5 units?"); add a
product; look at backups and the "Compute + storage" blade to see what is being paid for.

## Student-mode policy pack
`Microsoft.Sql/servers`, `Microsoft.Sql/servers/databases` (Basic or serverless only, max size capped), firewall rules
(no 0.0.0.0-255.255.255.255), no Managed Instance, no elastic pools.

## Build notes and risks
- **Seeding**: needs a content kind that runs a SQL script after deployment (the SQL server must accept the deployer's IP).
- **Front end open question**: Static Web App with a managed API, or App Service. App Service needs a zip-deploy content kind; a Static Web App needs an API for SQL access. Decide when building.
- The free offer is limited per subscription; the lab must detect it already being used.
- SQL logical server names are global; derive from the lab name.
