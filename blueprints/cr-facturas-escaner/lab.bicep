param labName string
param location string
param tags object

module ai '../shared/ai-services.bicep' = {
  name: 'ai'
  params: { labName: labName, location: location, tags: tags }
}

// The Studio reads the sample documents straight from the browser, so it must be an allowed origin.
module storage '../shared/samples-storage.bicep' = {
  name: 'storage'
  params: {
    labName: labName
    location: location
    tags: tags
    container: 'muestras'
    corsOrigins: ['https://documentintelligence.ai.azure.com']
  }
}

output aiAccount string = ai.outputs.name
output endpoint string = ai.outputs.endpoint
output storageAccount string = storage.outputs.name
output container string = storage.outputs.container
