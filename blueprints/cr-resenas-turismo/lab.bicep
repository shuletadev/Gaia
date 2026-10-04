param labName string
param location string
param tags object

module ai '../shared/ai-services.bicep' = {
  name: 'ai'
  params: { labName: labName, location: location, tags: tags }
}

module storage '../shared/samples-storage.bicep' = {
  name: 'storage'
  params: {
    labName: labName
    location: location
    tags: tags
    container: 'muestras'
    corsOrigins: ['https://language.cognitive.azure.com']
  }
}

output aiAccount string = ai.outputs.name
output endpoint string = ai.outputs.endpoint
output storageAccount string = storage.outputs.name
output container string = storage.outputs.container
