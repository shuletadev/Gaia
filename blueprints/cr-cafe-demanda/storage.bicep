param labName string
param location string
param tags object

var accountName = take('${replace(labName, '-', '')}${uniqueString(resourceGroup().id)}', 24)

// The workspace's own storage; the coffee sales dataset goes in the "datos" container.
resource account 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: accountName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    // labctl uploads the dataset, and the workspace's datastore, with the account key.
    allowSharedKeyAccess: true
  }
}

resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: account
  name: 'default'
}

resource data 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'datos'
  properties: { publicAccess: 'None' }
}

output name string = account.name
