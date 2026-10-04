param labName string
param location string
param tags object
param openFirewall bool
@secure()
param adminPassword string

module lake 'lake.bicep' = {
  name: 'lake'
  params: { labName: labName, location: location, tags: tags }
}

module workspace 'workspace.bicep' = {
  name: 'workspace'
  params: {
    labName: labName
    location: location
    tags: tags
    accountName: lake.outputs.name
    dfsUrl: lake.outputs.dfsUrl
    openFirewall: openFirewall
    adminPassword: adminPassword
  }
}

output dataLake string = lake.outputs.name
output workspace string = workspace.outputs.name
output studioUrl string = workspace.outputs.studioUrl
output sqlEndpoint string = workspace.outputs.sqlEndpoint
