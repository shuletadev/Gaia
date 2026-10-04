param labName string
param location string
param tags object
param contactEmail string
param errorThreshold int
param maintenanceRule bool

module monitor 'monitor.bicep' = {
  name: 'monitor'
  params: { labName: labName, location: location, tags: tags }
}

module app 'app.bicep' = {
  name: 'app'
  params: {
    labName: labName
    location: location
    tags: tags
    workspaceId: monitor.outputs.workspaceId
    insightsConnection: monitor.outputs.connectionString
    page: loadTextContent('page.html')
    server: loadTextContent('server.js')
  }
}

module alerts 'alerts.bicep' = {
  name: 'alerts'
  params: {
    labName: labName
    tags: tags
    contactEmail: contactEmail
    errorThreshold: errorThreshold
    maintenanceRule: maintenanceRule
    siteId: app.outputs.id
    insightsId: monitor.outputs.insightsId
  }
}

output url string = app.outputs.url
output siteName string = app.outputs.name
output workspaceName string = monitor.outputs.workspaceName
output insightsName string = monitor.outputs.insightsName
