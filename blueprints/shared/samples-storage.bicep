// A storage account with one private container for synthetic sample files (uploaded by labctl after deployment).
param labName string
param location string
param tags object

@description('Container that receives the sample files.')
param container string = 'muestras'

@description('Web origins allowed to read the files from the browser (Studio tools).')
param corsOrigins array = []

@allowed(['Standard_LRS', 'Standard_GRS'])
param skuName string = 'Standard_LRS'

var accountName = take('${replace(labName, '-', '')}${uniqueString(resourceGroup().id)}', 24)

resource account 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: accountName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: skuName }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    // labctl uploads the sample files with the account key.
    allowSharedKeyAccess: true
  }
}

resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: account
  name: 'default'
  properties: {
    cors: {
      corsRules: empty(corsOrigins) ? [] : [
        {
          allowedOrigins: corsOrigins
          allowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT']
          allowedHeaders: ['*']
          exposedHeaders: ['*']
          maxAgeInSeconds: 200
        }
      ]
    }
  }
}

resource samples 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: container
  properties: { publicAccess: 'None' }
}

output name string = account.name
output container string = samples.name
