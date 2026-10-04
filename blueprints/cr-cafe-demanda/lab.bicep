param labName string
param location string
param tags object
param computeSize string

module storage 'storage.bicep' = {
  name: 'storage'
  params: { labName: labName, location: location, tags: tags }
}

module monitor 'monitor.bicep' = {
  name: 'monitor'
  params: { labName: labName, location: location, tags: tags }
}

// The vault name starts with the lab name so a destroy can purge it when it is soft-deleted.
module vault 'vault.bicep' = {
  name: 'vault'
  params: { labName: labName, location: location, tags: tags }
}

module workspace 'workspace.bicep' = {
  name: 'workspace'
  params: {
    labName: labName
    location: location
    tags: tags
    computeSize: computeSize
    storageName: storage.outputs.name
    vaultName: vault.outputs.name
    insightsId: monitor.outputs.insightsId
  }
}

output studioUrl string = workspace.outputs.studioUrl
output workspace string = workspace.outputs.name
output compute string = workspace.outputs.compute
output storageAccount string = storage.outputs.name
