# 11 · Monthly sales report

Blueprint `cr-ventas-reporte` · code `cvent` · **Status: Built** (Bicep, blueprint, tests; not yet deployed to Azure) · Batch 2

**Exam mapping:** DP-900 (analytics workloads: data lake, batch vs streaming, ETL/ELT, data warehousing, visualization; core data concepts).

## Scenario
The pharmacy of lab 01 has a year of sales in files. The owner asks: which products sell in the rainy season, which
hours are busiest, and what should she order for December? She wants a monthly report without a data team.

## Students learn
- Describe a data lake and why files in a lake are not a database.
- Query files in place with SQL, then aggregate by month, product and hour.
- Explain batch vs streaming with this example, and ETL vs ELT.
- Connect a reporting tool to the result and read a basic dashboard.

## Architecture
A data-lake Storage account (hierarchical namespace) with a year of **synthetic** sales files (CSV and Parquet), an
analytics workspace with a serverless SQL endpoint, and a ready-made query script.

## Knobs
`dataSize`: one year / three years; `fileFormat`: CSV / Parquet (shows the cost and speed difference).

## Cost and time
Serverless SQL bills by data processed (a few dollars per terabyte): pennies for the sample. Workspace idle about $0.
Deploy 5 to 10 min. Lifetime: one class.

## Class activities (instructor-led)
Run the monthly query on CSV and on Parquet and compare bytes processed; chart the top ten products; explain which
parts are batch and what would change for live sales.

## Build notes and risks
- **Decision pending: Synapse or Microsoft Fabric.** Check what the current DP-900 outline emphasizes and which one you can deploy and clean up reliably. Fabric capacity is hourly and pausable; Synapse serverless is pay per query.
- Needs data-lake seeding (generated files) and possibly a SQL script.
- Workspace creation needs a SQL admin and a managed resource group; destroy must handle both.
- Reuse the lab 01 sales schema so the story connects.

## As built
- Built on Synapse serverless SQL. The current official DP-900 analytics labs teach **Microsoft Fabric** (see ../learn-labs/dp-900.md), so this lab is now a data-lake demo; a Fabric variant is optional and depends on whether the business tenant has Fabric. Parquet was dropped (no writer without a heavy dependency): CSV only.
- Needs Owner: the workspace identity gets Storage Blob Data Contributor on the lake. Students still need a data role of their own to query (that is a lesson). Sample queries are in blueprints/cr-ventas-reporte/consultas.sql.
- The workspace firewall is open to all addresses by default so Studio works from a classroom; the data is synthetic. Turn it off for anything real.
