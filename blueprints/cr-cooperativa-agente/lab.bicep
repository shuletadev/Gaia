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
    projectName: 'ahorro-verde'
    projectDisplayName: 'Cooperativa Ahorro Verde (ficticia)'
    projectDescription: 'Proyecto de clase: un agente que responde con los documentos de la cooperativa.'
    deployments: deployments
  }
}

// The cooperative's documents (the agent's file search reads them) and the client scripts; the portal reads them from the browser.
module storage '../shared/samples-storage.bicep' = {
  name: 'storage'
  params: {
    labName: labName
    location: location
    tags: tags
    container: 'documentos'
    corsOrigins: ['https://ai.azure.com']
  }
}

output aiAccount string = ai.outputs.name
output projectEndpoint string = ai.outputs.projectEndpoint
output storageAccount string = storage.outputs.name
