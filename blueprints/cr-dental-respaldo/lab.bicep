param labName string
param location string
param tags object
param vaultRedundancy string
param protectVm bool
param retentionDays int
@secure()
param adminPassword string

module server 'server.bicep' = {
  name: 'server'
  params: { labName: labName, location: location, tags: tags, adminPassword: adminPassword }
}

module vault 'vault.bicep' = {
  name: 'vault'
  params: {
    labName: labName
    location: location
    tags: tags
    vaultRedundancy: vaultRedundancy
    protectVm: protectVm
    retentionDays: retentionDays
    vmId: server.outputs.id
    vmName: server.outputs.name
  }
}

output vaultId string = vault.outputs.id
output vaultName string = vault.outputs.name
output backupVaultName string = vault.outputs.backupVaultName
output vmName string = server.outputs.name
