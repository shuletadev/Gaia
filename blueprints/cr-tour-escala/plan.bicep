param labName string
param location string
param tags object
param maxInstances int

// Standard is the first tier that offers deployment slots and autoscale.
resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${labName}-plan'
  location: location
  tags: tags
  kind: 'linux'
  sku: { name: 'S1', tier: 'Standard', capacity: 1 }
  properties: { reserved: true }
}

// Add an instance when the CPU stays above 70% for five minutes; remove one when it stays below 30% for ten.
resource autoscale 'Microsoft.Insights/autoscalesettings@2022-10-01' = {
  name: '${labName}-autoscale'
  location: location
  tags: tags
  properties: {
    enabled: true
    targetResourceUri: plan.id
    profiles: [
      {
        name: 'por-cpu'
        capacity: { minimum: '1', maximum: string(maxInstances), default: '1' }
        rules: [
          {
            metricTrigger: {
              metricName: 'CpuPercentage'
              metricResourceUri: plan.id
              timeGrain: 'PT1M'
              statistic: 'Average'
              timeWindow: 'PT5M'
              timeAggregation: 'Average'
              operator: 'GreaterThan'
              threshold: 70
            }
            scaleAction: { direction: 'Increase', type: 'ChangeCount', value: '1', cooldown: 'PT5M' }
          }
          {
            metricTrigger: {
              metricName: 'CpuPercentage'
              metricResourceUri: plan.id
              timeGrain: 'PT1M'
              statistic: 'Average'
              timeWindow: 'PT10M'
              timeAggregation: 'Average'
              operator: 'LessThan'
              threshold: 30
            }
            scaleAction: { direction: 'Decrease', type: 'ChangeCount', value: '1', cooldown: 'PT10M' }
          }
        ]
      }
    ]
  }
}

output id string = plan.id
output name string = plan.name
