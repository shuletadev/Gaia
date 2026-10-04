// A Microsoft Foundry resource (an AI services account that can hold projects), one project, and a list of model
// deployments. Pay per use: nothing here costs anything while idle. The name starts with the lab name so a destroy
// can purge the account when it is soft-deleted (see purgeSoftDeleted in the engine).
param labName string
param location string
param tags object

@description('Name of the project inside the resource.')
param projectName string

param projectDisplayName string
param projectDescription string

@description('Model deployments: name, model, version and capacity (thousands of tokens per minute; the cost cap). sku defaults to GlobalStandard.')
param deployments array = []

resource account 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: '${labName}-ai'
  location: location
  tags: tags
  kind: 'AIServices'
  sku: { name: 'S0' }
  identity: { type: 'SystemAssigned' }
  properties: {
    customSubDomainName: '${labName}-ai'
    allowProjectManagement: true
    publicNetworkAccess: 'Enabled'
  }
}

resource project 'Microsoft.CognitiveServices/accounts/projects@2025-06-01' = {
  parent: account
  name: projectName
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    displayName: projectDisplayName
    description: projectDescription
  }
}

// Operations on one AI account run one at a time, so the deployments go one by one, after the project.
@batchSize(1)
resource models 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = [
  for d in deployments: {
    parent: account
    name: d.name
    dependsOn: [project]
    sku: { name: d.?sku ?? 'GlobalStandard', capacity: d.capacity }
    properties: {
      model: { format: 'OpenAI', name: d.model, version: d.version }
    }
  }
]

output name string = account.name
output endpoint string = account.properties.endpoint
output projectEndpoint string = 'https://${account.name}.services.ai.azure.com/api/projects/${project.name}'
output deployments array = [for (d, i) in deployments: models[i].name]
