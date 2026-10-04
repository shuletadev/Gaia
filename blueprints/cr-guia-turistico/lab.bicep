param labName string
param location string
param tags object
param model string
param capacityK int
param searchTier string

module ai 'ai.bicep' = {
  name: 'ai'
  params: { labName: labName, location: location, tags: tags, model: model, capacityK: capacityK }
}

module search 'search.bicep' = {
  name: 'search'
  params: { labName: labName, location: location, tags: tags, searchTier: searchTier }
}

// The brochures; the Foundry portal reads them from the browser, so it must be an allowed origin.
module storage '../shared/samples-storage.bicep' = {
  name: 'storage'
  params: {
    labName: labName
    location: location
    tags: tags
    container: 'folletos'
    corsOrigins: ['https://ai.azure.com']
  }
}

output aiAccount string = ai.outputs.name
output deployment string = ai.outputs.deployment
output searchService string = search.outputs.name
output storageAccount string = storage.outputs.name
