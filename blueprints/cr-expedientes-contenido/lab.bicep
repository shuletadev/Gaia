param labName string
param location string
param tags object
param deployments array

module ai '../shared/foundry.bicep' = {
  name: 'ai'
  params: {
    labName: labName
    location: location
    tags: tags
    projectName: 'expedientes'
    projectDisplayName: 'Cooperativa cafetalera: expedientes (ficticia)'
    projectDescription: 'Proyecto de clase: extraer información de documentos, imágenes, audio y video.'
    deployments: deployments
  }
}

// The studios read the sample files from the browser, so their origins are allowed.
module storage '../shared/samples-storage.bicep' = {
  name: 'storage'
  params: {
    labName: labName
    location: location
    tags: tags
    container: 'expedientes'
    corsOrigins: ['https://ai.azure.com', 'https://contentunderstanding.ai.azure.com']
  }
}

output aiAccount string = ai.outputs.name
output storageAccount string = storage.outputs.name
