param labName string
param location string
param tags object
param redundancy string

// Static Web Apps is only offered in a few regions; fall back to Central US when the lab runs elsewhere.
var swaRegions = ['centralus', 'eastus2', 'westus2', 'westeurope', 'eastasia']
var webLocation = contains(swaRegions, toLower(location)) ? location : 'centralus'

module storage 'storage.bicep' = {
  name: 'storage'
  params: { labName: labName, location: location, tags: tags, redundancy: redundancy }
}

module cosmos 'cosmos.bicep' = {
  name: 'cosmos'
  params: { labName: labName, location: location, tags: tags }
}

module web 'web.bicep' = {
  name: 'web'
  params: { labName: labName, location: webLocation, tags: tags }
}

output url string = web.outputs.url
output staticSiteName string = web.outputs.name
output storageAccount string = storage.outputs.name
output cosmosEndpoint string = cosmos.outputs.endpoint
