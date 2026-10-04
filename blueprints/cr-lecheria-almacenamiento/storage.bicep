param labName string
param location string
param tags object

@description('orig = the main account; repl = the account that receives replicated blobs.')
param role string
param skuName string

@description('Subnet allowed through the firewall once it is turned on; empty for none.')
param subnetId string

var accountName = take('${replace(labName, '-', '')}${role}${uniqueString(resourceGroup().id)}', 24)
var isOrigin = role == 'orig'

resource account 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: accountName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: skuName }
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    // labctl uploads the sample files with the account key, and the class practices managing keys and SAS tokens.
    allowSharedKeyAccess: true
    // Open at the start so the upload works; the class turns the firewall on (selected networks) to see the effect.
    // The subnet is already listed, so it is the one that gets in.
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
      virtualNetworkRules: empty(subnetId) ? [] : [{ id: subnetId, action: 'Allow' }]
    }
  }
}

// Object replication needs versioning on both accounts and the change feed on the source.
resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: account
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 7 }
    containerDeleteRetentionPolicy: { enabled: true, days: 7 }
    isVersioningEnabled: true
    changeFeed: isOrigin ? { enabled: true, retentionInDays: 7 } : null
  }
}

resource documents 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'documentos'
  properties: { publicAccess: 'None' }
}

// An Azure Files share with soft delete, on the main account only (snapshots are taken in class).
resource files 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = if (isOrigin) {
  parent: account
  name: 'default'
  properties: {
    shareDeleteRetentionPolicy: { enabled: true, days: 7 }
  }
}

resource office 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = if (isOrigin) {
  parent: files
  name: 'oficina'
  properties: { shareQuota: 5, accessTier: 'TransactionOptimized' }
}

output name string = account.name
output id string = account.id
