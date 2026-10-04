param labName string
param location string
param tags object
param searchTier string

// Holds the index students create over the brochures ("add your data" in the Foundry portal).
resource search 'Microsoft.Search/searchServices@2024-06-01-preview' = {
  name: '${labName}-search'
  location: location
  tags: tags
  sku: { name: searchTier }
  properties: {
    replicaCount: 1
    partitionCount: 1
    hostingMode: 'default'
    publicNetworkAccess: 'enabled'
  }
}

output name string = search.name
