param labName string
param location string
param tags object

// Serverless: no provisioned throughput, so an idle account costs almost nothing.
resource account 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: '${labName}-cosmos'
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    locations: [{ locationName: location, failoverPriority: 0, isZoneRedundant: false }]
    capabilities: [{ name: 'EnableServerless' }]
    minimalTlsVersion: 'Tls12'
  }
}

resource db 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: account
  name: 'farmacia'
  properties: { resource: { id: 'farmacia' } }
}

// One document per sale (the receipt data), grouped by day.
resource sales 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: db
  name: 'ventas'
  properties: {
    resource: {
      id: 'ventas'
      partitionKey: { paths: ['/fecha'], kind: 'Hash' }
    }
  }
}

// The product catalog (medicines, vitamins, personal care).
resource products 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: db
  name: 'productos'
  properties: {
    resource: {
      id: 'productos'
      partitionKey: { paths: ['/categoria'], kind: 'Hash' }
    }
  }
}

output endpoint string = account.properties.documentEndpoint
