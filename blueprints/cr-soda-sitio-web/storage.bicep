param labName string
param location string
param tags object
param redundancy string
param accessTier string

// Storage account names are global: 3-24 lowercase letters and digits.
var accountName = take('${replace(labName, '-', '')}${uniqueString(resourceGroup().id)}', 24)

resource account 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: accountName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_${redundancy}' }
  properties: {
    accessTier: accessTier
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    // A public website is public on purpose; every other container stays private by default.
    allowBlobPublicAccess: true
    // labctl uploads the site files with the account key.
    allowSharedKeyAccess: true
  }
}

output name string = account.name
output webUrl string = account.properties.primaryEndpoints.web
output webHost string = replace(replace(account.properties.primaryEndpoints.web, 'https://', ''), '/', '')
