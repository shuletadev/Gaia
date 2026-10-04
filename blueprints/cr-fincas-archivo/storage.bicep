param labName string
param location string
param tags object
param redundancy string
param enableVersioning bool

var accountName = take('${replace(labName, '-', '')}${uniqueString(resourceGroup().id)}', 24)

resource account 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: accountName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_${redundancy}' }
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    // labctl uploads the sample photos with the account key.
    allowSharedKeyAccess: true
  }
}

// Protection against mistakes: deleted blobs and containers stay recoverable for a week, and (optionally) old versions are kept.
resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: account
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 7 }
    containerDeleteRetentionPolicy: { enabled: true, days: 7 }
    isVersioningEnabled: enableVersioning
  }
}

resource photos 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'fincas'
  properties: { publicAccess: 'None' }
}

// The other storage services, so the class can compare all four by use case.
resource files 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = {
  parent: account
  name: 'default'
}

resource office 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  parent: files
  name: 'oficina'
  properties: { shareQuota: 5 }
}

resource queues 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = {
  parent: account
  name: 'default'
}

resource pending 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  parent: queues
  name: 'inspecciones-pendientes'
}

resource tables 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: account
  name: 'default'
}

resource inspections 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tables
  name: 'inspecciones'
}

output name string = account.name
output id string = account.id
