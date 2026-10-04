param labName string
param location string
param tags object
param tier string
@secure()
param adminPassword string
param adminLogin string = 'pulperiaAdmin'

// Three ways to pay for the same database, so the class can compare them.
var skus = {
  basic: { name: 'Basic', tier: 'Basic', capacity: 5 }
  serverless: { name: 'GP_S_Gen5_1', tier: 'GeneralPurpose', family: 'Gen5', capacity: 1 }
  free: { name: 'GP_S_Gen5_1', tier: 'GeneralPurpose', family: 'Gen5', capacity: 1 }
}
var props = {
  basic: { maxSizeBytes: 2147483648, requestedBackupStorageRedundancy: 'Local' }
  serverless: { maxSizeBytes: 34359738368, autoPauseDelay: 60, minCapacity: json('0.5'), requestedBackupStorageRedundancy: 'Local' }
  free: {
    maxSizeBytes: 34359738368
    autoPauseDelay: 60
    minCapacity: json('0.5')
    requestedBackupStorageRedundancy: 'Local'
    useFreeLimit: true
    freeLimitExhaustionBehavior: 'AutoPause'
  }
}

resource server 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: '${labName}-sql'
  location: location
  tags: tags
  properties: {
    administratorLogin: adminLogin
    administratorLoginPassword: adminPassword
    version: '12.0'
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

resource db 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: server
  name: 'pulperia'
  location: location
  tags: tags
  sku: skus[tier]
  properties: props[tier]
}

output databaseId string = db.id
output serverName string = server.name
output serverFqdn string = server.properties.fullyQualifiedDomainName
output adminLogin string = adminLogin
output database string = db.name
