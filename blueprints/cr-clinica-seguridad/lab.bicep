param labName string
param location string
param tags object
param networkLockdown bool
param auditLogs bool

module network 'network.bicep' = {
  name: 'network'
  params: { labName: labName, location: location, tags: tags }
}

module storage 'storage.bicep' = {
  name: 'storage'
  params: { labName: labName, location: location, tags: tags, networkLockdown: networkLockdown }
}

module monitor 'monitor.bicep' = {
  name: 'monitor'
  params: { labName: labName, location: location, tags: tags }
}

module vault 'vault.bicep' = {
  name: 'vault'
  params: {
    labName: labName
    location: location
    tags: tags
    auditLogs: auditLogs
    workspaceId: monitor.outputs.workspaceId
  }
}

// The app's identity can read secrets (and nothing else): least privilege made visible in the RBAC blade.
module identity 'identity.bicep' = {
  name: 'identity'
  params: { labName: labName, location: location, tags: tags, vaultName: vault.outputs.name }
}

output vaultName string = vault.outputs.name
output vaultUri string = vault.outputs.uri
output appIdentity string = identity.outputs.name
output storageAccount string = storage.outputs.name
