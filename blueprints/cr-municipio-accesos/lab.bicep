param labName string
param location string
param tags object
param appTier string
param appHasAccess bool

module identities 'identities.bicep' = {
  name: 'identities'
  params: { labName: labName, location: location, tags: tags }
}

module storage 'storage.bicep' = {
  name: 'storage'
  params: { labName: labName, location: location, tags: tags }
}

module app 'app.bicep' = {
  name: 'app'
  params: {
    labName: labName
    location: location
    tags: tags
    appTier: appTier
    storageAccount: storage.outputs.name
    page: loadTextContent('page.html')
    server: loadTextContent('server.js')
  }
}

module roles 'roles.bicep' = {
  name: 'roles'
  params: {
    storageAccount: storage.outputs.name
    container: storage.outputs.container
    auditorId: identities.outputs.auditorId
    operatorId: identities.outputs.operatorId
    technicianId: identities.outputs.technicianId
    appPrincipalId: app.outputs.principalId
    appHasAccess: appHasAccess
  }
}

output url string = app.outputs.url
output siteName string = app.outputs.name
output storageAccount string = storage.outputs.name
