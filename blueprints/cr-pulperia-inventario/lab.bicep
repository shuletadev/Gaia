param labName string
param location string
param tags object
param tier string
@secure()
param adminPassword string

module sql 'sql.bicep' = {
  name: 'sql'
  params: { labName: labName, location: location, tags: tags, tier: tier, adminPassword: adminPassword }
}

output databaseId string = sql.outputs.databaseId
output serverName string = sql.outputs.serverName
output serverFqdn string = sql.outputs.serverFqdn
output adminLogin string = sql.outputs.adminLogin
output database string = sql.outputs.database
