param labName string
param location string
param tags object

// The daily cap is the cost control: ingestion stops for the day once it is reached.
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

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${labName}-insights'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
  }
}

output workspaceId string = workspace.id
output workspaceName string = workspace.name
output insightsId string = insights.id
output insightsName string = insights.name
output connectionString string = insights.properties.ConnectionString
