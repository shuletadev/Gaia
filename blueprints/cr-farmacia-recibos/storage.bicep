param labName string
param location string
param tags object
param redundancy string

// Storage account names are global: 3-24 lowercase letters and digits.
var accountName = take('${replace(labName, '-', '')}${uniqueString(resourceGroup().id)}', 24)

resource account 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: accountName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_${redundancy}' }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    accessTier: 'Hot'
  }
}

resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: account
  name: 'default'
}

// Digital copies of the receipts (PDFs) the pharmacy hands to customers.
resource receipts 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'recibos'
  properties: { publicAccess: 'None' }
}

output name string = account.name
