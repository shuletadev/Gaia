param labName string
param location string
param tags object

var accountName = take('${replace(labName, '-', '')}${uniqueString(resourceGroup().id)}', 24)

// Hierarchical namespace turns Blob Storage into a data lake (Data Lake Storage Gen2): real folders, file-level permissions.
resource account 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: accountName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    isHnsEnabled: true
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    // labctl uploads the sample sales files with the account key.
    allowSharedKeyAccess: true
  }
}

resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: account
  name: 'default'
}

// Where the sales files land, and the file system Synapse keeps its own working files in.
resource sales 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'ventas'
  properties: { publicAccess: 'None' }
}

resource workspaceFs 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'workspace'
  properties: { publicAccess: 'None' }
}

output name string = account.name
output dfsUrl string = account.properties.primaryEndpoints.dfs
