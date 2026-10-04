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
    projectName: 'feria-zarcero'
    projectDisplayName: 'Feria del Agricultor de Zarcero (ficticia)'
    projectDescription: 'Proyecto de clase: voz, imágenes y generación de imágenes para una feria.'
    deployments: deployments
  }
}

output aiAccount string = ai.outputs.name
output projectEndpoint string = ai.outputs.projectEndpoint
