param labName string
param location string
param tags object
param model string
param capacityK int

var versions = {
  'gpt-5-mini': '2025-08-07'
  'gpt-5-nano': '2025-08-07'
  'gpt-5.4-nano': '2026-03-17'
}

// A Foundry resource: an AI services account that can hold projects. The name starts with the lab name so a destroy
// can purge it when it is soft-deleted.
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
  name: 'guia-turistico'
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    displayName: 'Guía turístico de Monteverde (ficticio)'
    description: 'Proyecto de clase: un asistente que responde con los folletos de la oficina de turismo.'
  }
}

// The cap on tokens per minute is the cost control: a class cannot spend faster than this.
resource chat 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: account
  name: 'guia'
  // Operations on one AI account run one at a time, so the deployment waits for the project.
  dependsOn: [project]
  sku: { name: 'GlobalStandard', capacity: capacityK }
  properties: {
    model: { format: 'OpenAI', name: model, version: versions[model] }
  }
}

output name string = account.name
output deployment string = chat.name
