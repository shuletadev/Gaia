param labName string
param location string
param tags object
param accountName string
param dfsUrl string
param openFirewall bool
@secure()
param adminPassword string

// Built-in role "Storage Blob Data Contributor": lets the workspace read and write files in the lake.
var blobDataContributor = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

resource account 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: accountName
}

resource workspace 'Microsoft.Synapse/workspaces@2021-06-01' = {
  name: '${labName}-syn'
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    defaultDataLakeStorage: { accountUrl: dfsUrl, filesystem: 'workspace' }
    sqlAdministratorLogin: 'synapseAdmin'
    sqlAdministratorLoginPassword: adminPassword
    managedResourceGroupName: '${labName}-synapse-mrg'
    publicNetworkAccess: 'Enabled'
  }
}

resource lakeAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(account.id, workspace.id, blobDataContributor)
  scope: account
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataContributor)
    principalId: workspace.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource firewall 'Microsoft.Synapse/workspaces/firewallRules@2021-06-01' = if (openFirewall) {
  parent: workspace
  name: 'allowAll'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '255.255.255.255' }
}

output name string = workspace.name
output studioUrl string = workspace.properties.connectivityEndpoints.web
output sqlEndpoint string = workspace.properties.connectivityEndpoints.sqlOnDemand
