# 14 · Coffee: seasonal demand (machine learning)

Blueprint `cr-cafe-demanda` · code `ccafe` · **Status: Spec** · Batch 2

**Exam mapping:** AI-900 (fundamental principles of machine learning on Azure: regression, classification, clustering, training and validation data, features and labels, no-code tools, responsible AI).

## Scenario
A coffee roaster in Heredia sells more in the cold months and before holidays, but orders beans by feel and either
runs out or throws away stock. He has three years of monthly sales and wants a number to order from.

## Students learn
- Tell regression, classification and clustering apart using coffee examples.
- Explain features, labels, training and test data, and overfitting in plain words.
- Train a forecasting or regression model without code and read its error metrics.
- Judge whether the prediction is trustworthy and name what could make it wrong (new competitor, a promotion).

## Architecture
Azure Machine Learning workspace (with its storage account, key vault and monitoring), a compute cluster that scales to
zero, and a **synthetic** three-year monthly sales dataset. Work in the studio with automated ML or the designer.

## Knobs
`dataset`: clean / with gaps and outliers (teaches data preparation), `computeSize`.

## Cost and time
Workspace idle is pennies; the compute cluster bills only while a job runs (about $0.10 to $0.20/hour for a small CPU
size). Deploy 4 to 8 min. Lifetime: one class.

## Student activities
Load the dataset; run automated ML for a short time; read metrics and the best model; try the data with gaps and compare.

## Student-mode policy pack
One workspace, CPU cluster with min nodes 0 and max 1 of an allowed small size, no GPU, no managed online endpoints,
job time limit.

## Build notes and risks
- Compute-family vCPU quota is often 0 on new subscriptions; the preflight VM-size and quota checks apply.
- ML workspaces support soft delete, so destroy must purge to reuse names.
- Automated ML can run for hours by default: set time limits in the guide and in policy.
- Keep the story short on math; AI-900 is conceptual.
