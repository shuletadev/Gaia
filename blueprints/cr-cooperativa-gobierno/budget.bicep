param labName string
param budgetUsd int
param contactEmail string
param budgetStart string

// Monthly budget for this resource group. Budgets alert; they do not stop spending.
resource budget 'Microsoft.Consumption/budgets@2023-05-01' = {
  name: '${labName}-presupuesto'
  properties: {
    category: 'Cost'
    amount: budgetUsd
    timeGrain: 'Monthly'
    timePeriod: { startDate: budgetStart }
    notifications: {
      alerta80: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 80
        thresholdType: 'Actual'
        contactEmails: [contactEmail]
      }
      alerta100: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 100
        thresholdType: 'Actual'
        contactEmails: [contactEmail]
      }
    }
  }
}
