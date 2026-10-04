param labName string
param location string
param tags object
param computeSize string
param storageName string
param vaultName string
param insightsId string

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageName
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: vaultName
}

resource workspace 'Microsoft.MachineLearningServices/workspaces@2024-04-01' = {
  name: '${labName}-ml'
  location: location
  tags: tags
  sku: { name: 'Basic', tier: 'Basic' }
  identity: { type: 'SystemAssigned' }
  properties: {
    friendlyName: 'Café: demanda de temporada'
    storageAccount: storage.id
    keyVault: vault.id
    applicationInsights: insightsId
    publicNetworkAccess: 'Enabled'
  }
}

// Scales to zero: nothing is billed while no job runs, and a node shuts down five minutes after its job ends.
resource cluster 'Microsoft.MachineLearningServices/workspaces/computes@2024-04-01' = {
  parent: workspace
  name: 'cluster-cpu'
  location: location
  properties: {
    computeType: 'AmlCompute'
    properties: {
      vmSize: computeSize
      vmPriority: 'Dedicated'
      scaleSettings: { minNodeCount: 0, maxNodeCount: 1, nodeIdleTimeBeforeScaleDown: 'PT5M' }
      remoteLoginPortPublicAccess: 'Disabled'
    }
  }
}

// The container with the sales dataset, so students can register it as a data asset in the studio.
resource datastore 'Microsoft.MachineLearningServices/workspaces/datastores@2024-04-01' = {
  parent: workspace
  name: 'datos'
  properties: {
    datastoreType: 'AzureBlob'
    accountName: storage.name
    containerName: 'datos'
    endpoint: environment().suffixes.storage
    protocol: 'https'
    serviceDataAccessAuthIdentity: 'None'
    credentials: {
      credentialsType: 'AccountKey'
      secrets: { secretsType: 'AccountKey', key: storage.listKeys().keys[0].value }
    }
  }
}

output name string = workspace.name
output compute string = cluster.name
output studioUrl string = 'https://ml.azure.com/?wsid=${workspace.id}'
