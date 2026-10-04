param labName string
param location string
param tags object
param registrySku string
param minReplicas int
param maxReplicas int

module registry 'registry.bicep' = {
  name: 'registry'
  params: { labName: labName, location: location, tags: tags, registrySku: registrySku }
}

module instance 'instance.bicep' = {
  name: 'instance'
  params: { labName: labName, location: location, tags: tags }
}

module app 'app.bicep' = {
  name: 'app'
  params: { labName: labName, location: location, tags: tags, minReplicas: minReplicas, maxReplicas: maxReplicas }
}

output registryName string = registry.outputs.name
output registryServer string = registry.outputs.loginServer
output instanceUrl string = instance.outputs.url
output appUrl string = app.outputs.url
output appName string = app.outputs.name
