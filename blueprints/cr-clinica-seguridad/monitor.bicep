param labName string
param location string
param tags object

// Where the audit trail goes. The daily cap keeps a runaway log from becoming a bill.
resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${labName}-logs'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: 1 }
  }
}

output workspaceId string = workspace.id
