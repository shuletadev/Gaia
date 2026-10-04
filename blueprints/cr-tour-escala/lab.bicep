param labName string
param location string
param tags object
param maxInstances int
param healthCheck bool

module monitor 'monitor.bicep' = {
  name: 'monitor'
  params: { labName: labName, location: location, tags: tags }
}

module plan 'plan.bicep' = {
  name: 'plan'
  params: { labName: labName, location: location, tags: tags, maxInstances: maxInstances }
}

module app 'app.bicep' = {
  name: 'app'
  params: {
    labName: labName
    location: location
    tags: tags
    planId: plan.outputs.id
    healthCheck: healthCheck
    insightsConnection: monitor.outputs.connectionString
    page: loadTextContent('page.html')
    server: loadTextContent('server.js')
  }
}

output url string = app.outputs.url
output stagingUrl string = app.outputs.stagingUrl
output siteName string = app.outputs.name
output planName string = plan.outputs.name
