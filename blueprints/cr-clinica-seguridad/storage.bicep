param labName string
param location string
param tags object
param networkLockdown bool

var accountName = take('${replace(labName, '-', '')}${uniqueString(resourceGroup().id)}', 24)

// Patient records. With the lockdown on, the firewall denies everything except trusted Azure services,
// so reading the files from the portal needs the student's own IP added: that is the exercise.
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
    networkAcls: {
      defaultAction: networkLockdown ? 'Deny' : 'Allow'
      bypass: 'AzureServices'
    }
  }
}

resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: account
  name: 'default'
}

resource records 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'expedientes'
  properties: { publicAccess: 'None' }
}

output name string = account.name
